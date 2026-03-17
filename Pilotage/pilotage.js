grist.ready({ requiredAccess: 'read table' });

let ecolesData = [];
let enseignantsData = [];
let tableauBordData = [];
let formateursData = [];
let currentSelection = {
    type: null,
    id: null
};

// Variables pour la navigation au clavier dans les résultats
let selectedIndexEnseignant = 0;
let selectedIndexEcole = 0;
let selectedIndexCirconscription = 0;
let filteredEnseignants = [];
let filteredEcoles = [];
let filteredCirconscriptions = [];

/**
 * Échappe les caractères HTML pour prévenir les injections XSS
 * @param {*} text - Le texte à échapper
 * @returns {string} - Le texte échappé
 */
// Stockage global des données de graphiques pour le filtrage dynamique
const graphsDataStore = {};

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/**
 * Sécurise une valeur CSV contre les injections de formules Excel/Calc
 * @param {*} value - La valeur à sécuriser
 * @returns {string} - La valeur sécurisée
 */
function sanitizeCSV(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    // Préfixer les valeurs dangereuses (formules) avec un guillemet simple
    if (str.match(/^[=+\-@\t\r\n]/)) {
        return "'" + str;
    }
    return str;
}

/**
 * Nettoie les ChoiceList de Grist en retirant le marqueur 'L'
 * @param {Array|null} choiceList - La liste retournée par Grist
 * @returns {Array} - La liste nettoyée
 */
function cleanChoiceList(choiceList) {
    if (!choiceList) return [];
    if (!Array.isArray(choiceList)) return [];

    // Grist retourne les ChoiceList sous la forme ['L', valeur1, valeur2, ...]
    // On filtre le 'L' et on garde seulement les valeurs réelles
    return choiceList.filter(item => item !== 'L' && item !== null && item !== '');
}

async function loadData() {
    try {
        const ecolesTable = await grist.docApi.fetchTable('Ecoles');
        ecolesData = ecolesTable.id.map((id, index) => ({
            id: id,
            uai: ecolesTable.UAI[index] || '',
            nom: ecolesTable.Nom[index] || '',
            complement: ecolesTable.Complement[index] || '',
            commune: ecolesTable.Commune[index] || '',
            commune_complement: ecolesTable.Commune_Complement_Nom[index] || '',
            nom_complement_commune: ecolesTable.Nom_Complement_Commune[index] || '',
            circonscription: ecolesTable.Circonscription[index] || '',
            departement: ecolesTable.Departement[index] || ''
        }));

        const enseignantsTable = await grist.docApi.fetchTable('Liste_PE');
        enseignantsData = enseignantsTable.id.map((id, index) => ({
            id: id,
            id_pe: enseignantsTable.ID_PE[index] || '',
            civilite: enseignantsTable.Civilite[index] || '',
            nom: enseignantsTable.Nom[index] || '',
            prenom: enseignantsTable.Prenom[index] || '',
            mail: enseignantsTable.Mail[index] || '',
            ecole: enseignantsTable.Ecole[index],
            fonction: enseignantsTable.Fonction[index] || '',
            quotite: enseignantsTable.Quotite_de_service[index] || '',
            niveaux: cleanChoiceList(enseignantsTable.Niveau_x_[index]),
            annee_scolaire: enseignantsTable.Annee_scolaire[index] || ''
        }));

        const formateursTable = await grist.docApi.fetchTable('Formateurs');
        formateursData = formateursTable.id.map((id, index) => ({
            id: id,
            nom: formateursTable.Formateur[index] || ''
        })).filter(f => f.nom);

        const tableauTable = await grist.docApi.fetchTable('Tableau_de_bord');
        tableauBordData = tableauTable.id.map((id, index) => ({
            id: id,
            id_pe: tableauTable.ID_PE[index],
            id_fiche: tableauTable.ID_fiche[index] || '',
            departement: tableauTable.Departement[index] || '',
            circonscription: cleanChoiceList(tableauTable.Circonscription[index]),
            numero_groupe: tableauTable.Numero_de_groupe[index] || '',
            modalite_constitution: cleanChoiceList(tableauTable.Modalite_de_constitution_du_groupe[index]),
            nb_ecoles: tableauTable.Nb_ecoles[index] || 0,
            nb_pe: tableauTable.Nb_PE[index] || 0,
            nom_pe: tableauTable.Nom_PE[index],
            prenom_pe: tableauTable.Prenom_PE[index],
            niveau_x_: cleanChoiceList(tableauTable.Niveau_x_[index]),
            temps_formation: tableauTable.Temps_de_formation[index] || 0,
            modalites_formation: cleanChoiceList(tableauTable.Modalites_de_formation[index]),
            objets_transversaux: cleanChoiceList(tableauTable.Objets_transversaux_traites_en_parallele[index]),
            themes: cleanChoiceList(tableauTable.Theme_s_traite_s_en_formation[index]),
            annee: tableauTable.Annee[index] || '',
            ecole: tableauTable.Ecole[index],
            type_formation: tableauTable.Type_de_formation[index] || '',
            formateurs: cleanChoiceList(tableauTable.Formateur_s_[index])
        }));

        console.log('Données chargées:', {
            ecoles: ecolesData.length,
            enseignants: enseignantsData.length,
            formations: tableauBordData.length
        });

    } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
        alert('Erreur lors du chargement des données. Veuillez recharger la page.');
    }
}

function switchTab(tabName, event) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // Trouver et activer le bon onglet en fonction du tabName
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        if (tab.getAttribute('onclick') && tab.getAttribute('onclick').includes(`'${tabName}'`)) {
            tab.classList.add('active');
        }
    });

    document.getElementById(tabName).classList.add('active');

    const searchInputs = document.querySelectorAll('.search-results');
    searchInputs.forEach(input => input.style.display = 'none');

    // Scroll vers le haut de la page
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToMatrix() {
    // Utiliser setTimeout pour s'assurer que le DOM est bien mis à jour
    setTimeout(() => {
        // Chercher la matrice uniquement dans l'onglet actif
        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab) {
            const matrixContainer = activeTab.querySelector('.matrix-container');
            if (matrixContainer) {
                // Calculer la hauteur de la profile-card sticky + une petite marge
                const profileCard = document.querySelector('.profile-card');
                const offset = profileCard ? profileCard.offsetHeight + 20 : 100;

                // Calculer la position finale
                const elementPosition = matrixContainer.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - offset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        }
    }, 100);
}

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function printPDF(targetClass) {
    // Afficher un message de chargement
    const loadingDiv = document.createElement('div');
    loadingDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.9); color: white; padding: 30px 50px; border-radius: 10px; z-index: 10000; font-size: 18px; text-align: center;';
    loadingDiv.innerHTML = '📋 Génération du PDF...<br><small style="font-size: 14px; opacity: 0.8;">Veuillez patienter</small>';
    document.body.appendChild(loadingDiv);

    try {
        // Récupérer les éléments
        const profileCard = document.querySelector('.profile-card');
        const targetElement = document.querySelector(`.${targetClass}`);

        if (!targetElement) {
            throw new Error('Élément cible introuvable');
        }

        // Masquer temporairement les boutons et contrôles
        const elementsToHide = document.querySelectorAll('.pdf-button-container, .matrix-controls, .year-filters, #scrollTopBtn, .export-buttons');
        elementsToHide.forEach(el => el.style.display = 'none');

        // Créer un conteneur temporaire pour le PDF
        const pdfContainer = document.createElement('div');
        pdfContainer.style.cssText = 'position: absolute; left: -9999px; top: 0; width: 1000px; background: white; padding: 20px;';
        document.body.appendChild(pdfContainer);

        // Cloner et ajouter la profile-card
        if (profileCard) {
            const profileClone = profileCard.cloneNode(true);
            profileClone.classList.remove('sticky-compact');
            profileClone.style.cssText = 'position: static; margin-bottom: 20px; box-shadow: none; padding: 20px;';
            pdfContainer.appendChild(profileClone);
        }

        // Cloner et ajouter l'élément cible
        const targetClone = targetElement.cloneNode(true);
        targetClone.style.cssText = 'width: 100%; background: white;';
        pdfContainer.appendChild(targetClone);

        // Générer le canvas avec html2canvas
        const canvas = await html2canvas(pdfContainer, {
            scale: 1,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            removeContainer: true,
            imageTimeout: 0
        });

        // Nettoyer
        document.body.removeChild(pdfContainer);
        elementsToHide.forEach(el => el.style.display = '');

        // Créer le PDF avec jsPDF
        const { jsPDF } = window.jspdf;
        const imgWidth = 210; // A4 width in mm
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4',
            compress: false
        });

        const imgData = canvas.toDataURL('image/jpeg', 1);

        // Si le contenu est plus grand qu'une page, ajuster
        if (imgHeight > 297) {
            // Diviser en plusieurs pages
            const totalPages = Math.ceil(imgHeight / 297);
            for (let i = 0; i < totalPages; i++) {
                if (i > 0) pdf.addPage();
                const positionY = -(i * 297 * canvas.width / imgWidth);
                pdf.addImage(imgData, 'JPEG', 0, positionY, imgWidth, imgHeight, undefined, 'FAST');
            }
        } else {
            pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight, undefined, 'FAST');
        }

        // Générer le nom du fichier
        const title = profileCard ? profileCard.querySelector('.profile-title')?.textContent.trim() || 'export' : 'export';
        const type = targetClass.includes('matrix') ? 'matrice' : 'graphiques';
        const fileName = `${title.replace(/\s+/g, '_')}_${type}_${new Date().toISOString().split('T')[0]}.pdf`;

        // Télécharger le PDF
        pdf.save(fileName);

    } catch (error) {
        console.error('Erreur lors de la génération du PDF:', error);
        alert('Erreur lors de la génération du PDF. Veuillez réessayer.');
    } finally {
        // Retirer le message de chargement
        if (loadingDiv.parentNode) {
            document.body.removeChild(loadingDiv);
        }
    }
}

function toggleCollapse(element) {
    const content = element.nextElementSibling;

    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        element.setAttribute('title', 'Replier la section');
    } else {
        content.classList.add('collapsed');
        element.setAttribute('title', 'Déplier la section');
    }
}

function clearSearch(type) {
    if (type === 'enseignant') {
        document.getElementById('searchEnseignant').value = '';
        document.getElementById('resultsEnseignant').innerHTML = '';
        document.getElementById('searchResultsEnseignant').style.display = 'none';
        currentSelection = { type: null, id: null };
    } else if (type === 'ecole') {
        document.getElementById('searchEcole').value = '';
        document.getElementById('resultsEcole').innerHTML = '';
        document.getElementById('searchResultsEcole').style.display = 'none';
        currentSelection = { type: null, id: null };
    } else if (type === 'circonscription') {
        document.getElementById('searchCirconscription').value = '';
        document.getElementById('resultsCirconscription').innerHTML = '';
        document.getElementById('searchResultsCirconscription').style.display = 'none';
        currentSelection = { type: null, id: null };
    }
}

