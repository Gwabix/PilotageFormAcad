grist.ready({ requiredAccess: 'full' });

let ecolesData = [];
let enseignantsData = [];
let formateursData = [];
let tableauDeBordData = [];
let selectedEcoles = [];
let enseignantsMap = new Map();
let selectedFormateurs = [];
let activeResultIndex = -1;
let filteredResults = [];
let activeFormateurResultIndex = -1;
let filteredFormateurResults = [];
let activeFilterResultIndex = -1;
let filteredFilterResults = [];
let currentFilterType = null;

// Variables pour le filtrage de modification
let editFilters = {
    formateur: '',
    annee: '',
    ecole: '',
    typeFormation: '',
    dispositif: '',
    module: ''
};
let selectedRecordId = null;
let originalRecordData = null;

const NIVEAUX_POSSIBLES = ['TPS', 'PS', 'MS', 'GS', 'CP', 'CE1', 'CE2', 'CM1', 'CM2'];

// ===== FONCTIONS DE SÉCURITÉ =====

/**
 * Échappe les caractères HTML pour prévenir les attaques XSS
 * @param {string} text - Texte à échapper
 * @returns {string} Texte sécurisé
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    // SÉCURITÉ : L'utilisation de innerHTML ici est sécurisée car le texte passe par textContent
    // qui échappe automatiquement tout HTML. C'est la méthode recommandée pour échapper du HTML.
    return div.innerHTML;
}

/**
 * Échappe les guillemets pour les attributs HTML
 * @param {string} text - Texte à échapper pour attribut
 * @returns {string} Texte sécurisé pour attribut
 */
function escapeHtmlAttribute(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Valide et nettoie les entrées utilisateur
 * @param {string} input - Entrée utilisateur
 * @param {number} maxLength - Longueur maximale (défaut 1000)
 * @returns {string} Entrée validée
 */
function validateInput(input, maxLength = 1000) {
    if (!input) return '';
    let sanitized = String(input).substring(0, maxLength);
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return sanitized;
}

/**
 * Sanitise les données provenant de Grist
 * @param {any} value - Valeur à sanitiser
 * @returns {any} Valeur sanitisée
 */
function sanitizeGristData(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        return validateInput(value, 5000);
    }
    if (Array.isArray(value)) {
        return value.map(v => sanitizeGristData(v));
    }
    return value;
}

/**
 * Valide et parse un entier de manière sécurisée
 * @param {any} value - Valeur à parser
 * @param {number} defaultValue - Valeur par défaut si invalide
 * @param {number} min - Valeur minimale acceptée
 * @returns {number} Nombre validé
 */
function safeParseInt(value, defaultValue = 0, min = null) {
    const parsed = parseInt(value);
    if (isNaN(parsed)) return defaultValue;
    if (min !== null && parsed < min) return defaultValue;
    return parsed;
}

/**
 *  @class
 *  @function Quantity
 *  @param {DOMobject} element to create a quantity wrapper around
 *  @param {Object} options Configuration options
 */
class QuantityInput {
    constructor(self, options = {}) {
        this.options = {
            decreaseText: 'Decrease quantity',
            increaseText: 'Increase quantity',
            value: 1,
            min: 1,
            id: 'quantity',
            ...options
        };

        // Create input
        this.input = document.createElement('input');
        this.input.value = this.options.value;
        this.input.type = 'number';
        this.input.name = 'quantity';
        this.input.pattern = '[0-9]+';
        this.input.id = this.options.id;
        this.input.min = this.options.min;
        this.input.addEventListener('change', this.options.id === 'nbEcoles' ? updateEcolesSelection : () => { });

        // Get text for buttons
        this.decreaseText = this.options.decreaseText;
        this.increaseText = this.options.increaseText;

        // Button constructor
        function Button(text, className) {
            this.button = document.createElement('button');
            this.button.type = 'button';
            this.button.innerHTML = text;
            this.button.title = text;
            this.button.classList.add(className);

            return this.button;
        }

        // Create buttons
        this.subtract = new Button(this.decreaseText, 'sub');
        this.add = new Button(this.increaseText, 'add');

        // Add functionality to buttons
        this.subtract.addEventListener('click', () => this.change_quantity(-1));
        this.add.addEventListener('click', () => this.change_quantity(1));

        // Add input and buttons to wrapper
        self.appendChild(this.subtract);
        self.appendChild(this.input);
        self.appendChild(this.add);
    }

    change_quantity(change) {
        // Get current value
        let quantity = Number(this.input.value);

        // Ensure quantity is a valid number
        if (isNaN(quantity)) quantity = this.options.min;

        // Change quantity
        quantity += change;

        // Ensure quantity is always a number
        quantity = Math.max(quantity, this.options.min);

        // Output number
        this.input.value = quantity;
        if (this.options.id === 'nbEcoles') {
            updateEcolesSelection();
        }
    }
}

async function loadData() {
    try {
        const ecolesTable = await grist.docApi.fetchTable('Ecoles');
        ecolesData = ecolesTable.id.map((id, index) => ({
            id: id,
            commune_complement: sanitizeGristData(ecolesTable.Commune_Complement_Nom[index]),
            departement: sanitizeGristData(ecolesTable.Departement[index]),
            circonscription: sanitizeGristData(ecolesTable.Circonscription[index])
        })).filter(e => e.commune_complement);

        const enseignantsTable = await grist.docApi.fetchTable('Liste_PE');
        enseignantsData = enseignantsTable.id.map((id, index) => ({
            id: id,
            nom: sanitizeGristData(enseignantsTable.Nom[index]),
            prenom: sanitizeGristData(enseignantsTable.Prenom[index]),
            ecole: enseignantsTable.Ecole[index],
            niveaux: sanitizeGristData(enseignantsTable.Niveau_x_[index]) || []
        }));

        const formateursTable = await grist.docApi.fetchTable('Formateurs');
        formateursData = formateursTable.id.map((id, index) => ({
            id: id,
            nom: sanitizeGristData(formateursTable.Formateur[index])
        })).filter(f => f.nom);

        const tableauTable = await grist.docApi.fetchTable('Tableau_de_bord');
        tableauDeBordData = tableauTable.id.map((id, index) => ({
            id: id,
            idFiche: sanitizeGristData(tableauTable.ID_fiche[index]),
            departement: sanitizeGristData(tableauTable.Departement[index]),
            circonscription: sanitizeGristData(tableauTable.Circonscription[index]) || [],
            ecole: tableauTable.Ecole[index],
            nbEcoles: safeParseInt(tableauTable.Nb_ecoles[index], 0, 0),
            nbPE: safeParseInt(tableauTable.Nb_PE[index], 0, 0),
            nomPE: tableauTable.Nom_PE[index],
            prenomPE: tableauTable.Prenom_PE[index],
            niveauClasse: sanitizeGristData(tableauTable.Niveau_classe[index]) || [],
            modaliteConstitution: sanitizeGristData(tableauTable.Modalite_de_constitution_du_groupe[index]) || [],
            typeFormation: sanitizeGristData(tableauTable.Type_de_formation[index]),
            tempsFormation: safeParseInt(tableauTable.Temps_de_formation[index], 0, 0),
            modalitesFormation: sanitizeGristData(tableauTable.Modalites_de_formation[index]) || [],
            objetsTransversaux: sanitizeGristData(tableauTable.Objets_transversaux_traites_en_parallele[index]) || [],
            themes: sanitizeGristData(tableauTable['Theme_s_traite_s_en_formation'][index]) || [],
            annee: sanitizeGristData(tableauTable.Annee[index]),
            numeroGroupe: tableauTable.Numero_de_groupe[index],
            dispositifGAIA: sanitizeGristData(tableauTable.Dispositif_GAIA[index]),
            moduleGAIA: sanitizeGristData(tableauTable.Module_GAIA[index]),
            formateurs: sanitizeGristData(tableauTable.Formateur_s_[index]) || []
        }));

    } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
        alert('Erreur lors du chargement des données. Veuillez recharger la page.');
    }
}

function updateEcolesSelection() {
    const nbEcolesEl = document.getElementById('nbEcoles');
    const nbRequired = safeParseInt(nbEcolesEl?.value || '1', 1, 1);
    const errorDiv = document.getElementById('ecolesError');

    if (selectedEcoles.length > nbRequired) {
        selectedEcoles = selectedEcoles.slice(0, nbRequired);
        displaySelectedEcoles();
        updateEnseignantsList();
    }

    if (selectedEcoles.length !== nbRequired) {
        errorDiv.style.display = 'block';
    } else {
        errorDiv.style.display = 'none';
    }
}

