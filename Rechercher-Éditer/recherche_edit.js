// ==========================================================
//  recherche_edit.js — Widget Grist : Rechercher / Modifier
// ==========================================================

grist.ready({ requiredAccess: 'full' });

// ===== DONNÉES =====
let listePEData = [];
let ecolesData = [];

/** Options connues pour les champs Choice/ChoiceList */
const choiceOptions = {
    Civilite: ['Monsieur', 'Madame'],
    Fonction: [],
    Quotite_de_service: [],
    D_dir: [],
    Niveau_x_: ['TPS', 'PS', 'MS', 'GS', 'CP', 'CE1', 'CE2', 'CM1', 'CM2'],
    TP: [],
    D_synd_: [],
    Autre: [],
};

// ===== ÉTAT =====
let currentNom = '';
let currentRecordId = null;
let currentRecordData = null;
let nomSearchResults = [];
let activeNomIdx = -1;
let ecoleSearchResults = [];
let activeEcoleIdx = -1;

// ===== UTILITAIRES SÉCURITÉ =====

/**
 * Échappe les caractères HTML pour prévenir les attaques XSS.
 * Utilisé uniquement quand innerHTML est inévitable.
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML; // sécurisé : textContent échappe tout HTML
}

/**
 * Valide et tronque une entrée texte, supprime les caractères de contrôle.
 */
function validateInput(input, maxLength = 500) {
    if (input === null || input === undefined) return '';
    let s = String(input).substring(0, maxLength);
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return s;
}

/**
 * Sanitise récursivement une valeur provenant de Grist.
 */
function sanitizeGristValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return validateInput(value, 5000);
    if (Array.isArray(value)) return value.map(v => sanitizeGristValue(v));
    return validateInput(String(value), 5000);
}

/**
 * Normalise une chaîne pour la comparaison (minuscules, sans accents).
 */
