/*
 * Module partagé — dates des tables Calendrier et Autres_modules.
 *
 * Les deux tables ont les mêmes colonnes : AP1 à AP5 (DateTime Europe/Paris,
 * début et fin), PDF1-2 et Visite1-2 (Date), Asynchrone_1-2 et GT_Cycle_1
 * (texte libre). Ce module décrit ces créneaux, convertit les valeurs Grist
 * (secondes depuis 1970) en heure de Paris et produit le texte de
 * Thematiques.Dates, une ligne par créneau :
 *
 *   AP 1 : jeudi 17 septembre 2026 de 9h à 12h
 *   Parcours M@gistère
 *   PDF 1 : lundi 21 septembre 2026
 *
 * Le texte reste lisible tel quel dans Grist : aucune marque de mise en forme.
 * À l'affichage (toHtml, toFragment), la valeur qui suit un libellé connu est
 * mise en gras ; les anciennes valeurs, écrites avec des **, restent lues.
 *
 * Utilisé par Calendrier/calendrier.js (saisie) et widgetLozere.js (lecture).
 */
(function (global) {
    "use strict";

    var TZ = "Europe/Paris";
    var EMPTY_TEXT = "Dates à définir";

    var DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    var MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
        "août", "septembre", "octobre", "novembre", "décembre"];

    // Ordre du texte Dates. kind : range (DateTime début / fin), date (Date),
    // text (texte libre, seul sur sa ligne si bare, sinon « Libellé : **valeur** »).
    var SLOTS = [
        { key: "AP1", label: "AP 1", kind: "range", start: "AP1_debut", end: "AP1_fin" },
        { key: "AP2", label: "AP 2", kind: "range", start: "AP2_debut", end: "AP2_fin" },
        { key: "AP3", label: "AP 3", kind: "range", start: "AP3_debut", end: "AP3_fin" },
        { key: "AP4", label: "AP 4", kind: "range", start: "AP4_debut", end: "AP4_fin" },
        { key: "AP5", label: "AP 5", kind: "range", start: "AP5_debut", end: "AP5_fin" },
        // choice : colonnes Choice, saisies par liste déroulante dans le widget.
        { key: "Asynchrone_1", label: "Asynchrone 1", kind: "text", col: "Asynchrone_1", bare: true, choice: true },
        { key: "Asynchrone_2", label: "Asynchrone 2", kind: "text", col: "Asynchrone_2", bare: true, choice: true },
        { key: "PDF1", label: "PDF 1", kind: "date", col: "PDF1" },
        { key: "PDF2", label: "PDF 2", kind: "date", col: "PDF2" },
        { key: "Visite1", label: "Visite 1", kind: "date", col: "Visite1" },
        { key: "Visite2", label: "Visite 2", kind: "date", col: "Visite2" },
        { key: "GT_Cycle_1", label: "GT Cycle 1", kind: "text", col: "GT_Cycle_1" }
    ];

    function slotColumns(slot) {
        return slot.kind === "range" ? [slot.start, slot.end] : [slot.col];
    }

    function isNum(v) {
        return typeof v === "number" && isFinite(v);
    }

    var partsFormat = null;

    // Secondes Grist -> { y, m, d, h, mi } à l'heure de Paris.
    function parisParts(seconds) {
        if (!partsFormat) {
            partsFormat = new Intl.DateTimeFormat("en-GB", {
                timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit", hourCycle: "h23"
            });
        }
        var p = {};
        partsFormat.formatToParts(new Date(seconds * 1000)).forEach(function (x) { p[x.type] = x.value; });
        return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
    }

    // Heure de Paris -> secondes Grist. Deux passes suffisent, y compris aux
    // changements d'heure.
    function parisToSeconds(y, m, d, h, mi) {
        var wanted = Date.UTC(y, m - 1, d, h, mi);
        var t = wanted;
        for (var i = 0; i < 2; i++) {
            var p = parisParts(t / 1000);
            t += wanted - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
        }
        return t / 1000;
    }

    // Colonne Date de Grist : minuit UTC du jour.
    function dateParts(seconds) {
        var dt = new Date(seconds * 1000);
        return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    }

    function dayToSeconds(y, m, d) {
        return Date.UTC(y, m - 1, d) / 1000;
    }

    // « jeudi 17 septembre 2026 »
    function longDate(y, m, d) {
        var wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        return DAYS[wd] + " " + d + " " + MONTHS[m - 1] + " " + y;
    }

    // « 9h », « 13h30 »
    function hourLabel(h, mi) {
        return h + "h" + (mi ? (mi < 10 ? "0" : "") + mi : "");
    }

    // Créneau AP : date seule si début à minuit sans fin.
    function formatRange(start, end) {
        if (!isNum(start)) return "";
        var s = parisParts(start);
        var out = longDate(s.y, s.m, s.d);
        var hasStartTime = s.h !== 0 || s.mi !== 0;
        if (isNum(end)) {
            var e = parisParts(end);
            if (e.y !== s.y || e.m !== s.m || e.d !== s.d) {
                return out + " à " + hourLabel(s.h, s.mi) + " au " + longDate(e.y, e.m, e.d) + " à " + hourLabel(e.h, e.mi);
            }
            return out + " de " + hourLabel(s.h, s.mi) + " à " + hourLabel(e.h, e.mi);
        }
        return hasStartTime ? out + " à " + hourLabel(s.h, s.mi) : out;
    }

    function formatDay(seconds) {
        if (!isNum(seconds)) return "";
        var p = dateParts(seconds);
        return longDate(p.y, p.m, p.d);
    }

    function textValue(v) {
        return typeof v === "string" ? v.trim() : "";
    }

    // Retire les ** d'un texte libre : ils casseraient la mise en gras.
    function plain(v) {
        return textValue(v).replace(/\*\*/g, "").replace(/\s*\n\s*/g, " ");
    }

    // Une ligne par créneau renseigné. rec : { colId: valeur }.
    function lines(rec) {
        var out = [];
        if (!rec) return out;
        SLOTS.forEach(function (slot) {
            var value;
            if (slot.kind === "range") {
                value = formatRange(rec[slot.start], rec[slot.end]);
            } else if (slot.kind === "date") {
                value = formatDay(rec[slot.col]);
            } else {
                value = plain(rec[slot.col]);
                if (value && slot.bare) {
                    out.push(value);
                    return;
                }
            }
            if (value) out.push(slot.label + " : " + value);
        });
        return out;
    }

    function hasSlotData(rec, slot) {
        if (!rec) return false;
        return slotColumns(slot).some(function (c) {
            var v = rec[c];
            return isNum(v) || !!textValue(v);
        });
    }

    // Texte de Thematiques.Dates.
    function datesText(rec) {
        var l = lines(rec);
        return l.length ? l.join("\n") : EMPTY_TEXT;
    }

    // « AP 1 : », « PDF 2 : »… : seuls ces libellés introduisent une valeur en gras.
    var LABEL_RE = new RegExp("^(" + SLOTS.map(function (s) {
        return s.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("|") + ") : (.+)$");

    // Une ligne découpée en [libellé, valeur à mettre en gras], ou [ligne].
    function splitLine(line) {
        var clean = String(line).replace(/\*\*/g, "");
        var m = LABEL_RE.exec(clean);
        return m ? [m[1] + " : ", m[2]] : [clean];
    }

    // Fragment DOM : lignes séparées par <br>, valeurs en <strong>.
    // Construit par nœuds texte : aucune valeur n'est interprétée comme HTML.
    function toFragment(doc, text) {
        var frag = doc.createDocumentFragment();
        String(text || "").split("\n").forEach(function (line, i) {
            if (i > 0) frag.appendChild(doc.createElement("br"));
            var parts = splitLine(line);
            frag.appendChild(doc.createTextNode(parts[0]));
            if (parts.length > 1) {
                var strong = doc.createElement("strong");
                strong.textContent = parts[1];
                frag.appendChild(strong);
            }
        });
        return frag;
    }

    // Même rendu en chaîne HTML, pour les widgets qui construisent du HTML.
    // esc : fonction d'échappement de l'appelant, appliquée à chaque segment.
    function toHtml(text, esc) {
        return String(text || "").split("\n").map(function (line) {
            var parts = splitLine(line);
            return esc(parts[0]) + (parts.length > 1 ? "<strong>" + esc(parts[1]) + "</strong>" : "");
        }).join("<br>");
    }

    // « 2026-2027 » de septembre 2026 à août 2027.
    function currentSchoolYear(now) {
        var d = now || new Date();
        var start = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
        return start + "-" + (start + 1);
    }

    // Rapprochement tolérant (casse, accents, espaces) : Module est un texte libre.
    var DIACRITICS_RE = new RegExp("[̀-ͯ]", "g");
    function normKey(s) {
        return String(s === null || s === undefined ? "" : s)
            .normalize("NFD").replace(DIACRITICS_RE, "").toLowerCase().replace(/\s+/g, " ").trim();
    }

    global.CalendrierDates = {
        TZ: TZ,
        EMPTY_TEXT: EMPTY_TEXT,
        SLOTS: SLOTS,
        slotColumns: slotColumns,
        parisParts: parisParts,
        parisToSeconds: parisToSeconds,
        dateParts: dateParts,
        dayToSeconds: dayToSeconds,
        longDate: longDate,
        hourLabel: hourLabel,
        lines: lines,
        hasSlotData: hasSlotData,
        datesText: datesText,
        toFragment: toFragment,
        toHtml: toHtml,
        currentSchoolYear: currentSchoolYear,
        normKey: normKey
    };
})(typeof window !== "undefined" ? window : this);
