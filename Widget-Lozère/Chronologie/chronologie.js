(function () {
    "use strict";

    var TABLE_ID = "Thematiques";
    var ECOLES_TABLE_ID = "Ecoles";
    var COL_ECOLE = "Ecole";
    var COL_ANNEE = "Annee";
    var COL_REGROUPEMENT = "Regroupement";
    var YEAR_PREFIX = "Année ";
    var YEAR_RE = /^Ann[ée]e\s+(\d+)$/i;
    var DEFAULT_YEAR_COUNT = 4;
    // Valeur exacte interprétée par widgetLozere.js : ne jamais la retaper à la main.
    var AUTRE_CHOICE = "Santé mentale / VSS ou CPS";

    // Commune à toute l'école : affichée sous son nom, écrite sur chacune de ses années.
    var CT_FIELD = { colId: "Competence_fil_rouge", label: "Compétence fil rouge", kind: "text" };
    var MODALITE_FIELD = { colId: "Modalite_retenue", label: "Modalité retenue", kind: "modalite" };
    var FIELDS = [
        { colId: "Francais", label: "Français", kind: "text" },
        { colId: "Mathematiques", label: "Mathématiques", kind: "text" },
        { colId: "Autre", label: "Autre", kind: "autre" }
    ];
    var RECORD_COLUMNS = [CT_FIELD.colId, MODALITE_FIELD.colId, COL_REGROUPEMENT].concat(FIELDS.map(function (f) {
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

    var schools = [];
    var schoolsById = {};
    var yearCount = DEFAULT_YEAR_COUNT;
    var modaliteChoices = [];
    var columnOptionsLoaded = false;
    var currentSchoolId = null;
    var filteredSchools = [];
    var activeIndex = -1;
    var loadSeq = 0;
    var editContext = null;
    var isSaving = false;
    var lastTriggerKey = null;
    var statusTimer = null;
    var statusTransient = false;

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

    function safeParseJson(value) {
        if (value && typeof value === "object") return value;
        if (!value || typeof value !== "string") return null;
        try {
            return JSON.parse(value);
        } catch (_err) {
            return null;
        }
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
            return schools.length + " école(s) avec au moins une année planifiée. Recherchez une école ci-dessus.";
        }
        return "Aucune école planifiée en Année 1 ou plus dans la table " + TABLE_ID + ".";
    }

    // ---------- Chargement des données ----------

    async function loadColumnOptions() {
        var tables = await grist.docApi.fetchTable("_grist_Tables");
        var tableRef = null;
        for (var i = 0; i < tables.id.length; i += 1) {
            if (tables.tableId[i] === TABLE_ID) {
                tableRef = tables.id[i];
                break;
            }
        }
        if (tableRef === null) return;

        var cols = await grist.docApi.fetchTable("_grist_Tables_column");
        for (var j = 0; j < cols.id.length; j += 1) {
            if (cols.parentId[j] !== tableRef) continue;
            var options = safeParseJson(cols.widgetOptions[j]);
            var choices = options && Array.isArray(options.choices) ? options.choices.map(trimmed).filter(Boolean) : [];
            if (cols.colId[j] === MODALITE_FIELD.colId) {
                modaliteChoices = choices;
            } else if (cols.colId[j] === COL_ANNEE) {
                var max = 0;
                choices.forEach(function (c) {
                    var n = parseYear(c);
                    if (n !== null && n > max) max = n;
                });
                if (max > 0) yearCount = max;
            }
        }
        columnOptionsLoaded = true;
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
            var year = parseYear(thematiques[COL_ANNEE][r]);
            if (typeof ecoleId !== "number" || ecoleId <= 0 || year === null || year < 1) continue;

            var school = byId[ecoleId];
            if (!school) {
                school = {
                    id: ecoleId,
                    name: names[ecoleId] || ("École n° " + ecoleId),
                    uai: uais[ecoleId] || "",
                    years: {}
                };
                byId[ecoleId] = school;
            }

            var rec = { id: ids[r] };
            RECORD_COLUMNS.forEach(function (colId) {
                rec[colId] = thematiques[colId] ? thematiques[colId][r] : null;
            });

            var existing = school.years[year];
            if (existing) {
                console.warn("Plusieurs lignes pour " + school.name + ", " + YEAR_PREFIX + year +
                    " : lignes " + existing.id + " et " + rec.id + ". La plus ancienne est affichée.");
                if (rec.id > existing.id) continue;
            }
            school.years[year] = rec;
        }

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
            if (!columnOptionsLoaded) {
                await loadColumnOptions();
            }
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
            buildSchools(thematiques, results[1]);
        } catch (err) {
            if (seq !== loadSeq) return;
            setStatus("Impossible de lire les données : " + (err && err.message ? err.message : "erreur inconnue") +
                ". Le widget doit disposer d'un accès complet au document.");
            return;
        }

        if (currentSchoolId !== null && schoolsById[currentSchoolId]) {
            renderTimeline();
        } else {
            if (currentSchoolId !== null) {
                hideTimeline();
            }
            setStatus(idleStatus());
        }
        if (dropdown.classList.contains("open")) {
            renderDropdown();
        }
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
            noResult.textContent = schools.length ? "Aucun résultat" : "Aucune école planifiée";
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
        renderTimeline();
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
        axis.setAttribute("aria-hidden", "true");
        var circle = document.createElement("span");
        circle.className = "year-circle";
        circle.textContent = String(year);
        axis.appendChild(circle);

        var card = document.createElement("section");
        card.className = "year-card";
        card.setAttribute("aria-label", YEAR_PREFIX + year);

        var label = document.createElement("h2");
        label.className = "year-label";
        label.textContent = YEAR_PREFIX + year;
        card.appendChild(label);

        if (!rec) {
            var hint = document.createElement("p");
            hint.className = "year-hint";
            hint.textContent = "Pas encore créée : la première saisie ajoutera cette année.";
            card.appendChild(hint);
        }

        var modalite = makeFieldButton(school, year, rec, MODALITE_FIELD, "modalite-badge", "Choisir une modalité");
        if (modalite.value && modaliteChoices.length && modaliteChoices.indexOf(modalite.value) === -1) {
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

        var maxYear = yearCount;
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

    function currentValue(ctx) {
        var school = schoolsById[ctx.schoolId];
        if (!school) return "";
        if (ctx.year === null) {
            return schoolFilRouge(school).text;
        }
        var rec = school.years[ctx.year];
        return rec ? text(rec[ctx.field.colId]) : "";
    }

    function renderModaliteChoices(selected) {
        editModalite.querySelectorAll(".choice-item, .choice-warning").forEach(function (el) {
            el.remove();
        });

        var options = [""].concat(modaliteChoices);
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

        if (selected && modaliteChoices.indexOf(selected) === -1) {
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
                (school.years[year] ? "" : " (sera créée à l'enregistrement)");
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
        var trigger = timelineContainer.querySelector("[data-key=\"" + lastTriggerKey + "\"]");
        if (trigger) trigger.focus();
    }

    function closeEditDialog() {
        if (isSaving) return;
        editOverlay.hidden = true;
        document.body.classList.remove("dialog-open");
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

    // Actions Grist d'une saisie, et mise à jour locale à appliquer une fois l'écriture acceptée.
    function planSave(school, ctx, value) {
        var colId = ctx.field.colId;

        if (ctx.year === null) {
            var targets = sortedYearRecords(school).filter(function (rec) {
                return text(rec[colId]) !== value;
            });
            return {
                actions: targets.map(function (rec) {
                    var patch = {};
                    patch[colId] = value;
                    return ["UpdateRecord", TABLE_ID, rec.id, patch];
                }),
                apply: function () {
                    targets.forEach(function (rec) {
                        rec[colId] = value;
                    });
                },
                message: "Compétence fil rouge enregistrée."
            };
        }

        var rec = school.years[ctx.year];
        if (rec) {
            if (value === trimmed(rec[colId])) return { actions: [] };
            var patch = {};
            patch[colId] = value;
            return {
                actions: [["UpdateRecord", TABLE_ID, rec.id, patch]],
                apply: function () {
                    rec[colId] = value;
                },
                message: "Modification enregistrée."
            };
        }

        if (!value) return { actions: [] };

        var fields = {};
        fields[COL_ECOLE] = school.id;
        fields[COL_ANNEE] = YEAR_PREFIX + ctx.year;
        // Une nouvelle année reprend la compétence fil rouge si toutes les années existantes concordent.
        var ct = schoolFilRouge(school);
        if (ct.text && ct.consistent) {
            fields[CT_FIELD.colId] = ct.text;
        }
        fields[colId] = value;
        return {
            actions: [["AddRecord", TABLE_ID, null, fields]],
            apply: function (result) {
                var newRec = { id: result && result.retValues ? result.retValues[0] : null };
                RECORD_COLUMNS.forEach(function (c) {
                    newRec[c] = Object.prototype.hasOwnProperty.call(fields, c) ? fields[c] : null;
                });
                school.years[ctx.year] = newRec;
            },
            message: YEAR_PREFIX + ctx.year + " créée et enregistrée."
        };
    }

    async function saveEdit() {
        var ctx = editContext;
        if (!ctx || isSaving) return;

        var school = schoolsById[ctx.schoolId];
        if (!school) {
            editError.textContent = "Cette école n'est plus planifiée : enregistrement impossible.";
            return;
        }

        var value = readEditedValue(ctx);
        if (ctx.field.kind === "modalite") {
            if (value === null) {
                editError.textContent = "Choisissez une modalité.";
                return;
            }
            if (value && modaliteChoices.indexOf(value) === -1) {
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

        // Écarte une lecture en cours, antérieure à l'écriture : elle ne verrait pas la nouvelle ligne.
        loadSeq += 1;

        try {
            var result = await grist.docApi.applyUserActions(plan.actions);
            plan.apply(result);

            isSaving = false;
            closeEditDialog();
            if (currentSchoolId === school.id) {
                renderTimeline();
                focusTrigger();
            }
            setStatus(plan.message, true);
        } catch (err) {
            isSaving = false;
            editSaveBtn.disabled = false;
            editError.textContent = "Erreur lors de l'enregistrement : " + (err && err.message ? err.message : "inconnue");
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
            var focusables = Array.prototype.filter.call(
                editOverlay.querySelectorAll("button, textarea, input"),
                function (el) {
                    return !el.disabled && el.offsetParent !== null &&
                        (el.type !== "radio" || el.checked || !editModalite.querySelector("input:checked"));
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
    });

    grist.ready({ requiredAccess: "full" });

    // onRecords sert de signal de changement ; les données sont relues par fetchTable
    // pour ne dépendre ni des colonnes masquées ni des filtres de la vue.
    grist.onRecords(function () {
        loadData();
    });
})();