function normalizeStr(str) {
    return (str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

/**
 * Valide le format d'une adresse e-mail.
 */
function isValidEmail(email) {
    if (!email) return true;
    return /^[^\s@]{1,200}@[^\s@]{1,200}\.[^\s@]{1,50}$/.test(email);
}

/**
 * Parse un entier de façon sécurisée.
 */
function safeParseInt(value, defaultVal = 0) {
    const n = parseInt(value, 10);
    return isNaN(n) ? defaultVal : n;
}

/**
 * Calcule l'année scolaire en cours au format "AAAA-AAAA+1".
 * Septembre → fin de l'année civile = début de la nouvelle année scolaire.
 */
function getCurrentSchoolYear() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1; // 1 = janvier
    return m >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/**
 * Extrait les valeurs d'un ChoiceList Grist (tableau JavaScript brut).
 * Retire le marqueur 'L' si présent par sécurité.
 */
function extractChoiceList(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(v => typeof v === 'string' && v !== 'L');
}

// ===== CHARGEMENT DES DONNÉES =====

async function loadData() {
    showStatus('Chargement des données…', 'loading');
    try {
        // Chargement de la table Liste_PE
        const pe = await grist.docApi.fetchTable('Liste_PE');
        listePEData = pe.id.map((id, i) => ({
            id,
            Civilite: sanitizeGristValue(pe.Civilite[i]),
            ID_PE: sanitizeGristValue(pe.ID_PE[i]),
            Annee_scolaire: sanitizeGristValue(pe.Annee_scolaire[i]),
            Nom: sanitizeGristValue(pe.Nom[i]),
            Prenom: sanitizeGristValue(pe.Prenom[i]),
            Mail: sanitizeGristValue(pe.Mail[i]),
            Ecole: typeof pe.Ecole[i] === 'number' ? pe.Ecole[i] : 0,
            Fonction: sanitizeGristValue(pe.Fonction[i]),
            Quotite_de_service: sanitizeGristValue(pe.Quotite_de_service[i]),
            D_dir: sanitizeGristValue(pe.D_dir[i]) || [],
            Niveau_x_: sanitizeGristValue(pe.Niveau_x_[i]) || [],
            TP: sanitizeGristValue(pe.TP[i]) || [],
            D_synd_: sanitizeGristValue(pe.D_synd_[i]) || [],
            Autre: sanitizeGristValue(pe.Autre[i]) || [],
            Preciser: sanitizeGristValue(pe.Preciser[i]),
        }));

        // Chargement de la table Ecoles
        const ec = await grist.docApi.fetchTable('Ecoles');
        ecolesData = ec.id.map((id, i) => ({
            id,
            nom: sanitizeGristValue(ec.Nom[i]),
            nomCompletCommune: ec.Nom_Complement_Commune
                ? sanitizeGristValue(ec.Nom_Complement_Commune[i])
                : '',
        })).filter(e => e.nom);

        // Charger les options depuis la configuration des colonnes Grist
        await loadColumnChoicesFromMeta();

        // Pré-sélection de l'année scolaire en cours
        setDefaultYear();

        hideStatus();
    } catch (err) {
        console.error('Erreur de chargement des données :', err);
        showStatus('Erreur lors du chargement des données. Veuillez recharger la page.', 'error');
    }
}

/**
 * Charge les options de choix depuis la configuration des colonnes Grist (_grist_Tables_column).
 * En cas d'erreur (accès refusé, table absente), replie sur buildDynamicChoiceOptions().
 */
async function loadColumnChoicesFromMeta() {
    const TARGET_FIELDS = new Set(['D_dir', 'Niveau_x_', 'TP', 'D_synd_', 'Autre', 'Fonction', 'Quotite_de_service']);
    try {
        // Trouver l'ID interne de la table Liste_PE
        const tablesData = await grist.docApi.fetchTable('_grist_Tables');
        const tableIndex = tablesData.tableId.indexOf('Liste_PE');
        if (tableIndex === -1) throw new Error('Table Liste_PE introuvable dans les métadonnées');
        const tableRef = tablesData.id[tableIndex];

        // Lire les métadonnées de colonnes
        const colsData = await grist.docApi.fetchTable('_grist_Tables_column');
        let updatedCount = 0;

        colsData.id.forEach((_, i) => {
            if (colsData.parentId[i] !== tableRef) return;
            const colId = colsData.colId[i];
            if (!TARGET_FIELDS.has(colId)) return;

            const widgetOptionsStr = colsData.widgetOptions[i];
            if (!widgetOptionsStr) return;

            try {
                const opts = JSON.parse(widgetOptionsStr);
                if (Array.isArray(opts.choices) && opts.choices.length > 0) {
                    choiceOptions[colId] = opts.choices
                        .map(c => validateInput(String(c), 200))
                        .filter(Boolean);
                    updatedCount++;
                }
            } catch (e) {
                // widgetOptions JSON invalide pour cette colonne, on ignore
            }
        });

        if (updatedCount === 0) {
            console.info('Aucune option de colonne trouvée dans les métadonnées, repli sur les données.');
            buildDynamicChoiceOptions();
            return;
        }

        // Mettre à jour les <select> pour les champs Choice simples
        populateChoiceSelect('edit-fonction', choiceOptions.Fonction);
        populateChoiceSelect('edit-quotite', choiceOptions.Quotite_de_service);

    } catch (err) {
        const msg = err?.message || String(err);
        if (msg.includes('ACL_DENY') || msg.includes('access rules') || msg.includes('read access')) {
            console.info('Options de colonnes : accès aux métadonnées refusé, repli sur les données existantes.');
        } else {
            console.warn('Options de colonnes : erreur inattendue, repli sur les données existantes :', msg);
        }
        buildDynamicChoiceOptions();
    }
}

function buildDynamicChoiceOptions() {
    // Champs Choice simples : valeurs présentes dans les données
    ['Fonction', 'Quotite_de_service'].forEach(field => {
        const vals = new Set();
        listePEData.forEach(r => { if (r[field]) vals.add(r[field]); });
        choiceOptions[field] = [...vals].sort();
        populateChoiceSelect(field === 'Fonction' ? 'edit-fonction' : 'edit-quotite',
            choiceOptions[field]);
    });

    // Champs ChoiceList : valeurs présentes dans les données
    ['D_dir', 'TP', 'D_synd_', 'Autre'].forEach(field => {
        const vals = new Set();
        listePEData.forEach(r => {
            extractChoiceList(r[field]).forEach(v => { if (v) vals.add(v); });
        });
        if (vals.size > 0) choiceOptions[field] = [...vals].sort();
    });
}

function populateChoiceSelect(selectId, options) {
    const sel = document.getElementById(selectId);
    // Conserver l'option vide initiale
    while (sel.options.length > 1) sel.remove(1);
    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        sel.appendChild(o);
    });
}

