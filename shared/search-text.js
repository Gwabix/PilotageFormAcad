'use strict';

/*
 * Module partagé — normalisation des textes pour la recherche.
 *
 * Une recherche doit ignorer la casse ET les accents : « Bedarieux »,
 * « bédarieux » et « BÉDARIEUX » désignent la même commune. Les noms
 * d'établissements et de personnes mêlent les deux graphies selon la source
 * (base RH, saisie manuelle, import académique).
 *
 * Source unique de cette règle pour tous les widgets : une recherche qui se
 * comporte différemment d'un widget à l'autre est un défaut en soi.
 *
 * La décomposition NFD sépare la lettre de son signe diacritique, que la plage
 * ̀-ͯ supprime ensuite. Les caractères de contrôle sont retirés, ce
 * qui protège les comparaisons contre des données importées mal formées.
 */

(function (global) {
    const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');
    const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

    /**
     * Forme comparable d'un texte : minuscules, sans accent ni caractère de
     * contrôle, sans espaces de bord.
     * @param {*} value
     * @returns {string}
     */
    function normalize(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(CONTROL_CHARS, '')
            .toLowerCase()
            .normalize('NFD')
            .replace(DIACRITICS, '')
            .trim();
    }

    /**
     * `needle` apparaît-il dans `haystack`, accents et casse ignorés ?
     * Une aiguille vide ne correspond à rien, pour ne pas tout retourner.
     * @returns {boolean}
     */
    function includes(haystack, needle) {
        const query = normalize(needle);
        if (!query) return false;
        return normalize(haystack).indexOf(query) !== -1;
    }

    /**
     * Prédicat de correspondance pour une requête donnée.
     *
     * À préférer à `includes` dans une boucle : la requête n'est normalisée
     * qu'une fois, au lieu d'une fois par valeur testée. Certaines recherches
     * balayent plusieurs dizaines de milliers de lignes à chaque frappe.
     *
     * @param {*} needle requête, brute
     * @returns {(value: *) => boolean} faux partout si la requête est vide
     */
    function matcher(needle) {
        const query = normalize(needle);
        if (!query) return () => false;
        return value => normalize(value).indexOf(query) !== -1;
    }

    global.SearchText = { normalize, includes, matcher };

})(typeof window !== 'undefined' ? window : this);