function navigateToEnseignant(ensId) {
    // Basculer vers l'onglet enseignant
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    document.querySelector('.tab[onclick*="enseignant"]').classList.add('active');
    document.getElementById('enseignant').classList.add('active');

    // Afficher la fiche de l'enseignant
    selectEnseignant(ensId);

    // Remplir le champ de recherche
    const ens = enseignantsData.find(e => e.id === ensId);
    if (ens) {
        document.getElementById('searchEnseignant').value = `${ens.prenom} ${ens.nom}`;
    }

    // Scroll vers le haut de la page
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function navigateToEcole(ecoleId) {
    // Basculer vers l'onglet école
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    document.querySelector('.tab[onclick*="ecole"]').classList.add('active');
    document.getElementById('ecole').classList.add('active');

    // Afficher la fiche de l'école
    selectEcole(ecoleId);

    // Remplir le champ de recherche
    const ecole = ecolesData.find(e => e.id === ecoleId);
    if (ecole) {
        document.getElementById('searchEcole').value = ecole.nom_complement_commune;
    }

    // Scroll vers le haut de la page
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function searchEnseignants(event) {
    const searchTerm = event.target.value.toLowerCase().trim();
    const resultsDiv = document.getElementById('searchResultsEnseignant');

    if (searchTerm.length < 2) {
        resultsDiv.style.display = 'none';
        selectedIndexEnseignant = 0;
        return;
    }

    // Navigation avec les flèches
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (filteredEnseignants.length > 0) {
            selectedIndexEnseignant = Math.min(selectedIndexEnseignant + 1, filteredEnseignants.length - 1);
            updateHighlightEnseignant();
        }
        return;
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (filteredEnseignants.length > 0) {
            selectedIndexEnseignant = Math.max(selectedIndexEnseignant - 1, 0);
            updateHighlightEnseignant();
        }
        return;
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        if (filteredEnseignants.length > 0) {
            selectEnseignant(filteredEnseignants[selectedIndexEnseignant].id);
        }
        return;
    }

    // Filtrer les résultats et dédoublonner par id_pe (une seule entrée par personne)
    const matched = enseignantsData.filter(e =>
        e.nom.toLowerCase().includes(searchTerm) ||
        e.prenom.toLowerCase().includes(searchTerm)
    );
    const seen = new Map();
    matched.forEach(e => {
        const key = e.id_pe || String(e.id);
        const existing = seen.get(key);
        if (!existing || (e.annee_scolaire || '') > (existing.annee_scolaire || '')) {
            seen.set(key, e);
        }
    });
    filteredEnseignants = Array.from(seen.values()).slice(0, 15);

    selectedIndexEnseignant = 0;

    if (filteredEnseignants.length === 0) {
        resultsDiv.innerHTML = '<div class="search-result-item">Aucun résultat trouvé</div>';
        resultsDiv.style.display = 'block';
        return;
    }

    resultsDiv.innerHTML = filteredEnseignants.map((ens, index) => {
        const ecole = ecolesData.find(e => e.id === ens.ecole);
        const ecoleNom = ecole ? ecole.nom_complement_commune : 'École non renseignée';
        const highlightClass = index === selectedIndexEnseignant ? ' highlighted' : '';
        return `
            <div class="search-result-item${highlightClass}" data-action="select-enseignant" data-id="${ens.id}" data-index="${index}">
                <strong>${escapeHtml(ens.prenom)} ${escapeHtml(ens.nom)}</strong>
                <div class="search-result-subtitle">${escapeHtml(ecoleNom)}</div>
            </div>
        `;
    }).join('');

    resultsDiv.style.display = 'block';
}

function updateHighlightEnseignant() {
    const resultsDiv = document.getElementById('searchResultsEnseignant');
    const items = resultsDiv.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
        if (index === selectedIndexEnseignant) {
            item.classList.add('highlighted');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('highlighted');
        }
    });
}

function selectEnseignant(ensId) {
    document.getElementById('searchResultsEnseignant').style.display = 'none';

    const enseignant = enseignantsData.find(e => e.id === ensId);
    if (!enseignant) return;

    // Identifier la personne par son id_pe texte (stable à travers les années)
    const idPeText = enseignant.id_pe || String(ensId);
    currentSelection = { type: 'enseignant', id: idPeText };

    // Remplir le champ de recherche avec le nom complet
    document.getElementById('searchEnseignant').value = `${enseignant.prenom} ${enseignant.nom}`;

    // Collecter toutes les entrées Liste_PE de cette personne (toutes années)
    const allEnsRowIds = enseignantsData
        .filter(e => (e.id_pe || String(e.id)) === idPeText)
        .map(e => e.id);

    const formations = tableauBordData.filter(tb => allEnsRowIds.includes(tb.id_pe));

    const formationsByYear = {};
    formations.forEach(formation => {
        if (!formation.annee) return;
        if (!formationsByYear[formation.annee]) {
            formationsByYear[formation.annee] = [];
        }
        formationsByYear[formation.annee].push(formation);
    });

    const years = Object.keys(formationsByYear).sort();

    let html = `
        <div class="export-buttons">
            <div class="left-buttons">
                <button class="btn btn-matrix" data-action="scroll-to-matrix">→ Matrice thématique des formations</button>
            </div>
            <div class="right-buttons">
                <button class="btn btn-export" data-action="export-csv" data-type="enseignant">Exporter CSV</button>
                <button class="btn btn-print" data-action="print">Imprimer</button>
            </div>
        </div>
    `;

    if (years.length === 0) {
        html += '<div class="no-results">Aucune formation enregistrée pour cet enseignant.</div>';
    } else {
        const ecole = ecolesData.find(e => e.id === enseignant.ecole);
        const ecoleNom = ecole ? ecole.nom_complement_commune : 'École non renseignée';

        html += `
            <div class="profile-card">
                <h2 class="profile-title">
                    ${enseignant.civilite ? escapeHtml(enseignant.civilite) + ' ' : ''}${escapeHtml(enseignant.prenom)} ${escapeHtml(enseignant.nom)}
                </h2>
                <div class="profile-text-secondary">
                    <strong>École :</strong> ${escapeHtml(ecoleNom)}
                </div>
            </div>
        `;

        years.forEach(year => {
            const yearFormations = formationsByYear[year];
            const totalHeures = yearFormations.reduce((sum, f) => sum + (f.temps_formation || 0), 0);
            const heuresLabel = totalHeures > 0 ? `(${totalHeures}h)` : '';

            // Trouver l'entrée Liste_PE pour cette personne et cette année
            const ensAnnee = enseignantsData.find(e => (e.id_pe || String(e.id)) === idPeText && e.annee_scolaire === year);
            let yearSubtitle = '';
            if (ensAnnee) {
                const ecoleAnnee = ecolesData.find(e => e.id === ensAnnee.ecole);
                const ecoleNomAnnee = ecoleAnnee ? ecoleAnnee.nom_complement_commune : '';
                const parts = [ensAnnee.fonction, ecoleNomAnnee].filter(p => p && p.trim());
                yearSubtitle = parts.join(' – ');
            }

            html += `<div class="year-card">`;
            html += `<div class="year-header year-header-collapsible" data-action="toggle-collapse">`;
            html += `<div class="year-header-content">`;
            html += `<div class="year-header-top"><span>Année scolaire ${escapeHtml(year)}</span>`;
            if (heuresLabel) html += `<span class="year-header-hours">${escapeHtml(heuresLabel)}</span>`;
            html += `</div>`;
            if (yearSubtitle) html += `<div class="year-header-subtitle">${escapeHtml(yearSubtitle)}</div>`;
            html += `</div>`;
            html += `</div>`;
            html += `<div class="year-content">`;
            html += `<div class="info-grid info-grid--two-cols">`;

            yearFormations.forEach((formation, idx) => {
                if (idx > 0) html += `<div class="formation-separator"></div>`;
                html += `<div class="formation-block">`;
                html += generateFormationInfoItems(formation, enseignant.niveaux);
                html += `</div>`;
            });

            html += `</div>`;
            html += `</div></div>`;
        });
    }

    // Ajouter la matrice thématique à la fin
    html += createThematicMatrix(formations);

    document.getElementById('resultsEnseignant').innerHTML = html;
}

