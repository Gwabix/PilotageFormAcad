'use strict';

const state = {
    ecoles: [],
    personnels: [],
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
        search: false
    }
};

const REQUIRED_ECOLE_FIELDS = [
    'Nom_etablissement', 'Adresse_2', 'Code_postal', 'Nom_commune',
    'Libelle_departement', 'Circonscription', 'Mail', 'Telephone', 'Commune_Nom'
];

const REQUIRED_PERSONNEL_FIELDS = [
    'Civilite', 'Nom', 'Prenom', 'Mail', 'Fonction', 'Quotite_de_service'
];

const SCHOOL_YEAR_FIELDS = ['Annee_scolaire'];

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

async function loadAllData() {
    console.log('Colonnes Ecoles :', Object.keys(state.ecoles[0] || {}));
    console.log('Colonnes Liste_PE :', Object.keys(state.personnels[0] || {}));
    const tables = await grist.docApi.fetchTable('_grist_Tables');
    console.log('IDs de tables réels :', tables.tableId);
    try {
        showStatus('Chargement des données...', false);

        const ecolesData = await grist.docApi.fetchTable('Ecoles');
        const personnelsData = await grist.docApi.fetchTable('Liste_PE');

        state.ecoles = tableToRecords(ecolesData);
        state.personnels = tableToRecords(personnelsData);

        // Récupération dynamique des options des colonnes Choice / ChoiceList
        const [dynamicNiveaux, dynamicFonctions, dDir, dTP, dSynd, dAutre] = await Promise.all([
            fetchColumnChoices('Liste_PE', 'Niveau_x_'),
            fetchColumnChoices('Liste_PE', 'Fonction'),
            fetchColumnChoices('Liste_PE', 'D_dir'),
            fetchColumnChoices('Liste_PE', 'TP'),
            fetchColumnChoices('Liste_PE', 'D_synd_'),
            fetchColumnChoices('Liste_PE', 'Autre')
        ]);

        NIVEAUX_OPTIONS = dynamicNiveaux.length > 0 ? dynamicNiveaux : ['TPS', 'PS', 'MS', 'GS', 'CP', 'CE1', 'CE2', 'CM1', 'CM2', 'ULIS', 'Autre'];
        FONCTION_OPTIONS = dynamicFonctions.length > 0 ? dynamicFonctions : ['Directeur(trice)', 'Adjoint(e)', 'TR', 'Poste partagé', 'Ulis', 'UPE2A', 'ASH', 'PES'];

        const defaultJours = ['Lundi', 'Mardi', 'Jeudi', 'Vendredi'];
        DECHARGES_OPTIONS = {
            D_dir: dDir.length > 0 ? dDir : defaultJours,
            TP: dTP.length > 0 ? dTP : defaultJours,
            D_synd_: dSynd.length > 0 ? dSynd : defaultJours,
            Autre: dAutre.length > 0 ? dAutre : defaultJours
        };

        validateEcolesFields(state.ecoles);
        validatePersonnelsFields(state.personnels);

        populateYearOptions();
        populateDepartementFilter();
        populateCirconscriptionFilter();
        attachFilterListeners();
        attachSearchListener();

        renderDashboard();
        hideStatus();
    } catch (err) {
        console.error(err);
        showStatus('Erreur lors du chargement des données. Vérifiez la configuration des tables.', true);
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

function getYearFilteredPersonnels() {
    return state.personnels.filter(record => {
        if (state.currentYear === null) return true;
        return getPersonnelSchoolYearStart(record) === state.currentYear;
    });
}

function getPersonnelEcoleRowId(record) {
    const values = flattenRecordValue(record.UAI);
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
}

function getYearScopedEcoles() {
    const eligibleRowIds = new Set();

    getYearFilteredPersonnels().forEach(record => {
        const rowId = getPersonnelEcoleRowId(record);
        if (rowId !== null) eligibleRowIds.add(rowId);
    });

    return state.ecoles.filter(ecole => eligibleRowIds.has(ecole.id));
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
    return getYearFilteredPersonnels().filter(record => getPersonnelEcoleRowId(record) === ecole.id);
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

        const matches = getFilteredEcoles()
            .filter(e => normalizeStr(e.Commune_Nom || '').includes(query))
            .slice(0, 30);

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

        resultsBox.classList.remove('hidden');
    });

    input.addEventListener('keydown', (evt) => {
        const items = Array.from(resultsBox.querySelectorAll('.search-result-item'));
        if (!items.length) return;

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
        '<thead><tr>' +
        '<th>Civilité</th><th>Nom</th><th>Prénom</th><th>Mail</th><th>Fonction</th>' +
        '<th>Quotité</th><th>Dir.</th><th>TP</th><th>Décharge synd.</th><th>Autre</th>' +
        '</tr></thead>';

    const tbody = document.createElement('tbody');
    personnels
        .sort((a, b) => String(a.Nom || '').localeCompare(String(b.Nom || ''), 'fr'))
        .forEach(p => {
            tbody.appendChild(buildPersonnelRow(p, ecole.id));
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

async function fetchColumnChoices(tableName, colId) {
    try {
        // 1. Récupérer l'identifiant de la table ciblé
        const tables = await grist.docApi.fetchTable('_grist_Tables');
        const tableIndex = tables.tableId.indexOf(tableName);
        if (tableIndex === -1) return [];
        const tableRef = tables.id[tableIndex];

        // 2. Récupérer les métadonnées des colonnes
        const columns = await grist.docApi.fetchTable('_grist_Tables_column');

        // 3. Trouver la colonne qui appartient à notre table et qui a le bon colId
        for (let i = 0; i < columns.id.length; i++) {
            if (columns.parentId[i] === tableRef && columns.colId[i] === colId) {
                const widgetOptionsStr = columns.widgetOptions[i];
                if (widgetOptionsStr) {
                    const options = JSON.parse(widgetOptionsStr);
                    if (Array.isArray(options.choices)) {
                        return options.choices;
                    }
                }
                break;
            }
        }
    } catch (err) {
        console.error(`Erreur lors du chargement des choix pour la colonne ${colId}:`, err);
    }
    return [];
}

const editingState = {
    currentSchoolChangeRecord: null
};

function buildPersonnelRow(p, ecoleId) {
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
    trMain.appendChild(buildEditableCell(p, 'Nom', 'text'));
    trMain.appendChild(buildEditableCell(p, 'Prenom', 'text'));
    trMain.appendChild(buildEditableCell(p, 'Mail', 'email'));
    trMain.appendChild(buildEditableCell(p, 'Fonction', 'select', FONCTION_OPTIONS));
    trMain.appendChild(buildEditableCell(p, 'Quotite_de_service', 'select', ['50%', '75%', '80%', '100%']));

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

    // --- LIGNE 2 : SÉLECTION DES JOURS DE DÉCHARGES (CONDITIONNELLE) ---
    const trDecharges = document.createElement('tr');
    trDecharges.dataset.personnelId = String(p.id);
    trDecharges.className = 'decharges-row';

    // Espace vide sous Civilité -> Quotité (6 colonnes fusionnées)
    const tdEmpty = document.createElement('td');
    tdEmpty.colSpan = 6;
    trDecharges.appendChild(tdEmpty);

    // Création des cellules de sélection des jours ("Lundi", "Mardi", "Jeudi", "Vendredi")
    const cellDaysDir = buildDechargeSelectCell(p, 'D_dir', DECHARGES_OPTIONS.D_dir);
    const cellDaysTP = buildDechargeSelectCell(p, 'TP', DECHARGES_OPTIONS.TP);
    const cellDaysSynd = buildDechargeSelectCell(p, 'D_synd_', DECHARGES_OPTIONS.D_synd_);
    const cellDaysAutre = buildDechargeSelectCell(p, 'Autre', DECHARGES_OPTIONS.Autre);
    const cellPreciser = buildPreciserCell(p);

    trDecharges.append(cellDaysDir, cellDaysTP, cellDaysSynd, cellDaysAutre, cellPreciser);

    // Met à jour la visibilité globale de la Ligne 2 et de chaque cellule de jours
    const updateDechargesVisibility = () => {
        const anyChecked = triggerDir.input.checked || triggerTP.input.checked || triggerSynd.input.checked || triggerAutre.input.checked;
        trDecharges.style.display = anyChecked ? '' : 'none';

        cellDaysDir.style.visibility = triggerDir.input.checked ? 'visible' : 'hidden';
        cellDaysTP.style.visibility = triggerTP.input.checked ? 'visible' : 'hidden';
        cellDaysSynd.style.visibility = triggerSynd.input.checked ? 'visible' : 'hidden';
        cellDaysAutre.style.visibility = triggerAutre.input.checked ? 'visible' : 'hidden';
        cellPreciser.style.visibility = triggerAutre.input.checked ? 'visible' : 'hidden';
    };

    updateDechargesVisibility();

    // Écouteur sur les cases de la ligne 1
    const setupTriggerListener = (trigger, field, cellDays) => {
        trigger.input.addEventListener('change', () => {
            if (!trigger.input.checked) {
                const select = cellDays.querySelector('select');
                if (select) {
                    Array.from(select.options).forEach(opt => { opt.selected = false; });
                    select.size = 1;
                }
                savePersonnelField(p.id, field, toChoiceListValue([]), () => {
                    p[field] = '';
                });
            }
            updateDechargesVisibility();
        });
    };

    setupTriggerListener(triggerDir, 'D_dir', cellDaysDir);
    setupTriggerListener(triggerTP, 'TP', cellDaysTP);
    setupTriggerListener(triggerSynd, 'D_synd_', cellDaysSynd);
    setupTriggerListener(triggerAutre, 'Autre', cellDaysAutre);
    setupTriggerListener(triggerAutre, 'Preciser', cellPreciser);

    // --- LIGNE 3 : NIVEAUX (NOWRAP) & BOUTON ACTION ---
    const trNiveaux = document.createElement('tr');
    trNiveaux.dataset.personnelId = String(p.id);
    trNiveaux.className = 'niveaux-row';
    trNiveaux.style.borderBottom = '2px solid #ccc'; // Sépare nettement chaque enseignant

    const tdNiveaux = buildNiveauxCell(p);
    tdNiveaux.colSpan = 9;
    tdNiveaux.style.whiteSpace = 'nowrap';
    tdNiveaux.style.overflowX = 'auto';
    trNiveaux.appendChild(tdNiveaux);

    const actionsTd = document.createElement('td');
    const changeBtn = document.createElement('button');
    changeBtn.type = 'button';
    changeBtn.className = 'change-school-btn';
    changeBtn.textContent = "Changer\r\nd'établissement";
    changeBtn.addEventListener('click', () => openChangeSchoolModal(p));
    actionsTd.appendChild(changeBtn);
    trNiveaux.appendChild(actionsTd);

    fragment.append(trMain, trDecharges, trNiveaux);
    return fragment;
}

function toChoiceListValue(values) {
    const clean = Array.isArray(values) ? values.filter(v => v !== null && v !== undefined && v !== '') : [];
    return ['L', ...clean];
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

    const currentValues = parseNiveaux(record[field]);

    options.forEach(jour => {
        const opt = document.createElement('option');
        opt.value = jour;
        opt.textContent = jour;
        opt.selected = currentValues.includes(jour);
        select.appendChild(opt);
    });

    const collapsedSize = () => {
        const selectedCount = Array.from(select.selectedOptions).length;
        return Math.max(1, selectedCount);
    };

    select.size = collapsedSize();

    select.addEventListener('mousedown', (evt) => {
        if (evt.target.tagName !== 'OPTION') return;
        evt.preventDefault();

        const option = evt.target;
        option.selected = !option.selected;

        select.dispatchEvent(new Event('change'));
    });

    select.addEventListener('focus', () => {
        select.size = Math.min(options.length, 8);
        select.classList.add('expanded');
    });

    select.addEventListener('blur', () => {
        select.size = collapsedSize();
        select.classList.remove('expanded');
    });

    select.addEventListener('change', () => {
        const selectedValues = Array.from(select.selectedOptions).map(o => o.value);
        const orderedValues = options.filter(o => selectedValues.includes(o));

        select.size = select.classList.contains('expanded')
            ? Math.min(options.length, 8)
            : Math.max(1, orderedValues.length);

        savePersonnelField(record.id, field, toChoiceListValue(orderedValues), () => {
            record[field] = orderedValues.join(', ');
        });
    });

    td.appendChild(select);
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

function buildPreciserCell(p) {
    const inputId = 'preciser-input-' + String(p.id);

    const label = document.createElement('label');
    label.setAttribute('for', inputId);
    label.textContent = 'Préciser';
    label.className = 'preciser-label';

    const td = buildEditableCell(p, 'Preciser', 'text', null, inputId);
    td.classList.add('preciser-cell');
    td.insertBefore(label, td.firstChild);

    return td;
}

function buildNiveauxCell(record) {
    const td = document.createElement('td');
    td.className = 'niveaux-cell';

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
            const newValue = newList.join(', ');
            savePersonnelField(record.id, 'Niveau_x_', newValue, () => {
                record.Niveau_x_ = newValue;
            });
        });

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + niveau));
        td.appendChild(label);
    });

    return td;
}

