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
/*
 * Deux jeux de lignes, et la distinction compte.
 *
 * currentPersonRecords — TOUTES les lignes Liste_PE de la personne pour
 * l'année, lignes retirées comprises. C'est la cible de la propagation des
 * données communes : une ligne retirée porte toujours l'identité de la
 * personne, elle doit suivre une correction de nom ou de mail.
 *
 * currentAffectations — les seules lignes rattachées à une école, donc
 * modifiables ici. Un enseignant exerçant sur plusieurs écoles a une ligne
 * par école ; une ligne retirée, elle, n'a plus d'école à décrire.
 */
let currentPersonRecords = [];
let currentAffectations = [];
// L'école a-t-elle été touchée depuis le chargement du formulaire ? Sans ce
// drapeau, une école hors périmètre — donc non résolue — serait réécrite à
// null à la validation, détachant l'enseignant de son établissement.
let ecoleDirty = false;
// Instantané du formulaire, pour signaler les champs modifiés.
let formBaseline = null;
let formDirty = false;
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

function parseGristValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
        if ('id' in value && value.id !== null && value.id !== undefined) {
            return String(value.id);
        }
        if ('value' in value && value.value !== null && value.value !== undefined) {
            return String(value.value);
        }
        return sanitizeGristValue(String(value));
    }
    return sanitizeGristValue(value);
}

function parseEcoleRef(raw, index) {
    if (Array.isArray(raw)) {
        return parseGristValue(raw[index]);
    }
    return parseGristValue(raw);
}

function normalizeEcoleRef(ref) {
    if (ref === null || ref === undefined) return '';
    return String(ref).trim();
}

function isSameEcoleRef(ref, ecole) {
    if (!ecole) return false;
    const normalizedRef = normalizeEcoleRef(ref);
    return normalizedRef === normalizeEcoleRef(ecole.id)
        || normalizedRef === normalizeEcoleRef(ecole.uai);
}

function findEcoleByUaiOrId(ref) {
    const refStr = String(ref ?? '').trim();
    if (!refStr) return null;
    return ecolesData.find(e => e.uai === refStr || String(e.id) === refStr) || null;
}

/**
 * Ligne retirée : l'enseignant a quitté l'école, la ligne a été détachée et
 * horodatée (UAI à 0, fonction et niveaux vidés — voir
 * ../shared/liste-pe-retrait.js). Elle ne décrit plus d'affectation, mais elle
 * porte toujours l'identité de la personne.
 */
function isRetiree(record) {
    return !!record && typeof record.Retrait === 'number' && Number.isFinite(record.Retrait);
}

/** Une référence vide ou nulle désigne une ligne détachée de toute école. */
function isEmptyEcoleRef(ref) {
    const refStr = normalizeEcoleRef(ref);
    return refStr === '' || refStr === '0';
}

/**
 * Informations d'école d'une ligne Liste_PE.
 *
 * La table Ecoles est souvent filtrée par circonscription alors que Liste_PE
 * est visible à l'échelle du département : la ligne référencée est alors hors
 * de portée et ecolesData ne la contient pas. Les colonnes formule de Liste_PE
 * (Ecole, Circonscription, Departement) sont, elles, calculées côté document
 * et suivent les droits de la ligne d'enseignant : elles servent de repli.
 *
 * Renvoie null si la ligne n'est rattachée à aucune école.
 */
function ecoleInfoForRecord(record) {
    if (!record || isEmptyEcoleRef(record.UAI)) return null;

    const ref = normalizeEcoleRef(record.UAI);
    const ecole = findEcoleByUaiOrId(ref);
    if (ecole) {
        return {
            nom: ecole.nomCompletCommune || ecole.nom,
            uai: ecole.uai,
            circonscription: ecole.circonscription,
            departement: ecole.departement,
            horsPerimetre: false,
        };
    }

    // Repli. Une référence purement numérique est un row ID, inexploitable
    // pour afficher un code UAI ; toute autre valeur est la valeur affichée
    // de la colonne Ref, c'est-à-dire l'Identifiant_de_l_etablissement.
    const estRowId = /^\d+$/.test(ref);
    return {
        nom: record.Ecole || '',
        uai: estRowId ? '' : ref,
        circonscription: record.Circonscription || '',
        departement: record.Departement || '',
        horsPerimetre: true,
    };
}

