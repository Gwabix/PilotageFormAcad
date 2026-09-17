(function () {
    "use strict";

    var TABLE_ID = "Thematiques";
    var ECOLES_TABLE_ID = "Ecoles";
    var COL_ECOLE = "Ecole";
    var COL_ANNEE = "Annee_du_Plan";
    var COL_REGROUPEMENT = "Regroupement";
    var COL_ANNEE_SCOLAIRE = "Annee_scolaire";
    var SCHOOL_YEAR_RE = /^(\d{4})-(\d{4})$/;
    var YEAR_PREFIX = "Année ";
    var YEAR_RE = /^Ann[ée]e\s+(\d+)$/i;
    // Choix des colonnes Annee_du_Plan (Année 0 à 4) et Modalite, recopiés du document.
    // Pas de lecture de _grist_Tables_column : les tables _grist_* suivent les règles
    // par défaut, qui refusent la lecture aux non-propriétaires. À tenir à jour à la main.
    var YEAR_COUNT = 4;
    var MODALITE_CHOICES = [
        "Accompagnement de proximité",
        "Résidence pédagogique",
        "Constellation",
        "Animations pédagogiques"
    ];
    // Valeur exacte interprétée par widgetLozere.js : ne jamais la retaper à la main.
    var AUTRE_CHOICE = "Santé mentale / VSS ou CPS";

    // Commune à toute l'école : affichée sous son nom, écrite sur chacune de ses années.
    var CT_FIELD = { colId: "Competence_fil_rouge", label: "Compétence fil rouge", kind: "text" };
    var MODALITE_FIELD = { colId: "Modalite", label: "Modalité", kind: "modalite" };
    var FIELDS = [
        { colId: "Francais", label: "Français", kind: "text" },
        { colId: "Mathematiques", label: "Mathématiques", kind: "text" },
        { colId: "Autre", label: "Autre", kind: "autre" }
    ];
    // Colonnes affichées en lecture dans les fenêtres « Année 0 » et « année du Plan » ;
    // une ligne qui en a au moins une de remplie « contient des données ».
    var INFO_FIELDS = [
        CT_FIELD,
        MODALITE_FIELD,
        { colId: COL_REGROUPEMENT, label: "Regroupement" },
        FIELDS[0],
        FIELDS[1],
        FIELDS[2],
        { colId: "Formateur_s_", label: "Formateur(s)" },
        { colId: "Notes_pour_plus_tard", label: "Notes pour plus tard" }
    ];
    var PLAN_CHOICES = [0, 1];
    var RECORD_COLUMNS = [COL_ANNEE_SCOLAIRE].concat(INFO_FIELDS.map(function (f) {
        return f.colId;
    }));

    var searchInput = document.getElementById("search-input");
    var searchClearBtn = document.getElementById("search-clear");
    var dropdown = document.getElementById("dropdown");
    var statusMsg = document.getElementById("status-msg");
    var timelineContainer = document.getElementById("timeline-container");
    var schoolTitle = document.getElementById("school-title");
    var ctSlot = document.getElementById("ct-slot");
    var timeline = document.getElementById("timeline");
    var editOverlay = document.getElementById("edit-overlay");
    var editTitle = document.getElementById("edit-title");
    var editContextEl = document.getElementById("edit-context");
    var editAutreZone = document.getElementById("edit-autre-zone");
    var editAutreChoice = document.getElementById("edit-autre-choice");
    var editInput = document.getElementById("edit-input");
    var editModalite = document.getElementById("edit-modalite");
    var editError = document.getElementById("edit-error");
    var editCancelBtn = document.getElementById("edit-cancel");
    var editSaveBtn = document.getElementById("edit-save");
    var infoOverlay = document.getElementById("info-overlay");
    var infoTitle = document.getElementById("info-title");
    var infoContextEl = document.getElementById("info-context");
    var infoFields = document.getElementById("info-fields");
    var infoEdit = document.getElementById("info-edit");
    var infoPlan = document.getElementById("info-plan");
    var infoSelect = document.getElementById("info-plan-select");
    var infoError = document.getElementById("info-error");
    var infoCancelBtn = document.getElementById("info-cancel");
    var infoSaveBtn = document.getElementById("info-save");

    var schools = [];
    var schoolsById = {};
    var currentSchoolId = null;
    var filteredSchools = [];
    var activeIndex = -1;
    var loadSeq = 0;
    var editContext = null;
    var isSaving = false;
    var lastTriggerKey = null;
    var statusTimer = null;
    var statusTransient = false;
    var rawThematiques = null;
    var rawEcoles = null;
    var infoContext = null;

    editAutreChoice.textContent = AUTRE_CHOICE;

    // ---------- Outils ----------

    function text(value) {
        if (value === null || value === undefined) return "";
        return String(value);
    }

    function trimmed(value) {
        return text(value).trim();
    }

    function parseYear(value) {
        var m = trimmed(value).match(YEAR_RE);
        return m ? parseInt(m[1], 10) : null;
    }

    function compareNames(left, right) {
        return left.localeCompare(right, "fr", { sensitivity: "base", numeric: true });
    }

    function setStatus(message, transient) {
        clearTimeout(statusTimer);
        statusTransient = !!transient;
        statusMsg.textContent = message;
        statusMsg.hidden = !message;
        if (transient) {
            statusTimer = setTimeout(function () {
                statusTransient = false;
                statusMsg.hidden = true;
            }, 3000);
        }
    }

    function idleStatus() {
        if (schools.length > 0) {
            return schools.length + " école(s) dans la table " + TABLE_ID + ". Recherchez une école ci-dessus.";
        }
        return "Aucune école dans la table " + TABLE_ID + ".";
    }

    // ---------- Chargement des données ----------

    // Première année d'une année scolaire « 2026-2027 », sinon null.
    function schoolYearStart(value) {
        var m = trimmed(value).match(SCHOOL_YEAR_RE);
        if (!m || parseInt(m[2], 10) !== parseInt(m[1], 10) + 1) return null;
        return parseInt(m[1], 10);
    }

    function hasData(rec) {
        return INFO_FIELDS.some(function (f) {
            return !!trimmed(rec[f.colId]);
        });
    }

    // Les lignes arrivent par identifiant croissant, années renseignées d'abord :
    // une place déjà prise garde sa ligne (la plus ancienne, ou celle renseignée).
    function placeRow(school, n, rec) {
        var slot = n === 0 ? school.zero : school.years[n];
        if (slot) {
            if (!rec.inferred) {
                console.warn("Plusieurs lignes pour " + school.name + ", " + YEAR_PREFIX + n +
                    " : lignes " + slot.id + " et " + rec.id + ". La plus ancienne est affichée.");
            }
            return;
        }
        if (n === 0) {
            school.zero = rec;
        } else {
            school.years[n] = rec;
        }
    }

    // Range les lignes d'une école par année du Plan. Une ligne sans année du Plan
    // mais avec une année scolaire prend celle déduite de la ligne renseignée la plus
    // proche : Année 1 en 2026-2027 et ligne 2027-2028 donnent Année 2.
    function placeRows(school) {
        var rows = school.rows.slice().sort(function (a, b) {
            return a.id - b.id;
        });
        var anchors = rows.filter(function (rec) {
            return rec.planYear !== null;
        });
        school.pending = anchors.length === 0;

        anchors.forEach(function (rec) {
            placeRow(school, rec.planYear, rec);
        });

        var dated = anchors.filter(function (rec) {
            return rec.start !== null;
        });
        rows.forEach(function (rec) {
            if (rec.planYear !== null || rec.start === null || dated.length === 0) return;
            var best = dated[0];
            dated.forEach(function (a) {
                if (Math.abs(a.start - rec.start) < Math.abs(best.start - rec.start)) best = a;
            });
            var n = best.planYear + (rec.start - best.start);
            if (n < 0) return;
            rec.inferred = true;
            placeRow(school, n, rec);
        });
    }

    function buildSchools(thematiques, ecoles) {
        var names = {};
        var uais = {};
        var ecoleIds = ecoles.id || [];
        for (var i = 0; i < ecoleIds.length; i += 1) {
            names[ecoleIds[i]] = trimmed(ecoles.Commune_Nom && ecoles.Commune_Nom[i]) ||
                trimmed(ecoles.Nom_etablissement && ecoles.Nom_etablissement[i]);
            uais[ecoleIds[i]] = trimmed(ecoles.Identifiant_de_l_etablissement && ecoles.Identifiant_de_l_etablissement[i]);
        }

        var byId = {};
        var ids = thematiques.id || [];
        for (var r = 0; r < ids.length; r += 1) {
            var ecoleId = thematiques[COL_ECOLE][r];
            if (typeof ecoleId !== "number" || ecoleId <= 0) continue;

            var school = byId[ecoleId];
            if (!school) {
                school = {
                    id: ecoleId,
                    name: names[ecoleId] || ("École n° " + ecoleId),
                    uai: uais[ecoleId] || "",
                    rows: [],
                    years: {},
                    zero: null,
                    pending: true
                };
                byId[ecoleId] = school;
            }

            var rec = { id: ids[r], planYear: parseYear(thematiques[COL_ANNEE][r]), inferred: false };
            RECORD_COLUMNS.forEach(function (colId) {
                rec[colId] = thematiques[colId] ? thematiques[colId][r] : null;
            });
            rec.start = schoolYearStart(rec[COL_ANNEE_SCOLAIRE]);
            school.rows.push(rec);
        }

        Object.keys(byId).forEach(function (k) {
            placeRows(byId[k]);
        });

        schoolsById = byId;
        schools = Object.keys(byId).map(function (k) {
            return byId[k];
        }).sort(function (a, b) {
            return compareNames(a.name, b.name);
        });
    }

    async function loadData() {
        var seq = ++loadSeq;
        try {
            var results = await Promise.all([
                grist.docApi.fetchTable(TABLE_ID),
                grist.docApi.fetchTable(ECOLES_TABLE_ID)
            ]);
            if (seq !== loadSeq) return;

            var thematiques = results[0];
            if (!thematiques[COL_ECOLE] || !thematiques[COL_ANNEE]) {
                setStatus("Colonnes « " + COL_ECOLE + " » ou « " + COL_ANNEE + " » introuvables dans la table " + TABLE_ID + ".");
                return;
            }
            rawThematiques = thematiques;
            rawEcoles = results[1];
            buildSchools(rawThematiques, rawEcoles);
        } catch (err) {
            if (seq !== loadSeq) return;
            setStatus("Impossible de lire les données : " + (err && err.message ? err.message : "erreur inconnue") +
                ". Le widget doit disposer d'un accès complet au document.");
            return;
        }

        refreshView();
        if (dropdown.classList.contains("open")) {
            renderDropdown();
        }
    }

    // Réaffiche l'école en cours après un chargement. Une école sans année du Plan
    // n'a pas de frise ; sa fenêtre de choix ne s'ouvre qu'à la sélection.
    function refreshView() {
        var school = currentSchoolId !== null ? schoolsById[currentSchoolId] : null;
        if (school && !school.pending) {
            renderTimeline();
            return;
        }
        if (currentSchoolId !== null && !(school && infoContext && infoContext.schoolId === school.id)) {
            hideTimeline();
        }
        if (!school) {
            setStatus(idleStatus());
        }
    }

    // Reporte des actions acceptées par Grist dans les données chargées, puis reconstruit les écoles.
    function applyToRaw(actions, result) {
        var retValues = result && result.retValues ? result.retValues : [];
        actions.forEach(function (action, i) {
            var fields = action[3];
            if (action[0] === "UpdateRecord") {
                var idx = rawThematiques.id.indexOf(action[2]);
                if (idx === -1) return;
                Object.keys(fields).forEach(function (colId) {
                    if (rawThematiques[colId]) rawThematiques[colId][idx] = fields[colId];
                });
            } else if (action[0] === "AddRecord") {
                Object.keys(rawThematiques).forEach(function (colId) {
                    if (colId === "id") {
                        rawThematiques.id.push(retValues[i]);
                    } else {
                        rawThematiques[colId].push(Object.prototype.hasOwnProperty.call(fields, colId) ? fields[colId] : null);
                    }
                });
            }
        });
        buildSchools(rawThematiques, rawEcoles);
    }

    // ---------- Recherche ----------

    function highlight(container, label, query) {
        var q = query.toLowerCase();
        var lower = label.toLowerCase();
        var pos = q ? lower.indexOf(q) : -1;
        if (pos === -1 || lower.length !== label.length) {
            container.textContent = label;
            return;
        }
        container.appendChild(document.createTextNode(label.slice(0, pos)));
        var mark = document.createElement("mark");
        mark.textContent = label.slice(pos, pos + q.length);
        container.appendChild(mark);
        container.appendChild(document.createTextNode(label.slice(pos + q.length)));
    }

    function renderDropdown() {
        var query = trimmed(searchInput.value);
        var q = query.toLowerCase();
        filteredSchools = schools.filter(function (s) {
            return s.name.toLowerCase().indexOf(q) !== -1 || (q && s.uai.toLowerCase().indexOf(q) !== -1);
        });

        dropdown.replaceChildren();
        activeIndex = -1;

        if (filteredSchools.length === 0) {
            var noResult = document.createElement("div");
            noResult.id = "no-result";
            noResult.textContent = schools.length ? "Aucun résultat" : "Aucune école";
            dropdown.appendChild(noResult);
        } else {
            filteredSchools.forEach(function (school, i) {
                var item = document.createElement("div");
                item.className = "dropdown-item";
                item.id = "school-option-" + i;
                item.setAttribute("role", "option");
                item.setAttribute("aria-selected", "false");
                highlight(item, school.name, query);
                item.addEventListener("mousedown", function (evt) {
                    evt.preventDefault();
                    selectSchool(school);
                });
                dropdown.appendChild(item);
            });
            activeIndex = 0;
            updateActiveItem();
        }

        dropdown.classList.add("open");
        searchInput.setAttribute("aria-expanded", "true");
    }

    function closeDropdown() {
        dropdown.classList.remove("open");
        searchInput.setAttribute("aria-expanded", "false");
        searchInput.removeAttribute("aria-activedescendant");
        activeIndex = -1;
    }

    function updateActiveItem() {
        var items = dropdown.querySelectorAll(".dropdown-item");
        items.forEach(function (item, i) {
            var active = i === activeIndex;
            item.classList.toggle("active", active);
            item.setAttribute("aria-selected", active ? "true" : "false");
            if (active) {
                item.scrollIntoView({ block: "nearest" });
                searchInput.setAttribute("aria-activedescendant", item.id);
            }
        });
    }

    function updateSearchClearButton() {
        searchClearBtn.classList.toggle("visible", trimmed(searchInput.value).length > 0);
    }

    function selectSchool(school) {
        currentSchoolId = school.id;
        searchInput.value = school.name;
        updateSearchClearButton();
        closeDropdown();
        if (school.pending) {
            hideTimeline();
            currentSchoolId = school.id;
            openPlanDialog(school);
        } else {
            renderTimeline();
        }
    }

    function hideTimeline() {
        currentSchoolId = null;
        timelineContainer.hidden = true;
        timeline.replaceChildren();
        ctSlot.replaceChildren();
        schoolTitle.textContent = "";
    }

    // ---------- Frise ----------

    function fieldKey(year, colId) {
        return (year === null ? "ecole" : year) + ":" + colId;
    }

    function sortedYearRecords(school) {
        return Object.keys(school.years).map(function (k) {
            return parseInt(k, 10);
        }).sort(function (a, b) {
            return a - b;
        }).map(function (y) {
            return school.years[y];
        });
    }

    // Rapproche les saisies qui ne diffèrent que par la casse, les accents,
    // les espaces, les apostrophes ou la ponctuation finale.
    function normalizeLoose(value) {
        return trimmed(value)
            .normalize("NFD").replace(/[̀-ͯ]/g, "")
            .toLowerCase()
            .replace(/[’‘`´]/g, "'")
            .replace(/[‐‑–—]/g, "-")
            .replace(/\s+/g, " ")
            .replace(/[\s.;:!]+$/, "")
            .trim();
    }

    // Compétence fil rouge de l'école : entrées de chaque année, dans l'ordre
    // chronologique, découpées sur les virgules et dédoublonnées.
    function schoolFilRouge(school) {
        var items = [];
        var seen = {};
        var distinct = {};
        sortedYearRecords(school).forEach(function (rec) {
            var whole = normalizeLoose(rec[CT_FIELD.colId]);
            if (whole) distinct[whole] = true;
            text(rec[CT_FIELD.colId]).split(/[,\n]/).forEach(function (part) {
                var label = part.replace(/\s+/g, " ").trim();
                var key = normalizeLoose(label);
                if (key && !seen[key]) {
                    seen[key] = true;
                    items.push(label);
                }
            });
        });
        return { text: items.join(", "), consistent: Object.keys(distinct).length <= 1 };
    }

    function renderFilRouge(school) {
        var ct = schoolFilRouge(school);
        ctSlot.replaceChildren();

        var btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.key = fieldKey(null, CT_FIELD.colId);
        btn.addEventListener("click", function () {
            openEditDialog(school, null, CT_FIELD);
        });

        if (ct.text) {
            btn.className = "ct-value";
            btn.textContent = ct.text;
            btn.setAttribute("aria-label", "Modifier " + CT_FIELD.label + " : " + ct.text);
            if (!ct.consistent) {
                btn.title = "Saisies différentes selon les années";
            }
        } else {
            btn.className = "add-btn";
            btn.textContent = "+";
            btn.setAttribute("aria-label", "Ajouter " + CT_FIELD.label);
        }
        ctSlot.appendChild(btn);
    }

    function makeFieldButton(school, year, rec, field, className, emptyLabel) {
        var value = rec ? trimmed(rec[field.colId]) : "";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = className + (value ? "" : " is-empty");
        btn.dataset.key = fieldKey(year, field.colId);
        btn.textContent = value || emptyLabel;
        btn.setAttribute("aria-label", "Modifier " + field.label + ", " + YEAR_PREFIX + year +
            " : " + (value || "non renseigné"));
        btn.addEventListener("click", function () {
            openEditDialog(school, year, field);
        });
        return { button: btn, value: value };
    }

    function makeDomain(school, year, rec, field) {
        var value = rec ? trimmed(rec[field.colId]) : "";
        var item = document.createElement("div");
        item.className = "domain" + (value ? "" : " is-empty");

        var head = document.createElement("div");
        head.className = "domain-head";
        var label = document.createElement("span");
        label.className = "domain-label";
        label.textContent = field.label;
        head.appendChild(label);
        item.appendChild(head);

        if (value) {
            item.appendChild(makeFieldButton(school, year, rec, field, "field-value", "").button);
        } else {
            var add = document.createElement("button");
            add.type = "button";
            add.className = "add-btn";
            add.dataset.key = fieldKey(year, field.colId);
            add.textContent = "+";
            add.setAttribute("aria-label", "Ajouter " + field.label + ", " + YEAR_PREFIX + year);
            add.addEventListener("click", function () {
                openEditDialog(school, year, field);
            });
            head.appendChild(add);
        }
        return item;
    }

    function renderYear(school, year) {
        var rec = school.years[year] || null;

        var block = document.createElement("li");
        block.className = "year-block " + (year % 2 === 1 ? "above" : "below") + (rec ? "" : " is-planned");
        block.style.setProperty("--col", String(3 * year - 2));

        var axis = document.createElement("div");
        axis.className = "year-axis";
        if (year === 1 && school.zero) {
            var zero = document.createElement("button");
            zero.type = "button";
            zero.className = "zero-badge";
            zero.textContent = "0";
            zero.dataset.key = fieldKey(0, "details");
            zero.setAttribute("aria-label", "Voir la formation " + YEAR_PREFIX + "0");
            zero.title = YEAR_PREFIX + "0";
            zero.addEventListener("click", function () {
                openZeroDialog(school);
            });
            axis.appendChild(zero);
        }
        var circle = document.createElement("span");
        circle.className = "year-circle";
        circle.setAttribute("aria-hidden", "true");
        circle.textContent = String(year);
        axis.appendChild(circle);

        var card = document.createElement("section");
        card.className = "year-card";
        card.setAttribute("aria-label", YEAR_PREFIX + year);

        var label = document.createElement("h2");
        label.className = "year-label";
        label.textContent = YEAR_PREFIX + year;
        card.appendChild(label);

        var schoolYear = rec ? trimmed(rec[COL_ANNEE_SCOLAIRE]) : "";
        if (schoolYear) {
            var yearEl = document.createElement("p");
            yearEl.className = "year-school";
            yearEl.textContent = schoolYear;
            card.appendChild(yearEl);
        }

        if (!rec) {
            var hint = document.createElement("p");
            hint.className = "year-hint";
            hint.textContent = "Pas encore créée : la première saisie ajoutera cette année.";
            card.appendChild(hint);
        }

        var modalite = makeFieldButton(school, year, rec, MODALITE_FIELD, "modalite-badge", "Choisir une modalité");
        if (modalite.value && MODALITE_CHOICES.length && MODALITE_CHOICES.indexOf(modalite.value) === -1) {
            modalite.button.classList.add("is-invalid");
            modalite.button.title = "Valeur hors de la liste des modalités prévues";
        }
        card.appendChild(modalite.button);

        var regroupement = rec ? trimmed(rec[COL_REGROUPEMENT]) : "";
        if (regroupement) {
            var regEl = document.createElement("p");
            regEl.className = "regroupement";
            var regLabel = document.createElement("span");
            regLabel.className = "regroupement-label";
            regLabel.textContent = "Regroupement : ";
            regEl.appendChild(regLabel);
            regEl.appendChild(document.createTextNode(regroupement));
            card.appendChild(regEl);
        }

        var list = document.createElement("div");
        list.className = "domain-list";
        FIELDS.forEach(function (field) {
            list.appendChild(makeDomain(school, year, rec, field));
        });
        card.appendChild(list);

        block.appendChild(axis);
        block.appendChild(card);
        return block;
    }

    function renderTimeline() {
        var school = schoolsById[currentSchoolId];
        if (!school) {
            hideTimeline();
            setStatus(idleStatus());
            return;
        }

        schoolTitle.textContent = school.name;
        renderFilRouge(school);

        var maxYear = YEAR_COUNT;
        Object.keys(school.years).forEach(function (k) {
            maxYear = Math.max(maxYear, parseInt(k, 10));
        });

        var fragment = document.createDocumentFragment();
        for (var year = 1; year <= maxYear; year += 1) {
            fragment.appendChild(renderYear(school, year));
        }
        timeline.replaceChildren(fragment);
        timeline.style.setProperty("--cols", String(3 * maxYear + 1));
        timelineContainer.hidden = false;
        if (!statusTransient) {
            statusMsg.hidden = true;
        }
    }

    // ---------- Édition ----------

    function yearRecord(school, year) {
        return year === 0 ? school.zero : school.years[year];
    }

    function currentValue(ctx) {
        var school = schoolsById[ctx.schoolId];
        if (!school) return "";
        if (ctx.year === null) {
            return schoolFilRouge(school).text;
        }
        var rec = yearRecord(school, ctx.year);
        return rec ? text(rec[ctx.field.colId]) : "";
    }

    function renderModaliteChoices(selected) {
        editModalite.querySelectorAll(".choice-item, .choice-warning").forEach(function (el) {
            el.remove();
        });

        var options = [""].concat(MODALITE_CHOICES);
        options.forEach(function (choice, i) {
            var row = document.createElement("label");
            row.className = "choice-item";
            var radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "modalite";
            radio.value = choice;
            radio.id = "modalite-" + i;
            radio.checked = choice === selected;
            var span = document.createElement("span");
            span.textContent = choice || "Non renseignée";
            if (!choice) span.className = "choice-none";
            row.appendChild(radio);
            row.appendChild(span);
            editModalite.appendChild(row);
        });

        if (selected && MODALITE_CHOICES.indexOf(selected) === -1) {
            var warning = document.createElement("p");
            warning.className = "choice-warning";
            warning.textContent = "Valeur actuelle hors liste : « " + selected + " ». Choisissez l'une des modalités prévues.";
            editModalite.appendChild(warning);
        }
    }

    function syncAutreChoice() {
        editAutreChoice.setAttribute("aria-pressed", editInput.value.trim() === AUTRE_CHOICE ? "true" : "false");
    }

    function editContextText(school, year) {
        if (year !== null) {
            return school.name + " — " + YEAR_PREFIX + year +
                (yearRecord(school, year) ? "" : " (sera créée à l'enregistrement)");
        }
        var count = Object.keys(school.years).length;
        var scope = school.name + " — commune aux " + count + " année(s) existante(s)";
        if (!schoolFilRouge(school).consistent) {
            scope += ". Les saisies diffèrent selon les années : le texte validé les remplacera toutes.";
        }
        return scope;
    }

    function openEditDialog(school, year, field) {
        var ctx = { schoolId: school.id, year: year, field: field };
        var value = currentValue(ctx);
        editContext = ctx;
        lastTriggerKey = fieldKey(year, field.colId);

        editTitle.textContent = field.label;
        editContextEl.textContent = editContextText(school, year);
        editError.textContent = "";

        var isModalite = field.kind === "modalite";
        editInput.hidden = isModalite;
        editModalite.hidden = !isModalite;
        editAutreZone.hidden = field.kind !== "autre";

        if (isModalite) {
            renderModaliteChoices(value.trim());
        } else {
            editInput.value = value;
            syncAutreChoice();
        }

        editOverlay.hidden = false;
        document.body.classList.add("dialog-open");

        var focusTarget = isModalite
            ? (editModalite.querySelector("input:checked") || editModalite.querySelector("input"))
            : editInput;
        if (focusTarget) {
            focusTarget.focus();
            if (!isModalite) {
                editInput.setSelectionRange(editInput.value.length, editInput.value.length);
            }
        }
    }

    function focusTrigger() {
        if (!lastTriggerKey) return;
        var trigger = document.querySelector("[data-key=\"" + lastTriggerKey + "\"]");
        if (trigger) trigger.focus();
    }

    function closeEditDialog() {
        if (isSaving) return;
        editOverlay.hidden = true;
        if (infoOverlay.hidden) document.body.classList.remove("dialog-open");
        editContext = null;
        editError.textContent = "";
        editSaveBtn.disabled = false;
        focusTrigger();
    }

    function readEditedValue(ctx) {
        if (ctx.field.kind === "modalite") {
            var checked = editModalite.querySelector("input:checked");
            return checked ? checked.value : null;
        }
        return editInput.value.replace(/\r\n/g, "\n").trim();
    }

    // Année scolaire d'une année du plan à créer, déduite de l'année existante la plus proche
    // de l'école : Année 1 en 2026-2027 donne Année 2 en 2027-2028. Vide si rien ne permet de la déduire.
    function deduceSchoolYear(school, year) {
        var best = null;
        var placed = Object.keys(school.years).map(function (k) {
            return { year: parseInt(k, 10), rec: school.years[k] };
        });
        if (school.zero) placed.push({ year: 0, rec: school.zero });
        placed.forEach(function (p) {
            if (p.rec.start === null) return;
            if (best === null || Math.abs(p.year - year) < Math.abs(best.year - year)) {
                best = { year: p.year, start: p.rec.start };
            }
        });
        if (best === null) return "";
        var start = best.start + (year - best.year);
        return start + "-" + (start + 1);
    }

    // Mise à jour d'une ligne ; une ligne rangée par déduction reçoit aussi son année du Plan.
    function updateAction(rec, n, patch) {
        if (rec.inferred) {
            patch[COL_ANNEE] = YEAR_PREFIX + n;
        }
        return ["UpdateRecord", TABLE_ID, rec.id, patch];
    }

    // Actions Grist d'une saisie et message de confirmation.
    function planSave(school, ctx, value) {
        var colId = ctx.field.colId;
        var patch = {};
        patch[colId] = value;

        if (ctx.year === null) {
            var actions = [];
            Object.keys(school.years).map(function (k) {
                return parseInt(k, 10);
            }).sort(function (a, b) {
                return a - b;
            }).forEach(function (n) {
                var rec = school.years[n];
                if (text(rec[colId]) === value) return;
                var p = {};
                p[colId] = value;
                actions.push(updateAction(rec, n, p));
            });
            return { actions: actions, message: "Compétence fil rouge enregistrée." };
        }

        var rec = yearRecord(school, ctx.year);
        if (rec) {
            if (value === trimmed(rec[colId])) return { actions: [] };
            return { actions: [updateAction(rec, ctx.year, patch)], message: "Modification enregistrée." };
        }

        if (!value) return { actions: [] };

        var fields = {};
        fields[COL_ECOLE] = school.id;
        fields[COL_ANNEE] = YEAR_PREFIX + ctx.year;
        var schoolYear = deduceSchoolYear(school, ctx.year);
        if (schoolYear) {
            fields[COL_ANNEE_SCOLAIRE] = schoolYear;
        }
        // Une nouvelle année reprend la compétence fil rouge si toutes les années existantes concordent.
        var ct = schoolFilRouge(school);
        if (ct.text && ct.consistent) {
            fields[CT_FIELD.colId] = ct.text;
        }
        fields[colId] = value;
        return {
            actions: [["AddRecord", TABLE_ID, null, fields]],
            message: YEAR_PREFIX + ctx.year + " créée et enregistrée."
        };
    }

    // Envoie des actions à Grist puis les reporte dans les données chargées.
    async function applyActions(actions) {
        // Écarte une lecture en cours, antérieure à l'écriture : elle ne verrait pas la modification.
        loadSeq += 1;
        var result = await grist.docApi.applyUserActions(actions);
        applyToRaw(actions, result);
    }

    async function saveEdit() {
        var ctx = editContext;
        if (!ctx || isSaving) return;

        var school = schoolsById[ctx.schoolId];
        if (!school) {
            editError.textContent = "Cette école n'est plus dans la table : enregistrement impossible.";
            return;
        }

        var value = readEditedValue(ctx);
        if (ctx.field.kind === "modalite") {
            if (value === null) {
                editError.textContent = "Choisissez une modalité.";
                return;
            }
            if (value && MODALITE_CHOICES.indexOf(value) === -1) {
                editError.textContent = "Modalité non prévue.";
                return;
            }
        }

        var plan = planSave(school, ctx, value);
        if (plan.actions.length === 0) {
            closeEditDialog();
            return;
        }

        isSaving = true;
        editSaveBtn.disabled = true;
        editError.textContent = "";

        try {
            await applyActions(plan.actions);
            isSaving = false;
            closeEditDialog();
            if (currentSchoolId === school.id) {
                renderTimeline();
                // Les écoles ont été reconstruites : relire la version à jour.
                if (infoContext && infoContext.mode === "zero" && infoContext.schoolId === school.id) {
                    renderZeroContent(schoolsById[school.id]);
                }
                focusTrigger();
            }
            setStatus(plan.message, true);
        } catch (err) {
            isSaving = false;
            editSaveBtn.disabled = false;
            editError.textContent = "Erreur lors de l'enregistrement : " + (err && err.message ? err.message : "inconnue");
        }
    }

    // ---------- Année 0 et année du Plan ----------

    // Informations saisies en lecture, sauf les colonnes de `skip`.
    function renderInfoFields(rec, skip) {
        infoFields.replaceChildren();
        INFO_FIELDS.forEach(function (f) {
            var value = rec ? trimmed(rec[f.colId]) : "";
            if (!value || (skip && skip[f.colId])) return;
            var dt = document.createElement("dt");
            dt.textContent = f.label;
            var dd = document.createElement("dd");
            dd.textContent = value;
            infoFields.appendChild(dt);
            infoFields.appendChild(dd);
        });
        infoFields.hidden = !infoFields.firstChild;
    }

    function showInfoDialog(ctx) {
        infoContext = ctx;
        infoError.textContent = "";
        infoOverlay.hidden = false;
        document.body.classList.add("dialog-open");
        (ctx.mode === "plan" ? infoSelect : infoCancelBtn).focus();
    }

    // Fenêtre Année 0 : modalité et domaines modifiables comme sur une carte de la frise,
    // autres informations saisies (compétence fil rouge, regroupement…) en lecture.
    function renderZeroContent(school) {
        var rec = school.zero;
        infoContextEl.textContent = school.name + (rec && trimmed(rec[COL_ANNEE_SCOLAIRE]) ? " — " + trimmed(rec[COL_ANNEE_SCOLAIRE]) : "");

        infoEdit.replaceChildren();
        var modalite = makeFieldButton(school, 0, rec, MODALITE_FIELD, "modalite-badge", "Choisir une modalité");
        if (modalite.value && MODALITE_CHOICES.length && MODALITE_CHOICES.indexOf(modalite.value) === -1) {
            modalite.button.classList.add("is-invalid");
            modalite.button.title = "Valeur hors de la liste des modalités prévues";
        }
        infoEdit.appendChild(modalite.button);
        var list = document.createElement("div");
        list.className = "domain-list";
        FIELDS.forEach(function (field) {
            list.appendChild(makeDomain(school, 0, rec, field));
        });
        infoEdit.appendChild(list);
        infoEdit.hidden = false;

        var editable = {};
        editable[MODALITE_FIELD.colId] = true;
        FIELDS.forEach(function (f) {
            editable[f.colId] = true;
        });
        renderInfoFields(rec, editable);
    }

    function openZeroDialog(school) {
        lastTriggerKey = fieldKey(0, "details");
        infoTitle.textContent = "Formation " + YEAR_PREFIX + "0";
        renderZeroContent(school);
        infoPlan.hidden = true;
        infoSaveBtn.hidden = true;
        infoCancelBtn.textContent = "Fermer";
        showInfoDialog({ mode: "zero", schoolId: school.id });
    }

    // Ligne à laquelle attribuer l'année du Plan : la plus ancienne année scolaire
    // parmi les lignes qui contiennent des données, à défaut parmi toutes.
    function planTarget(school) {
        var byDate = school.rows.slice().sort(function (a, b) {
            if (a.start === b.start) return a.id - b.id;
            if (a.start === null) return 1;
            if (b.start === null) return -1;
            return a.start - b.start;
        });
        var withData = byDate.filter(hasData);
        return withData.length ? { rec: withData[0], hasData: true } : { rec: byDate[0], hasData: false };
    }

    function openPlanDialog(school) {
        var target = planTarget(school);
        var schoolYear = trimmed(target.rec[COL_ANNEE_SCOLAIRE]);
        lastTriggerKey = null;
        infoTitle.textContent = "Veuillez sélectionner l'année du Plan de formation" +
            (!target.hasData && schoolYear ? " pour " + schoolYear : "");
        infoContextEl.textContent = school.name + (target.hasData && schoolYear ? " — " + schoolYear : "");
        if (target.hasData) {
            renderInfoFields(target.rec);
        } else {
            infoFields.replaceChildren();
            infoFields.hidden = true;
        }

        infoSelect.replaceChildren();
        var placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Choisir…";
        infoSelect.appendChild(placeholder);
        PLAN_CHOICES.forEach(function (n) {
            var opt = document.createElement("option");
            opt.value = YEAR_PREFIX + n;
            opt.textContent = YEAR_PREFIX + n;
            infoSelect.appendChild(opt);
        });
        infoEdit.replaceChildren();
        infoEdit.hidden = true;
        infoPlan.hidden = false;
        infoSaveBtn.hidden = false;
        infoSaveBtn.disabled = false;
        infoCancelBtn.textContent = "Annuler";
        showInfoDialog({ mode: "plan", schoolId: school.id, rowId: target.rec.id });
    }

    function closeInfoDialog() {
        if (isSaving) return;
        var ctx = infoContext;
        infoOverlay.hidden = true;
        document.body.classList.remove("dialog-open");
        infoContext = null;
        if (ctx && ctx.mode === "zero") {
            lastTriggerKey = fieldKey(0, "details");
        }
        if (ctx && ctx.mode === "plan") {
            var school = schoolsById[ctx.schoolId];
            if (!school || school.pending) {
                hideTimeline();
                setStatus(idleStatus());
                searchInput.focus();
            }
            return;
        }
        focusTrigger();
    }

    async function savePlanYear() {
        var ctx = infoContext;
        if (!ctx || ctx.mode !== "plan" || isSaving) return;
        var value = infoSelect.value;
        if (!value) {
            infoError.textContent = "Choisissez l'année du Plan.";
            return;
        }
        var patch = {};
        patch[COL_ANNEE] = value;

        isSaving = true;
        infoSaveBtn.disabled = true;
        infoError.textContent = "";
        try {
            await applyActions([["UpdateRecord", TABLE_ID, ctx.rowId, patch]]);
            isSaving = false;
            closeInfoDialog();
            if (currentSchoolId === ctx.schoolId) {
                renderTimeline();
            }
            setStatus("Année du Plan enregistrée.", true);
        } catch (err) {
            isSaving = false;
            infoSaveBtn.disabled = false;
            infoError.textContent = "Erreur lors de l'enregistrement : " + (err && err.message ? err.message : "inconnue");
        }
    }

    // Garde le focus dans une fenêtre ouverte.
    function trapFocus(overlay, evt, filter) {
        var focusables = Array.prototype.filter.call(
            overlay.querySelectorAll("button, textarea, input, select"),
            function (el) {
                return !el.disabled && el.offsetParent !== null && (!filter || filter(el));
            }
        );
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (evt.shiftKey && document.activeElement === first) {
            evt.preventDefault();
            last.focus();
        } else if (!evt.shiftKey && document.activeElement === last) {
            evt.preventDefault();
            first.focus();
        }
    }

    // ---------- Événements ----------

    searchInput.addEventListener("input", function () {
        updateSearchClearButton();
        if (trimmed(searchInput.value) === "") {
            hideTimeline();
            setStatus(idleStatus());
        }
        renderDropdown();
    });

    searchInput.addEventListener("focus", renderDropdown);

    searchInput.addEventListener("blur", closeDropdown);

    searchInput.addEventListener("keydown", function (evt) {
        if (!dropdown.classList.contains("open")) {
            if (evt.key === "ArrowDown") {
                evt.preventDefault();
                renderDropdown();
            }
            return;
        }
        var count = filteredSchools.length;
        if (evt.key === "ArrowDown" && count) {
            evt.preventDefault();
            activeIndex = activeIndex < count - 1 ? activeIndex + 1 : 0;
            updateActiveItem();
        } else if (evt.key === "ArrowUp" && count) {
            evt.preventDefault();
            activeIndex = activeIndex > 0 ? activeIndex - 1 : count - 1;
            updateActiveItem();
        } else if (evt.key === "Enter" && count) {
            evt.preventDefault();
            selectSchool(filteredSchools[activeIndex >= 0 ? activeIndex : 0]);
        } else if (evt.key === "Escape") {
            closeDropdown();
        }
    });

    searchClearBtn.addEventListener("click", function () {
        searchInput.value = "";
        updateSearchClearButton();
        closeDropdown();
        hideTimeline();
        setStatus(idleStatus());
        searchInput.focus();
    });

    editAutreChoice.addEventListener("click", function () {
        editInput.value = editAutreChoice.getAttribute("aria-pressed") === "true" ? "" : AUTRE_CHOICE;
        syncAutreChoice();
        editInput.focus();
    });

    editInput.addEventListener("input", syncAutreChoice);

    editCancelBtn.addEventListener("click", closeEditDialog);
    editSaveBtn.addEventListener("click", saveEdit);

    editOverlay.addEventListener("mousedown", function (evt) {
        if (evt.target === editOverlay) {
            closeEditDialog();
        }
    });

    editOverlay.addEventListener("keydown", function (evt) {
        if (evt.key === "Escape") {
            evt.preventDefault();
            closeEditDialog();
        } else if (evt.key === "Enter" && (evt.ctrlKey || evt.metaKey)) {
            evt.preventDefault();
            saveEdit();
        } else if (evt.key === "Enter" && evt.target.type === "radio") {
            evt.preventDefault();
            saveEdit();
        } else if (evt.key === "Tab") {
            trapFocus(editOverlay, evt, function (el) {
                return el.type !== "radio" || el.checked || !editModalite.querySelector("input:checked");
            });
        }
    });

    infoCancelBtn.addEventListener("click", closeInfoDialog);
    infoSaveBtn.addEventListener("click", savePlanYear);

    infoOverlay.addEventListener("mousedown", function (evt) {
        if (evt.target === infoOverlay) {
            closeInfoDialog();
        }
    });

    infoOverlay.addEventListener("keydown", function (evt) {
        if (evt.key === "Escape") {
            evt.preventDefault();
            closeInfoDialog();
        } else if (evt.key === "Enter" && evt.target === infoSelect) {
            evt.preventDefault();
            savePlanYear();
        } else if (evt.key === "Tab") {
            trapFocus(infoOverlay, evt);
        }
    });

    grist.ready({ requiredAccess: "full" });

    // onRecords sert de signal de changement ; les données sont relues par fetchTable
    // pour ne dépendre ni des colonnes masquées ni des filtres de la vue.
    grist.onRecords(function () {
        loadData();
    });
})();