function setDefaultYear() {
    const currentYear = getCurrentSchoolYear();
    const sel = document.getElementById('annee-select');
    for (const opt of sel.options) {
        if (opt.value === currentYear) {
            sel.value = currentYear;
            return;
        }
    }
    sel.selectedIndex = 0;
}

// ===== RECHERCHE NOM =====

function getSelectedYear() {
    return document.getElementById('annee-select').value;
}

function handleNomInput() {
    const query = validateInput(document.getElementById('nom-input').value, 100);
    document.getElementById('clear-nom').hidden = !query;

    if (!query) {
        closeNomResults();
        resetPrenomAndForm();
        return;
    }

    const year = getSelectedYear();
    const normalized = normalizeStr(query);

    const uniqueNames = [...new Set(
        listePEData
            .filter(p => p.Annee_scolaire === year
                && normalizeStr(p.Nom).includes(normalized))
            .map(p => p.Nom)
    )].sort().slice(0, 10);

    nomSearchResults = uniqueNames;
    activeNomIdx = -1;
    renderNomResults(uniqueNames, query);
}

function renderNomResults(names, query) {
    const list = document.getElementById('nom-results');
    list.innerHTML = '';

    if (names.length === 0) {
        list.style.display = 'none';
        return;
    }

    const normalizedQuery = normalizeStr(query);
    names.forEach((name, i) => {
        const li = document.createElement('li');
        li.className = 'autocomplete-item';
        li.setAttribute('role', 'option');
        li.dataset.index = i;
        appendHighlightedText(li, name, normalizedQuery);
        li.addEventListener('mousedown', (e) => {
            e.preventDefault(); // évite le blur avant le clic
            selectNom(name);
        });
        list.appendChild(li);
    });

    list.style.display = 'block';
}

/**
 * Insère du texte dans un élément en mettant en surbrillance la partie correspondant à la requête.
 * Sécurisé : utilise uniquement textContent / createElement.
 */
function appendHighlightedText(el, text, normalizedQuery) {
    if (!normalizedQuery) {
        el.textContent = text;
        return;
    }
    const normalizedText = normalizeStr(text);
    const idx = normalizedText.indexOf(normalizedQuery);
    if (idx === -1) {
        el.textContent = text;
        return;
    }
    const before = text.substring(0, idx);
    const match = text.substring(idx, idx + normalizedQuery.length);
    const after = text.substring(idx + normalizedQuery.length);

    if (before) el.appendChild(document.createTextNode(before));
    const mark = document.createElement('mark');
    mark.textContent = match;
    el.appendChild(mark);
    if (after) el.appendChild(document.createTextNode(after));
}

function handleNomKeydown(e) {
    const list = document.getElementById('nom-results');
    if (list.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeNomIdx = Math.min(activeNomIdx + 1, nomSearchResults.length - 1);
        updateNomHighlight();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeNomIdx = Math.max(activeNomIdx - 1, 0);
        updateNomHighlight();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeNomIdx >= 0 && nomSearchResults[activeNomIdx]) {
            selectNom(nomSearchResults[activeNomIdx]);
        }
    } else if (e.key === 'Escape') {
        closeNomResults();
    }
}

