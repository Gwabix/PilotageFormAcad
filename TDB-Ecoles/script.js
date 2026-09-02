'use strict';

const state = {
    ecoles: [],
    personnels: [],
    formations: [],
    relatedTablesLoaded: false,
    ecolesTable: null,
    personnelsTable: null,
    mappings: {},
    currentDepartement: null,
    currentCirconscription: null,
    currentYear: null,
    yearOptions: [],
    fieldMap: {},
    personnelFieldMap: {},
    listenersAttached: {
        year: false,
        filters: false,
        search: false,
        collapse: false,
        modal: false,
        rgpd: false,
        addTeacher: false
    }
};

const REQUIRED_ECOLE_FIELDS = [
    'Nom_etablissement', 'Adresse_2', 'Code_postal', 'Nom_commune',
    'Libelle_departement', 'Circonscription', 'Mail', 'Telephone', 'Commune_Nom'
];

const REQUIRED_PERSONNEL_FIELDS = [
    'Civilite', 'Nom', 'Prenom', 'Mail', 'Fonction', 'Quotite_de_service',
    'ID_PE', 'Retrait'
];

const SCHOOL_YEAR_FIELDS = ['Annee_scolaire'];

// La logique RGPD (détection + suppression) vit dans ../shared/rgpd-purge.js
// (objet global RgpdPurge), partagé avec le widget « Pilotage académique ».

// Date du jour (minuit UTC) en secondes depuis l'epoch — format des colonnes Date de Grist.
function todayDateEpochSeconds() {
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 1000;
}

// Valeur d'une colonne Date de Grist -> secondes epoch, ou null si vide.
function parseDateEpochSeconds(rawValue) {
    if (rawValue === null || rawValue === undefined || rawValue === '') return null;
    const num = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    return Number.isFinite(num) ? num : null;
}

// Normalise une valeur ChoiceList Grist vers la forme ['L', ...valeurs].
function toChoiceListRaw(rawValue) {
    if (Array.isArray(rawValue)) {
        const clean = rawValue.filter(v => v !== 'L' && v !== null && v !== undefined && v !== '');
        return ['L', ...clean];
    }
    return toChoiceListValue(parseNiveaux(rawValue));
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function sanitizeText(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function sanitizeMultilineText(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim();
}

function showStatus(message, isError) {
    const banner = document.getElementById('status-banner');
    banner.textContent = message;
    banner.classList.remove('hidden');
    banner.classList.toggle('error', !!isError);
}

function hideStatus() {
    document.getElementById('status-banner').classList.add('hidden');
}

function showToast(message, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type === 'error' ? 'error' : 'success');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3200);
}

// Toast avec bouton « Annuler » pour les actions réversibles.
function showUndoableToast(message, onUndo, timeoutMs) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast success toast-undoable';

    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'toast-undo-btn';
    undoBtn.textContent = 'Annuler';

    let settled = false;
    const dismiss = () => {
        if (settled) return;
        settled = true;
        toast.remove();
    };

    undoBtn.addEventListener('click', () => {
        if (settled) return;
        settled = true;
        toast.remove();
        onUndo();
    });

    toast.append(text, undoBtn);
    container.appendChild(toast);
    setTimeout(dismiss, timeoutMs || 8000);
}

function normalizeStr(str) {
    return sanitizeText(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function initGrist() {
    grist.ready({
        requiredAccess: 'full'
    });

    loadAllData();
}

// Charge une table Grist ; retourne null (sans faire échouer le chargement)
// si elle est absente ou inaccessible.
async function fetchTableRecords(tableId) {
    try {
        return tableToRecords(await grist.docApi.fetchTable(tableId));
    } catch (err) {
        console.warn('[Liste_PE] Table « ' + tableId + ' » non chargée :',
            (err && err.message) ? err.message : err);
        return null;
    }
}

// Remise en ordre de Liste_PE : suppression des lignes fantômes (détachées
// alors que la personne est affectée ailleurs la même année) et fusion des
// doublons. Retourne true si des lignes ont été supprimées.
async function cleanupListePe() {
    if (typeof ListePeMerge === 'undefined') {
        console.warn('[Liste_PE] Module ../shared/liste-pe-merge.js non chargé.');
        return false;
    }
    if (!state.relatedTablesLoaded) return false; // déjà signalé au chargement

    const { actions, summary, removedCount } =
        ListePeMerge.buildCleanupActions(state.personnels, state.formations);
    if (!actions.length) return false;

    try {
        await grist.docApi.applyUserActions(actions);
        console.info('[Liste_PE] ' + removedCount + ' ligne(s) supprimée(s) — '
            + summary.fantomes.length + ' fantôme(s), '
            + summary.fusions.length + ' fusion(s) :', summary);
        showToast(removedCount + ' ligne' + (removedCount > 1 ? 's' : '')
            + ' en double supprimée' + (removedCount > 1 ? 's' : '') + '.', 'success');
        return true;
    } catch (err) {
        console.error('[Liste_PE] Remise en ordre impossible :', err);
        return false;
    }
}

async function loadAllData(skipMerge) {
    try {
        showStatus('Chargement des données...', false);

        const ecolesData = await grist.docApi.fetchTable('Ecoles');
        const personnelsData = await grist.docApi.fetchTable('Liste_PE');

        state.ecoles = tableToRecords(ecolesData);
        state.personnels = tableToRecords(personnelsData);
        invalidateYearIndex();

        // Nom normalisé pré-calculé : la recherche le réutilise à chaque frappe.
        for (const ecole of state.ecoles) {
            ecole._normCommuneNom = normalizeStr(ecole.Commune_Nom || '');
        }

        // Formations est indispensable : ses lignes référencent Liste_PE et
        // doivent être repointées avant toute fusion ou suppression.
        const formationsRecords = await fetchTableRecords("Formations");
        state.formations = formationsRecords || [];
        state.relatedTablesLoaded = formationsRecords !== null;

        if (!state.relatedTablesLoaded) {
            console.warn('[Liste_PE] Table Formations indisponible : purge RGPD et fusion des doublons désactivées.');
        }

        // Remise en ordre automatique (fantômes + doublons) avant tout rendu.
        // Une seule tentative par cycle de chargement.
        if (!skipMerge && await cleanupListePe()) {
            return loadAllData(true);
        }

        const choicesByCol = await fetchColumnChoices('Liste_PE', ['Niveau_x_', 'Fonction', 'D_dir', 'TP', 'D_synd_', 'Autre']);

        const resolveOptions = (colId, fallback) => {
            const fromColumn = Array.isArray(choicesByCol[colId]) ? choicesByCol[colId] : [];
            if (fromColumn.length > 0) return fromColumn;
            const fromData = inferColumnChoices(state.personnels, colId);
            if (fromData.length > 0) return fromData;
            return fallback.slice();
        };

        const defaultJours = ['Lundi', 'Mardi', 'Jeudi', 'Vendredi'];

        NIVEAUX_OPTIONS = resolveOptions('Niveau_x_', ['TPS', 'PS', 'MS', 'GS', 'CP', 'CE1', 'CE2', 'CM1', 'CM2', 'ULIS', 'Autre']);
        FONCTION_OPTIONS = resolveOptions('Fonction', ['Directeur(trice)', 'Adjoint(e)', 'TR', 'Poste partagé', 'Ulis', 'UPE2A', 'ASH', 'PES']);

        DECHARGES_OPTIONS = {
            D_dir: resolveOptions('D_dir', defaultJours),
            TP: resolveOptions('TP', defaultJours),
            D_synd_: resolveOptions('D_synd_', defaultJours),
            Autre: resolveOptions('Autre', defaultJours)
        };

        validateEcolesFields(state.ecoles);
        validatePersonnelsFields(state.personnels);

        populateYearOptions();
        populateDepartementFilter();
        populateCirconscriptionFilter();
        attachFilterListeners();
        attachSearchListener();
        attachGlobalCollapseHandler();
        attachRgpdListeners();
        attachAddTeacherListeners();
        renderDashboard();
        hideStatus();
    } catch (err) {
        console.error(err);
        showStatus('Erreur lors du chargement des données. Vérifiez la configuration des tables.', true);
    }

    // Bandeau RGPD — isolé du rendu principal du tableau de bord.
    try {
        refreshRgpdBanner();
    } catch (rgpdBannerErr) {
        console.error('[RGPD] Échec du bandeau :', rgpdBannerErr);
    }
}

function tableToRecords(tableData) {
    const records = [];
    const keys = Object.keys(tableData).filter(k => k !== 'id');
    const count = tableData.id.length;
    for (let i = 0; i < count; i++) {
        const rec = { id: tableData.id[i] };
        for (const k of keys) {
            rec[k] = tableData[k][i];
        }
        records.push(rec);
    }
    return records;
}

function validateEcolesFields(records) {
    if (!records.length) return;
    const sample = records[0];
    const missing = REQUIRED_ECOLE_FIELDS.filter(f => !(f in sample));
    if (missing.length) {
        showStatus('Colonnes manquantes dans la table Ecoles : ' + missing.join(', '), true);
    }
}

function validatePersonnelsFields(records) {
    if (!records.length) return;
    const sample = records[0];
    const missing = REQUIRED_PERSONNEL_FIELDS.filter(f => !(f in sample));
    if (missing.length) {
        showStatus('Colonnes manquantes dans la table Liste_PE : ' + missing.join(', '), true);
    }
}

function populateYearOptions() {
    const yearSelect = document.getElementById('year-select');
    const currentSchoolYear = getCurrentSchoolYear().startYear;
    const years = getAvailableSchoolYears();
    const availableStartYears = years.map(year => year.startYear);
    const nextYear = availableStartYears.includes(state.currentYear)
        ? state.currentYear
        : (availableStartYears.includes(currentSchoolYear)
            ? currentSchoolYear
            : (availableStartYears[0] || null));

    yearSelect.innerHTML = '';
    years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = String(y.startYear);
        opt.textContent = y.label;
        if (y.startYear === nextYear) opt.selected = true;
        yearSelect.appendChild(opt);
    });

    yearSelect.disabled = years.length <= 1;
    state.yearOptions = years;
    state.currentYear = nextYear;

    if (!state.listenersAttached.year) {
        yearSelect.addEventListener('change', () => {
            state.currentYear = parseInt(yearSelect.value, 10);
            populateDepartementFilter();
            populateCirconscriptionFilter();
            renderDashboard();
        });
        state.listenersAttached.year = true;
    }
}

function getCurrentSchoolYear() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    return { startYear: month >= 8 ? year : year - 1 };
}

function getAvailableSchoolYears() {
    const years = new Set();

    state.personnels.forEach(record => {
        const startYear = getPersonnelSchoolYearStart(record);
        if (startYear !== null) years.add(startYear);
    });

    return Array.from(years)
        .sort((a, b) => b - a)
        .map(startYear => ({
            startYear,
            label: startYear + '-' + String(startYear + 1)
        }));
}

function getPersonnelSchoolYearStart(record) {
    for (const field of SCHOOL_YEAR_FIELDS) {
        const startYear = parseSchoolYearStart(record[field]);
        if (startYear !== null) return startYear;
    }
    return null;
}

function parseSchoolYearStart(rawValue) {
    const values = flattenRecordValue(rawValue);

    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 1900) {
            return Math.trunc(value);
        }

        const text = sanitizeText(value);
        if (!text) continue;

        const rangeMatch = text.match(/(\d{4})\s*[-/]\s*(\d{2,4})/);
        if (rangeMatch) {
            return parseInt(rangeMatch[1], 10);
        }

        const yearMatch = text.match(/\b(\d{4})\b/);
        if (yearMatch) {
            return parseInt(yearMatch[1], 10);
        }
    }

    return null;
}

