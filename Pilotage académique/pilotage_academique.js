grist.ready({ requiredAccess: 'read table' });

let ecolesData = [];
let tableauBordData = [];
let currentSelection = {
    type: null,
    id: null
};

// Stockage global des données de graphiques pour le filtrage dynamique
const graphsDataStore = {};

// Variables pour la navigation au clavier
let selectedIndexDepartement = 0;
let filteredDepartements = [];

/**
 * Échappe les caractères HTML pour prévenir les injections XSS
 * @param {string} str - La chaîne à échapper
 * @returns {string} - La chaîne échappée
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const text = String(str);
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Sécurise une valeur pour éviter les injections dans les exports CSV/Excel
 * Préfixe les caractères dangereux: =, +, -, @, \t, \r
 * @param {string} value - La valeur à sécuriser
 * @returns {string} - La valeur sécurisée
 */
function sanitizeCSVValue(value) {
    if (value === null || value === undefined) return '';
    const str = String(value).trim();
    if (str.length === 0) return str;

    const dangerousChars = ['=', '+', '-', '@', '\t', '\r'];
    if (dangerousChars.some(char => str.startsWith(char))) {
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
            type_formation: tableauTable.Type_de_formation[index] || ''
        }));

        console.log('Données chargées:', {
            ecoles: ecolesData.length,
            formations: tableauBordData.length
        });

        // Initialiser les boutons radio des départements
        initDepartementsRadio();

        // Initialiser l'onglet académie
        displayAcademie();

    } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
        alert('Erreur lors du chargement des données. Veuillez recharger la page.');
    }
}

function switchTab(tabName, targetElement) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    if (targetElement) {
        targetElement.classList.add('active');
    }

    const tabContent = document.getElementById(tabName);
    if (tabContent) {
        tabContent.classList.add('active');
    }

    const searchResults = document.querySelectorAll('.search-results');
    searchResults.forEach(result => result.style.display = 'none');

    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Si on bascule sur l'onglet académie et qu'il est vide, l'initialiser
    if (tabName === 'academie' && document.getElementById('resultsAcademie').innerHTML === '') {
        displayAcademie();
    }
}