function updateNomHighlight() {
    const items = document.querySelectorAll('#nom-results .autocomplete-item');
    items.forEach((item, i) => item.classList.toggle('highlighted', i === activeNomIdx));
    const highlighted = items[activeNomIdx];
    if (highlighted) highlighted.scrollIntoView({ block: 'nearest' });
}

function selectNom(name) {
    currentNom = name;
    document.getElementById('nom-input').value = name;
    document.getElementById('clear-nom').hidden = false;
    closeNomResults();
    updatePrenomSelect(name);
}

function closeNomResults() {
    const list = document.getElementById('nom-results');
    list.style.display = 'none';
    list.innerHTML = '';
    activeNomIdx = -1;
}

// ===== PRÉNOM =====

function updatePrenomSelect(nom) {
    const year = getSelectedYear();
    const prenoms = [...new Set(
        listePEData
            .filter(p => p.Annee_scolaire === year && p.Nom === nom && p.Prenom)
            .map(p => p.Prenom)
    )].sort();

    const sel = document.getElementById('prenom-select');
    sel.innerHTML = '';

    if (prenoms.length === 0) {
        addOption(sel, '', '— Aucun prénom trouvé —');
        sel.disabled = true;
        hideEditSection();
        return;
    }

    if (prenoms.length > 1) {
        addOption(sel, '', '— Sélectionnez un prénom —');
    }

    prenoms.forEach(p => addOption(sel, p, p));
    sel.disabled = false;

    // Auto-sélection si un seul prénom
    if (prenoms.length === 1) {
        sel.value = prenoms[0];
        loadRecordForCurrentSelection();
    }
}

function resetPrenomAndForm() {
    const sel = document.getElementById('prenom-select');
    sel.innerHTML = '';
    addOption(sel, '', '— Sélectionnez d\'abord un nom —');
    sel.disabled = true;
    currentNom = '';
    currentRecordId = null;
    currentRecordData = null;
    hideEditSection();
}

function addOption(select, value, text) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    select.appendChild(opt);
}

function loadRecordForCurrentSelection() {
    const prenom = document.getElementById('prenom-select').value;
    if (!prenom) { hideEditSection(); return; }

    const year = getSelectedYear();
    const record = listePEData.find(p =>
        p.Nom === currentNom
        && p.Prenom === prenom
        && p.Annee_scolaire === year
    );

    if (!record) {
        showStatus('Aucun enregistrement trouvé pour cette sélection.', 'error');
        hideEditSection();
        return;
    }

    currentRecordId = record.id;
    currentRecordData = { ...record };
    populateEditForm(record);
    showEditSection();
    hideStatus();
}

// ===== FORMULAIRE D'ÉDITION =====

function populateEditForm(record) {
    // Identification
    document.getElementById('edit-civilite').value = record.Civilite || '';
    document.getElementById('edit-nom').value = record.Nom || '';
    document.getElementById('edit-prenom').value = record.Prenom || '';
    document.getElementById('edit-id-pe').value = record.ID_PE || '';
    document.getElementById('edit-annee').value = record.Annee_scolaire || '';
    document.getElementById('edit-mail').value = record.Mail || '';

    // École (référence)
    const ecoleObj = ecolesData.find(e => e.id === record.Ecole);
    const ecoleName = ecoleObj
        ? (ecoleObj.nomCompletCommune || ecoleObj.nom)
        : '';
    document.getElementById('edit-ecole-search').value = ecoleName;
    document.getElementById('edit-ecole').value = record.Ecole > 0 ? record.Ecole : '';
    document.getElementById('clear-ecole').hidden = !ecoleName;

    // Choice
    document.getElementById('edit-fonction').value = record.Fonction || '';
    document.getElementById('edit-quotite').value = record.Quotite_de_service || '';

    // ChoiceLists
    renderChoiceList('edit-d-dir', choiceOptions.D_dir, extractChoiceList(record.D_dir));
    renderChoiceList('edit-niveau', choiceOptions.Niveau_x_, extractChoiceList(record.Niveau_x_));
    renderChoiceList('edit-tp', choiceOptions.TP, extractChoiceList(record.TP));
    renderChoiceList('edit-d-synd', choiceOptions.D_synd_, extractChoiceList(record.D_synd_));
    renderChoiceList('edit-autre', choiceOptions.Autre, extractChoiceList(record.Autre));

    // Texte libre
    document.getElementById('edit-preciser').value = record.Preciser || '';
}