function flattenRecordValue(rawValue) {
    if (rawValue === null || rawValue === undefined || rawValue === '') return [];
    if (Array.isArray(rawValue)) {
        return rawValue.flatMap(value => flattenRecordValue(value));
    }

    if (typeof rawValue === 'object') {
        if ('label' in rawValue) return flattenRecordValue(rawValue.label);
        if ('displayValue' in rawValue) return flattenRecordValue(rawValue.displayValue);
        if ('value' in rawValue) return flattenRecordValue(rawValue.value);
        if ('values' in rawValue) return flattenRecordValue(rawValue.values);
        if ('id' in rawValue) return flattenRecordValue(rawValue.id);
        if ('rowId' in rawValue) return flattenRecordValue(rawValue.rowId);
        if ('recordId' in rawValue) return flattenRecordValue(rawValue.recordId);
    }

    return [rawValue];
}

function getUniqueValues(records, field) {
    const set = new Set();
    records.forEach(r => {
        const v = r[field];
        if (v !== null && v !== undefined && v !== '') set.add(v);
    });
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b), 'fr'));
}

function populateDepartementFilter() {
    const values = getUniqueValues(getYearScopedEcoles(), 'Libelle_departement');
    const wrapper = document.getElementById('filter-departement-wrapper');
    const select = document.getElementById('filter-departement');

    if (values.length <= 1) {
        wrapper.classList.add('hidden');
        state.currentDepartement = values[0] || null;
        select.innerHTML = '';
        return;
    }

    wrapper.classList.remove('hidden');
    select.disabled = false;
    select.innerHTML = '<option value="">Sélectionner</option>';
    values.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    });

    if (!values.includes(state.currentDepartement)) {
        state.currentDepartement = null;
    }
    select.value = state.currentDepartement || '';
}

function populateCirconscriptionFilter() {
    const yearScopedEcoles = getYearScopedEcoles();
    const departements = getUniqueValues(yearScopedEcoles, 'Libelle_departement');
    const wrapper = document.getElementById('filter-circonscription-wrapper');
    const select = document.getElementById('filter-circonscription');

    if (departements.length > 1 && !state.currentDepartement) {
        wrapper.classList.remove('hidden');
        select.disabled = true;
        select.innerHTML = '<option value="">Sélectionnez d\'abord un département</option>';
        state.currentCirconscription = null;
        return;
    }

    const relevant = state.currentDepartement
        ? yearScopedEcoles.filter(e => e.Libelle_departement === state.currentDepartement)
        : yearScopedEcoles;

    const values = getUniqueValues(relevant, 'Circonscription');

    if (values.length <= 1) {
        wrapper.classList.add('hidden');
        state.currentCirconscription = values[0] || null;
        select.disabled = false;
        select.innerHTML = '';
        return;
    }

    wrapper.classList.remove('hidden');
    select.disabled = false;
    select.innerHTML = '<option value="">Sélectionner</option>';
    values.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    });

    if (!values.includes(state.currentCirconscription)) {
        state.currentCirconscription = null;
    }
    select.value = state.currentCirconscription || '';
}

function attachFilterListeners() {
    if (state.listenersAttached.filters) return;

    const depSelect = document.getElementById('filter-departement');
    const circSelect = document.getElementById('filter-circonscription');

    depSelect.addEventListener('change', () => {
        state.currentDepartement = depSelect.value || null;
        populateCirconscriptionFilter();
        renderDashboard();
    });

    circSelect.addEventListener('change', () => {
        state.currentCirconscription = circSelect.value || null;
        renderDashboard();
    });

    state.listenersAttached.filters = true;
}

/* --------------------------------------------------------------------------
   Index par année scolaire.
   Liste_PE peut compter plusieurs dizaines de milliers de lignes : on ne
   rebalaye pas la table pour chaque école. L'index est reconstruit uniquement
   quand l'année change ou quand les données sont rechargées.
   Un même enseignant peut avoir plusieurs lignes la même année (affectations
   partagées) : chacune est rangée sous son école.
   -------------------------------------------------------------------------- */
const yearIndex = {
    year: undefined,
    personnels: null,
    byEcoleRowId: null,
    scopedEcoles: null
};

function invalidateYearIndex() {
    yearIndex.year = undefined;
    yearIndex.personnels = null;
    yearIndex.byEcoleRowId = null;
    yearIndex.scopedEcoles = null;
}

function ensureYearIndex() {
    if (yearIndex.personnels && yearIndex.year === state.currentYear) return;

    const personnels = [];
    const byEcoleRowId = new Map();

    for (const record of state.personnels) {
        if (state.currentYear !== null && getPersonnelSchoolYearStart(record) !== state.currentYear) {
            continue;
        }
        personnels.push(record);

        const rowId = getPersonnelEcoleRowId(record);
        if (rowId === null || rowId <= 0) continue;
        let bucket = byEcoleRowId.get(rowId);
        if (!bucket) { bucket = []; byEcoleRowId.set(rowId, bucket); }
        bucket.push(record);
    }

    yearIndex.year = state.currentYear;
    yearIndex.personnels = personnels;
    yearIndex.byEcoleRowId = byEcoleRowId;
    yearIndex.scopedEcoles = state.ecoles.filter(ecole => byEcoleRowId.has(ecole.id));
}

function getYearFilteredPersonnels() {
    ensureYearIndex();
    return yearIndex.personnels;
}

function getPersonnelEcoleRowId(record) {
    const values = flattenRecordValue(record.UAI);
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
}

function getYearScopedEcoles() {
    ensureYearIndex();
    return yearIndex.scopedEcoles;
}

function getScopeSelectionMessage() {
    const yearScopedEcoles = getYearScopedEcoles();
    const departements = getUniqueValues(yearScopedEcoles, 'Libelle_departement');

    if (departements.length > 1 && !state.currentDepartement) {
        return 'Sélectionnez un département pour afficher les établissements.';
    }

    const relevant = state.currentDepartement
        ? yearScopedEcoles.filter(e => e.Libelle_departement === state.currentDepartement)
        : yearScopedEcoles;
    const circonscriptions = getUniqueValues(relevant, 'Circonscription');

    if (circonscriptions.length > 1 && !state.currentCirconscription) {
        return 'Sélectionnez une circonscription pour afficher les établissements.';
    }

    return '';
}

function getFilteredEcoles() {
    if (getScopeSelectionMessage()) return [];

    return getYearScopedEcoles().filter(e => {
        if (state.currentDepartement && e.Libelle_departement !== state.currentDepartement) return false;
        if (state.currentCirconscription && e.Circonscription !== state.currentCirconscription) return false;
        return true;
    }).sort((a, b) => {
        const c1 = String(a.Nom_commune || '').localeCompare(String(b.Nom_commune || ''), 'fr');
        if (c1 !== 0) return c1;
        const c2 = String(a.Adresse_2 || '').localeCompare(String(b.Adresse_2 || ''), 'fr');
        if (c2 !== 0) return c2;
        return String(a.Nom_etablissement || '').localeCompare(String(b.Nom_etablissement || ''), 'fr');
    });
}

function getPersonnelsForEcole(ecole) {
    ensureYearIndex();
    return yearIndex.byEcoleRowId.get(ecole.id) || [];
}

// Pertinence d'un texte normalisé pour une requête normalisée :
//   0 = le texte commence par la requête
//   1 = un mot du texte commence par la requête
//   2 = la requête apparaît en sous-chaîne (au milieu d'un mot)
//  -1 = aucune correspondance
function ecoleMatchRank(normalizedText, normalizedQuery) {
    if (!normalizedQuery) return -1;
    let best = -1;
    let from = 0;
    while (true) {
        const idx = normalizedText.indexOf(normalizedQuery, from);
        if (idx === -1) break;
        const rank = idx === 0
            ? 0
            : (/[^a-z0-9]/.test(normalizedText.charAt(idx - 1)) ? 1 : 2);
        if (best === -1 || rank < best) best = rank;
        if (best === 0) break;
        from = idx + 1;
    }
    return best;
}

// Écoles correspondant à la requête, triées : correspondances en début de mot
// d'abord, puis ordre alphabétique. `query` doit déjà être normalisée.
function rankedEcoleMatches(ecoles, query, limit) {
    const scored = [];
    for (const ecole of ecoles) {
        const text = ecole._normCommuneNom !== undefined
            ? ecole._normCommuneNom
            : normalizeStr(ecole.Commune_Nom || '');
        const rank = ecoleMatchRank(text, query);
        if (rank !== -1) scored.push({ ecole, rank, text });
    }
    scored.sort((a, b) => (a.rank - b.rank) || a.text.localeCompare(b.text, 'fr'));
    return scored.slice(0, limit).map(x => x.ecole);
}

function attachSearchListener() {
    if (state.listenersAttached.search) return;

    const input = document.getElementById('search-input');
    const resultsBox = document.getElementById('search-results');
    let activeIndex = -1;

    input.addEventListener('input', () => {
        const query = normalizeStr(input.value);
        resultsBox.innerHTML = '';
        activeIndex = -1;

        if (!query) {
            resultsBox.classList.add('hidden');
            return;
        }

        const matches = rankedEcoleMatches(getFilteredEcoles(), query, 30);

        if (!matches.length) {
            resultsBox.classList.add('hidden');
            return;
        }

        matches.forEach(e => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.setAttribute('role', 'option');
            item.textContent = sanitizeText(e.Commune_Nom || e.Nom_etablissement || '');
            item.dataset.ecoleId = String(e.id);
            item.addEventListener('click', () => {
                selectSearchResult(e.id);
            });
            resultsBox.appendChild(item);
        });

        // Premier résultat sélectionné par défaut (validable par Entrée).
        activeIndex = 0;
        const firstItem = resultsBox.querySelector('.search-result-item');
        if (firstItem) firstItem.classList.add('active');

        resultsBox.classList.remove('hidden');
    });

    input.addEventListener('keydown', (evt) => {
        const items = Array.from(resultsBox.querySelectorAll('.search-result-item'));
        if (!items.length || resultsBox.classList.contains('hidden')) return;

        if (evt.key === 'ArrowDown') {
            evt.preventDefault();
            activeIndex = Math.min(activeIndex + 1, items.length - 1);
            updateActiveItem(items, activeIndex);
        } else if (evt.key === 'ArrowUp') {
            evt.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            updateActiveItem(items, activeIndex);
        } else if (evt.key === 'Enter') {
            evt.preventDefault();
            if (activeIndex >= 0 && items[activeIndex]) {
                const ecoleId = parseInt(items[activeIndex].dataset.ecoleId, 10);
                selectSearchResult(ecoleId);
            }
        } else if (evt.key === 'Escape') {
            resultsBox.classList.add('hidden');
        }
    });

    document.addEventListener('click', (evt) => {
        if (!resultsBox.contains(evt.target) && evt.target !== input) {
            resultsBox.classList.add('hidden');
        }
    });

    state.listenersAttached.search = true;
}

function updateActiveItem(items, index) {
    items.forEach((it, i) => it.classList.toggle('active', i === index));
    if (items[index]) items[index].scrollIntoView({ block: 'nearest' });
}

function selectSearchResult(ecoleId) {
    const ecole = state.ecoles.find(e => e.id === ecoleId);
    if (!ecole) return;

    const depWrapper = document.getElementById('filter-departement-wrapper');
    if (!depWrapper.classList.contains('hidden')) {
        const depSelect = document.getElementById('filter-departement');
        depSelect.value = ecole.Libelle_departement;
        state.currentDepartement = ecole.Libelle_departement;
        populateCirconscriptionFilter();
    }

    const circWrapper = document.getElementById('filter-circonscription-wrapper');
    if (!circWrapper.classList.contains('hidden')) {
        const circSelect = document.getElementById('filter-circonscription');
        circSelect.value = ecole.Circonscription;
        state.currentCirconscription = ecole.Circonscription;
    }

    renderDashboard();

    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('search-input').value = '';

    requestAnimationFrame(() => {
        const card = document.querySelector('.ecole-card[data-ecole-id="' + ecoleId + '"]');
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            card.classList.add('highlight');
            setTimeout(() => card.classList.remove('highlight'), 1800);
        }
    });
}

