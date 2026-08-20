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
    classError: $("classError"),
    generate: $("generate"), status: $("status"),
    hoursPanel: $("hoursPanel"), hpNote: $("hpNote"),
    hpClassRow: $("hpClassRow"), hpClassVal: $("hpClassVal"),
    hpStudyRow: $("hpStudyRow"), hpStudyVal: $("hpStudyVal"),
    hpTotalLabel: $("hpTotalLabel"), hpTotalVal: $("hpTotalVal"),
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

  /* ---------- read inputs ---------- */

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

  /* ---------- live auto-time placeholders + inline schedule error ---------- */

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

  /* ---------- live hours panel ---------- */

  // Weekly totals come straight from the real timetable template: class hours
  // are every attendance block in the week (async Mon/Wed blocks + scheduled
  // meetings), study hours are the 1:1 study blocks laid out around them.
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
    [el.form816, el.form819, el.form817].forEach(function (n) {
      n.addEventListener("change", function () { renderHoursPanel(); });
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
