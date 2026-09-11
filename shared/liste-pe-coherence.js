'use strict';

/*
 * Module partagé — détection des lignes Liste_PE incohérentes.
 *
 * À ne pas confondre avec ../shared/liste-pe-merge.js, qui fusionne des lignes
 * dont on est SÛR qu'elles désignent la même affectation. Ici, on ne fait que
 * signaler des lignes probablement contradictoires : la décision revient à
 * l'utilisateur, aucune écriture n'est automatique.
 *
 * DEUX FORMES D'INCOHÉRENCE
 *
 *  1. MÊME MAIL, ID_PE DIFFÉRENTS. Une même adresse ne peut pas désigner deux
 *     personnes. Un ID_PE vide compte comme une valeur distincte d'un ID_PE
 *     renseigné : c'est le cas des fiches créées depuis le widget, où la
 *     colonne n'est plus saisie.
 *
 *  2. MÊME ID_PE, IDENTITÉ DIFFÉRENTE. Civilité, nom ou prénom divergent
 *     alors que la clé désigne la même personne.
 *
 * RAPPROCHEMENT APPROCHÉ DES MAILS — dissymétrique, et c'est essentiel.
 *
 *  - Deux lignes portant chacune un ID_PE renseigné et DIFFÉRENT ne sont
 *    rapprochées que si leurs mails sont strictement identiques. Des adresses
 *    seulement ressemblantes désignent alors deux personnes différentes :
 *    les identifiants, eux, ne se ressemblent pas par accident.
 *  - Une ligne SANS ID_PE est en revanche rapprochée d'une ligne qui en a un
 *    dès que les mails sont proches : « alain.dupont » et « alain.dupond »
 *    sont vraisemblablement la même personne, dont l'une des deux fiches a
 *    été saisie de travers.
 *
 * La comparaison des mails ignore toujours la casse et les accents.
 *
 * Dépendance : ../shared/search-text.js (normalisation, Levenshtein).
 */

