grist.ready({ requiredAccess: 'full' });

(function () {
    "use strict";

    var allRecords = [];
    var selectedIndex = -1;

    var searchInput = document.getElementById("search-input");
    var searchClearBtn = document.getElementById("search-clear");
    var dropdown = document.getElementById("dropdown");
    var timelineContainer = document.getElementById("timeline-container");
    var timelineInner = document.getElementById("timeline-inner");
    var schoolTitle = document.getElementById("school-title");
    var ctValue = document.getElementById("ct-value");
    var statusMsg = document.getElementById("status-msg");
    var editOverlay = document.getElementById("edit-overlay");
    var editTitle = document.getElementById("edit-title");
    var editInput = document.getElementById("edit-input");
    var editChoices = document.getElementById("edit-choices");
    var editCancelBtn = document.getElementById("edit-cancel");
    var editSaveBtn = document.getElementById("edit-save");

    var currentTableId = null;
    var currentRecord = null;
    var editContext = null;
    var isSaving = false;
    var choiceOptionsCache = {};

    function escapeHtml(str) {
        if (str === null || str === undefined) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#x27;");
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function getEcole(rec) {
        if (!rec) return "";
        if (rec.UAI && typeof rec.UAI === "object" && rec.UAI.Ecole) {
            return rec.UAI.Ecole;
        }
        return rec.Ecole || rec.ecole || rec["École"] || rec["école"] || "";
    }

    function compareSchoolNames(left, right) {
        return String(left || "").localeCompare(String(right || ""), "fr", {
            sensitivity: "base",
            numeric: true
        });
    }

    function getSortedFilteredRecords(query) {
        var q = String(query || "").trim().toLowerCase();
        return allRecords.filter(function (rec) {
            var ecole = getEcole(rec);
            return ecole && ecole.toLowerCase().includes(q);
        }).sort(function (left, right) {
            return compareSchoolNames(getEcole(left), getEcole(right));
        });
    }

    function getEcoleColumnId(rec) {
        var candidates = ["Ecole", "ecole", "École", "école"];
        for (var i = 0; i < candidates.length; i += 1) {
            if (Object.prototype.hasOwnProperty.call(rec, candidates[i])) {
                return candidates[i];
            }
        }
        return null;
    }

    function isValidColumnId(colId, rec) {
        return typeof colId === "string" && colId.length > 0 && Object.prototype.hasOwnProperty.call(rec, colId);
    }

    function normalizeChoiceListValue(value) {
        if (Array.isArray(value)) {
            var normalizedArray = value.slice();
            if (normalizedArray.length > 0 && normalizedArray[0] === "L") {
                normalizedArray = normalizedArray.slice(1);
            }
            return normalizedArray.map(function (item) {
                return String(item || "").trim();
            }).filter(Boolean);
        }
        if (value === null || value === undefined) {
            return [];
        }
        if (typeof value === "string") {
            return value.split(",").map(function (item) {
                return item.trim();
            }).filter(Boolean);
        }
        return [];
    }

    function formatChoiceListForDisplay(value) {
        return normalizeChoiceListValue(value).join(", ");
    }

    function getChoiceListValuesFromRecords(colId) {
        var values = [];
        var seen = {};
        allRecords.forEach(function (rec) {
            normalizeChoiceListValue(rec ? rec[colId] : null).forEach(function (v) {
                if (!seen[v]) {
                    seen[v] = true;
                    values.push(v);
                }
            });
        });
        return values;
    }

    function safeParseJson(value) {
        if (!value || typeof value !== "string") return null;
        try {
            return JSON.parse(value);
        } catch (_err) {
            return null;
        }
    }

    async function getChoiceListOptions(tableId, colId) {
        var cacheKey = String(tableId) + "::" + String(colId);
        if (Object.prototype.hasOwnProperty.call(choiceOptionsCache, cacheKey)) {
            return choiceOptionsCache[cacheKey];
        }

        var options = [];
        try {
            var tablesMeta = await grist.docApi.fetchTable("_grist_Tables");
            var tableIds = tablesMeta && tablesMeta.tableId ? tablesMeta.tableId : [];
            var tableRefs = tablesMeta && tablesMeta.id ? tablesMeta.id : [];
            var tableRef = null;
            for (var i = 0; i < tableIds.length; i += 1) {
                if (String(tableIds[i]) === String(tableId)) {
                    tableRef = tableRefs[i];
                    break;
                }
            }

            if (tableRef !== null && tableRef !== undefined) {
                var colsMeta = await grist.docApi.fetchTable("_grist_Tables_column");
                var parentIds = colsMeta && colsMeta.parentId ? colsMeta.parentId : [];
                var colIds = colsMeta && colsMeta.colId ? colsMeta.colId : [];
                var widgetOptions = colsMeta && colsMeta.widgetOptions ? colsMeta.widgetOptions : [];
                for (var j = 0; j < colIds.length; j += 1) {
                    if (parentIds[j] === tableRef && String(colIds[j]) === String(colId)) {
                        var parsed = null;
                        if (widgetOptions[j] && typeof widgetOptions[j] === "object") {
                            parsed = widgetOptions[j];
                        } else {
                            parsed = safeParseJson(widgetOptions[j]);
                        }
                        if (parsed && Array.isArray(parsed.choices)) {
                            options = parsed.choices.map(function (choice) {
                                return String(choice || "").trim();
                            }).filter(Boolean);
                        }
                        break;
                    }
                }
            }
        } catch (_err) {
            options = [];
        }

        if (options.length === 0) {
            options = getChoiceListValuesFromRecords(colId);
        }

        choiceOptionsCache[cacheKey] = options;
        return options;
    }

    function renderChoiceListEditor(options, selectedValues) {
        editChoices.innerHTML = "";

        if (!Array.isArray(options) || options.length === 0) {
            var empty = document.createElement("div");
            empty.id = "edit-choices-empty";
            empty.textContent = "Aucune option de choix disponible pour cette colonne.";
            editChoices.appendChild(empty);
            return;
        }

        var selectedSet = {};
        selectedValues.forEach(function (val) {
            selectedSet[val] = true;
        });

        options.forEach(function (option) {
            var row = document.createElement("label");
            row.className = "choice-item";

            var box = document.createElement("input");
            box.type = "checkbox";
            box.value = option;
            box.checked = !!selectedSet[option];

            var text = document.createElement("span");
            text.textContent = option;

            row.appendChild(box);
            row.appendChild(text);
            editChoices.appendChild(row);
        });
    }

    function collectSelectedChoiceValues() {
        var boxes = editChoices.querySelectorAll("input[type='checkbox']");
        var values = [];
        boxes.forEach(function (box) {
            if (box.checked) {
                values.push(box.value);
            }
        });
        return values;
    }

    function toChoiceListGristValue(values) {
        var normalizedValues = Array.isArray(values) ? values : [];
        return ["L"].concat(normalizedValues);
    }

    function clearTimelineDisplay() {
        currentRecord = null;
        schoolTitle.textContent = "";
        ctValue.textContent = "";
        var line = document.getElementById("timeline-line");
        timelineInner.innerHTML = "";
        timelineInner.appendChild(line);
        timelineContainer.classList.remove("visible");
        statusMsg.style.display = "block";
        if (allRecords.length > 0) {
            statusMsg.textContent = allRecords.length + " école(s) chargée(s). Recherchez une école ci-dessus.";
        } else {
            statusMsg.textContent = "Aucune donnée reçue. Vérifiez que le widget est bien associé à la table Tableau_besoins.";
        }
    }

    function updateSearchClearButton() {
        var hasText = String(searchInput.value || "").trim().length > 0;
        searchClearBtn.classList.toggle("visible", hasText);
    }

    function getYears(rec) {
        var keys = Object.keys(rec);
        var years = [];
        keys.forEach(function (k) {
            var m = k.match(/^Annee_(\d+)$/);
            if (m) {
                years.push(parseInt(m[1], 10));
            }
        });
        years.sort(function (a, b) { return a - b; });
        return years;
    }

    function getFormations(rec, yearNum) {
        var keys = Object.keys(rec);
        var formations = [];
        keys.forEach(function (k) {
            var m = k.match(new RegExp("^Annee_" + yearNum + "_Formation_(\\d+)$"));
            if (m) {
                formations.push({ idx: parseInt(m[1], 10), val: rec[k], colId: k });
            }
        });
        formations.sort(function (a, b) { return a.idx - b.idx; });
        return formations;
    }

    function setEditable(el, rec, colId, label) {
        if (!el || !rec || !isValidColumnId(colId, rec)) return;
        el.classList.add("editable-field");
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", "Modifier: " + label);
        el.addEventListener("click", function () {
            openEditDialog(rec, colId, label);
        });
        el.addEventListener("keydown", function (evt) {
            if (evt.key === "Enter" || evt.key === " ") {
                evt.preventDefault();
                openEditDialog(rec, colId, label);
            }
        });
    }

    function closeEditDialog() {
        editOverlay.classList.remove("open");
        editOverlay.setAttribute("aria-hidden", "true");
        editInput.style.display = "block";
        editChoices.style.display = "none";
        editChoices.innerHTML = "";
        editContext = null;
        isSaving = false;
        editSaveBtn.disabled = false;
    }

    async function openEditDialog(rec, colId, label) {
        if (!rec || !isValidColumnId(colId, rec)) return;
        var isCtChoiceList = colId === "Competences_transversales";
        editContext = {
            rec: rec,
            colId: colId,
            label: String(label || "Champ"),
            isChoiceList: isCtChoiceList
        };
        editTitle.textContent = "Modifier \"" + editContext.label + "\"";

        if (isCtChoiceList) {
            var tableId = await getTableId();
            var options = await getChoiceListOptions(tableId, colId);
            var selectedValues = normalizeChoiceListValue(rec[colId]);
            renderChoiceListEditor(options, selectedValues);
            editInput.style.display = "none";
            editChoices.style.display = "block";
        } else {
            editInput.value = rec[colId] === null || rec[colId] === undefined ? "" : String(rec[colId]);
            editInput.style.display = "block";
            editChoices.style.display = "none";
        }

        editOverlay.classList.add("open");
        editOverlay.setAttribute("aria-hidden", "false");
        setTimeout(function () {
            if (isCtChoiceList) {
                var firstCheckbox = editChoices.querySelector("input[type='checkbox']");
                if (firstCheckbox) firstCheckbox.focus();
            } else {
                editInput.focus();
                editInput.select();
            }
        }, 0);
    }

    async function getTableId() {
        if (currentTableId) return currentTableId;
        if (grist && grist.selectedTable && typeof grist.selectedTable.getTableId === "function") {
            currentTableId = await grist.selectedTable.getTableId();
        }
        if (!currentTableId) {
            throw new Error("Impossible d'identifier la table Grist active.");
        }
        return currentTableId;
    }

    async function saveEdit() {
        if (!editContext || isSaving) return;
        var rec = editContext.rec;
        var colId = editContext.colId;
        if (!rec || !rec.id || !isValidColumnId(colId, rec)) {
            statusMsg.style.display = "block";
            statusMsg.textContent = "Mise à jour impossible: record ou colonne invalide.";
            closeEditDialog();
            return;
        }

        isSaving = true;
        editSaveBtn.disabled = true;
        var nextValue = editContext.isChoiceList
            ? toChoiceListGristValue(collectSelectedChoiceValues())
            : editInput.value;

        try {
            var tableId = await getTableId();
            var patch = {};
            patch[colId] = nextValue;
            await grist.docApi.applyUserActions([
                ["UpdateRecord", tableId, rec.id, patch]
            ]);

            rec[colId] = nextValue;
            if (currentRecord === rec) {
                renderTimeline(rec);
                if (colId === getEcoleColumnId(rec)) {
                    searchInput.value = getEcole(rec);
                }
            }
            statusMsg.style.display = "block";
            statusMsg.textContent = "Modification enregistrée.";
            closeEditDialog();
        } catch (err) {
            isSaving = false;
            editSaveBtn.disabled = false;
            statusMsg.style.display = "block";
            statusMsg.textContent = "Erreur lors de l'enregistrement: " + (err && err.message ? err.message : "inconnue");
        }
    }

    function renderDropdown(query) {
        dropdown.innerHTML = "";
        selectedIndex = -1;

        var filtered = getSortedFilteredRecords(query);

        if (filtered.length === 0) {
            var noResult = document.createElement("div");
            noResult.id = "no-result";
            noResult.textContent = "Aucun résultat";
            dropdown.appendChild(noResult);
        } else {
            var q = String(query || "").trim().toLowerCase();
            var regex = q ? new RegExp("(" + escapeRegex(q) + ")", "gi") : null;
            filtered.forEach(function (rec, i) {
                var ecole = escapeHtml(getEcole(rec));
                var item = document.createElement("div");
                item.className = "dropdown-item";
                item.setAttribute("data-index", String(i));
                if (regex) {
                    item.innerHTML = ecole.replace(regex, "<mark>$1</mark>");
                } else {
                    item.textContent = getEcole(rec);
                }
                item.addEventListener("mousedown", function () {
                    selectRecord(i, filtered);
                });
                dropdown.appendChild(item);
            });
            selectedIndex = 0;
            updateActiveItem();
        }

        dropdown.classList.add("open");
    }

    function closeDropdown() {
        dropdown.classList.remove("open");
        selectedIndex = -1;
    }

    function updateActiveItem() {
        var items = dropdown.querySelectorAll(".dropdown-item");
        items.forEach(function (item, i) {
            item.classList.toggle("active", i === selectedIndex);
            if (i === selectedIndex) {
                item.scrollIntoView({ block: "nearest" });
            }
        });
    }

    function selectRecord(idx, filtered) {
        var rec = filtered[idx];
        if (!rec) return;
        currentRecord = rec;
        var ecole = getEcole(rec);
        searchInput.value = ecole;
        updateSearchClearButton();
        closeDropdown();
        renderTimeline(rec);
    }

    function renderTimeline(rec) {
        var ecole = getEcole(rec);
        schoolTitle.textContent = ecole;
        schoolTitle.classList.remove("editable-field", "editable-title");

        var ctColId = "Competences_transversales";
        var ctText = formatChoiceListForDisplay(rec[ctColId]);
        ctValue.textContent = ctText;

        var newCt = ctValue.cloneNode(true);
        ctValue.parentNode.replaceChild(newCt, ctValue);
        ctValue = newCt;

        ctValue.classList.remove("editable-field");
        ctValue.removeAttribute("tabindex");
        ctValue.removeAttribute("role");
        ctValue.removeAttribute("aria-label");

        if (Object.prototype.hasOwnProperty.call(rec, ctColId)) {
            ctValue.classList.add("editable-field");
            ctValue.setAttribute("tabindex", "0");
            ctValue.setAttribute("role", "button");
            ctValue.setAttribute("aria-label", "Modifier : Compétence transversale");
            ctValue.addEventListener("click", function () {
                openEditDialog(rec, ctColId, "Compétences transversales");
            });
            ctValue.addEventListener("keydown", function (evt) {
                if (evt.key === "Enter" || evt.key === " ") {
                    evt.preventDefault();
                    openEditDialog(rec, ctColId, "Compétences transversales");
                }
            });
        } else {
            console.warn("Colonne non trouvée dans le record :", ctColId, Object.keys(rec));
        }

        var years = getYears(rec);

        var line = document.getElementById("timeline-line");
        timelineInner.innerHTML = "";
        timelineInner.appendChild(line);

        if (years.length === 0) {
            timelineContainer.classList.add("visible");
            statusMsg.style.display = "none";
            var empty = document.createElement("div");
            empty.style.color = "var(--text-secondary)";
            empty.style.fontStyle = "italic";
            empty.style.fontSize = "13px";
            empty.textContent = "Aucune donnée d'année disponible.";
            timelineInner.appendChild(empty);
            return;
        }

        years.forEach(function (yearNum) {
            var isAbove = (yearNum % 2 !== 0);
            var anneeVal = rec["Annee_" + yearNum];
            var anneeColId = "Annee_" + yearNum;
            var formations = getFormations(rec, yearNum);

            var hasContent = (anneeVal && String(anneeVal).trim() !== "") ||
                formations.some(function (f) { return f && f.val && String(f.val).trim() !== ""; });

            var block = document.createElement("div");
            block.className = "year-block";

            var content = document.createElement("div");
            content.className = "year-content " + (isAbove ? "above" : "below");

            var labelEl = document.createElement("div");
            labelEl.className = "year-label";
            labelEl.textContent = "Année " + yearNum;
            content.appendChild(labelEl);

            if (anneeVal && String(anneeVal).trim() !== "") {
                var anneeEl = document.createElement("div");
                anneeEl.className = "annee-value";
                anneeEl.textContent = String(anneeVal).trim();
                content.appendChild(anneeEl);
            }

            var firstEmptyFormation = null;
            formations.forEach(function (f) {
                if (f && f.val && String(f.val).trim() !== "") {
                    var fEl = document.createElement("div");
                    fEl.className = "formation-item";
                    fEl.textContent = String(f.val).trim();
                    setEditable(fEl, rec, f.colId, "Année " + yearNum + " - Formation " + f.idx);
                    content.appendChild(fEl);
                } else if (f && isValidColumnId(f.colId, rec) && firstEmptyFormation === null) {
                    firstEmptyFormation = f;
                }
            });

            if (firstEmptyFormation !== null) {
                var addBtn = document.createElement("button");
                addBtn.type = "button";
                addBtn.className = "add-formation-btn";
                addBtn.setAttribute("aria-label", "Ajouter une formation pour l'année " + yearNum);
                (function (f) {
                    addBtn.addEventListener("click", function () {
                        openEditDialog(rec, f.colId, "Année " + yearNum + " - Formation " + f.idx);
                    });
                    addBtn.addEventListener("keydown", function (evt) {
                        if (evt.key === "Enter" || evt.key === " ") {
                            evt.preventDefault();
                            openEditDialog(rec, f.colId, "Année " + yearNum + " - Formation " + f.idx);
                        }
                    });
                }(firstEmptyFormation));
                content.appendChild(addBtn);
            }

            var connector = document.createElement("div");
            connector.className = "connector " + (isAbove ? "above" : "below");

            var circle = document.createElement("div");
            circle.className = "year-circle";
            circle.textContent = String(yearNum);

            if (isAbove) {
                block.appendChild(content);
                block.appendChild(connector);
                block.appendChild(circle);
            } else {
                block.appendChild(circle);
                block.appendChild(connector);
                block.appendChild(content);
            }

            timelineInner.appendChild(block);
        });

        timelineContainer.classList.add("visible");
        statusMsg.style.display = "none";
    }

    searchInput.addEventListener("input", function () {
        updateSearchClearButton();
        if (String(searchInput.value || "").trim() === "") {
            clearTimelineDisplay();
        }
        renderDropdown(searchInput.value);
    });

    searchInput.addEventListener("focus", function () {
        renderDropdown(searchInput.value);
    });

    searchInput.addEventListener("blur", function () {
        setTimeout(closeDropdown, 150);
    });

    searchInput.addEventListener("keydown", function (e) {
        var items = dropdown.querySelectorAll(".dropdown-item");
        if (!dropdown.classList.contains("open")) return;
        if (items.length === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            selectedIndex = selectedIndex < items.length - 1 ? selectedIndex + 1 : 0;
            updateActiveItem();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : items.length - 1;
            updateActiveItem();
        } else if (e.key === "Enter") {
            e.preventDefault();
            var filtered = getSortedFilteredRecords(searchInput.value);
            if (filtered.length > 0) {
                var idx = selectedIndex >= 0 ? selectedIndex : 0;
                selectRecord(idx, filtered);
            }
        } else if (e.key === "Escape") {
            closeDropdown();
        }
    });

    searchClearBtn.addEventListener("click", function () {
        searchInput.value = "";
        updateSearchClearButton();
        closeDropdown();
        clearTimelineDisplay();
        searchInput.focus();
    });

    document.addEventListener("click", function (e) {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            closeDropdown();
        }
    });

    editCancelBtn.addEventListener("click", function () {
        closeEditDialog();
    });

    editSaveBtn.addEventListener("click", function () {
        saveEdit();
    });

    editOverlay.addEventListener("click", function (evt) {
        if (evt.target === editOverlay) {
            closeEditDialog();
        }
    });

    editInput.addEventListener("keydown", function (evt) {
        if (evt.key === "Escape") {
            closeEditDialog();
        }
        if ((evt.ctrlKey || evt.metaKey) && evt.key === "Enter") {
            saveEdit();
        }
    });

    grist.ready({ requiredAccess: "full" });

    grist.onRecords(function (records) {
        allRecords = Array.isArray(records) ? records : [];
        updateSearchClearButton();
        choiceOptionsCache = {};

        if (!currentRecord || allRecords.indexOf(currentRecord) === -1) {
            if (String(searchInput.value || "").trim() === "") {
                clearTimelineDisplay();
            }
        }

        if (allRecords.length > 0) {
            statusMsg.textContent = allRecords.length + " école(s) chargée(s). Recherchez une école ci-dessus.";
        } else {
            statusMsg.textContent = "Aucune donnée reçue. Vérifiez que le widget est bien associé à la table Tableau_besoins.";
        }
    });

})();