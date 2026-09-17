(function () {
    "use strict";

    var D = window.CalendrierDates;

    var CAL_TABLE = "Calendrier";
    var TH_TABLE = "Thematiques";
    var ECOLES_TABLE = "Ecoles";
    var COL_ECOLE = "Ecole";
    var COL_YEAR = "Annee_scolaire";
    var COL_DATES = "Dates";
    var SCHOOL_YEAR_RE = /^(\d{4})-(\d{4})$/;
    var TEXT_DEBOUNCE_MS = 600;
    var TOAST_MS = 8000;
    var MAX_RESULTS = 60;
    // Horaires courants des AP, saisis d'un clic.
    var TIME_PRESETS = [
        { start: "09:00", end: "12:00" },
        { start: "09:00", end: "16:30" },
        { start: "17:00", end: "18:00" },
        { start: "17:00", end: "18:30" }
    ];

    var searchInput = document.getElementById("search-input");
    var searchClear = document.getElementById("search-clear");
    var dropdown = document.getElementById("dropdown");
    var yearSelect = document.getElementById("year-select");
    var statusMsg = document.getElementById("status-msg");
    var editor = document.getElementById("editor");
    var schoolTitle = document.getElementById("school-title");
    var schoolMeta = document.getElementById("school-meta");
    var saveState = document.getElementById("save-state");
    var slotBoxes = document.getElementById("slot-boxes");
    var slotsEl = document.getElementById("slots");
    var previewText = document.getElementById("preview-text");
    var previewWarning = document.getElementById("preview-warning");
    var choiceOverlay = document.getElementById("choice-overlay");
    var choiceDialog = document.getElementById("choice-dialog");
    var choiceInput = document.getElementById("choice-input");
    var choiceError = document.getElementById("choice-error");
    var toast = document.getElementById("toast");
    var toastText = document.getElementById("toast-text");
    var toastUndo = document.getElementById("toast-undo");

    var ecoles = [];
    var ecolesById = {};
    var calendrier = null;
    var thematiques = null;
    var filtered = [];
    var activeIndex = -1;

    // École et année affichées ; values : valeurs enregistrées de la ligne Calendrier.
    var current = null;
    // Créneaux cochés sans donnée enregistrée (carte ouverte, rien saisi).
    var opened = {};
    var pending = {};
    var saveChain = Promise.resolve();
    var textTimers = {};
    var toastTimer = null;
    var undoPatch = null;
    var loadSeq = 0;
    var reloadTimer = null;
    // Choix des colonnes Choice (Asynchrone 1 et 2), communs aux deux colonnes.
    var choiceCols = D.SLOTS.filter(function (s) { return s.choice; }).map(function (s) { return s.col; });
    var choiceList = [];
    var choiceDefs = null;
    var choiceSlotKey = null;

    // ---------- Outils ----------

    function trimmed(v) {
        return v === null || v === undefined ? "" : String(v).trim();
    }

    function pad(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function setStatus(message, isError) {
        statusMsg.textContent = message || "";
        statusMsg.hidden = !message;
        statusMsg.classList.toggle("error", !!isError);
    }

    function setSaveState(state, message) {
        saveState.className = state || "";
        saveState.textContent = message || "";
    }

    function errorText(err) {
        return err && err.message ? err.message : "erreur inconnue";
    }

    function compareYears(a, b) {
        return a.localeCompare(b);
    }

    // ---------- Données ----------

    function tableRows(table) {
        var rows = [];
        if (!table || !Array.isArray(table.id)) return rows;
        for (var i = 0; i < table.id.length; i += 1) {
            var rec = { id: table.id[i] };
            for (var col in table) {
                if (col !== "id" && Array.isArray(table[col])) rec[col] = table[col][i];
            }
            rows.push(rec);
        }
        return rows;
    }

    // Ligne la plus ancienne pour une école et une année.
    function findRow(rows, ecoleId, year) {
        var found = null;
        var count = 0;
        rows.forEach(function (r) {
            if (r[COL_ECOLE] !== ecoleId || trimmed(r[COL_YEAR]) !== year) return;
            count += 1;
            if (!found || r.id < found.id) found = r;
        });
        if (count > 1) {
            console.warn("Plusieurs lignes pour l'école " + ecoleId + " en " + year + " : ligne " + found.id + " utilisée.");
        }
        return found;
    }

    function buildEcoles(table) {
        ecoles = tableRows(table).map(function (r) {
            var name = trimmed(r.Commune_Nom) || trimmed(r.Nom_etablissement) || ("École " + r.id);
            var uai = trimmed(r.Identifiant_de_l_etablissement);
            var circo = trimmed(r.Circonscription);
            return {
                id: r.id, name: name, uai: uai, circo: circo,
                // Recherche sur le nom et l'UAI seuls : la circonscription porte le
                // nom d'une commune et ramenerait toutes ses ecoles.
                search: D.normKey(name + " " + uai)
            };
        }).sort(function (a, b) {
            return a.name.localeCompare(b.name, "fr", { sensitivity: "base", numeric: true });
        });
        ecolesById = {};
        ecoles.forEach(function (e) { ecolesById[e.id] = e; });
    }

    function fillYears() {
        var years = {};
        years[D.currentSchoolYear()] = true;
        [calendrier, thematiques].forEach(function (rows) {
            (rows || []).forEach(function (r) {
                var y = trimmed(r[COL_YEAR]);
                if (SCHOOL_YEAR_RE.test(y)) years[y] = true;
            });
        });
        var list = Object.keys(years).sort(compareYears);
        var previous = yearSelect.value || D.currentSchoolYear();
        yearSelect.replaceChildren();
        list.forEach(function (y) {
            var opt = document.createElement("option");
            opt.value = y;
            opt.textContent = y;
            yearSelect.appendChild(opt);
        });
        yearSelect.value = list.indexOf(previous) !== -1 ? previous : list[0];
    }

    // Choix des colonnes Asynchrone : définition des colonnes (module partagé, qui
    // se replie sur l'API REST quand les tables _grist_* sont refusées), à défaut
    // valeurs déjà présentes dans la table.
    async function loadChoices() {
        var seen = {};
        var list = [];
        function add(value) {
            var v = trimmed(value);
            var key = D.normKey(v);
            if (!v || seen[key]) return;
            seen[key] = true;
            list.push(v);
        }
        if (typeof GristColumns !== "undefined") {
            try {
                choiceDefs = await GristColumns.fetchColumnDefs(CAL_TABLE, choiceCols);
            } catch (err) {
                choiceDefs = null;
                console.info("Choix des colonnes indisponibles : " + errorText(err));
            }
            choiceCols.forEach(function (col) {
                var def = choiceDefs && choiceDefs[col];
                if (def) def.choices.forEach(add);
            });
        }
        if (!list.length) {
            (calendrier || []).forEach(function (row) {
                choiceCols.forEach(function (col) { add(row[col]); });
            });
        }
        choiceList = list;
    }

    async function loadData() {
        var seq = ++loadSeq;
        try {
            var results = await Promise.all([
                grist.docApi.fetchTable(ECOLES_TABLE),
                grist.docApi.fetchTable(CAL_TABLE),
                grist.docApi.fetchTable(TH_TABLE)
            ]);
            if (seq !== loadSeq) return;
            if (!results[1][COL_ECOLE] || !results[1][COL_YEAR]) {
                setStatus("Colonnes « " + COL_ECOLE + " » ou « " + COL_YEAR + " » introuvables dans la table " + CAL_TABLE + ".", true);
                return;
            }
            buildEcoles(results[0]);
            calendrier = tableRows(results[1]);
            thematiques = tableRows(results[2]);
            fillYears();
            await loadChoices();
            if (seq !== loadSeq) return;
        } catch (err) {
            if (seq !== loadSeq) return;
            setStatus("Impossible de lire les données : " + errorText(err) +
                ". Le widget doit disposer d'un accès complet au document.", true);
            return;
        }

        if (current) {
            refreshCurrent();
        } else {
            setStatus(ecoles.length ? ecoles.length + " école(s). Recherchez une école ci-dessus." : "Aucune école accessible.");
        }
    }

    function scheduleReload() {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(loadData, 150);
    }

    // ---------- Recherche ----------

    function openDropdown() {
        dropdown.classList.add("open");
        searchInput.setAttribute("aria-expanded", "true");
    }

    function closeDropdown() {
        dropdown.classList.remove("open");
        searchInput.setAttribute("aria-expanded", "false");
        activeIndex = -1;
    }

    function renderDropdown() {
        var tokens = D.normKey(searchInput.value).split(" ").filter(Boolean);
        filtered = ecoles.filter(function (e) {
            return tokens.every(function (t) { return e.search.indexOf(t) !== -1; });
        }).slice(0, MAX_RESULTS);
        dropdown.replaceChildren();
        if (!filtered.length) {
            var empty = document.createElement("div");
            empty.className = "dropdown-empty";
            empty.textContent = "Aucune école ne correspond.";
            dropdown.appendChild(empty);
        }
        filtered.forEach(function (e, i) {
            var item = document.createElement("div");
            item.className = "dropdown-item" + (i === activeIndex ? " active" : "");
            item.setAttribute("role", "option");
            item.setAttribute("data-index", String(i));
            item.id = "ecole-option-" + i;
            item.textContent = e.name;
            var sub = document.createElement("span");
            sub.className = "dropdown-sub";
            sub.textContent = [e.uai, e.circo].filter(Boolean).join(" · ");
            if (sub.textContent) item.appendChild(sub);
            dropdown.appendChild(item);
        });
        if (activeIndex >= 0) {
            searchInput.setAttribute("aria-activedescendant", "ecole-option-" + activeIndex);
            var active = dropdown.querySelector(".dropdown-item.active");
            if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
        } else {
            searchInput.removeAttribute("aria-activedescendant");
        }
        openDropdown();
    }

    async function chooseEcole(ecole) {
        closeDropdown();
        searchInput.value = ecole.name;
        searchClear.classList.add("visible");
        await select(ecole.id, yearSelect.value);
    }

    // ---------- Sélection école / année ----------

    async function select(ecoleId, year) {
        await flushAll();
        hideToast();
        // Un échec d'enregistrement ne doit pas se reporter sur l'école suivante.
        pending = {};
        setSaveState("", "");
        opened = {};
        current = { ecoleId: ecoleId, year: year, rowId: null, values: {} };
        refreshCurrent(true);
    }

    // Recale l'affichage sur les données chargées. Pendant une saisie, les
    // champs restent tels quels : seuls l'aperçu et les cases suivent.
    function refreshCurrent(force) {
        if (!current || !calendrier) return;
        var ecole = ecolesById[current.ecoleId];
        if (!ecole) {
            current = null;
            editor.hidden = true;
            setStatus("Cette école n'est plus accessible.", true);
            return;
        }
        var row = findRow(calendrier, current.ecoleId, current.year);
        current.rowId = row ? row.id : null;
        current.values = {};
        D.SLOTS.forEach(function (slot) {
            D.slotColumns(slot).forEach(function (c) {
                current.values[c] = row ? row[c] : null;
            });
        });
        // Les modifications pas encore enregistrées priment.
        Object.keys(pending).forEach(function (c) { current.values[c] = pending[c]; });

        setStatus("");
        editor.hidden = false;
        schoolTitle.textContent = ecole.name;
        schoolMeta.textContent = [ecole.uai, ecole.circo, current.year].filter(Boolean).join(" · ");

        var typing = editor.contains(document.activeElement) && document.activeElement !== document.body;
        if (force || !typing) {
            renderBoxes();
            renderSlots();
        }
        renderPreview();
    }

    // ---------- Cases à cocher et cartes ----------

    function slotVisible(slot) {
        return !!opened[slot.key] || D.hasSlotData(current.values, slot);
    }

    function renderBoxes() {
        slotBoxes.replaceChildren();
        D.SLOTS.forEach(function (slot) {
            var label = document.createElement("label");
            label.className = "slot-box";
            var box = document.createElement("input");
            box.type = "checkbox";
            box.value = slot.key;
            box.checked = slotVisible(slot);
            var span = document.createElement("span");
            span.textContent = slot.label;
            label.appendChild(box);
            label.appendChild(span);
            slotBoxes.appendChild(label);
        });
    }

    function inputFor(slotKey, part, type, value, labelText, extraClass) {
        var label = document.createElement("label");
        if (extraClass) label.className = extraClass;
        label.appendChild(document.createTextNode(labelText));
        var input = document.createElement("input");
        input.type = type;
        input.value = value;
        input.setAttribute("data-slot", slotKey);
        input.setAttribute("data-part", part);
        if (type === "time") input.step = 300;
        if (type === "text") input.maxLength = 500;
        label.appendChild(input);
        return label;
    }

    // Liste déroulante d'une colonne Choice. Une valeur absente de la liste
    // (saisie dans Grist) reste proposée, signalée comme hors liste.
    function choiceField(slot, value) {
        var label = document.createElement("label");
        label.className = "grow";
        label.appendChild(document.createTextNode("Choix"));
        var select = document.createElement("select");
        select.setAttribute("data-slot", slot.key);
        select.setAttribute("data-part", "text");
        var values = [""].concat(choiceList);
        if (value && choiceList.indexOf(value) === -1) values.push(value);
        values.forEach(function (v) {
            var opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v || "— Non renseigné —";
            if (v && choiceList.indexOf(v) === -1) opt.textContent = v + " (hors liste)";
            opt.selected = v === value;
            select.appendChild(opt);
        });
        label.appendChild(select);
        return label;
    }

    function isoDay(p) {
        return p.y + "-" + pad(p.m) + "-" + pad(p.d);
    }

    function renderSlot(slot) {
        var card = document.createElement("section");
        card.className = "slot";
        card.setAttribute("data-slot", slot.key);
        var head = document.createElement("div");
        head.className = "slot-head";
        var title = document.createElement("h3");
        title.className = "slot-title";
        title.textContent = slot.label;
        var long = document.createElement("span");
        long.className = "slot-long";
        head.appendChild(title);
        head.appendChild(long);
        card.appendChild(head);

        var fields = document.createElement("div");
        fields.className = "slot-fields";
        var v = current.values;
        if (slot.kind === "range") {
            var start = v[slot.start];
            var end = v[slot.end];
            var day = "";
            var startTime = "";
            var endTime = "";
            if (typeof start === "number") {
                var s = D.parisParts(start);
                day = isoDay(s);
                if (s.h || s.mi || typeof end === "number") startTime = pad(s.h) + ":" + pad(s.mi);
            }
            if (typeof end === "number") {
                var e = D.parisParts(end);
                endTime = pad(e.h) + ":" + pad(e.mi);
            }
            fields.appendChild(inputFor(slot.key, "day", "date", day, "Date"));
            fields.appendChild(inputFor(slot.key, "start", "time", startTime, "Début"));
            fields.appendChild(inputFor(slot.key, "end", "time", endTime, "Fin"));
            fields.appendChild(renderPresets());
        } else if (slot.kind === "date") {
            var value = "";
            if (typeof v[slot.col] === "number") value = isoDay(D.dateParts(v[slot.col]));
            fields.appendChild(inputFor(slot.key, "day", "date", value, "Date"));
        } else if (slot.choice) {
            fields.appendChild(choiceField(slot, trimmed(v[slot.col])));
            var other = document.createElement("button");
            other.type = "button";
            other.className = "btn-other";
            other.setAttribute("data-slot", slot.key);
            other.textContent = "Autre…";
            fields.appendChild(other);
        } else {
            fields.appendChild(inputFor(slot.key, "text", "text", trimmed(v[slot.col]), "Texte", "grow"));
        }
        card.appendChild(fields);

        var error = document.createElement("p");
        error.className = "slot-error";
        error.setAttribute("role", "alert");
        card.appendChild(error);

        updateLongDate(card);
        updatePresets(card);
        return card;
    }

    // « 9h00 » -> « 9h », « 16:30 » -> « 16h30 »
    function timeLabel(value) {
        var t = parseTime(value);
        return D.hourLabel(t.h, t.mi);
    }

    function renderPresets() {
        var group = document.createElement("div");
        group.className = "slot-presets";
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", "Horaires courants");
        TIME_PRESETS.forEach(function (p) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "preset";
            btn.setAttribute("data-start", p.start);
            btn.setAttribute("data-end", p.end);
            btn.setAttribute("aria-pressed", "false");
            btn.textContent = timeLabel(p.start) + " – " + timeLabel(p.end);
            group.appendChild(btn);
        });
        return group;
    }

    // Bouton enfoncé quand les heures saisies correspondent.
    function updatePresets(card) {
        var start = cardInput(card, "start");
        var end = cardInput(card, "end");
        if (!start || !end) return;
        card.querySelectorAll(".preset").forEach(function (btn) {
            var on = start.value.slice(0, 5) === btn.getAttribute("data-start") &&
                end.value.slice(0, 5) === btn.getAttribute("data-end");
            btn.setAttribute("aria-pressed", on ? "true" : "false");
        });
    }

    function applyPreset(card, btn) {
        cardInput(card, "start").value = btn.getAttribute("data-start");
        cardInput(card, "end").value = btn.getAttribute("data-end");
        updatePresets(card);
        var day = cardInput(card, "day");
        if (!day.value) {
            // Horaires gardés : ils partent avec la date dès qu'elle est choisie.
            showSlotError(card, "Choisissez une date.");
            day.focus();
            return;
        }
        commitSlot(card);
    }

    function renderSlots() {
        slotsEl.replaceChildren();
        D.SLOTS.forEach(function (slot) {
            if (slotVisible(slot)) slotsEl.appendChild(renderSlot(slot));
        });
    }

    function slotByKey(key) {
        for (var i = 0; i < D.SLOTS.length; i += 1) {
            if (D.SLOTS[i].key === key) return D.SLOTS[i];
        }
        return null;
    }

    function cardInput(card, part) {
        return card.querySelector('[data-part="' + part + '"]');
    }

    function parseDay(value) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
        if (!m) return null;
        return { y: +m[1], m: +m[2], d: +m[3] };
    }

    function parseTime(value) {
        var m = /^(\d{2}):(\d{2})/.exec(value || "");
        if (!m) return null;
        return { h: +m[1], mi: +m[2] };
    }

    function updateLongDate(card) {
        var dayInput = cardInput(card, "day");
        var long = card.querySelector(".slot-long");
        var day = dayInput ? parseDay(dayInput.value) : null;
        long.textContent = day ? D.longDate(day.y, day.m, day.d) : "";
    }

    function showSlotError(card, message) {
        card.classList.toggle("invalid", !!message);
        card.querySelector(".slot-error").textContent = message || "";
    }

    // Valeurs Grist d'une carte, ou { error }.
    function readSlot(slot, card) {
        var patch = {};
        if (slot.kind === "text") {
            patch[slot.col] = trimmed(cardInput(card, "text").value);
            return patch;
        }
        var day = parseDay(cardInput(card, "day").value);
        if (slot.kind === "date") {
            patch[slot.col] = day ? D.dayToSeconds(day.y, day.m, day.d) : null;
            return patch;
        }
        var start = parseTime(cardInput(card, "start").value);
        var end = parseTime(cardInput(card, "end").value);
        if (!day) {
            if (start || end) return { error: "Choisissez une date." };
            patch[slot.start] = null;
            patch[slot.end] = null;
            return patch;
        }
        if (!start && end) return { error: "Indiquez l'heure de début." };
        var startSec = D.parisToSeconds(day.y, day.m, day.d, start ? start.h : 0, start ? start.mi : 0);
        var endSec = null;
        if (end) {
            endSec = D.parisToSeconds(day.y, day.m, day.d, end.h, end.mi);
            if (endSec <= startSec) return { error: "L'heure de fin doit suivre l'heure de début." };
        }
        patch[slot.start] = startSec;
        patch[slot.end] = endSec;
        return patch;
    }

    function sameValue(a, b) {
        var emptyA = a === null || a === undefined || a === "";
        var emptyB = b === null || b === undefined || b === "";
        return (emptyA && emptyB) || a === b;
    }

    function commitSlot(card) {
        if (!current) return;
        var slot = slotByKey(card.getAttribute("data-slot"));
        var patch = readSlot(slot, card);
        if (patch.error) {
            showSlotError(card, patch.error);
            return;
        }
        showSlotError(card, "");
        queuePatch(patch);
    }

    // ---------- Enregistrement ----------

    function queuePatch(patch) {
        var changed = false;
        Object.keys(patch).forEach(function (c) {
            if (!sameValue(current.values[c], patch[c])) {
                current.values[c] = patch[c];
                pending[c] = patch[c];
                changed = true;
            }
        });
        renderPreview();
        if (changed) scheduleSave();
    }

    function scheduleSave() {
        var target = current;
        saveChain = saveChain.then(function () { return flush(target); });
        return saveChain;
    }

    // Attend la fin des enregistrements, champs texte en attente compris.
    function flushAll() {
        Object.keys(textTimers).forEach(function (key) {
            clearTimeout(textTimers[key]);
            delete textTimers[key];
            var card = slotsEl.querySelector('.slot[data-slot="' + key + '"]');
            if (card) commitSlot(card);
        });
        return saveChain;
    }

    async function flush(target) {
        var patch = pending;
        if (!Object.keys(patch).length || target !== current) return;
        pending = {};
        setSaveState("saving", "Enregistrement…");
        try {
            if (target.rowId === null) {
                var fields = Object.assign({}, patch);
                fields[COL_ECOLE] = target.ecoleId;
                fields[COL_YEAR] = target.year;
                var res = await grist.docApi.applyUserActions([["AddRecord", CAL_TABLE, null, fields]]);
                target.rowId = res && res.retValues ? res.retValues[0] : null;
            } else {
                await grist.docApi.applyUserActions([["UpdateRecord", CAL_TABLE, target.rowId, patch]]);
            }
        } catch (err) {
            Object.keys(patch).forEach(function (c) {
                if (!(c in pending)) pending[c] = patch[c];
            });
            setSaveState("error", "Échec de l'enregistrement : " + errorText(err));
            return;
        }
        var datesError = await syncDates(target);
        var now = new Date();
        if (datesError) {
            setSaveState("error", "Enregistré, mais Dates non mise à jour : " + datesError);
        } else {
            setSaveState("saved", "Enregistré à " + pad(now.getHours()) + ":" + pad(now.getMinutes()));
        }
    }

    function thematiquesRow(target) {
        return thematiques ? findRow(thematiques, target.ecoleId, target.year) : null;
    }

    // Réécrit Thematiques.Dates si son texte diffère. Retourne un message d'erreur ou "".
    async function syncDates(target) {
        var th = thematiquesRow(target);
        if (!th) return "";
        var text = D.datesText(target.values);
        if (th[COL_DATES] === text) return "";
        try {
            var patch = {};
            patch[COL_DATES] = text;
            await grist.docApi.applyUserActions([["UpdateRecord", TH_TABLE, th.id, patch]]);
            th[COL_DATES] = text;
            return "";
        } catch (err) {
            return errorText(err);
        }
    }

    function renderPreview() {
        if (!current) return;
        var text = D.datesText(current.values);
        previewText.replaceChildren(D.toFragment(document, text));
        previewText.classList.toggle("empty", text === D.EMPTY_TEXT);
        var th = thematiquesRow(current);
        previewWarning.hidden = !!th;
        previewWarning.textContent = th ? "" :
            "Aucune ligne Thematiques pour cette école en " + current.year + " : la colonne Dates ne sera pas mise à jour.";
    }

    // ---------- Ajout d'un choix ----------

    function openChoiceDialog(slotKey) {
        choiceSlotKey = slotKey;
        choiceInput.value = "";
        choiceError.textContent = "";
        choiceOverlay.hidden = false;
        choiceInput.focus();
    }

    function closeChoiceDialog() {
        choiceOverlay.hidden = true;
        var card = choiceSlotKey && slotsEl.querySelector('.slot[data-slot="' + choiceSlotKey + '"]');
        var btn = card && card.querySelector(".btn-other");
        choiceSlotKey = null;
        if (btn) btn.focus();
    }

    // Choix retenu dans la carte qui a ouvert la fenêtre, puis enregistré.
    function selectChoice(value) {
        var key = choiceSlotKey;
        closeChoiceDialog();
        renderSlots();
        var card = slotsEl.querySelector('.slot[data-slot="' + key + '"]');
        if (!card) return;
        var select = cardInput(card, "text");
        select.value = value;
        commitSlot(card);
    }

    async function addChoice() {
        var value = trimmed(choiceInput.value);
        if (!value) {
            choiceError.textContent = "Saisissez le choix à ajouter.";
            return;
        }
        var existing = choiceList.filter(function (c) { return D.normKey(c) === D.normKey(value); })[0];
        if (existing) {
            // Déjà proposé : on le retient sans toucher à la colonne.
            selectChoice(existing);
            return;
        }
        var actions = choiceCols.map(function (col) {
            var options = Object.assign({ widget: "TextBox", alignment: "left" },
                (choiceDefs && choiceDefs[col]) ? choiceDefs[col].widgetOptions : {});
            options.choices = choiceList.concat(value);
            return ["ModifyColumn", CAL_TABLE, col, { widgetOptions: JSON.stringify(options) }];
        });
        choiceError.textContent = "";
        try {
            await grist.docApi.applyUserActions(actions);
        } catch (err) {
            choiceError.textContent = "Ajout impossible : " + errorText(err) +
                ". Modifier la liste des choix demande le droit de modifier la structure du document.";
            return;
        }
        choiceList = choiceList.concat(value);
        choiceCols.forEach(function (col) {
            if (choiceDefs && choiceDefs[col]) choiceDefs[col].choices = choiceList.slice();
        });
        selectChoice(value);
    }

    // ---------- Retrait d'un créneau et annulation ----------

    function hideToast() {
        clearTimeout(toastTimer);
        toast.hidden = true;
        undoPatch = null;
    }

    function uncheckSlot(slot) {
        delete opened[slot.key];
        var previous = {};
        var cleared = {};
        D.slotColumns(slot).forEach(function (c) {
            previous[c] = current.values[c];
            cleared[c] = slot.kind === "text" ? "" : null;
        });
        clearTimeout(textTimers[slot.key]);
        delete textTimers[slot.key];
        var hadData = D.hasSlotData(current.values, slot);
        var card = slotsEl.querySelector('.slot[data-slot="' + slot.key + '"]');
        if (card) card.remove();
        if (!hadData) return;

        queuePatch(cleared);
        clearTimeout(toastTimer);
        undoPatch = { target: current, slot: slot, values: previous };
        toastText.textContent = slot.label + " effacé.";
        toast.hidden = false;
        toastTimer = setTimeout(hideToast, TOAST_MS);
    }

    function undo() {
        var u = undoPatch;
        hideToast();
        if (!u || u.target !== current) return;
        opened[u.slot.key] = true;
        queuePatch(u.values);
        renderBoxes();
        renderSlots();
    }

    // ---------- Événements ----------

    function bind() {
        searchInput.addEventListener("input", function () {
            searchClear.classList.toggle("visible", !!searchInput.value);
            activeIndex = -1;
            renderDropdown();
        });
        searchInput.addEventListener("focus", function () {
            if (ecoles.length) renderDropdown();
        });
        searchInput.addEventListener("keydown", function (e) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!dropdown.classList.contains("open")) renderDropdown();
                if (!filtered.length) return;
                var step = e.key === "ArrowDown" ? 1 : -1;
                activeIndex = (activeIndex + step + filtered.length) % filtered.length;
                renderDropdown();
            } else if (e.key === "Enter") {
                if (!dropdown.classList.contains("open") || !filtered.length) return;
                e.preventDefault();
                chooseEcole(filtered[activeIndex >= 0 ? activeIndex : 0]);
            } else if (e.key === "Escape") {
                closeDropdown();
            }
        });
        dropdown.addEventListener("mousedown", function (e) {
            var item = e.target.closest(".dropdown-item");
            if (!item) return;
            e.preventDefault();
            chooseEcole(filtered[+item.getAttribute("data-index")]);
        });
        document.addEventListener("mousedown", function (e) {
            if (!e.target.closest("#search-wrapper")) closeDropdown();
        });
        searchClear.addEventListener("click", function () {
            searchInput.value = "";
            searchClear.classList.remove("visible");
            searchInput.focus();
            renderDropdown();
        });

        yearSelect.addEventListener("change", function () {
            if (current) select(current.ecoleId, yearSelect.value);
        });

        slotBoxes.addEventListener("change", function (e) {
            var box = e.target;
            if (!box.matches("input[type=checkbox]") || !current) return;
            var slot = slotByKey(box.value);
            if (box.checked) {
                opened[slot.key] = true;
                renderSlots();
                var card = slotsEl.querySelector('.slot[data-slot="' + slot.key + '"]');
                var first = card && card.querySelector("input");
                if (first) first.focus();
            } else {
                uncheckSlot(slot);
            }
        });

        slotsEl.addEventListener("input", function (e) {
            var card = e.target.closest(".slot");
            if (!card) return;
            var part = e.target.getAttribute("data-part");
            if (part === "day") updateLongDate(card);
            if (part === "start" || part === "end") updatePresets(card);
            if (part === "text" && e.target.tagName === "INPUT") {
                var key = card.getAttribute("data-slot");
                clearTimeout(textTimers[key]);
                textTimers[key] = setTimeout(function () {
                    delete textTimers[key];
                    commitSlot(card);
                }, TEXT_DEBOUNCE_MS);
            }
        });

        slotsEl.addEventListener("change", function (e) {
            var card = e.target.closest(".slot");
            if (!card) return;
            var key = card.getAttribute("data-slot");
            clearTimeout(textTimers[key]);
            delete textTimers[key];
            commitSlot(card);
        });

        slotsEl.addEventListener("click", function (e) {
            var preset = e.target.closest(".preset");
            if (preset) {
                applyPreset(preset.closest(".slot"), preset);
                return;
            }
            var other = e.target.closest(".btn-other");
            if (other) openChoiceDialog(other.getAttribute("data-slot"));
        });

        choiceDialog.addEventListener("submit", function (e) {
            e.preventDefault();
            addChoice();
        });
        document.getElementById("choice-cancel").addEventListener("click", closeChoiceDialog);
        choiceOverlay.addEventListener("mousedown", function (e) {
            if (e.target === choiceOverlay) closeChoiceDialog();
        });
        choiceOverlay.addEventListener("keydown", function (e) {
            if (e.key === "Escape") {
                e.preventDefault();
                closeChoiceDialog();
            }
        });

        toastUndo.addEventListener("click", undo);
    }

    function init() {
        bind();
        grist.ready({ requiredAccess: "full" });
        // onRecords sert de signal de changement ; les données sont relues par fetchTable.
        grist.onRecords(scheduleReload);
        loadData();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