function createAggregatedThematicMatrix(formations) {
    // Liste prédéfinie de tous les thèmes possibles (référentiel complet)
    const themesArray = [
        "FRA - Lecture",
        "FRA - Vocabulaire",
        "FRA - Langage Oral",
        "FRA - S'éveiller à la diversité linguistique",
        "FRA - Écriture",
        "FRA - Grammaire et orthographe",
        "MA - Algèbre et pré-algèbre (motifs organisés)",
        "MA - Calcul",
        "MA - Espace et géométrie",
        "MA - Faits numériques / automatisation",
        "MA - Grandeurs et mesures",
        "MA - Nombres",
        "MA - Organisation et gestion des données",
        "MA - Résolution de problèmes",
        "MA - Probabilités",
        "MA - Proportionnalité"
    ].sort();

    // Liste prédéfinie de tous les objets transversaux possibles (référentiel complet)
    const objetsArray = [
        "Fonctions cognitives transversales",
        "Compétences psycho-sociales",
        "Besoins et développement",
        "Métacognition",
        "Modalités d'apprentissage",
        "Observation active"
    ].sort();

    // Construire la matrice : thème → objet → [{année, type}]
    const matrix = {};
    themesArray.forEach(theme => {
        matrix[theme] = {};
        objetsArray.forEach(objet => {
            matrix[theme][objet] = []; // Array pour stocker plusieurs formations
        });
    });

    // Remplir la matrice avec toutes les formations (agrégées)
    if (formations && Array.isArray(formations)) {
        formations.forEach(f => {
            const annee = f.annee || '';
            const type = f.type_formation || '';

            if (Array.isArray(f.objets_transversaux) && Array.isArray(f.themes)) {
                f.themes.forEach(theme => {
                    if (!theme || !theme.trim()) return;
                    const themeClean = theme.trim();

                    f.objets_transversaux.forEach(objet => {
                        if (!objet || !objet.trim()) return;
                        const objetClean = objet.trim();

                        if (matrix[themeClean] && matrix[themeClean][objetClean] !== undefined) {
                            // Vérifier si cette combinaison année+type existe déjà
                            const existing = matrix[themeClean][objetClean].find(item =>
                                item.annee === annee && item.type === type
                            );
                            if (!existing) {
                                matrix[themeClean][objetClean].push({ annee, type });
                            }
                        }
                    });
                });
            }
        });
    }

    // Identifier les lignes et colonnes vides
    const emptyRows = themesArray.filter(theme =>
        objetsArray.every(objet => matrix[theme][objet].length === 0)
    );

    const emptyCols = objetsArray.filter(objet =>
        themesArray.every(theme => matrix[theme][objet].length === 0)
    );

    // Extraire toutes les années uniques des formations
    const allYears = new Set();
    if (formations && Array.isArray(formations)) {
        formations.forEach(f => {
            if (f.annee) allYears.add(f.annee);
        });
    }
    const yearsArray = Array.from(allYears).sort();

    // Générer le HTML
    let html = '<div class="matrix-container">';
    html += '<h3 class="matrix-title">📊 Matrice thématique des formations</h3>';

    // Contrôles de la matrice
    const matrixId = `matrix-${Math.random().toString(36).substr(2, 9)}`;
    html += '<div class="matrix-controls">';

    // Filtres par année à gauche
    if (yearsArray.length > 0) {
        html += '<div class="year-filters">';
        html += '<span class="filter-label">Filtrer par année :</span>';
        yearsArray.forEach(year => {
            html += '<label class="year-checkbox">';
            html += `<input type="checkbox" class="year-filter" data-matrix-id="${matrixId}" data-year="${escapeHtml(year)}" checked onchange="filterMatrixByYear('${matrixId}')">`;
            html += `<span>${escapeHtml(year)}</span>`;
            html += '</label>';
        });
        html += '</div>';
    }

    // Toggle items vides à droite
    html += '<div class="toggle-container">';
    html += `<span class="toggle-label" id="toggle-label-${matrixId}">Afficher les items non abordés</span>`;
    html += '<label class="toggle-switch">';
    html += `<input type="checkbox" id="toggle-empty-${matrixId}" data-action="toggle-empty" data-matrix-id="${matrixId}">`;
    html += '<span class="toggle-slider"></span>';
    html += '</label>';
    html += '</div>';
    html += '</div>';

    // Tableau
    html += `<table class="matrix-table" id="table-${matrixId}">`;
    html += '<thead><tr>';
    html += '<th>Thèmes / Objets transversaux</th>';

    objetsArray.forEach(objet => {
        const emptyClass = emptyCols.includes(objet) ? ' empty-col hidden' : '';
        html += `<th class="${emptyClass}" title="${objet}">${objet}</th>`;
    });

    html += '</tr></thead><tbody>';

    // Séparer les thèmes en catégories
    const frenchThemes = themesArray.filter(t => t.startsWith('FRA'));
    const mathThemes = themesArray.filter(t => t.startsWith('MA'));

    // Catégorie Français
    if (frenchThemes.length > 0) {
        html += `<tr class="category-row" data-action="toggle-category" data-category="french" data-matrix-id="${matrixId}">`;
        html += `<th colspan="${objetsArray.length + 1}">Français</th>`;
        html += '</tr>';

        frenchThemes.forEach(theme => {
            const emptyRowClass = emptyRows.includes(theme) ? ' empty-row hidden' : '';
            html += `<tr class="theme-row french-theme${emptyRowClass}">`;
            html += `<th title="${theme}">${theme}</th>`;

            objetsArray.forEach(objet => {
                const cells = matrix[theme][objet];
                const emptyColClass = emptyCols.includes(objet) ? ' hidden' : '';
                const cellsJson = JSON.stringify(cells).replace(/"/g, '&quot;');

                if (cells.length === 0) {
                    html += `<td class="${emptyColClass}" data-cells="${cellsJson}"></td>`;
                } else if (cells.length === 1) {
                    // Une seule formation
                    const cell = cells[0];
                    const typeClass = getTypeClass(cell.type);
                    const tooltip = `${cell.type || 'Non spécifié'} - ${cell.annee || 'Année non spécifiée'}`;
                    html += `<td class="filled-cell ${typeClass}${emptyColClass}" title="${tooltip}" data-cells="${cellsJson}">${cell.annee}</td>`;
                } else {
                    // Plusieurs formations - créer un dégradé de couleurs
                    const colors = cells.map(c => getTypeColor(c.type));
                    const gradient = createGradient(colors);
                    const tooltip = cells.map(c => `${c.annee || '?'} : ${c.type || 'Non spécifié'}`).join('\n');
                    html += `<td class="filled-cell multi-formation${emptyColClass}" style="background: ${gradient};" title="${tooltip}" data-cells="${cellsJson}">×${cells.length}</td>`;
                }
            });

            html += '</tr>';
        });
    }

    // Catégorie Mathématiques
    if (mathThemes.length > 0) {
        html += `<tr class="category-row" data-action="toggle-category" data-category="math" data-matrix-id="${matrixId}">`;
        html += `<th colspan="${objetsArray.length + 1}">Mathématiques</th>`;
        html += '</tr>';

        mathThemes.forEach(theme => {
            const emptyRowClass = emptyRows.includes(theme) ? ' empty-row hidden' : '';
            html += `<tr class="theme-row math-theme${emptyRowClass}">`;
            html += `<th title="${theme}">${theme}</th>`;

            objetsArray.forEach(objet => {
                const cells = matrix[theme][objet];
                const emptyColClass = emptyCols.includes(objet) ? ' hidden' : '';
                const cellsJson = JSON.stringify(cells).replace(/"/g, '&quot;');

                if (cells.length === 0) {
                    html += `<td class="${emptyColClass}" data-cells="${cellsJson}"></td>`;
                } else if (cells.length === 1) {
                    // Une seule formation
                    const cell = cells[0];
                    const typeClass = getTypeClass(cell.type);
                    const tooltip = `${cell.type || 'Non spécifié'} - ${cell.annee || 'Année non spécifiée'}`;
                    html += `<td class="filled-cell ${typeClass}${emptyColClass}" title="${tooltip}" data-cells="${cellsJson}">${cell.annee}</td>`;
                } else {
                    // Plusieurs formations - créer un dégradé de couleurs
                    const colors = cells.map(c => getTypeColor(c.type));
                    const gradient = createGradient(colors);
                    const tooltip = cells.map(c => `${c.annee || '?'} : ${c.type || 'Non spécifié'}`).join('\n');
                    html += `<td class="filled-cell multi-formation${emptyColClass}" style="background: ${gradient};" title="${tooltip}" data-cells="${cellsJson}">×${cells.length}</td>`;
                }
            });

            html += '</tr>';
        });
    }

    html += '</tbody></table>';

    // Légende
    html += '<div class="matrix-legend">';
    html += '<div class="legend-item"><div class="legend-color type-constellation"></div><span class="legend-text">Constellation</span></div>';
    html += '<div class="legend-item"><div class="legend-color type-residence"></div><span class="legend-text">Résidence pédagogique</span></div>';
    html += '<div class="legend-item"><div class="legend-color type-animations"></div><span class="legend-text">Animations pédagogiques</span></div>';
    html += '<div class="legend-item"><div class="legend-color type-accompagnement"></div><span class="legend-text">Accompagnement de proximité</span></div>';
    html += '</div>';

    // Bouton PDF
    html += '<div class="pdf-button-container">';
    html += '<button class="btn btn-pdf" data-action="print-pdf" data-target="matrix-container">📄 Générer PDF de la matrice</button>';
    html += '</div>';

    html += '</div>';

    // Ajouter les graphiques
    html += createGraphs(formations);

    return html;
}

function createThematicMatrix(formations) {
    // Liste prédéfinie de tous les thèmes possibles (référentiel complet)
    const themesArray = [
        "FRA - Lecture",
        "FRA - Vocabulaire",
        "FRA - Langage Oral",
        "FRA - S'éveiller à la diversité linguistique",
        "FRA - Écriture",
        "FRA - Grammaire et orthographe",
        "MA - Algèbre et pré-algèbre (motifs organisés)",
        "MA - Calcul",
        "MA - Espace et géométrie",
        "MA - Faits numériques / automatisation",
        "MA - Grandeurs et mesures",
        "MA - Nombres",
        "MA - Organisation et gestion des données",
        "MA - Résolution de problèmes",
        "MA - Probabilités",
        "MA - Proportionnalité"
    ].sort();

    // Liste prédéfinie de tous les objets transversaux possibles (référentiel complet)
    const objetsArray = [
        "Fonctions cognitives transversales",
        "Compétences psycho-sociales",
        "Besoins et développement",
        "Métacognition",
        "Modalités d'apprentissage",
        "Observation active"
    ].sort();

    console.log('Matrice - Thèmes affichés:', themesArray.length, themesArray);
    console.log('Matrice - Objets transversaux affichés:', objetsArray.length, objetsArray);

    // Construire la matrice : thème → objet → [{année, type}]
    const matrix = {};
    themesArray.forEach(theme => {
        matrix[theme] = {};
        objetsArray.forEach(objet => {
            matrix[theme][objet] = []; // Array pour cohérence avec l'autre fonction
        });
    });

    // Remplir la matrice avec les formations de l'enseignant
    if (formations && Array.isArray(formations)) {
        formations.forEach(f => {
            const annee = f.annee || '';
            const type = f.type_formation || '';

            if (Array.isArray(f.objets_transversaux) && Array.isArray(f.themes)) {
                f.themes.forEach(theme => {
                    if (!theme || !theme.trim()) return;
                    const themeClean = theme.trim();

                    f.objets_transversaux.forEach(objet => {
                        if (!objet || !objet.trim()) return;
                        const objetClean = objet.trim();

                        if (matrix[themeClean] && matrix[themeClean][objetClean] !== undefined) {
                            // Vérifier si cette combinaison année+type existe déjà
                            const existing = matrix[themeClean][objetClean].find(item =>
                                item.annee === annee && item.type === type
                            );
                            if (!existing) {
                                matrix[themeClean][objetClean].push({ annee, type });
                            }
                        }
                    });
                });
            }
        });
    }

    // Identifier les lignes et colonnes vides
    const emptyRows = themesArray.filter(theme =>
        objetsArray.every(objet => matrix[theme][objet].length === 0)
    );

    const emptyCols = objetsArray.filter(objet =>
        themesArray.every(theme => matrix[theme][objet].length === 0)
    );

    // Calculer les statistiques
    let totalCells = themesArray.length * objetsArray.length;
    let filledCells = 0;
    themesArray.forEach(theme => {
        objetsArray.forEach(objet => {
            if (matrix[theme][objet].length > 0) filledCells++;
        });
    });

    // Extraire toutes les années uniques des formations
    const allYears = new Set();
    if (formations && Array.isArray(formations)) {
        formations.forEach(f => {
            if (f.annee) allYears.add(f.annee);
        });
    }
    const yearsArray = Array.from(allYears).sort();

    // Générer le HTML
    let html = '<div class="matrix-container">';
    html += '<h3 class="matrix-title">📊 Matrice thématique des formations</h3>';

    // Contrôles de la matrice
    const matrixId = `matrix-${Math.random().toString(36).substr(2, 9)}`;
    html += '<div class="matrix-controls">';

    // Filtres par année à gauche
    if (yearsArray.length > 0) {
        html += '<div class="year-filters">';
        html += '<span class="filter-label">Filtrer par année :</span>';
        yearsArray.forEach(year => {
            html += '<label class="year-checkbox">';
            html += `<input type="checkbox" class="year-filter" data-matrix-id="${matrixId}" data-year="${escapeHtml(year)}" checked onchange="filterMatrixByYear('${matrixId}')">`;
            html += `<span>${escapeHtml(year)}</span>`;
            html += '</label>';
        });
        html += '</div>';
    }

    // Toggle items vides à droite
    html += '<div class="toggle-container">';
    html += `<span class="toggle-label" id="toggle-label-${matrixId}">Afficher les items non abordés</span>`;
    html += '<label class="toggle-switch">';
    html += `<input type="checkbox" id="toggle-empty-${matrixId}" data-action="toggle-empty" data-matrix-id="${matrixId}">`;
    html += '<span class="toggle-slider"></span>';
    html += '</label>';
    html += '</div>';
    html += '</div>';

    // Tableau
    html += `<table class="matrix-table" id="table-${matrixId}">`;
    html += '<thead><tr>';
    html += '<th>Thèmes / Objets transversaux</th>';

    objetsArray.forEach(objet => {
        const emptyClass = emptyCols.includes(objet) ? ' empty-col hidden' : '';
        html += `<th class="${emptyClass}" title="${objet}">${objet}</th>`;
    });

    html += '</tr></thead><tbody>';

    // Séparer les thèmes en catégories
    const frenchThemes = themesArray.filter(t => t.startsWith('FRA'));
    const mathThemes = themesArray.filter(t => t.startsWith('MA'));

    // Catégorie Français
    if (frenchThemes.length > 0) {
        html += `<tr class="category-row" data-action="toggle-category" data-category="french" data-matrix-id="${matrixId}">`;
        html += `<th colspan="${objetsArray.length + 1}">Français</th>`;
        html += '</tr>';

        frenchThemes.forEach(theme => {
            const emptyRowClass = emptyRows.includes(theme) ? ' empty-row hidden' : '';
            html += `<tr class="theme-row french-theme${emptyRowClass}">`;
            html += `<th title="${theme}">${theme}</th>`;

            objetsArray.forEach(objet => {
                const cells = matrix[theme][objet];
                const emptyColClass = emptyCols.includes(objet) ? ' hidden' : '';
                const cellsJson = JSON.stringify(cells).replace(/"/g, '&quot;');

                if (cells.length === 0) {
                    html += `<td class="${emptyColClass}" data-cells="${cellsJson}"></td>`;
                } else if (cells.length === 1) {
                    const cell = cells[0];
                    const typeClass = getTypeClass(cell.type);
                    html += `<td class="filled-cell ${typeClass}${emptyColClass}" title="${cell.type || 'Non spécifié'} - ${cell.annee || 'Année non spécifiée'}" data-cells="${cellsJson}">${cell.annee}</td>`;
                } else {
                    // Plusieurs formations - créer un dégradé
                    const colors = cells.map(c => getTypeColor(c.type));
                    const gradient = createGradient(colors);
                    const tooltip = cells.map(c => `${c.annee || '?'} : ${c.type || 'Non spécifié'}`).join('\n');
                    html += `<td class="filled-cell multi-formation${emptyColClass}" style="background: ${gradient};" title="${tooltip}" data-cells="${cellsJson}">×${cells.length}</td>`;
                }
            });

            html += '</tr>';
        });
    }

    // Catégorie Mathématiques
    if (mathThemes.length > 0) {
        html += `<tr class="category-row" data-action="toggle-category" data-category="math" data-matrix-id="${matrixId}">`;
        html += `<th colspan="${objetsArray.length + 1}">Mathématiques</th>`;
        html += '</tr>';

        mathThemes.forEach(theme => {
            const emptyRowClass = emptyRows.includes(theme) ? ' empty-row hidden' : '';
            html += `<tr class="theme-row math-theme${emptyRowClass}">`;
            html += `<th title="${theme}">${theme}</th>`;

            objetsArray.forEach(objet => {
                const cells = matrix[theme][objet];
                const emptyColClass = emptyCols.includes(objet) ? ' hidden' : '';
                const cellsJson = JSON.stringify(cells).replace(/"/g, '&quot;');

                if (cells.length === 0) {
                    html += `<td class="${emptyColClass}" data-cells="${cellsJson}"></td>`;
                } else if (cells.length === 1) {
                    const cell = cells[0];
                    const typeClass = getTypeClass(cell.type);
                    html += `<td class="filled-cell ${typeClass}${emptyColClass}" title="${cell.type || 'Non spécifié'} - ${cell.annee || 'Année non spécifiée'}" data-cells="${cellsJson}">${cell.annee}</td>`;
                } else {
                    // Plusieurs formations - créer un dégradé
                    const colors = cells.map(c => getTypeColor(c.type));
                    const gradient = createGradient(colors);
                    const tooltip = cells.map(c => `${c.annee || '?'} : ${c.type || 'Non spécifié'}`).join('\n');
                    html += `<td class="filled-cell multi-formation${emptyColClass}" style="background: ${gradient};" title="${tooltip}" data-cells="${cellsJson}">×${cells.length}</td>`;
                }
            });

            html += '</tr>';
        });
    }

    html += '</tbody></table>';

    // Légende
    html += '<div class="matrix-legend">';
    html += '<div class="legend-item"><div class="legend-color type-constellation"></div><span class="legend-text">Constellation</span></div>';
    html += '<div class="legend-item"><div class="legend-color type-residence"></div><span class="legend-text">Résidence pédagogique</span></div>';
    html += '<div class="legend-item"><div class="legend-color type-animations"></div><span class="legend-text">Animations pédagogiques</span></div>';
    html += '<div class="legend-item"><div class="legend-color type-accompagnement"></div><span class="legend-text">Accompagnement de proximité</span></div>';
    html += '</div>';

    // Bouton PDF
    html += '<div class="pdf-button-container">';
    html += '<button class="btn btn-pdf" data-action="print-pdf" data-target="matrix-container">📄 Générer PDF de la matrice</button>';
    html += '</div>';

    html += '</div>';

    // Ajouter les graphiques
    html += createGraphs(formations);

    return html;
}

/**
 * Crée les graphiques statistiques des formations
 * @param {Array} formations - Liste des formations à analyser
 * @returns {string} - HTML contenant les graphiques
 */
function createGraphs(formations, countMode = 'enseignants') {
    if (!formations || formations.length === 0) return '';

    // Extraire toutes les années
    const allYears = new Set();
    formations.forEach(f => {
        if (f.annee) allYears.add(f.annee);
    });
    const yearsArray = Array.from(allYears).sort();

    // Fonction pour compter selon le mode (enseignants ou formations)
    const countItems = (items, countMode) => {
        if (countMode === 'formations') {
            // Compter les ID_fiche uniques
            const uniqueFiches = new Set(items.map(item => item.id_fiche).filter(id => id));
            return uniqueFiches.size;
        } else {
            // Compter les enseignants (lignes)
            return items.length;
        }
    };

    // Compter par objet transversal et par année
    const objetsCount = {};
    const objetsFormations = {}; // Pour stocker les formations par objet/année
    formations.forEach(f => {
        const annee = f.annee || 'Non spécifié';
        if (Array.isArray(f.objets_transversaux)) {
            f.objets_transversaux.forEach(objet => {
                if (objet && objet.trim()) {
                    const objetClean = objet.trim();
                    if (!objetsFormations[objetClean]) objetsFormations[objetClean] = {};
                    if (!objetsFormations[objetClean][annee]) objetsFormations[objetClean][annee] = [];
                    objetsFormations[objetClean][annee].push(f);
                }
            });
        }
    });
    // Calculer les comptages selon le mode
    Object.keys(objetsFormations).forEach(objet => {
        objetsCount[objet] = {};
        Object.keys(objetsFormations[objet]).forEach(annee => {
            objetsCount[objet][annee] = countItems(objetsFormations[objet][annee], countMode);
        });
    });

    // Compter par thème et par année
    const themesCount = {};
    const themesFormations = {};
    formations.forEach(f => {
        const annee = f.annee || 'Non spécifié';
        if (Array.isArray(f.themes)) {
            f.themes.forEach(theme => {
                if (theme && theme.trim()) {
                    const themeClean = theme.trim();
                    if (!themesFormations[themeClean]) themesFormations[themeClean] = {};
                    if (!themesFormations[themeClean][annee]) themesFormations[themeClean][annee] = [];
                    themesFormations[themeClean][annee].push(f);
                }
            });
        }
    });
    Object.keys(themesFormations).forEach(theme => {
        themesCount[theme] = {};
        Object.keys(themesFormations[theme]).forEach(annee => {
            themesCount[theme][annee] = countItems(themesFormations[theme][annee], countMode);
        });
    });

    // Compter par modalité et par année
    const modalitesCount = {};
    const modalitesFormations = {};
    formations.forEach(f => {
        const annee = f.annee || 'Non spécifié';
        const type = f.type_formation || 'Non spécifié';
        if (!modalitesFormations[type]) modalitesFormations[type] = {};
        if (!modalitesFormations[type][annee]) modalitesFormations[type][annee] = [];
        modalitesFormations[type][annee].push(f);
    });
    Object.keys(modalitesFormations).forEach(type => {
        modalitesCount[type] = {};
        Object.keys(modalitesFormations[type]).forEach(annee => {
            modalitesCount[type][annee] = countItems(modalitesFormations[type][annee], countMode);
        });
    });

    const graphsId = `graphs-${Math.random().toString(36).slice(2, 9)}`;

    let html = '<div class="graphs-container">';
    html += '<h3 class="graphs-title">📈 Statistiques des formations</h3>';

    // Contrôles des graphiques
    html += '<div class="matrix-controls">';

    // Filtres par année à gauche
    if (yearsArray.length > 0) {
        html += '<div class="year-filters">';
        html += '<span class="filter-label">Filtrer par année :</span>';
        yearsArray.forEach(year => {
            html += '<label class="year-checkbox">';
            html += `<input type="checkbox" class="year-filter-graphs" data-graphs-id="${graphsId}" data-year="${escapeHtml(year)}" checked onchange="filterGraphsByYear('${graphsId}')">`;
            html += `<span>${escapeHtml(year)}</span>`;
            html += '</label>';
        });
        html += '</div>';
    }

    // Toggle comptage à droite
    html += '<div class="toggle-container">';
    html += `<span class="toggle-label" id="count-label-${graphsId}">Compter : Enseignants</span>`;
    html += '<label class="toggle-switch">';
    html += `<input type="checkbox" id="count-mode-${graphsId}" onchange="toggleGraphsCountMode('${graphsId}')">`;
    html += '<span class="toggle-slider"></span>';
    html += '</label>';
    html += '</div>';

    html += '</div>';

    // Stocker les données brutes dans un objet global pour le recalcul dynamique
    graphsDataStore[graphsId] = {
        formations: formations,
        objetsCount,
        themesCount,
        modalitesCount,
        years: yearsArray,
        countMode: countMode
    };

    html += `<div class="graphs-grid" id="${graphsId}">`;

    // Graphique 1 : Objets transversaux
    html += createBarChart(objetsCount, 'Objets transversaux', 'graph-objets', yearsArray);

    // Graphique 2 : Thèmes
    html += createBarChart(themesCount, 'Thèmes de formation', 'graph-themes', yearsArray);

    // Graphique 3 : Modalités (camembert)
    html += createPieChart(modalitesCount, 'Modalités de formation', 'graph-modalites', yearsArray);

    html += '</div>';

    // Bouton PDF
    html += '<div class="pdf-button-container">';
    html += '<button class="btn btn-pdf" data-action="print-pdf" data-target="graphs-container">📄 Générer PDF des graphiques</button>';
    html += '</div>';

    html += '</div>';

    return html;
}

/**
 * Génère une couleur à partir d'un index d'année
 * @param {number} yearIndex - Index de l'année dans le tableau
 * @param {number} totalYears - Nombre total d'années
 * @returns {string} - Couleur en format HSL
 */
function getYearColor(yearIndex, totalYears) {
    // Palette de couleurs dégradées (teintes différentes)
    const baseHues = [180, 200, 220, 240, 260, 280]; // Bleu, Violet, Rose, Orange, Cyan, Vert
    const hue = baseHues[yearIndex % baseHues.length];

    // Ajuster la luminosité selon l'index pour créer des variations
    const lightnessOffset = totalYears > 1 ? (yearIndex * 10) / (totalYears - 1) : 0;
    const lightness = 55 - lightnessOffset; // De 55% à 45%

    return `hsl(${hue}, 70%, ${lightness}%)`;
}

/**
 * Crée un diagramme en barres horizontales groupées par année
 * @param {Object} data - Données {label: {année: count}}
 * @param {string} title - Titre du graphique
 * @param {string} id - ID du conteneur
 * @param {Array} years - Liste des années
 * @returns {string} - HTML du graphique
 */
function createBarChart(data, title, id, years = []) {
    // Calculer les totaux par label pour le tri
    const totals = {};
    Object.keys(data).forEach(label => {
        totals[label] = Object.values(data[label]).reduce((sum, count) => sum + count, 0);
    });

    // Filtrer et trier par total décroissant
    const sortedLabels = Object.keys(data)
        .filter(label => totals[label] > 0)
        .sort((a, b) => totals[b] - totals[a]);

    if (sortedLabels.length === 0) return '';

    const maxCount = Math.max(...Object.values(totals));
    const barHeight = 30; // Hauteur constante pour chaque barre
    const barSpacing = 10;
    const chartHeight = sortedLabels.length * (barHeight + barSpacing);

    // Calculer la largeur nécessaire pour les labels
    const maxLabelLength = Math.max(...sortedLabels.map(label => label.length));
    const labelWidth = Math.min(Math.max(maxLabelLength * 7, 250), 400);

    const chartWidth = labelWidth + 400;
    const barMaxWidth = 300;

    let html = `<div class="graph-item" id="${id}">`;
    html += `<h4 class="graph-title">${escapeHtml(title)}</h4>`;
    html += `<svg width="${chartWidth}" height="${chartHeight + 20}" class="bar-chart">`;

    sortedLabels.forEach((label, labelIndex) => {
        const yBase = labelIndex * (barHeight + barSpacing);

        // Label du groupe
        html += `<text x="${labelWidth - 5}" y="${yBase + barHeight / 2 + 5}" class="bar-label" text-anchor="end" title="${escapeHtml(label)}">${escapeHtml(label)}</text>`;

        // Barres empilées pour chaque année
        let xOffset = labelWidth;
        years.forEach((year, yearIndex) => {
            const count = data[label][year] || 0;
            if (count > 0) {
                const barWidth = (count / maxCount) * barMaxWidth;
                const color = getYearColor(yearIndex, years.length);

                // Barre avec data-year pour le filtrage
                html += `<rect class="bar bar-year" data-year="${escapeHtml(year)}" x="${xOffset}" y="${yBase}" width="${barWidth}" height="${barHeight}" fill="${color}" opacity="0.9" />`;

                // Valeur au-dessus de la barre si assez large
                if (barWidth > 20) {
                    html += `<text class="bar-value-small" data-year="${escapeHtml(year)}" x="${xOffset + barWidth / 2}" y="${yBase + barHeight / 2 + 5}" text-anchor="middle">${count}</text>`;
                }

                xOffset += barWidth;
            }
        });

        // Total à la fin
        const totalWidth = (totals[label] / maxCount) * barMaxWidth;
        html += `<text class="bar-value" x="${labelWidth + totalWidth + 5}" y="${yBase + barHeight / 2 + 5}">${totals[label]}</text>`;
    });

    html += '</svg>';

    // Légende des années
    if (years.length > 1) {
        html += '<div class="year-legend">';
        years.forEach((year, yearIndex) => {
            const color = getYearColor(yearIndex, years.length);
            html += `<div class="legend-item">`;
            html += `<div class="legend-color" style="background-color: ${color};"></div>`;
            html += `<span class="legend-text">${escapeHtml(year)}</span>`;
            html += '</div>';
        });
        html += '</div>';
    }

    html += '</div>';

    return html;
}

/**
 * Crée un diagramme en secteurs (camembert) avec segments par année
 * @param {Object} data - Données {label: {année: count}}
 * @param {string} title - Titre du graphique
 * @param {string} id - ID du conteneur
 * @param {Array} years - Liste des années
 * @returns {string} - HTML du graphique
 */
function createPieChart(data, title, id, years = []) {
    // Aplatir les données : créer une entrée pour chaque combinaison label+année
    const flatData = [];
    Object.keys(data).forEach(label => {
        years.forEach((year, yearIndex) => {
            const count = data[label][year] || 0;
            if (count > 0) {
                flatData.push({
                    label,
                    year,
                    yearIndex,
                    count,
                    displayLabel: years.length > 1 ? `${label} (${year})` : label
                });
            }
        });
    });

    if (flatData.length === 0) return '';

    const total = flatData.reduce((sum, item) => sum + item.count, 0);
    const radius = 100;
    const centerX = 120;
    const centerY = 120;

    // Couleurs selon le type de formation avec variation pour les années
    const getModaliteColor = (label, yearIndex, totalYears) => {
        const labelLower = label.toLowerCase();
        let baseHue;

        if (labelLower.includes('constellation')) baseHue = 220; // Bleu
        else if (labelLower.includes('résidence') || labelLower.includes('residence')) baseHue = 45; // Orange
        else if (labelLower.includes('animation')) baseHue = 100; // Vert
        else if (labelLower.includes('accompagnement')) baseHue = 280; // Violet
        else baseHue = 0; // Gris

        // Varier la luminosité selon l'année avec contraste renforcé
        const lightnessOffset = totalYears > 1 ? (yearIndex * 60) / (totalYears - 1) : 0;
        const lightness = 80 - lightnessOffset; // De 80% à 20%

        return `hsl(${baseHue}, 80%, ${lightness}%)`;
    };

    let html = `<div class="graph-item" id="${id}">`;
    html += `<h4 class="graph-title">${escapeHtml(title)}</h4>`;
    html += '<div class="pie-container">';
    html += `<svg width="240" height="240" class="pie-chart">`;

    let currentAngle = -90; // Commencer en haut

    flatData.forEach((item) => {
        const percentage = (item.count / total) * 100;
        const sliceAngle = (item.count / total) * 360;
        const endAngle = currentAngle + sliceAngle;

        // Calcul des coordonnées du path
        const startX = centerX + radius * Math.cos((currentAngle * Math.PI) / 180);
        const startY = centerY + radius * Math.sin((currentAngle * Math.PI) / 180);
        const endX = centerX + radius * Math.cos((endAngle * Math.PI) / 180);
        const endY = centerY + radius * Math.sin((endAngle * Math.PI) / 180);

        const largeArcFlag = sliceAngle > 180 ? 1 : 0;

        const color = getModaliteColor(item.label, item.yearIndex, years.length);

        if (sliceAngle >= 360) {
            // Cas 100% : un arc dégénéré serait invisible, on dessine un cercle plein
            html += `<circle class="pie-slice" data-year="${escapeHtml(item.year)}" cx="${centerX}" cy="${centerY}" r="${radius}" fill="${color}" stroke="white" stroke-width="2"/>`;
        } else {
            html += `<path class="pie-slice" data-year="${escapeHtml(item.year)}" d="M ${centerX} ${centerY} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY} Z" fill="${color}" stroke="white" stroke-width="2"/>`;
        }

        currentAngle = endAngle;
    });

    html += '</svg>';

    // Légende
    html += '<div class="pie-legend">';
    flatData.forEach((item) => {
        const color = getModaliteColor(item.label, item.yearIndex, years.length);
        const percentage = ((item.count / total) * 100).toFixed(1);
        html += `<div class="legend-item" data-year="${escapeHtml(item.year)}">`;
        html += `<div class="legend-color" style="background-color: ${color};"></div>`;
        html += `<span class="legend-text">${escapeHtml(item.displayLabel)} : ${item.count} (${percentage}%)</span>`;
        html += '</div>';
    });
    html += '</div>';

    html += '</div>';
    html += '</div>';

    return html;
}

function getTypeClass(type) {
    const typeNormalized = type.toLowerCase();
    if (typeNormalized.includes('constellation')) return 'type-constellation';
    if (typeNormalized.includes('résidence') || typeNormalized.includes('residence')) return 'type-residence';
    if (typeNormalized.includes('animation')) return 'type-animations';
    if (typeNormalized.includes('accompagnement')) return 'type-accompagnement';
    return '';
}

function getTypeColor(type) {
    const typeNormalized = type.toLowerCase();
    if (typeNormalized.includes('constellation')) return '#6c8fff';
    if (typeNormalized.includes('résidence') || typeNormalized.includes('residence')) return '#ffc107';
    if (typeNormalized.includes('animation')) return '#8bc34a';
    if (typeNormalized.includes('accompagnement')) return '#9c27b0';
    return '#bdbdbd';
}

function createGradient(colors) {
    if (colors.length === 1) return colors[0];

    // Créer des bandes verticales égales
    const step = 100 / colors.length;
    const stops = colors.map((color, index) => {
        const start = index * step;
        const end = (index + 1) * step;
        return `${color} ${start}%, ${color} ${end}%`;
    });

    return `linear-gradient(to right, ${stops.join(', ')})`;
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

function toggleEmptyItems(matrixId) {
    const checkbox = document.getElementById(`toggle-empty-${matrixId}`);
    const label = document.getElementById(`toggle-label-${matrixId}`);
    const table = document.getElementById(`table-${matrixId}`);

    if (checkbox.checked) {
        // Afficher les lignes et colonnes vides avec animation
        label.textContent = 'Masquer les items non abordés';

        // Retirer la classe hidden pour permettre la transition
        table.querySelectorAll('.empty-row.hidden, .empty-col.hidden').forEach(el => {
            el.classList.remove('hidden');
        });

        // Masquer aussi les cellules dans les colonnes vides
        table.querySelectorAll('tbody tr:not(.empty-row):not(.category-row)').forEach(row => {
            const cells = row.querySelectorAll('td');
            const headers = table.querySelectorAll('thead th');
            cells.forEach((cell, index) => {
                if (headers[index + 1] && headers[index + 1].classList.contains('empty-col')) {
                    cell.classList.remove('hidden');
                }
            });
        });
    } else {
        // Masquer les lignes et colonnes vides avec animation
        label.textContent = 'Afficher les items non abordés';

        // Ajouter la classe hidden pour déclencher la transition
        table.querySelectorAll('.empty-row').forEach(el => {
            el.classList.add('hidden');
        });
        table.querySelectorAll('.empty-col').forEach(el => {
            el.classList.add('hidden');
        });

        // Masquer aussi les cellules dans les colonnes vides
        table.querySelectorAll('tbody tr:not(.empty-row):not(.category-row)').forEach(row => {
            const cells = row.querySelectorAll('td');
            const headers = table.querySelectorAll('thead th');
            cells.forEach((cell, index) => {
                if (headers[index + 1] && headers[index + 1].classList.contains('empty-col')) {
                    cell.classList.add('hidden');
                }
            });
        });
    }
}

function toggleCategory(category, matrixId) {
    const table = document.getElementById(`table-${matrixId}`);
    const categoryRows = table.querySelectorAll(`.category-row`);

    // Trouver la ligne de catégorie cliquée
    let clickedRow = null;
    categoryRows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if ((category === 'french' && text.includes('français')) ||
            (category === 'math' && text.includes('mathématiques'))) {
            clickedRow = row;
        }
    });

    if (!clickedRow) return;

    // Toggle la classe collapsed
    clickedRow.classList.toggle('collapsed');

    // Afficher/masquer les lignes de thèmes associées
    const themeClass = category === 'french' ? 'french-theme' : 'math-theme';
    const themeRows = table.querySelectorAll(`.${themeClass}`);

    themeRows.forEach(row => {
        row.classList.toggle('collapsed');
    });
}

/**
 * Filtre la matrice thématique selon les années sélectionnées
 * @param {string} matrixId - L'identifiant de la matrice à filtrer
 */
function filterMatrixByYear(matrixId) {
    const table = document.getElementById(`table-${matrixId}`);
    if (!table) return;

    // Récupérer les années cochées
    const yearCheckboxes = document.querySelectorAll(`.year-filter[data-matrix-id="${matrixId}"]`);
    const selectedYears = Array.from(yearCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.year);

    // Parcourir toutes les cellules de données (TD avec data-cells)
    const cells = table.querySelectorAll('td[data-cells]');
    cells.forEach(cell => {
        const cellsData = JSON.parse(cell.getAttribute('data-cells').replace(/&quot;/g, '"'));

        // Filtrer les formations selon les années sélectionnées
        const filteredCells = cellsData.filter(item => selectedYears.includes(item.annee));

        // Mettre à jour le contenu de la cellule
        if (filteredCells.length === 0) {
            cell.className = cell.className.replace(/filled-cell|type-\w+|multi-formation/g, '').trim();
            cell.innerHTML = '';
            cell.style.background = '';
            cell.title = '';
        } else if (filteredCells.length === 1) {
            const item = filteredCells[0];
            const typeClass = getTypeClass(item.type);
            cell.className = cell.className.replace(/type-\w+|multi-formation/g, '').trim();
            cell.classList.add('filled-cell', typeClass);
            cell.innerHTML = escapeHtml(item.annee);
            cell.style.background = '';
            cell.title = `${item.type || 'Non spécifié'} - ${item.annee || 'Année non spécifiée'}`;
        } else {
            const colors = filteredCells.map(c => getTypeColor(c.type));
            const gradient = createGradient(colors);
            cell.className = cell.className.replace(/type-\w+/g, '').trim();
            if (!cell.classList.contains('filled-cell')) cell.classList.add('filled-cell');
            if (!cell.classList.contains('multi-formation')) cell.classList.add('multi-formation');
            cell.innerHTML = `×${filteredCells.length}`;
            cell.style.background = gradient;
            cell.title = filteredCells.map(c => `${c.annee || '?'} : ${c.type || 'Non spécifié'}`).join('\n');
        }
    });

    // Masquer les lignes entièrement vides après filtrage
    const themeRows = table.querySelectorAll('.theme-row');
    themeRows.forEach(row => {
        const dataCells = row.querySelectorAll('td[data-cells]');
        const hasFilledCell = Array.from(dataCells).some(cell => cell.classList.contains('filled-cell'));

        if (hasFilledCell) {
            row.classList.remove('filtered-empty');
            row.style.display = '';
        } else {
            row.classList.add('filtered-empty');
            row.style.display = 'none';
        }
    });
}

function toggleGraphsCountMode(graphsId) {
    const checkbox = document.getElementById(`count-mode-${graphsId}`);
    const label = document.getElementById(`count-label-${graphsId}`);
    const graphsData = graphsDataStore[graphsId];

    if (!graphsData) return;

    // Basculer le mode
    const newMode = checkbox.checked ? 'formations' : 'enseignants';
    graphsData.countMode = newMode;

    // Mettre à jour le label
    label.textContent = checkbox.checked ? 'Compter : Formations' : 'Compter : Enseignants';

    // Recalculer les graphiques avec le nouveau mode
    const graphsContainer = document.getElementById(graphsId);
    if (!graphsContainer) return;

    // Recréer les données avec le nouveau mode de comptage
    const countItems = (items, countMode) => {
        if (countMode === 'formations') {
            const uniqueFiches = new Set(items.map(item => item.id_fiche).filter(id => id));
            return uniqueFiches.size;
        } else {
            return items.length;
        }
    };

    const formations = graphsData.formations;

    // Recalculer objets
    const objetsFormations = {};
    formations.forEach(f => {
        const annee = f.annee || 'Non spécifié';
        if (Array.isArray(f.objets_transversaux)) {
            f.objets_transversaux.forEach(objet => {
                if (objet && objet.trim()) {
                    const objetClean = objet.trim();
                    if (!objetsFormations[objetClean]) objetsFormations[objetClean] = {};
                    if (!objetsFormations[objetClean][annee]) objetsFormations[objetClean][annee] = [];
                    objetsFormations[objetClean][annee].push(f);
                }
            });
        }
    });
    const objetsCount = {};
    Object.keys(objetsFormations).forEach(objet => {
        objetsCount[objet] = {};
        Object.keys(objetsFormations[objet]).forEach(annee => {
            objetsCount[objet][annee] = countItems(objetsFormations[objet][annee], newMode);
        });
    });

    // Recalculer thèmes
    const themesFormations = {};
    formations.forEach(f => {
        const annee = f.annee || 'Non spécifié';
        if (Array.isArray(f.themes)) {
            f.themes.forEach(theme => {
                if (theme && theme.trim()) {
                    const themeClean = theme.trim();
                    if (!themesFormations[themeClean]) themesFormations[themeClean] = {};
                    if (!themesFormations[themeClean][annee]) themesFormations[themeClean][annee] = [];
                    themesFormations[themeClean][annee].push(f);
                }
            });
        }
    });
    const themesCount = {};
    Object.keys(themesFormations).forEach(theme => {
        themesCount[theme] = {};
        Object.keys(themesFormations[theme]).forEach(annee => {
            themesCount[theme][annee] = countItems(themesFormations[theme][annee], newMode);
        });
    });

    // Recalculer modalités
    const modalitesFormations = {};
    formations.forEach(f => {
        const annee = f.annee || 'Non spécifié';
        const type = f.type_formation || 'Non spécifié';
        if (!modalitesFormations[type]) modalitesFormations[type] = {};
        if (!modalitesFormations[type][annee]) modalitesFormations[type][annee] = [];
        modalitesFormations[type][annee].push(f);
    });
    const modalitesCount = {};
    Object.keys(modalitesFormations).forEach(type => {
        modalitesCount[type] = {};
        Object.keys(modalitesFormations[type]).forEach(annee => {
            modalitesCount[type][annee] = countItems(modalitesFormations[type][annee], newMode);
        });
    });

    // Mettre à jour le store
    graphsData.objetsCount = objetsCount;
    graphsData.themesCount = themesCount;
    graphsData.modalitesCount = modalitesCount;

    // Redessiner les graphiques
    filterGraphsByYear(graphsId);
}

function filterGraphsByYear(graphsId) {
    const graphsContainer = document.getElementById(graphsId);
    if (!graphsContainer) return;

    // Récupérer les données brutes depuis le stockage global
    const graphsData = graphsDataStore[graphsId];
    if (!graphsData) return;

    const { objetsCount, themesCount, modalitesCount, years } = graphsData;

    // Récupérer les années cochées
    const yearCheckboxes = document.querySelectorAll(`.year-filter-graphs[data-graphs-id="${graphsId}"]`);
    const selectedYears = Array.from(yearCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.year);

    // Filtrer les données selon les années sélectionnées
    const filterDataByYears = (data, years) => {
        const filtered = {};
        Object.keys(data).forEach(label => {
            filtered[label] = {};
            years.forEach(year => {
                if (data[label][year]) {
                    filtered[label][year] = data[label][year];
                }
            });
        });
        return filtered;
    };

    // Appliquer le filtre ou utiliser toutes les données si aucune année sélectionnée
    const filteredYears = selectedYears.length > 0 ? selectedYears : years;
    const filteredObjetsCount = filterDataByYears(objetsCount, filteredYears);
    const filteredThemesCount = filterDataByYears(themesCount, filteredYears);
    const filteredModalitesCount = filterDataByYears(modalitesCount, filteredYears);

    // Redessiner les graphiques avec les données filtrées
    const objetsGraph = graphsContainer.querySelector('#graph-objets');
    const themesGraph = graphsContainer.querySelector('#graph-themes');
    const modalitesGraph = graphsContainer.querySelector('#graph-modalites');

    if (objetsGraph) {
        objetsGraph.outerHTML = createBarChart(filteredObjetsCount, 'Objets transversaux', 'graph-objets', filteredYears);
    }

    if (themesGraph) {
        themesGraph.outerHTML = createBarChart(filteredThemesCount, 'Thèmes de formation', 'graph-themes', filteredYears);
    }

    if (modalitesGraph) {
        modalitesGraph.outerHTML = createPieChart(filteredModalitesCount, 'Modalités de formation', 'graph-modalites', filteredYears);
    }
}

function searchEcoles(event) {
    const searchTerm = event.target.value.toLowerCase().trim();
    const resultsDiv = document.getElementById('searchResultsEcole');

    if (searchTerm.length < 2) {
        resultsDiv.style.display = 'none';
        selectedIndexEcole = 0;
        return;
    }

    // Navigation avec les flèches
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (filteredEcoles.length > 0) {
            selectedIndexEcole = Math.min(selectedIndexEcole + 1, filteredEcoles.length - 1);
            updateHighlightEcole();
        }
        return;
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (filteredEcoles.length > 0) {
            selectedIndexEcole = Math.max(selectedIndexEcole - 1, 0);
            updateHighlightEcole();
        }
        return;
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        if (filteredEcoles.length > 0) {
            selectEcole(filteredEcoles[selectedIndexEcole].id);
        }
        return;
    }

    // Filtrer les résultats
    filteredEcoles = ecolesData.filter(e =>
        e.nom.toLowerCase().includes(searchTerm) ||
        e.commune.toLowerCase().includes(searchTerm) ||
        e.commune_complement.toLowerCase().includes(searchTerm) ||
        e.nom_complement_commune.toLowerCase().includes(searchTerm)
    ).slice(0, 15);

    selectedIndexEcole = 0;

    if (filteredEcoles.length === 0) {
        resultsDiv.innerHTML = '<div class="search-result-item">Aucun résultat trouvé</div>';
        resultsDiv.style.display = 'block';
        return;
    }

    resultsDiv.innerHTML = filteredEcoles.map((ecole, index) => {
        const highlightClass = index === selectedIndexEcole ? ' highlighted' : '';
        return `<div class="search-result-item${highlightClass}" data-action="select-ecole" data-id="${ecole.id}" data-index="${index}">
            ${escapeHtml(ecole.nom_complement_commune)}
        </div>`;
    }).join('');

    resultsDiv.style.display = 'block';
}

function updateHighlightEcole() {
    const resultsDiv = document.getElementById('searchResultsEcole');
    const items = resultsDiv.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
        if (index === selectedIndexEcole) {
            item.classList.add('highlighted');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('highlighted');
        }
    });
}