function renderDashboard() {
    const container = document.getElementById('ecoles-container');
    const scopeSelectionMessage = getScopeSelectionMessage();

    if (scopeSelectionMessage) {
        container.innerHTML = '<div class="no-results">' + escapeHtml(scopeSelectionMessage) + '</div>';
        return;
    }

    const filtered = getFilteredEcoles();

    if (!filtered.length) {
        const yearLabel = state.currentYear !== null
            ? ' pour l\'année scolaire ' + state.currentYear + '-' + (state.currentYear + 1)
            : '';
        container.innerHTML = '<div class="no-results">Aucun établissement avec enseignant' + yearLabel + ' ne correspond aux filtres sélectionnés.</div>';
        return;
    }

    const groups = new Map();
    filtered.forEach(e => {
        const commune = sanitizeText(e.Nom_commune || 'Commune inconnue');
        if (!groups.has(commune)) groups.set(commune, []);
        groups.get(commune).push(e);
    });

    container.innerHTML = '';

    for (const [commune, ecolesInCommune] of groups) {
        const section = document.createElement('section');
        section.className = 'commune-section';

        const heading = document.createElement('h2');
        heading.className = 'commune-heading';
        heading.textContent = commune;
        section.appendChild(heading);

        ecolesInCommune.forEach(ecole => {
            section.appendChild(buildEcoleCard(ecole));
        });

        container.appendChild(section);
    }
}

function buildEcoleCard(ecole) {
    const card = document.createElement('article');
    card.className = 'ecole-card';
    card.dataset.ecoleId = String(ecole.id);

    const header = document.createElement('div');
    header.className = 'ecole-header';

    const main = document.createElement('div');
    main.className = 'ecole-header-main';
    main.innerHTML =
        '<h3>' + escapeHtml(ecole.Nom_etablissement || '') + '</h3>' +
        '<div class="ecole-header-line">' +
        escapeHtml(ecole.Adresse_2 || '') +
        (ecole.Adresse_2 ? ', ' : '') +
        escapeHtml(ecole.Code_postal || '') + ' ' + escapeHtml(ecole.Nom_commune || '') +
        '</div>';

    const meta = document.createElement('div');
    meta.className = 'ecole-header-meta';
    meta.innerHTML =
        '<span><strong>Département :</strong> ' + escapeHtml(ecole.Libelle_departement || '—') + '</span>' +
        '<span><strong>Circonscription :</strong> ' + escapeHtml(ecole.Circonscription || '—') + '</span>';

    const contact = document.createElement('div');
    contact.className = 'ecole-header-contact';
    contact.innerHTML =
        '<span>' + (ecole.Mail ? escapeHtml(ecole.Mail) : '—') + '</span>' +
        '<span>' + (ecole.Telephone ? escapeHtml(ecole.Telephone) : '—') + '</span>';

    header.appendChild(main);
    header.appendChild(meta);
    header.appendChild(contact);
    card.appendChild(header);

    const personnelsSection = document.createElement('div');
    personnelsSection.className = 'personnels-section';
    personnelsSection.appendChild(buildPersonnelsTable(ecole));
    card.appendChild(personnelsSection);

    const footer = document.createElement('div');
    footer.className = 'ecole-card-footer';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-teacher-btn';
    addBtn.textContent = 'Ajouter un enseignant';
    addBtn.addEventListener('click', () => openAddTeacherModal(ecole));
    footer.appendChild(addBtn);
    card.appendChild(footer);

    return card;
}

function buildPersonnelsTable(ecole) {
    const wrapper = document.createElement('div');
    const personnels = getPersonnelsForEcole(ecole);

    if (!personnels.length) {
        wrapper.innerHTML = '<div class="personnels-empty">Aucun enseignant renseigné pour cette école.</div>';
        return wrapper;
    }

    const table = document.createElement('table');
    table.className = 'personnels-table';
    table.innerHTML =
        '<colgroup>' +
        '<col class="col-civilite"><col class="col-nom"><col class="col-prenom"><col class="col-mail">' +
        '<col class="col-fonction"><col class="col-quotite"><col><col><col><col>' +
        '</colgroup>' +
        '<thead><tr>' +
        '<th>Civilité</th><th>Nom</th><th>Prénom</th><th>Mail</th><th>Fonction</th>' +
        '<th>Quotité</th><th>Décharge\r\nDir.</th><th>TP</th><th>Décharge\r\nsynd.</th><th>Autre</th>' +
        '</tr></thead>';

    const tbody = document.createElement('tbody');
    personnels
        .slice() // ne pas trier l'index en place
        .sort((a, b) => String(a.Nom || '').localeCompare(String(b.Nom || ''), 'fr'))
        .forEach(p => {
            tbody.appendChild(buildPersonnelRow(p, ecole));
        });

    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
}

let NIVEAUX_OPTIONS = [];
let FONCTION_OPTIONS = [];
let DECHARGES_OPTIONS = {
    D_dir: [],
    TP: [],
    D_synd_: [],
    Autre: []
};

async function fetchColumnChoices(tableId, colIds) {
    const result = {};
    for (const colId of colIds) result[colId] = [];

    try {
        const tokenInfo = await grist.docApi.getAccessToken({ readOnly: true });
        const url = `${tokenInfo.baseUrl}/tables/${encodeURIComponent(tableId)}/columns`
            + `?auth=${encodeURIComponent(tokenInfo.token)}`;

        const response = await fetch(url, { method: 'GET' });

        if (!response.ok) {
            throw new Error(`Statut HTTP ${response.status}`);
        }

        const data = await response.json();
        const columns = Array.isArray(data && data.columns) ? data.columns : [];

        for (const colId of colIds) {
            const column = columns.find(c => c && c.id === colId);
            const fields = column && column.fields ? column.fields : null;
            if (!fields) continue;

            let opts = null;
            if (typeof fields.widgetOptions === 'string' && fields.widgetOptions.trim()) {
                try {
                    opts = JSON.parse(fields.widgetOptions);
                } catch (e) {
                    opts = null;
                }
            } else if (fields.widgetOptions && typeof fields.widgetOptions === 'object') {
                opts = fields.widgetOptions;
            }

            if (!opts || !Array.isArray(opts.choices)) continue;

            const seen = new Set();
            const choices = [];
            for (const raw of opts.choices) {
                if (typeof raw !== 'string') continue;
                const label = raw.trim();
                if (!label || seen.has(label)) continue;
                seen.add(label);
                choices.push(label);
            }
            result[colId] = choices;
        }
    } catch (err) {
        console.error('fetchColumnChoices :', err);
    }

    return result;
}

function inferColumnChoices(records, colId) {
    const choices = new Set();
    for (const rec of records) {
        const value = rec[colId];
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                const v = value[i];
                if (i === 0 && v === 'L') continue;
                if (typeof v === 'string' && v.trim()) choices.add(v.trim());
            }
        } else if (typeof value === 'string' && value.trim()) {
            choices.add(value.trim());
        }
    }
    return Array.from(choices);
}

const editingState = {
    currentSchoolChangeRecord: null
};

const tooltipState = {
    el: null
};

function ensureChangeSchoolTooltip() {
    if (tooltipState.el) return tooltipState.el;

    const tooltip = document.createElement('div');
    tooltip.id = 'change-school-tooltip';
    tooltip.className = 'change-school-tooltip';
    tooltip.setAttribute('role', 'tooltip');

    const line = document.createElement('div');
    line.className = 'tooltip-line';
    line.textContent = 'Modifier l\'établissement\nde rattachement de';

    const identity = document.createElement('strong');
    identity.className = 'tooltip-identity';

    tooltip.append(line, identity);
    document.body.appendChild(tooltip);

    tooltipState.el = tooltip;
    return tooltip;
}

/**
 * Suffixe d'accord en genre, d'après la civilité de l'enseignant :
 *   « Madame » -> « e », « Monsieur » -> rien, civilité absente -> « (e) ».
 * Réservé aux messages qui désignent UNE personne identifiée ; les textes
 * génériques (aucune personne connue) gardent la forme parenthésée.
 */
function suffixeGenre(civilite) {
    const valeur = sanitizeText(civilite).toLowerCase();
    if (valeur === 'madame') return 'e';
    if (valeur === 'monsieur') return '';
    return '(e)';
}

function getPersonnelIdentity(p) {
    return [sanitizeText(p.Civilite || ''), sanitizeText(p.Prenom || ''), sanitizeText(p.Nom || '')]
        .filter(Boolean)
        .join(' ')
        .trim();
}

function positionChangeSchoolTooltip(button, tooltip) {
    const rect = button.getBoundingClientRect();
    const margin = 8;

    tooltip.style.left = '0px';
    tooltip.style.top = '0px';

    const ttRect = tooltip.getBoundingClientRect();
    let left = rect.left + (rect.width / 2) - (ttRect.width / 2);
    let top = rect.top - ttRect.height - margin;

    if (left < margin) left = margin;
    const maxLeft = window.innerWidth - ttRect.width - margin;
    if (left > maxLeft) left = Math.max(margin, maxLeft);

    if (top < margin) {
        top = rect.bottom + margin;
    }

    tooltip.style.left = Math.round(left) + 'px';
    tooltip.style.top = Math.round(top) + 'px';
}

function bindChangeSchoolTooltip(button, personnel) {
    const tooltip = ensureChangeSchoolTooltip();
    const identity = getPersonnelIdentity(personnel) || 'cet enseignant';

    button.removeAttribute('title');
    button.setAttribute('aria-label', 'Modifier l\'établissement de rattachement de ' + identity + '.');

    const show = () => {
        const identityEl = tooltip.querySelector('.tooltip-identity');
        identityEl.textContent = identity;

        tooltip.classList.add('visible');
        positionChangeSchoolTooltip(button, tooltip);
    };

    const hide = () => {
        tooltip.classList.remove('visible');
    };

    button.addEventListener('mouseenter', show);
    button.addEventListener('focus', show);
    button.addEventListener('mouseleave', hide);
    button.addEventListener('blur', hide);

    window.addEventListener('scroll', () => {
        if (tooltip.classList.contains('visible')) {
            positionChangeSchoolTooltip(button, tooltip);
        }
    }, true);

    window.addEventListener('resize', () => {
        if (tooltip.classList.contains('visible')) {
            positionChangeSchoolTooltip(button, tooltip);
        }
    });
}

const quitSchoolTooltipState = {
    el: null,
    listenersBound: false
};

function getEcoleLabel(ecole) {
    if (!ecole) return "l'école";
    const label = [
        sanitizeText(ecole.Nom_etablissement || ''),
        sanitizeText(ecole.Adresse_2 || ''),
        sanitizeText(ecole.Nom_commune || '')
    ].filter(Boolean).join(' ').trim();
    return label || "l'école";
}

function ensureQuitSchoolTooltip() {
    if (quitSchoolTooltipState.el) return quitSchoolTooltipState.el;

    const tooltip = document.createElement('div');
    tooltip.id = 'quit-school-tooltip';
    tooltip.className = 'quit-school-tooltip';
    tooltip.setAttribute('role', 'tooltip');

    const identity = document.createElement('strong');
    identity.className = 'tooltip-identity';

    const tail = document.createElement('span');
    tail.className = 'tooltip-tail';

    tooltip.append(document.createTextNode('Retirer '), identity, tail);
    document.body.appendChild(tooltip);

    quitSchoolTooltipState.el = tooltip;

    if (!quitSchoolTooltipState.listenersBound) {
        const hide = () => tooltip.classList.remove('visible');
        window.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);
        quitSchoolTooltipState.listenersBound = true;
    }

    return tooltip;
}

function positionQuitSchoolTooltip(button, tooltip) {
    const rect = button.getBoundingClientRect();
    const margin = 8;

    tooltip.style.left = '0px';
    tooltip.style.top = '0px';

    const ttRect = tooltip.getBoundingClientRect();
    let left = rect.left + (rect.width / 2) - (ttRect.width / 2);
    let top = rect.top - ttRect.height - margin;

    if (left < margin) left = margin;
    const maxLeft = window.innerWidth - ttRect.width - margin;
    if (left > maxLeft) left = Math.max(margin, maxLeft);

    if (top < margin) {
        top = rect.bottom + margin;
    }

    tooltip.style.left = Math.round(left) + 'px';
    tooltip.style.top = Math.round(top) + 'px';
}