/**
 * Normalise une chaîne pour la comparaison (minuscules, sans accents).
 */
function normalizeStr(str) {
    return SearchText.normalize(str);
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
            UAI: parseEcoleRef(pe.UAI, i),
            // Colonnes formule de Liste_PE. Elles sont calculées côté document
            // et restent lisibles même quand la ligne d'Ecoles référencée est
            // hors du périmètre de l'utilisateur : voir ecoleInfoForRecord().
            Ecole: sanitizeGristValue((pe.Ecole || [])[i]),
            Circonscription: sanitizeGristValue((pe.Circonscription || [])[i]),
            Departement: sanitizeGristValue((pe.Departement || [])[i]),
            Fonction: sanitizeGristValue(pe.Fonction[i]),
            Quotite_de_service: sanitizeGristValue(pe.Quotite_de_service[i]),
            D_dir: sanitizeGristValue(pe.D_dir[i]) || [],
            Niveau_x_: sanitizeGristValue(pe.Niveau_x_[i]) || [],
            TP: sanitizeGristValue(pe.TP[i]) || [],
            D_synd_: sanitizeGristValue(pe.D_synd_[i]) || [],
            Autre: sanitizeGristValue(pe.Autre[i]) || [],
            Preciser: sanitizeGristValue(pe.Preciser[i]),
            // Date de retrait : la ligne n'a plus d'école, ce n'est plus une
            // affectation. Voir isRetiree() et ../shared/liste-pe-retrait.js.
            Retrait: sanitizeGristValue((pe.Retrait || [])[i]),
        }));

        // Nom normalisé pré-calculé : la recherche par nom balaye toute la
        // table à chaque frappe (plusieurs dizaines de milliers de lignes).
        for (const record of listePEData) {
            record._normNom = normalizeStr(record.Nom);
        }

        // Chargement de la table Ecoles
        const ec = await grist.docApi.fetchTable('Ecoles');
        const ecoleUaiColumn = ec['$Identifiant_de_l_etablissement']
            || ec.Identifiant_de_l_etablissement
            || ec.UAI
            || [];
        const ecoleNomCommuneColumn = ec['$Commune_Nom']
            || ec.Commune_Nom
            || ec.Commune_Complement_Nom
            || [];
        // Établissements écartés de tout traitement (Ecoles.OK à faux) :
        // règle partagée, voir ../shared/ecoles-actives.js.
        const ecolesActives = EcolesActives.activeRowIds(ec);
        ecolesData = ec.id.map((id, i) => ({
            id,
            nom: sanitizeGristValue((ec.Nom_etablissement || ec.Nom || [])[i]),
            nomCompletCommune: sanitizeGristValue(ecoleNomCommuneColumn[i]),
            uai: sanitizeGristValue(ecoleUaiColumn[i]),
            // Ecoles.Circonscription est la formule qui retire le préfixe
            // « Circonscription d'inspection du 1er degré de … ». C'est aussi
            // ce que renvoie Liste_PE.Circonscription : sans cette priorité,
            // une même école s'afficherait différemment selon que sa ligne
            // d'Ecoles est lisible ou non.
            circonscription: sanitizeGristValue((ec.Circonscription || ec.nom_circonscription || ec.nom_irconscription || [])[i]),
            departement: (ec.Code_departement ? sanitizeGristValue(ec.Code_departement[i]) : '')
                + (ec.Libelle_departement ? ' ' + sanitizeGristValue(ec.Libelle_departement[i]) : ''),
        })).filter(e => e.nom && ecolesActives.has(e.id));

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
    const TARGET_FIELDS = ['D_dir', 'Niveau_x_', 'TP', 'D_synd_', 'Autre', 'Fonction', 'Quotite_de_service'];

    if (typeof GristColumns === 'undefined') {
        console.warn('Options de colonnes : module ../shared/grist-columns.js non chargé, repli sur les données.');
        buildDynamicChoiceOptions();
        return;
    }

    // Lecture déléguée au module partagé, qui absorbe les accès refusés.
    const defs = await GristColumns.fetchColumnDefs('Liste_PE', TARGET_FIELDS);
    let updatedCount = 0;

    for (const colId of TARGET_FIELDS) {
        const choices = (defs && defs[colId]) ? defs[colId].choices : [];
        if (!choices.length) continue;
        choiceOptions[colId] = choices.slice();
        updatedCount++;
    }

    if (updatedCount === 0) {
        console.info('Aucune option de colonne trouvée dans les métadonnées, repli sur les données.');
        buildDynamicChoiceOptions();
        return;
    }

    // Repli local conservé : un échec ici ne doit pas faire échouer tout le
    // chargement des données, dont l'appelant capture les exceptions.
    try {
        // Mettre à jour les <select> pour les champs Choice simples
        populateChoiceSelect('edit-fonction', choiceOptions.Fonction);
        populateChoiceSelect('edit-quotite', choiceOptions.Quotite_de_service);

        // Valeurs distinctes pour le champ texte Preciser (toujours depuis les données)
        buildPreciserOptions();
    } catch (err) {
        console.warn('Options de colonnes : application aux champs impossible, repli sur les données :',
            err?.message || err);
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

    // Valeurs distinctes pour le champ texte Preciser
    buildPreciserOptions();
}

