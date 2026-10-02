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
    month: $("month"), year: $("year"),
    startDate: $("startDate"), endDate: $("endDate"),
    periodHint: $("periodHint"), dateError: $("dateError"),
    dayStart: $("dayStart"), classList: $("classList"), addClass: $("addClass"),
    classError: $("classError"),
    generate: $("generate"), status: $("status"),
    hoursPanel: $("hoursPanel"), hpNote: $("hpNote"),
    hpPeriodVal: $("hpPeriodVal"),
    hpClassRow: $("hpClassRow"), hpClassVal: $("hpClassVal"),
    hpStudyRow: $("hpStudyRow"), hpStudyVal: $("hpStudyVal"),
    hpTotalLabel: $("hpTotalLabel"), hpTotalVal: $("hpTotalVal"),
    howToBtn: $("howToBtn"), howToOverlay: $("howToOverlay"),
    howToClose: $("howToClose")
  };

  // Each blank PDF is downloaded once and kept, so repeat generates are quick.
  var blankBytes = {};

  /* ====================== THE REPORT PERIOD CONTROLS ========================
   * First-To-Work reports whole Sunday-to-Saturday weeks, and a week counts
   * for the month its FRIDAY falls in — so the September 2026 form runs
   * Su 8/30 to Sa 9/26. schedule.js works every span out from that one rule;
   * this only shows it.
   *
   * The month list carries each span beside its name, and the optional custom
   * clip is a pair of ordinary date boxes bounded to the chosen period. They
   * are dates rather than day numbers because a period can straddle two
   * calendar months, where a bare "30" would be ambiguous.
   */

  function currentPeriod() {
    var m = parseInt(el.month.value, 10);
    var y = parseInt(el.year.value, 10);
    if (isNaN(m) || isNaN(y)) return null;
    return Sched.reportPeriod(y, m);
  }

  function fillMonthYear() {
    var now = new Date();
    Sched.MONTHS.forEach(function (m, i) {
      var o = document.createElement("option");
      o.value = i; o.textContent = m;
      el.month.appendChild(o);
    });
    el.month.value = now.getMonth();
    el.year.value = now.getFullYear();
    labelMonths();
  }

  /*
   * Each month option reads "September 2026 (Aug 30–Sep 26)". The spans depend
   * on the year, so the labels are rewritten whenever the year changes.
   */
  function labelMonths() {
    var y = parseInt(el.year.value, 10);
    Array.prototype.slice.call(el.month.options).forEach(function (o, i) {
      o.textContent = isNaN(y)
        ? Sched.MONTHS[i]
        : Sched.MONTHS[i] + " " + y + " (" + Sched.reportPeriod(y, i).label + ")";
    });
  }

  /*
   * Point the custom date boxes at the chosen period: bounded to it, and
   * — when the period itself changed — reset to its full span, which is the
   * default. The hint underneath explains the period in the student's terms.
   */
  function syncPeriodDates(resetToFullPeriod) {
    var p = currentPeriod();
    [el.startDate, el.endDate].forEach(function (inp) {
      inp.min = p ? p.startISO : "";
      inp.max = p ? p.endISO : "";
    });
    if (p && resetToFullPeriod) {
      el.startDate.value = p.startISO;
      el.endDate.value = p.endISO;
    }
    el.periodHint.textContent = p
      ? "First-To-Work weeks run Sunday–Saturday, and a week counts for the month its " +
        "Friday falls in — so the " + Sched.MONTHS[parseInt(el.month.value, 10)] + " " +
        el.year.value + " form covers " + p.label + ". Change the dates only if you need " +
        "part of that period."
      : "Pick a month and year to see the period the form will cover.";
    checkDates();
  }

  function showDateError(message) {
    el.dateError.textContent = message || "";
    el.dateError.hidden = !message;
  }

  /*
   * The custom dates have to sit inside the report period, and start cannot
   * come after end. Browsers enforce min/max on the picker but will still take
   * a typed-in date, so it is checked here too. Returns true when they are
   * usable; Generate refuses while they are not.
   */
  function checkDates() {
    var p = currentPeriod();
    if (!p) { showDateError(null); return true; }
    var from = el.startDate.value;
    var until = el.endDate.value;
    // ISO dates sort as plain text, so these comparisons are exact.
    var outside = (from && (from < p.startISO || from > p.endISO)) ||
                  (until && (until < p.startISO || until > p.endISO));
    if (outside) {
      showDateError("That date is outside the " + Sched.MONTHS[parseInt(el.month.value, 10)] +
        " " + el.year.value + " report period (" + p.label + ") — pick a date inside it.");
      return false;
    }
    if (from && until && from > until) {
      showDateError("Start date is after end date.");
      return false;
    }
    showDateError(null);
    return true;
  }

  // "2026-09-06" -> "9/6", for the quiet note about a narrowed period.
  function shortDate(iso) {
    var parts = String(iso).split("-");
    if (parts.length !== 3) return iso;
    return parseInt(parts[1], 10) + "/" + parseInt(parts[2], 10);
  }

  /* ========================== THE CLASS LIST ================================
   * Each class is one block on the page: its code, how many credits it carries,
   * its automatic start/end times, and the "meets at set times" tick box.
   * Ticking that box opens a small day/start/end editor underneath, which can
   * hold several days, and — when the class meets for fewer hours than it
   * carries in credits — a quiet note and one switch offering to add the rest.
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
      '<label class="field-day"><span class="field-caption">Day</span><select class="m-day">' + dayOpts + "</select></label>" +
      '<label class="field-start"><span class="field-caption">Starts</span><input class="m-start" type="time" /></label>' +
      '<label class="field-end"><span class="field-caption">Ends</span><input class="m-end" type="time" /></label>' +
      '<button class="del" type="button" title="Remove this day">×</button>';
    row.querySelector(".del").addEventListener("click", function () {
      row.remove();
      refreshPlaceholders();
    });
    row.insertAdjacentHTML("beforeend", '<details class="meeting-dates"><summary>Meeting dates (optional)</summary><div class="grid2"><label>Meeting starts<input class="m-from" type="date" /></label><label>Meeting ends<input class="m-until" type="date" /></label></div></details>');
    list.appendChild(row);
    return row;
  }

  function addUnavailableTime(group) {
    var row=document.createElement("div");row.className="unavailable-time time-options";
    row.innerHTML='<label>Starts<input class="u-start" type="time" /></label>'+
      '<label>Ends<input class="u-end" type="time" /></label>'+
      '<button type="button" class="ghost remove-time">Remove time</button>';
    row.querySelector(".remove-time").addEventListener("click",function(){row.remove();refreshPlaceholders();});
    group.querySelector(".unavailable-times").appendChild(row);
  }

  function addUnavailableRow() {
    var row=document.createElement("div");row.className="unavailable-row";
    row.innerHTML='<fieldset><legend>Unavailable days</legend>'+DAY_OPTIONS.map(function(day,i){
      return '<label class="check"><input type="checkbox" value="'+i+'" />'+day+'</label>';
    }).join("")+'</fieldset><p class="hint">Every time below applies to all selected days.</p>'+
      '<div class="unavailable-times"></div><div class="unavailable-actions">'+
      '<button type="button" class="ghost small add-unavailable-time">+ Add time</button>'+
      '<button type="button" class="ghost small remove-unavailable-group">Remove these days and times</button></div>';
    row.querySelector(".remove-unavailable-group").addEventListener("click",function(){row.remove();refreshPlaceholders();});
    row.querySelector(".add-unavailable-time").addEventListener("click",function(){addUnavailableTime(row);refreshPlaceholders();});
    addUnavailableTime(row);
    row.addEventListener("input",refreshPlaceholders);row.addEventListener("change",refreshPlaceholders);
    $("unavailableList").appendChild(row);
    refreshPlaceholders();
  }
  function readUnavailable() {
    var out=[];
    $("unavailableList").querySelectorAll(".unavailable-row").forEach(function(row){
      var days=row.querySelectorAll('input[type="checkbox"]:checked');
      var times=row.querySelectorAll(".unavailable-time");
      if(!times.length)out.push({day:null,startMin:null,endMin:null});
      times.forEach(function(time){
        var start=Sched.parseTime(time.querySelector(".u-start").value),end=Sched.parseTime(time.querySelector(".u-end").value);
        // Native clocks represent midnight as 00:00; unavailable ends mean day's end.
        if(end===0)end=1440;
        if(!days.length)out.push({day:null,startMin:start,endMin:end});
        days.forEach(function(day){out.push({day:Number(day.value),startMin:start,endMin:end});});
      });
    });return out;
  }
  function addStudySlot(item) {
    var row=document.createElement("div");row.className="study-slot time-options";
    row.innerHTML='<label>Study day<select class="s-day"><option value="">Day</option>'+DAY_OPTIONS.map(function(d,i){return '<option value="'+i+'">'+d+'</option>';}).join("")+'</select></label>'+
      '<label>Starts<input class="s-start" type="text" placeholder="7:00p" /></label>'+
      '<label>Hours <span class="opt">(optional)</span><input class="s-hours" type="number" min="0.0167" step="any" placeholder="Automatic share" /></label>'+
      '<button type="button" class="ghost remove-time">Remove</button>';
    row.querySelector(".remove-time").addEventListener("click",function(){row.remove();refreshPlaceholders();});
    item.querySelector(".study-slots").appendChild(row);
  }

  function addClassRow(code) {
    var item = document.createElement("div");
    item.className = "class-item";
    var creditOpts = "";
    Sched.CREDIT_OPTIONS.forEach(function (n) {
      creditOpts += '<option value="' + n + '">' + n + "</option>";
    });
    item.innerHTML =
      '<div class="class-row">' +
        '<label class="field-code"><span class="field-caption">Class code</span><input class="c-code" type="text" placeholder="e.g. ACC 201" autocomplete="off" /></label>' +
        '<label class="field-credits"><span class="field-caption">Credits</span><select class="c-credits">' + creditOpts + "</select></label>" +
        '<label class="field-start"><span class="field-caption">Start (auto)</span><input class="c-start" type="text" placeholder="auto" inputmode="numeric" /></label>' +
        '<label class="field-end"><span class="field-caption">End (auto)</span><input class="c-end" type="text" placeholder="auto" inputmode="numeric" /></label>' +
        '<button class="del" type="button" title="Remove">×</button>' +
      "</div>" +
      '<label class="check meets-line">' +
        '<input class="c-meets" type="checkbox" /> Does this class meet in person or online at scheduled times?' +
      "</label>" +
      '<div class="meetings" hidden>' +
        '<div class="meeting-head"><span>Day</span><span>Starts</span><span>Ends</span><span></span></div>' +
        '<div class="meeting-list"></div>' +
        '<button class="add-meeting ghost small" type="button">+ Add another day</button>' +
        '<p class="meet-hint" hidden>Add this class’s meeting day and time.</p>' +
        '<div class="remainder" hidden>' +
          '<p class="remainder-note"></p>' +
          '<label class="check remainder-line">' +
            '<input class="c-remainder" type="checkbox" /> Include additional approved class hours' +
          "</label>" +
          '<p class="hint">For online activities counted as class time, such as recorded lectures.</p>' +
        "</div>" +
      "</div>";
    item.insertAdjacentHTML("beforeend", '<label class="check meets-line"><input class="c-custom-study" type="checkbox" /> Choose study times</label>'+
      '<div class="custom-study" hidden><p class="hint">Choose a day and start time; the end is calculated. One time gets the full weekly study allowance. '+
      'With multiple times, leave all Hours blank to divide it evenly. Enter Hours to request a specific duration for a time. '+
      'If a preferred time cannot fit, study moves to another available opening in the same week.</p><div class="study-slots"></div>'+
      '<button type="button" class="ghost small add-study">+ Add study time</button></div>'+
      '<details class="study-preview"><summary>Scheduled study times</summary><div class="study-preview-content hint"></div></details>');
    item.querySelector(".c-custom-study").addEventListener("change",function(){
      item.querySelector(".custom-study").hidden=!this.checked;
      if(this.checked&&!item.querySelector(".study-slot"))addStudySlot(item);
      refreshPlaceholders();
    });
    item.querySelector(".add-study").addEventListener("click",function(){addStudySlot(item);refreshPlaceholders();});
    item.insertAdjacentHTML("beforeend", '<details class="course-dates"><summary>Course dates (optional)</summary><p class="hint">Retained when you switch report months. Attendance and study stay within these dates.</p><div class="grid2"><label>Course starts<input class="c-from" type="date" /></label><label>Course ends<input class="c-until" type="date" /></label></div></details>');
    item.querySelector(".c-code").value = code || "";
    item.querySelector(".c-credits").value = String(Sched.DEFAULT_CREDITS);
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
   * Credits determine automatic async attendance and flexible allowances;
   * both study forms follow the resulting attendance.
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
      var credits = parseInt(item.querySelector(".c-credits").value, 10);
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
            meetings.push({ day: parseInt(day, 10), startMin: s, endMin: e, startDate: mr.querySelector(".m-from").value, endDate: mr.querySelector(".m-until").value });
          } else if (day !== "" || s != null || e != null) {
            incomplete++;
          }
        });
        out.push({
          code: code,
          credits: credits,
          meetsSetTimes: true,
          meetings: meetings,
          incompleteMeetings: incomplete,
          addRemainder: item.querySelector(".c-remainder").checked
        });
      } else {
        var startMin = Sched.parseTime(item.querySelector(".c-start").value);
        var endMin = Sched.parseTime(item.querySelector(".c-end").value);
        out.push({
          code: code,
          credits: credits,
          startMin: startMin != null ? startMin : null,
          endMin: endMin != null ? endMin : null
        });
      }
      var cl=out[out.length-1];
      cl.startDate=item.querySelector(".c-from").value;
      cl.endDate=item.querySelector(".c-until").value;
      cl.customStudy=item.querySelector(".c-custom-study").checked;
      cl.studySlots=Array.prototype.map.call(item.querySelectorAll(".study-slot"),function(row){
        var day=row.querySelector(".s-day").value;
        var hours=Number(row.querySelector(".s-hours").value);
        return {day:day===""?null:Number(day),startMin:Sched.parseTime(row.querySelector(".s-start").value),minutes:hours>0?Math.round(hours*60):null};
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
      classes: readClasses(),
      unavailable: readUnavailable(),
      dayStartMin: dayStartMin,
      blockMinutes: BLOCK_MINUTES,
      month: parseInt(el.month.value, 10),
      year: parseInt(el.year.value, 10),
      startDate: el.startDate.value || null,
      endDate: el.endDate.value || null
    };
  }

  /* ========================= KEEPING THE PAGE FRESH =========================
   * Runs after every change anywhere in the class list. It asks schedule.js
   * for the current timetable and writes the resulting times back into each
   * class row. The hours and expanded study preview use the actual dated rows;
   * invalid entries and unplaced hours appear as notices without blocking downloads.
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
      var idx = ci++;
      showRemainderOffer(item, tmpl.classInfo[idx]);
      var ph = tmpl.asyncPlaceholders[idx];
      item.querySelector(".c-start").placeholder="auto";
      item.querySelector(".c-end").placeholder="auto";
      if (!ph) return; // scheduled class or no available attendance slot
      item.querySelector(".c-start").placeholder = Sched.formatTime(ph.startMin);
      item.querySelector(".c-end").placeholder = Sched.formatTime(ph.endMin);
    });
    renderHoursPanel(cfg, tmpl);
  }

  /*
   * The quiet note and the one switch on a scheduled class row. It appears only
   * when the class meets for fewer hours than it carries in credits, which is
   * the only time there is anything to add. The switch stays off unless the
   * student turns it on; with it off the class documents its real meetings and
   * nothing else. The numbers come straight from the engine, so the note can
   * never disagree with the forms.
   */
  function showRemainderOffer(item, info) {
    var box = item.querySelector(".remainder");
    if (!box) return;
    var offer = !!info && info.scheduled && info.shortfallMin > 0;
    box.hidden = !offer;
    if (!offer) return;
    box.querySelector(".remainder-note").textContent =
      "This class meets " + Sched.formatTotal(info.meetingMin) + " of its " +
      info.credits + (info.credits === 1 ? " credit hour. " : " credit hours. ") +
      "Adds " + Sched.formatTotal(info.shortfallMin) + " hours per week to reach " +
      info.credits + " class hours (before holiday adjustments).";
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
    var dated = tmpl && !tmpl.error ? Sched.compute(cfg) : null;
    var broken = !dated || dated.error;
    var notices=dated&&!dated.error ? (dated.warnings || []).slice() : [];
    if(dated&&!dated.error)(dated.shortfalls || []).forEach(function(s){
      notices.push("Week of "+s.week+": "+s.code+" — "+Sched.formatTotal(s.minutes)+" "+s.kind+" hours could not fit. These hours are not on the forms.");
    });
    $("scheduleNotices").replaceChildren();
    notices.forEach(function(message){var p=document.createElement("p");p.textContent=message;$("scheduleNotices").appendChild(p);});
    $("scheduleNotices").hidden=!notices.length;
    var previewIndex=0;
    Array.prototype.forEach.call(el.classList.querySelectorAll(".class-item"),function(item){
      var code=item.querySelector(".c-code").value.trim();
      var host=item.querySelector(".study-preview-content");host.replaceChildren();
      if(!code||broken)return;
      var ix=previewIndex++;
      var rows=dated.studyRows.filter(function(r){return r.classIndex===ix;});
      if(!rows.length){host.textContent="No study time is scheduled for these dates.";return;}
      rows.forEach(function(r){var line=document.createElement("div");line.textContent=r.dateFull+": "+r.start+"–"+r.end+" ("+r.total+" hrs)";host.appendChild(line);});
    });
    var classMin = broken ? 0 : dated.attendanceRows.reduce(function (sum, row) { return sum + row.hours * 60; }, 0);
    var studyMin = broken ? 0 : dated.studyRows.reduce(function (sum, row) { return sum + row.hours * 60; }, 0);

    /*
     * One plain line of context: how many FTW weeks the chosen month covers
     * and the dates they run between. It states what the form spans and
     * nothing more — whether that is enough hours is between the student and
     * their case manager. If the dates below have been narrowed, that is noted
     * quietly on the end rather than changing the period itself.
     */
    var period = (!isNaN(cfg.month) && !isNaN(cfg.year))
      ? Sched.reportPeriod(cfg.year, cfg.month) : null;
    if (!period) {
      el.hpPeriodVal.textContent = "\u2014";
    } else {
      var line = period.weeks + " FTW week" + (period.weeks === 1 ? "" : "s") +
        " (" + period.label + ")";
      var from = cfg.startDate || period.startISO;
      var until = cfg.endDate || period.endISO;
      if (from !== period.startISO || until !== period.endISO) {
        line += " \u00b7 using " + shortDate(from) + "\u2013" + shortDate(until);
      }
      el.hpPeriodVal.textContent = line;
    }

    var want816 = el.form816.checked;
    var wantStudy = el.form819.checked || el.form817.checked;
    var anyForm = want816 || wantStudy;

    // With no forms checked, preview what all categories would document.
    var showClass = anyForm ? want816 : true;
    var showStudy = anyForm ? wantStudy : true;
    var totalMin = (showClass ? classMin : 0) + (showStudy ? studyMin : 0);

    el.hpClassRow.hidden = !showClass;
    el.hpStudyRow.hidden = !showStudy;
    el.hpClassVal.textContent = broken ? "—" : Sched.formatTotal(classMin) + " hrs/period";
    el.hpStudyVal.textContent = broken ? "—" : Sched.formatTotal(studyMin) + " hrs/period";
    el.hpTotalVal.textContent = broken ? "—" : Sched.formatTotal(totalMin) + " hrs/period";
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

  /*
   * A month too big for one copy of a form continues into a second file.
   * pdffill.js does the cutting (it is the one that knows each form's row
   * capacity); this only names the files. The first copy keeps the plain
   * filename, each later one is marked "_continued".
   */
  function partSuffix(index) {
    if (index === 0) return "";
    return index === 1 ? "_continued" : "_continued" + index;
  }

  /* ============================ MAKING THE PDFS =============================
   * Checks the entries first and refuses with a plain message if something is
   * required identifying information is missing. Then it works out the timetable
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
    if (!checkDates()) { setStatus(el.dateError.textContent, "err"); return; }
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
      // A month too big for one copy of a form continues into a second file
      // with "_continued" on the end rather than losing the extra rows.
      var ln = lastName(cfg.name);
      var tag = res.monAbbr + cfg.year;
      var jobs = [];      // { bytes, filename }
      var continued = 0;  // extra copies needed beyond the first of each form
      for (var fi = 0; fi < wanted.length; fi++) {
        var form = wanted[fi];
        var blank = await getBlank(form);
        var parts = Fill.splitIntoForms(res[form.rows], form.key);
        continued += parts.length - 1;
        for (var pi = 0; pi < parts.length; pi++) {
          var out = await Fill.fill(window.PDFLib, blank, form.key, header, parts[pi]);
          jobs.push({
            bytes: out.bytes,
            filename: form.prefix + ln + "_" + tag + partSuffix(pi) + ".pdf"
          });
        }
      }

      // Stagger the downloads so browsers don't drop the later files.
      jobs.forEach(function (job, i) {
        setTimeout(function () { download(job.bytes, job.filename); }, i * 350);
      });

      var schedulingNote = (res.shortfalls.length || res.warnings.length)
        ? " Review the scheduling notices above; the PDFs contain the hours that could be recorded." : "";
      var noun = jobs.length === 1 ? "PDF" : jobs.length + " PDFs";
      if (continued > 0) {
        setStatus("Done. " + noun + " downloaded. " + res.monthYearLabel + " needs more rows " +
          "than one copy of the form holds, so the rest are in the file" +
          (continued === 1 ? "" : "s") + " ending “_continued” — sign and submit " +
          (continued === 1 ? "it" : "them") + " too." + schedulingNote, "warn");
      } else {
        setStatus("Done. " + noun + " downloaded. Sign them in Adobe after opening." + schedulingNote, schedulingNote ? "warn" : "ok");
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

  function setupImport() {
    var fileInput=$("scheduleFile"),status=$("importStatus"),review=$("importReview"),originalUrl;
    function field(host,label,value,type) {
      var wrap=document.createElement("label");wrap.textContent=label;
      var input=document.createElement("input");input.type=type || "text";input.value=value == null ? "" : value;
      wrap.appendChild(input);host.appendChild(wrap);return input;
    }
    fileInput.addEventListener("change",async function(){
      var file=fileInput.files[0];if(!file)return;
      review.replaceChildren();review.hidden=true;fileInput.disabled=true;
      try {
        var reader=await import("./import-reader.mjs?v=7.1.1");
        var result=await reader.readSchedule(file,function(message){status.textContent=message;});
        if(!result.courses.length)throw new Error("No supported course entries were found. Try the STAR print view, or enter your classes manually.");
        status.textContent="Found "+result.courses.length+" courses across "+result.pages+" pages."+(result.ocr?" Scanned text was recognized: check every field against the original.":" Review before using this information.");
        if(originalUrl)URL.revokeObjectURL(originalUrl);originalUrl=URL.createObjectURL(file);
        var source=document.createElement("a");source.href=originalUrl;source.target="_blank";source.rel="noopener";source.textContent="Open original schedule for comparison";review.appendChild(source);
        var info=document.createElement("div");info.className="grid2";review.appendChild(info);
        var name=field(info,"Student name",result.name || el.name.value);
        var institution=field(info,"Institution",result.institution || el.institution.value);
        var entries=result.courses.map(function(c){
          var box=document.createElement("div");box.className="import-course";review.appendChild(box);
          var grid=document.createElement("div");grid.className="grid2";box.appendChild(grid);
          var code=field(grid,"Course code",c.code),credits=field(grid,"Credits",c.credits,"number");credits.min=1;credits.max=4;
          var from=field(grid,"Course starts",c.startDate,"date"),until=field(grid,"Course ends",c.endDate,"date");
          var label=document.createElement("label");label.textContent="Attendance type";
          var mode=document.createElement("select");
          [["async","Async — no scheduled meetings"],["scheduled","Meets at scheduled times"]].forEach(function(pair){var o=document.createElement("option");o.value=pair[0];o.textContent=pair[1];mode.appendChild(o);});
          mode.value=c.mode;label.appendChild(mode);box.appendChild(label);
          var meeting=document.createElement("p");meeting.className="hint";
          meeting.textContent=c.meetings.length?c.meetings.map(function(m){return DAY_OPTIONS[m.day]+" "+Sched.formatTime(m.startMin)+"–"+Sched.formatTime(m.endMin)+" · "+m.startDate+" through "+m.endDate;}).join("; "):"No fixed meeting times were found.";box.appendChild(meeting);
          c.notes.forEach(function(note){var n=document.createElement("p");n.className="class-error";n.textContent=note;box.appendChild(n);});
          var details=document.createElement("details"),summary=document.createElement("summary"),text=document.createElement("pre");summary.textContent="Extracted source text";text.textContent=c.source;details.append(summary,text);box.appendChild(details);
          return {course:c,code:code,credits:credits,from:from,until:until,mode:mode};
        });
        var check=document.createElement("label");check.className="check import-confirm";var confirmed=document.createElement("input");confirmed.type="checkbox";check.append(confirmed,document.createTextNode("I checked the extracted information against my schedule."));review.appendChild(check);
        var apply=document.createElement("button");apply.type="button";apply.className="primary";apply.textContent="Use these classes";review.appendChild(apply);
        var note=document.createElement("p");note.className="hint";note.textContent="Replaces the current class list. Unavailable times, report month and form selection are kept. You can edit all imported information before generating.";review.appendChild(note);
        var issue=document.createElement("p");issue.className="class-error";issue.hidden=true;issue.setAttribute("role","alert");review.appendChild(issue);
        apply.addEventListener("click",function(){
          var error=!confirmed.checked?"Check the review box after comparing with your schedule.":"";
          entries.forEach(function(e){if(!e.code.value.trim()||![1,2,3,4].includes(Number(e.credits.value)))error="Each course needs a code and 1–4 credits.";
            if(e.from.value&&e.until.value&&e.from.value>e.until.value)error="A course start date is after its end date.";});
          if(error){issue.textContent=error;issue.hidden=false;return;}
          el.classList.replaceChildren();el.name.value=name.value.trim();el.institution.value=institution.value.trim();
          entries.forEach(function(e){var item=addClassRow(e.code.value.trim());item.querySelector(".c-credits").value=e.credits.value;
            item.querySelector(".c-from").value=e.from.value;item.querySelector(".c-until").value=e.until.value;
            if(e.mode.value==="scheduled"){
              item.querySelector(".c-meets").checked=true;item.classList.add("scheduled");item.querySelector(".meetings").hidden=false;
              e.course.meetings.forEach(function(m){var row=addMeetingRow(item);row.querySelector(".m-day").value=m.day;
                function time(n){return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");}
                row.querySelector(".m-start").value=time(m.startMin);row.querySelector(".m-end").value=time(m.endMin);
                row.querySelector(".m-from").value=m.startDate;row.querySelector(".m-until").value=m.endDate;});
              if(!e.course.meetings.length)addMeetingRow(item);
            }
          });
          refreshPlaceholders();review.hidden=true;status.textContent="Imported "+entries.length+" courses. Review the class fields and hours below, then generate your selected forms. Additional approved hours remain off.";
        });
        review.hidden=false;
      }catch(error){status.textContent="Import could not finish: "+error.message+" Your existing entries have not changed.";}
      finally{fileInput.disabled=false;}
    });
  }

  /* ============================== STARTUP ===================================
   * Runs once when the page loads: builds the dropdowns, adds the first empty
   * class row, wires up the buttons, and pre-fetches the blank PDFs.
   */

  function init() {
    fillMonthYear();
    syncPeriodDates(true);
    addClassRow(""); // start empty: one placeholder row reading "e.g. ACC 201"
    refreshPlaceholders();

    $("addUnavailable").addEventListener("click",addUnavailableRow);
    el.addClass.addEventListener("click", function () { addClassRow(""); refreshPlaceholders(); });
    el.dayStart.addEventListener("input", refreshPlaceholders);

    // Changing the month or year moves the whole report period, so the date
    // boxes are re-bounded and reset to the new full span.
    el.month.addEventListener("change", function () {
      syncPeriodDates(true); refreshPlaceholders();
    });
    el.year.addEventListener("input", function () {
      labelMonths(); syncPeriodDates(true); refreshPlaceholders();
    });
    [el.startDate, el.endDate].forEach(function (n) {
      n.addEventListener("change", function () { checkDates(); refreshPlaceholders(); });
      n.addEventListener("input", function () { checkDates(); refreshPlaceholders(); });
    });
    [el.form816, el.form819, el.form817].forEach(function (n) {
      n.addEventListener("change", function () { renderHoursPanel(); });
    });
    el.generate.addEventListener("click", generate);
    setupHowTo();
    setupImport();

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