function selectEcole(ecoleId) {
    document.getElementById('searchResultsEcole').style.display = 'none';
    currentSelection = { type: 'ecole', id: ecoleId };

    const ecole = ecolesData.find(e => e.id === ecoleId);
    if (!ecole) return;

    // Remplir le champ de recherche avec le nom complet
    document.getElementById('searchEcole').value = ecole.nom_complement_commune;

    const enseignantsEcole = enseignantsData.filter(e => e.ecole === ecoleId);
    const enseignantIds = enseignantsEcole.map(e => e.id);

    const formations = tableauBordData.filter(tb => tb.ecole === ecoleId);

    const formationsByYear = {};
    formations.forEach(formation => {
        if (!formation.annee) return;
        if (!formationsByYear[formation.annee]) {
            formationsByYear[formation.annee] = [];
        }
        formationsByYear[formation.annee].push(formation);
    });

    const years = Object.keys(formationsByYear).sort();

    let html = `
        <div class="export-buttons">
            <div class="left-buttons">
                <button class="btn btn-matrix" data-action="scroll-to-matrix">→ Matrice thématique des formations</button>
            </div>
            <div class="right-buttons">
                <button class="btn btn-export" data-action="export-csv" data-type="ecole">Exporter CSV</button>
                <button class="btn btn-print" data-action="print">Imprimer</button>
            </div>
        </div>
    `;

    html += `
        <div class="profile-card">
            <h2 class="profile-title">${escapeHtml(ecole.nom_complement_commune)}</h2>
            <div class="profile-text-secondary">
                <strong>UAI :</strong> ${escapeHtml(ecole.uai || 'Non renseigné')} | 
                <strong>Circonscription :</strong> ${escapeHtml(ecole.circonscription || 'Non renseignée')}
            </div>
        </div>
    `;

    if (years.length === 0) {
        html += '<div class="no-results">Aucune formation enregistrée pour cette école.</div>';
    } else {
        years.forEach(year => {
            const yearFormations = formationsByYear[year];
            html += `<div class="year-card">`;
            html += `<div class="year-header year-header-collapsible" data-action="toggle-collapse">Année scolaire ${escapeHtml(year)}</div>`;
            html += `<div class="year-content">`;

            const formationGroups = groupFormationsByType(yearFormations);

            Object.entries(formationGroups).forEach(([key, group]) => {
                html += `<div class="formation-group">`;
                html += `<div class="formation-header">
                    ${group.type_formation ? 'Formation : ' + escapeHtml(group.type_formation) : 'Formation non spécifiée'}
                </div>`;

                html += `<div class="info-grid">`;
                html += generateFormationInfoItems(group.formations[0], []);
                html += `</div>`;

                html += `<div class="enseignant-list">`;
                html += `<div class="info-label info-label-spaced">Enseignants participants :</div>`;

                const enseignantsFormation = new Set();
                group.formations.forEach(f => {
                    if (f.id_pe) enseignantsFormation.add(f.id_pe);
                });

                enseignantsFormation.forEach(ensId => {
                    const ens = enseignantsData.find(e => e.id === ensId);
                    if (ens) {
                        const niveauxStr = ens.niveaux && ens.niveaux.length > 0
                            ? ` - Niveau(x) : ${ens.niveaux.map(n => escapeHtml(n)).join(', ')}`
                            : '';
                        html += `<div class="enseignant-item">
                            <span class="clickable-name" data-action="navigate-to-enseignant" data-id="${ens.id}" title="Voir la fiche de cet enseignant">
                                ${escapeHtml(ens.prenom)} ${escapeHtml(ens.nom)}
                            </span>${niveauxStr}
                        </div>`;
                    }
                });

                html += `</div></div>`;
            });

            const enseignantsSansFormation = enseignantsEcole.filter(ens => {
                const hasFormation = yearFormations.some(f => f.id_pe === ens.id);
                return !hasFormation;
            });

            if (enseignantsSansFormation.length > 0) {
                html += `<div class="formation-group">`;
                html += `<div class="formation-header formation-header-alert">
                    Enseignant(s) n'ayant pas de formation enregistrée
                </div>`;
                html += `<div class="enseignant-list">`;
                enseignantsSansFormation.forEach(ens => {
                    const niveauxStr = ens.niveaux && ens.niveaux.length > 0
                        ? ` - Niveau(x) : ${ens.niveaux.map(n => escapeHtml(n)).join(', ')}`
                        : '';
                    html += `<div class="enseignant-item enseignant-item-alert">
                        <span class="clickable-name" data-action="navigate-to-enseignant" data-id="${ens.id}" title="Voir la fiche de cet enseignant">
                            ${escapeHtml(ens.prenom)} ${escapeHtml(ens.nom)}
                        </span>${niveauxStr}
                    </div>`;
                });
                html += `</div></div>`;
            }

            html += `</div>`;
            html += `</div></div>`;
        });
    }

    // Ajouter la matrice thématique agrégée à la fin
    html += createAggregatedThematicMatrix(formations);

    document.getElementById('resultsEcole').innerHTML = html;
}

