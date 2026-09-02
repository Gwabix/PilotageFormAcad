'use strict';

/*
 * Module partagé — fusion automatique des lignes Liste_PE en double.
 *
 * Deux remises en ordre, appliquées en une seule transaction :
 *
 *  1. LIGNES FANTÔMES — pour un même (ID_PE, année), une ligne sans école
 *     alors qu'une autre ligne de la même personne/année est affectée. Cas
 *     typique : la circonscription A crée une fiche avant que B ne libère
 *     l'enseignant. La ligne détachée est supprimée, ses fiches Formations
 *     repointées vers la ligne conservée.
 *
 *  2. DOUBLONS — même enseignant, même année scolaire ET même école
 *     (équivalent de `IDunique`), fusionnés selon les règles ci-dessous.
 *
 * Les affectations partagées — même enseignant, même année, écoles
 * DIFFÉRENTES — ne sont JAMAIS ni supprimées ni fusionnées.
 *
 * Cas particulier : deux lignes détachées (UAI vide) du même enseignant sur
 * la même année — typiquement un enseignant retiré de ses deux écoles — SONT
 * des doublons : plus aucune école ne les distingue.
 *
 * Une ligne sans `ID_PE` n'est jamais fusionnée (personne non identifiable).
 *
 * Règles de fusion :
 *  - survivant  : la ligne à la quotité de service la plus élevée
 *                 (à égalité, le plus petit rowId — déterministe)
 *  - quotité     : la plus élevée
 *  - listes de choix (Niveau_x_, D_dir, TP, D_synd_, Autre) : union
 *  - Preciser    : valeurs distinctes non vides, jointes par " / "
 *  - Retrait     : la date la plus récente
 *  - autres textes (Civilite, Nom, Prenom, Mail, Fonction) : 1re valeur non vide
 *
 * Les lignes Formations qui référencent une ligne supprimée sont repointées
 * vers le survivant AVANT la suppression.
 */

