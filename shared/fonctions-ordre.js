'use strict';

/*
 * Module partagé — ordre d'affichage des fonctions des enseignants.
 *
 * Ordre métier, et non alphabétique : dans la liste d'une école, on cherche
 * d'abord la direction, puis les adjoints, puis les postes particuliers. Les
 * widgets doivent présenter la même séquence, une liste ordonnée
 * différemment d'un écran à l'autre étant une gêne à la lecture.
 *
 * Une fonction inconnue passe après toutes les autres, par ordre
 * alphabétique : les valeurs de la colonne peuvent évoluer côté Grist sans
 * que ce fichier soit mis à jour, et rien ne doit alors disparaître ni se
 * ranger au hasard.
 *
 * Dépendance : ./search-text.js (normalisation).
 */

(function (global) {
    const ORDRE = [
        'Directeur(trice)',
        'Adjoint(e)',
        'PES',
        'Ulis',
        'Poste partagé',
        'TR',
        'ASH',
        'UPE2A'
    ];

    /*
     * Clé de comparaison : minuscules, sans accent ni ponctuation. Les choix
     * réels de la colonne portent des parenthèses inclusives, « Adjoint(e) »
     * ou « Directeur(trice) », dont la graphie peut varier. On compare donc
     * sur la seule suite de lettres et de chiffres.
     */
    function key(value) {
        return global.SearchText.normalize(value).replace(/[^a-z0-9]/g, '');
    }

    const ORDRE_KEYS = ORDRE.map(key);

    /**
     * Rang d'une fonction. Plus petit = plus haut dans la liste.
     * Une fonction vide ou inconnue reçoit le rang le plus élevé.
     *
     * @param {*} fonction
     * @returns {number}
     */
    function rank(fonction) {
        const k = key(fonction);
        if (!k) return ORDRE_KEYS.length;

        const exact = ORDRE_KEYS.indexOf(k);
        if (exact !== -1) return exact;

        /*
         * Correspondance par préfixe, dans les deux sens : « adjointe » doit
         * rejoindre « adjoint », et inversement. La plus longue clé
         * reconnue gagne, pour qu'un préfixe court n'attrape pas une valeur
         * qui appartient à une autre fonction.
         */
        let best = -1;
        let bestLength = 0;
        for (let i = 0; i < ORDRE_KEYS.length; i++) {
            const candidate = ORDRE_KEYS[i];
            if (k.indexOf(candidate) !== 0 && candidate.indexOf(k) !== 0) continue;
            if (candidate.length > bestLength) { best = i; bestLength = candidate.length; }
        }

        return best === -1 ? ORDRE_KEYS.length : best;
    }

    /**
     * Comparateur de fonctions, utilisable dans un `sort`. À rang égal, les
     * libellés sont comparés entre eux, ce qui range les fonctions inconnues
     * par ordre alphabétique au lieu de les laisser dans l'ordre de la table.
     *
     * @returns {number}
     */
    function compare(fonctionA, fonctionB) {
        const diff = rank(fonctionA) - rank(fonctionB);
        if (diff !== 0) return diff;
        return String(fonctionA || '').localeCompare(String(fonctionB || ''), 'fr');
    }

    global.FonctionsOrdre = { rank, compare, ORDRE };

})(typeof window !== 'undefined' ? window : this);