function searchCirconscriptions(event) {
    const searchTerm = event.target.value.toLowerCase().trim();
    const resultsDiv = document.getElementById('searchResultsCirconscription');

    if (searchTerm.length < 2) {
        resultsDiv.style.display = 'none';
        selectedIndexCirconscription = 0;
        return;
    }

    // Navigation avec les flèches
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (filteredCirconscriptions.length > 0) {
            selectedIndexCirconscription = Math.min(selectedIndexCirconscription + 1, filteredCirconscriptions.length - 1);
            updateHighlightCirconscription();
        }
        return;
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (filteredCirconscriptions.length > 0) {
            selectedIndexCirconscription = Math.max(selectedIndexCirconscription - 1, 0);
            updateHighlightCirconscription();
        }
        return;
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        if (filteredCirconscriptions.length > 0) {
            selectCirconscription(filteredCirconscriptions[selectedIndexCirconscription]);
        }
        return;
    }

    // Filtrer les résultats
    const circonscriptions = [...new Set(ecolesData.map(e => e.circonscription).filter(c => c))];
    filteredCirconscriptions = circonscriptions.filter(c =>
        c.toLowerCase().includes(searchTerm)
    ).slice(0, 15);

    selectedIndexCirconscription = 0;

    if (filteredCirconscriptions.length === 0) {
        resultsDiv.innerHTML = '<div class="search-result-item">Aucun résultat trouvé</div>';
        resultsDiv.style.display = 'block';
        return;
    }

    resultsDiv.innerHTML = filteredCirconscriptions.map((circo, index) => {
        const highlightClass = index === selectedIndexCirconscription ? ' highlighted' : '';
        return `<div class="search-result-item${highlightClass}" data-action="select-circonscription" data-name="${escapeHtml(circo)}">
            ${escapeHtml(circo)}
        </div>`;
    }).join('');

    resultsDiv.style.display = 'block';
}