/**
 * Construit dynamiquement les cases à cocher d'un champ ChoiceList.
 * Sécurisé : textContent uniquement, aucun innerHTML avec données.
 */
function renderChoiceList(containerId, globalOptions, checkedValues) {
    const container = document.getElementById(containerId);
    container.innerHTML = ''; // vide le conteneur (sécurisé)

    // Union des options globales et des valeurs actuelles de l'enregistrement
    const combined = [...new Set([...globalOptions, ...checkedValues])]
        .filter(v => v)
        .sort();

    if (combined.length === 0) {
        const span = document.createElement('span');
        span.className = 'no-options-msg';
        span.textContent = 'Aucune option disponible dans les données';
        container.appendChild(span);
        return;
    }

    combined.forEach(opt => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = opt;
        cb.checked = checkedValues.includes(opt);

        label.appendChild(cb);
        label.appendChild(document.createTextNode('\u00a0' + opt));
        container.appendChild(label);
    });
}

// ===== RECHERCHE ÉCOLE =====

function handleEcoleInput() {
    const query = validateInput(document.getElementById('edit-ecole-search').value, 200);
    document.getElementById('clear-ecole').hidden = !query;

    if (!query) {
        closeEcoleResults();
        document.getElementById('edit-ecole').value = '';
        return;
    }

    const normalized = normalizeStr(query);
    ecoleSearchResults = ecolesData.filter(e =>
        normalizeStr(e.nomCompletCommune || e.nom).includes(normalized)
    ).slice(0, 10);

    activeEcoleIdx = -1;
    renderEcoleResults(ecoleSearchResults);
}

function renderEcoleResults(ecoles) {
    const list = document.getElementById('ecole-results');
    list.innerHTML = '';

    if (ecoles.length === 0) {
        list.style.display = 'none';
        return;
    }

    ecoles.forEach((ecole, i) => {
        const li = document.createElement('li');
        li.className = 'autocomplete-item';
        li.setAttribute('role', 'option');
        li.dataset.index = i;
        li.textContent = ecole.nomCompletCommune || ecole.nom;
        li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectEcole(ecole);
        });
        list.appendChild(li);
    });

    list.style.display = 'block';
}

function selectEcole(ecole) {
    const name = ecole.nomCompletCommune || ecole.nom;
    document.getElementById('edit-ecole-search').value = name;
    document.getElementById('edit-ecole').value = ecole.id;
    document.getElementById('clear-ecole').hidden = false;
    closeEcoleResults();
}

function closeEcoleResults() {
    const list = document.getElementById('ecole-results');
    list.style.display = 'none';
    list.innerHTML = '';
    activeEcoleIdx = -1;
}

function handleEcoleKeydown(e) {
    const list = document.getElementById('ecole-results');
    if (list.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeEcoleIdx = Math.min(activeEcoleIdx + 1, ecoleSearchResults.length - 1);
        updateEcoleHighlight();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeEcoleIdx = Math.max(activeEcoleIdx - 1, 0);
        updateEcoleHighlight();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeEcoleIdx >= 0 && ecoleSearchResults[activeEcoleIdx]) {
            selectEcole(ecoleSearchResults[activeEcoleIdx]);
        }
    } else if (e.key === 'Escape') {
        closeEcoleResults();
    }
}