function searchEcoles(event) {
    const searchTerm = event.target.value.toLowerCase().trim();
    const resultsDiv = document.getElementById('searchResults');

    // Gestion de la navigation clavier
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (filteredResults.length > 0) {
            activeResultIndex = Math.min(activeResultIndex + 1, filteredResults.length - 1);
            updateActiveResult();
        }
        return;
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (filteredResults.length > 0) {
            activeResultIndex = Math.max(activeResultIndex - 1, 0);
            updateActiveResult();
        }
        return;
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        if (filteredResults.length > 0 && activeResultIndex >= 0) {
            selectEcole(filteredResults[activeResultIndex].id);
        }
        return;
    }

    if (event.key === 'Tab') {
        if (filteredResults.length > 0) {
            event.preventDefault();
            selectEcole(filteredResults[activeResultIndex >= 0 ? activeResultIndex : 0].id);
        }
        return;
    }

    if (searchTerm.length < 2) {
        resultsDiv.style.display = 'none';
        filteredResults = [];
        activeResultIndex = -1;
        return;
    }

    filteredResults = ecolesData.filter(e =>
        e.commune_complement.toLowerCase().includes(searchTerm) &&
        !selectedEcoles.find(se => se.id === e.id)
    ).slice(0, 10);

    if (filteredResults.length === 0) {
        resultsDiv.style.display = 'none';
        activeResultIndex = -1;
        return;
    }

    activeResultIndex = 0; // Premier résultat sélectionné par défaut

    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    // SÉCURITÉ : Toutes les données dynamiques sont échappées via escapeHtml() et escapeHtmlAttribute()
    resultsDiv.innerHTML = filteredResults.map((ecole, index) =>
        `<div class="search-result-item ${index === 0 ? 'active' : ''}" 
              data-ecole-id="${escapeHtmlAttribute(ecole.id)}"
              data-index="${index}">
          ${escapeHtml(ecole.commune_complement)}
        </div>`
    ).join('');

    // Ajouter les event listeners après insertion
    setTimeout(() => {
        resultsDiv.querySelectorAll('.search-result-item').forEach((item) => {
            item.addEventListener('click', () => {
                const ecoleId = safeParseInt(item.getAttribute('data-ecole-id'), 0, 0);
                if (ecoleId > 0) selectEcole(ecoleId);
            });
        });
    }, 0);

    resultsDiv.style.display = 'block';
}

function updateActiveResult() {
    const items = document.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
        if (index === activeResultIndex) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('active');
        }
    });
}

function selectEcole(ecoleId) {
    const nbEcolesEl = document.getElementById('nbEcoles');
    const nbRequired = safeParseInt(nbEcolesEl?.value || '1', 1, 1);

    if (selectedEcoles.length >= nbRequired) {
        alert(`Vous avez déjà sélectionné ${nbRequired} école(s). Augmentez le nombre d'écoles ou supprimez une sélection.`);
        return;
    }

    const ecole = ecolesData.find(e => e.id === ecoleId);
    if (ecole && !selectedEcoles.find(se => se.id === ecoleId)) {
        selectedEcoles.push(ecole);
        displaySelectedEcoles();
        updateEnseignantsList();

        document.getElementById('searchEcole').value = '';
        document.getElementById('searchResults').style.display = 'none';
        filteredResults = [];
        activeResultIndex = -1;

        updateEcolesSelection();
    }
}

function displaySelectedEcoles() {
    const container = document.getElementById('selectedSchools');
    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    // SÉCURITÉ : ecole.commune_complement est échappé via escapeHtml()
    container.innerHTML = selectedEcoles.map(ecole =>
        `<span class="school-tag">
          ${escapeHtml(ecole.commune_complement)}
          <button data-ecole-id="${escapeHtmlAttribute(ecole.id)}">×</button>
        </span>`
    ).join('');

    // Ajouter les event listeners pour les boutons de suppression
    container.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const ecoleId = safeParseInt(btn.getAttribute('data-ecole-id'), 0, 0);
            if (ecoleId > 0) removeEcole(ecoleId);
        });
    });
}

function removeEcole(ecoleId) {
    selectedEcoles = selectedEcoles.filter(e => e.id !== ecoleId);
    displaySelectedEcoles();
    updateEnseignantsList();
    updateEcolesSelection();
}

function updateEnseignantsList() {
    const container = document.getElementById('enseignantsContainer');

    if (selectedEcoles.length === 0) {
        container.innerHTML = '<div class="no-enseignants">Sélectionnez d\'abord les écoles</div>';
        enseignantsMap.clear();
        return;
    }

    const selectedEcoleIds = selectedEcoles.map(e => e.id);
    const filteredEnseignants = enseignantsData.filter(ens =>
        selectedEcoleIds.includes(ens.ecole)
    );

    if (filteredEnseignants.length === 0) {
        container.innerHTML = '<div class="no-enseignants">Aucun enseignant trouvé pour ces écoles</div>';
        enseignantsMap.clear();
        return;
    }

    enseignantsMap.clear();
    filteredEnseignants.forEach(ens => {
        enseignantsMap.set(ens.id, {
            selected: true,
            niveaux: [...(ens.niveaux || [])]
        });
    });

    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    // SÉCURITÉ : Template complexe avec 8 variables dynamiques, toutes échappées.
    // IMPORTANT : Lors de l'ajout de nouvelles variables, utiliser escapeHtml() pour le contenu
    // et escapeHtmlAttribute() pour les attributs HTML.
    container.innerHTML = filteredEnseignants.map(ens => {
        const ecole = selectedEcoles.find(e => e.id === ens.ecole);
        const niveauxHTML = NIVEAUX_POSSIBLES.map(niveau => {
            const checked = ens.niveaux && ens.niveaux.includes(niveau) ? 'checked' : '';
            return `
            <div class="niveau-checkbox">
              <input type="checkbox" 
                     id="niveau_${escapeHtmlAttribute(ens.id)}_${escapeHtmlAttribute(niveau)}" 
                     value="${escapeHtmlAttribute(niveau)}"
                     data-ens-id="${escapeHtmlAttribute(ens.id)}"
                     ${checked}>
              <label for="niveau_${escapeHtmlAttribute(ens.id)}_${escapeHtmlAttribute(niveau)}">${escapeHtml(niveau)}</label>
            </div>
          `;
        }).join('');

        return `
          <div class="enseignant-item">
            <div class="enseignant-header">
              <input type="checkbox" 
                     id="ens_${escapeHtmlAttribute(ens.id)}" 
                     data-ens-id="${escapeHtmlAttribute(ens.id)}"
                     checked>
              <span class="enseignant-name">${escapeHtml(ens.nom)} ${escapeHtml(ens.prenom)}</span>
              <span class="enseignant-school">${ecole ? escapeHtml(ecole.commune_complement) : ''}</span>
            </div>
            <div class="niveaux-checkboxes" id="niveaux_${escapeHtmlAttribute(ens.id)}">
              ${niveauxHTML}
            </div>
          </div>
        `;
    }).join('');

    // Ajouter les event listeners après insertion du HTML
    container.querySelectorAll('input[id^="ens_"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const ensId = safeParseInt(checkbox.getAttribute('data-ens-id'), 0, 0);
            if (ensId > 0) toggleEnseignant(ensId);
        });
    });

    container.querySelectorAll('.niveau-checkbox input').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const ensId = safeParseInt(checkbox.getAttribute('data-ens-id'), 0, 0);
            if (ensId > 0) updateNiveaux(ensId);
        });
    });
}

function toggleEnseignant(ensId) {
    const checkbox = document.getElementById(`ens_${ensId}`);
    const niveauxDiv = document.getElementById(`niveaux_${ensId}`);

    if (enseignantsMap.has(ensId)) {
        enseignantsMap.get(ensId).selected = checkbox.checked;
    }

    niveauxDiv.style.opacity = checkbox.checked ? '1' : '0.5';
    const niveauxCheckboxes = niveauxDiv.querySelectorAll('input[type="checkbox"]');
    niveauxCheckboxes.forEach(cb => cb.disabled = !checkbox.checked);
}

function updateNiveaux(ensId) {
    const niveaux = [];
    NIVEAUX_POSSIBLES.forEach(niveau => {
        const checkbox = document.getElementById(`niveau_${ensId}_${niveau}`);
        if (checkbox && checkbox.checked) {
            niveaux.push(niveau);
        }
    });

    if (enseignantsMap.has(ensId)) {
        enseignantsMap.get(ensId).niveaux = niveaux;
    }
}

function getSelectValues(selectId) {
    const select = document.getElementById(selectId);
    return Array.from(select.selectedOptions).map(opt => opt.value);
}

function getCheckboxValues(id) {
    return Array.from(document.querySelectorAll(`#${id} input:checked`)).map(cb => cb.value);
}

function getRadioValue(name) {
    const radio = document.querySelector(`input[name="${name}"]:checked`);
    return radio ? radio.value : '';
}

function updateDureeFormation() {
    const typeFormation = getRadioValue('typeFormation');
    const dureeSelect = document.getElementById('dureeFormation');

    if (!typeFormation) {
        dureeSelect.value = '';
        return;
    }

    if (typeFormation === 'Constellation' || typeFormation === 'Résidence pédagogique') {
        dureeSelect.value = '30h';
    } else if (typeFormation === 'Animations pédagogiques' || typeFormation === 'Accompagnement de proximité') {
        dureeSelect.value = '6h';
    }
}

function addFormateurField() {
    const container = document.getElementById('formateursInputsContainer');
    const index = container.children.length;

    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'formateur-field';
    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    // SÉCURITÉ : Template statique sans données dynamiques
    fieldDiv.innerHTML = `
        <div class="search-container" style="position: relative;">
            <input type="text" 
                   class="search-input formateur-input" 
                   id="formateurInput_${index}"
                   placeholder="Tapez pour rechercher ou ajouter un formateur..."
                   data-field-index="${index}">
            <div class="search-results" id="formateurResults_${index}"></div>
        </div>
    `;

    container.appendChild(fieldDiv);

    // Ajouter l'event listener après l'insertion
    const input = document.getElementById(`formateurInput_${index}`);
    input.addEventListener('keyup', (event) => searchFormateurs(event, index));
}