function updateHighlightCirconscription() {
    const resultsDiv = document.getElementById('searchResultsCirconscription');
    const items = resultsDiv.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
        if (index === selectedIndexCirconscription) {
            item.classList.add('highlighted');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('highlighted');
        }
    });
}

function selectCirconscription(circonscription) {
    document.getElementById('searchResultsCirconscription').style.display = 'none';
    currentSelection = { type: 'circonscription', id: circonscription };

    // Remplir le champ de recherche avec le nom complet
    document.getElementById('searchCirconscription').value = circonscription;

    const ecolesCirco = ecolesData.filter(e => e.circonscription === circonscription);

    let html = `
        <div class="export-buttons">
            <div class="left-buttons">
                <button class="btn btn-matrix" data-action="scroll-to-matrix">→ Matrice thématique des formations</button>
            </div>
            <div class="right-buttons">
                <button class="btn btn-export" data-action="export-csv" data-type="circonscription">Exporter CSV</button>
                <button class="btn btn-print" data-action="print">Imprimer</button>
            </div>
        </div>
    `;

    html += `
        <div class="profile-card">
            <h2 class="profile-title">Circonscription : ${escapeHtml(circonscription)}</h2>
            <div class="profile-text-secondary">
                <strong>Nombre d'écoles :</strong> ${ecolesCirco.length}
            </div>
        </div>
    `;

    if (ecolesCirco.length === 0) {
        html += '<div class="no-results">Aucune école trouvée pour cette circonscription.</div>';
        document.getElementById('resultsCirconscription').innerHTML = html;
        return;
    }

    ecolesCirco.forEach(ecole => {
        const formations = tableauBordData.filter(tb => tb.ecole === ecole.id);

        const formationsByYear = {};
        formations.forEach(formation => {
            if (!formation.annee) return;
            if (!formationsByYear[formation.annee]) {
                formationsByYear[formation.annee] = [];
            }
            formationsByYear[formation.annee].push(formation);
        });

        const years = Object.keys(formationsByYear).sort();

        html += `<div class="school-section">`;
        html += `<div class="school-header school-header-flex" data-action="toggle-collapse" title="Déplier la section">
            <span style="flex: 1;">${escapeHtml(ecole.nom_complement_commune)}</span>
            <span class="clickable-name" data-action="navigate-to-ecole" data-id="${ecole.id}" title="Voir la fiche dans l'onglet &#34;École&#34;" style="font-size: 14px; white-space: nowrap;">
                → Accéder à la fiche école
            </span>
        </div>`;
        html += `<div class="school-content collapsed">`;

        if (years.length === 0) {
            html += '<div class="no-formation">Aucune formation enregistrée pour cette école.</div>';
        } else {
            years.forEach(year => {
                const yearFormations = formationsByYear[year];
                html += `<div class="year-card">`;
                html += `<div class="year-header">Année scolaire ${escapeHtml(year)}</div>`;

                const formationGroups = groupFormationsByType(yearFormations);

                Object.entries(formationGroups).forEach(([key, group]) => {
                    html += `<div class="formation-group">`;
                    html += `<div class="formation-header">
                        ${group.type_formation ? 'Formation : ' + escapeHtml(group.type_formation) : 'Formation non spécifiée'}
                    </div>`;
                    html += `<div class="info-grid">`;
                    html += generateFormationInfoItems(group.formations[0], []);
                    html += `</div>`;
                    html += `</div>`;
                });

                html += `</div>`;
            });
        }

        html += `</div></div>`;
    });

    // Récupérer toutes les formations de toutes les écoles de la circonscription
    const allFormations = [];
    ecolesCirco.forEach(ecole => {
        const formations = tableauBordData.filter(tb => tb.ecole === ecole.id);
        allFormations.push(...formations);
    });

    // Ajouter la matrice thématique agrégée à la fin
    html += createAggregatedThematicMatrix(allFormations);

    document.getElementById('resultsCirconscription').innerHTML = html;
}

