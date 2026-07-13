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
    personnelFieldMap: {}
};

const REQUIRED_ECOLE_FIELDS = [
    'Nom_etablissement', 'Adresse_2', 'Code_postal', 'Nom_commune',
    'Libelle_departement', 'Circonscription', 'Mail', 'Telephone', 'Commune_Nom'
];

const REQUIRED_PERSONNEL_FIELDS = [
    'Civilite', 'Nom', 'Prenom', 'Mail', 'Fonction', 'Quotite_de_service'
];

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
    try {
        showStatus('Chargement des données...', false);

        const ecolesData = await grist.docApi.fetchTable('Ecoles');
        const personnelsData = await grist.docApi.fetchTable('Liste_PE');

        state.ecoles = tableToRecords(ecolesData);
        state.personnels = tableToRecords(personnelsData);

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
    const currentSchoolYear = getCurrentSchoolYear();
    const years = [];
    for (let offset = -1; offset <= 1; offset++) {
        const startY = currentSchoolYear.startYear + offset;
        years.push({ startYear: startY, label: startY + '-' + (startY + 1) });
    }
    yearSelect.innerHTML = '';
    years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = String(y.startYear);
        opt.textContent = y.label;
        if (y.startYear === currentSchoolYear.startYear) opt.selected = true;
        yearSelect.appendChild(opt);
    });
    state.currentYear = currentSchoolYear.startYear;
    yearSelect.addEventListener('change', () => {
        state.currentYear = parseInt(yearSelect.value, 10);
        renderDashboard();
    });
}

function getCurrentSchoolYear() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    return { startYear: month >= 8 ? year : year - 1 };
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
    const values = getUniqueValues(state.ecoles, 'Libelle_departement');
    const wrapper = document.getElementById('filter-departement-wrapper');
    const select = document.getElementById('filter-departement');

    if (values.length <= 1) {
        wrapper.classList.add('hidden');
        state.currentDepartement = values[0] || null;
        return;
    }

    wrapper.classList.remove('hidden');
    select.innerHTML = '<option value="">Tous</option>';
    values.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    });
    state.currentDepartement = null;
}

function populateCirconscriptionFilter() {
    const relevant = state.currentDepartement
        ? state.ecoles.filter(e => e.Libelle_departement === state.currentDepartement)
        : state.ecoles;

    const values = getUniqueValues(relevant, 'Circonscription');
    const wrapper = document.getElementById('filter-circonscription-wrapper');
    const select = document.getElementById('filter-circonscription');

    if (values.length <= 1) {
        wrapper.classList.add('hidden');
        state.currentCirconscription = values[0] || null;
        return;
    }

    wrapper.classList.remove('hidden');
    select.innerHTML = '<option value="">Toutes</option>';
    values.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    });
    state.currentCirconscription = null;
}

function attachFilterListeners() {
    const depSelect = document.getElementById('filter-departement');
    const circSelect = document.getElementById('filter-circonscription');

    depSelect.addEventListener('change', () => {
        state.currentDepartement = depSelect.value || null;
        populateCirconscriptionFilter();
        attachCirconscriptionListenerOnly();
        renderDashboard();
    });

    circSelect.addEventListener('change', () => {
        state.currentCirconscription = circSelect.value || null;
        renderDashboard();
    });
}

function attachCirconscriptionListenerOnly() {
    const circSelect = document.getElementById('filter-circonscription');
    circSelect.addEventListener('change', () => {
        state.currentCirconscription = circSelect.value || null;
        renderDashboard();
    });
}