function updateEcoleHighlight() {
    const items = document.querySelectorAll('#ecole-results .autocomplete-item');
    items.forEach((item, i) => item.classList.toggle('highlighted', i === activeEcoleIdx));
    const h = items[activeEcoleIdx];
    if (h) h.scrollIntoView({ block: 'nearest' });
}

// ===== SOUMISSION DU FORMULAIRE =====

async function handleSubmit(e) {
    e.preventDefault();
    if (!currentRecordId) return;

    // Lecture et validation des champs
    const nom = validateInput(document.getElementById('edit-nom').value.trim(), 200);
    const prenom = validateInput(document.getElementById('edit-prenom').value.trim(), 200);
    const mail = validateInput(document.getElementById('edit-mail').value.trim(), 300);

    if (!nom) {
        showStatus('Le champ Nom ne peut pas être vide.', 'error');
        document.getElementById('edit-nom').focus();
        return;
    }
    if (mail && !isValidEmail(mail)) {
        showStatus('Adresse e-mail invalide.', 'error');
        document.getElementById('edit-mail').focus();
        return;
    }

    const ecoleId = safeParseInt(document.getElementById('edit-ecole').value, 0);

    const data = {
        Civilite: validateInput(document.getElementById('edit-civilite').value, 20),
        Nom: nom,
        Prenom: prenom,
        ID_PE: validateInput(document.getElementById('edit-id-pe').value.trim(), 100),
        Annee_scolaire: validateInput(document.getElementById('edit-annee').value.trim(), 20),
        Mail: mail,
        // Référence École : 0 = vide dans Grist, toujours inclus pour permettre l'effacement
        Ecole: ecoleId > 0 ? ecoleId : 0,
        Fonction: validateInput(document.getElementById('edit-fonction').value, 100),
        Quotite_de_service: validateInput(document.getElementById('edit-quotite').value, 100),
        D_dir: collectChoiceList('edit-d-dir'),
        Niveau_x_: collectChoiceList('edit-niveau'),
        TP: collectChoiceList('edit-tp'),
        D_synd_: collectChoiceList('edit-d-synd'),
        Autre: collectChoiceList('edit-autre'),
        Preciser: validateInput(document.getElementById('edit-preciser').value.trim(), 500),
    };

    const btnValider = document.getElementById('btn-valider');
    btnValider.disabled = true;
    btnValider.textContent = 'Enregistrement…';

    try {
        await grist.docApi.applyUserActions([
            ['UpdateRecord', 'Liste_PE', currentRecordId, data]
        ]);
        await refreshAfterUpdate(nom, prenom);
        showStatus('✓ Modifications enregistrées avec succès.', 'success');
    } catch (err) {
        // Ne pas exposer les détails de l'erreur à l'utilisateur
        console.error('Erreur UpdateRecord Liste_PE :', err);
        showStatus('Erreur lors de la mise à jour. Veuillez réessayer.', 'error');
    } finally {
        btnValider.disabled = false;
        btnValider.textContent = 'Valider';
    }
}

/**
 * Collecte les valeurs cochées d'un ChoiceList et les formate pour Grist.
 */
function collectChoiceList(containerId) {
    const container = document.getElementById(containerId);
    const checked = Array.from(
        container.querySelectorAll('input[type="checkbox"]:checked')
    ).map(cb => validateInput(cb.value, 200)).filter(v => v);
    return ['L', ...checked];
}

/**
 * Recharge les données et met à jour l'UI après une sauvegarde réussie.
 */
async function refreshAfterUpdate(newNom, newPrenom) {
    await loadData();

    const updatedRecord = listePEData.find(r => r.id === currentRecordId);
    if (!updatedRecord) return;

    currentNom = updatedRecord.Nom;
    currentRecordData = { ...updatedRecord };

    // Mise à jour du champ de recherche Nom
    document.getElementById('nom-input').value = updatedRecord.Nom;
    document.getElementById('clear-nom').hidden = false;

    // Reconstruction du sélecteur Prénom sans déclencher d'événement
    rebuildPrenomSelectSilent(updatedRecord.Nom, updatedRecord.Prenom);

    // Rechargement du formulaire avec les données fraîches
    populateEditForm(updatedRecord);
}