function searchFormateurs(event, fieldIndex) {
    const searchTerm = event.target.value.toLowerCase().trim();
    const resultsDiv = document.getElementById(`formateurResults_${fieldIndex}`);
    const inputField = document.getElementById(`formateurInput_${fieldIndex}`);

    // Gestion de la navigation clavier
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (filteredFormateurResults.length > 0) {
            activeFormateurResultIndex = Math.min(activeFormateurResultIndex + 1, filteredFormateurResults.length - 1);
            updateActiveFormateurResult(resultsDiv);
        }
        return;
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (filteredFormateurResults.length > 0) {
            activeFormateurResultIndex = Math.max(activeFormateurResultIndex - 1, 0);
            updateActiveFormateurResult(resultsDiv);
        }
        return;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        if (filteredFormateurResults.length > 0 && activeFormateurResultIndex >= 0) {
            inputField.value = filteredFormateurResults[activeFormateurResultIndex];
            resultsDiv.style.display = 'none';
        }
        return;
    }

    if (searchTerm.length < 1) {
        resultsDiv.style.display = 'none';
        filteredFormateurResults = [];
        activeFormateurResultIndex = -1;
        return;
    }

    filteredFormateurResults = formateursData
        .map(f => f.nom)
        .filter(nom => nom.toLowerCase().includes(searchTerm))
        .slice(0, 10);

    if (filteredFormateurResults.length === 0) {
        resultsDiv.style.display = 'none';
        activeFormateurResultIndex = -1;
        return;
    }

    activeFormateurResultIndex = 0;

    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    // SÉCURITÉ : Les noms de formateurs sont échappés via escapeHtml()
    resultsDiv.innerHTML = filteredFormateurResults.map((nom, index) =>
        `<div class="search-result-item ${index === 0 ? 'active' : ''}" 
              data-formateur-nom="${escapeHtmlAttribute(nom)}"
              data-field-index="${fieldIndex}"
              data-index="${index}">
          ${escapeHtml(nom)}
        </div>`
    ).join('');

    // Ajouter les event listeners après insertion
    resultsDiv.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            const nom = item.getAttribute('data-formateur-nom');
            const fieldIdx = safeParseInt(item.getAttribute('data-field-index'), 0, 0);
            if (fieldIdx >= 0) selectFormateur(nom, fieldIdx);
        });
    });

    resultsDiv.style.display = 'block';
}

function updateActiveFormateurResult(resultsDiv) {
    const items = resultsDiv.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
        if (index === activeFormateurResultIndex) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('active');
        }
    });
}

function selectFormateur(nom, fieldIndex) {
    const inputField = document.getElementById(`formateurInput_${fieldIndex}`);
    const resultsDiv = document.getElementById(`formateurResults_${fieldIndex}`);

    inputField.value = nom;
    resultsDiv.style.display = 'none';
    filteredFormateurResults = [];
    activeFormateurResultIndex = -1;
}

function getFormateurs() {
    const inputs = document.querySelectorAll('.formateur-input');
    const formateurs = [];

    inputs.forEach(input => {
        const value = input.value.trim();
        if (value && !formateurs.includes(value)) {
            formateurs.push(value);
        }
    });

    return formateurs;
}

function filterThemes() {
    const francaisEl = document.getElementById('filterFrancais');
    const francais = francaisEl ? francaisEl.checked : false;
    const mathematiquesEl = document.getElementById('filterMathematiques');
    const mathematiques = mathematiquesEl ? mathematiquesEl.checked : false;

    const labels = document.querySelectorAll('#themesFormation label');

    labels.forEach(label => {
        const value = label.querySelector('input').value;
        let show = false;

        if (value.startsWith('FRA') && francais) {
            show = true;
        } else if (value.startsWith('MA') && mathematiques) {
            show = true;
        }

        label.style.display = show ? 'flex' : 'none';
    });
}

function validateForm() {
    const errors = [];

    const anneeScolaireEl = document.getElementById('anneeScolaire');
    const anneeScolaire = anneeScolaireEl ? validateInput(anneeScolaireEl.value, 50) : '';
    if (!anneeScolaire) {
        errors.push('Année scolaire est obligatoire');
        const anneeErrorEl = document.getElementById('anneeError');
        if (anneeErrorEl) anneeErrorEl.style.display = 'block';
    } else {
        const anneeErrorEl = document.getElementById('anneeError');
        if (anneeErrorEl) anneeErrorEl.style.display = 'none';
    }

    const nbEcolesEl = document.getElementById('nbEcoles');
    const nbRequired = safeParseInt(nbEcolesEl?.value || '1', 1, 1);
    if (selectedEcoles.length !== nbRequired) {
        errors.push(`Vous devez sélectionner exactement ${nbRequired} école(s)`);
    }

    const selectedEnseignants = Array.from(enseignantsMap.entries())
        .filter(([id, data]) => data.selected);

    if (selectedEnseignants.length === 0) {
        errors.push('Vous devez sélectionner au moins un enseignant');
    }

    const modaliteConstitution = getCheckboxValues('modaliteConstitution');
    if (modaliteConstitution.length === 0) {
        errors.push('Modalité de constitution du groupe est obligatoire');
    }

    const typeFormation = getRadioValue('typeFormation');
    if (!typeFormation) {
        errors.push('Type de formation est obligatoire');
    }

    const dureeFormationValEl = document.getElementById('dureeFormation');
    const dureeFormation = dureeFormationValEl?.value || '';
    if (!dureeFormation) {
        errors.push('Durée de la formation est obligatoire');
        const dureeErrorEl = document.getElementById('dureeError');
        if (dureeErrorEl) dureeErrorEl.style.display = 'block';
    } else {
        const dureeErrorEl = document.getElementById('dureeError');
        if (dureeErrorEl) dureeErrorEl.style.display = 'none';
    }

    const modalitesFormation = getCheckboxValues('modalitesFormation');
    if (modalitesFormation.length === 0) {
        errors.push('Modalités de formation est obligatoire');
    }

    const objetsTransversaux = getCheckboxValues('objetsTransversaux');
    if (objetsTransversaux.length === 0) {
        errors.push('Objets transversaux traités en parallèle est obligatoire');
    }

    const themesFormation = getCheckboxValues('themesFormation');
    if (themesFormation.length === 0) {
        errors.push('Thème(s) traité(s) en formation est obligatoire');
    }

    // Validation des champs GAIA (facultatifs mais avec format spécifique si renseignés)
    const dispositifGAIAEl = document.getElementById('dispositifGAIA');
    const dispositifGAIA = validateInput((dispositifGAIAEl?.value || '').trim(), 10);
    if (dispositifGAIA && !/^[a-zA-Z0-9]{10}$/.test(dispositifGAIA)) {
        errors.push('Dispositif GAIA doit contenir exactement 10 caractères alphanumériques');
        document.getElementById('dispositifError').style.display = 'block';
    } else {
        const dispositifErrorEl = document.getElementById('dispositifError');
        if (dispositifErrorEl) dispositifErrorEl.style.display = 'none';
    }

    const moduleGAIAEl = document.getElementById('moduleGAIA');
    const moduleGAIA = validateInput((moduleGAIAEl?.value || '').trim(), 5);
    if (moduleGAIA && !/^[0-9]{5}$/.test(moduleGAIA)) {
        errors.push('Module GAIA doit contenir exactement 5 chiffres');
        document.getElementById('moduleError').style.display = 'block';
    } else {
        const moduleErrorEl = document.getElementById('moduleError');
        if (moduleErrorEl) moduleErrorEl.style.display = 'none';
    }

    // Validation du numéro de groupe
    const numeroGroupeEl = document.getElementById('numeroGroupe');
    const numeroGroupe = (numeroGroupeEl?.value || '').trim();
    if (numeroGroupe) {
        const num = safeParseInt(numeroGroupe, -1, 1);
        if (num < 1) {
            errors.push('Le numéro de groupe doit être un nombre positif');
        }
    }

    return errors;
}