(function (global) {
    const CHOICE_LIST_FIELDS = ['Niveau_x_', 'D_dir', 'TP', 'D_synd_', 'Autre'];
    const TEXT_FIELDS = ['Civilite', 'Nom', 'Prenom', 'Mail', 'Fonction'];
    const NUMBER_IN_TEXT = /(\d+(?:[.,]\d+)?)/;

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

    function parseQuotite(value) {
        if (value === null || value === undefined) return -1;
        const match = String(value).match(NUMBER_IN_TEXT);
        return match ? parseFloat(match[1].replace(',', '.')) : -1;
    }

    function parseDateEpochSeconds(rawValue) {
        if (rawValue === null || rawValue === undefined || rawValue === '') return null;
        const num = typeof rawValue === 'number' ? rawValue : Number(rawValue);
        return Number.isFinite(num) ? num : null;
    }

    function choiceListValues(raw) {
        if (Array.isArray(raw)) {
            return raw.filter(v => v !== 'L' && v !== null && v !== undefined && v !== '');
        }
        if (typeof raw === 'string' && raw.trim()) {
            return raw.split(',').map(s => s.trim()).filter(Boolean);
        }
        return [];
    }

    function text(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
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
     * Clé de doublon : équivalente à IDunique (Annee_scolaire + ID_PE + UAI),
     * mais calculée sur le rowId de l'école plutôt que sur la formule Grist —
     * elle ne dépend donc pas d'une colonne calculée éventuellement en erreur.
     *
     * Une école vide (0) est une valeur de clé comme une autre : deux lignes
     * détachées du même enseignant sur la même année (retiré de ses deux
     * écoles) sont bien des doublons, plus rien ne les distingue.
     *
     * Retourne null si l'enseignant n'est pas identifiable (ID_PE vide) :
     * sans ID_PE, deux personnes différentes se confondraient.
     */
    function duplicateKey(row) {
        const idPe = text(row.ID_PE);
        if (!idPe) return null;
        return text(row.Annee_scolaire) + ' | ' + idPe + ' | ' + refRowId(row.UAI);
    }

    /**
     * Groupes de lignes Liste_PE en double (même enseignant, même année,
     * même école — école éventuellement vide pour les lignes détachées).
     * @param {object[]} listePe enregistrements { id, ID_PE, Annee_scolaire, UAI, ... }
     * @returns {{ key: string, rows: object[] }[]}
     */
    function findDuplicateGroups(listePe) {
        const byKey = new Map();
        for (const row of listePe) {
            const key = duplicateKey(row);
            if (!key) continue;
            let bucket = byKey.get(key);
            if (!bucket) { bucket = []; byKey.set(key, bucket); }
            bucket.push(row);
        }

        const groups = [];
        for (const [key, rows] of byKey) {
            if (rows.length > 1) groups.push({ key, rows });
        }
        return groups;
    }

    /** Valeurs fusionnées d'un groupe + ligne conservée et lignes à supprimer. */
    function mergeGroup(rows) {
        const ordered = rows.slice().sort((a, b) => {
            const diff = parseQuotite(b.Quotite_de_service) - parseQuotite(a.Quotite_de_service);
            return diff !== 0 ? diff : a.id - b.id;
        });
        const survivor = ordered[0];
        const losers = ordered.slice(1);
        const merged = {};

        merged.Quotite_de_service = survivor.Quotite_de_service || '';

        for (const field of CHOICE_LIST_FIELDS) {
            const seen = new Set();
            const union = [];
            for (const row of ordered) {
                for (const value of choiceListValues(row[field])) {
                    if (!seen.has(value)) { seen.add(value); union.push(value); }
                }
            }
            merged[field] = ['L', ...union];
        }

        const precisions = [];
        const seenPrecision = new Set();
        for (const row of ordered) {
            const value = text(row.Preciser);
            if (value && !seenPrecision.has(value)) {
                seenPrecision.add(value);
                precisions.push(value);
            }
        }
        merged.Preciser = precisions.join(' / ');

        let retrait = null;
        for (const row of ordered) {
            const epoch = parseDateEpochSeconds(row.Retrait);
            if (epoch !== null && (retrait === null || epoch > retrait)) retrait = epoch;
        }
        merged.Retrait = retrait;

        for (const field of TEXT_FIELDS) {
            let value = '';
            for (const row of ordered) {
                if (text(row[field])) { value = row[field]; break; }
            }
            merged[field] = value;
        }

        return { survivor, losers, merged };
    }

    function sameValues(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    // Le survivant a-t-il réellement besoin d'être réécrit ?
    function survivorNeedsUpdate(survivor, merged) {
        for (const field of CHOICE_LIST_FIELDS) {
            const before = choiceListValues(survivor[field]);
            const after = choiceListValues(merged[field]);
            if (!sameValues(before, after)) return true;
        }
        if (text(survivor.Preciser) !== text(merged.Preciser)) return true;
        if (parseDateEpochSeconds(survivor.Retrait) !== merged.Retrait) return true;
        if (text(survivor.Quotite_de_service) !== text(merged.Quotite_de_service)) return true;
        for (const field of TEXT_FIELDS) {
            if (text(survivor[field]) !== text(merged[field])) return true;
        }
        return false;
    }

    /**
     * Lignes « fantômes » : pour un même (ID_PE, année), une ligne SANS école
     * alors qu'au moins une autre ligne de la même personne et de la même
     * année EST affectée. Cas typique : la circonscription A crée une fiche
     * avant que B ne libère l'enseignant — la ligne détachée de B n'a plus
     * lieu d'être.
     *
     * N'affecte jamais deux lignes affectées (affectation partagée), ni une
     * personne détachée partout (traitée par la fusion des doublons).
     *
     * @returns {{ row: object, target: object }[]} ligne à supprimer, et ligne
     *          affectée vers laquelle repointer ses fiches Formations.
     */
    function findOrphanRows(listePe) {
        const byPersonYear = new Map();
        for (const row of listePe) {
            const idPe = text(row.ID_PE);
            if (!idPe) continue;
            const key = idPe + ' | ' + text(row.Annee_scolaire);
            let bucket = byPersonYear.get(key);
            if (!bucket) { bucket = []; byPersonYear.set(key, bucket); }
            bucket.push(row);
        }

        const orphans = [];
        for (const rows of byPersonYear.values()) {
            const affected = rows.filter(r => refRowId(r.UAI) > 0);
            const detached = rows.filter(r => refRowId(r.UAI) <= 0);
            if (!affected.length || !detached.length) continue;

            const target = affected.slice().sort((a, b) => {
                const diff = parseQuotite(b.Quotite_de_service) - parseQuotite(a.Quotite_de_service);
                return diff !== 0 ? diff : a.id - b.id;
            })[0];

            detached.forEach(row => orphans.push({ row, target }));
        }
        return orphans;
    }

    /**
     * Actions Grist de remise en ordre de Liste_PE, en une seule transaction :
     *   1. suppression des lignes fantômes (leurs Formations sont repointées
     *      vers la ligne affectée conservée) ;
     *   2. fusion des doublons restants.
     * Ordre des actions : repointage -> mises à jour -> suppressions.
     *
     * @param {object[]} listePe enregistrements Liste_PE
     * @param {object[]} formations enregistrements Formations
     */
    function buildCleanupActions(listePe, formations) {
        const formationsByRow = indexByReferencedRow(formations || [], 'ID_PE');

        const formationIds = [];
        const formationTargets = [];
        const survivorIds = [];
        const survivorValues = [];
        const removeIds = [];
        const summary = { fantomes: [], fusions: [] };

        // 1. Lignes fantômes
        const orphans = findOrphanRows(listePe);
        const orphanIds = new Set();

        for (const { row, target } of orphans) {
            const linked = formationsByRow.get(row.id) || [];
            for (const record of linked) {
                formationIds.push(record.id);
                formationTargets.push(target.id);
            }
            orphanIds.add(row.id);
            removeIds.push(row.id);
            summary.fantomes.push({
                identity: [text(row.Civilite), text(row.Prenom), text(row.Nom)]
                    .filter(Boolean).join(' '),
                anneeScolaire: text(row.Annee_scolaire),
                removedId: row.id,
                keptId: target.id,
                movedFormations: linked.length
            });
        }

        // 2. Fusion des doublons parmi les lignes restantes
        const remaining = orphanIds.size
            ? listePe.filter(row => !orphanIds.has(row.id))
            : listePe;

        for (const group of findDuplicateGroups(remaining)) {
            const { survivor, losers, merged } = mergeGroup(group.rows);
            let movedFormations = 0;

            for (const loser of losers) {
                for (const record of (formationsByRow.get(loser.id) || [])) {
                    formationIds.push(record.id);
                    formationTargets.push(survivor.id);
                    movedFormations++;
                }
                removeIds.push(loser.id);
            }

            if (survivorNeedsUpdate(survivor, merged)) {
                survivorIds.push(survivor.id);
                survivorValues.push(merged);
            }

            summary.fusions.push({
                key: group.key,
                identity: [text(survivor.Civilite), text(survivor.Prenom), text(survivor.Nom)]
                    .filter(Boolean).join(' '),
                anneeScolaire: text(survivor.Annee_scolaire),
                survivorId: survivor.id,
                removedIds: losers.map(r => r.id),
                movedFormations
            });
        }

        const actions = [];
        if (formationIds.length) {
            actions.push(['BulkUpdateRecord', 'Formations', formationIds, { ID_PE: formationTargets }]);
        }
        for (let i = 0; i < survivorIds.length; i++) {
            actions.push(['UpdateRecord', 'Liste_PE', survivorIds[i], survivorValues[i]]);
        }
        if (removeIds.length) {
            actions.push(['BulkRemoveRecord', 'Liste_PE', removeIds]);
        }

        return { actions, summary, removedCount: removeIds.length };
    }

    global.ListePeMerge = {
        findDuplicateGroups,
        findOrphanRows,
        mergeGroup,
        buildCleanupActions
    };
})(typeof window !== 'undefined' ? window : this);
