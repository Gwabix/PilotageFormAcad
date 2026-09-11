'use strict';

/*
 * Module partagé — rattacher un enseignant existant à une école.
 *
 * Source unique de la LOGIQUE de l'ajout d'un enseignant, utilisée par
 * « TDB-Ecoles » et « Formulaire ». Chaque widget garde son propre balisage :
 * les feuilles de style et les conventions d'écriture diffèrent, et c'est
 * légitime. En revanche le calcul des écritures ne doit pas diverger, car il
 * décide quelles lignes sont déplacées, recyclées, créées ou détachées.
 *
 * MODÈLE DE DONNÉES — un enseignant exerçant sur plusieurs établissements a
 * UNE LIGNE Liste_PE par école et par année. « Rattacher à une école » ne
 * consiste donc pas à modifier une ligne, mais à aligner l'ensemble des
 * lignes de l'année sur la liste d'écoles voulue.
 *
 * PRIORITÉ DE RÉUTILISATION, dans cet ordre :
 *   1. une ligne dont l'affectation est retirée — elle est simplement
 *      déplacée, ce qui préserve son historique de formations ;
 *   2. une ligne détachée de la même année — typiquement une libération en
 *      attente de reprise ;
 *   3. à défaut seulement, une nouvelle ligne.
 * Créer sans avoir épuisé ces deux réserves laisserait derrière soi des
 * doublons et des lignes fantômes.
 *
 * Dépendances : ./search-text.js (normalisation) et ./liste-pe-retrait.js
 * (règle de détachement).
 */

