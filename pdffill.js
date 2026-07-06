/*
 * pdffill.js — fills the DHS 816 / 819 AcroForms using pdf-lib.
 * PDFLib is passed in (window.PDFLib in browser, require('pdf-lib') in node).
 * Exposed as window.BTHFill (browser) and module.exports (node).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BTHFill = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Ordered row-field suffixes, matching how the PDFs are actually named.
  // Page 1 rows are "n"; page 2 reuses "n_2" for the first block then "n" again
  // for the trailing continuation rows.
  function suffixes(page1Count, page2DupCount, page2ContStart, page2ContEnd) {
    var out = [];
    var i;
    for (i = 1; i <= page1Count; i++) out.push(String(i));
    for (i = 1; i <= page2DupCount; i++) out.push(i + "_2");
    for (i = page2ContStart; i <= page2ContEnd; i++) out.push(String(i));
    return out;
  }

  var FORMS = {
    "816": {
      header: {
        name: "EDUCATIONAL ACTIVITY ATTENDANCE FORM",
        institution: "Educational Institution 1",
        hanaId: "HANA ID",
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
        hanaId: "HANA ID",
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
        hanaId: "HANA ID",
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

  function trySet(form, name, value, fontSize) {
    var field;
    try {
      field = form.getTextField(name);
    } catch (e) {
      return false;
    }
    if (value !== "" && value != null) {
      try { field.setFontSize(fontSize); } catch (e) { /* ignore */ }
      field.setText(String(value));
    }
    return true;
  }

  /*
   * fill(PDFLib, pdfBytes, formKey, header, rows) -> Promise<Uint8Array>
   * header = { name, institution, hanaId, monthYear }
   * rows   = [{ date, code, start, end, total }]
   * Returns { bytes, used, capacity, overflow }.
   */
  async function fill(PDFLib, pdfBytes, formKey, header, rows) {
    var spec = FORMS[formKey];
    if (!spec) throw new Error("Unknown form key: " + formKey);

    var pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
    var form = pdfDoc.getForm();

    // Header
    trySet(form, spec.header.name, header.name, 11);
    trySet(form, spec.header.institution, header.institution, 11);
    if (header.hanaId) trySet(form, spec.header.hanaId, header.hanaId, 11);
    trySet(form, spec.header.monthYear, header.monthYear, 11);

    // Rows
    var capacity = spec.suffixes.length;
    var used = Math.min(rows.length, capacity);
    for (var i = 0; i < used; i++) {
      var sfx = spec.suffixes[i];
      var r = rows[i];
      trySet(form, spec.cols.date + sfx, r.date, 9);
      trySet(form, spec.cols.code + sfx, r.code, 9);
      trySet(form, spec.cols.start + sfx, r.start, 9);
      trySet(form, spec.cols.end + sfx, r.end, 9);
      trySet(form, spec.cols.total + sfx, r.total, 9);
    }

    // Keep the form editable so the student can sign in Adobe afterward.
    var bytes = await pdfDoc.save();
    return {
      bytes: bytes,
      used: used,
      capacity: capacity,
      overflow: rows.length - used
    };
  }

  return { fill: fill, FORMS: FORMS };
});