async function validerFormulaire() {
    const errors = validateForm();

    if (errors.length > 0) {
        alert('Erreurs de validation :\n\n' + errors.join('\n'));
        return;
    }

    const numeroGroupeEl = document.getElementById('numeroGroupe');
    const numeroGroupeRaw = validateInput((numeroGroupeEl?.value || '').trim(), 10);
    const numeroGroupe = numeroGroupeRaw ? safeParseInt(numeroGroupeRaw, 0, 1) : 0;
    const modaliteConstitution = getCheckboxValues('modaliteConstitution');
    const typeFormation = getRadioValue('typeFormation');
    const dureeFormationEl = document.getElementById('dureeFormation');
    const dureeFormation = dureeFormationEl?.value || '';
    const modalitesFormation = getCheckboxValues('modalitesFormation');
    const objetsTransversaux = getCheckboxValues('objetsTransversaux');
    const themesFormation = getCheckboxValues('themesFormation');
    const anneeScolaireEl = document.getElementById('anneeScolaire');
    const anneeScolaire = validateInput(anneeScolaireEl?.value || '', 50);
    const dispositifGAIAEl = document.getElementById('dispositifGAIA');
    const dispositifGAIA = validateInput((dispositifGAIAEl?.value || '').trim(), 10);
    const moduleGAIAEl = document.getElementById('moduleGAIA');
    const moduleGAIA = validateInput((moduleGAIAEl?.value || '').trim(), 5);
    const formateurs = getFormateurs();

    const selectedEnseignants = Array.from(enseignantsMap.entries())
        .filter(([id, data]) => data.selected);

    const nbEcoles = selectedEcoles.length;
    const nbPE = selectedEnseignants.length;

    // Générer un identifiant unique pour cette fiche basé sur l'horodatage
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const ficheId = `${year}${month}${day}${hours}${minutes}${seconds}${random}`;

    // Gestion des formateurs : créer ceux qui n'existent pas et récupérer les IDs
    const formateurIds = [];
    if (formateurs.length > 0) {
        try {
            for (const formateurNom of formateurs) {
                // Chercher si le formateur existe déjà
                let formateur = formateursData.find(f => f.nom === formateurNom);

                if (!formateur) {
                    // Créer le nouveau formateur
                    const result = await grist.docApi.applyUserActions([
                        ['AddRecord', 'Formateurs', null, { Formateur: formateurNom }]
                    ]);
                    const newId = result.retValues[0];
                    formateur = { id: newId, nom: formateurNom };
                    formateursData.push(formateur);
                }

                formateurIds.push(formateur.id);
            }
        } catch (error) {
            console.error('Erreur lors de la création des formateurs:', error);
            alert('Erreur lors de la création des formateurs. Consultez la console pour plus de détails.');
            return;
        }
    }

    const records = [];

    for (const [ensId, ensData] of selectedEnseignants) {
        const enseignant = enseignantsData.find(e => e.id === ensId);
        if (!enseignant) continue;

        const ecole = selectedEcoles.find(e => e.id === enseignant.ecole);
        if (!ecole) continue;

        const record = {
            ID_fiche: ficheId,
            Departement: ecole.departement,
            Circonscription: ['L', ecole.circonscription],
            Ecole: ecole.id,
            Nb_ecoles: nbEcoles,
            Nb_PE: nbPE,
            Nom_PE: ensId,
            Prenom_PE: ensId,
            Niveau_classe: ['L', ...ensData.niveaux],
            Modalite_de_constitution_du_groupe: ['L', ...modaliteConstitution],
            Type_de_formation: typeFormation,
            Temps_de_formation: parseInt(dureeFormation),
            Modalites_de_formation: ['L', ...modalitesFormation],
            Objets_transversaux_traites_en_parallele: ['L', ...objetsTransversaux],
            Theme_s_traite_s_en_formation: ['L', ...themesFormation],
            Annee: anneeScolaire
        };

        if (numeroGroupe > 0) {
            record.Numero_de_groupe = numeroGroupe;
        }

        if (dispositifGAIA) {
            record.Dispositif_GAIA = dispositifGAIA;
        }

        if (moduleGAIA) {
            record.Module_GAIA = moduleGAIA;
        }

        if (formateurIds.length > 0) {
            record['Formateur_s_'] = ['L', ...formateurIds];
        }

        records.push(record);
    }

    try {
        await grist.docApi.applyUserActions([
            ['BulkAddRecord', 'Tableau_de_bord', records.map(() => null), records.reduce((acc, record) => {
                Object.keys(record).forEach(key => {
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(record[key]);
                });
                return acc;
            }, {})]
        ]);

        alert(`✓ ${records.length} ligne(s) créée(s) avec succès dans le Tableau de bord !`);

        resetForm();

    } catch (error) {
        console.error('Erreur lors de la création des enregistrements:', error);
        alert('Erreur lors de la création des enregistrements. Consultez la console pour plus de détails.');
    }
}

function resetForm() {
    const anneeScolaireEl = document.getElementById('anneeScolaire');
    if (anneeScolaireEl) anneeScolaireEl.value = '';
    const anneeErrorEl = document.getElementById('anneeError');
    if (anneeErrorEl) anneeErrorEl.style.display = 'none';
    const nbEcolesEl = document.getElementById('nbEcoles');
    if (nbEcolesEl) nbEcolesEl.value = 1;
    const numeroGroupeEl = document.getElementById('numeroGroupe');
    if (numeroGroupeEl) numeroGroupeEl.value = '';
    const searchEcoleEl = document.getElementById('searchEcole');
    if (searchEcoleEl) searchEcoleEl.value = '';

    // Uncheck all checkboxes
    document.querySelectorAll('#modaliteConstitution input').forEach(cb => cb.checked = false);
    document.querySelectorAll('#objetsTransversaux input').forEach(cb => cb.checked = false);
    document.querySelectorAll('#modalitesFormation input').forEach(cb => cb.checked = false);
    document.querySelectorAll('#themesFormation input').forEach(cb => cb.checked = false);

    // Reset radio buttons - correction ici
    const radioButtons = document.querySelectorAll('input[name="typeFormation"]');
    if (radioButtons.length > 0) {
        radioButtons.forEach(radio => radio.checked = false);
    }

    // Reset durée de formation
    const dureeFormationEl = document.getElementById('dureeFormation');
    if (dureeFormationEl) dureeFormationEl.value = '';
    const dureeErrorEl = document.getElementById('dureeError');
    if (dureeErrorEl) dureeErrorEl.style.display = 'none';

    // Reset filters to checked
    const filterFrancaisEl = document.getElementById('filterFrancais');
    if (filterFrancaisEl) filterFrancaisEl.checked = true;
    const filterMathematiquesEl = document.getElementById('filterMathematiques');
    if (filterMathematiquesEl) filterMathematiquesEl.checked = true;

    filterThemes();

    // Reset GAIA fields
    const dispositifGAIAEl = document.getElementById('dispositifGAIA');
    if (dispositifGAIAEl) dispositifGAIAEl.value = '';
    const moduleGAIAEl = document.getElementById('moduleGAIA');
    if (moduleGAIAEl) moduleGAIAEl.value = '';
    const dispositifErrorEl = document.getElementById('dispositifError');
    if (dispositifErrorEl) dispositifErrorEl.style.display = 'none';
    const moduleErrorEl = document.getElementById('moduleError');
    if (moduleErrorEl) moduleErrorEl.style.display = 'none';

    // Reset formateurs
    const formateursContainerEl = document.getElementById('formateursInputsContainer');
    if (formateursContainerEl) formateursContainerEl.innerHTML = '';
    addFormateurField();

    selectedEcoles = [];
    enseignantsMap.clear();

    displaySelectedEcoles();
    updateEnseignantsList();
    updateEcolesSelection();
}

document.addEventListener('click', function (event) {
    const searchResults = document.getElementById('searchResults');
    const searchInput = document.getElementById('searchEcole');

    if (!searchResults.contains(event.target) && event.target !== searchInput) {
        searchResults.style.display = 'none';
        filteredResults = [];
        activeResultIndex = -1;
    }

    // Fermer les résultats de recherche de formateurs si on clique ailleurs
    if (!event.target.classList.contains('formateur-input')) {
        document.querySelectorAll('[id^="formateurResults_"]').forEach(div => {
            div.style.display = 'none';
        });
        filteredFormateurResults = [];
        activeFormateurResultIndex = -1;
    }
});

// Ajouter les écouteurs pour les radios de type de formation
document.querySelectorAll('input[name="typeFormation"]').forEach(radio => {
    radio.addEventListener('change', updateDureeFormation);
});

// Ajouter les écouteurs pour les filtres de thèmes
document.getElementById('filterFrancais').addEventListener('change', filterThemes);
document.getElementById('filterMathematiques').addEventListener('change', filterThemes);

loadData();
filterThemes();
addFormateurField();

// ===== FONCTIONS POUR L'ONGLET MODIFICATION =====

function switchTab(tabName) {
    // Gérer les boutons d'onglet - on utilise le nom pour trouver le bon bouton
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
        // Réactiver le bouton correspondant au tabName
        const btnText = btn.textContent.toLowerCase();
        if ((tabName === 'create' && btnText.includes('créer')) ||
            (tabName === 'edit' && btnText.includes('modifier'))) {
            btn.classList.add('active');
        }
    });

    // Gérer le contenu
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    if (tabName === 'create') {
        document.getElementById('createTab').classList.add('active');
    } else {
        document.getElementById('editTab').classList.add('active');
        updateFilteredRecords();
    }
}

function getFilteredRecords() {
    return tableauDeBordData.filter(record => {
        // Filtrer par formateur
        if (editFilters.formateur) {
            const formateurIds = Array.isArray(record.formateurs) ? record.formateurs : [];
            const formateur = formateursData.find(f => f.nom === editFilters.formateur);
            if (!formateur || !formateurIds.includes(formateur.id)) {
                return false;
            }
        }

        // Filtrer par année
        if (editFilters.annee && record.annee !== editFilters.annee) {
            return false;
        }

        // Filtrer par école
        if (editFilters.ecole) {
            const ecole = ecolesData.find(e => e.commune_complement === editFilters.ecole);
            if (!ecole || record.ecole !== ecole.id) {
                return false;
            }
        }

        // Filtrer par type de formation
        if (editFilters.typeFormation && record.typeFormation !== editFilters.typeFormation) {
            return false;
        }

        // Filtrer par dispositif GAIA
        if (editFilters.dispositif && record.dispositifGAIA !== editFilters.dispositif) {
            return false;
        }

        // Filtrer par module GAIA
        if (editFilters.module && record.moduleGAIA !== editFilters.module) {
            return false;
        }

        return true;
    });
}

function getAvailableFormateurs() {
    const filtered = getFilteredRecords();
    const formateursIds = new Set();

    filtered.forEach(record => {
        const ids = Array.isArray(record.formateurs) ? record.formateurs : [];
        ids.forEach(id => formateursIds.add(id));
    });

    return formateursData
        .filter(f => formateursIds.has(f.id))
        .map(f => f.nom)
        .sort();
}