/**
 * Reconstruit le sélecteur Prénom sans déclencher loadRecordForCurrentSelection.
 */
function rebuildPrenomSelectSilent(nom, prenomToSelect) {
    const year = getSelectedYear();
    const prenoms = [...new Set(
        listePEData
            .filter(p => p.Annee_scolaire === year && p.Nom === nom && p.Prenom)
            .map(p => p.Prenom)
    )].sort();

    const sel = document.getElementById('prenom-select');
    sel.innerHTML = '';

    if (prenoms.length > 1) {
        addOption(sel, '', '— Sélectionnez un prénom —');
    }

    prenoms.forEach(p => addOption(sel, p, p));
    sel.disabled = prenoms.length === 0;
    sel.value = prenomToSelect;
}

// ===== ANNULER =====

function handleAnnuler() {
    if (!currentRecordData) return;
    populateEditForm(currentRecordData);
    hideStatus();
}

// ===== AFFICHAGE SECTION MODIFIER =====

function showEditSection() {
    const section = document.getElementById('section-modifier');
    section.hidden = false;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideEditSection() {
    document.getElementById('section-modifier').hidden = true;
}

// ===== MESSAGES DE STATUT =====

function showStatus(message, type) {
    const el = document.getElementById('status-msg');
    el.textContent = message; // textContent : sécurisé contre XSS
    el.className = 'status-msg '
        + (type === 'success' ? 'status-success'
            : type === 'error' ? 'status-error'
                : 'loading-msg');
}

function hideStatus() {
    const el = document.getElementById('status-msg');
    el.textContent = '';
    el.className = 'status-msg';
}

// ===== INITIALISATION DES ÉCOUTEURS D'ÉVÉNEMENTS =====

document.addEventListener('DOMContentLoaded', () => {

    // Changement d'année scolaire → réinitialiser la recherche
    document.getElementById('annee-select').addEventListener('change', () => {
        closeNomResults();
        resetPrenomAndForm();
        hideStatus();
        if (document.getElementById('nom-input').value) handleNomInput();
    });

    // Saisie dans le champ Nom
    const nomInput = document.getElementById('nom-input');
    nomInput.addEventListener('input', handleNomInput);
    nomInput.addEventListener('keydown', handleNomKeydown);
    nomInput.addEventListener('blur', () => setTimeout(closeNomResults, 160));

    // Bouton effacer Nom
    document.getElementById('clear-nom').addEventListener('click', () => {
        nomInput.value = '';
        document.getElementById('clear-nom').hidden = true;
        closeNomResults();
        resetPrenomAndForm();
        hideStatus();
        nomInput.focus();
    });

    // Changement de prénom
    document.getElementById('prenom-select').addEventListener('change', loadRecordForCurrentSelection);

    // Recherche École dans le formulaire d'édition
    const ecoleSearch = document.getElementById('edit-ecole-search');
    ecoleSearch.addEventListener('input', handleEcoleInput);
    ecoleSearch.addEventListener('keydown', handleEcoleKeydown);
    ecoleSearch.addEventListener('blur', () => setTimeout(closeEcoleResults, 160));

    // Bouton effacer École
    document.getElementById('clear-ecole').addEventListener('click', () => {
        document.getElementById('edit-ecole-search').value = '';
        document.getElementById('edit-ecole').value = '';
        document.getElementById('clear-ecole').hidden = true;
        closeEcoleResults();
        ecoleSearch.focus();
    });

    // Soumission du formulaire
    document.getElementById('edit-form').addEventListener('submit', handleSubmit);

    // Annuler (réinitialise le formulaire aux valeurs chargées)
    document.getElementById('btn-annuler').addEventListener('click', handleAnnuler);
});

// Lancement du chargement initial
loadData();