function bindQuitSchoolTooltip(button, personnel, ecole) {
    const tooltip = ensureQuitSchoolTooltip();
    const identity = getPersonnelIdentity(personnel) || 'cet enseignant';
    const ecoleLabel = getEcoleLabel(ecole);

    button.removeAttribute('title');
    button.setAttribute('aria-label', 'Retirer ' + identity + ' de ' + ecoleLabel + '.');

    const show = () => {
        tooltip.querySelector('.tooltip-identity').textContent = identity;
        tooltip.querySelector('.tooltip-tail').textContent = ' de ' + ecoleLabel + '.';

        tooltip.classList.add('visible');
        positionQuitSchoolTooltip(button, tooltip);
    };

    const hide = () => {
        tooltip.classList.remove('visible');
    };

    button.addEventListener('mouseenter', show);
    button.addEventListener('focus', show);
    button.addEventListener('mouseleave', hide);
    button.addEventListener('blur', hide);
}

const quotiteTooltipState = { el: null, listenersBound: false };

function ensureQuotiteWarningTooltip() {
    if (quotiteTooltipState.el) return quotiteTooltipState.el;

    const tip = document.createElement('div');
    tip.className = 'quotite-warning-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = 'Veuillez renseigner les détails du temps partiel';
    document.body.appendChild(tip);
    quotiteTooltipState.el = tip;

    if (!quotiteTooltipState.listenersBound) {
        const hide = () => tip.classList.remove('visible');
        window.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);
        quotiteTooltipState.listenersBound = true;
    }

    return tip;
}

function positionQuotiteWarningTooltip(anchor, tip) {
    const rect = anchor.getBoundingClientRect();
    const margin = 8;

    tip.style.left = '0px';
    tip.style.top = '0px';

    const ttRect = tip.getBoundingClientRect();
    let left = rect.left + (rect.width / 2) - (ttRect.width / 2);
    let top = rect.top - ttRect.height - margin;

    if (left < margin) left = margin;
    const maxLeft = window.innerWidth - ttRect.width - margin;
    if (left > maxLeft) left = Math.max(margin, maxLeft);
    if (top < margin) top = rect.bottom + margin;

    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
}

function bindQuotiteWarningTooltip(cell) {
    const show = () => {
        if (!cell.classList.contains('quotite-warning')) return;
        const tip = ensureQuotiteWarningTooltip();
        tip.classList.add('visible');
        positionQuotiteWarningTooltip(cell, tip);
    };

    const hide = () => {
        if (quotiteTooltipState.el) quotiteTooltipState.el.classList.remove('visible');
    };

    cell.addEventListener('mouseenter', show);
    cell.addEventListener('mouseleave', hide);
    cell.addEventListener('focusin', show);
    cell.addEventListener('focusout', hide);
}

function buildPersonnelRow(p, ecole) {
    const fragment = document.createDocumentFragment();

    // Vérifie s'il y a des jours enregistrés dans la cellule Grist
    const hasDecharge = (field) => {
        const val = p[field];
        if (Array.isArray(val)) return val.length > 0;
        return !!val && String(val).trim().length > 0 && String(val) !== 'false' && String(val) !== '0';
    };

    // --- LIGNE 1 : INFOS ESSENTIELLES ---
    const trMain = document.createElement('tr');
    trMain.dataset.personnelId = String(p.id);
    trMain.className = 'main-row';

    trMain.appendChild(buildEditableCell(p, 'Civilite', 'select', ['Monsieur', 'Madame']));

    const nomCell = buildEditableCell(p, 'Nom', 'text');
    nomCell.classList.add('identity-cell');
    trMain.appendChild(nomCell);

    const prenomCell = buildEditableCell(p, 'Prenom', 'text');
    prenomCell.classList.add('identity-cell');
    trMain.appendChild(prenomCell);

    trMain.appendChild(buildMailCell(p));
    trMain.appendChild(buildEditableCell(p, 'Fonction', 'select', FONCTION_OPTIONS));

    const quotiteCell = buildEditableCell(p, 'Quotite_de_service', 'select', ['50%', '75%', '80%', '100%']);
    trMain.appendChild(quotiteCell);

    // Création des 4 cases de contrôle (Interrupteurs UI : cochés au chargement si des jours sont présents)
    const createTriggerCheckbox = (field) => {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = hasDecharge(field);
        td.appendChild(input);
        return { td, input };
    };

    const triggerDir = createTriggerCheckbox('D_dir');
    const triggerTP = createTriggerCheckbox('TP');
    const triggerSynd = createTriggerCheckbox('D_synd_');
    const triggerAutre = createTriggerCheckbox('Autre');

    trMain.append(triggerDir.td, triggerTP.td, triggerSynd.td, triggerAutre.td);

    // --- LIGNE 2 : NIVEAUX + SÉLECTION DES JOURS DE DÉCHARGES ---
    const trDecharges = document.createElement('tr');
    trDecharges.dataset.personnelId = String(p.id);
    trDecharges.className = 'decharges-row';

    const tdNiveaux = buildNiveauxCell(p);
    tdNiveaux.colSpan = 6;
    trDecharges.appendChild(tdNiveaux);

    // Création des cellules de sélection des jours ("Lundi", "Mardi", "Jeudi", "Vendredi")
    const cellDaysDir = buildDechargeSelectCell(p, 'D_dir', DECHARGES_OPTIONS.D_dir);
    const cellDaysTP = buildDechargeSelectCell(p, 'TP', DECHARGES_OPTIONS.TP);
    const cellDaysSynd = buildDechargeSelectCell(p, 'D_synd_', DECHARGES_OPTIONS.D_synd_);
    const cellDaysAutre = buildAutreDechargeCell(p);

    trDecharges.append(cellDaysDir, cellDaysTP, cellDaysSynd, cellDaysAutre);

    // La ligne 2 reste affichée en permanence ; seules les cellules de décharge varient.
    const updateDechargesVisibility = () => {
        cellDaysDir.style.visibility = triggerDir.input.checked ? 'visible' : 'hidden';
        cellDaysTP.style.visibility = triggerTP.input.checked ? 'visible' : 'hidden';
        cellDaysSynd.style.visibility = triggerSynd.input.checked ? 'visible' : 'hidden';
        cellDaysAutre.style.visibility = triggerAutre.input.checked ? 'visible' : 'hidden';
        if (typeof cellDaysAutre._updatePreciserVisibility === 'function') {
            cellDaysAutre._updatePreciserVisibility();
        }
    };

    updateDechargesVisibility();

    // Écouteur sur les cases de la ligne 1
    const setupTriggerListener = (trigger, field, cellDays) => {
        trigger.input.addEventListener('change', () => {
            if (!trigger.input.checked) {
                const select = cellDays.querySelector('select');
                if (select) {
                    if (typeof select._collapse === 'function') select._collapse();
                    if (typeof select._reset === 'function') {
                        select._reset();
                    } else {
                        Array.from(select.options).forEach(opt => { opt.selected = false; });
                        select.size = 1;
                    }
                }
                savePersonnelField(p.id, field, toChoiceListValue([]), () => {
                    p[field] = '';
                });

                if (field === 'Autre') {
                    const textarea = cellDays.querySelector('.preciser-input');
                    if (textarea) {
                        textarea.value = '';
                        if (typeof textarea._autoResize === 'function') textarea._autoResize();
                    }
                    savePersonnelField(p.id, 'Preciser', '', () => {
                        p.Preciser = '';
                    });
                }
            }
            updateDechargesVisibility();
        });
    };

    setupTriggerListener(triggerDir, 'D_dir', cellDaysDir);
    setupTriggerListener(triggerTP, 'TP', cellDaysTP);
    setupTriggerListener(triggerSynd, 'D_synd_', cellDaysSynd);
    setupTriggerListener(triggerAutre, 'Autre', cellDaysAutre);

    // --- ALERTE QUOTITÉ : temps partiel non détaillé ---
    // Cellule "Quotité" en jaune si la quotité n'est pas 100 % et que le temps
    // partiel n'est pas renseigné (case TP cochée + au moins un jour).
    const quotiteSelect = quotiteCell.querySelector('select');
    const tpDaysSelect = cellDaysTP.querySelector('select');

    const isPartTimeDetailed = () => {
        if (!triggerTP.input.checked) return false;
        if (tpDaysSelect) {
            return Array.from(tpDaysSelect.selectedOptions).some(opt => opt.value !== '');
        }
        return hasDecharge('TP');
    };

    const refreshQuotiteWarning = () => {
        const quotite = quotiteSelect ? quotiteSelect.value : '';
        const incomplete = quotite !== '100%' && !isPartTimeDetailed();
        quotiteCell.classList.toggle('quotite-warning', incomplete);
    };

    if (quotiteSelect) quotiteSelect.addEventListener('change', refreshQuotiteWarning);
    triggerTP.input.addEventListener('change', refreshQuotiteWarning);
    if (tpDaysSelect) tpDaysSelect.addEventListener('change', refreshQuotiteWarning);

    bindQuotiteWarningTooltip(quotiteCell);
    refreshQuotiteWarning();

    // --- LIGNE 3 : BOUTON ACTION ---
    const trNiveaux = document.createElement('tr');
    trNiveaux.dataset.personnelId = String(p.id);
    trNiveaux.className = 'action-row';
    trNiveaux.style.borderBottom = '2px solid #ccc'; // Sépare nettement chaque enseignant

    const actionsTd = document.createElement('td');
    actionsTd.colSpan = 10;
    actionsTd.className = 'action-cell';

    const actionButtons = document.createElement('div');
    actionButtons.className = 'action-buttons';

    const changeBtn = document.createElement('button');
    changeBtn.type = 'button';
    changeBtn.className = 'change-school-btn';
    changeBtn.textContent = "Changer d'établissement";
    bindChangeSchoolTooltip(changeBtn, p);
    changeBtn.addEventListener('click', () => openChangeSchoolModal(p));

    const quitBtn = document.createElement('button');
    quitBtn.type = 'button';
    quitBtn.className = 'quit-school-btn';
    quitBtn.textContent = "Retirer de l'école";
    bindQuitSchoolTooltip(quitBtn, p, ecole);
    quitBtn.addEventListener('click', () => {
        quitBtn.disabled = true;
        handleQuitSchool(p).finally(() => { quitBtn.disabled = false; });
    });

    actionButtons.append(changeBtn, quitBtn);
    actionsTd.appendChild(actionButtons);
    trNiveaux.appendChild(actionsTd);

    fragment.append(trMain, trDecharges, trNiveaux);
    return fragment;
}

function toChoiceListValue(values) {
    const clean = Array.isArray(values) ? values.filter(v => v !== null && v !== undefined && v !== '') : [];
    return ['L', ...clean];
}

function attachGlobalCollapseHandler() {
    if (state.listenersAttached.collapse) return;

    const collapseOpen = (e) => {
        const open = document.querySelector('.decharge-multiselect.expanded');
        if (!open) return;
        if (e && e.target === open) return;
        if (typeof open._collapse === 'function') open._collapse();
    };

    window.addEventListener('scroll', collapseOpen, true);
    window.addEventListener('resize', collapseOpen);

    state.listenersAttached.collapse = true;
}