function getAvailableAnnees() {
    const filtered = getFilteredRecords();
    return [...new Set(filtered.map(r => r.annee))].filter(a => a).sort();
}

function getAvailableEcoles() {
    const filtered = getFilteredRecords();
    const ecoleIds = new Set(filtered.map(r => r.ecole));
    return ecolesData
        .filter(e => ecoleIds.has(e.id))
        .map(e => e.commune_complement)
        .sort();
}

function getAvailableTypeFormations() {
    const filtered = getFilteredRecords();
    return [...new Set(filtered.map(r => r.typeFormation))].filter(t => t).sort();
}

function getAvailableDispositifs() {
    const filtered = getFilteredRecords();
    return [...new Set(filtered.map(r => r.dispositifGAIA))].filter(d => d).sort();
}

function getAvailableModules() {
    const filtered = getFilteredRecords();
    return [...new Set(filtered.map(r => r.moduleGAIA))].filter(m => m).sort();
}

function searchFilterFormateur(event) {
    searchFilter(event, 'formateur', 'filterFormateur', 'filterFormateurResults', getAvailableFormateurs());
}

function searchFilterAnnee(event) {
    searchFilter(event, 'annee', 'filterAnnee', 'filterAnneeResults', getAvailableAnnees());
}

function searchFilterEcole(event) {
    searchFilter(event, 'ecole', 'filterEcole', 'filterEcoleResults', getAvailableEcoles());
}

function searchFilterTypeFormation(event) {
    searchFilter(event, 'typeFormation', 'filterTypeFormation', 'filterTypeFormationResults', getAvailableTypeFormations());
}

function searchFilterDispositif(event) {
    searchFilter(event, 'dispositif', 'filterDispositif', 'filterDispositifResults', getAvailableDispositifs());
}

function searchFilterModule(event) {
    searchFilter(event, 'module', 'filterModule', 'filterModuleResults', getAvailableModules());
}

function searchFilter(event, filterType, inputId, resultsId, availableValues) {
    const searchTerm = event.target.value.toLowerCase().trim();
    const resultsDiv = document.getElementById(resultsId);

    // Gestion de la navigation clavier
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (filteredFilterResults.length > 0) {
            activeFilterResultIndex = Math.min(activeFilterResultIndex + 1, filteredFilterResults.length - 1);
            updateActiveFilterResult(resultsDiv);
        }
        return;
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (filteredFilterResults.length > 0) {
            activeFilterResultIndex = Math.max(activeFilterResultIndex - 1, 0);
            updateActiveFilterResult(resultsDiv);
        }
        return;
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        if (filteredFilterResults.length > 0 && activeFilterResultIndex >= 0) {
            selectFilter(filterType, filteredFilterResults[activeFilterResultIndex], inputId, resultsId);
        }
        return;
    }

    if (searchTerm.length < 1) {
        resultsDiv.style.display = 'none';
        filteredFilterResults = [];
        activeFilterResultIndex = -1;
        return;
    }

    filteredFilterResults = availableValues.filter(v => v.toLowerCase().includes(searchTerm));

    if (filteredFilterResults.length === 0) {
        resultsDiv.style.display = 'none';
        activeFilterResultIndex = -1;
        return;
    }

    activeFilterResultIndex = 0;

    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    // SÉCURITÉ : Les valeurs de filtres sont échappées via escapeHtml() et escapeHtmlAttribute()
    resultsDiv.innerHTML = filteredFilterResults.map((value, index) =>
        `<div class="search-result-item ${index === 0 ? 'active' : ''}" 
             data-filter-type="${escapeHtmlAttribute(filterType)}"
             data-filter-value="${escapeHtmlAttribute(value)}"
             data-input-id="${escapeHtmlAttribute(inputId)}"
             data-results-id="${escapeHtmlAttribute(resultsId)}"
             data-index="${index}">
            ${escapeHtml(value)}
        </div>`
    ).join('');

    // Ajouter les event listeners après insertion
    resultsDiv.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            const fType = item.getAttribute('data-filter-type');
            const fValue = item.getAttribute('data-filter-value');
            const inId = item.getAttribute('data-input-id');
            const resId = item.getAttribute('data-results-id');
            selectFilter(fType, fValue, inId, resId);
        });
    });

    resultsDiv.style.display = 'block';
}

function updateActiveFilterResult(resultsDiv) {
    const items = resultsDiv.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
        if (index === activeFilterResultIndex) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('active');
        }
    });
}

function selectFilter(filterType, value, inputId, resultsId) {
    editFilters[filterType] = value;
    document.getElementById(inputId).value = value;
    document.getElementById(resultsId).style.display = 'none';
    filteredFilterResults = [];
    activeFilterResultIndex = -1;

    updateFilterDisplay();
    updateFilteredRecords();
}

function removeFilter(filterType) {
    editFilters[filterType] = '';
    const inputIds = {
        formateur: 'filterFormateur',
        annee: 'filterAnnee',
        ecole: 'filterEcole',
        typeFormation: 'filterTypeFormation',
        dispositif: 'filterDispositif',
        module: 'filterModule'
    };

    document.getElementById(inputIds[filterType]).value = '';
    updateFilterDisplay();
    updateFilteredRecords();
}

function updateFilterDisplay() {
    const container = document.getElementById('selectedFilters');
    const filters = [];

    if (editFilters.formateur) filters.push({ label: 'Formateur', value: editFilters.formateur, type: 'formateur' });
    if (editFilters.annee) filters.push({ label: 'Année', value: editFilters.annee, type: 'annee' });
    if (editFilters.ecole) filters.push({ label: 'École', value: editFilters.ecole, type: 'ecole' });
    if (editFilters.typeFormation) filters.push({ label: 'Type de formation', value: editFilters.typeFormation, type: 'typeFormation' });
    if (editFilters.dispositif) filters.push({ label: 'Dispositif', value: editFilters.dispositif, type: 'dispositif' });
    if (editFilters.module) filters.push({ label: 'Module', value: editFilters.module, type: 'module' });

    if (filters.length === 0) {
        container.innerHTML = '';
        return;
    }

    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    // SÉCURITÉ : f.label, f.value et f.type sont échappés via escapeHtml() et escapeHtmlAttribute()
    container.innerHTML = '<p style="font-weight: 600; margin-bottom: 10px;">Filtres actifs :</p>' +
        filters.map(f =>
            `<span class="filter-badge">${escapeHtml(f.label)}: ${escapeHtml(f.value)}<button data-filter-type="${escapeHtmlAttribute(f.type)}">×</button></span>`
        ).join('');

    // Ajouter les event listeners pour les boutons de suppression
    container.querySelectorAll('button[data-filter-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            const filterType = btn.getAttribute('data-filter-type');
            if (filterType) removeFilter(filterType);
        });
    });
}