function getFilteredEcoles() {
    return state.ecoles.filter(e => {
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

function getPersonnelsForEcole(ecoleId) {
    return state.personnels.filter(p => {
        const link = p.Ecoles || p.Ecole || p.Etablissement;
        if (Array.isArray(link)) return link.includes(ecoleId);
        return link === ecoleId;
    });
}

function attachSearchListener() {
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
}

function updateActiveItem(items, index) {
    items.forEach((it, i) => it.classList.toggle('active', i === index));
    if (items[index]) items[index].scrollIntoView({ block: 'nearest' });
}

function selectSearchResult(ecoleId) {
    const ecole = state.ecoles.find(e => e.id === ecoleId);
    if (!ecole) return;

    if (state.currentDepartement && ecole.Libelle_departement !== state.currentDepartement) {
        const depSelect = document.getElementById('filter-departement');
        if (!depSelect.classList.contains('hidden')) {
            depSelect.value = ecole.Libelle_departement;
            state.currentDepartement = ecole.Libelle_departement;
            populateCirconscriptionFilter();
            attachCirconscriptionListenerOnly();
        }
    }
    if (state.currentCirconscription && ecole.Circonscription !== state.currentCirconscription) {
        const circSelect = document.getElementById('filter-circonscription');
        if (!circSelect.classList.contains('hidden')) {
            circSelect.value = ecole.Circonscription;
            state.currentCirconscription = ecole.Circonscription;
        }
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
    const filtered = getFilteredEcoles();

    if (!filtered.length) {
        container.innerHTML = '<div class="no-results">Aucune école ne correspond aux filtres sélectionnés.</div>';
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
    const personnels = getPersonnelsForEcole(ecole.id);

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
        '<th>Préciser</th><th>Niveaux</th><th></th>' +
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

const NIVEAUX_OPTIONS = [
    'TPS', 'PS', 'MS', 'GS', 'CP', 'CE1', 'CE2', 'CM1', 'CM2', 'ULIS', 'Autre'
];

const editingState = {
    currentSchoolChangeRecord: null
};

function buildPersonnelRow(p, ecoleId) {
    const tr = document.createElement('tr');
    tr.dataset.personnelId = String(p.id);

    tr.appendChild(buildEditableCell(p, 'Civilite', 'select', ['M.', 'Mme']));
    tr.appendChild(buildEditableCell(p, 'Nom', 'text'));
    tr.appendChild(buildEditableCell(p, 'Prenom', 'text'));
    tr.appendChild(buildEditableCell(p, 'Mail', 'email'));
    tr.appendChild(buildEditableCell(p, 'Fonction', 'text'));
    tr.appendChild(buildEditableCell(p, 'Quotite_de_service', 'number'));
    tr.appendChild(buildEditableCell(p, 'D_dir', 'checkbox'));
    tr.appendChild(buildEditableCell(p, 'TP', 'checkbox'));
    tr.appendChild(buildEditableCell(p, 'D_synd_', 'checkbox'));
    tr.appendChild(buildEditableCell(p, 'Autre', 'checkbox'));
    tr.appendChild(buildEditableCell(p, 'Preciser', 'text'));
    tr.appendChild(buildNiveauxCell(p));

    const actionsTd = document.createElement('td');
    const changeBtn = document.createElement('button');
    changeBtn.type = 'button';
    changeBtn.className = 'change-school-btn';
    changeBtn.textContent = "Changer d'établissement";
    changeBtn.addEventListener('click', () => openChangeSchoolModal(p));
    actionsTd.appendChild(changeBtn);
    tr.appendChild(actionsTd);

    return tr;
}

function buildEditableCell(record, field, type, options) {
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
    input.type = type === 'number' ? 'number' : (type === 'email' ? 'email' : 'text');
    input.value = value !== null && value !== undefined ? String(value) : '';
    if (type === 'number') {
        input.step = '0.05';
        input.min = '0';
        input.max = '1';
    }

    input.addEventListener('change', () => {
        let newValue = input.value;
        if (type === 'number') {
            const parsed = parseFloat(newValue.replace(',', '.'));
            if (isNaN(parsed)) {
                showToast('Valeur numérique invalide.', 'error');
                input.value = value !== null && value !== undefined ? String(value) : '';
                return;
            }
            newValue = parsed;
        } else {
            newValue = sanitizeText(newValue);
            if (type === 'email' && newValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newValue)) {
                showToast('Adresse mail invalide.', 'error');
                input.value = value !== null && value !== undefined ? String(value) : '';
                return;
            }
        }
        savePersonnelField(record.id, field, newValue);
    });

    td.appendChild(input);
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
        const newEcoleId = parseInt(selectedUaiField.value, 10);
        const personnelRecord = editingState.currentSchoolChangeRecord;

        if (!newEcoleId || !personnelRecord) {
            showToast('Veuillez sélectionner un établissement.', 'error');
            return;
        }

        confirmBtn.disabled = true;

        try {
            await grist.docApi.applyUserActions([
                ['UpdateRecord', 'Liste_PE', personnelRecord.id, { Ecoles: newEcoleId }]
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