function scrollToMatrix() {
    setTimeout(() => {
        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab) {
            // Chercher la matrice globale (celle qui n'est pas dans une section-content)
            const matrices = activeTab.querySelectorAll('.matrix-container');
            let matrixContainer = null;

            // Trouver la première matrice qui n'est PAS dans une .section-content
            for (let matrix of matrices) {
                if (!matrix.closest('.section-content')) {
                    matrixContainer = matrix;
                    break;
                }
            }

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

        const imgData = canvas.toDataURL('image/jpeg', 0.8);

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
        element.classList.remove('collapsed');
        element.setAttribute('title', 'Replier la section');
    } else {
        content.classList.add('collapsed');
        element.classList.add('collapsed');
        element.setAttribute('title', 'Déplier la section');
    }
}

function initDepartementsRadio() {
    // Récupérer tous les départements uniques depuis ecolesData
    const departements = [...new Set(ecolesData.map(e => e.departement).filter(d => d))].sort();

    const container = document.getElementById('radioDepartementsContainer');
    if (!container) return;

    container.innerHTML = '';

    if (departements.length === 0) {
        container.innerHTML = '<div class="no-results">Aucun département disponible.</div>';
        return;
    }

    // Créer les boutons radio
    departements.forEach((dept, index) => {
        const radioOption = document.createElement('div');
        radioOption.className = 'radio-option';

        const radioId = `radio-dept-${index}`;
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'departement';
        radio.id = radioId;
        radio.value = dept;

        const label = document.createElement('label');
        label.className = 'radio-label';
        label.htmlFor = radioId;
        label.textContent = escapeHtml(dept);

        // Attacher l'événement de sélection
        radio.addEventListener('change', function () {
            if (this.checked) {
                selectDepartement(dept);
            }
        });

        radioOption.appendChild(radio);
        radioOption.appendChild(label);
        container.appendChild(radioOption);
    });

    // Si un seul département, le sélectionner automatiquement
    if (departements.length === 1) {
        const firstRadio = container.querySelector('input[type="radio"]');
        if (firstRadio) {
            firstRadio.checked = true;
            selectDepartement(departements[0]);
        }
    }
}

/* Anciennes fonctions de recherche - désormais obsolètes avec les boutons radio
function clearSearch(type) {
    if (type === 'departement') {
        document.getElementById('searchDepartement').value = '';
        document.getElementById('searchResultsDepartement').innerHTML = '';
        document.getElementById('searchResultsDepartement').style.display = 'none';
        document.getElementById('resultsDepartement').innerHTML = '';
        currentSelection = { type: null, id: null };
    }
}

function searchDepartements(event) {
    const searchTerm = event.target.value.toLowerCase().trim();
    const resultsDiv = document.getElementById('searchResultsDepartement');

    if (searchTerm.length < 2) {
        resultsDiv.style.display = 'none';
        selectedIndexDepartement = 0;
        return;
    }

    // Navigation avec les flèches
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (filteredDepartements.length > 0) {
            selectedIndexDepartement = Math.min(selectedIndexDepartement + 1, filteredDepartements.length - 1);
            updateHighlightDepartement();
        }
        return;
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (filteredDepartements.length > 0) {
            selectedIndexDepartement = Math.max(selectedIndexDepartement - 1, 0);
            updateHighlightDepartement();
        }
        return;
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        if (filteredDepartements.length > 0) {
            selectDepartement(filteredDepartements[selectedIndexDepartement]);
        }
        return;
    }

    // Filtrer les résultats
    const departements = [...new Set(ecolesData.map(e => e.departement).filter(d => d))];
    filteredDepartements = departements.filter(d =>
        d.toLowerCase().includes(searchTerm)
    ).slice(0, 15);

    selectedIndexDepartement = 0;

    if (filteredDepartements.length === 0) {
        resultsDiv.innerHTML = '<div class="search-result-item">Aucun résultat trouvé</div>';
        resultsDiv.style.display = 'block';
        return;
    }

    resultsDiv.innerHTML = '';

    filteredDepartements.forEach((dept, index) => {
        const div = document.createElement('div');
        div.className = 'search-result-item' + (index === selectedIndexDepartement ? ' highlighted' : '');
        div.textContent = dept;
        div.addEventListener('click', () => selectDepartement(dept));
        resultsDiv.appendChild(div);
    });

    resultsDiv.style.display = 'block';
}

function updateHighlightDepartement() {
    const resultsDiv = document.getElementById('searchResultsDepartement');
    const items = resultsDiv.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
        if (index === selectedIndexDepartement) {
            item.classList.add('highlighted');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('highlighted');
        }
    });
}
*/

function selectDepartement(departement) {
    currentSelection = { type: 'departement', id: departement };

    // Récupérer les circonscriptions du département
    const circonscriptionsDept = [...new Set(
        ecolesData
            .filter(e => e.departement === departement)
            .map(e => e.circonscription)
            .filter(c => c)
    )].sort();

    let html = `
        <div class="export-buttons">
            <div class="left-buttons">
                <button class="btn btn-matrix" data-action="scrollToMatrix">→ Matrice thématique des formations</button>
            </div>
            <div class="right-buttons">
                <button class="btn btn-export" data-action="exportCSV" data-type="departement">Exporter CSV</button>
                <button class="btn btn-print" data-action="print">Imprimer</button>
            </div>
        </div>
    `;

    html += `
        <div class="profile-card">
            <h2 class="profile-title">Département : ${escapeHtml(departement)}</h2>
            <div class="profile-text-secondary">
                <strong>Nombre de circonscriptions :</strong> ${circonscriptionsDept.length}
            </div>
        </div>
    `;

    if (circonscriptionsDept.length === 0) {
        html += '<div class="no-results">Aucune circonscription trouvée pour ce département.</div>';
    } else {
        circonscriptionsDept.forEach(circonscription => {
            const ecolesCirco = ecolesData.filter(e =>
                e.departement === departement && e.circonscription === circonscription
            );

            const formationsCirco = tableauBordData.filter(tb => {
                const ecole = ecolesData.find(e => e.id === tb.ecole);
                return ecole && ecole.departement === departement && ecole.circonscription === circonscription;
            });

            const sectionId = `circo-${Math.random().toString(36).substr(2, 9)}`;
            html += `<div class="section-card">`;
            html += `<div class="section-header collapsed" data-section-id="${sectionId}" title="Déplier la section">
                ${escapeHtml(circonscription)} (${ecolesCirco.length} école${ecolesCirco.length > 1 ? 's' : ''})
            </div>`;
            html += `<div class="section-content collapsed">`;
            html += createAggregatedThematicMatrix(formationsCirco, sectionId);
            html += `</div></div>`;
        });
    }

    // Récupérer toutes les formations du département
    const formationsDept = tableauBordData.filter(tb => {
        const ecole = ecolesData.find(e => e.id === tb.ecole);
        return ecole && ecole.departement === departement;
    });

    // Ajouter la matrice thématique du département
    html += createAggregatedThematicMatrix(formationsDept, `dept-${Math.random().toString(36).substr(2, 9)}`);

    const resultsDiv = document.getElementById('resultsDepartement');
    resultsDiv.innerHTML = html;

    // Attacher les événements après l'insertion du HTML
    attachSectionHeaderEvents(resultsDiv);
}

function displayAcademie() {
    // Récupérer tous les départements
    const departements = [...new Set(ecolesData.map(e => e.departement).filter(d => d))].sort();

    let html = `
        <div class="export-buttons">
            <div class="left-buttons">
                <button class="btn btn-matrix" data-action="scrollToMatrix">→ Matrice thématique des formations</button>
            </div>
            <div class="right-buttons">
                <button class="btn btn-export" data-action="exportCSV" data-type="academie">Exporter CSV</button>
                <button class="btn btn-print" data-action="print">Imprimer</button>
            </div>
        </div>
    `;

    html += `
        <div class="profile-card">
            <h2 class="profile-title">Vue Académie</h2>
            <div class="profile-text-secondary">
                <strong>Nombre de départements :</strong> ${departements.length}
            </div>
        </div>
    `;

    if (departements.length === 0) {
        html += '<div class="no-results">Aucun département trouvé.</div>';
    } else {
        departements.forEach(departement => {
            const ecolesDept = ecolesData.filter(e => e.departement === departement);

            const formationsDept = tableauBordData.filter(tb => {
                const ecole = ecolesData.find(e => e.id === tb.ecole);
                return ecole && ecole.departement === departement;
            });

            const sectionId = `dept-acad-${Math.random().toString(36).substr(2, 9)}`;
            html += `<div class="section-card">`;
            html += `<div class="section-header collapsed" data-section-id="${sectionId}" title="Déplier la section">
                ${escapeHtml(departement)} (${ecolesDept.length} école${ecolesDept.length > 1 ? 's' : ''})
            </div>`;
            html += `<div class="section-content collapsed">`;
            html += createAggregatedThematicMatrix(formationsDept, sectionId);
            html += `</div></div>`;
        });
    }

    // Récupérer toutes les formations de l'académie
    const formationsAcademie = tableauBordData;

    // Ajouter la matrice thématique de l'académie
    html += createAggregatedThematicMatrix(formationsAcademie, `acad-${Math.random().toString(36).substr(2, 9)}`);

    const resultsDiv = document.getElementById('resultsAcademie');
    resultsDiv.innerHTML = html;

    // Attacher les événements après l'insertion du HTML
    attachSectionHeaderEvents(resultsDiv);
}

function createAggregatedThematicMatrix(formations, matrixId) {
    // Liste prédéfinie de tous les thèmes possibles
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

    // Liste prédéfinie de tous les objets transversaux possibles
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
            matrix[theme][objet] = [];
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
    html += `<input type="checkbox" id="toggle-empty-${matrixId}" onchange="toggleEmptyItems('${matrixId}')">`;
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
        html += `<th class="${emptyClass}" title="${escapeHtml(objet)}">${escapeHtml(objet)}</th>`;
    });

    html += '</tr></thead><tbody>';

    // Séparer les thèmes en catégories
    const frenchThemes = themesArray.filter(t => t.startsWith('FRA'));
    const mathThemes = themesArray.filter(t => t.startsWith('MA'));

    // Catégorie Français
    if (frenchThemes.length > 0) {
        html += `<tr class="category-row" data-category="french" data-matrix-id="${matrixId}">`;
        html += `<th colspan="${objetsArray.length + 1}">Français</th>`;
        html += '</tr>';

        frenchThemes.forEach(theme => {
            const emptyRowClass = emptyRows.includes(theme) ? ' empty-row hidden' : '';
            html += `<tr class="theme-row french-theme${emptyRowClass}">`;
            html += `<th title="${escapeHtml(theme)}">${escapeHtml(theme)}</th>`;

            objetsArray.forEach(objet => {
                const cells = matrix[theme][objet];
                const emptyColClass = emptyCols.includes(objet) ? ' hidden' : '';
                const cellsJson = JSON.stringify(cells).replace(/"/g, '&quot;');

                if (cells.length === 0) {
                    html += `<td class="${emptyColClass}" data-cells="${cellsJson}"></td>`;
                } else if (cells.length === 1) {
                    const cell = cells[0];
                    const typeClass = getTypeClass(cell.type);
                    const tooltip = escapeHtml(`${cell.type || 'Non spécifié'} - ${cell.annee || 'Année non spécifiée'}`);
                    html += `<td class="filled-cell ${typeClass}${emptyColClass}" title="${tooltip}" data-cells="${cellsJson}">${escapeHtml(cell.annee)}</td>`;
                } else {
                    const colors = cells.map(c => getTypeColor(c.type));
                    const gradient = createGradient(colors);
                    const tooltip = escapeHtml(cells.map(c => `${c.annee || '?'} : ${c.type || 'Non spécifié'}`).join('\n'));
                    html += `<td class="filled-cell multi-formation${emptyColClass}" style="background: ${gradient};" title="${tooltip}" data-cells="${cellsJson}">×${cells.length}</td>`;
                }
            });

            html += '</tr>';
        });
    }

    // Catégorie Mathématiques
    if (mathThemes.length > 0) {
        html += `<tr class="category-row" data-category="math" data-matrix-id="${matrixId}">`;
        html += `<th colspan="${objetsArray.length + 1}">Mathématiques</th>`;
        html += '</tr>';

        mathThemes.forEach(theme => {
            const emptyRowClass = emptyRows.includes(theme) ? ' empty-row hidden' : '';
            html += `<tr class="theme-row math-theme${emptyRowClass}">`;
            html += `<th title="${escapeHtml(theme)}">${escapeHtml(theme)}</th>`;

            objetsArray.forEach(objet => {
                const cells = matrix[theme][objet];
                const emptyColClass = emptyCols.includes(objet) ? ' hidden' : '';
                const cellsJson = JSON.stringify(cells).replace(/"/g, '&quot;');

                if (cells.length === 0) {
                    html += `<td class="${emptyColClass}" data-cells="${cellsJson}"></td>`;
                } else if (cells.length === 1) {
                    const cell = cells[0];
                    const typeClass = getTypeClass(cell.type);
                    const tooltip = escapeHtml(`${cell.type || 'Non spécifié'} - ${cell.annee || 'Année non spécifiée'}`);
                    html += `<td class="filled-cell ${typeClass}${emptyColClass}" title="${tooltip}" data-cells="${cellsJson}">${escapeHtml(cell.annee)}</td>`;
                } else {
                    const colors = cells.map(c => getTypeColor(c.type));
                    const gradient = createGradient(colors);
                    const tooltip = escapeHtml(cells.map(c => `${c.annee || '?'} : ${c.type || 'Non spécifié'}`).join('\n'));
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

        html += `<path class="pie-slice" data-year="${escapeHtml(item.year)}" d="M ${centerX} ${centerY} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY} Z" fill="${color}" stroke="white" stroke-width="2"/>`;

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

    const step = 100 / colors.length;
    const stops = colors.map((color, index) => {
        const start = index * step;
        const end = (index + 1) * step;
        return `${color} ${start}%, ${color} ${end}%`;
    });

    return `linear-gradient(to right, ${stops.join(', ')})`;
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

function toggleEmptyItems(matrixId) {
    const checkbox = document.getElementById(`toggle-empty-${matrixId}`);
    const label = document.getElementById(`toggle-label-${matrixId}`);
    const table = document.getElementById(`table-${matrixId}`);

    if (checkbox.checked) {
        label.textContent = 'Masquer les items non abordés';

        table.querySelectorAll('.empty-row.hidden, .empty-col.hidden').forEach(el => {
            el.classList.remove('hidden');
        });

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
        label.textContent = 'Afficher les items non abordés';

        table.querySelectorAll('.empty-row').forEach(el => {
            el.classList.add('hidden');
        });
        table.querySelectorAll('.empty-col').forEach(el => {
            el.classList.add('hidden');
        });

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
    if (!table) return;

    const categoryRows = table.querySelectorAll(`.category-row`);

    let clickedRow = null;
    categoryRows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if ((category === 'french' && text.includes('français')) ||
            (category === 'math' && text.includes('mathématiques'))) {
            clickedRow = row;
        }
    });

    if (!clickedRow) return;

    clickedRow.classList.toggle('collapsed');

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
            cell.title = escapeHtml(`${item.type || 'Non spécifié'} - ${item.annee || 'Année non spécifiée'}`);
        } else {
            const colors = filteredCells.map(c => getTypeColor(c.type));
            const gradient = createGradient(colors);
            cell.className = cell.className.replace(/type-\w+/g, '').trim();
            if (!cell.classList.contains('filled-cell')) cell.classList.add('filled-cell');
            if (!cell.classList.contains('multi-formation')) cell.classList.add('multi-formation');
            cell.innerHTML = `×${filteredCells.length}`;
            cell.style.background = gradient;
            cell.title = escapeHtml(filteredCells.map(c => `${c.annee || '?'} : ${c.type || 'Non spécifié'}`).join('\n'));
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

/**
 * Attache les événements click aux en-têtes de section, aux catégories de matrices et aux boutons d'action
 * @param {HTMLElement} container - Le conteneur contenant les sections
 */
function attachSectionHeaderEvents(container) {
    // Attacher les événements aux en-têtes de section
    const headers = container.querySelectorAll('.section-header');
    headers.forEach(header => {
        header.addEventListener('click', function () {
            toggleCollapse(this);
        });
    });

    // Attacher les événements aux lignes de catégorie des matrices
    const categoryRows = container.querySelectorAll('.category-row');
    categoryRows.forEach(row => {
        const category = row.getAttribute('data-category');
        const matrixId = row.getAttribute('data-matrix-id');
        if (category && matrixId) {
            row.addEventListener('click', function () {
                toggleCategory(category, matrixId);
            });
        }
    });

    // Attacher les événements aux boutons d'action
    const actionButtons = container.querySelectorAll('[data-action]');
    actionButtons.forEach(button => {
        const action = button.getAttribute('data-action');

        if (action === 'scrollToMatrix') {
            button.addEventListener('click', scrollToMatrix);
        } else if (action === 'exportCSV') {
            const type = button.getAttribute('data-type');
            button.addEventListener('click', function () {
                exportToCSV(type);
            });
        } else if (action === 'print') {
            button.addEventListener('click', function () {
                window.print();
            });
        } else if (action === 'print-pdf') {
            button.addEventListener('click', function () {
                const target = button.dataset.target;
                printPDF(target);
            });
        }
    });
}

function exportToCSV(type) {
    let csvContent = '';
    let filename = '';

    if (type === 'departement') {
        if (!currentSelection.id) {
            alert('Aucun département sélectionné');
            return;
        }

        const departement = currentSelection.id;
        filename = `formations_${departement.replace(/[^a-z0-9]/gi, '_')}.csv`;
        csvContent = 'Circonscription;Année scolaire;École;Type de formation;Modalité constitution;Objets transversaux;Thèmes\n';

        const ecolesDept = ecolesData.filter(e => e.departement === departement);

        ecolesDept.forEach(ecole => {
            const formations = tableauBordData.filter(tb => tb.ecole === ecole.id);

            formations.sort((a, b) => (a.annee || '').localeCompare(b.annee || '')).forEach(formation => {
                csvContent += `"${sanitizeCSVValue(ecole.circonscription || '')}";`;
                csvContent += `"${sanitizeCSVValue(formation.annee || '')}";`;
                csvContent += `"${sanitizeCSVValue(ecole.nom_complement_commune)}";`;
                csvContent += `"${sanitizeCSVValue(formation.type_formation || '')}";`;
                csvContent += `"${sanitizeCSVValue((formation.modalite_constitution || []).join(', '))}";`;
                csvContent += `"${sanitizeCSVValue((formation.objets_transversaux || []).join(', '))}";`;
                csvContent += `"${sanitizeCSVValue((formation.themes || []).join(', '))}"`;
                csvContent += '\n';
            });
        });

    } else if (type === 'academie') {
        filename = 'formations_academie.csv';
        csvContent = 'Département;Circonscription;Année scolaire;École;Type de formation;Modalité constitution;Objets transversaux;Thèmes\n';

        ecolesData.forEach(ecole => {
            const formations = tableauBordData.filter(tb => tb.ecole === ecole.id);

            formations.sort((a, b) => (a.annee || '').localeCompare(b.annee || '')).forEach(formation => {
                csvContent += `"${sanitizeCSVValue(ecole.departement || '')}";`;
                csvContent += `"${sanitizeCSVValue(ecole.circonscription || '')}";`;
                csvContent += `"${sanitizeCSVValue(formation.annee || '')}";`;
                csvContent += `"${sanitizeCSVValue(ecole.nom_complement_commune)}";`;
                csvContent += `"${sanitizeCSVValue(formation.type_formation || '')}";`;
                csvContent += `"${sanitizeCSVValue((formation.modalite_constitution || []).join(', '))}";`;
                csvContent += `"${sanitizeCSVValue((formation.objets_transversaux || []).join(', '))}";`;
                csvContent += `"${sanitizeCSVValue((formation.themes || []).join(', '))}"`;
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

// Event listeners
// Onglets
document.getElementById('tabDepartement').addEventListener('click', function (e) {
    switchTab('departement', e.target);
});
document.getElementById('tabAcademie').addEventListener('click', function (e) {
    switchTab('academie', e.target);
});

// Anciens event listeners de recherche - désormais obsolètes avec les boutons radio
/*
// Bouton de clear search
document.getElementById('clearSearchDepartement').addEventListener('click', function () {
    clearSearch('departement');
});

// Recherche de département
document.getElementById('searchDepartement').addEventListener('input', searchDepartements);
document.getElementById('searchDepartement').addEventListener('keydown', searchDepartements);
*/

document.addEventListener('click', function (event) {
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