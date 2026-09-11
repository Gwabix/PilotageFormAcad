'use strict';

/*
 * Module partagé — retrait d'un enseignant de son école, et libération.
 *
 * Source unique de ces deux écritures, utilisée par « TDB-Ecoles » et
 * « Formulaire ». Le partage n'est pas ici une commodité : plusieurs
 * mécanismes dépendent du jeu exact de cellules touchées.
 *
 *  - La purge RGPD ne retient un enseignant que s'il a une ligne AVEC école et
 *    SANS date de retrait. Une ligne détachée sans date de retrait échappe
 *    donc définitivement à la purge : un widget qui oublierait `Retrait`
 *    créerait un trou de conservation silencieux.
 *  - Le délai de grâce de la règle des lignes fantômes se compte depuis
 *    `Retrait` (voir ./liste-pe-merge.js). Sans cette date, une ligne détachée
 *    n'est jamais nettoyée.
 *  - `UAI` à 0 est ce qui rend la ligne visible de toutes les circonscriptions,
 *    les règles d'accès laissant voir les enseignants sans affectation.
 */

(function (global) {
    // Minuit UTC du jour, en secondes depuis l'epoch : format des colonnes
    // Date de Grist.
    function todayDateEpochSeconds() {
        const now = new Date();
        return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 1000;
    }

    function text(value) {
        if (value === null || value === undefined) return '';
        return String(value);
    }

    /**
     * Retrait d'une ligne Liste_PE de son école.
     *
     * L'école, la fonction et les niveaux sont vidés — ils décrivaient un
     * exercice qui n'a plus lieu — et la date du jour marque le retrait.
     *
     * @param {number} rowId ligne Liste_PE
     * @returns {Array} action Grist
     */
    function buildQuitSchoolAction(rowId) {
        return ['UpdateRecord', 'Liste_PE', rowId, {
            UAI: 0,
            Fonction: '',
            Niveau_x_: ['L'],
            Retrait: todayDateEpochSeconds()
        }];
    }

    /**
     * Libération : seconde ligne sans école, l'affectation en cours étant
     * conservée. Elle rend l'enseignant visible des autres circonscriptions,
     * dont l'une peut la reprendre.
     *
     * L'identité, l'année et la quotité sont recopiées depuis la ligne source,
     * faute de quoi la ligne reprise serait inexploitable.
     *
     * @param {object} row ligne Liste_PE source
     * @returns {Array} action Grist
     */
    function buildLiberationAction(row) {
        return ['AddRecord', 'Liste_PE', null, {
            ID_PE: text(row.ID_PE),
            Civilite: text(row.Civilite),
            Nom: text(row.Nom),
            Prenom: text(row.Prenom),
            Mail: text(row.Mail),
            Annee_scolaire: row.Annee_scolaire,
            Quotite_de_service: text(row.Quotite_de_service),
            UAI: 0,
            Fonction: '',
            Niveau_x_: ['L'],
            Retrait: todayDateEpochSeconds()
        }];
    }

    global.ListePeRetrait = {
        todayDateEpochSeconds,
        buildQuitSchoolAction,
        buildLiberationAction
    };

})(typeof window !== 'undefined' ? window : this);
