'use strict';

/*
 * Module partagé — Surveillance / purge RGPD des enseignants retirés.
 *
 * Source unique de la logique de suppression (action destructive) : utilisé par
 * les widgets « TDB-Ecoles » et « Pilotage académique ». Toute évolution doit
 * rester dans ce fichier, jamais dupliquée dans les widgets.
 *
 * Règle métier :
 *  - Un enseignant (clé texte Liste_PE.ID_PE) encore rattaché à AU MOINS UNE
 *    école sans date de retrait est en poste : il n'est jamais purgeable.
 *    Cela couvre la réapparition une année ultérieure comme les affectations
 *    partagées (retiré de l'école A mais toujours en poste sur l'école B).
 *  - Sinon, on part de sa date de retrait la plus récente : il est purgeable
 *    si elle remonte à plus de RETENTION_DAYS jours.
 *  - Le regroupement se fait sur l'ID_PE, et sur lui seul. Une ligne SANS
 *    ID_PE est donc jugée seule, sur sa propre date de retrait, et elle seule
 *    est supprimée : sans identifiant, rien ne permet de lui rattacher les
 *    autres lignes de la personne. Cas du contractuel de passage, parti avant
 *    d'avoir reçu un identifiant. Ces lignes ont normalement vocation à être
 *    rapprochées d'une fiche existante par le panneau d'incohérences
 *    (./liste-pe-coherence.js, rapprochement par le mail), qui leur attribue
 *    un ID_PE ; la purge ne prend que celles que personne n'a réclamées en
 *    cinq ans.
 *  - Le contrôle n'est exécuté que si l'utilisateur voit STRICTEMENT PLUS de
 *    MIN_DEPARTEMENTS départements dans Liste_PE. En deçà, les règles d'accès
 *    Grist peuvent masquer une mutation inter-départementale et faire passer
 *    une mutation pour un retrait (académie de Montpellier = 5 départements).
 *  - Purge : suppression des lignes Formations puis Liste_PE de l'enseignant,
 *    dans une seule transaction (Formations d'abord).
 */

