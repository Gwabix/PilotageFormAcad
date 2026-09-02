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
 *  - Le contrôle n'est exécuté que si l'utilisateur voit STRICTEMENT PLUS de
 *    MIN_DEPARTEMENTS départements dans Liste_PE. En deçà, les règles d'accès
 *    Grist peuvent masquer une mutation inter-départementale et faire passer
 *    une mutation pour un retrait (académie de Montpellier = 5 départements).
 *  - Purge : suppression des lignes Formations, puis Lien_intercircos, puis
 *    Liste_PE de l'enseignant, dans une seule transaction (Formations d'abord).
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
     * @param {{ listePe: object[], formations?: object[], liens?: object[] }} data
     *        Enregistrements normalisés { id, <colonnes Grist> }.
     * @returns {{ sufficientScope: boolean, visibleDepartementCount: number, candidates: object[] }}
     *   candidate = { key, identity, lastRetraitEpoch, daysSinceRetrait,
     *                 listePeRowIds, formationRowIds, lienRowIds, totalRows }
     */
    function computeCandidates(data) {
        const listePe = Array.isArray(data && data.listePe) ? data.listePe : [];
        const formations = Array.isArray(data && data.formations) ? data.formations : [];
        const liens = Array.isArray(data && data.liens) ? data.liens : [];

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

        const byTeacher = new Map();
        for (const row of listePe) {
            const id = row.ID_PE;
            if (id === null || id === undefined || id === '') continue;
            const key = String(id);
            if (!byTeacher.has(key)) byTeacher.set(key, []);
            byTeacher.get(key).push(row);
        }

        const formationsByListePeRow = indexByReferencedRow(formations, 'ID_PE');
        const liensByListePeRow = indexByReferencedRow(liens, 'ID_PE');

        const todayDayIndex = epochSecondsToDayIndex(todayDateEpochSeconds());
        const candidates = [];

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
            const formationRowIds = [];
            const lienRowIds = [];
            for (const rowId of listePeRowIds) {
                for (const f of (formationsByListePeRow.get(rowId) || [])) formationRowIds.push(f.id);
                for (const l of (liensByListePeRow.get(rowId) || [])) lienRowIds.push(l.id);
            }

            candidates.push({
                key,
                identity: teacherIdentity(rows[0]) || ('ID_PE ' + key),
                lastRetraitEpoch: latestRetraitEpoch,
                daysSinceRetrait,
                listePeRowIds,
                formationRowIds,
                lienRowIds,
                totalRows: listePeRowIds.length + formationRowIds.length + lienRowIds.length
            });
        }

        candidates.sort((a, b) => b.daysSinceRetrait - a.daysSinceRetrait);
        return { sufficientScope, visibleDepartementCount, candidates };
    }

    /**
     * Diagnostic : explique pourquoi le bandeau s'affiche ou non.
     * @param {{ listePe: object[], formations?: object[], liens?: object[] }} data
     */
    function diagnose(data) {
        const listePe = Array.isArray(data && data.listePe) ? data.listePe : [];
        const formations = Array.isArray(data && data.formations) ? data.formations : [];
        const liens = Array.isArray(data && data.liens) ? data.liens : [];
        const result = computeCandidates(data);

        const todayDayIndex = epochSecondsToDayIndex(todayDateEpochSeconds());
        const departements = new Set();
        const retraitAgesDays = [];
        let rowsWithIdPe = 0;

        for (const row of listePe) {
            if (row.ID_PE !== null && row.ID_PE !== undefined && row.ID_PE !== '') rowsWithIdPe++;
            const departement = sanitizeText(row.Departement);
            if (departement) departements.add(departement);
            const epoch = parseDateEpochSeconds(row.Retrait);
            if (epoch !== null) {
                retraitAgesDays.push(todayDayIndex - epochSecondsToDayIndex(epoch));
            }
        }
        retraitAgesDays.sort((a, b) => b - a);

        return {
            retentionDays: RETENTION_DAYS,
            minDepartements: MIN_DEPARTEMENTS,
            listePeCount: listePe.length,
            formationsCount: formations.length,
            liensCount: liens.length,
            rowsWithIdPe,
            departementsVisibles: Array.from(departements).sort(),
            visibleDepartementCount: result.visibleDepartementCount,
            sufficientScope: result.sufficientScope,
            rowsWithRetrait: retraitAgesDays.length,
            retraitAgesDays: retraitAgesDays.slice(0, 20),
            candidateCount: result.candidates.length,
            candidates: result.candidates.map(c => ({ identity: c.identity, daysSinceRetrait: c.daysSinceRetrait }))
        };
    }

    /**
     * Construit les actions Grist de purge, dans l'ordre imposé :
     * Formations -> Lien_intercircos -> Liste_PE.
     * @param {object[]} candidates
     * @returns {Array[]} liste d'actions pour grist.docApi.applyUserActions
     */
    function buildPurgeActions(candidates) {
        const formationIds = [];
        const lienIds = [];
        const listePeIds = [];

        for (const candidate of (candidates || [])) {
            for (const id of candidate.formationRowIds) formationIds.push(id);
            for (const id of candidate.lienRowIds) lienIds.push(id);
            for (const id of candidate.listePeRowIds) listePeIds.push(id);
        }

        const actions = [];
        if (formationIds.length) actions.push(['BulkRemoveRecord', 'Formations', formationIds]);
        if (lienIds.length) actions.push(['BulkRemoveRecord', 'Lien_intercircos', lienIds]);
        if (listePeIds.length) actions.push(['BulkRemoveRecord', 'Liste_PE', listePeIds]);
        return actions;
    }

    global.RgpdPurge = {
        computeCandidates,
        buildPurgeActions,
        diagnose,
        formatEpochDate
    };
})(typeof window !== 'undefined' ? window : this);
