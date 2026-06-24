/* app.js — DOM wiring for the Bridge to Hope DHS auto-filler. */
(function () {
  "use strict";

  var Sched = window.BTHSchedule;
  var Fill = window.BTHFill;

  // Blank form filenames (kept exactly as delivered; spaces are URL-encoded on fetch).
  var PDF_816 = "ClassAttend_DHS 816.pdf";
  var PDF_819 = "StudyTimesheet_DHS 819.pdf";
  var PDF_817 = "MonitoredStudy_DHS 817.pdf";
  var BLOCK_MINUTES = 90;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    form816: $("form816"), form819: $("form819"), form817: $("form817"),
    name: $("name"), institution: $("institution"),
    month: $("month"), year: $("year"), startDay: $("startDay"), endDay: $("endDay"),
    dayStart: $("dayStart"), classList: $("classList"), addClass: $("addClass"),
    generate: $("generate"), status: $("status"),
    summaryCard: $("summaryCard"), depAge: $("depAge"),
    weekBody: document.querySelector("#weekTable tbody"),
    howToBtn: $("howToBtn"), howToOverlay: $("howToOverlay"),
    howToClose: $("howToClose")
  };

  // Cache of fetched blank PDFs.
  var blankBytes = { "816": null, "819": null, "817": null };

  /* ---------- setup form controls ---------- */

  function fillMonthYear() {
    var now = new Date();
    Sched.MONTHS.forEach(function (m, i) {
      var o = document.createElement("option");
      o.value = i; o.textContent = m;
      el.month.appendChild(o);
    });
    el.month.value = now.getMonth();
    el.year.value = now.getFullYear();
  }

  function fillDayDropdowns() {
    [el.startDay, el.endDay].forEach(function (sel) {
      sel.innerHTML = "";
      var full = document.createElement("option");
      full.value = ""; full.textContent = "Full month";
      sel.appendChild(full);
      for (var d = 1; d <= 31; d++) {
        var o = document.createElement("option");
        o.value = d; o.textContent = d;
        sel.appendChild(o);
      }
    });
  }

  function addClassRow(code) {
    var row = document.createElement("div");
    row.className = "class-row";
    row.innerHTML =
      '<input class="c-code" type="text" placeholder="e.g. ACC 201" autocomplete="off" />' +
      '<input class="c-start" type="text" placeholder="auto" inputmode="numeric" />' +
      '<input class="c-end" type="text" placeholder="auto" inputmode="numeric" />' +
      '<button class="del" type="button" title="Remove">×</button>';
    row.querySelector(".c-code").value = code || "";
    row.querySelector(".del").addEventListener("click", function () {
      row.remove();
      refreshPlaceholders();
    });
    row.addEventListener("input", refreshPlaceholders);
    el.classList.appendChild(row);
    return row;
  }

  /* ---------- read inputs ---------- */

  function readClasses() {
    var rows = Array.prototype.slice.call(el.classList.querySelectorAll(".class-row"));
    var out = [];
    rows.forEach(function (row) {
      var code = row.querySelector(".c-code").value.trim();
      if (!code) return;
      var startMin = Sched.parseTime(row.querySelector(".c-start").value);
      var endMin = Sched.parseTime(row.querySelector(".c-end").value);
      out.push({
        code: code,
        startMin: startMin != null ? startMin : null,
        endMin: endMin != null ? endMin : null
      });
    });
    return out;
  }

  function buildConfig() {
    var dayStartMin = Sched.parseTime(el.dayStart.value);
    if (dayStartMin == null) dayStartMin = 8 * 60;
    return {
      name: el.name.value.trim(),
      institution: el.institution.value.trim(),
      // HANA ID input was removed from the UI; the PDF field is left blank so
      // BTH staff can complete it by hand. pdffill.js only sets it when present.
      hanaId: "",
      classes: readClasses(),
      dayStartMin: dayStartMin,
      blockMinutes: BLOCK_MINUTES,
      month: parseInt(el.month.value, 10),
      year: parseInt(el.year.value, 10),
      startDay: el.startDay.value ? parseInt(el.startDay.value, 10) : null,
      endDay: el.endDay.value ? parseInt(el.endDay.value, 10) : null
    };
  }

  /* ---------- live auto-time placeholders ---------- */

  function refreshPlaceholders() {
    var cfg = buildConfig();
    var blocks = Sched.buildBlocks(cfg.classes, cfg.dayStartMin, BLOCK_MINUTES);
    var rows = Array.prototype.slice.call(el.classList.querySelectorAll(".class-row"));
    var bi = 0;
    rows.forEach(function (row) {
      var code = row.querySelector(".c-code").value.trim();
      if (!code) return;
      var b = blocks[bi++];
      if (!b) return;
      row.querySelector(".c-start").placeholder = Sched.formatTime(b.startMin);
      row.querySelector(".c-end").placeholder = Sched.formatTime(b.endMin);
    });
    if (!el.summaryCard.hidden) renderSummary(cfg);
  }

  /* ---------- weekly summary ---------- */

  function renderSummary(cfg) {
    if (!cfg.classes.length) { el.summaryCard.hidden = true; return; }
    var res = Sched.compute(cfg);
    var threshold = parseInt(el.depAge.value, 10);
    el.weekBody.innerHTML = "";
    res.weekly.forEach(function (w) {
      var tr = document.createElement("tr");
      var met = w.hours >= threshold;
      tr.innerHTML =
        "<td>" + w.label + "</td>" +
        '<td class="' + (met ? "met" : "short") + '">' + w.hours + "</td>" +
        '<td><span class="pill ' + (met ? "met" : "short") + '">' +
          (met ? "meets " + threshold : "below " + threshold) + "</span></td>";
      el.weekBody.appendChild(tr);
    });
    el.summaryCard.hidden = false;
  }

  /* ---------- PDF fetch + download ---------- */

  async function getBlank(key, filename) {
    if (blankBytes[key]) return blankBytes[key];
    var resp = await fetch(encodeURI(filename));
    if (!resp.ok) throw new Error("Could not load " + filename + " (" + resp.status + ")");
    var buf = await resp.arrayBuffer();
    blankBytes[key] = new Uint8Array(buf);
    return blankBytes[key];
  }

  function download(bytes, filename) {
    var blob = new Blob([bytes], { type: "application/pdf" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function lastName(name) {
    var parts = name.trim().split(/\s+/);
    var last = parts.length ? parts[parts.length - 1] : "Student";
    return last.replace(/[^A-Za-z0-9]/g, "") || "Student";
  }

  function setStatus(msg, kind) {
    el.status.textContent = msg;
    el.status.className = "status" + (kind ? " " + kind : "");
  }

  /* ---------- generate ---------- */

  async function generate() {
    var want816 = el.form816.checked;
    var want819 = el.form819.checked;
    var want817 = el.form817.checked;
    if (!want816 && !want819 && !want817) {
      setStatus("Select at least one form to generate.", "err"); return;
    }

    var cfg = buildConfig();
    if (!cfg.classes.length) { setStatus("Add at least one class.", "err"); return; }
    if (!cfg.name) { setStatus("Enter the student name first.", "err"); return; }
    if (isNaN(cfg.month) || isNaN(cfg.year)) { setStatus("Pick a month and year.", "err"); return; }
    if (cfg.startDay && cfg.endDay && cfg.startDay > cfg.endDay) {
      setStatus("Start day is after end day.", "err"); return;
    }

    el.generate.disabled = true;
    setStatus("Generating…");
    try {
      var res = Sched.compute(cfg);
      var header = {
        name: cfg.name,
        institution: cfg.institution,
        hanaId: cfg.hanaId,
        monthYear: res.monthYearLabel
      };

      var ln = lastName(cfg.name);
      var tag = res.monAbbr + cfg.year;
      var jobs = []; // { bytes, filename, overflow }

      // DHS 816 — class attendance (Mon/Wed).
      if (want816) {
        var b816 = await getBlank("816", PDF_816);
        var out816 = await Fill.fill(window.PDFLib, b816, "816", header, res.attendanceRows);
        jobs.push({ bytes: out816.bytes, filename: "DHS816_Attendance_" + ln + "_" + tag + ".pdf", overflow: out816.overflow });
      }
      // DHS 819 — unsupervised study (Tue/Thu).
      if (want819) {
        var b819 = await getBlank("819", PDF_819);
        var out819 = await Fill.fill(window.PDFLib, b819, "819", header, res.studyRows);
        jobs.push({ bytes: out819.bytes, filename: "DHS819_StudyTime_" + ln + "_" + tag + ".pdf", overflow: out819.overflow });
      }
      // DHS 817 — monitored study. Same Tue/Thu content as the 819; Section 1
      // (monitor name/signature/etc.) is left blank and fillable by pdffill.js.
      if (want817) {
        var b817 = await getBlank("817", PDF_817);
        var out817 = await Fill.fill(window.PDFLib, b817, "817", header, res.studyRows);
        jobs.push({ bytes: out817.bytes, filename: "DHS817_MonitoredStudy_" + ln + "_" + tag + ".pdf", overflow: out817.overflow });
      }

      // Stagger the downloads so browsers don't drop the later files.
      var overflow = 0;
      jobs.forEach(function (job, i) {
        overflow += job.overflow;
        setTimeout(function () { download(job.bytes, job.filename); }, i * 350);
      });

      renderSummary(cfg);

      var noun = jobs.length === 1 ? "PDF" : jobs.length + " PDFs";
      if (overflow > 0) {
        setStatus("Done — but " + overflow + " row(s) exceeded the forms’ capacity and were left off. " +
          "Try clipping the date range.", "err");
      } else {
        setStatus("Done. " + noun + " downloaded. Sign them in Adobe after opening.", "ok");
      }
    } catch (e) {
      console.error(e);
      setStatus("Error: " + e.message, "err");
    } finally {
      el.generate.disabled = false;
    }
  }

  /* ---------- how-to modal ---------- */

  function setupHowTo() {
    var overlay = el.howToOverlay;
    var dialog = overlay.querySelector(".modal");

    function focusable() {
      return Array.prototype.slice.call(
        dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
    }

    function onKeydown(e) {
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab") return;
      // Focus trap.
      var items = focusable();
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }

    function open() {
      overlay.hidden = false;
      document.addEventListener("keydown", onKeydown);
      el.howToClose.focus();
    }

    function close() {
      overlay.hidden = true;
      document.removeEventListener("keydown", onKeydown);
      el.howToBtn.focus();
    }

    el.howToBtn.addEventListener("click", open);
    el.howToClose.addEventListener("click", close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close(); // click outside the dialog
    });
  }

  /* ---------- init ---------- */

  function init() {
    fillMonthYear();
    fillDayDropdowns();
    addClassRow(""); // start empty: one placeholder row reading "e.g. ACC 201"
    refreshPlaceholders();

    el.addClass.addEventListener("click", function () { addClassRow(""); refreshPlaceholders(); });
    el.dayStart.addEventListener("input", refreshPlaceholders);
    el.depAge.addEventListener("change", function () { renderSummary(buildConfig()); });
    [el.month, el.year, el.startDay, el.endDay].forEach(function (n) {
      n.addEventListener("change", function () { if (!el.summaryCard.hidden) renderSummary(buildConfig()); });
    });
    el.generate.addEventListener("click", generate);
    setupHowTo();

    // Warm the blank PDFs so the first Generate is instant (and surfaces missing files early).
    getBlank("816", PDF_816).catch(function () {});
    getBlank("819", PDF_819).catch(function () {});
    getBlank("817", PDF_817).catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