function buildPreciserOptions() {
    const vals = new Set();
    listePEData.forEach(r => { if (r.Preciser) vals.add(r.Preciser); });
    choiceOptions.Preciser = [...vals].sort();
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

    const allMatches = [...new Set(
        listePEData
            .filter(p => p.Annee_scolaire === year
                && (p._normNom !== undefined ? p._normNom : normalizeStr(p.Nom)).includes(normalized))
            .map(p => p.Nom)
    )];
    const startsWith = allMatches.filter(n => normalizeStr(n).startsWith(normalized)).sort();
    const contains = allMatches.filter(n => !normalizeStr(n).startsWith(normalized)).sort();
    const uniqueNames = [...startsWith, ...contains].slice(0, 10);

    nomSearchResults = uniqueNames;
    activeNomIdx = uniqueNames.length > 0 ? 0 : -1;
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
    updateNomHighlight();
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
    hideAffectations();

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
    hideAffectations();
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

// Toutes les lignes Liste_PE correspondant à la sélection nom / prénom / année,
// lignes retirées comprises. Un enseignant peut exercer sur plusieurs écoles :
// il a alors une ligne par école. L'appelant écarte les lignes retirées de ce
// qui est proposé à l'édition, mais pas de la propagation.
function getMatchingRecords() {
    const prenom = document.getElementById('prenom-select').value;
    if (!prenom) return [];

    const year = getSelectedYear();
    return listePEData
        .filter(p =>
            p.Nom === currentNom
            && p.Prenom === prenom
            && p.Annee_scolaire === year
        )
        // Ordre stable d'un rechargement à l'autre : les row IDs suivent
        // l'ordre de création, pas celui des écoles.
        .sort((a, b) => ecoleLabelForRecord(a).localeCompare(ecoleLabelForRecord(b), 'fr'));
}

function ecoleLabelForRecord(record) {
    const info = ecoleInfoForRecord(record);
    return (info && info.nom) || 'École non renseignée';
}

function hideAffectations() {
    const group = document.getElementById('affectations-group');
    const chips = document.getElementById('affectations-chips');
    group.hidden = true;
    chips.innerHTML = '';
    document.getElementById('multi-note').hidden = true;
    ['scope-ecole', 'scope-fonction', 'scope-niveaux'].forEach(id => {
        document.getElementById(id).hidden = true;
    });
}

/**
 * Affiche les affectations de la personne, l'affectation courante cochée. La
 * liste est masquée quand il n'y en a qu'une : l'école est déjà dans le
 * formulaire, un choix unique n'apporterait rien.
 *
 * La note de portée, elle, apparaît dès qu'il existe une autre ligne à écrire,
 * affectation supplémentaire ou ligne retirée : la propagation ne doit jamais
 * être silencieuse.
 *
 * Sécurisé : textContent uniquement, aucun innerHTML avec données.
 *
 * @param {object[]} affectations lignes rattachées à une école
 * @param {number} nbRetirees lignes retirées de la même personne et année
 */
function renderAffectations(affectations, nbRetirees) {
    const group = document.getElementById('affectations-group');
    const chips = document.getElementById('affectations-chips');
    const multiNote = document.getElementById('multi-note');

    chips.innerHTML = '';

    if (affectations.length < 2 && nbRetirees === 0) {
        hideAffectations();
        return;
    }

    if (affectations.length < 2) {
        group.hidden = true;
        ['scope-ecole', 'scope-fonction', 'scope-niveaux'].forEach(id => {
            document.getElementById(id).hidden = true;
        });
        multiNote.textContent = nbRetirees > 1
            ? `Cet enseignant a ${nbRetirees} lignes dont l'affectation a été retirée. `
              + 'Les données communes — identité, mail, quotité, décharges — y sont aussi enregistrées.'
            : 'Cet enseignant a une ligne dont l\'affectation a été retirée. '
              + 'Les données communes — identité, mail, quotité, décharges — y sont aussi enregistrées.';
        multiNote.hidden = false;
        return;
    }

    document.getElementById('affectations-label').textContent =
        `Affectations (${affectations.length})`;

    affectations.forEach(record => {
        const inputId = `affectation-${record.id}`;
        const chip = document.createElement('label');
        chip.className = 'affectation-chip';
        chip.setAttribute('for', inputId);

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'affectation';
        radio.id = inputId;
        radio.value = String(record.id);
        radio.checked = record.id === currentRecordId;
        radio.addEventListener('change', () => selectAffectation(record.id));

        chip.appendChild(radio);
        chip.appendChild(document.createTextNode(ecoleLabelForRecord(record)));
        chips.appendChild(chip);
    });

    group.hidden = false;

    multiNote.textContent = `Cet enseignant exerce sur ${affectations.length} écoles. `
        + 'Les modifications sont appliquées à toutes ses lignes de l\'année'
        + (nbRetirees > 0 ? ', y compris celles dont l\'affectation a été retirée' : '')
        + ', à l\'exception de l\'école, de la fonction et des niveaux, propres à '
        + 'l\'affectation sélectionnée ci-dessus.';
    multiNote.hidden = false;

    ['scope-ecole', 'scope-fonction', 'scope-niveaux'].forEach(id => {
        document.getElementById(id).hidden = false;
    });
}

/**
 * Change d'affectation. Une saisie en cours serait perdue : on la signale
 * plutôt que de l'abandonner en silence, et on remet la coche en place.
 */
function selectAffectation(recordId) {
    if (recordId === currentRecordId) return;

    if (formDirty) {
        const radio = document.getElementById(`affectation-${currentRecordId}`);
        if (radio) radio.checked = true;
        showStatus('Modifications non enregistrées : validez ou annulez avant de changer d\'affectation.', 'error');
        return;
    }

    loadRecordForCurrentSelection(recordId);
}

/**
 * Charge une affectation dans le formulaire.
 * @param {number} [preferredId] affectation à ouvrir, la première par défaut.
 */
function loadRecordForCurrentSelection(preferredId) {
    const lignes = getMatchingRecords();
    currentPersonRecords = lignes;
    // Une ligne retirée n'a plus d'école à décrire : elle n'est pas proposée,
    // mais reste dans currentPersonRecords pour recevoir les données communes.
    const affectations = lignes.filter(r => !isRetiree(r));
    currentAffectations = affectations;

    if (lignes.length === 0) {
        hideAffectations();
        if (document.getElementById('prenom-select').value) {
            showStatus('Aucun enregistrement trouvé pour cette sélection.', 'error');
        }
        hideEditSection();
        return;
    }

    if (affectations.length === 0) {
        hideAffectations();
        hideEditSection();
        showStatus('Cet enseignant n\'a plus d\'affectation pour l\'année sélectionnée : '
            + 'sa ligne a été retirée. Rien n\'est modifiable ici.', 'error');
        return;
    }

    const record = affectations.find(r => r.id === preferredId) || affectations[0];
    currentRecordId = record.id;
    currentRecordData = { ...record };

    renderAffectations(affectations, lignes.length - affectations.length);
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
    document.getElementById('edit-mail').value = record.Mail || '';
    updateMailLink(record.Mail || '');

    // École : ecolesData quand la ligne d'Ecoles est accessible, sinon repli
    // sur les colonnes formule de la ligne d'enseignant.
    const info = ecoleInfoForRecord(record);
    const horsPerimetre = !!(info && info.horsPerimetre);
    document.getElementById('edit-ecole-search').value = info ? info.nom : '';
    // Le champ caché ne porte une valeur que si l'école est sélectionnable
    // dans la liste : il sert à distinguer un choix fait d'une saisie libre.
    document.getElementById('edit-ecole').value = (info && !horsPerimetre)
        ? normalizeEcoleRef(info.uai)
        : '';
    document.getElementById('clear-ecole').hidden = !(info && info.nom);
    document.getElementById('edit-ecole-uai').value = info ? info.uai : '';
    document.getElementById('edit-ecole-circo').value = info ? info.circonscription : '';
    document.getElementById('edit-ecole-dept').value = info ? info.departement : '';

    const ecoleNote = document.getElementById('ecole-note');
    if (horsPerimetre) {
        ecoleNote.textContent = 'École hors de votre périmètre : ses informations '
            + 'proviennent de la fiche de l\'enseignant. Elle est conservée telle '
            + 'quelle ; ne la remplacez que pour changer réellement d\'affectation.';
        ecoleNote.hidden = false;
    } else {
        ecoleNote.textContent = '';
        ecoleNote.hidden = true;
    }

    // Repartir d'une école intacte : sans modification explicite, la colonne
    // UAI ne sera pas réécrite à la validation.
    ecoleDirty = false;

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

    // Le formulaire vient d'être aligné sur la base : plus rien n'est modifié.
    snapshotForm();
    updateDirtyUI();
}

// ===== SUIVI DES MODIFICATIONS =====

/* Champs comparés à l'instantané pour encadrer ce qui a changé. L'école est
 * suivie à part : son champ visible est un libellé, pas la valeur enregistrée. */
const TRACKED_FIELDS = ['edit-civilite', 'edit-nom', 'edit-prenom', 'edit-id-pe',
    'edit-mail', 'edit-fonction', 'edit-quotite', 'edit-preciser'];
const TRACKED_CHOICELISTS = ['edit-niveau', 'edit-tp', 'edit-d-dir', 'edit-d-synd',
    'edit-autre'];

/** Signature stable d'un ChoiceList : l'ordre des cases ne doit pas compter. */
function choiceListSignature(containerId) {
    return collectChoiceList(containerId).slice(1).sort().join('|');
}

function snapshotForm() {
    formBaseline = { fields: {}, lists: {}, ecole: '' };
    TRACKED_FIELDS.forEach(id => {
        formBaseline.fields[id] = document.getElementById(id).value;
    });
    TRACKED_CHOICELISTS.forEach(id => {
        formBaseline.lists[id] = choiceListSignature(id);
    });
    formBaseline.ecole = document.getElementById('edit-ecole-search').value;
}

/** Encadre les champs modifiés et affiche le rappel de validation. */
function updateDirtyUI() {
    if (!formBaseline) return;
    let dirty = false;

    const mark = (el, changed) => {
        el.classList.toggle('field-modified', changed);
        if (changed) dirty = true;
    };

    TRACKED_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        mark(el, el.value !== formBaseline.fields[id]);
    });
    TRACKED_CHOICELISTS.forEach(id => {
        mark(document.getElementById(id), choiceListSignature(id) !== formBaseline.lists[id]);
    });

    const ecoleSearch = document.getElementById('edit-ecole-search');
    mark(ecoleSearch, ecoleSearch.value !== formBaseline.ecole);

    formDirty = dirty;
    document.getElementById('save-reminder').hidden = !dirty;
    document.body.classList.toggle('has-save-reminder', dirty);
}