(function (global) {
    const MAX_RESULTS = 30;

    function text(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/\s+/g, ' ').trim();
    }

    function norm(value) {
        return global.SearchText.normalize(value);
    }

    /**
     * Row ID de l'école d'une ligne Liste_PE, 0 si détachée.
     *
     * Une colonne de référence Grist se lit tantôt comme un nombre, tantôt
     * comme une liste ou un objet selon le chemin d'accès : on cherche donc le
     * premier nombre exploitable.
     */
    function ecoleRowIdOf(row) {
        const raw = row ? row.UAI : null;
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
        if (Array.isArray(raw)) {
            for (const item of raw) {
                if (typeof item === 'number' && Number.isFinite(item)) return item;
            }
            return 0;
        }
        const num = Number(raw);
        return Number.isFinite(num) ? num : 0;
    }

    // Année de début d'une année scolaire « 2026-2027 » -> 2026.
    function schoolYearStartOf(row) {
        const match = text(row && row.Annee_scolaire).match(/(\d{4})/);
        return match ? parseInt(match[1], 10) : null;
    }

    function identityOf(row) {
        return [text(row.Civilite), text(row.Prenom), text(row.Nom)]
            .filter(Boolean).join(' ').trim();
    }

    /*
     * Pertinence d'un texte pour une requête, les deux déjà normalisés :
     *   0 = le texte commence par la requête
     *   1 = un mot du texte commence par la requête
     *   2 = la requête apparaît au milieu d'un mot
     *  -1 = aucune correspondance
     */
    function matchRank(normalizedText, normalizedQuery) {
        if (!normalizedQuery || !normalizedText) return -1;
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

    /**
     * Personnes de Liste_PE, regroupées par identifiant personnel.
     *
     * Une ligne sans ID_PE est sa propre personne, clé « row:<id> » : sans
     * identifiant, rien ne permet de la rapprocher d'une autre ligne sans
     * risquer de confondre deux agents.
     *
     * @param {object[]} listePe
     * @param {number|null} currentYearStart année de début, ou null pour ne
     *   pas filtrer
     * @returns {Map<string, object>} person = { key, idPe, identity, civilite,
     *   mail, rows, yearRows, affectations: [{ row, ecoleRowId }] }
     */
    function buildPersonIndex(listePe, currentYearStart) {
        const byKey = new Map();

        for (const row of (listePe || [])) {
            const idPe = text(row.ID_PE);
            const key = idPe || ('row:' + row.id);
            let person = byKey.get(key);
            if (!person) {
                person = { key, idPe, rows: [], identity: '', mail: '', civilite: '' };
                byKey.set(key, person);
            }
            person.rows.push(row);
        }

        for (const person of byKey.values()) {
            // Identité prise sur la première ligne qui la renseigne.
            for (const row of person.rows) {
                if (!person.identity) person.identity = identityOf(row);
                if (!person.mail) person.mail = text(row.Mail);
                if (!person.civilite) person.civilite = text(row.Civilite);
            }

            person.yearRows = person.rows.filter(row =>
                currentYearStart === null || currentYearStart === undefined
                || schoolYearStartOf(row) === currentYearStart);

            person.affectations = person.yearRows
                .filter(row => ecoleRowIdOf(row) > 0)
                .map(row => ({ row, ecoleRowId: ecoleRowIdOf(row) }));
        }

        return byKey;
    }

    /**
     * Personnes correspondant à une requête, les mieux classées d'abord.
     *
     * Recherche sur le nom, le prénom et l'identifiant personnel. Les
     * personnes déjà rattachées à l'école cible sont écartées : il n'y a rien
     * à leur ajouter.
     *
     * @param {Map<string, object>} index résultat de buildPersonIndex()
     * @param {string} query requête brute
     * @param {number} excludeEcoleRowId école cible
     * @returns {object[]}
     */
    function searchPersons(index, query, excludeEcoleRowId) {
        const normalizedQuery = norm(query);
        if (!normalizedQuery) return [];

        const scored = [];
        for (const person of index.values()) {
            const first = person.rows[0];
            const nom = norm(first.Nom);
            const prenom = norm(first.Prenom);

            const ranks = [
                matchRank(nom, normalizedQuery),
                matchRank(prenom, normalizedQuery),
                matchRank(norm(person.idPe), normalizedQuery)
            ].filter(rank => rank !== -1);
            if (!ranks.length) continue;

            if (person.affectations.some(a => a.ecoleRowId === excludeEcoleRowId)) continue;

            scored.push({
                person,
                rank: Math.min.apply(null, ranks),
                sortKey: nom + ' ' + prenom
            });
        }

        scored.sort((a, b) => (a.rank - b.rank) || a.sortKey.localeCompare(b.sortKey, 'fr'));
        return scored.slice(0, MAX_RESULTS).map(entry => entry.person);
    }

    /**
     * Actions alignant les affectations de l'année d'une personne sur la liste
     * d'écoles voulue.
     *
     * @param {object} person entrée de buildPersonIndex()
     * @param {number[]} keepEcoleRowIds écoles à conserver, cible incluse
     * @returns {Array[]} actions Grist, vide s'il n'y a rien à changer
     */
    function buildAffectationActions(person, keepEcoleRowIds) {
        if (!person) return [];

        const keep = new Set((keepEcoleRowIds || [])
            .filter(id => Number.isFinite(id) && id > 0));

        const current = new Map();
        person.affectations.forEach(a => current.set(a.ecoleRowId, a.row));

        const toRemove = [];
        for (const [ecoleRowId, row] of current) {
            if (!keep.has(ecoleRowId)) toRemove.push(row);
        }
        const toAdd = [];
        for (const ecoleRowId of keep) {
            if (!current.has(ecoleRowId)) toAdd.push(ecoleRowId);
        }
        if (!toRemove.length && !toAdd.length) return [];

        const actions = [];
        const anneeScolaire = person.yearRows.length
            ? person.yearRows[0].Annee_scolaire
            : (person.rows[0] && person.rows[0].Annee_scolaire);

        // Lignes détachées de l'année, réutilisables avant toute création.
        const reusable = person.yearRows.filter(row => ecoleRowIdOf(row) <= 0);

        for (const ecoleRowId of toAdd) {
            // 1. Déplacer une affectation retirée : son historique suit.
            const moved = toRemove.shift();
            if (moved) {
                actions.push(['UpdateRecord', 'Liste_PE', moved.id,
                    { UAI: ecoleRowId, Retrait: null }]);
                continue;
            }
            // 2. Reprendre une ligne détachée — souvent une libération.
            const recycled = reusable.shift();
            if (recycled) {
                actions.push(['UpdateRecord', 'Liste_PE', recycled.id,
                    { UAI: ecoleRowId, Retrait: null }]);
                continue;
            }
            // 3. En dernier ressort seulement, une nouvelle ligne.
            const source = person.yearRows[0] || person.rows[0];
            actions.push(['AddRecord', 'Liste_PE', null, {
                ID_PE: person.idPe,
                Civilite: text(source.Civilite),
                Nom: text(source.Nom),
                Prenom: text(source.Prenom),
                Mail: text(source.Mail),
                Annee_scolaire: anneeScolaire,
                UAI: ecoleRowId,
                Fonction: '',
                Quotite_de_service: text(source.Quotite_de_service),
                Retrait: null
            }]);
        }

        // Affectations retirées sans remplacement : détachées et datées, selon
        // la règle partagée du retrait.
        for (const row of toRemove) {
            actions.push(global.ListePeRetrait.buildQuitSchoolAction(row.id));
        }

        return actions;
    }

    global.ListePeAffectation = {
        buildPersonIndex,
        searchPersons,
        buildAffectationActions,
        ecoleRowIdOf
    };

})(typeof window !== 'undefined' ? window : this);