function buildDechargeSelectCell(record, field, options) {
    const td = document.createElement('td');
    td.className = 'decharge-select-cell';

    if (!options || !options.length) {
        return buildEditableCell(record, field, 'text');
    }

    const select = document.createElement('select');
    select.multiple = true;
    select.className = 'decharge-multiselect';
    let closeButton = null;

    const currentValues = parseNiveaux(record[field]);

    function buildOptionsList(selectedValues) {
        select.textContent = '';

        const hasSelection = Array.isArray(selectedValues) && selectedValues.length > 0;

        if (!hasSelection) {
            const placeholder = document.createElement('option');
            placeholder.textContent = 'Sélectionner';
            placeholder.value = '';
            placeholder.disabled = true;
            placeholder.selected = true;
            placeholder.className = 'decharge-placeholder';
            select.appendChild(placeholder);
        }

        const orphans = selectedValues.filter(v => !options.includes(v));
        const allOptions = [...options, ...orphans];
        const selected = allOptions.filter(o => selectedValues.includes(o));
        const unselected = allOptions.filter(o => !selectedValues.includes(o));
        [...selected, ...unselected].forEach(jour => {
            const opt = document.createElement('option');
            opt.value = jour;
            opt.textContent = jour;
            opt.selected = selectedValues.includes(jour);
            if (!options.includes(jour)) {
                opt.classList.add('option-orphan');
                opt.title = 'Valeur absente de la liste de choix de la colonne';
            }
            select.appendChild(opt);
        });
    }

    buildOptionsList(currentValues);

    const collapsedSize = () => {
        const selectedCount = select.querySelectorAll('option:checked').length;
        return Math.max(1, selectedCount);
    };

    const expandedSize = () => Math.min(Math.max(options.length, 5), 10);

    const MARGIN = 8;

    const positionExpanded = () => {
        select.style.top = '0px';
        select.style.left = '0px';

        const anchor = td.getBoundingClientRect();
        const box = select.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const maxWidth = Math.max(60, vw - (2 * MARGIN));
        const effectiveWidth = Math.min(Math.max(box.width, anchor.width), maxWidth);

        const spaceBelow = vh - anchor.bottom - MARGIN;
        const spaceAbove = anchor.top - MARGIN;

        let top;
        if (box.height <= spaceBelow || spaceBelow >= spaceAbove) {
            top = anchor.bottom;
            select.style.maxHeight = Math.max(60, spaceBelow) + 'px';
        } else {
            top = Math.max(MARGIN, anchor.top - box.height);
            select.style.maxHeight = Math.max(60, spaceAbove) + 'px';
        }

        let left = anchor.left;
        if (left + effectiveWidth > vw - MARGIN) left = vw - MARGIN - effectiveWidth;
        if (left < MARGIN) left = MARGIN;

        select.style.top = Math.round(top) + 'px';
        select.style.left = Math.round(left) + 'px';
        select.style.minWidth = Math.round(anchor.width) + 'px';

        if (closeButton) {
            const buttonSize = 18;
            const placedBox = select.getBoundingClientRect();
            closeButton.style.top = Math.round(top - 8) + 'px';
            closeButton.style.left = Math.round(placedBox.right - buttonSize) + 'px';
        }
    };

    const collapse = () => {
        if (!select.classList.contains('expanded')) return;
        select.classList.remove('expanded');
        select.style.top = '';
        select.style.left = '';
        select.style.maxHeight = '';
        select.style.minWidth = '';
        select.size = collapsedSize();

        if (closeButton) {
            closeButton.classList.remove('visible');
        }
    };

    select._reset = () => {
        buildOptionsList([]);
        select.size = collapsedSize();
    };

    const expand = () => {
        if (select.classList.contains('expanded')) return;
        select.size = expandedSize();
        select.classList.add('expanded');
        positionExpanded();

        if (closeButton) {
            closeButton.classList.add('visible');
        }
    };

    select.size = collapsedSize();

    select.addEventListener('mousedown', (evt) => {
        if (evt.target.tagName !== 'OPTION') return;

        if (!select.classList.contains('expanded')) {
            evt.preventDefault();
            expand();
            select.focus();
            return;
        }

        evt.preventDefault();
        const option = evt.target;
        option.selected = !option.selected;
        select.dispatchEvent(new Event('change'));
    });

    select.addEventListener('focus', () => {
        select.size = expandedSize();
        select.classList.add('expanded');
    });

    select.addEventListener('blur', () => {
        const selectedValues = Array.from(select.selectedOptions)
            .map(o => o.value)
            .filter(v => v !== '');
        buildOptionsList(selectedValues);
        collapse();
    });

    select.addEventListener('change', () => {
        const selectedValues = Array.from(select.selectedOptions)
            .map(o => o.value)
            .filter(v => v !== '');
        const orderedValues = options.filter(o => selectedValues.includes(o));

        if (select.classList.contains('expanded')) {
            buildOptionsList(selectedValues);
            select.size = expandedSize();
        } else {
            select.size = Math.max(1, orderedValues.length);
        }

        savePersonnelField(record.id, field, toChoiceListValue(orderedValues), () => {
            record[field] = orderedValues;
        });
    });

    td.appendChild(select);

    closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'decharge-close-btn';
    closeButton.setAttribute('aria-label', 'Fermer la liste de décharges');
    const closeGlyph = document.createElement('span');
    closeGlyph.className = 'decharge-close-glyph';
    closeGlyph.textContent = '×';
    closeButton.appendChild(closeGlyph);
    closeButton.addEventListener('mousedown', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        collapse();
        select.blur();
    });
    td.appendChild(closeButton);

    select._collapse = collapse;

    return td;
}

function buildAutreDechargeCell(record) {
    const td = buildDechargeSelectCell(record, 'Autre', DECHARGES_OPTIONS.Autre);
    td.classList.add('decharge-with-preciser');
    const select = td.querySelector('.decharge-multiselect');

    const textarea = document.createElement('textarea');
    textarea.className = 'preciser-input';
    textarea.rows = 1;
    textarea.placeholder = 'Préciser';
    textarea.value = sanitizeMultilineText(record.Preciser || '');

    const autoResize = () => {
        if (textarea.classList.contains('is-hidden')) return;
        textarea.style.height = 'auto';
        const nextHeight = Math.max(28, textarea.scrollHeight);
        textarea.style.height = nextHeight + 'px';
    };

    const updatePreciserVisibility = () => {
        const hasSelectedOption = !!select && Array.from(select.selectedOptions).some(opt => opt.value !== '');
        textarea.classList.toggle('is-hidden', !hasSelectedOption);
        if (hasSelectedOption) autoResize();
    };

    let savedValue = sanitizeMultilineText(record.Preciser || '');
    let saveTimer = null;

    const commit = (trimTrailingSpaces = true) => {
        if (saveTimer !== null) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }

        const rawValue = sanitizeMultilineText(textarea.value);
        const nextValue = trimTrailingSpaces ? rawValue.trimEnd() : rawValue;
        textarea.value = nextValue;
        autoResize();

        if (nextValue === savedValue) return;

        savePersonnelField(record.id, 'Preciser', nextValue, () => {
            record.Preciser = nextValue;
            savedValue = nextValue;
        });
    };

    const scheduleCommit = () => {
        if (saveTimer !== null) {
            clearTimeout(saveTimer);
        }

        saveTimer = window.setTimeout(() => {
            saveTimer = null;
            commit(false);
        }, 1000);
    };

    const onOutsidePointerDown = (evt) => {
        if (td.contains(evt.target)) return;
        commit();
        textarea.blur();
    };

    const onScrollCommit = () => {
        commit();
        textarea.blur();
    };

    const attachCommitListeners = () => {
        document.addEventListener('pointerdown', onOutsidePointerDown);
        window.addEventListener('scroll', onScrollCommit, true);
    };

    const detachCommitListeners = () => {
        document.removeEventListener('pointerdown', onOutsidePointerDown);
        window.removeEventListener('scroll', onScrollCommit, true);
    };

    textarea.addEventListener('input', () => {
        autoResize();
        scheduleCommit();
    });

    textarea.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' && !evt.shiftKey) {
            evt.preventDefault();
            commit();
            textarea.blur();
            return;
        }

        if (evt.key === 'Enter' && evt.shiftKey) {
            requestAnimationFrame(autoResize);
        }
    });

    textarea.addEventListener('focus', attachCommitListeners);

    textarea.addEventListener('blur', () => {
        commit();
        detachCommitListeners();
    });

    textarea._autoResize = autoResize;

    td.appendChild(textarea);
    if (select) {
        select.addEventListener('change', updatePreciserVisibility);
        select.addEventListener('blur', updatePreciserVisibility);
    }

    td._updatePreciserVisibility = updatePreciserVisibility;
    updatePreciserVisibility();
    return td;
}

const MAIL_PATTERN = /^[a-zA-Z0-9\-._]+@ac-montpellier\.fr$/;

function buildMailCell(record) {
    const td = document.createElement('td');
    td.className = 'mail-cell';

    const inner = document.createElement('div');
    inner.className = 'mail-cell-inner';
    td.appendChild(inner);

    let renderEdit;

    const renderDisplay = () => {
        inner.textContent = '';
        const email = sanitizeText(record.Mail || '');

        if (email) {
            const link = document.createElement('a');
            link.className = 'mail-link';
            link.href = 'mailto:' + email.replace(/[^\w.@+-]/g, '');
            link.textContent = email;
            link.title = email;
            inner.appendChild(link);
        } else {
            const empty = document.createElement('span');
            empty.className = 'mail-empty';
            empty.textContent = '—';
            inner.appendChild(empty);
        }

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'mail-edit-btn';
        editBtn.textContent = '✏️';
        editBtn.title = "Modifier l'adresse mail";
        editBtn.setAttribute('aria-label', "Modifier l'adresse mail");
        editBtn.addEventListener('click', renderEdit);
        inner.appendChild(editBtn);
    };

    renderEdit = () => {
        const previous = record.Mail !== null && record.Mail !== undefined ? String(record.Mail) : '';
        inner.textContent = '';

        const input = document.createElement('input');
        input.type = 'email';
        input.className = 'mail-edit-input';
        input.value = previous;

        let settled = false;
        const finish = (save) => {
            if (settled) return;
            settled = true;

            if (save) {
                const newValue = sanitizeText(input.value);
                if (newValue && !MAIL_PATTERN.test(newValue)) {
                    showToast('Adresse mail invalide.', 'error');
                } else if (newValue !== sanitizeText(previous)) {
                    record.Mail = newValue;
                    savePersonnelField(record.id, 'Mail', newValue, () => {
                        record.Mail = newValue;
                    });
                }
            }
            renderDisplay();
        };

        input.addEventListener('blur', () => finish(true));
        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                input.blur();
            } else if (evt.key === 'Escape') {
                evt.preventDefault();
                finish(false);
            }
        });

        inner.appendChild(input);
        input.focus();
        input.select();
    };

    renderDisplay();
    return td;
}

function buildEditableCell(record, field, type, options, inputId) {
    const td = document.createElement('td');
    const value = record[field];

    if (type === 'checkbox') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!value;
        input.addEventListener('change', () => {
            savePersonnelField(record.id, field, input.checked);
        });
        td.appendChild(input);
        return td;
    }

    if (type === 'select') {
        const select = document.createElement('select');
        (options || []).forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = opt;
            optionEl.textContent = opt;
            if (value === opt) optionEl.selected = true;
            select.appendChild(optionEl);
        });
        select.addEventListener('change', () => {
            savePersonnelField(record.id, field, select.value);
        });
        td.appendChild(select);
        return td;
    }

    const input = document.createElement('input');
    input.type = type === 'email' ? 'email' : 'text';
    input.value = value !== null && value !== undefined ? String(value) : '';
    if (inputId) input.id = inputId;

    input.addEventListener('change', () => {
        let newValue = sanitizeText(input.value);
        if (type === 'email' && newValue && !/^[a-zA-Z0-9\-._]+@ac-montpellier\.fr$/.test(newValue)) {
            showToast('Adresse mail invalide.', 'error');
            input.value = value !== null && value !== undefined ? String(value) : '';
            return;
        }
        savePersonnelField(record.id, field, newValue);
    });
    td.appendChild(input);
    return td;
}