function updateFilteredRecords() {
    // Vérifier si au moins un filtre est actif
    const hasActiveFilter = editFilters.formateur || editFilters.annee || editFilters.ecole || editFilters.typeFormation || editFilters.dispositif || editFilters.module;

    const container = document.getElementById('recordsList');
    const editFormContainer = document.getElementById('editFormContainer');

    if (!hasActiveFilter) {
        container.innerHTML = '<div class="no-records">Saisissez au moins un filtre pour afficher les fiches</div>';
        editFormContainer.innerHTML = '';
        selectedRecordId = null;
        return;
    }

    const records = getFilteredRecords();

    if (records.length === 0) {
        container.innerHTML = '<div class="no-records">Aucune fiche ne correspond aux critères de recherche</div>';
        editFormContainer.innerHTML = '';
        selectedRecordId = null;
        return;
    }

    // Regrouper par ID_fiche
    const fichesMap = new Map();
    records.forEach(record => {
        if (!record.idFiche) return;
        if (!fichesMap.has(record.idFiche)) {
            fichesMap.set(record.idFiche, []);
        }
        fichesMap.get(record.idFiche).push(record);
    });

    const fiches = Array.from(fichesMap.values());

    if (fiches.length === 0) {
        container.innerHTML = '<div class="no-records">Aucune fiche ne correspond aux critères de recherche</div>';
        editFormContainer.innerHTML = '';
        selectedRecordId = null;
        return;
    }

    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    // SÉCURITÉ : Template avec 10+ variables dynamiques, toutes échappées.
    // Les données proviennent de tableauDeBordData qui sont sanitisées via sanitizeGristData().
    container.innerHTML = fiches.map(ficheRecords => {
        const firstRecord = ficheRecords[0];
        const ecoleIds = [...new Set(ficheRecords.map(r => r.ecole))];
        const ecoles = ecoleIds.map(id => ecolesData.find(e => e.id === id)?.commune_complement).filter(n => n);
        const ecolesText = ecoles.length > 1 ? `${ecoles.length} écoles` : ecoles[0] || 'N/A';

        // Filtrer le 'L' de Grist dans les tableaux
        const modalites = (firstRecord.modaliteConstitution || []).filter(v => v !== 'L').map(v => escapeHtml(v)).join(', ') || 'N/A';
        const modalitesForm = (firstRecord.modalitesFormation || []).filter(v => v !== 'L').map(v => escapeHtml(v)).join(',') || 'N/A';

        return `
            <div class="record-item" data-fiche-id="${escapeHtmlAttribute(firstRecord.idFiche)}">
                <div class="record-info">
                    <div class="record-title">${escapeHtml(ecolesText)}</div>
                    <div class="record-details">
                        ${escapeHtml(firstRecord.annee)} | ${modalites}<br>
                        ${escapeHtml(firstRecord.typeFormation)} | ${escapeHtml(firstRecord.tempsFormation)}h | ${modalitesForm}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Ajouter les event listeners après insertion
    container.querySelectorAll('.record-item').forEach(item => {
        item.addEventListener('click', () => {
            const ficheId = validateInput(item.getAttribute('data-fiche-id'), 50);
            if (ficheId) selectFiche(ficheId);
        });
    });
}

function selectFiche(idFiche) {
    const ficheRecords = tableauDeBordData.filter(r => r.idFiche === idFiche);
    if (ficheRecords.length > 0) {
        displayEditForm(ficheRecords);
    }
}

function displayEditForm(ficheRecords) {
    // ficheRecords est un tableau de toutes les lignes de la fiche
    originalRecordData = JSON.parse(JSON.stringify(ficheRecords));
    const firstRecord = ficheRecords[0];

    // Récupérer les écoles uniques de la fiche
    const ecoleIds = [...new Set(ficheRecords.map(r => r.ecole))];
    const ecoles = ecoleIds.map(id => ecolesData.find(e => e.id === id)).filter(e => e);

    // Récupérer les enseignants de la fiche
    const enseignantIds = ficheRecords.map(r => r.nomPE);
    const enseignants = enseignantIds.map(id => enseignantsData.find(e => e.id === id)).filter(e => e);

    // Récupérer les formateurs
    const formateurIds = [...new Set(firstRecord.formateurs)];
    const formateurNoms = formateurIds
        .map(id => formateursData.find(f => f.id === id)?.nom)
        .filter(n => n);

    const container = document.getElementById('editFormContainer');
    container.innerHTML = `
        <div class="edit-form">
            <h3>Modification de la fiche ${escapeHtml(firstRecord.idFiche)}</h3>
            <input type="hidden" id="editFicheId" value="${escapeHtmlAttribute(firstRecord.idFiche)}">
            
            <div class="form-group_small">
                <label>Année scolaire *</label>
                <select id="editAnnee">
                    <option value="2026-2027" ${firstRecord.annee === '2026-2027' ? 'selected' : ''}>2026-2027</option>
                    <option value="2027-2028" ${firstRecord.annee === '2027-2028' ? 'selected' : ''}>2027-2028</option>
                    <option value="2028-2029" ${firstRecord.annee === '2028-2029' ? 'selected' : ''}>2028-2029</option>
                    <option value="2029-2030" ${firstRecord.annee === '2029-2030' ? 'selected' : ''}>2029-2030</option>
                </select>
            </div>
            
            <div class="form-group_small">
                <label>Nombre d'écoles *</label>
                <input type="number" id="editNbEcoles" value="${escapeHtmlAttribute(firstRecord.nbEcoles)}" min="1" disabled style="background: #f0f0f0;">
            </div>
            <div class="form-group">
                <small style="color: black;"><b>Les écoles de cette fiche : </b>${ecoles.map(e => escapeHtml(e.commune_complement)).join(', ')}</small>
            </div>
            
            <div class="form-group">
                <label>Enseignants concernés</label>
                <div id="editEnseignantsContainer">
                    ${(() => {
            // Récupérer tous les enseignants des écoles concernées
            const allEnseignants = enseignantsData.filter(ens => ecoleIds.includes(ens.ecole));

            return allEnseignants.map((ens, idx) => {
                // Vérifier si l'enseignant est dans la fiche
                const recordForEns = ficheRecords.find(rec => rec.nomPE === ens.id);
                const isSelected = !!recordForEns;
                const ecole = ecolesData.find(e => e.id === ens.ecole);
                const niveauxActuels = recordForEns ? recordForEns.niveauClasse || [] : [];

                const opacity = isSelected ? '1' : '0.5';
                const niveauxDisplay = isSelected ? 'block' : 'none';

                return `
                <div class="enseignant-edit-item" style="margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background: #fff; opacity: ${opacity};">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" id="editEns_${idx}" class="edit-ens-checkbox" data-ens-id="${escapeHtmlAttribute(ens.id)}" data-idx="${idx}" ${isSelected ? 'checked' : ''}>
                        <div style="font-weight: 600; color: #333;">${escapeHtml(ens.nom)} ${escapeHtml(ens.prenom)} - ${ecole ? escapeHtml(ecole.commune_complement) : 'N/A'}</div>
                    </div>
                    <div id="editNiveaux_${idx}" style="margin-top: 5px; display: ${niveauxDisplay};">
                        <label style="font-size: 14px; color: #555;">Niveaux de classe :</label>
                        <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: 5px;">
                            ${NIVEAUX_POSSIBLES.map(niveau => `
                                <label style="display: flex; align-items: center; gap: 5px; color: #333;"><input type="checkbox" class="edit-niveau-${idx}" value="${escapeHtmlAttribute(niveau)}" ${niveauxActuels.includes(niveau) ? 'checked' : ''}> ${escapeHtml(niveau)}</label>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
            }).join('');
        })()}
                </div>
            </div>
            </div>
            
            <div class="form-group">
                <label>Numéro de groupe</label>
                <input type="number" id="editNumeroGroupe" value="${escapeHtmlAttribute(firstRecord.numeroGroupe || '')}" min="1">
            </div>
            
            <div class="form-group">
                <label>Modalité de constitution du groupe *</label>
                <div class="checkbox-group">
                    <label><input type="checkbox" class="edit-modalite" value="de secteur" ${(firstRecord.modaliteConstitution || []).includes('de secteur') ? 'checked' : ''}> de secteur</label>
                    <label><input type="checkbox" class="edit-modalite" value="d'école" ${(firstRecord.modaliteConstitution || []).includes("d'école") ? 'checked' : ''}> d'école</label>
                    <label><input type="checkbox" class="edit-modalite" value="de niveau" ${(firstRecord.modaliteConstitution || []).includes('de niveau') ? 'checked' : ''}> de niveau</label>
                    <label><input type="checkbox" class="edit-modalite" value="de cycles" ${(firstRecord.modaliteConstitution || []).includes('de cycles') ? 'checked' : ''}> de cycles</label>
                    <label><input type="checkbox" class="edit-modalite" value="intercycles" ${(firstRecord.modaliteConstitution || []).includes('intercycles') ? 'checked' : ''}> intercycles</label>
                </div>
            </div>
            
            <div class="form-group">
                <label>Type de formation *</label>
                <div class="radio-group">
                    <label><input type="radio" name="editTypeFormation" value="Constellation" ${firstRecord.typeFormation === 'Constellation' ? 'checked' : ''}> Constellation</label>
                    <label><input type="radio" name="editTypeFormation" value="Résidence pédagogique" ${firstRecord.typeFormation === 'Résidence pédagogique' ? 'checked' : ''}> Résidence pédagogique</label>
                    <label><input type="radio" name="editTypeFormation" value="Animations pédagogiques" ${firstRecord.typeFormation === 'Animations pédagogiques' ? 'checked' : ''}> Animations pédagogiques</label>
                    <label><input type="radio" name="editTypeFormation" value="Accompagnement de proximité" ${firstRecord.typeFormation === 'Accompagnement de proximité' ? 'checked' : ''}> Accompagnement de proximité</label>
                </div>
            </div>
            
            <div class="form-group">
                <label>Durée de la formation *</label>
                <select id="editDuree">
                    <option value="6" ${firstRecord.tempsFormation === 6 ? 'selected' : ''}>6h</option>
                    <option value="12" ${firstRecord.tempsFormation === 12 ? 'selected' : ''}>12h</option>
                    <option value="18" ${firstRecord.tempsFormation === 18 ? 'selected' : ''}>18h</option>
                    <option value="24" ${firstRecord.tempsFormation === 24 ? 'selected' : ''}>24h</option>
                    <option value="30" ${firstRecord.tempsFormation === 30 ? 'selected' : ''}>30h</option>
                </select>
            </div>
            
            <div class="form-group">
                <label>Modalités de formation *</label>
                <div class="checkbox-group">
                    <label><input type="checkbox" class="edit-Modalites" name="editModalites" value="Présentiel" ${(firstRecord.modalitesFormation || []).includes('Présentiel') ? 'checked' : ''}> Présentiel</label>
                    <label><input type="checkbox" class="edit-Modalites" name="editModalites" value="Distanciel synchrone" ${(firstRecord.modalitesFormation || []).includes('Distanciel synchrone') ? 'checked' : ''}> Distanciel synchrone</label>
                    <label><input type="checkbox" class="edit-Modalites" name="editModalites" value="Distanciel asynchrone" ${(firstRecord.modalitesFormation || []).includes('Distanciel asynchrone') ? 'checked' : ''}> Distanciel asynchrone</label>
                    <label><input type="checkbox" class="edit-Modalites" name="editModalites" value="Hybride" ${(firstRecord.modalitesFormation || []).includes('Hybride') ? 'checked' : ''}> Hybride</label>
                </div>
            </div>
            
            <div class="form-group">
                <label>Objets transversaux traités en parallèle *</label>
                <div class="checkbox-group">
                    <label><input type="checkbox" class="edit-objets" value="Fonctions cognitives transversales" ${(firstRecord.objetsTransversaux || []).includes('Fonctions cognitives transversales') ? 'checked' : ''}> Fonctions cognitives transversales</label>
                    <label><input type="checkbox" class="edit-objets" value="Compétences psycho-sociales" ${(firstRecord.objetsTransversaux || []).includes('Compétences psycho-sociales') ? 'checked' : ''}> Compétences psycho-sociales</label>
                    <label><input type="checkbox" class="edit-objets" value="Besoins et développement" ${(firstRecord.objetsTransversaux || []).includes('Besoins et développement') ? 'checked' : ''}> Besoins et développement</label>
                    <label><input type="checkbox" class="edit-objets" value="Métacognition" ${(firstRecord.objetsTransversaux || []).includes('Métacognition') ? 'checked' : ''}> Métacognition</label>
                    <label><input type="checkbox" class="edit-objets" value="Modalités d'apprentissage" ${(firstRecord.objetsTransversaux || []).includes("Modalités d'apprentissage") ? 'checked' : ''}> Modalités d'apprentissage</label>
                    <label><input type="checkbox" class="edit-objets" value="Observation active" ${(firstRecord.objetsTransversaux || []).includes('Observation active') ? 'checked' : ''}> Observation active</label>
                </div>
            </div>
            
            <div class="form-group">
                <label>Thème(s) traité(s) en formation *</label>
                <div class="checkbox-group" id="editThemesFormation">
                    <label><input type="checkbox" class="edit-themes" value="FRA - Lecture" ${(firstRecord.themes || []).includes('FRA - Lecture') ? 'checked' : ''}> FRA - Lecture</label>
                    <label><input type="checkbox" class="edit-themes" value="FRA - Vocabulaire" ${(firstRecord.themes || []).includes('FRA - Vocabulaire') ? 'checked' : ''}> FRA - Vocabulaire</label>
                    <label><input type="checkbox" class="edit-themes" value="FRA - Langage Oral" ${(firstRecord.themes || []).includes('FRA - Langage Oral') ? 'checked' : ''}> FRA - Langage Oral</label>
                    <label><input type="checkbox" class="edit-themes" value="FRA - S'éveiller à la diversité linguistique" ${(firstRecord.themes || []).includes("FRA - S'éveiller à la diversité linguistique") ? 'checked' : ''}> FRA - S'éveiller à la diversité linguistique</label>
                    <label><input type="checkbox" class="edit-themes" value="FRA - Écriture" ${(firstRecord.themes || []).includes('FRA - Écriture') ? 'checked' : ''}> FRA - Écriture</label>
                    <label><input type="checkbox" class="edit-themes" value="FRA - Grammaire et orthographe" ${(firstRecord.themes || []).includes('FRA - Grammaire et orthographe') ? 'checked' : ''}> FRA - Grammaire et orthographe</label>
                    <label><input type="checkbox" class="edit-themes" value="MA - Algèbre et pré-algèbre (motifs organisés)" ${(firstRecord.themes || []).includes('MA - Algèbre et pré-algèbre (motifs organisés)') ? 'checked' : ''}> MA - Algèbre et pré-algèbre (motifs organisés)</label>
                    <label><input type="checkbox" class="edit-themes" value="MA - Calcul" ${(firstRecord.themes || []).includes('MA - Calcul') ? 'checked' : ''}> MA - Calcul</label>
                    <label><input type="checkbox" class="edit-themes" value="MA - Espace et géométrie" ${(firstRecord.themes || []).includes('MA - Espace et géométrie') ? 'checked' : ''}> MA - Espace et géométrie</label>
                    <label><input type="checkbox" class="edit-themes" value="MA - Faits numériques / automatisation" ${(firstRecord.themes || []).includes('MA - Faits numériques / automatisation') ? 'checked' : ''}> MA - Faits numériques / automatisation</label>
                    <label><input type="checkbox" class="edit-themes" value="MA - Grandeurs et mesures" ${(firstRecord.themes || []).includes('MA - Grandeurs et mesures') ? 'checked' : ''}> MA - Grandeurs et mesures</label>
                    <label><input type="checkbox" class="edit-themes" value="MA - Nombres" ${(firstRecord.themes || []).includes('MA - Nombres') ? 'checked' : ''}> MA - Nombres</label>
                    <label><input type="checkbox" class="edit-themes" value="MA - Organisation et gestion des données" ${(firstRecord.themes || []).includes('MA - Organisation et gestion des données') ? 'checked' : ''}> MA - Organisation et gestion des données</label>
                    <label><input type="checkbox" class="edit-themes" value="MA - Résolution de problèmes" ${(firstRecord.themes || []).includes('MA - Résolution de problèmes') ? 'checked' : ''}> MA - Résolution de problèmes</label>
                    <label><input type="checkbox" class="edit-themes" value="MA - Probabilités" ${(firstRecord.themes || []).includes('MA - Probabilités') ? 'checked' : ''}> MA - Probabilités</label>
                    <label><input type="checkbox" class="edit-themes" value="MA - Proportionnalité" ${(firstRecord.themes || []).includes('MA - Proportionnalité') ? 'checked' : ''}> MA - Proportionnalité</label>
                </div>
            </div>
            
            <div class="form-group">
                <label>Dispositif GAIA</label>
                <input type="text" id="editDispositif" value="${escapeHtmlAttribute(firstRecord.dispositifGAIA || '')}" maxlength="10">
            </div>
            
            <div class="form-group">
                <label>Module GAIA</label>
                <input type="text" id="editModule" value="${escapeHtmlAttribute(firstRecord.moduleGAIA || '')}" maxlength="5">
            </div>
            
            <div class="form-group">
                <label>Formateur(s)</label>
                <div id="editFormateursContainer">
                    ${formateurNoms.length > 0 ? formateurNoms.map((nom, index) => `
                        <div class="formateur-field">
                            <input type="text" class="search-input edit-formateur-input" value="${escapeHtmlAttribute(nom)}" placeholder="Formateur...">
                        </div>
                    `).join('') : '<div class="formateur-field"><input type="text" class="search-input edit-formateur-input" placeholder="Formateur..."></div>'}
                </div>
                <button type="button" id="addEditFormateurBtn" style="width: auto; padding: 8px 20px; margin-top: 10px; background: #16a085;">+ Ajouter un formateur</button>
            </div>
            
            <button class="btnValider" id="updateFicheBtn" style="width: 100%; background: #e67e22;">Mettre à jour la fiche</button>
        </div>
    `;

    // Ajouter les event listeners après l'insertion du HTML

    // Event listener pour les checkboxes des enseignants
    container.querySelectorAll('.edit-ens-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const idx = safeParseInt(checkbox.getAttribute('data-idx'), -1, 0);
            if (idx >= 0) toggleEditEnseignant(idx);
        });
    });

    // Event listener pour le bouton d'ajout de formateur
    const addFormateurBtn = document.getElementById('addEditFormateurBtn');
    if (addFormateurBtn) {
        addFormateurBtn.addEventListener('click', addEditFormateurField);
    }

    // Event listener pour le bouton de mise à jour
    const updateBtn = document.getElementById('updateFicheBtn');
    if (updateBtn) {
        updateBtn.addEventListener('click', updateFiche);
    }
}

function toggleEditEnseignant(index) {
    const checkbox = document.getElementById(`editEns_${index}`);
    const niveauxDiv = document.getElementById(`editNiveaux_${index}`);
    const enseignantItem = checkbox.closest('.enseignant-edit-item');

    if (checkbox.checked) {
        enseignantItem.style.opacity = '1';
        niveauxDiv.style.display = 'block';
    } else {
        enseignantItem.style.opacity = '0.5';
        niveauxDiv.style.display = 'none';
    }
}

function addEditFormateurField() {
    const container = document.getElementById('editFormateursContainer');
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'formateur-field';
    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    // SÉCURITÉ : Template statique sans données dynamiques
    fieldDiv.innerHTML = '<input type="text" class="search-input edit-formateur-input" placeholder="Formateur...">';
    container.appendChild(fieldDiv);
}

async function updateFiche() {
    const idFiche = validateInput(document.getElementById('editFicheId').value, 50);
    if (!idFiche || !originalRecordData || originalRecordData.length === 0) {
        alert('Erreur: Aucune fiche sélectionnée');
        return;
    }

    // Récupérer les écoles uniques de la fiche
    const ecoleIds = [...new Set(originalRecordData.map(r => r.ecole))];

    // Récupérer toutes les valeurs du formulaire
    const annee = validateInput(document.getElementById('editAnnee').value, 50);
    const numeroGroupeRaw = validateInput(document.getElementById('editNumeroGroupe').value.trim(), 10);
    const numeroGroupe = numeroGroupeRaw ? safeParseInt(numeroGroupeRaw, 0, 1) : 0;
    const modaliteConstitution = Array.from(document.querySelectorAll('.edit-modalite:checked')).map(cb => cb.value);
    const typeFormation = document.querySelector('input[name="editTypeFormation"]:checked')?.value || '';
    const tempsFormation = safeParseInt(document.getElementById('editDuree').value, 0, 0);
    const modalitesFormation = Array.from(document.querySelectorAll('.edit-Modalites:checked')).map(cb => cb.value);
    const objetsTransversaux = Array.from(document.querySelectorAll('.edit-objets:checked')).map(cb => cb.value);
    const themes = Array.from(document.querySelectorAll('.edit-themes:checked')).map(cb => cb.value);
    const dispositifGAIA = validateInput(document.getElementById('editDispositif').value.trim(), 10);
    const moduleGAIA = validateInput(document.getElementById('editModule').value.trim(), 5);

    // Récupérer les formateurs
    const formateurInputs = document.querySelectorAll('.edit-formateur-input');
    const formateurNoms = Array.from(formateurInputs).map(input => input.value.trim()).filter(v => v);

    // Gérer les formateurs (créer ceux qui n'existent pas)
    const formateurIds = [];
    for (const nom of formateurNoms) {
        let formateur = formateursData.find(f => f.nom === nom);

        if (!formateur) {
            try {
                const result = await grist.docApi.applyUserActions([
                    ['AddRecord', 'Formateurs', null, { Formateur: nom }]
                ]);
                const newId = result.retValues[0];
                formateur = { id: newId, nom };
                formateursData.push(formateur);
            } catch (error) {
                console.error('Erreur création formateur:', error);
                alert('Erreur lors de la création du formateur: ' + nom);
                return;
            }
        }

        formateurIds.push(formateur.id);
    }

    // Récupérer les enseignants sélectionnés et leurs niveaux
    const selectedEnseignantsData = [];
    const enseignantCheckboxes = document.querySelectorAll('.edit-ens-checkbox');
    enseignantCheckboxes.forEach((checkbox, idx) => {
        if (checkbox.checked) {
            const ensId = safeParseInt(checkbox.getAttribute('data-ens-id'), 0, 1);
            if (ensId > 0) {
                const niveaux = Array.from(document.querySelectorAll(`.edit-niveau-${idx}:checked`)).map(cb => cb.value);
                selectedEnseignantsData.push({ ensId, niveaux });
            }
        }
    });

    if (selectedEnseignantsData.length === 0) {
        alert('Vous devez sélectionner au moins un enseignant');
        return;
    }

    // Comparer les changements
    const firstOld = originalRecordData[0];
    const changes = [];

    // Fonction helper pour normaliser et comparer les tableaux
    const arraysEqual = (arr1, arr2) => {
        // Filtrer null, undefined ET le 'L' de Grist
        const a1 = (arr1 || []).filter(v => v !== null && v !== undefined && v !== 'L');
        const a2 = (arr2 || []).filter(v => v !== null && v !== undefined && v !== 'L');
        return JSON.stringify([...a1].sort()) === JSON.stringify([...a2].sort());
    };

    // Vérifier les enseignants ajoutés/supprimés
    const oldEnsIds = originalRecordData.map(r => r.nomPE).sort();
    const newEnsIds = selectedEnseignantsData.map(e => e.ensId).sort();
    if (JSON.stringify(oldEnsIds) !== JSON.stringify(newEnsIds)) {
        const added = newEnsIds.filter(id => !oldEnsIds.includes(id));
        const removed = oldEnsIds.filter(id => !newEnsIds.includes(id));
        if (added.length > 0) changes.push(`Enseignant(s) ajouté(s): ${added.length}`);
        if (removed.length > 0) changes.push(`Enseignant(s) supprimé(s): ${removed.length}`);
    }

    if (annee !== firstOld.annee) changes.push(`Année: ${firstOld.annee} → ${annee}`);
    if (String(numeroGroupe || '') !== String(firstOld.numeroGroupe || '')) changes.push(`Numéro groupe: ${firstOld.numeroGroupe || 'aucun'} → ${numeroGroupe || 'aucun'}`);
    if (!arraysEqual(modaliteConstitution, firstOld.modaliteConstitution)) changes.push('Modalité(s) de constitution modifiée(s)');
    if (typeFormation !== firstOld.typeFormation) changes.push(`Type: ${firstOld.typeFormation || 'aucun'} → ${typeFormation || 'aucun'}`);
    if (tempsFormation !== firstOld.tempsFormation) changes.push(`Durée: ${firstOld.tempsFormation || 0} → ${tempsFormation || 0}`);
    if (!arraysEqual(modalitesFormation, firstOld.modalitesFormation)) changes.push('Modalités de formation modifiées');
    if (!arraysEqual(objetsTransversaux, firstOld.objetsTransversaux)) changes.push('Objet(s) transversaux modifié(s)');
    if (!arraysEqual(themes, firstOld.themes)) changes.push('Thème(s) modifié(s)');
    if (dispositifGAIA !== firstOld.dispositifGAIA) changes.push(`Dispositif GAIA: ${firstOld.dispositifGAIA || 'aucun'} → ${dispositifGAIA || 'aucun'}`);
    if (moduleGAIA !== firstOld.moduleGAIA) changes.push(`Module GAIA: ${firstOld.moduleGAIA || 'aucun'} → ${moduleGAIA || 'aucun'}`);
    if (!arraysEqual(formateurIds, firstOld.formateurs)) changes.push('Formateur(s) modifié(s)');

    // Vérifier les niveaux pour les enseignants communs
    selectedEnseignantsData.forEach(newEns => {
        const oldRec = originalRecordData.find(r => r.nomPE === newEns.ensId);
        if (oldRec && !arraysEqual(newEns.niveaux, oldRec.niveauClasse)) {
            changes.push(`Niveaux modifiés pour un enseignant`);
        }
    });

    if (changes.length === 0) {
        alert('Aucune modification détectée');
        return;
    }

    // Confirmation
    const confirmMsg = `Modifications à apporter sur ${originalRecordData.length} ligne(s):\n\n` + changes.join('\n') + '\n\nConfirmer la mise à jour ?';
    if (!confirm(confirmMsg)) {
        return;
    }

    // Préparer les actions : suppression des anciens, ajout/mise à jour des nouveaux
    try {
        const actions = [];

        // Supprimer toutes les anciennes lignes
        originalRecordData.forEach(oldRec => {
            actions.push(['RemoveRecord', 'Tableau_de_bord', oldRec.id]);
        });

        // Créer les nouvelles lignes pour chaque enseignant sélectionné
        const newRecords = [];
        selectedEnseignantsData.forEach(ensData => {
            const ens = enseignantsData.find(e => e.id === ensData.ensId);
            if (!ens) return;

            const ecole = ecolesData.find(e => e.id === ens.ecole);
            if (!ecole) return;

            const record = {
                ID_fiche: idFiche,
                Departement: ecole.departement,
                Circonscription: ['L', ecole.circonscription],
                Ecole: ecole.id,
                Nb_ecoles: ecoleIds.length,
                Nb_PE: selectedEnseignantsData.length,
                Nom_PE: ensData.ensId,
                Prenom_PE: ensData.ensId,
                Niveau_classe: ['L', ...ensData.niveaux],
                Modalite_de_constitution_du_groupe: ['L', ...modaliteConstitution],
                Type_de_formation: typeFormation,
                Temps_de_formation: tempsFormation,
                Modalites_de_formation: ['L', ...modalitesFormation],
                Objets_transversaux_traites_en_parallele: ['L', ...objetsTransversaux],
                Theme_s_traite_s_en_formation: ['L', ...themes],
                Annee: annee
            };

            if (numeroGroupe > 0) {
                record.Numero_de_groupe = numeroGroupe;
            }

            if (dispositifGAIA) {
                record.Dispositif_GAIA = dispositifGAIA;
            }

            if (moduleGAIA) {
                record.Module_GAIA = moduleGAIA;
            }

            if (formateurIds.length > 0) {
                record['Formateur_s_'] = ['L', ...formateurIds];
            }

            newRecords.push(record);
        });

        // Ajouter les nouvelles lignes en bulk
        if (newRecords.length > 0) {
            actions.push(['BulkAddRecord', 'Tableau_de_bord', newRecords.map(() => null), newRecords.reduce((acc, record) => {
                Object.keys(record).forEach(key => {
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(record[key]);
                });
                return acc;
            }, {})]);
        }

        await grist.docApi.applyUserActions(actions);

        alert(`✓ Fiche ${idFiche} mise à jour avec succès (${selectedEnseignantsData.length} ligne(s)) !`);

        // Recharger les données et réinitialiser
        await loadData();
        editFilters = { formateur: '', annee: '', ecole: '', typeFormation: '', dispositif: '', module: '' };
        document.getElementById('filterFormateur').value = '';
        document.getElementById('filterAnnee').value = '';
        document.getElementById('filterEcole').value = '';
        document.getElementById('filterTypeFormation').value = '';
        document.getElementById('filterDispositif').value = '';
        document.getElementById('filterModule').value = '';
        updateFilterDisplay();
        updateFilteredRecords();

    } catch (error) {
        console.error('Erreur lors de la mise à jour:', error);
        alert('Erreur lors de la mise à jour. Consultez la console pour plus de détails.');
    }
}

// Set up quantity forms
(function () {
    let quantities = document.querySelectorAll('[data-quantity]');

    if (quantities instanceof Node) quantities = [quantities];
    if (quantities instanceof NodeList) quantities = [].slice.call(quantities);
    if (quantities instanceof Array) {
        quantities.forEach((div, index) => {
            if (index === 0) { // nbEcoles
                div.quantity = new QuantityInput(div, {
                    decreaseText: 'Diminuer',
                    increaseText: 'Augmenter',
                    value: 1,
                    min: 1,
                    id: 'nbEcoles'
                });
            } else if (index === 1) { // numeroGroupe
                div.quantity = new QuantityInput(div, {
                    decreaseText: 'Diminuer',
                    increaseText: 'Augmenter',
                    value: '',
                    min: 1,
                    id: 'numeroGroupe'
                });
            }
        });
    }
})();