function groupFormationsByType(formations) {
    const groups = {};

    formations.forEach(formation => {
        const key = `${formation.type_formation || 'non-specifie'}_${(formation.modalite_constitution || []).sort().join('_')}_${(formation.themes || []).sort().join('_')}`;

        if (!groups[key]) {
            groups[key] = {
                type_formation: formation.type_formation,
                formations: []
            };
        }
        groups[key].formations.push(formation);
    });

    return groups;
}

function generateFormationInfoItems(formation, niveauxEnseignant = []) {
    let html = '';

    const niveaux = formation.niveau_x_ && formation.niveau_x_.length > 0
        ? formation.niveau_x_
        : niveauxEnseignant;

    if (niveaux && niveaux.length > 0) {
        html += `
            <div class="info-item">
                <div class="info-label">Niveau(x) de classe</div>
                <div class="info-value">
                    ${niveaux.map(n => `<span class="badge badge-primary">${escapeHtml(n)}</span>`).join(' ')}
                </div>
            </div>
        `;
    }

    if (formation.type_formation) {
        const heuresStr = formation.temps_formation > 0 ? ` (${formation.temps_formation}h)` : '';
        html += `
            <div class="info-item">
                <div class="info-label">Type de formation</div>
                <div class="info-value">${escapeHtml(formation.type_formation)}${escapeHtml(heuresStr)}</div>
            </div>
        `;
    }

    if (formation.formateurs && formation.formateurs.length > 0) {
        const noms = formation.formateurs
            .map(fid => {
                const f = formateursData.find(fd => fd.id === fid);
                return f ? f.nom : null;
            })
            .filter(Boolean);
        if (noms.length > 0) {
            html += `
                <div class="info-item">
                    <div class="info-label">Formateur(s)</div>
                    <div class="info-value">${noms.map(n => escapeHtml(n)).join(', ')}</div>
                </div>
            `;
        }
    }

    if (formation.modalite_constitution && formation.modalite_constitution.length > 0) {
        html += `
            <div class="info-item">
                <div class="info-label">Modalité de constitution du groupe</div>
                <div class="info-value">
                    ${formation.modalite_constitution.map(m => `<span class="badge badge-secondary">${escapeHtml(m)}</span>`).join(' ')}
                </div>
            </div>
        `;
    }

    if (formation.objets_transversaux && formation.objets_transversaux.length > 0) {
        html += `
            <div class="info-item">
                <div class="info-label">Objets transversaux traités en parallèle</div>
                <div class="info-value">
                    <ul>
                        ${formation.objets_transversaux.map(o => `<li>${escapeHtml(o)}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `;
    }

    if (formation.themes && formation.themes.length > 0) {
        html += `
            <div class="info-item">
                <div class="info-label">Thème(s) traité(s) en formation</div>
                <div class="info-value">
                    <ul>
                        ${formation.themes.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `;
    }

    if (formation.modalites_formation && formation.modalites_formation.length > 0) {
        html += `
            <div class="info-item">
                <div class="info-label">Modalités de formation</div>
                <div class="info-value">
                    ${formation.modalites_formation.map(m => `<span class="badge badge-success">${escapeHtml(m)}</span>`).join(' ')}
                </div>
            </div>
        `;
    }

    return html;
}

function exportToCSV(type) {
    if (!currentSelection.type || !currentSelection.id) {
        alert('Aucune sélection active pour l\'export');
        return;
    }

    let csvContent = '';
    let filename = '';

    if (type === 'enseignant') {
        const idPeText = currentSelection.id;
        const enseignant = enseignantsData.find(e => (e.id_pe || String(e.id)) === idPeText);
        if (!enseignant) return;

        filename = `formations_${enseignant.nom}_${enseignant.prenom}.csv`;
        csvContent = 'Année scolaire;École;Niveau(x);Type de formation;Modalité constitution;Objets transversaux;Thèmes\n';

        const allEnsRowIds = enseignantsData
            .filter(e => (e.id_pe || String(e.id)) === idPeText)
            .map(e => e.id);
        const formations = tableauBordData.filter(tb => allEnsRowIds.includes(tb.id_pe));

        formations.sort((a, b) => (a.annee || '').localeCompare(b.annee || '')).forEach(formation => {
            const ecole = ecolesData.find(e => e.id === formation.ecole);
            const niveaux = formation.niveau_x_ && formation.niveau_x_.length > 0
                ? formation.niveau_x_.join(', ')
                : enseignant.niveaux.join(', ');

            csvContent += `"${sanitizeCSV(formation.annee || '')}";`;
            csvContent += `"${sanitizeCSV(ecole ? ecole.nom_complement_commune : '')}";`;
            csvContent += `"${sanitizeCSV(niveaux)}";`;
            csvContent += `"${sanitizeCSV(formation.type_formation || '')}";`;
            csvContent += `"${sanitizeCSV((formation.modalite_constitution || []).join(', '))}";`;
            csvContent += `"${sanitizeCSV((formation.objets_transversaux || []).join(', '))}";`;
            csvContent += `"${sanitizeCSV((formation.themes || []).join(', '))}"`;
            csvContent += '\n';
        });

    } else if (type === 'ecole') {
        const ecole = ecolesData.find(e => e.id === currentSelection.id);
        if (!ecole) return;

        filename = `formations_${ecole.nom.replace(/[^a-z0-9]/gi, '_')}.csv`;
        csvContent = 'Année scolaire;Enseignant;Niveau(x);Type de formation;Modalité constitution;Objets transversaux;Thèmes\n';

        const formations = tableauBordData.filter(tb => tb.ecole === currentSelection.id);

        formations.sort((a, b) => (a.annee || '').localeCompare(b.annee || '')).forEach(formation => {
            const nomPE = enseignantsData.find(e => e.id === formation.nom_pe);
            const prenomPE = enseignantsData.find(e => e.id === formation.prenom_pe);
            const enseignant = nomPE || prenomPE;
            const niveaux = formation.niveau_x_ && formation.niveau_x_.length > 0
                ? formation.niveau_x_.join(', ')
                : (enseignant && enseignant.niveaux ? enseignant.niveaux.join(', ') : '');

            csvContent += `"${sanitizeCSV(formation.annee || '')}";`;
            csvContent += `"${sanitizeCSV(enseignant ? enseignant.prenom + ' ' + enseignant.nom : '')}";`;
            csvContent += `"${sanitizeCSV(niveaux)}";`;
            csvContent += `"${sanitizeCSV(formation.type_formation || '')}";`;
            csvContent += `"${sanitizeCSV((formation.modalite_constitution || []).join(', '))}";`;
            csvContent += `"${sanitizeCSV((formation.objets_transversaux || []).join(', '))}";`;
            csvContent += `"${sanitizeCSV((formation.themes || []).join(', '))}"`;
            csvContent += '\n';
        });

    } else if (type === 'circonscription') {
        const circonscription = currentSelection.id;
        filename = `formations_${circonscription.replace(/[^a-z0-9]/gi, '_')}.csv`;
        csvContent = 'Année scolaire;École;Type de formation;Modalité constitution;Objets transversaux;Thèmes\n';

        const ecolesCirco = ecolesData.filter(e => e.circonscription === circonscription);

        ecolesCirco.forEach(ecole => {
            const formations = tableauBordData.filter(tb => tb.ecole === ecole.id);

            formations.sort((a, b) => (a.annee || '').localeCompare(b.annee || '')).forEach(formation => {
                csvContent += `"${sanitizeCSV(formation.annee || '')}";`;
                csvContent += `"${sanitizeCSV(ecole.nom_complement_commune)}";`;
                csvContent += `"${sanitizeCSV(formation.type_formation || '')}";`;
                csvContent += `"${sanitizeCSV((formation.modalite_constitution || []).join(', '))}";`;
                csvContent += `"${sanitizeCSV((formation.objets_transversaux || []).join(', '))}";`;
                csvContent += `"${sanitizeCSV((formation.themes || []).join(', '))}"`;
                csvContent += '\n';
            });
        });
    }

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

document.getElementById('searchEnseignant').addEventListener('input', searchEnseignants);
document.getElementById('searchEnseignant').addEventListener('keydown', searchEnseignants);

document.getElementById('searchEcole').addEventListener('input', searchEcoles);
document.getElementById('searchEcole').addEventListener('keydown', searchEcoles);

document.getElementById('searchCirconscription').addEventListener('input', searchCirconscriptions);
document.getElementById('searchCirconscription').addEventListener('keydown', searchCirconscriptions);

// Event delegation globale pour tous les clics
document.addEventListener('click', function (event) {
    const target = event.target.closest('[data-action]');

    if (!target) {
        // Gérer la fermeture des résultats de recherche
        const searchResults = document.querySelectorAll('.search-results');
        const searchInputs = document.querySelectorAll('.search-input');

        let clickedInside = false;
        searchInputs.forEach(input => {
            if (input.contains(event.target)) clickedInside = true;
        });
        searchResults.forEach(results => {
            if (results.contains(event.target)) clickedInside = true;
        });

        if (!clickedInside) {
            searchResults.forEach(results => results.style.display = 'none');
        }
        return;
    }

    const action = target.dataset.action;

    // Actions de sélection
    if (action === 'select-enseignant') {
        selectEnseignant(Number(target.dataset.id));
    } else if (action === 'select-ecole') {
        selectEcole(Number(target.dataset.id));
    } else if (action === 'select-circonscription') {
        selectCirconscription(target.dataset.name);
    }

    // Actions de navigation
    else if (action === 'navigate-to-enseignant') {
        event.stopPropagation();
        navigateToEnseignant(Number(target.dataset.id));
    } else if (action === 'navigate-to-ecole') {
        event.stopPropagation();
        navigateToEcole(Number(target.dataset.id));
    }

    // Actions d'interface
    else if (action === 'toggle-collapse') {
        toggleCollapse(target);
    } else if (action === 'scroll-to-matrix') {
        scrollToMatrix();
    } else if (action === 'export-csv') {
        exportToCSV(target.dataset.type);
    } else if (action === 'print') {
        window.print();
    } else if (action === 'print-pdf') {
        printPDF(target.dataset.target);
    }

    // Actions de matrice
    else if (action === 'toggle-category') {
        toggleCategory(target.dataset.category, target.dataset.matrixId);
    }
});

// Event delegation pour les changements (checkboxes de matrice)
document.addEventListener('change', function (event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;

    if (action === 'toggle-empty') {
        toggleEmptyItems(target.dataset.matrixId);
    }
});

// Gestion du bouton flottant "Retour en haut" et du sticky compact pour profile-card
const scrollTopBtn = document.getElementById('scrollTopBtn');

window.addEventListener('scroll', function () {
    const scrollPosition = window.pageYOffset;

    // Gestion du bouton retour en haut
    if (scrollPosition > 300) {
        scrollTopBtn.classList.add('show');
    } else {
        scrollTopBtn.classList.remove('show');
    }

    // Gestion du sticky compact pour les profile-cards
    const profileCards = document.querySelectorAll('.profile-card');
    profileCards.forEach(card => {
        if (scrollPosition > 100) {
            card.classList.add('sticky-compact');
        } else {
            card.classList.remove('sticky-compact');
        }
    });
});

scrollTopBtn.addEventListener('click', scrollToTop);

loadData();