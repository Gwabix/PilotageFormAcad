        (function () {
            "use strict";

            var T_LAICITE = "La\u00EFcit\u00E9";
            var T_LAICITE6 = "La\u00EFcit\u00E9 (6h)";
            var T_CPS = "CPS";
            var T_CPS6 = "CPS (6h)";
            var T_PFM = "Plan Filles et Maths";
            var T_PFM_CPS = "Plan Filles et Maths ou CPS";
            var T_EVAL = "\u00C9valuation d'\u00E9cole";
            var T_NOMOD = "Modalit\u00E9 non renseign\u00E9e";
            var T_NOPE = "Aucun PE rattach\u00E9 \u00E0 cette \u00E9cole.";
            var T_NORES = "Aucune \u00E9cole ne correspond \u00E0 votre recherche.";
            var T_NODATA = "Aucune donn\u00E9e disponible.";
            var T_ECOLE = "\u00E9cole";
            var T_ECOLES = "\u00E9cole(s)";
            var T_FR = "Fran\u00E7ais";
            var CHEV = "\u25B6";
            var DOT = " \u00B7 ";
            var DASH = '<span class="cell-empty">&mdash;</span>';

            var schools = [];
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

            function computeAutres(base, laicite, cps) {
                if (base === T_PFM_CPS) {
                    if (laicite === false) { return { text: T_LAICITE, warn: false }; }
                    if (cps === false) { return { text: T_CPS, warn: false }; }
                    return { text: T_PFM, warn: false };
                }
                if (base === T_EVAL) {
                    if (laicite === false) { return { text: T_LAICITE, warn: false }; }
                    return { text: T_EVAL, warn: false };
                }
                if (laicite === false) {
                    return { text: base ? base + " + " + T_LAICITE6 : T_LAICITE6, warn: true };
                }
                if (cps === false) {
                    return { text: base ? base + " + " + T_CPS6 : T_CPS6, warn: true };
                }
                return { text: base, warn: false };
            }

            function buildSchools(records) {
                var map = {};
                var order = [];
                for (var i = 0; i < records.length; i++) {
                    var rec = records[i];
                    var modaliteVal = txt(rec.Modalite);
                    if (!modaliteVal) { continue; }
                    var uai = rec.UAI;
                    var ecole = txt(rec.Ecole);
                    var hasUai = (uai !== null && uai !== undefined && uai !== 0 && uai !== "");
                    var key = hasUai ? ("u" + String(uai)) : ("l" + (norm(ecole) || "none"));
                    if (!map[key]) {
                        map[key] = { key: key, uai: hasUai ? String(uai) : "", ecole: ecole, circo: txt(rec.Circonscription), dept: txt(rec.Departement), modalite: modaliteVal, pe: [] };
                        order.push(key);
                    }
                    var sc = map[key];
                    if (!sc.ecole) { sc.ecole = ecole; }
                    if (!sc.circo) { sc.circo = txt(rec.Circonscription); }
                    if (!sc.dept) { sc.dept = txt(rec.Departement); }
                    if (!sc.modalite) { sc.modalite = modaliteVal; }
                    var lai = toBool(rec.Laicite_OK);
                    var cps = toBool(rec.CPS_OK);
                    var au = computeAutres(txt(rec.Autres), lai, cps);
                    sc.pe.push({ id: rec.id, civilite: txt(rec.Civilite), nom: txt(rec.Nom), prenom: txt(rec.Prenom), mail: txt(rec.Mail), fonction: txt(rec.Fonction), quotite: txt(rec.Quotite_de_service), niveaux: txt(rec.Niveau_x_), francais: txt(rec.Francais), maths: txt(rec.Maths), autres: au.text, warn: au.warn });
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
                    s.search = norm([s.ecole, s.uai, s.circo, s.dept, s.modalite].join(" "));
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
                h.push("<td>" + tag(pe.autres, pe.warn) + "</td></tr>");
                return h.join("");
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
                    th.push("</tr></thead><tbody>");
                    th.push(rows.join(""));
                    th.push("</tbody></table>");
                    body = th.join("");
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
                cntEl.textContent = vis.length + " " + T_ECOLES + DOT + total + " PE";
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

                document.addEventListener("mousedown", function (e) {
                    if (!e.target.closest("#search-wrap")) { closeSugg(); }
                });
            }

            function init() {
                bind();
                grist.ready({ requiredAccess: "read table" });
                grist.onRecords(function (records) {
                    schools = buildSchools(Array.isArray(records) ? records : []);
                    render();
                });
            }

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", init);
            } else {
                init();
            }
        })();
