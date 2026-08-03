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
        search: false,
        collapse: false,
        modal: false
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
    try {
        showStatus('Chargement des données...', false);

        const ecolesData = await grist.docApi.fetchTable('Ecoles');
        const personnelsData = await grist.docApi.fetchTable('Liste_PE');

        state.ecoles = tableToRecords(ecolesData);
        state.personnels = tableToRecords(personnelsData);

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
        '<th>Quotité</th><th>Décharge\r\nDir.</th><th>TP</th><th>Décharge\r\nsynd.</th><th>Autre</th>' +
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

    // --- LIGNE 3 : BOUTON ACTION ---
    const trNiveaux = document.createElement('tr');
    trNiveaux.dataset.personnelId = String(p.id);
    trNiveaux.className = 'action-row';
    trNiveaux.style.borderBottom = '2px solid #ccc'; // Sépare nettement chaque enseignant

    const actionsTd = document.createElement('td');
    actionsTd.colSpan = 10;
    actionsTd.className = 'action-cell';
    const changeBtn = document.createElement('button');
    changeBtn.type = 'button';
    changeBtn.className = 'change-school-btn';
    changeBtn.textContent = "Changer d'établissement";
    bindChangeSchoolTooltip(changeBtn, p);
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
        if (left + box.width > vw - MARGIN) left = vw - MARGIN - box.width;
        if (left < MARGIN) left = MARGIN;

        select.style.top = Math.round(top) + 'px';
        select.style.left = Math.round(left) + 'px';
        select.style.minWidth = Math.round(anchor.width) + 'px';

        if (closeButton) {
            const buttonSize = 18;
            closeButton.style.top = Math.round(top - 8) + 'px';
            closeButton.style.left = Math.round(left + box.width - buttonSize - 4) + 'px';
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

    state.listenersAttached.modal = true;
}

document.addEventListener('DOMContentLoaded', () => {
    attachModalListeners();
    initGrist();
});