(function (global) {
    const RETENTION_DAYS = 1826; // 5 ans
    const MIN_DEPARTEMENTS = 4;
    const SECONDS_PER_DAY = 86400;
    const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

    function sanitizeText(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(CONTROL_CHARS, '').trim();
    }

    function todayDateEpochSeconds() {
        const now = new Date();
        return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 1000;
    }

    // Valeur d'une colonne Date de Grist -> secondes epoch, ou null si vide.
    function parseDateEpochSeconds(rawValue) {
        if (rawValue === null || rawValue === undefined || rawValue === '') return null;
        const num = typeof rawValue === 'number' ? rawValue : Number(rawValue);
        return Number.isFinite(num) ? num : null;
    }

    function epochSecondsToDayIndex(seconds) {
        return Math.floor(seconds / SECONDS_PER_DAY);
    }

    // Reference / ReferenceList Grist -> premier rowId numérique, ou 0.
    function refRowId(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === 'number' && Number.isFinite(item)) return item;
            }
            return 0;
        }
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
    }

    function teacherIdentity(row) {
        return [sanitizeText(row.Civilite), sanitizeText(row.Prenom), sanitizeText(row.Nom)]
            .filter(Boolean)
            .join(' ')
            .trim();
    }

    function formatEpochDate(seconds) {
        if (seconds === null || seconds === undefined) return '—';
        return new Date(seconds * 1000).toLocaleDateString('fr-FR', {
            day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
        });
    }

    function indexByReferencedRow(records, field) {
        const map = new Map();
        for (const record of records) {
            const rowId = refRowId(record[field]);
            if (rowId <= 0) continue;
            if (!map.has(rowId)) map.set(rowId, []);
            map.get(rowId).push(record);
        }
        return map;
    }

    /**
     * @param {{ listePe: object[], formations?: object[] }} data
     *        Enregistrements normalisés { id, <colonnes Grist> }.
     * @returns {{ sufficientScope: boolean, visibleDepartementCount: number, candidates: object[] }}
     *   candidate = { key, identity, lastRetraitEpoch, daysSinceRetrait,
     *                 listePeRowIds, formationRowIds, totalRows }
     */
    function computeCandidates(data) {
        const listePe = Array.isArray(data && data.listePe) ? data.listePe : [];
        const formations = Array.isArray(data && data.formations) ? data.formations : [];

        const departements = new Set();
        for (const row of listePe) {
            const departement = sanitizeText(row.Departement);
            if (departement) departements.add(departement);
        }
        const visibleDepartementCount = departements.size;
        const sufficientScope = visibleDepartementCount > MIN_DEPARTEMENTS;

        if (!sufficientScope) {
            return { sufficientScope, visibleDepartementCount, candidates: [] };
        }

        /*
         * Le regroupement se fait sur l'ID_PE, et sur lui seul : c'est la
         * seule clé qui désigne une personne à coup sûr. `sanitizeText` le
         * débarrasse au passage des blancs parasites, sans quoi deux lignes
         * réduites à des espaces formeraient une seule « personne » et
         * seraient purgées ensemble. Tous les widgets ne font pas précéder la
         * purge d'un nettoyage des blancs : la défense est donc ici.
         *
         * Les lignes sans ID_PE sont traitées à part, une par une, plus bas.
         */
        const byTeacher = new Map();
        const sansIdPe = [];
        for (const row of listePe) {
            const key = sanitizeText(row.ID_PE);
            if (!key) { sansIdPe.push(row); continue; }
            if (!byTeacher.has(key)) byTeacher.set(key, []);
            byTeacher.get(key).push(row);
        }

        const formationsByListePeRow = indexByReferencedRow(formations, 'ID_PE');

        const todayDayIndex = epochSecondsToDayIndex(todayDateEpochSeconds());
        const candidates = [];

        const formationIdsOf = (listePeRowIds) => {
            const ids = [];
            for (const rowId of listePeRowIds) {
                for (const f of (formationsByListePeRow.get(rowId) || [])) ids.push(f.id);
            }
            return ids;
        };

        for (const [key, rows] of byTeacher) {
            // Un enseignant encore rattaché à AU MOINS UNE école sans date de
            // retrait est toujours en poste : aucun de ses retraits ne compte.
            // (Couvre à la fois la réapparition une année ultérieure et les
            // affectations partagées : retiré de l'école A, toujours sur B.)
            let stillAssigned = false;
            for (const row of rows) {
                if (refRowId(row.UAI) > 0 && parseDateEpochSeconds(row.Retrait) === null) {
                    stillAssigned = true;
                    break;
                }
            }
            if (stillAssigned) continue;

            // Plus aucune affectation : on part du retrait le plus récent.
            let latestRetraitEpoch = null;
            for (const row of rows) {
                const retraitEpoch = parseDateEpochSeconds(row.Retrait);
                if (retraitEpoch === null) continue;
                if (latestRetraitEpoch === null || retraitEpoch > latestRetraitEpoch) {
                    latestRetraitEpoch = retraitEpoch;
                }
            }

            if (latestRetraitEpoch === null) continue;

            const daysSinceRetrait = todayDayIndex - epochSecondsToDayIndex(latestRetraitEpoch);
            if (daysSinceRetrait < RETENTION_DAYS) continue;

            const listePeRowIds = rows.map(r => r.id);
            const formationRowIds = formationIdsOf(listePeRowIds);

            candidates.push({
                key,
                identity: teacherIdentity(rows[0]) || ('ID_PE ' + key),
                sansIdPe: false,
                lastRetraitEpoch: latestRetraitEpoch,
                daysSinceRetrait,
                listePeRowIds,
                formationRowIds,
                totalRows: listePeRowIds.length + formationRowIds.length
            });
        }

        /*
         * Lignes sans ID_PE — un contractuel de passage peut n'avoir jamais
         * reçu d'identifiant. Faute de clé sûre, aucun regroupement : chaque
         * ligne est jugée sur sa seule date de retrait, et elle seule est
         * supprimée. On ne touche donc jamais les autres lignes de la
         * personne, qu'on serait bien incapable d'identifier.
         *
         * Ces lignes ont normalement vocation à être rapprochées d'une fiche
         * existante par le panneau d'incohérences (./liste-pe-coherence.js,
         * rapprochement par le mail), qui leur attribue un ID_PE. La purge
         * n'intervient que pour celles que personne n'a réclamées en cinq ans.
         */
        for (const row of sansIdPe) {
            const retraitEpoch = parseDateEpochSeconds(row.Retrait);
            if (retraitEpoch === null) continue;

            const daysSinceRetrait = todayDayIndex - epochSecondsToDayIndex(retraitEpoch);
            if (daysSinceRetrait < RETENTION_DAYS) continue;

            const formationRowIds = formationIdsOf([row.id]);

            candidates.push({
                key: 'ROW:' + row.id,
                identity: teacherIdentity(row) || sanitizeText(row.Mail) || 'Identité inconnue',
                // La confirmation de purge doit pouvoir dire que cette ligne
                // est visée seule, faute d'identifiant.
                sansIdPe: true,
                lastRetraitEpoch: retraitEpoch,
                daysSinceRetrait,
                listePeRowIds: [row.id],
                formationRowIds,
                totalRows: 1 + formationRowIds.length
            });
        }

        candidates.sort((a, b) => b.daysSinceRetrait - a.daysSinceRetrait);
        return { sufficientScope, visibleDepartementCount, candidates };
    }

    /**
     * Construit les actions Grist de purge, dans l'ordre imposé :
     * Formations -> Liste_PE.
     * @param {object[]} candidates
     * @returns {Array[]} liste d'actions pour grist.docApi.applyUserActions
     */
    function buildPurgeActions(candidates) {
        const formationIds = [];
        const listePeIds = [];

        for (const candidate of (candidates || [])) {
            for (const id of candidate.formationRowIds) formationIds.push(id);
            for (const id of candidate.listePeRowIds) listePeIds.push(id);
        }

        const actions = [];
        if (formationIds.length) actions.push(['BulkRemoveRecord', 'Formations', formationIds]);
        if (listePeIds.length) actions.push(['BulkRemoveRecord', 'Liste_PE', listePeIds]);
        return actions;
    }

    global.RgpdPurge = {
        computeCandidates,
        buildPurgeActions,
        formatEpochDate
    };
})(typeof window !== 'undefined' ? window : this);
