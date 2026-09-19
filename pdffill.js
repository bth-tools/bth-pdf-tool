/*
 * pdffill.js — THE PDF FILLER.
 *
 * Takes the finished rows from schedule.js and types them into the real blank
 * DHS forms. It works on the official PDFs as delivered: it only fills in the
 * existing form boxes, so the result stays fillable and signable in Adobe.
 * It never draws anything, never adds pages, and never embeds a font — the
 * forms already carry the standard fonts they need.
 *
 * Signature, instructor and "Department Use" boxes are deliberately left empty
 * for a person to complete.
 *
 * The pdf-lib library is handed in by the caller (window.PDFLib in the
 * browser, require('pdf-lib') under Node).
 * Loaded as window.BTHFill in the browser, module.exports under Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BTHFill = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ================== WHERE EACH BOX LIVES IN EACH FORM =====================
   * The boxes inside the official PDFs have fixed internal names. Row boxes are
   * numbered, but the numbering restarts oddly on page 2: it repeats the page-1
   * numbers with "_2" on the end, then carries on counting. This builds the row
   * names in the order a reader goes down the page, so filling them in order
   * flows correctly from page 1 onto page 2.
   */
  function suffixes(page1Count, page2DupCount, page2ContStart, page2ContEnd) {
    var out = [];
    var i;
    for (i = 1; i <= page1Count; i++) out.push(String(i));
    for (i = 1; i <= page2DupCount; i++) out.push(i + "_2");
    for (i = page2ContStart; i <= page2ContEnd; i++) out.push(String(i));
    return out;
  }

  /*
   * One entry per form: the name of each header box, the name of each column,
   * and how many rows that form holds. The odd spacing inside some names (two
   * spaces) is intentional — it matches the real PDFs exactly.
   *
   * The HANA ID# box is intentionally not filled by this tool; BTH staff write
   * it in by hand. Its box is named "HANA ID" in all three forms if that ever
   * needs to change.
   */
  var FORMS = {
    "816": {
      header: {
        name: "EDUCATIONAL ACTIVITY ATTENDANCE FORM",
        institution: "Educational Institution 1",
        monthYear: "MonthYear"
      },
      cols: {
        date: "Date of AttendanceRow",
        code: "Class Title  SubjectRow", // two spaces — matches the PDF
        start: "Attendance Start TimeRow",
        end: "Attendance End TimeRow",
        total: "Total Attendance TimeRow"
      },
      suffixes: suffixes(18, 18, 19, 23) // 18 + 18 + 5 = 41 rows
    },
    "819": {
      header: {
        name: "Student Name",
        institution: "Educational Institution",
        monthYear: "Month  Year" // two spaces — matches the PDF
      },
      cols: {
        date: "Date of Study TimeRow",
        code: "Class TitleSubjectRow",
        start: "Study Start TimeRow",
        end: "Study End TimeRow",
        total: "Total Study TimeRow"
      },
      suffixes: suffixes(17, 17, 18, 29) // 17 + 17 + 12 = 46 rows
    },
    // DHS 817 — Monitored Study Session Form. Structurally a twin of the 816
    // (same column prefixes), but re-measured against its own pages: it has 19
    // rows on page 1, 19 duplicated (_2) plus a 20–24 continuation on page 2.
    // Section 1 (Authorized Study Monitor name/signature/date/phone/email/other)
    // is intentionally never set here, so it stays blank and fillable in Adobe.
    "817": {
      header: {
        name: "Student Name",
        institution: "Educational Institution",
        monthYear: "MonthYear"
      },
      cols: {
        date: "Date of AttendanceRow",
        code: "Class Title  SubjectRow", // two spaces — matches the PDF
        start: "Attendance Start TimeRow",
        end: "Attendance End TimeRow",
        total: "Total Attendance TimeRow"
      },
      suffixes: suffixes(19, 19, 20, 24) // 19 + 19 + 5 = 43 rows
    }
  };

  /* ==================== KEEPING EVERY VALUE INSIDE ITS BOX ==================
   * A value wider than the box it is typed into does not wrap or spill — the
   * appearance stream clips it, so the student gets a silently truncated form
   * ("September 202"). Every value is therefore measured against its own box
   * and, only if it does not fit, set a little smaller until it does.
   *
   * Measuring needs the width of the run of text, which is not always the
   * rectangle's width: the 816 and 817 are landscape pages whose boxes are
   * rotated a quarter turn, so their text runs along the rectangle's HEIGHT.
   * The upright 819 has no rotation and uses the width.
   *
   * In practice nothing on the row grid ever needs shrinking — the widest time
   * a form can print takes about a third of its column — so this only ever
   * touches a long header value such as "September 2026" on the 817.
   */

  var FIELD_PADDING = 2;   // points the generated appearance insets, each side
  var MIN_FONT_SIZE = 7;   // never shrink past legible

  // The widest run of text this field's box can hold, in points.
  function roomFor(field) {
    var widgets = field.acroField.getWidgets();
    var room = Infinity;
    for (var i = 0; i < widgets.length; i++) {
      var rect = widgets[i].getRectangle();
      var turned = false;
      try {
        var mk = widgets[i].getAppearanceCharacteristics();
        var rot = mk ? Number(mk.getRotation()) : 0;
        turned = !!rot && (Math.abs(rot) % 180 === 90);
      } catch (e) { /* no /MK entry: an upright box */ }
      var w = turned ? rect.height : rect.width;
      if (w < room) room = w;
    }
    if (room === Infinity) return 0;
    return room - FIELD_PADDING * 2;
  }

  /*
   * The preferred size, or the largest half-point step below it that fits.
   * Returns the preferred size untouched whenever it already fits, so the
   * ordinary row grid prints exactly as it always has.
   */
  function fittingSize(font, text, preferred, room) {
    if (!font || !(room > 0)) return preferred;
    var size = preferred;
    while (size > MIN_FONT_SIZE && font.widthOfTextAtSize(text, size) > room) {
      size -= 0.5;
    }
    return size;
  }

  /*
   * Type one value into one named box. Boxes that do not exist in a given form,
   * and values that are empty, are skipped rather than treated as errors — that
   * is how blanks like the signature lines are left for a person to complete.
   */
  function trySet(form, name, value, fontSize, font) {
    var field;
    try {
      field = form.getTextField(name);
    } catch (e) {
      return false;
    }
    if (value !== "" && value != null) {
      var text = String(value);
      try { field.setFontSize(fittingSize(font, text, fontSize, roomFor(field))); }
      catch (e) { /* ignore */ }
      field.setText(text);
    }
    return true;
  }

  /* ====================== WHEN A MONTH OUTGROWS A FORM ======================
   * Each form holds a fixed number of rows across its two pages. A busy month
   * can need more than that, and rows must never be quietly dropped — so the
   * rows are cut into form-sized parts and each part fills its own copy of the
   * same blank form. The student is told plainly and submits every copy.
   *
   * The paper forms print the date only on the first row of each day. When a
   * day happens to be cut in half at that boundary, the continuation's first
   * row gets its date written back in, so no page ever opens on a dateless row.
   */

  // How many rows one copy of a form holds, across both its pages.
  function capacity(formKey) {
    var spec = FORMS[formKey];
    if (!spec) throw new Error("Unknown form key: " + formKey);
    return spec.suffixes.length;
  }

  function splitIntoForms(rows, formKey) {
    var cap = capacity(formKey);
    var parts = [];
    for (var i = 0; i < rows.length; i += cap) {
      var part = rows.slice(i, i + cap);
      if (i > 0 && part.length && !part[0].date && part[0].dateFull) {
        part = part.slice();
        part[0] = Object.assign({}, part[0], { date: part[0].dateFull });
      }
      parts.push(part);
    }
    return parts.length ? parts : [[]];
  }

  /*
   * fill(PDFLib, pdfBytes, formKey, header, rows) -> Promise<Uint8Array>
   * header = { name, institution, monthYear }
   * rows   = [{ date, code, start, end, total }]
   * Returns { bytes, used, capacity, overflow }.
   */
  async function fill(PDFLib, pdfBytes, formKey, header, rows) {
    var spec = FORMS[formKey];
    if (!spec) throw new Error("Unknown form key: " + formKey);

    var pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
    var form = pdfDoc.getForm();
    // The same font pdf-lib draws the appearances with, so a value is measured
    // against exactly what will be printed.
    var font = null;
    try { font = form.getDefaultFont(); } catch (e) { /* no fitting, then */ }

    /* ======================== FILLING IN THE FORM ==========================
     * Student details across the top, then one row per class block down the
     * page. Rows past the form's capacity are counted as "overflow" and
     * reported back so the app can warn instead of silently dropping them.
     */

    // Student details at the top of the page. A long name, institution or
    // month is set a step smaller rather than being clipped by its box.
    trySet(form, spec.header.name, header.name, 11, font);
    trySet(form, spec.header.institution, header.institution, 11, font);
    trySet(form, spec.header.monthYear, header.monthYear, 11, font);

    // One row per class block, in order down the page and onto page 2.
    var capacity = spec.suffixes.length;
    var used = Math.min(rows.length, capacity);
    for (var i = 0; i < used; i++) {
      var sfx = spec.suffixes[i];
      var r = rows[i];
      trySet(form, spec.cols.date + sfx, r.date, 9, font);
      trySet(form, spec.cols.code + sfx, r.code, 9, font);
      trySet(form, spec.cols.start + sfx, r.start, 9, font);
      trySet(form, spec.cols.end + sfx, r.end, 9, font);
      trySet(form, spec.cols.total + sfx, r.total, 9, font);
    }

    // Saved with the form still editable, so the student can correct a cell and
    // sign in Adobe afterwards. No font is embedded and no page is added: the
    // only thing added to the file is the text typed into the existing boxes.
    var bytes = await pdfDoc.save();
    return {
      bytes: bytes,
      used: used,
      capacity: capacity,
      overflow: rows.length - used
    };
  }

  return { fill: fill, capacity: capacity, splitIntoForms: splitIntoForms, FORMS: FORMS };
});
