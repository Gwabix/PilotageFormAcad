        (function () {
            "use strict";

            var T_LAICITE = "La\u00EFcit\u00E9";
            var T_LAICITE6 = "La\u00EFcit\u00E9 (6h)";
            var T_CPS = "CPS";
            var T_CPS6 = "CPS (6h)";
            var T_SMVSS = "Sant\u00E9 mentale / VSS";
            var T_SMVSS_CPS = "Sant\u00E9 mentale / VSS ou CPS";
            var T_EVAL = "\u00C9valuation d'\u00E9cole";
            var T_NOMOD = "Modalit\u00E9 non renseign\u00E9e";
            var T_NOPE = "Aucun PE rattach\u00E9 \u00E0 cette \u00E9cole.";
            var T_NORES = "Aucune \u00E9cole ne correspond \u00E0 votre recherche.";
            var T_NODATA = "Aucune donn\u00E9e disponible.";
            var T_ECOLE = "\u00E9cole";
            var T_ECOLES = "\u00E9cole(s)";
            var T_FR = "Fran\u00E7ais";
            var T_FORM = "Formateurs (pr\u00E9visionnel)";
            var CHEV = "\u25B6";
            var DOT = " \u00B7 ";
            var DASH = '<span class="cell-empty">&mdash;</span>';
            var D = window.CalendrierDates;
            var T_MODULES = "Autres modules";

            // Modules dont les dates sont lues dans Autres_modules (colonne Module,
            // rapprochee sans casse ni accents).
            var MOD_LAICITE = "Laïcité";
            var MOD_CPS = "CPS";
            var MOD_SMVSS = "Santé mentale / VSS";
            var MODULE_ORDER = [MOD_LAICITE, MOD_CPS, MOD_SMVSS];

            var schools = [];
            var allRecords = [];
            var selectedYear = null;
            var sourceSeq = 0;
            var openKeys = {};
            var targetKey = null;
            var suggestions = [];
            var suggIndex = -1;

            function esc(v) {
                if (v === null || v === undefined) { return ""; }
                return String(v)
                    .replace(/&/g, "\u0026amp;")
                    .replace(/</g, "\u0026lt;")
                    .replace(/>/g, "\u0026gt;")
                    .replace(/"/g, "\u0026quot;")
                    .replace(/'/g, "\u0026#39;");
            }

            function txt(v) {
                if (v === null || v === undefined) { return ""; }
                if (typeof v === "string") { return v.trim(); }
                if (Array.isArray(v)) {
                    var out = [];
                    for (var i = 0; i < v.length; i++) {
                        var x = v[i];
                        if (x === null || x === undefined) { continue; }
                        if (i === 0 && x === "L") { continue; }
                        var s = String(x).trim();
                        if (s) { out.push(s); }
                    }
                    return out.join(", ");
                }
                if (typeof v === "object") { return ""; }
                return String(v).trim();
            }

            function toBool(v) {
                if (v === true) { return true; }
                if (v === false) { return false; }
                if (v === null || v === undefined || v === "") { return null; }
                if (typeof v === "number") { return v !== 0; }
                if (typeof v === "string") {
                    var s = v.trim().toLowerCase();
                    if (s === "true" || s === "vrai" || s === "oui" || s === "1") { return true; }
                    if (s === "false" || s === "faux" || s === "non" || s === "0") { return false; }
                }
                return null;
            }

            var DIACRITICS_RE = new RegExp("[\u0300-\u036f]", "g");
            function norm(s) {
                if (s === null || s === undefined) { return ""; }
                return String(s).normalize("NFD").replace(DIACRITICS_RE, "").toLowerCase().trim();
            }

            // text : libelle de la colonne Autres ; modules : modules a suivre par
            // l'enseignant, dont les dates viennent d'Autres_modules.
            function computeAutres(base, laicite, cps) {
                var hasSmvssCps = !!base && base.indexOf(T_SMVSS_CPS) !== -1;
                if (base === T_SMVSS_CPS) {
                    if (laicite === false) { return { text: T_LAICITE, warn: false, modules: [MOD_LAICITE] }; }
                    if (cps === false) { return { text: T_CPS, warn: false, modules: [MOD_CPS] }; }
                    return { text: T_SMVSS, warn: false, modules: [MOD_SMVSS] };
                }
                if (base === T_EVAL) {
                    if (laicite === false) { return { text: T_LAICITE, warn: false, modules: [MOD_LAICITE] }; }
                    return { text: T_EVAL, warn: false, modules: [] };
                }
                var modules = [];
                if (laicite === false) { modules.push(MOD_LAICITE); }
                if (hasSmvssCps) { modules.push(cps === false ? MOD_CPS : MOD_SMVSS); }
                if (laicite === false) {
                    return { text: base ? base + "\n+ " + T_LAICITE6 : T_LAICITE6, warn: true, modules: modules };
                }
                if (cps === false && hasSmvssCps) {
                    return { text: base + "\n+ " + T_CPS6, warn: true, modules: modules };
                }
                return { text: base, warn: false, modules: modules };
            }

            // Liste_PE a-t-elle une colonne Annee_scolaire visible dans la vue ?
            function recordsHaveYear(records) {
                return records.some(function (r) { return Object.prototype.hasOwnProperty.call(r, TH_YEAR); });
            }

            // Valeur de la ligne Thematiques de l'annee, a defaut de la formule Liste_PE.
            function thValue(row, colId, rec, fallbackCol) {
                if (source) { return row === null ? "" : txt(source.data[colId] && source.data[colId][row]); }
                return txt(rec[fallbackCol]);
            }

            function buildSchools(records) {
                var map = {};
                var order = [];
                var filterYear = selectedYear !== null && recordsHaveYear(records);
                for (var i = 0; i < records.length; i++) {
                    var rec = records[i];
                    if (filterYear && txt(rec[TH_YEAR]) !== selectedYear) { continue; }
                    var uai = rec.UAI;
                    var hasUai = (uai !== null && uai !== undefined && uai !== 0 && uai !== "");
                    var row = (source && hasUai) ? rowForUai(String(uai), selectedYear) : null;
                    var modaliteVal = thValue(row, "Modalite", rec, "Modalite");
                    // Ecoles du plan : une ligne Thematiques pour l'annee (modalite
                    // eventuellement vide), ou a defaut une modalite dans Liste_PE.
                    if (source ? row === null : !modaliteVal) { continue; }
                    var ecole = txt(rec.Ecole);
                    var key = hasUai ? ("u" + String(uai)) : ("l" + (norm(ecole) || "none"));
                    if (!map[key]) {
                        map[key] = { key: key, uai: hasUai ? String(uai) : "", ecole: ecole, circo: txt(rec.Circonscription), dept: txt(rec.Departement), modalite: modaliteVal, row: row, pe: [] };
                        order.push(key);
                    }
                    var sc = map[key];
                    if (!sc.ecole) { sc.ecole = ecole; }
                    if (!sc.circo) { sc.circo = txt(rec.Circonscription); }
                    if (!sc.dept) { sc.dept = txt(rec.Departement); }
                    if (!sc.modalite) { sc.modalite = modaliteVal; }
                    var lai = toBool(rec.Laicite_OK);
                    var cps = toBool(rec.CPS_OK);
                    var au = computeAutres(thValue(row, "Autre", rec, "Autres"), lai, cps);
                    sc.pe.push({ id: rec.id, civilite: txt(rec.Civilite), nom: txt(rec.Nom), prenom: txt(rec.Prenom), mail: txt(rec.Mail), fonction: txt(rec.Fonction), quotite: txt(rec.Quotite_de_service), niveaux: txt(rec.Niveau_x_), francais: thValue(row, "Francais", rec, "Francais"), maths: thValue(row, "Mathematiques", rec, "Maths"), autres: au.text, warn: au.warn, modules: au.modules, laicite: lai, cps: cps, formateurs: thValue(row, "Formateur_s_", rec, "Formateurs") });
                }
                var list = [];
                for (var j = 0; j < order.length; j++) { list.push(map[order[j]]); }
                for (var k = 0; k < list.length; k++) {
                    var s = list[k];
                    s.pe.sort(function (a, b) {
                        var c = norm(a.nom).localeCompare(norm(b.nom));
                        if (c !== 0) { return c; }
                        return norm(a.prenom).localeCompare(norm(b.prenom));
                    });
                    // Ni circonscription ni departement : ils portent le nom d'une
                    // commune ou du departement et rameneraient toutes leurs ecoles.
                    s.search = norm([s.ecole, s.uai, s.modalite].join(" "));
                    var peTxt = [];
                    for (var m = 0; m < s.pe.length; m++) { peTxt.push(norm(s.pe[m].nom + " " + s.pe[m].prenom + " " + s.pe[m].mail)); }
                    s.searchAll = s.search + " " + peTxt.join(" ");
                }
                list.sort(function (a, b) { return norm(a.ecole || a.uai).localeCompare(norm(b.ecole || b.uai)); });
                return list;
            }

            function tokens(q) {
                var t = norm(q).split(/\s+/);
                var out = [];
                for (var i = 0; i < t.length; i++) { if (t[i]) { out.push(t[i]); } }
                return out;
            }

            function matchAll(hay, tk) {
                for (var i = 0; i < tk.length; i++) { if (hay.indexOf(tk[i]) === -1) { return false; } }
                return true;
            }

            function filterSchools(q) {
                var tk = tokens(q);
                if (tk.length === 0) { return schools.slice(); }
                var out = [];
                for (var i = 0; i < schools.length; i++) {
                    if (matchAll(schools[i].searchAll, tk)) { out.push(schools[i]); }
                }
                return out;
            }

            function buildSuggestions(q) {
                var tk = tokens(q);
                if (tk.length === 0) { return []; }
                var out = [];
                for (var i = 0; i < schools.length && out.length < 12; i++) {
                    if (matchAll(schools[i].search, tk)) { out.push(schools[i]); }
                }
                return out;
            }

            function tag(text, warn) {
                if (!text) { return DASH; }
                return '<span class="tag' + (warn ? " warn" : "") + '">' + esc(text) + '</span>';
            }

            function plainList(text) {
                if (!text) { return DASH; }
                return '<span class="list-plain">' + esc(text) + '</span>';
            }

            function renderPe(pe) {
                var nameParts = [];
                if (pe.civilite) { nameParts.push(pe.civilite); }
                if (pe.nom) { nameParts.push(pe.nom); }
                if (pe.prenom) { nameParts.push(pe.prenom); }
                var full = nameParts.join(" ");
                var subParts = [];
                if (pe.fonction) { subParts.push(pe.fonction); }
                if (pe.quotite) { subParts.push(pe.quotite); }
                if (pe.niveaux) { subParts.push(pe.niveaux); }
                var sub = subParts.join(DOT);
                var isPartTime = !!pe.quotite && pe.quotite !== "100%";
                var h = [];
                h.push(isPartTime ? '<tr class="quotite-partial"><td>' : "<tr><td>");
                h.push('<div class="pe-name">');
                h.push(full ? esc(full) : DASH);
                h.push("</div>");
                if (pe.mail) { h.push('<div class="pe-sub">' + esc(pe.mail) + "</div>"); }
                if (sub) { h.push('<div class="pe-sub">' + esc(sub) + "</div>"); }
                h.push("</td><td>" + tag(pe.francais, false) + "</td>");
                h.push("<td>" + tag(pe.maths, false) + "</td>");
                h.push("<td>" + tag(pe.autres, pe.warn) + "</td>");
                h.push("<td>" + plainList(pe.formateurs) + "</td>");
                h.push("<td>" + modulesCell(pe.modules) + "</td></tr>");
                return h.join("");
            }

            // Ligne Autres_modules du module pour l'annee choisie, ou null.
            function moduleRecord(name) {
                if (!source || !source.modules) { return null; }
                return source.modules[D.normKey(name) + "|" + (selectedYear || "")] || null;
            }

            // Dates d'un module, en HTML : « Dates a definir » sans ligne ou ligne vide.
            function moduleDatesHtml(name) {
                if (source && source.modulesError) { return '<span class="cell-empty">' + esc("Dates illisibles") + "</span>"; }
                var lines = D.lines(moduleRecord(name));
                if (!lines.length) { return '<span class="dates-todo">' + esc(D.EMPTY_TEXT) + "</span>"; }
                return D.toHtml(lines.join("\n"), esc);
            }

            function modulesCell(modules) {
                if (!modules || !modules.length) { return DASH; }
                return modules.map(function (m) {
                    return '<div class="mod-dates"><div class="mod-name">' + esc(m) + '</div><div class="mod-lines">' + moduleDatesHtml(m) + "</div></div>";
                }).join("");
            }

            // Dates de l'ecole (Thematiques.Dates), en HTML.
            function schoolDatesHtml(row) {
                var value = (source && row !== null && source.data.Dates) ? txt(source.data.Dates[row]) : "";
                if (!value) { return '<span class="dates-todo">' + esc(D.EMPTY_TEXT) + "</span>"; }
                return D.toHtml(value, esc);
            }

            function renderSchool(sc) {
                var isOpen = !!openKeys[sc.key];
                var isTarget = targetKey === sc.key;
                var meta = [];
                if (sc.uai) { meta.push("UAI " + sc.uai); }
                if (sc.circo) { meta.push(sc.circo); }
                if (sc.dept) { meta.push(sc.dept); }
                var mod;
                if (sc.modalite) {
                    mod = '<span class="modalite" title="' + esc(sc.modalite) + '">' + esc(sc.modalite) + "</span>";
                } else {
                    mod = '<span class="modalite empty">' + esc(T_NOMOD) + "</span>";
                }
                var body;
                if (sc.pe.length === 0) {
                    body = '<div class="no-pe">' + esc(T_NOPE) + "</div>";
                } else {
                    var rows = [];
                    for (var i = 0; i < sc.pe.length; i++) { rows.push(renderPe(sc.pe[i])); }
                    var th = [];
                    th.push("<table><thead><tr>");
                    th.push("<th>Enseignant</th>");
                    th.push("<th>" + esc(T_FR) + "</th>");
                    th.push("<th>Maths</th>");
                    th.push("<th>Autres</th>");
                    th.push("<th>" + esc(T_FORM) + "</th>");
                    th.push("<th>" + esc(T_MODULES) + "</th>");
                    th.push("</tr></thead><tbody>");
                    th.push(rows.join(""));
                    th.push("</tbody></table>");
                    body = th.join("");
                }
                if (source && source.data.Dates) {
                    body = '<div class="school-dates"><span class="school-dates-label">Dates</span><div class="school-dates-text">' +
                        schoolDatesHtml(sc.row) + "</div></div>" + body;
                }
                var cls = "school";
                if (isOpen) { cls += " open"; }
                if (isTarget) { cls += " target"; }
                var h = [];
                h.push('<section class="' + cls + '" data-key="' + esc(sc.key) + '">');
                h.push('<div class="school-head" role="button" tabindex="0" data-toggle="' + esc(sc.key) + '">');
                h.push('<span class="chevron">' + CHEV + "</span>");
                h.push('<div class="school-title"><div class="school-name">');
                h.push(sc.ecole ? esc(sc.ecole) : ("UAI " + esc(sc.uai || "?")));
                h.push("</div>");
                if (meta.length) { h.push('<div class="school-meta">' + esc(meta.join(DOT)) + "</div>"); }
                h.push("</div>");
                h.push(mod);
                h.push('<span class="badge">' + sc.pe.length + " PE</span>");
                h.push("</div>");
                h.push('<div class="school-body">' + body + "</div>");
                h.push("</section>");
                return h.join("");
            }

            // ---------- Export PDF ----------

            var TH_TABLE = "Thematiques";
            var TH_YEAR = "Annee_scolaire";
            var TH_UAI = "UAI";
            // Colonnes proposees pour l'en-tete de l'ecole, dans l'ordre de Thematiques.
            // Liste fixe : les tables _grist_* suivent les regles par defaut, qui refusent
            // la lecture aux non-proprietaires. A tenir a jour si Thematiques change.
            // Hors liste : l'annee scolaire se choisit a part ; UAI et circonscription
            // figurent deja sous le nom de l'ecole ; Ecole le repete ; TABLE_COLS.
            var TH_HEADER_COLS = [
                { id: "Annee_du_Plan", label: "Année du Plan", type: "Choice" },
                { id: "Regroupement", label: "Regroupement", type: "Text" },
                { id: "Competence_fil_rouge", label: "Compétence fil rouge", type: "Text", checked: true },
                { id: "Modalite", label: "Modalité", type: "Choice", checked: true },
                { id: "Notes_pour_plus_tard", label: "Notes pour plus tard", type: "Text" },
                { id: "Dates", label: "Dates", type: "Dates", checked: true }
            ];
            // Dates des modules suivis par les enseignants de l'ecole (Autres_modules).
            var MODULES_COL = "__modules";
            var MODULES_TABLE = "Autres_modules";
            var PE_COL = "__pe";
            var T_NOYEAR = "Sans année scolaire";

            // Colonnes du tableau des enseignants, cochees par defaut. Hormis
            // Enseignant (Liste_PE), elles sont lues dans la ligne Thematiques
            // de l'annee choisie. Toute autre colonne de Thematiques va dans
            // l'en-tete de l'ecole.
            var TABLE_COLS = [
                { id: PE_COL, label: "Enseignant", weight: 24 },
                { id: "Francais", label: T_FR, weight: 20, kind: "tag" },
                { id: "Mathematiques", label: "Maths", weight: 20, kind: "tag" },
                { id: "Autre", label: "Autres", weight: 22, kind: "autres" },
                { id: "Formateur_s_", label: T_FORM, weight: 14, kind: "plain" }
            ];

            var PRINT_ROOT_MM = 276;
            var PRINT_CELL_PAD = 14;
            var printMinByLabel = {};
            var source = null;
            var sourceError = "";
            var exportBusy = false;

            // Largeur minimale d'une colonne : le mot le plus long de son en-tete,
            // mesure avec la typographie d'impression. L'en-tete peut donc se
            // replier entre deux mots mais n'est jamais coupe ni tronque.
            function printMins(labels) {
                var missing = labels.filter(function (l) { return !(l in printMinByLabel); });
                if (missing.length) {
                    var host = document.createElement("div");
                    host.className = "print-probe-host";
                    host.style.width = PRINT_ROOT_MM + "mm";
                    var probe = document.createElement("span");
                    probe.className = "print-probe";
                    host.appendChild(probe);
                    document.body.appendChild(host);
                    var ref = host.getBoundingClientRect().width;
                    for (var i = 0; i < missing.length; i++) {
                        var words = missing[i].split(/\s+/);
                        var max = 0;
                        for (var w = 0; w < words.length; w++) {
                            probe.textContent = words[w];
                            var wd = probe.getBoundingClientRect().width;
                            if (wd > max) { max = wd; }
                        }
                        printMinByLabel[missing[i]] = ref > 0 ? (max + PRINT_CELL_PAD) / ref * 100 : 10;
                    }
                    document.body.removeChild(host);
                }
                return labels.map(function (l) { return printMinByLabel[l]; });
            }

            // Bornes de largeur (en % du tableau) : Enseignant ne depasse pas PRINT_PE_MAX ;
            // une colonne remplie reste entre PRINT_USED_MIN et PRINT_USED_MAX.
            var PRINT_PE_MAX = 32;
            var PRINT_USED_MIN = 12;
            var PRINT_USED_MAX = 30;

            // Repartit 100% entre les colonnes selon leurs poids, en ramenant
            // toute colonne entre son minimum et son maximum.
            function spreadWidths(weights, mins, maxs) {
                var n = weights.length;
                var fixed = [];
                var out = weights.slice();
                var i;
                for (i = 0; i < n; i++) { fixed.push(null); }
                for (var pass = 0; pass <= n; pass++) {
                    var sumW = 0;
                    var taken = 0;
                    for (i = 0; i < n; i++) {
                        if (fixed[i] === null) { sumW += weights[i]; } else { taken += fixed[i]; }
                    }
                    var avail = 100 - taken;
                    var changed = false;
                    out = [];
                    for (i = 0; i < n; i++) {
                        if (fixed[i] === null) {
                            var w = (sumW > 0 && avail > 0) ? avail * weights[i] / sumW : 0;
                            if (w < mins[i] - 0.01) { fixed[i] = mins[i]; changed = true; }
                            else if (w > maxs[i] + 0.01) { fixed[i] = maxs[i]; changed = true; }
                            else { out.push(w); continue; }
                        }
                        out.push(fixed[i]);
                    }
                    if (!changed) { break; }
                }
                return out;
            }

            function cellValue(col, row) {
                return row === null ? "" : txt(source.data[col.id] && source.data[col.id][row]);
            }

            // Une colonne est remplie si au moins un enseignant de l'ecole y affiche
            // quelque chose : pour Autres, apres le calcul CPS / Laicite.
            function columnUsed(col, sc, row) {
                if (col.id === PE_COL) { return true; }
                var value = cellValue(col, row);
                if (col.kind === "autres") {
                    return sc.pe.some(function (pe) { return !!computeAutres(value, pe.laicite, pe.cps).text; });
                }
                return !!value;
            }

            function printColWidths(cols, sc, row) {
                var heads = printMins(cols.map(function (c) { return c.label; }));
                var used = cols.map(function (c) { return columnUsed(c, sc, row); });
                var weights = cols.map(function (c, i) { return used[i] ? c.weight : 0; });
                var mins = cols.map(function (c, i) {
                    return (used[i] && c.id !== PE_COL) ? Math.max(heads[i], PRINT_USED_MIN) : heads[i];
                });
                var maxs = cols.map(function (c, i) {
                    if (c.id === PE_COL) { return Math.max(heads[i], PRINT_PE_MAX); }
                    return used[i] ? Math.max(heads[i], PRINT_USED_MIN, PRINT_USED_MAX) : 100;
                });
                var raw = spreadWidths(weights, mins, maxs);

                // Place laissee par les maximums : aux colonnes vides, a defaut aux
                // colonnes remplies, a defaut a Enseignant seul.
                var total = raw.reduce(function (a, b) { return a + b; }, 0);
                if (total < 99.99) {
                    var targets = [];
                    var k;
                    for (k = 0; k < cols.length; k++) { if (!used[k]) { targets.push(k); } }
                    if (!targets.length) { for (k = 0; k < cols.length; k++) { if (used[k] && cols[k].id !== PE_COL) { targets.push(k); } } }
                    if (!targets.length) { for (k = 0; k < cols.length; k++) { targets.push(k); } }
                    var sumT = targets.reduce(function (a, t) { return a + cols[t].weight; }, 0);
                    targets.forEach(function (t) { raw[t] += (100 - total) * cols[t].weight / sumT; });
                }

                var out = [];
                var sum = 0;
                var widest = -1;
                for (var j = 0; j < cols.length; j++) {
                    var v = Math.round(raw[j] * 100) / 100;
                    out.push(v);
                    sum += v;
                    if (cols[j].id !== PE_COL && (widest === -1 || v > out[widest])) { widest = j; }
                }
                // Ecart d'arrondi reporte sur la plus large des colonnes autres qu'Enseignant,
                // pour ne pas depasser le plafond de celle-ci.
                if (widest === -1) { widest = 0; }
                out[widest] = Math.round((out[widest] + 100 - sum) * 100) / 100;
                return out;
            }

            function yearNumber(label) {
                var m = String(label).match(/(\d+)/);
                return m ? parseInt(m[1], 10) : Infinity;
            }

            function formatValue(v, type) {
                if (v === null || v === undefined || v === "") { return ""; }
                if (type === "Bool") { return v === true ? "Oui" : (v === false ? "Non" : txt(v)); }
                if ((type === "Date" || type.indexOf("DateTime") === 0) && typeof v === "number") {
                    return new Date(v * 1000).toLocaleDateString("fr-FR", { timeZone: "UTC" });
                }
                return txt(v);
            }

            // Autres_modules indexee par module et annee ; la plus ancienne ligne en cas de doublon.
            function indexModules(table) {
                var out = {};
                var ids = {};
                if (!table || !Array.isArray(table.id)) { return out; }
                for (var r = 0; r < table.id.length; r++) {
                    var key = D.normKey(table.Module && table.Module[r]) + "|" + txt(table[TH_YEAR] && table[TH_YEAR][r]);
                    if (key in ids && ids[key] < table.id[r]) { continue; }
                    var rec = {};
                    for (var col in table) {
                        if (Array.isArray(table[col])) { rec[col] = table[col][r]; }
                    }
                    out[key] = rec;
                    ids[key] = table.id[r];
                }
                return out;
            }

            async function loadSource() {
                var res = await Promise.all([
                    grist.docApi.fetchTable(TH_TABLE),
                    // Autres_modules est facultative : son absence ne bloque ni l'affichage ni l'export.
                    grist.docApi.fetchTable(MODULES_TABLE).catch(function (err) {
                        return { error: err && err.message ? err.message : "erreur inconnue" };
                    })
                ]);
                var data = res[0];
                if (!data[TH_UAI] || !data[TH_YEAR]) {
                    throw new Error("colonnes " + TH_UAI + " ou " + TH_YEAR + " introuvables dans " + TH_TABLE);
                }

                // Colonne supprimee ou renommee dans Grist : simplement absente des options.
                var headerCols = TH_HEADER_COLS.filter(function (c) {
                    return !!data[c.id];
                }).map(function (c) {
                    return { id: c.id, label: c.label, source: c.id, type: c.type, checked: !!c.checked };
                });

                // Ligne par ecole (code UAI) et par annee ; la plus ancienne en cas de doublon.
                var rows = {};
                var years = {};
                for (var r = 0; r < data.id.length; r++) {
                    var year = txt(data[TH_YEAR][r]);
                    var key = txt(data[TH_UAI][r]) + "|" + year;
                    years[year] = true;
                    if (!(key in rows) || data.id[r] < data.id[rows[key]]) { rows[key] = r; }
                }
                var modulesError = res[1] && res[1].error ? res[1].error : "";
                if (modulesError) {
                    console.warn("Table " + MODULES_TABLE + " illisible : " + modulesError);
                } else {
                    headerCols.push({ id: MODULES_COL, label: "Dates des autres modules", type: "modules", checked: true });
                }

                return {
                    data: data, headerCols: headerCols, rows: rows, years: Object.keys(years),
                    modules: modulesError ? null : indexModules(res[1]), modulesError: modulesError
                };
            }

            function sortYears(list) {
                return list.sort(function (a, b) {
                    if (!a) { return 1; }
                    if (!b) { return -1; }
                    return yearNumber(a) - yearNumber(b) || a.localeCompare(b);
                });
            }

            function rowForUai(uai, year) {
                var key = uai + "|" + (year || "");
                return (source && key in source.rows) ? source.rows[key] : null;
            }

            function rowFor(sc, year) {
                return sc.uai ? rowForUai(sc.uai, year) : null;
            }

            function renderPrintCell(col, pe, row) {
                if (col.id === PE_COL) {
                    var nameParts = [];
                    if (pe.civilite) { nameParts.push(pe.civilite); }
                    if (pe.nom) { nameParts.push(pe.nom); }
                    if (pe.prenom) { nameParts.push(pe.prenom); }
                    var full = nameParts.join(" ");
                    var isPartTime = !!pe.quotite && pe.quotite !== "100%";
                    var subParts = [];
                    if (pe.fonction) { subParts.push(esc(pe.fonction)); }
                    if (pe.quotite) {
                        subParts.push(isPartTime ? "<strong>" + esc(pe.quotite) + "</strong>" : esc(pe.quotite));
                    }
                    if (pe.niveaux) { subParts.push(esc(pe.niveaux)); }
                    var h = '<div class="pe-name">' + (full ? esc(full) : DASH) + "</div>";
                    if (pe.mail) { h += '<div class="pe-sub">' + esc(pe.mail) + "</div>"; }
                    if (subParts.length) { h += '<div class="pe-sub">' + subParts.join(DOT) + "</div>"; }
                    return h;
                }
                var value = cellValue(col, row);
                if (col.kind === "autres") {
                    var au = computeAutres(value, pe.laicite, pe.cps);
                    return tag(au.text, au.warn);
                }
                if (col.kind === "plain") { return plainList(value); }
                return tag(value, false);
            }

            // Un bloc par module suivi par au moins un enseignant de l'ecole, dans
            // l'ordre MODULE_ORDER : « Laicite (2 PE) : » puis ses dates.
            function renderPrintModules(sc) {
                var counts = {};
                sc.pe.forEach(function (pe) {
                    (pe.modules || []).forEach(function (m) { counts[m] = (counts[m] || 0) + 1; });
                });
                return MODULE_ORDER.filter(function (m) { return counts[m]; }).map(function (m) {
                    return '<div class="print-field print-dates"><span class="print-field-label">' +
                        esc(m + " (" + counts[m] + " PE)") + " :</span> " +
                        '<div class="print-field-value">' + moduleDatesHtml(m) + "</div></div>";
                }).join("");
            }

            function renderPrintSchool(sc, opts) {
                var row = rowFor(sc, opts.year);
                var yearLabel = opts.year || T_NOYEAR;
                var meta = [];
                if (sc.uai) { meta.push(sc.uai); }
                if (sc.circo) { meta.push(sc.circo); }
                var h = [];
                h.push('<section class="print-school">');
                h.push('<header class="print-head"><h2>');
                h.push(sc.ecole ? esc(sc.ecole) : ("UAI " + esc(sc.uai || "?")));
                h.push("</h2>");
                if (meta.length) { h.push('<div class="print-meta">' + esc(meta.join(DOT)) + "</div>"); }
                if (row === null) {
                    h.push('<div class="print-mod print-missing">' + esc("Aucune donnée " + TH_TABLE + " pour " + yearLabel) + DOT + sc.pe.length + " PE</div>");
                } else {
                    h.push('<div class="print-mod">' + esc(yearLabel) + DOT + sc.pe.length + " PE</div>");
                }
                for (var f = 0; f < opts.headerCols.length; f++) {
                    var hc = opts.headerCols[f];
                    if (hc.type === "modules") {
                        h.push(renderPrintModules(sc));
                        continue;
                    }
                    if (row === null) { continue; }
                    var value = formatValue(source.data[hc.source][row], hc.type);
                    if (hc.type === "Dates") {
                        h.push('<div class="print-field print-dates"><span class="print-field-label">' + esc(hc.label) + " :</span> ");
                        h.push('<div class="print-field-value">' + (value ? D.toHtml(value, esc) : esc(D.EMPTY_TEXT)) + "</div></div>");
                        continue;
                    }
                    h.push('<div class="print-field"><span class="print-field-label">' + esc(hc.label) + " :</span> ");
                    h.push(value ? '<span class="print-field-value">' + esc(value) + "</span>" : DASH);
                    h.push("</div>");
                }
                h.push("</header>");
                if (sc.pe.length === 0) {
                    h.push('<div class="no-pe">' + esc(T_NOPE) + "</div>");
                } else if (opts.tableCols.length) {
                    var w = printColWidths(opts.tableCols, sc, row);
                    h.push("<table><colgroup>");
                    for (var c = 0; c < w.length; c++) { h.push('<col style="width:' + w[c] + '%">'); }
                    h.push("</colgroup><thead><tr>");
                    for (var t = 0; t < opts.tableCols.length; t++) { h.push("<th>" + esc(opts.tableCols[t].label) + "</th>"); }
                    h.push("</tr></thead><tbody>");
                    for (var i = 0; i < sc.pe.length; i++) {
                        var pe = sc.pe[i];
                        var isPartTime = !!pe.quotite && pe.quotite !== "100%";
                        h.push(isPartTime ? '<tr class="quotite-partial">' : "<tr>");
                        for (var k = 0; k < opts.tableCols.length; k++) {
                            h.push("<td>" + renderPrintCell(opts.tableCols[k], pe, row) + "</td>");
                        }
                        h.push("</tr>");
                    }
                    h.push("</tbody></table>");
                }
                h.push("</section>");
                return h.join("");
            }

            // ---------- Modale d'export ----------

            function exportEl(id) { return document.getElementById(id); }

            function setExportStatus(message, isError) {
                var st = exportEl("export-status");
                st.textContent = message || "";
                st.hidden = !message;
                st.classList.toggle("error", !!isError);
            }

            function makeCheckbox(container, id, label, checked, isDefault) {
                var row = document.createElement("label");
                row.className = "export-check";
                var box = document.createElement("input");
                box.type = "checkbox";
                box.value = id;
                box.checked = checked;
                box.setAttribute("data-default", isDefault ? "1" : "0");
                var span = document.createElement("span");
                span.textContent = label;
                row.appendChild(box);
                row.appendChild(span);
                container.appendChild(row);
            }

            function fillExportForm(vis) {
                exportEl("export-year").textContent = (selectedYear || T_NOYEAR) + " — " + vis.length + " " + T_ECOLES;

                var tableBox = exportEl("export-cols-table");
                var headerBox = exportEl("export-cols-header");
                tableBox.replaceChildren();
                headerBox.replaceChildren();
                TABLE_COLS.forEach(function (c) { makeCheckbox(tableBox, c.id, c.label, true, true); });
                source.headerCols.forEach(function (c) { makeCheckbox(headerBox, c.id, c.label, c.checked, c.checked); });
            }

            function exportBoxes() {
                return Array.prototype.slice.call(document.querySelectorAll("#export-form input[type=checkbox]"));
            }

            async function openExportDialog() {
                if (exportBusy) { return; }
                if (filterSchools(document.getElementById("search-input").value).length === 0) { return; }
                closeSugg();
                exportBusy = true;
                exportEl("export-fields").hidden = true;
                exportEl("export-go").disabled = true;
                setExportStatus("Chargement des colonnes de " + TH_TABLE + "…");
                exportEl("export-overlay").hidden = false;
                exportEl("export-cancel").focus();
                try {
                    // Relecture : Thematiques et Autres_modules ont pu changer depuis l'ouverture.
                    await refreshSource(true);
                    var vis = filterSchools(document.getElementById("search-input").value);
                    fillExportForm(vis);
                    setExportStatus("");
                    exportEl("export-fields").hidden = false;
                    exportEl("export-go").disabled = vis.length === 0;
                    var firstBox = exportBoxes()[0];
                    if (firstBox) { firstBox.focus(); }
                } catch (err) {
                    setExportStatus("Lecture de " + TH_TABLE + " impossible : " + (err && err.message ? err.message : "erreur inconnue") +
                        ". Le widget doit disposer d'un accès complet au document.", true);
                } finally {
                    exportBusy = false;
                }
            }

            function closeExportDialog() {
                exportEl("export-overlay").hidden = true;
                document.getElementById("btn-pdf").focus();
            }

            function runExport() {
                if (!source) { return; }
                var vis = filterSchools(document.getElementById("search-input").value);
                if (vis.length === 0) { closeExportDialog(); return; }
                var checked = {};
                exportBoxes().forEach(function (b) { if (b.checked) { checked[b.value] = true; } });
                var opts = {
                    year: selectedYear || "",
                    tableCols: TABLE_COLS.filter(function (c) { return checked[c.id]; }),
                    headerCols: source.headerCols.filter(function (c) { return checked[c.id]; })
                };
                var parts = [];
                for (var i = 0; i < vis.length; i++) { parts.push(renderPrintSchool(vis[i], opts)); }
                document.getElementById("print-root").innerHTML = parts.join("");
                closeExportDialog();
                window.print();
            }

            function bindExportDialog() {
                var overlay = exportEl("export-overlay");
                exportEl("export-form").addEventListener("submit", function (e) {
                    e.preventDefault();
                    runExport();
                });
                exportEl("export-cancel").addEventListener("click", closeExportDialog);
                exportEl("export-all").addEventListener("click", function () {
                    exportBoxes().forEach(function (b) { b.checked = true; });
                });
                exportEl("export-none").addEventListener("click", function () {
                    exportBoxes().forEach(function (b) { b.checked = false; });
                });
                exportEl("export-default").addEventListener("click", function () {
                    exportBoxes().forEach(function (b) { b.checked = b.getAttribute("data-default") === "1"; });
                });
                overlay.addEventListener("mousedown", function (e) {
                    if (e.target === overlay) { closeExportDialog(); }
                });
                overlay.addEventListener("keydown", function (e) {
                    if (e.key === "Escape") {
                        e.preventDefault();
                        closeExportDialog();
                    } else if (e.key === "Tab") {
                        var items = Array.prototype.filter.call(
                            overlay.querySelectorAll("button, select, input"),
                            function (el) { return !el.disabled && el.offsetParent !== null; }
                        );
                        if (!items.length) { return; }
                        var first = items[0];
                        var last = items[items.length - 1];
                        if (e.shiftKey && document.activeElement === first) {
                            e.preventDefault();
                            last.focus();
                        } else if (!e.shiftKey && document.activeElement === last) {
                            e.preventDefault();
                            first.focus();
                        }
                    }
                });
            }

            function render() {
                var listEl = document.getElementById("list");
                var cntEl = document.getElementById("count-info");
                var q = document.getElementById("search-input").value;
                if (schools.length === 0) {
                    listEl.innerHTML = '<div class="empty-state">' + esc(T_NODATA) + "</div>";
                    cntEl.textContent = "";
                    return;
                }
                var vis = filterSchools(q);
                if (vis.length === 0) {
                    listEl.innerHTML = '<div class="empty-state">' + esc(T_NORES) + "</div>";
                    cntEl.textContent = "0 " + T_ECOLE;
                    return;
                }
                var parts = [];
                for (var i = 0; i < vis.length; i++) { parts.push(renderSchool(vis[i])); }
                listEl.innerHTML = parts.join("");
                var total = 0;
                for (var j = 0; j < vis.length; j++) { total += vis[j].pe.length; }
                cntEl.textContent = vis.length + " " + T_ECOLES + DOT + total + " PE" +
                    (sourceError ? DOT + TH_TABLE + " illisible : valeurs de Liste_PE" : "");
            }

            // ---------- Annee scolaire ----------

            function fillYearSelect() {
                var sel = document.getElementById("year-select");
                var years = {};
                (source ? source.years : []).forEach(function (y) { years[y] = true; });
                if (recordsHaveYear(allRecords)) {
                    allRecords.forEach(function (r) { years[txt(r[TH_YEAR])] = true; });
                }
                var list = sortYears(Object.keys(years));
                sel.replaceChildren();
                list.forEach(function (y) {
                    var opt = document.createElement("option");
                    opt.value = y;
                    opt.textContent = y || T_NOYEAR;
                    sel.appendChild(opt);
                });
                if (list.indexOf(selectedYear) === -1) {
                    // Par defaut : l'annee scolaire en cours si elle existe, sinon la plus ancienne.
                    var current = D.currentSchoolYear();
                    var firstNamed = list.filter(Boolean)[0];
                    selectedYear = list.indexOf(current) !== -1 ? current : (firstNamed !== undefined ? firstNamed : (list.length ? list[0] : null));
                }
                sel.disabled = list.length === 0;
                if (selectedYear !== null) { sel.value = selectedYear; }
            }

            function rebuild() {
                fillYearSelect();
                schools = buildSchools(allRecords);
                render();
            }

            // Relit Thematiques et Autres_modules. strict : l'erreur est relancee
            // (modale d'export) ; sinon le widget se rabat sur les formules de Liste_PE.
            async function refreshSource(strict) {
                var seq = ++sourceSeq;
                try {
                    var loaded = await loadSource();
                    if (seq !== sourceSeq) { return; }
                    source = loaded;
                    sourceError = "";
                } catch (err) {
                    if (seq !== sourceSeq) { return; }
                    source = null;
                    sourceError = err && err.message ? err.message : "erreur inconnue";
                    console.warn("Lecture de " + TH_TABLE + " impossible : " + sourceError);
                    rebuild();
                    if (strict) { throw err; }
                    return;
                }
                rebuild();
            }

            function renderSuggestions() {
                var box = document.getElementById("suggestions");
                if (suggestions.length === 0) {
                    box.style.display = "none";
                    box.innerHTML = "";
                    return;
                }
                var parts = [];
                for (var i = 0; i < suggestions.length; i++) {
                    var sc = suggestions[i];
                    var label = sc.ecole || ("UAI " + sc.uai);
                    var subArr = [];
                    if (sc.uai) { subArr.push("UAI " + sc.uai); }
                    if (sc.circo) { subArr.push(sc.circo); }
                    var sub = subArr.join(DOT);
                    var cls = "sugg-item";
                    if (i === suggIndex) { cls += " active"; }
                    var h = '<div class="' + cls + '" data-key="' + esc(sc.key) + '" role="option">' + esc(label);
                    if (sub) { h += '<span class="sugg-sub">' + esc(sub) + "</span>"; }
                    h += "</div>";
                    parts.push(h);
                }
                box.innerHTML = parts.join("");
                box.style.display = "block";
            }

            function closeSugg() {
                suggestions = [];
                suggIndex = -1;
                renderSuggestions();
            }

            function selectSchool(key) {
                var sc = null;
                for (var i = 0; i < schools.length; i++) {
                    if (schools[i].key === key) { sc = schools[i]; break; }
                }
                if (!sc) { return; }
                var input = document.getElementById("search-input");
                input.value = sc.ecole || ("UAI " + sc.uai);
                document.getElementById("search-clear").style.display = "block";
                openKeys[key] = true;
                targetKey = key;
                closeSugg();
                render();
                var node = document.querySelector('.school[data-key="' + CSS.escape(key) + '"]');
                if (node) { node.scrollIntoView({ behavior: "smooth", block: "start" }); }
            }

            function toggleKey(key) {
                if (openKeys[key]) { delete openKeys[key]; } else { openKeys[key] = true; }
                render();
            }

            function bind() {
                var input = document.getElementById("search-input");
                var clear = document.getElementById("search-clear");
                var box = document.getElementById("suggestions");
                var listEl = document.getElementById("list");

                input.addEventListener("input", function () {
                    clear.style.display = input.value ? "block" : "none";
                    targetKey = null;
                    suggestions = buildSuggestions(input.value);
                    suggIndex = -1;
                    renderSuggestions();
                    render();
                });

                input.addEventListener("keydown", function (e) {
                    if (e.key === "Escape") { closeSugg(); return; }
                    if (suggestions.length === 0) { return; }
                    if (e.key === "ArrowDown") {
                        e.preventDefault();
                        suggIndex = (suggIndex + 1) % suggestions.length;
                        renderSuggestions();
                    } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        suggIndex = (suggIndex - 1 + suggestions.length) % suggestions.length;
                        renderSuggestions();
                    } else if (e.key === "Enter") {
                        e.preventDefault();
                        var idx = suggIndex >= 0 ? suggIndex : 0;
                        if (suggestions[idx]) { selectSchool(suggestions[idx].key); }
                    }
                });

                input.addEventListener("focus", function () {
                    if (input.value) {
                        suggestions = buildSuggestions(input.value);
                        suggIndex = -1;
                        renderSuggestions();
                    }
                });

                clear.addEventListener("click", function () {
                    input.value = "";
                    clear.style.display = "none";
                    targetKey = null;
                    closeSugg();
                    render();
                    input.focus();
                });

                box.addEventListener("mousedown", function (e) {
                    var item = e.target.closest(".sugg-item");
                    if (!item) { return; }
                    e.preventDefault();
                    selectSchool(item.getAttribute("data-key"));
                });

                listEl.addEventListener("click", function (e) {
                    var head = e.target.closest(".school-head");
                    if (!head) { return; }
                    toggleKey(head.getAttribute("data-toggle"));
                });

                listEl.addEventListener("keydown", function (e) {
                    if (e.key !== "Enter" && e.key !== " ") { return; }
                    var head = e.target.closest(".school-head");
                    if (!head) { return; }
                    e.preventDefault();
                    toggleKey(head.getAttribute("data-toggle"));
                });

                document.getElementById("btn-expand").addEventListener("click", function () {
                    var vis = filterSchools(input.value);
                    for (var i = 0; i < vis.length; i++) { openKeys[vis[i].key] = true; }
                    render();
                });

                document.getElementById("btn-collapse").addEventListener("click", function () {
                    openKeys = {};
                    targetKey = null;
                    render();
                });

                document.getElementById("year-select").addEventListener("change", function (e) {
                    selectedYear = e.target.value;
                    rebuild();
                });

                document.getElementById("btn-pdf").addEventListener("click", openExportDialog);
                bindExportDialog();

                window.addEventListener("afterprint", function () {
                    document.getElementById("print-root").innerHTML = "";
                });

                document.addEventListener("mousedown", function (e) {
                    if (!e.target.closest("#search-wrap")) { closeSugg(); }
                });
            }

            function init() {
                bind();
                grist.ready({ requiredAccess: "full" });
                grist.onRecords(function (records) {
                    allRecords = Array.isArray(records) ? records : [];
                    // Affichage immediat avec les donnees deja lues, puis relecture.
                    if (source || sourceError) { rebuild(); }
                    refreshSource(false);
                });
            }

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", init);
            } else {
                init();
            }
        })();