/**
 * Construit dynamiquement les cases à cocher d'un champ ChoiceList.
 * Sécurisé : textContent uniquement, aucun innerHTML avec données.
 */
function renderChoiceList(containerId, globalOptions, checkedValues) {
    const container = document.getElementById(containerId);
    container.innerHTML = ''; // vide le conteneur (sécurisé)

    // Options de la config Grist en premier (ordre préservé), puis les valeurs cochées
    // absentes de la config (ajoutées en fin, triées pour être stables)
    const configSet = new Set(globalOptions);
    const extraChecked = checkedValues.filter(v => v && !configSet.has(v)).sort();
    const combined = [...globalOptions, ...extraChecked].filter(v => v);

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

// ===== AUTOCOMPLETE PRÉCISER =====

let preciserResults = [];
let activePreciserIdx = -1;

function handlePreciserInput() {
    const query = validateInput(document.getElementById('edit-preciser').value, 500);
    const normalized = normalizeStr(query);

    preciserResults = normalized
        ? (choiceOptions.Preciser || []).filter(v => normalizeStr(v).includes(normalized))
        : (choiceOptions.Preciser || []).slice();

    activePreciserIdx = -1;
    renderPreciserResults(preciserResults, normalized);
}

function openPreciserDropdown() {
    preciserResults = (choiceOptions.Preciser || []).slice();
    activePreciserIdx = -1;
    renderPreciserResults(preciserResults, '');
}

function renderPreciserResults(items, query) {
    const list = document.getElementById('preciser-results');
    list.innerHTML = '';

    if (items.length === 0) {
        list.style.display = 'none';
        document.getElementById('edit-preciser').setAttribute('aria-expanded', 'false');
        return;
    }

    items.forEach((val, i) => {
        const li = document.createElement('li');
        li.className = 'autocomplete-item';
        li.setAttribute('role', 'option');
        li.dataset.index = i;
        if (query) {
            appendHighlightedText(li, val, query);
        } else {
            li.textContent = val;
        }
        li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectPreciser(val);
        });
        list.appendChild(li);
    });

    list.style.display = 'block';
    document.getElementById('edit-preciser').setAttribute('aria-expanded', 'true');
}

