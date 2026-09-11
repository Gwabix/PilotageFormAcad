'use strict';

/*
 * Module partagé — établissements traités par les widgets.
 *
 * La table Ecoles conserve des établissements gardés en base pour une
 * évolution future, mais qui ne doivent jamais être traités : leur colonne
 * `OK` est à faux. Aucun widget ne doit les afficher, les proposer à la
 * recherche, les compter, ni y rattacher un enseignant.
 *
 * Source unique de cette règle : toute évolution reste dans ce fichier, jamais
 * dupliquée dans les widgets.
 *
 * La colonne peut être hors du périmètre de lecture de l'utilisateur, ou
 * absente d'un document plus ancien. Aucun filtrage n'est alors appliqué :
 * mieux vaut tout montrer que tout masquer.
 */

(function (global) {
    const OK_COLUMN_NAMES = ['OK', '$OK'];

    function okColumn(ecolesTable) {
        for (const name of OK_COLUMN_NAMES) {
            const values = ecolesTable ? ecolesTable[name] : null;
            if (Array.isArray(values)) return values;
        }
        return null;
    }

    /**
     * Row IDs des établissements à traiter.
     *
     * Retourne toujours un Set : les appelants filtrent sans avoir à
     * distinguer le cas « colonne absente ».
     *
     * @param {object} ecolesTable résultat de grist.docApi.fetchTable('Ecoles')
     * @returns {Set<number>}
     */
    function activeRowIds(ecolesTable) {
        const ids = Array.isArray(ecolesTable && ecolesTable.id) ? ecolesTable.id : [];
        const kept = new Set();

        const values = okColumn(ecolesTable);
        if (!values) {
            console.warn('[Ecoles] Colonne OK absente ou masquée : aucun filtrage des établissements.');
            for (const id of ids) kept.add(id);
            return kept;
        }

        for (let i = 0; i < ids.length; i++) {
            if (values[i]) kept.add(ids[i]);
        }

        // Tout exclure n'est jamais intentionnel : sans ce repère, un widget
        // vide passerait pour une panne de chargement.
        if (ids.length > 0 && kept.size === 0) {
            console.warn('[Ecoles] Aucun établissement retenu sur ' + ids.length
                + ' : vérifiez la colonne OK dans la table Ecoles.');
        }

        return kept;
    }

    global.EcolesActives = { activeRowIds };

})(typeof window !== 'undefined' ? window : this);
