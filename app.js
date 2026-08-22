/*
 * app.js — THE PAGE ITSELF.
 *
 * Connects what a person types on the page to the two other files:
 *   schedule.js — works out the timetable (the only place that decides times)
 *   pdffill.js  — types the result into the real blank DHS forms
 *
 * Nothing is uploaded and nothing is saved. Everything happens in the browser
 * and disappears when the page is closed or refreshed.
 *
 * The page is laid out top to bottom as: which forms to make, the student,
 * the month, the class list, a live hours summary, and the Generate button.
 */
(function () {
  "use strict";

  var Sched = window.BTHSchedule;
  var Fill = window.BTHFill;

  /*
   * The three forms this tool can produce. One entry each, so adding or
   * changing a form is a single edit here rather than three matching edits
   * further down.
   *   checkbox — the tick box on the page
   *   blank    — the official empty PDF, filename exactly as delivered
   *   rows     — which set of rows it gets: attendance days, or study days
   *   prefix   — the start of the downloaded filename
   * The DHS 817 deliberately gets the same study rows as the DHS 819; only its
   * monitor certification block differs, and that is left blank to be signed.
   */
  var FORMS = [
    { key: "816", checkbox: "form816", blank: "ClassAttend_DHS 816.pdf",
      rows: "attendanceRows", prefix: "DHS816_Attendance_" },
    { key: "819", checkbox: "form819", blank: "StudyTimesheet_DHS 819.pdf",
      rows: "studyRows", prefix: "DHS819_StudyTime_" },
    { key: "817", checkbox: "form817", blank: "MonitoredStudy_DHS 817.pdf",
      rows: "studyRows", prefix: "DHS817_MonitoredStudy_" }
  ];

  // How long one online class block runs, in minutes (1.5 hours).
  var BLOCK_MINUTES = 90;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    form816: $("form816"), form819: $("form819"), form817: $("form817"),
    name: $("name"), institution: $("institution"),
    month: $("month"), year: $("year"), startDay: $("startDay"), endDay: $("endDay"),
    dayStart: $("dayStart"), classList: $("classList"), addClass: $("addClass"),
    classError: $("classError"),
    generate: $("generate"), status: $("status"),
    hoursPanel: $("hoursPanel"), hpNote: $("hpNote"),
    hpClassRow: $("hpClassRow"), hpClassVal: $("hpClassVal"),
    hpStudyRow: $("hpStudyRow"), hpStudyVal: $("hpStudyVal"),
    hpTotalLabel: $("hpTotalLabel"), hpTotalVal: $("hpTotalVal"),
    howToBtn: $("howToBtn"), howToOverlay: $("howToOverlay"),
    howToClose: $("howToClose")
  };

  // Each blank PDF is downloaded once and kept, so repeat generates are quick.
  var blankBytes = {};

  /* ======================== BUILDING THE DROPDOWNS ==========================
   * Fills the month and year boxes (defaulting to the current month) and the
   * optional start/end day lists used for a partial month.
   */

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

  /* ========================== THE CLASS LIST ================================
   * Each class is one block on the page: its code, its automatic start/end
   * times, and the "meets at set times" tick box. Ticking that box opens a
   * small day/start/end editor underneath, which can hold several days.
   * Every control here calls refreshPlaceholders() so the displayed times and
   * the hours summary update as soon as anything changes.
   */

  var DAY_OPTIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function addMeetingRow(item) {
    var list = item.querySelector(".meeting-list");
    var row = document.createElement("div");
    row.className = "meeting-row";
    var dayOpts = '<option value="">Day</option>';
    DAY_OPTIONS.forEach(function (d, i) {
      dayOpts += '<option value="' + i + '">' + d + "</option>";
    });
    row.innerHTML =
      '<select class="m-day" aria-label="Day">' + dayOpts + "</select>" +
      '<input class="m-start" type="time" aria-label="Starts" />' +
      '<input class="m-end" type="time" aria-label="Ends" />' +
      '<button class="del" type="button" title="Remove this day">×</button>';
    row.querySelector(".del").addEventListener("click", function () {
      row.remove();
      refreshPlaceholders();
    });
    list.appendChild(row);
    return row;
  }

  function addClassRow(code) {
    var item = document.createElement("div");
    item.className = "class-item";
    item.innerHTML =
      '<div class="class-row">' +
        '<input class="c-code" type="text" placeholder="e.g. ACC 201" autocomplete="off" />' +
        '<input class="c-start" type="text" placeholder="auto" inputmode="numeric" />' +
        '<input class="c-end" type="text" placeholder="auto" inputmode="numeric" />' +
        '<button class="del" type="button" title="Remove">×</button>' +
      "</div>" +
      '<label class="check meets-line">' +
        '<input class="c-meets" type="checkbox" /> Does this class meet at set times?' +
      "</label>" +
      '<div class="meetings" hidden>' +
        '<div class="meeting-head"><span>Day</span><span>Starts</span><span>Ends</span><span></span></div>' +
        '<div class="meeting-list"></div>' +
        '<button class="add-meeting ghost small" type="button">+ Add another day</button>' +
        '<p class="meet-hint" hidden>Add this class’s meeting day and time.</p>' +
      "</div>";
    item.querySelector(".c-code").value = code || "";
    item.querySelector(".class-row .del").addEventListener("click", function () {
      item.remove();
      refreshPlaceholders();
    });
    var meets = item.querySelector(".c-meets");
    var meetings = item.querySelector(".meetings");
    meets.addEventListener("change", function () {
      item.classList.toggle("scheduled", meets.checked);
      meetings.hidden = !meets.checked;
      if (meets.checked && !item.querySelector(".meeting-row")) addMeetingRow(item);
      refreshPlaceholders();
    });
    item.querySelector(".add-meeting").addEventListener("click", function () {
      addMeetingRow(item);
      refreshPlaceholders();
    });
    item.addEventListener("input", refreshPlaceholders);
    item.addEventListener("change", refreshPlaceholders);
    el.classList.appendChild(item);
    return item;
  }

  /* ===================== READING THE PAGE INTO ONE OBJECT ===================
   * Gathers everything typed on the page into the single plain object that
   * schedule.js expects. A class with the tick box on becomes a list of
   * meetings; a class without it is left for the tool to time automatically.
   */

  // True once a row has at least one meeting with a day, a start and an end.
  function hasCompleteMeeting(item) {
    return Array.prototype.slice.call(item.querySelectorAll(".meeting-row")).some(function (mr) {
      return mr.querySelector(".m-day").value !== "" &&
             Sched.parseTime(mr.querySelector(".m-start").value) != null &&
             Sched.parseTime(mr.querySelector(".m-end").value) != null;
    });
  }

  function readClasses() {
    var items = Array.prototype.slice.call(el.classList.querySelectorAll(".class-item"));
    var out = [];
    items.forEach(function (item) {
      var code = item.querySelector(".c-code").value.trim();
      if (!code) return;
      var meets = item.querySelector(".c-meets").checked;
      if (meets) {
        // Scheduled class: collect the completed meeting entries.
        var meetings = [];
        var incomplete = 0;
        Array.prototype.slice.call(item.querySelectorAll(".meeting-row")).forEach(function (mr) {
          var day = mr.querySelector(".m-day").value;
          var s = Sched.parseTime(mr.querySelector(".m-start").value);
          var e = Sched.parseTime(mr.querySelector(".m-end").value);
          if (day !== "" && s != null && e != null) {
            meetings.push({ day: parseInt(day, 10), startMin: s, endMin: e });
          } else if (day !== "" || s != null || e != null) {
            incomplete++;
          }
        });
        out.push({ code: code, meetsSetTimes: true, meetings: meetings, incompleteMeetings: incomplete });
      } else {
        var startMin = Sched.parseTime(item.querySelector(".c-start").value);
        var endMin = Sched.parseTime(item.querySelector(".c-end").value);
        out.push({
          code: code,
          startMin: startMin != null ? startMin : null,
          endMin: endMin != null ? endMin : null
        });
      }
    });
    return out;
  }

  function buildConfig() {
    var dayStartMin = Sched.parseTime(el.dayStart.value);
    if (dayStartMin == null) dayStartMin = 8 * 60;
    return {
      name: el.name.value.trim(),
      institution: el.institution.value.trim(),
      classes: readClasses(),
      dayStartMin: dayStartMin,
      blockMinutes: BLOCK_MINUTES,
      month: parseInt(el.month.value, 10),
      year: parseInt(el.year.value, 10),
      startDay: el.startDay.value ? parseInt(el.startDay.value, 10) : null,
      endDay: el.endDay.value ? parseInt(el.endDay.value, 10) : null
    };
  }

  /* ========================= KEEPING THE PAGE FRESH =========================
   * Runs after every change anywhere in the class list. It asks schedule.js
   * for the current timetable and writes the resulting times back into each
   * class row, so the screen always agrees with what the PDFs will say. If two
   * set-time classes clash it shows the message under the list instead.
   */

  function showClassError(message) {
    el.classError.textContent = message || "";
    el.classError.hidden = !message;
  }

  function refreshPlaceholders() {
    var cfg = buildConfig();
    var tmpl = Sched.buildWeekTemplate(cfg);
    if (tmpl.error) {
      showClassError(tmpl.error.message);
      renderHoursPanel(cfg, null);
      return;
    }
    showClassError(null);
    var items = Array.prototype.slice.call(el.classList.querySelectorAll(".class-item"));

    // A row set to "meets at set times" but with nothing entered yet gets a
    // one-line nudge, so the space that opens up under it is explained.
    items.forEach(function (item) {
      var hint = item.querySelector(".meet-hint");
      if (hint) hint.hidden = !(item.querySelector(".c-meets").checked && !hasCompleteMeeting(item));
    });

    var ci = 0; // index into cfg.classes (rows with a code)
    items.forEach(function (item) {
      var code = item.querySelector(".c-code").value.trim();
      if (!code) return;
      var ph = tmpl.asyncPlaceholders[ci++];
      if (!ph) return; // scheduled class: its times come from the meetings
      item.querySelector(".c-start").placeholder = Sched.formatTime(ph.startMin);
      item.querySelector(".c-end").placeholder = Sched.formatTime(ph.endMin);
    });
    renderHoursPanel(cfg, tmpl);
  }

  /* ========================== THE HOURS SUMMARY =============================
   * The panel under the class list. Its numbers come from the same timetable
   * the PDFs are built from, so it can never quietly disagree with them.
   * With no forms ticked it greys out and previews what all of them would
   * document. It is informational only — required hours vary by situation.
   */
  function renderHoursPanel(cfg, tmpl) {
    if (!cfg) cfg = buildConfig();
    if (tmpl === undefined) tmpl = Sched.buildWeekTemplate(cfg);
    var broken = !tmpl || tmpl.error;
    var classMin = broken ? 0 : tmpl.classWeekMin;
    var studyMin = broken ? 0 : tmpl.studyWeekMin;

    var want816 = el.form816.checked;
    var wantStudy = el.form819.checked || el.form817.checked;
    var anyForm = want816 || wantStudy;

    // With no forms checked, preview what all categories would document.
    var showClass = anyForm ? want816 : true;
    var showStudy = anyForm ? wantStudy : true;
    var totalMin = (showClass ? classMin : 0) + (showStudy ? studyMin : 0);

    el.hpClassRow.hidden = !showClass;
    el.hpStudyRow.hidden = !showStudy;
    el.hpClassVal.textContent = broken ? "—" : Sched.formatTotal(classMin) + " hrs/week";
    el.hpStudyVal.textContent = broken ? "—" : Sched.formatTotal(studyMin) + " hrs/week";
    el.hpTotalVal.textContent = broken ? "—" : Sched.formatTotal(totalMin) + " hrs/week";
    el.hpTotalLabel.textContent = anyForm ? "Total documented" : "Total they would document";
    el.hpNote.hidden = anyForm;
    el.hoursPanel.classList.toggle("preview", !anyForm);
  }

  /* ====================== FETCHING AND SAVING THE PDFS ======================
   * The blank forms sit next to this page and are fetched once each. Finished
   * files are handed to the browser as ordinary downloads.
   */

  async function getBlank(form) {
    if (blankBytes[form.key]) return blankBytes[form.key];
    var resp = await fetch(encodeURI(form.blank));
    if (!resp.ok) throw new Error("Could not load " + form.blank + " (" + resp.status + ")");
    var buf = await resp.arrayBuffer();
    blankBytes[form.key] = new Uint8Array(buf);
    return blankBytes[form.key];
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

  /* ============================ MAKING THE PDFS =============================
   * Checks the entries first and refuses with a plain message if something is
   * missing or two set-time classes clash. Then it works out the timetable
   * once and fills every ticked form from it. Downloads are spaced slightly
   * apart because browsers drop files that arrive all at once.
   */

  async function generate() {
    var wanted = FORMS.filter(function (f) { return $(f.checkbox).checked; });
    if (!wanted.length) {
      setStatus("Select at least one form to generate.", "err"); return;
    }

    var cfg = buildConfig();
    if (!cfg.classes.length) { setStatus("Add at least one class.", "err"); return; }
    if (!cfg.name) { setStatus("Enter the student name first.", "err"); return; }
    if (isNaN(cfg.month) || isNaN(cfg.year)) { setStatus("Pick a month and year.", "err"); return; }
    if (cfg.startDay && cfg.endDay && cfg.startDay > cfg.endDay) {
      setStatus("Start day is after end day.", "err"); return;
    }
    for (var ci = 0; ci < cfg.classes.length; ci++) {
      var cc = cfg.classes[ci];
      if (cc.meetsSetTimes && !cc.meetings.length) {
        setStatus("“" + cc.code + "” is set to meet at set times — add its day and times.", "err");
        return;
      }
      if (cc.meetsSetTimes && cc.incompleteMeetings) {
        setStatus("One of the meeting days for “" + cc.code + "” is missing its day or times.", "err");
        return;
      }
    }

    el.generate.disabled = true;
    setStatus("Generating…");
    try {
      var res = Sched.compute(cfg);
      if (res.error) {
        showClassError(res.error.message);
        setStatus(res.error.message, "err");
        return;
      }
      var header = {
        name: cfg.name,
        institution: cfg.institution,
        monthYear: res.monthYearLabel
      };

      // Fill each ticked form from the same computed rows. Filenames are
      // <form>_<last name>_<Mon><year>.pdf, e.g. DHS816_Attendance_Lee_Aug2026.pdf
      var ln = lastName(cfg.name);
      var tag = res.monAbbr + cfg.year;
      var jobs = []; // { bytes, filename, overflow }
      for (var fi = 0; fi < wanted.length; fi++) {
        var form = wanted[fi];
        var blank = await getBlank(form);
        var out = await Fill.fill(window.PDFLib, blank, form.key, header, res[form.rows]);
        jobs.push({
          bytes: out.bytes,
          filename: form.prefix + ln + "_" + tag + ".pdf",
          overflow: out.overflow
        });
      }

      // Stagger the downloads so browsers don't drop the later files.
      var overflow = 0;
      jobs.forEach(function (job, i) {
        overflow += job.overflow;
        setTimeout(function () { download(job.bytes, job.filename); }, i * 350);
      });

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

  /* ========================= THE "HOW TO USE" WINDOW ========================
   * The pop-up behind the "How to use" button. Closes on Escape or on a click
   * outside it, and keeps keyboard focus inside while it is open so it can be
   * used without a mouse.
   */

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

  /* ============================== STARTUP ===================================
   * Runs once when the page loads: builds the dropdowns, adds the first empty
   * class row, wires up the buttons, and pre-fetches the blank PDFs.
   */

  function init() {
    fillMonthYear();
    fillDayDropdowns();
    addClassRow(""); // start empty: one placeholder row reading "e.g. ACC 201"
    refreshPlaceholders();

    el.addClass.addEventListener("click", function () { addClassRow(""); refreshPlaceholders(); });
    el.dayStart.addEventListener("input", refreshPlaceholders);
    [el.form816, el.form819, el.form817].forEach(function (n) {
      n.addEventListener("change", function () { renderHoursPanel(); });
    });
    el.generate.addEventListener("click", generate);
    setupHowTo();

    // Fetch the blank PDFs now so the first Generate is instant, and so a
    // missing file shows up straight away rather than at download time.
    FORMS.forEach(function (f) { getBlank(f).catch(function () {}); });
  }

  /*
   * If a script failed to load (stale cache, interrupted sync, bad deploy) the page
   * would otherwise sit there looking normal but completely inert. Surface it instead.
   */
  function fatal(msg) {
    var box = document.createElement("p");
    box.className = "class-error";
    box.setAttribute("role", "alert");
    box.textContent = "This page didn’t load correctly — " + msg +
      " Please refresh the page (Ctrl+Shift+R, or Cmd+Shift+R on a Mac).";
    var host = $("classList") || document.body;
    host.parentNode.insertBefore(box, host);
  }

  function boot() {
    if (!Sched || !Fill) {
      fatal("some of its files are missing or out of date.");
      return;
    }
    try {
      init();
    } catch (e) {
      console.error(e);
      fatal("it hit an error while starting up (" + e.message + ").");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