function selectPreciser(val) {
    document.getElementById('edit-preciser').value = val;
    closePreciserResults();
    // Affectation programmatique : aucun événement input n'est émis.
    updateDirtyUI();
}

function closePreciserResults() {
    const list = document.getElementById('preciser-results');
    list.style.display = 'none';
    list.innerHTML = '';
    activePreciserIdx = -1;
    document.getElementById('edit-preciser').setAttribute('aria-expanded', 'false');
}

function handlePreciserKeydown(e) {
    const list = document.getElementById('preciser-results');
    if (list.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        activePreciserIdx = Math.min(activePreciserIdx + 1, preciserResults.length - 1);
        updatePreciserHighlight();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activePreciserIdx = Math.max(activePreciserIdx - 1, 0);
        updatePreciserHighlight();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activePreciserIdx >= 0 && preciserResults[activePreciserIdx]) {
            selectPreciser(preciserResults[activePreciserIdx]);
        }
    } else if (e.key === 'Escape') {
        closePreciserResults();
    }
}

function updatePreciserHighlight() {
    const items = document.querySelectorAll('#preciser-results .autocomplete-item');
    items.forEach((item, i) => item.classList.toggle('highlighted', i === activePreciserIdx));
    const h = items[activePreciserIdx];
    if (h) h.scrollIntoView({ block: 'nearest' });
}