function parseNiveaux(rawValue) {
    if (!rawValue) return [];
    if (Array.isArray(rawValue)) return rawValue;
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
    const input = document.getElementById('modal-search-input');
    const resultsBox = document.getElementById('modal-search-results');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const selectedDisplay = document.getElementById('modal-selected-display');
    const selectedUaiField = document.getElementById('modal-selected-uai');
    const overlay = document.getElementById('modal-overlay');

    input.addEventListener('input', () => {
        const query = normalizeStr(input.value);
        resultsBox.innerHTML = '';

        if (!query) {
            resultsBox.classList.add('hidden');
            return;
        }

        const matches = state.ecoles
            .filter(e => normalizeStr(e.Commune_Nom || '').includes(query))
            .sort((a, b) => String(a.Commune_Nom || '').localeCompare(String(b.Commune_Nom || ''), 'fr'))
            .slice(0, 30);

        if (!matches.length) {
            resultsBox.classList.add('hidden');
            return;
        }

        matches.forEach(e => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.setAttribute('role', 'option');
            item.textContent = sanitizeText(e.Commune_Nom || e.Nom_etablissement || '');
            item.addEventListener('click', () => {
                selectedUaiField.value = String(e.id);
                selectedDisplay.textContent = sanitizeText(e.Commune_Nom || '');
                selectedDisplay.classList.remove('hidden');
                resultsBox.classList.add('hidden');
                input.value = '';
                confirmBtn.disabled = false;
            });
            resultsBox.appendChild(item);
        });

        resultsBox.classList.remove('hidden');
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
}

document.addEventListener('DOMContentLoaded', () => {
    attachModalListeners();
    initGrist();
});