function buildNiveauxCell(record) {
    const td = document.createElement('td');
    td.className = 'niveaux-cell';

    const inner = document.createElement('div');
    inner.className = 'niveaux-cell-inner';

    const currentValues = parseNiveaux(record.Niveau_x_);

    NIVEAUX_OPTIONS.forEach(niveau => {
        const label = document.createElement('label');
        label.className = 'niveau-checkbox';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = niveau;
        checkbox.checked = currentValues.includes(niveau);

        checkbox.addEventListener('change', () => {
            const updated = new Set(currentValues);
            if (checkbox.checked) {
                updated.add(niveau);
            } else {
                updated.delete(niveau);
            }
            const newList = NIVEAUX_OPTIONS.filter(n => updated.has(n));
            savePersonnelField(record.id, 'Niveau_x_', toChoiceListValue(newList), () => {
                record.Niveau_x_ = newList;
            });
        });

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + niveau));
        inner.appendChild(label);
    });

    td.appendChild(inner);
    return td;
}

function parseNiveaux(rawValue) {
    if (!rawValue) return [];
    if (Array.isArray(rawValue)) {
        return rawValue.filter(v => v !== 'L');
    }
    return String(rawValue).split(',').map(s => s.trim()).filter(Boolean);
}

async function savePersonnelField(personnelId, field, value, onSuccessLocal) {
    try {
        await grist.docApi.applyUserActions([
            ['UpdateRecord', 'Liste_PE', personnelId, { [field]: value }]
        ]);

        const record = state.personnels.find(p => p.id === personnelId);
        if (record) record[field] = value;
        if (onSuccessLocal) onSuccessLocal();

        showToast('Modification enregistrée.', 'success');
    } catch (err) {
        console.error(err);
        showToast("Erreur lors de l'enregistrement. Modification annulée.", 'error');
        renderDashboard();
    }
}

/* ==========================================================================
   « A quitté l'école » : retrait d'un enseignant (avec annulation possible)
   ========================================================================== */

async function handleQuitSchool(personnelRecord) {
    const previous = {
        UAI: personnelRecord.UAI,
        Fonction: personnelRecord.Fonction,
        Niveau_x_: personnelRecord.Niveau_x_,
        Retrait: personnelRecord.Retrait
    };
    const identity = getPersonnelIdentity(personnelRecord);

    try {
        await grist.docApi.applyUserActions([
            ['UpdateRecord', 'Liste_PE', personnelRecord.id, {
                UAI: 0,
                Fonction: '',
                Niveau_x_: ['L'],
                Retrait: todayDateEpochSeconds()
            }]
        ]);

        showUndoableToast(
            (identity || 'Enseignant') + ' retiré' + suffixeGenre(personnelRecord.Civilite)
                + " de l'école.",
            () => restoreTeacherAssignment(personnelRecord.id, previous, identity)
        );
        await loadAllData();
    } catch (err) {
        console.error(err);
        showToast("Erreur lors du retrait de l'enseignant.", 'error');
    }
}

async function restoreTeacherAssignment(personnelId, previous, identity) {
    const prevUai = getPersonnelEcoleRowId({ UAI: previous.UAI });

    try {
        await grist.docApi.applyUserActions([
            ['UpdateRecord', 'Liste_PE', personnelId, {
                UAI: prevUai !== null ? prevUai : 0,
                Fonction: previous.Fonction || '',
                Niveau_x_: toChoiceListRaw(previous.Niveau_x_),
                Retrait: parseDateEpochSeconds(previous.Retrait)
            }]
        ]);
        showToast('Retrait annulé' + (identity ? ' pour ' + identity : '') + '.', 'success');
    } catch (err) {
        console.error(err);
        showToast("Impossible d'annuler le retrait.", 'error');
    }

    await loadAllData();
}

/* ==========================================================================
   Surveillance RGPD : purge des enseignants retirés depuis trop longtemps.
   Logique partagée : objet global RgpdPurge (../shared/rgpd-purge.js).
   ========================================================================== */

const rgpdState = { candidates: [], busy: false };

function rgpdDataBundle() {
    return {
        listePe: state.personnels,
        formations: state.formations
    };
}

function computeRgpdResult() {
    if (typeof RgpdPurge === 'undefined') {
        console.warn('[RGPD] Module ../shared/rgpd-purge.js non chargé.');
        return { sufficientScope: false, visibleDepartementCount: 0, candidates: [] };
    }
    if (!state.relatedTablesLoaded) {
        console.warn("[RGPD] Table Formations non chargée : contrôle désactivé.");
        return { sufficientScope: false, visibleDepartementCount: 0, candidates: [] };
    }
    return RgpdPurge.computeCandidates(rgpdDataBundle());
}

function refreshRgpdBanner() {
    const notice = document.getElementById('conservation-check');
    const text = document.getElementById('conservation-check-text');
    if (!notice || !text) {
        console.warn('[RGPD] Élément #conservation-check introuvable dans le DOM.');
        return;
    }

    const result = computeRgpdResult();
    rgpdState.candidates = result.candidates;

    if (!result.candidates.length) {
        notice.classList.add('hidden');        return;
    }

    const n = result.candidates.length;
    text.textContent = n === 1
        ? '⚠️ Contrôle RGPD : 1 enseignant retiré depuis plus de 5 ans doit être purgé du fichier.'
        : '⚠️ Contrôle RGPD : ' + n + ' enseignants retirés depuis plus de 5 ans doivent être purgés du fichier.';
    notice.classList.remove('hidden');
}

function openRgpdModal() {
    const result = computeRgpdResult();
    const candidates = result.candidates;
    rgpdState.candidates = candidates;

    if (!candidates.length) {
        closeRgpdModal();
        refreshRgpdBanner();
        showToast('Aucun enseignant à purger.', 'success');
        return;
    }

    const intro = document.getElementById('conservation-modal-intro');
    const list = document.getElementById('conservation-modal-list');
    const confirmBtn = document.getElementById('conservation-confirm-btn');
    const totalRows = candidates.reduce((sum, c) => sum + c.totalRows, 0);

    intro.textContent = candidates.length === 1
        ? "1 enseignant est retiré depuis plus de 5 ans. Toutes les lignes le concernant (Formations, Liste_PE) seront supprimées :"
        : candidates.length + " enseignants sont retirés depuis plus de 5 ans. Toutes les lignes les concernant (Formations, Liste_PE) seront supprimées :";

    list.textContent = '';
    candidates.forEach(c => {
        const li = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = c.identity;
        const detail = document.createElement('span');
        detail.className = 'conservation-item-detail';
        detail.textContent = ' — retrait le ' + RgpdPurge.formatEpochDate(c.lastRetraitEpoch)
            + ' (' + c.daysSinceRetrait + ' jours) · '
            + c.totalRows + ' ligne' + (c.totalRows > 1 ? 's' : '')
            + ' (' + c.formationRowIds.length + ' Formations, '
            + c.listePeRowIds.length + ' Liste_PE)';
        li.append(name, detail);
        list.appendChild(li);
    });

    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Supprimer définitivement ('
        + totalRows + ' ligne' + (totalRows > 1 ? 's' : '') + ')';

    document.getElementById('conservation-modal-overlay').classList.remove('hidden');
    document.getElementById('conservation-cancel-btn').focus();
}

function closeRgpdModal() {
    document.getElementById('conservation-modal-overlay').classList.add('hidden');
}

async function confirmRgpdPurge() {
    if (rgpdState.busy) return;

    const actions = RgpdPurge.buildPurgeActions(rgpdState.candidates || []);
    if (!actions.length) {
        closeRgpdModal();
        return;
    }

    const totalRows = (rgpdState.candidates || []).reduce((sum, c) => sum + c.totalRows, 0);
    const confirmBtn = document.getElementById('conservation-confirm-btn');
    rgpdState.busy = true;
    confirmBtn.disabled = true;

    try {
        await grist.docApi.applyUserActions(actions);
        closeRgpdModal();
        showToast(totalRows + ' ligne' + (totalRows > 1 ? 's' : '')
            + ' supprimée' + (totalRows > 1 ? 's' : '') + ' (RGPD).', 'success');
        await loadAllData();
    } catch (err) {
        console.error(err);
        showToast('Erreur lors de la purge RGPD.', 'error');
        confirmBtn.disabled = false;
    } finally {
        rgpdState.busy = false;
    }
}

function attachRgpdListeners() {
    if (state.listenersAttached.rgpd) return;

    const reviewBtn = document.getElementById('conservation-review-btn');
    const overlay = document.getElementById('conservation-modal-overlay');
    const cancelBtn = document.getElementById('conservation-cancel-btn');
    const confirmBtn = document.getElementById('conservation-confirm-btn');

    reviewBtn.addEventListener('click', openRgpdModal);
    cancelBtn.addEventListener('click', closeRgpdModal);

    overlay.addEventListener('click', (evt) => {
        if (evt.target === overlay) closeRgpdModal();
    });

    document.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape' && !overlay.classList.contains('hidden')) {
            closeRgpdModal();
        }
    });

    confirmBtn.addEventListener('click', confirmRgpdPurge);

    state.listenersAttached.rgpd = true;
}

/* ==========================================================================
   « Ajouter un enseignant » : rattacher une personne existante à une école
   ========================================================================== */

const addTeacherState = {
    ecole: null,        // école cible (carte depuis laquelle on a cliqué)
    person: null,       // personne sélectionnée dans les résultats
    busy: false
};

// Libellé complet d'une école : « Nom, Adresse_2, Commune ».
function formatEcoleFull(ecole) {
    if (!ecole) return 'école inconnue';
    return [
        sanitizeText(ecole.Nom_etablissement || ''),
        sanitizeText(ecole.Adresse_2 || ''),
        sanitizeText(ecole.Nom_commune || '')
    ].filter(Boolean).join(', ') || 'école inconnue';
}

function getEcoleById(rowId) {
    return state.ecoles.find(e => e.id === rowId) || null;
}

// Personnes visibles, regroupées par ID_PE, avec leurs lignes de l'année
// courante. Une personne sans ID_PE est identifiée par sa ligne.
function buildPersonIndex() {
    const byKey = new Map();
    for (const record of state.personnels) {
        const idPe = sanitizeText(record.ID_PE || '');
        const key = idPe || ('row:' + record.id);
        let person = byKey.get(key);
        if (!person) {
            person = { key, idPe, rows: [], identity: '', mail: '', civilite: '' };
            byKey.set(key, person);
        }
        person.rows.push(record);
    }

    for (const person of byKey.values()) {
        // Identité prise sur la première ligne renseignée.
        for (const row of person.rows) {
            if (!person.identity) person.identity = getPersonnelIdentity(row);
            if (!person.mail) person.mail = sanitizeText(row.Mail || '');
            if (!person.civilite) person.civilite = sanitizeText(row.Civilite || '');
        }
        person.yearRows = person.rows.filter(r =>
            state.currentYear === null || getPersonnelSchoolYearStart(r) === state.currentYear);
        person.affectations = person.yearRows
            .filter(r => (getPersonnelEcoleRowId(r) || 0) > 0)
            .map(r => ({ row: r, ecole: getEcoleById(getPersonnelEcoleRowId(r)) }));
    }

    return byKey;
}

function searchPersons(query, excludeEcoleId) {
    const persons = buildPersonIndex();
    const scored = [];

    for (const person of persons.values()) {
        const nom = normalizeStr(person.rows[0].Nom || '');
        const prenom = normalizeStr(person.rows[0].Prenom || '');
        const idPe = normalizeStr(person.idPe);

        const rank = Math.min(
            ecoleMatchRank(nom, query) === -1 ? 99 : ecoleMatchRank(nom, query),
            ecoleMatchRank(prenom, query) === -1 ? 99 : ecoleMatchRank(prenom, query),
            ecoleMatchRank(idPe, query) === -1 ? 99 : ecoleMatchRank(idPe, query)
        );
        if (rank === 99) continue;

        // Déjà rattaché à l'école cible : rien à ajouter.
        if (person.affectations.some(a => a.row && getPersonnelEcoleRowId(a.row) === excludeEcoleId)) {
            continue;
        }

        scored.push({ person, rank, sortKey: nom + ' ' + prenom });
    }

    scored.sort((a, b) => (a.rank - b.rank) || a.sortKey.localeCompare(b.sortKey, 'fr'));
    return scored.slice(0, 30).map(x => x.person);
}