// ===== RECHERCHE ÉCOLE =

function handleEcoleInput() {
    const query = validateInput(document.getElementById('edit-ecole-search').value, 200);
    document.getElementById('clear-ecole').hidden = !query;

    // Si l'utilisateur tape ou modifie le texte, on réinitialise la sélection courante.
    document.getElementById('edit-ecole').value = '';
    document.getElementById('edit-ecole-uai').value = '';
    document.getElementById('edit-ecole-circo').value = '';
    document.getElementById('edit-ecole-dept').value = '';
    document.getElementById('ecole-note').hidden = true;
    ecoleDirty = true;

    if (!query) {
        closeEcoleResults();
        return;
    }

    const normalized = normalizeStr(query);
    ecoleSearchResults = ecolesData.filter(e =>
        normalizeStr(e.nomCompletCommune || e.nom).includes(normalized)
        || normalizeStr(e.uai).includes(normalized)
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
    document.getElementById('edit-ecole').value = normalizeEcoleRef(ecole.uai);
    document.getElementById('clear-ecole').hidden = false;
    document.getElementById('edit-ecole-uai').value = ecole.uai || '';
    document.getElementById('edit-ecole-circo').value = ecole.circonscription || '';
    document.getElementById('edit-ecole-dept').value = ecole.departement || '';
    ecoleDirty = true;
    closeEcoleResults();
    // Affectation programmatique : aucun événement input n'est émis.
    updateDirtyUI();
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

    // Les autres lignes de la personne pour l'année, lignes retirées comprises :
    // elles portent son identité et doivent suivre une correction.
    const autresLignes = currentPersonRecords.filter(r => r.id !== currentRecordId);

    /*
     * École. Tant qu'elle n'a pas été touchée, la colonne UAI n'est PAS
     * réécrite : une école hors périmètre n'est pas résoluble en row ID, et la
     * réécrire reviendrait à la remplacer par null, détachant l'enseignant.
     */
    const donneesAffectation = {
        Fonction: validateInput(document.getElementById('edit-fonction').value, 100),
        Niveau_x_: collectChoiceList('edit-niveau'),
    };

    if (ecoleDirty) {
        const ecoleSearchText = validateInput(document.getElementById('edit-ecole-search').value.trim(), 200);
        const ecoleUAI = validateInput(document.getElementById('edit-ecole').value.trim(), 100);

        if (ecoleSearchText && !ecoleUAI) {
            showStatus('Veuillez sélectionner une école dans la liste proposée.', 'error');
            document.getElementById('edit-ecole-search').focus();
            return;
        }

        const ecoleRow = ecoleUAI ? findEcoleByUaiOrId(ecoleUAI) : null;
        if (ecoleUAI && !ecoleRow) {
            showStatus('École non reconnue: enregistrement annulé pour éviter une référence invalide.', 'error');
            document.getElementById('edit-ecole-search').focus();
            return;
        }

        // Une même personne ne peut pas avoir deux lignes sur la même école
        // et la même année : ce serait un doublon d'affectation. Les lignes
        // retirées sont hors sujet, elles n'ont plus d'école.
        const autresAffectations = currentAffectations.filter(r => r.id !== currentRecordId);
        if (ecoleRow && autresAffectations.some(r => isSameEcoleRef(r.UAI, ecoleRow))) {
            showStatus('Cet enseignant est déjà affecté à cette école pour l\'année sélectionnée.', 'error');
            document.getElementById('edit-ecole-search').focus();
            return;
        }

        // La colonne UAI de Liste_PE est un Ref Ecoles: on enregistre l'ID ligne résolu depuis l'UAI.
        donneesAffectation.UAI = ecoleRow ? ecoleRow.id : null;
    }

    /*
     * Champs de la personne, et non de l'affectation : ils sont propagés à
     * toutes ses lignes de l'année. Sans cela, un mail ou une quotité corrigés
     * sur une école resteraient faux sur les autres.
     */
    const donneesCommunes = {
        Civilite: validateInput(document.getElementById('edit-civilite').value, 20),
        Nom: nom,
        Prenom: prenom,
        ID_PE: validateInput(document.getElementById('edit-id-pe').value.trim(), 100),
        Mail: mail,
        Quotite_de_service: validateInput(document.getElementById('edit-quotite').value, 100),
        D_dir: collectChoiceList('edit-d-dir'),
        TP: collectChoiceList('edit-tp'),
        D_synd_: collectChoiceList('edit-d-synd'),
        Autre: collectChoiceList('edit-autre'),
        Preciser: validateInput(document.getElementById('edit-preciser').value.trim(), 500),
    };

    const actions = [
        ['UpdateRecord', 'Liste_PE', currentRecordId,
            { ...donneesCommunes, ...donneesAffectation }],
    ];
    if (autresLignes.length > 0) {
        actions.push(['BulkUpdateRecord', 'Liste_PE',
            autresLignes.map(r => r.id),
            repeatColumns(donneesCommunes, autresLignes.length)]);
    }

    const btnValider = document.getElementById('btn-valider');
    btnValider.disabled = true;
    btnValider.textContent = 'Enregistrement…';

    try {
        await grist.docApi.applyUserActions(actions);
        await refreshAfterUpdate();
        showStatus(autresLignes.length > 0
            ? `✓ Modifications enregistrées sur les ${autresLignes.length + 1} lignes de cet enseignant.`
            : '✓ Modifications enregistrées avec succès.', 'success');
    } catch (err) {
        // Ne pas exposer les détails de l'erreur à l'utilisateur
        console.error('Erreur UpdateRecord Liste_PE :', err);
        showStatus('Erreur lors de la mise à jour. Veuillez réessayer.', 'error');
    } finally {
        btnValider.disabled = false;
        btnValider.textContent = 'Valider';
    }
}

/** Étend un jeu de valeurs à N lignes, au format attendu par BulkUpdateRecord. */
function repeatColumns(values, count) {
    const columns = {};
    for (const [colId, value] of Object.entries(values)) {
        columns[colId] = new Array(count).fill(value);
    }
    return columns;
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
async function refreshAfterUpdate() {
    const savedId = currentRecordId;
    await loadData();

    const updatedRecord = listePEData.find(r => r.id === savedId);
    if (!updatedRecord) return;

    currentNom = updatedRecord.Nom;

    // Mise à jour du champ de recherche Nom
    document.getElementById('nom-input').value = updatedRecord.Nom;
    document.getElementById('clear-nom').hidden = false;

    // Reconstruction du sélecteur Prénom sans déclencher d'événement
    rebuildPrenomSelectSilent(updatedRecord.Nom, updatedRecord.Prenom);

    // Rechargement complet de la sélection : l'école a pu changer, donc les
    // libellés de la liste d'affectations aussi.
    loadRecordForCurrentSelection(savedId);
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
    const etaitMasquee = section.hidden;
    section.hidden = false;
    // Ne défiler qu'à l'ouverture : après un enregistrement, la section est
    // déjà visible et un saut de page serait déroutant.
    if (etaitMasquee) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideEditSection() {
    document.getElementById('section-modifier').hidden = true;
    formBaseline = null;
    formDirty = false;
    document.getElementById('save-reminder').hidden = true;
    document.body.classList.remove('has-save-reminder');
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
    // Fonction fléchée : l'objet Event ne doit pas passer pour un ID d'affectation.
    document.getElementById('prenom-select').addEventListener('change', () => loadRecordForCurrentSelection());


    // Autocomplete Préciser
    const preciserInput = document.getElementById('edit-preciser');
    preciserInput.addEventListener('focus', openPreciserDropdown);
    preciserInput.addEventListener('input', handlePreciserInput);
    preciserInput.addEventListener('keydown', handlePreciserKeydown);
    preciserInput.addEventListener('blur', () => setTimeout(closePreciserResults, 160));

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
        document.getElementById('edit-ecole-uai').value = '';
        document.getElementById('edit-ecole-circo').value = '';
        document.getElementById('edit-ecole-dept').value = '';
        document.getElementById('ecole-note').hidden = true;
        // Effacer l'école, c'est vouloir détacher la ligne : la colonne UAI
        // sera bien réécrite à la validation.
        ecoleDirty = true;
        closeEcoleResults();
        updateDirtyUI();
        ecoleSearch.focus();
    });

    // Suivi des modifications : un seul écouteur délégué couvre les champs
    // texte, les listes déroulantes et les cases à cocher du formulaire.
    const editForm = document.getElementById('edit-form');
    editForm.addEventListener('input', updateDirtyUI);
    editForm.addEventListener('change', updateDirtyUI);

    // Rappel de saisie : conduit au bouton Valider.
    document.getElementById('save-reminder-goto').addEventListener('click', () => {
        document.getElementById('btn-valider').scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('btn-valider').focus();
    });

    // Lien mailto dynamique
    document.getElementById('edit-mail').addEventListener('input', (e) => updateMailLink(e.target.value));

    // Soumission du formulaire
    document.getElementById('edit-form').addEventListener('submit', handleSubmit);

    // Annuler (réinitialise le formulaire aux valeurs chargées)
    document.getElementById('btn-annuler').addEventListener('click', handleAnnuler);
});

// ===== LIEN MAILTO =====

function updateMailLink(email) {
    const link = document.getElementById('mail-link');
    const trimmed = email.trim();
    // Validation basique : doit contenir '@' et aucun caractère de contrôle
    if (trimmed && trimmed.includes('@') && !/[\s<>"']/.test(trimmed)) {
        link.href = 'mailto:' + trimmed;
        link.textContent = trimmed;
        link.hidden = false;
    } else {
        link.hidden = true;
    }
}

// Lancement du chargement initial
loadData();