(function (global) {
    /*
     * Seuils du rapprochement approché, sur la partie locale du mail.
     *
     * Deux conditions cumulatives. La distance absolue borne le nombre de
     * fautes de frappe admises. La proportion évite qu'une adresse courte ne
     * soit rapprochée de n'importe quoi : sur « abcde », deux corrections
     * changent presque tout, alors que sur « alain.dupont » elles ne pèsent
     * qu'un sixième. Le ratio de similarité de 0,7 utilisé ailleurs dans le
     * projet pour les noms de formateurs serait bien trop permissif ici :
     * « alain.dupont » et « alain.dupuis » le franchiraient.
     */
    const FUZZY_MAX_DISTANCE = 2;
    const FUZZY_MAX_RATIO = 0.2;

    // Champs proposés à l'harmonisation, dans l'ordre d'affichage.
    const HARMONIZED_FIELDS = ['ID_PE', 'Civilite', 'Nom', 'Prenom', 'Mail'];

    // Champs dont la divergence révèle l'incohérence nº 2.
    const IDENTITY_FIELDS = ['Civilite', 'Nom', 'Prenom'];

    /*
     * Valeur affichable d'un champ d'identité, blancs ramenés à une espace
     * simple. Ces champs tiennent tous sur une ligne, un saut de ligne y est
     * toujours une erreur de saisie — un copier-coller dans Grist convertit
     * parfois une espace en saut de ligne suivi de deux espaces.
     *
     * C'est aussi la valeur PROPOSÉE à l'harmonisation : arbitrer entre
     * « DUPONT DURAND » et « DUPONT\n  DURAND » est impossible, le HTML
     * repliant les blancs les affiche à l'identique.
     */
    function text(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/\s+/g, ' ').trim();
    }

    // Forme comparable : minuscules, sans accent. Vaut pour les mails comme
    // pour les champs d'identité.
    //
    // Pas de repli si SearchText manque : une comparaison sensible à la casse
    // ou aux accents produirait des groupes faux, plus nuisibles qu'une erreur
    // visible en console.
    function norm(value) {
        return global.SearchText.normalize(value);
    }

    // Partie locale et domaine d'une adresse normalisée, ou null si l'adresse
    // n'est pas exploitable.
    function mailParts(normalized) {
        const at = normalized.lastIndexOf('@');
        if (at <= 0 || at === normalized.length - 1) return null;
        return { local: normalized.slice(0, at), domain: normalized.slice(at + 1) };
    }

    /**
     * Deux mails normalisés sont-ils « proches » sans être identiques ?
     *
     * Le domaine doit être le même : une adresse d'un autre système n'est pas
     * une faute de frappe. Les pré-contrôles de longueur écartent la grande
     * majorité des paires sans calculer de distance, ce qui compte quand
     * Liste_PE atteint plusieurs dizaines de milliers de lignes.
     */
    function mailsClose(normalizedA, normalizedB) {
        if (!normalizedA || !normalizedB || normalizedA === normalizedB) return false;

        const a = mailParts(normalizedA);
        const b = mailParts(normalizedB);
        if (!a || !b || a.domain !== b.domain) return false;

        const maxLength = Math.max(a.local.length, b.local.length);
        if (Math.abs(a.local.length - b.local.length) > FUZZY_MAX_DISTANCE) return false;
        if (maxLength === 0) return false;

        const distance = global.SearchText.levenshtein(a.local, b.local);
        if (distance === 0 || distance > FUZZY_MAX_DISTANCE) return false;
        return (distance / maxLength) <= FUZZY_MAX_RATIO;
    }

    /* ----------------------------------------------------------------------
       Union-find : les relations sont binaires, mais une même ligne peut être
       liée à plusieurs autres. Les groupes présentés sont les composantes
       connexes, ce qui rattache par transitivité les lignes d'une même
       personne qui ne divergent pas entre elles.
       ---------------------------------------------------------------------- */
    function makeUnionFind() {
        const parent = new Map();

        function find(x) {
            if (!parent.has(x)) { parent.set(x, x); return x; }
            let root = x;
            while (parent.get(root) !== root) root = parent.get(root);
            // Compression de chemin.
            let cursor = x;
            while (parent.get(cursor) !== root) {
                const next = parent.get(cursor);
                parent.set(cursor, root);
                cursor = next;
            }
            return root;
        }

        return {
            union(a, b) { parent.set(find(a), find(b)); },
            groups() {
                const byRoot = new Map();
                for (const key of parent.keys()) {
                    const root = find(key);
                    if (!byRoot.has(root)) byRoot.set(root, []);
                    byRoot.get(root).push(key);
                }
                return byRoot;
            }
        };
    }

    /**
     * Groupes de lignes incohérentes.
     *
     * @param {object[]} listePe enregistrements { id, ID_PE, Civilite, Nom, Prenom, Mail, ... }
     * @returns {{ rows: object[], reasons: string[] }[]}
     *          `reasons` parmi 'mail-identique', 'mail-proche', 'identite'.
     */
    function findIncoherentGroups(listePe) {
        const rows = Array.isArray(listePe) ? listePe : [];
        const byId = new Map();
        for (const row of rows) byId.set(row.id, row);

        const uf = makeUnionFind();
        const reasonsByPair = new Map();

        const noteReason = (a, b, reason) => {
            uf.union(a, b);
            for (const key of [a, b]) {
                let set = reasonsByPair.get(key);
                if (!set) { set = new Set(); reasonsByPair.set(key, set); }
                set.add(reason);
            }
        };

        // Index par mail normalisé : une seule passe, pas de comparaison
        // croisée de toutes les lignes entre elles.
        const byMail = new Map();
        for (const row of rows) {
            const mail = norm(row.Mail);
            if (!mail) continue;
            if (!byMail.has(mail)) byMail.set(mail, []);
            byMail.get(mail).push(row);
        }

        // Incohérence 1 — même mail, ID_PE différents.
        for (const bucket of byMail.values()) {
            for (let i = 0; i < bucket.length; i++) {
                for (let j = i + 1; j < bucket.length; j++) {
                    if (text(bucket[i].ID_PE) !== text(bucket[j].ID_PE)) {
                        noteReason(bucket[i].id, bucket[j].id, 'mail-identique');
                    }
                }
            }
        }

        // Rapprochement approché — uniquement depuis les mails dont AU MOINS
        // une ligne n'a pas d'ID_PE, vers les mails qui en ont un.
        const mailsSansId = [];
        const mailsAvecId = [];
        for (const [mail, bucket] of byMail) {
            if (bucket.some(r => !text(r.ID_PE))) mailsSansId.push(mail);
            if (bucket.some(r => text(r.ID_PE))) mailsAvecId.push(mail);
        }

        /*
         * Les mails identifiés sont indexés par domaine et par longueur de
         * partie locale. Une distance d'au plus FUZZY_MAX_DISTANCE impose un
         * écart de longueur au plus égal, et le domaine doit être identique :
         * on ne parcourt donc qu'une fenêtre étroite de candidats, au lieu de
         * croiser tous les mails entre eux. Sans cet index, quelques milliers
         * de lignes sans ID_PE suffiraient à figer le widget.
         */
        const identifiedByBucket = new Map();
        for (const mail of mailsAvecId) {
            const parts = mailParts(mail);
            if (!parts) continue;
            const key = parts.domain + '|' + parts.local.length;
            if (!identifiedByBucket.has(key)) identifiedByBucket.set(key, []);
            identifiedByBucket.get(key).push(mail);
        }

        for (const mailSansId of mailsSansId) {
            const parts = mailParts(mailSansId);
            if (!parts) continue;

            for (let delta = -FUZZY_MAX_DISTANCE; delta <= FUZZY_MAX_DISTANCE; delta++) {
                const candidates = identifiedByBucket.get(
                    parts.domain + '|' + (parts.local.length + delta));
                if (!candidates) continue;

                for (const mailAvecId of candidates) {
                    if (!mailsClose(mailSansId, mailAvecId)) continue;
                    // Seules les lignes sans ID_PE d'un côté, avec ID_PE de
                    // l'autre, sont mises en relation.
                    for (const orphan of byMail.get(mailSansId)) {
                        if (text(orphan.ID_PE)) continue;
                        for (const identified of byMail.get(mailAvecId)) {
                            if (!text(identified.ID_PE)) continue;
                            noteReason(orphan.id, identified.id, 'mail-proche');
                        }
                    }
                }
            }
        }

        // Incohérence 2 — même ID_PE, identité différente.
        const byIdPe = new Map();
        for (const row of rows) {
            const idPe = text(row.ID_PE);
            if (!idPe) continue;
            if (!byIdPe.has(idPe)) byIdPe.set(idPe, []);
            byIdPe.get(idPe).push(row);
        }

        for (const bucket of byIdPe.values()) {
            for (let i = 0; i < bucket.length; i++) {
                for (let j = i + 1; j < bucket.length; j++) {
                    const differ = IDENTITY_FIELDS.some(field =>
                        norm(bucket[i][field]) !== norm(bucket[j][field]));
                    if (differ) {
                        noteReason(bucket[i].id, bucket[j].id, 'identite');
                    }
                }
            }
        }

        const groups = [];
        for (const memberIds of uf.groups().values()) {
            if (memberIds.length < 2) continue;

            const reasons = new Set();
            for (const id of memberIds) {
                for (const reason of (reasonsByPair.get(id) || [])) reasons.add(reason);
            }

            groups.push({
                rows: memberIds.map(id => byId.get(id)).filter(Boolean)
                    .sort((a, b) => a.id - b.id),
                reasons: Array.from(reasons)
            });
        }

        groups.sort((a, b) => (b.rows.length - a.rows.length) || (a.rows[0].id - b.rows[0].id));
        return groups;
    }

    /**
     * Champs à harmoniser et valeurs proposées, par champ.
     *
     * Les valeurs vides ne sont jamais proposées : on n'harmonise pas VERS
     * l'absence de donnée. Mais une ligne vide est bien une divergence à
     * corriger — c'est même le cas central du rapprochement approché, où
     * l'identifiant personnel n'existe que sur une des lignes. Un tel champ
     * est donc retourné avec une valeur unique : il n'y a rien à arbitrer,
     * seulement une valeur à reporter sur les lignes qui en manquent.
     *
     * Un champ dont toutes les lignes portent déjà la même valeur non vide
     * n'appelle aucune écriture et n'est pas retourné.
     *
     * @param {object[]} rows lignes retenues (hors lignes exclues)
     * @returns {{ field: string, values: string[] }[]}
     */
    function fieldChoices(rows) {
        const choices = [];

        for (const field of HARMONIZED_FIELDS) {
            const values = [];
            const seen = new Set();
            let divergence = false;

            for (const row of rows) {
                const value = text(row[field]);
                if (!value) { divergence = true; continue; }
                // Deux graphies ne différant que par la casse restent deux
                // propositions distinctes : c'est à l'utilisateur de choisir.
                if (!seen.has(value)) { seen.add(value); values.push(value); }
            }
            if (values.length > 1) divergence = true;

            if (!values.length || !divergence) continue;
            choices.push({ field, values });
        }

        return choices;
    }

    /**
     * Actions Grist d'harmonisation, en une seule transaction.
     *
     * @param {object[]} rows lignes à aligner (les lignes exclues sont déjà retirées)
     * @param {object} values { [field]: valeur retenue }
     * @returns {Array[]} actions, vide s'il n'y a rien à écrire
     */
    function buildHarmonizeActions(rows, values) {
        const fields = Object.keys(values || {})
            .filter(field => HARMONIZED_FIELDS.includes(field) && text(values[field]));
        if (!fields.length || !rows.length) return [];

        const rowIds = [];
        const columns = {};
        for (const field of fields) columns[field] = [];

        for (const row of rows) {
            /*
             * Comparaison sur la valeur BRUTE, pas sur sa forme repliée : une
             * ligne dont le contenu ne diffère que par un saut de ligne ou une
             * espace en trop doit être réécrite propre. L'harmonisation sert
             * ainsi aussi de nettoyage.
             */
            const needsUpdate = fields.some(field => {
                const raw = (row[field] === null || row[field] === undefined)
                    ? '' : String(row[field]);
                return raw !== text(values[field]);
            });
            if (!needsUpdate) continue;

            rowIds.push(row.id);
            for (const field of fields) columns[field].push(values[field]);
        }

        if (!rowIds.length) return [];
        return [['BulkUpdateRecord', 'Liste_PE', rowIds, columns]];
    }

    global.ListePeCoherence = {
        findIncoherentGroups,
        fieldChoices,
        buildHarmonizeActions,
        HARMONIZED_FIELDS
    };

})(typeof window !== 'undefined' ? window : this);