function showAddTeacherPanel(name) {
    document.querySelectorAll('#add-teacher-modal .add-teacher-panel').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.panel !== name);
    });
}

function openAddTeacherModal(ecole) {
    addTeacherState.ecole = ecole;
    addTeacherState.person = null;

    document.getElementById('add-teacher-ecole').textContent = 'École : ' + formatEcoleFull(ecole);
    const input = document.getElementById('add-teacher-search');
    input.value = '';
    document.getElementById('add-teacher-results').textContent = '';
    document.getElementById('add-teacher-empty').classList.add('hidden');

    showAddTeacherPanel('search');
    document.getElementById('add-teacher-overlay').classList.remove('hidden');
    input.focus();
}

function closeAddTeacherModal() {
    document.getElementById('add-teacher-overlay').classList.add('hidden');
    addTeacherState.ecole = null;
    addTeacherState.person = null;
}

function renderAddTeacherResults() {
    const query = normalizeStr(document.getElementById('add-teacher-search').value);
    const list = document.getElementById('add-teacher-results');
    const empty = document.getElementById('add-teacher-empty');
    list.textContent = '';

    if (!query) {
        empty.classList.add('hidden');
        return;
    }

    const persons = searchPersons(query, addTeacherState.ecole ? addTeacherState.ecole.id : 0);
    empty.classList.toggle('hidden', persons.length > 0);

    persons.forEach(person => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.setAttribute('role', 'option');

        const name = document.createElement('strong');
        name.textContent = person.identity || '(identité inconnue)';

        const meta = document.createElement('span');
        meta.className = 'add-teacher-result-meta';
        const affectations = person.affectations
            .map(a => formatEcoleFull(a.ecole))
            .filter(Boolean);
        meta.textContent = (person.idPe ? ' · ' + person.idPe : '')
            + ' · ' + (affectations.length
                ? affectations.join(' ; ')
                : 'aucune affectation');

        item.append(name, meta);
        item.addEventListener('click', () => openAddTeacherConfirm(person));
        list.appendChild(item);
    });
}

/**
 * Compose le texte de confirmation sans innerHTML.
 * Chaque partie est une chaîne, la clé 'br' pour un retour à la ligne,
 * ou { ecole: '…' } pour un nom d'établissement mis en avant.
 */
function renderConfirmText(target, parts) {
    target.textContent = '';
    parts.forEach(part => {
        if (part === 'br') {
            target.appendChild(document.createElement('br'));
        } else if (typeof part === 'string') {
            target.appendChild(document.createTextNode(part));
        } else if (part && part.ecole) {
            const strong = document.createElement('strong');
            strong.className = 'add-teacher-ecole-name';
            strong.textContent = part.ecole;
            target.appendChild(strong);
        }
    });
}

function openAddTeacherConfirm(person) {
    addTeacherState.person = person;

    const cible = addTeacherState.ecole;
    const identity = person.identity || 'cet enseignant';
    const textEl = document.getElementById('add-teacher-confirm-text');
    const listEl = document.getElementById('add-teacher-affectations');
    const actions = document.getElementById('add-teacher-confirm-actions');

    listEl.textContent = '';
    listEl.classList.add('hidden');
    actions.textContent = '';

    // Seul « Annuler » est secondaire ; toutes les autres actions sont
    // au même niveau d'importance.
    const addAction = (label, onClick, secondary) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.className = secondary ? 'secondary' : 'primary';
        btn.addEventListener('click', onClick);
        actions.appendChild(btn);
        return btn;
    };

    const cancel = () => showAddTeacherPanel('search');

    if (person.affectations.length === 0) {
        // Cas 1 : aucune affectation.
        renderConfirmText(textEl, [
            'Rattacher ' + identity + ' à',
            'br',
            { ecole: formatEcoleFull(cible) },
            ' ?'
        ]);
        addAction('Annuler', cancel, true);
        addAction('Confirmer', () => applyAffectations([cible.id]));

    } else if (person.affectations.length === 1) {
        // Cas 2 : une seule affectation existante.
        const actuelle = person.affectations[0];
        renderConfirmText(textEl, [
            identity + ' est actuellement rattaché' + suffixeGenre(person.civilite) + ' à',
            'br',
            { ecole: formatEcoleFull(actuelle.ecole) },
            'br',
            'souhaitez-vous conserver cette affectation ou la remplacer par',
            'br',
            { ecole: formatEcoleFull(cible) },
            '.'
        ]);
        addAction('Annuler', cancel, true);
        addAction('Remplacer l\'affectation', () => applyAffectations([cible.id]));
        addAction('Conserver les deux affectations',
            () => applyAffectations([getPersonnelEcoleRowId(actuelle.row), cible.id]));

    } else {
        // Cas 3 : plusieurs affectations — l'utilisateur choisit ce qu'il garde.
        renderConfirmText(textEl, [
            identity + ' a actuellement plusieurs affectations.',
            'br',
            'Veuillez sélectionner les affectations à conserver.'
        ]);
        listEl.classList.remove('hidden');

        const entries = person.affectations.map(a => ({
            ecoleId: getPersonnelEcoleRowId(a.row),
            label: formatEcoleFull(a.ecole),
            checked: true
        }));
        entries.push({ ecoleId: cible.id, label: formatEcoleFull(cible), checked: false });

        entries.forEach(entry => {
            const li = document.createElement('li');
            const label = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = entry.checked;
            cb.dataset.ecoleId = String(entry.ecoleId);
            const name = document.createElement('strong');
            name.className = 'add-teacher-ecole-name';
            name.textContent = entry.label;
            label.append(cb, name);
            li.appendChild(label);
            listEl.appendChild(li);
        });

        addAction('Annuler', cancel, true);
        addAction('Enregistrer', () => {
            const keep = Array.from(listEl.querySelectorAll('input:checked'))
                .map(cb => parseInt(cb.dataset.ecoleId, 10))
                .filter(Number.isFinite);
            applyAffectations(keep);
        });
    }

    showAddTeacherPanel('confirm');
}

/**
 * Aligne les affectations de l'année courante sur la liste d'écoles demandée.
 * Une affectation retirée dont une nouvelle prend la place voit simplement son
 * UAI réécrit (la ligne est déplacée) ; une affectation retirée sans
 * remplacement est détachée et datée, comme le bouton « Retirer de l'école ».
 */
async function applyAffectations(keepEcoleIds) {
    if (addTeacherState.busy) return;
    const person = addTeacherState.person;
    const cible = addTeacherState.ecole;
    if (!person || !cible) return;

    const keep = new Set(keepEcoleIds.filter(id => Number.isFinite(id) && id > 0));
    const current = new Map();
    person.affectations.forEach(a => current.set(getPersonnelEcoleRowId(a.row), a.row));

    const toRemove = [];
    for (const [ecoleId, row] of current) {
        if (!keep.has(ecoleId)) toRemove.push(row);
    }
    const toAdd = [];
    for (const ecoleId of keep) {
        if (!current.has(ecoleId)) toAdd.push(ecoleId);
    }

    if (!toRemove.length && !toAdd.length) {
        closeAddTeacherModal();
        return;
    }

    const actions = [];
    const anneeScolaire = person.yearRows.length
        ? person.yearRows[0].Annee_scolaire
        : (person.rows[0] && person.rows[0].Annee_scolaire);

    // Lignes détachées de l'année, réutilisables avant d'en créer une nouvelle.
    const reusable = person.yearRows.filter(r => (getPersonnelEcoleRowId(r) || 0) <= 0);

    for (const ecoleId of toAdd) {
        const moved = toRemove.shift();
        if (moved) {
            actions.push(['UpdateRecord', 'Liste_PE', moved.id, { UAI: ecoleId, Retrait: null }]);
            continue;
        }
        const recycled = reusable.shift();
        if (recycled) {
            actions.push(['UpdateRecord', 'Liste_PE', recycled.id, { UAI: ecoleId, Retrait: null }]);
            continue;
        }
        const source = person.yearRows[0] || person.rows[0];
        actions.push(['AddRecord', 'Liste_PE', null, {
            ID_PE: person.idPe,
            Civilite: source.Civilite || '',
            Nom: source.Nom || '',
            Prenom: source.Prenom || '',
            Mail: source.Mail || '',
            Annee_scolaire: anneeScolaire,
            UAI: ecoleId,
            Fonction: '',
            Quotite_de_service: source.Quotite_de_service || '',
            Retrait: null
        }]);
    }

    // Affectations retirées sans remplacement : détachées et datées.
    for (const row of toRemove) {
        actions.push(['UpdateRecord', 'Liste_PE', row.id, {
            UAI: 0,
            Fonction: '',
            Niveau_x_: ['L'],
            Retrait: todayDateEpochSeconds()
        }]);
    }

    addTeacherState.busy = true;
    try {
        await grist.docApi.applyUserActions(actions);
        showToast('Affectations mises à jour pour ' + (person.identity || 'l\'enseignant') + '.', 'success');
        closeAddTeacherModal();
        await loadAllData();
    } catch (err) {
        console.error('[Ajout enseignant] Échec :', err);
        showToast('Erreur lors de la mise à jour des affectations.', 'error');
    } finally {
        addTeacherState.busy = false;
    }
}

/* --------------------------------------------------------------------------
   Création d'une fiche enseignant
   -------------------------------------------------------------------------- */

const CREATE_MAIL_PATTERN = /^[^\W][a-zA-Z0-9\-._]+[^\W]@ac-montpellier\.fr$/;
const CREATE_ID_PE_PATTERN = /^[A-Za-z0-9-]+$/;

const DECHARGE_FIELDS = [
    { field: 'D_dir', label: 'Décharge de direction' },
    { field: 'D_synd_', label: 'Décharge syndicale' },
    { field: 'TP', label: 'Temps partiel' },
    { field: 'Autre', label: 'Autre (préciser)' }
];

// Majuscules sans accent ni caractère parasite (Nom / Prénom).
function toUpperNoAccent(value) {
    return sanitizeText(value)
        .normalize('NFD')
        .replace(new RegExp('[\u0300-\u036f]', 'g'), '')
        .toUpperCase()
        .replace(/[^A-Z \-']/g, '');
}

function fillSelect(select, options, selected) {
    select.textContent = '';
    options.forEach(value => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        if (value === selected) opt.selected = true;
        select.appendChild(opt);
    });
}

function setCreateEcole(ecole) {
    document.getElementById('create-ecole-id').value = ecole ? String(ecole.id) : '';
    document.getElementById('create-ecole-search').value = ecole ? formatEcoleFull(ecole) : '';
    document.getElementById('create-uai').value =
        ecole ? sanitizeText(ecole.Identifiant_de_l_etablissement || '') : '';
    document.getElementById('create-circonscription').value =
        ecole ? sanitizeText(ecole.Circonscription || '') : '';
    document.getElementById('create-ecole-results').textContent = '';
}

function buildCreateDecharges() {
    const container = document.getElementById('create-decharges');
    container.textContent = '';

    DECHARGE_FIELDS.forEach(({ field, label }) => {
        const row = document.createElement('div');
        row.className = 'create-decharge-row';

        const toggleLabel = document.createElement('label');
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.dataset.dechargeToggle = field;
        toggleLabel.append(toggle, document.createTextNode(' ' + label));

        const select = document.createElement('select');
        select.multiple = true;
        select.size = 4;
        select.dataset.dechargeDays = field;
        select.classList.add('hidden');
        fillSelect(select, DECHARGES_OPTIONS[field] || []);

        const preciser = document.createElement('input');
        preciser.type = 'text';
        preciser.id = 'create-preciser';
        preciser.placeholder = 'Préciser';
        preciser.classList.add('hidden');

        toggle.addEventListener('change', () => {
            select.classList.toggle('hidden', !toggle.checked);
            if (field === 'Autre') preciser.classList.toggle('hidden', !toggle.checked);
            if (!toggle.checked) {
                Array.from(select.options).forEach(o => { o.selected = false; });
                if (field === 'Autre') preciser.value = '';
            }
        });

        row.append(toggleLabel, select);
        if (field === 'Autre') row.appendChild(preciser);
        container.appendChild(row);
    });
}

function buildCreateNiveaux() {
    const container = document.getElementById('create-niveaux');
    container.textContent = '';
    NIVEAUX_OPTIONS.forEach(niveau => {
        const label = document.createElement('label');
        label.className = 'create-niveau';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = niveau;
        label.append(cb, document.createTextNode(' ' + niveau));
        container.appendChild(label);
    });
}

function openCreateTeacherForm() {
    fillSelect(document.getElementById('create-civilite'), ['Madame', 'Monsieur']);
    fillSelect(document.getElementById('create-fonction'), FONCTION_OPTIONS);
    fillSelect(document.getElementById('create-quotite'), ['50%', '75%', '80%', '100%'], '100%');

    ['create-nom', 'create-prenom', 'create-id-pe', 'create-mail'].forEach(id => {
        document.getElementById(id).value = '';
    });

    buildCreateDecharges();
    buildCreateNiveaux();
    setCreateEcole(addTeacherState.ecole);
    showCreateError('');

    showAddTeacherPanel('create');
    document.getElementById('create-nom').focus();
}

function showCreateError(message) {
    const el = document.getElementById('create-teacher-error');
    el.textContent = message;
    el.classList.toggle('hidden', !message);
}

function renderCreateEcoleResults() {
    const query = normalizeStr(document.getElementById('create-ecole-search').value);
    const list = document.getElementById('create-ecole-results');
    list.textContent = '';
    if (!query) return;

    rankedEcoleMatches(state.ecoles, query, 20).forEach(ecole => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.setAttribute('role', 'option');
        item.textContent = formatEcoleFull(ecole);
        item.addEventListener('click', () => setCreateEcole(ecole));
        list.appendChild(item);
    });
}

function collectCreateDecharges() {
    const values = {};
    let preciser = '';
    let error = '';

    DECHARGE_FIELDS.forEach(({ field, label }) => {
        const toggle = document.querySelector('[data-decharge-toggle="' + field + '"]');
        const select = document.querySelector('[data-decharge-days="' + field + '"]');
        if (!toggle || !toggle.checked) {
            values[field] = ['L'];
            return;
        }
        const days = Array.from(select.selectedOptions).map(o => o.value).filter(Boolean);
        if (!days.length && !error) {
            error = 'Sélectionnez au moins un jour pour « ' + label +' ».';
        }
        values[field] = ['L', ...days];
        if (field === 'Autre') {
            preciser = sanitizeText(document.getElementById('create-preciser').value);
        }
    });

    return { values, preciser, error };
}

async function submitCreateTeacher() {
    if (addTeacherState.busy) return;

    const civilite = document.getElementById('create-civilite').value;
    const nom = toUpperNoAccent(document.getElementById('create-nom').value);
    const prenom = toUpperNoAccent(document.getElementById('create-prenom').value);
    const idPe = sanitizeText(document.getElementById('create-id-pe').value);
    const mail = sanitizeText(document.getElementById('create-mail').value);
    const fonction = document.getElementById('create-fonction').value;
    const quotite = document.getElementById('create-quotite').value;
    const ecoleId = parseInt(document.getElementById('create-ecole-id').value, 10);

    document.getElementById('create-nom').value = nom;
    document.getElementById('create-prenom').value = prenom;

    if (!civilite || !nom || !prenom || !idPe || !fonction || !quotite || !Number.isFinite(ecoleId)) {
        showCreateError('Civilité, nom, prénom, identifiant académique, école, fonction et quotité sont obligatoires.');
        return;
    }
    if (!CREATE_ID_PE_PATTERN.test(idPe)) {
        showCreateError('L\'identifiant académique doit être alphanumérique (tiret accepté, sans espace ni accent).');
        return;
    }
    if (mail && !CREATE_MAIL_PATTERN.test(mail)) {
        showCreateError('Adresse mail invalide (attendu : …@ac-montpellier.fr).');
        return;
    }

    const decharges = collectCreateDecharges();
    if (decharges.error) {
        showCreateError(decharges.error);
        return;
    }

    const niveaux = Array.from(document.querySelectorAll('#create-niveaux input:checked'))
        .map(cb => cb.value);

    const anneeScolaire = state.currentYear !== null
        ? state.currentYear + '-' + (state.currentYear + 1)
        : '';

    const fields = {
        ID_PE: idPe,
        Civilite: civilite,
        Nom: nom,
        Prenom: prenom,
        Mail: mail,
        Annee_scolaire: anneeScolaire,
        UAI: ecoleId,
        Fonction: fonction,
        Quotite_de_service: quotite,
        Niveau_x_: ['L', ...niveaux],
        Preciser: decharges.preciser,
        Retrait: null
    };
    Object.assign(fields, decharges.values);

    addTeacherState.busy = true;
    showCreateError('');
    try {
        await grist.docApi.applyUserActions([['AddRecord', 'Liste_PE', null, fields]]);
        showToast('Fiche créée pour ' + [civilite, prenom, nom].filter(Boolean).join(' ') + '.', 'success');
        closeAddTeacherModal();
        await loadAllData();
    } catch (err) {
        console.error('[Création fiche] Échec :', err);
        showCreateError('Erreur lors de la création de la fiche.');
    } finally {
        addTeacherState.busy = false;
    }
}

function attachAddTeacherListeners() {
    if (state.listenersAttached.addTeacher) return;

    const overlay = document.getElementById('add-teacher-overlay');
    const input = document.getElementById('add-teacher-search');
    if (!overlay || !input) return;

    input.addEventListener('input', renderAddTeacherResults);

    overlay.querySelectorAll('[data-add-teacher-close]').forEach(btn => {
        btn.addEventListener('click', closeAddTeacherModal);
    });

    overlay.addEventListener('click', evt => {
        if (evt.target === overlay) closeAddTeacherModal();
    });

    document.addEventListener('keydown', evt => {
        if (evt.key === 'Escape' && !overlay.classList.contains('hidden')) {
            closeAddTeacherModal();
        }
    });

    document.getElementById('add-teacher-notfound-link')
        .addEventListener('click', () => showAddTeacherPanel('notfound'));

    document.getElementById('add-teacher-create-btn')
        .addEventListener('click', openCreateTeacherForm);

    document.getElementById('create-ecole-search')
        .addEventListener('input', renderCreateEcoleResults);
    document.getElementById('create-teacher-submit')
        .addEventListener('click', submitCreateTeacher);

    ['create-nom', 'create-prenom'].forEach(id => {
        const input = document.getElementById(id);
        input.addEventListener('blur', () => { input.value = toUpperNoAccent(input.value); });
    });

    state.listenersAttached.addTeacher = true;
}

function openChangeSchoolModal(personnelRecord) {
    editingState.currentSchoolChangeRecord = personnelRecord;

    const overlay = document.getElementById('modal-overlay');
    const nameEl = document.getElementById('modal-teacher-name');
    const input = document.getElementById('modal-search-input');
    const resultsBox = document.getElementById('modal-search-results');
    const selectedDisplay = document.getElementById('modal-selected-display');
    const selectedUaiField = document.getElementById('modal-selected-uai');
    const confirmBtn = document.getElementById('modal-confirm-btn');

    nameEl.textContent = 'Enseignant concerné : ' +
        sanitizeText(personnelRecord.Civilite || '') + ' ' +
        sanitizeText(personnelRecord.Prenom || '') + ' ' +
        sanitizeText(personnelRecord.Nom || '');

    input.value = '';
    resultsBox.innerHTML = '';
    resultsBox.classList.add('hidden');
    selectedDisplay.classList.add('hidden');
    selectedDisplay.textContent = '';
    selectedUaiField.value = '';
    confirmBtn.disabled = true;

    overlay.classList.remove('hidden');
    input.focus();
}

function closeChangeSchoolModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    editingState.currentSchoolChangeRecord = null;
}

function attachModalListeners() {
    if (state.listenersAttached.modal) return;

    const input = document.getElementById('modal-search-input');
    const resultsBox = document.getElementById('modal-search-results');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const selectedDisplay = document.getElementById('modal-selected-display');
    const selectedUaiField = document.getElementById('modal-selected-uai');
    const overlay = document.getElementById('modal-overlay');
    let modalActiveIndex = -1;

    const selectModalEcole = (e) => {
        selectedUaiField.value = String(e.id);
        selectedDisplay.textContent = sanitizeText(e.Commune_Nom || '');
        selectedDisplay.classList.remove('hidden');
        resultsBox.classList.add('hidden');
        input.value = '';
        confirmBtn.disabled = false;
    };

    input.addEventListener('input', () => {
        const query = normalizeStr(input.value);
        resultsBox.innerHTML = '';
        modalActiveIndex = -1;

        if (!query) {
            resultsBox.classList.add('hidden');
            return;
        }

        const matches = rankedEcoleMatches(state.ecoles, query, 30);

        if (!matches.length) {
            resultsBox.classList.add('hidden');
            return;
        }

        matches.forEach(e => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.setAttribute('role', 'option');
            item.textContent = sanitizeText(e.Commune_Nom || e.Nom_etablissement || '');
            item.dataset.ecoleId = String(e.id);
            item.addEventListener('click', () => selectModalEcole(e));
            resultsBox.appendChild(item);
        });

        // Premier résultat sélectionné par défaut (validable par Entrée).
        modalActiveIndex = 0;
        const firstItem = resultsBox.querySelector('.search-result-item');
        if (firstItem) firstItem.classList.add('active');

        resultsBox.classList.remove('hidden');
    });

    input.addEventListener('keydown', (evt) => {
        const items = Array.from(resultsBox.querySelectorAll('.search-result-item'));
        if (!items.length || resultsBox.classList.contains('hidden')) return;

        if (evt.key === 'ArrowDown') {
            evt.preventDefault();
            modalActiveIndex = Math.min(modalActiveIndex + 1, items.length - 1);
            updateActiveItem(items, modalActiveIndex);
        } else if (evt.key === 'ArrowUp') {
            evt.preventDefault();
            modalActiveIndex = Math.max(modalActiveIndex - 1, 0);
            updateActiveItem(items, modalActiveIndex);
        } else if (evt.key === 'Enter') {
            evt.preventDefault();
            const item = items[modalActiveIndex] || items[0];
            const ecole = item && state.ecoles.find(x => x.id === parseInt(item.dataset.ecoleId, 10));
            if (ecole) selectModalEcole(ecole);
        } else if (evt.key === 'Escape') {
            evt.stopPropagation();
            resultsBox.classList.add('hidden');
        }
    });

    document.addEventListener('click', (evt) => {
        if (!resultsBox.contains(evt.target) && evt.target !== input) {
            resultsBox.classList.add('hidden');
        }
    });

    cancelBtn.addEventListener('click', closeChangeSchoolModal);

    overlay.addEventListener('click', (evt) => {
        if (evt.target === overlay) closeChangeSchoolModal();
    });

    document.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape' && !overlay.classList.contains('hidden')) {
            closeChangeSchoolModal();
        }
    });

    confirmBtn.addEventListener('click', async () => {
        const newEcoleRowId = parseInt(selectedUaiField.value, 10);
        const personnelRecord = editingState.currentSchoolChangeRecord;

        if (!Number.isFinite(newEcoleRowId) || !personnelRecord) {
            showToast('Veuillez sélectionner un établissement.', 'error');
            return;
        }

        confirmBtn.disabled = true;

        try {
            await grist.docApi.applyUserActions([
                ['UpdateRecord', 'Liste_PE', personnelRecord.id, { 'UAI': newEcoleRowId }]
            ]);

            showToast('Établissement modifié avec succès.', 'success');
            closeChangeSchoolModal();
            await loadAllData();
        } catch (err) {
            console.error(err);
            showToast("Erreur lors du changement d'établissement.", 'error');
            confirmBtn.disabled = false;
        }
    });

    state.listenersAttached.modal = true;
}

document.addEventListener('DOMContentLoaded', () => {
    attachModalListeners();
    initGrist();
});