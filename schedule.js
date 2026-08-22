/*
 * schedule.js — pure scheduling + formatting logic for the Bridge to Hope PDF filler.
 * No DOM, no pdf-lib. Shared by the browser app and the Node test harness.
 * Exposed as window.BTHSchedule (browser) and module.exports (node).
 *
 * The tool is a weekly-timetable builder:
 *  - SCHEDULED classes (meetings: [{day, startMin, endMin}]) claim their exact
 *    days and times. Immovable.
 *  - ASYNC classes (no meetings) auto-sequence back-to-back on the default
 *    attendance days (Mon & Wed) from the day start time, skipping any time
 *    interval already claimed by a scheduled class on that day.
 *  - STUDY earns 1:1 with weekly class hours per class, laid out in blocks
 *    (default 1.5 hr, final block adjusted to hit the exact total) on the
 *    default study days (Tue & Thu), overflowing to Fri, Sat, Sun, Mon, Wed.
 * When no class is scheduled, everything reduces exactly to the original
 * Mon/Wed + mirrored Tue/Thu behavior.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BTHSchedule = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  var MON_ABBR = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  var DAY_NAMES = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
  ];

  // Default attendance days for async classes, default study days, and the
  // order extra study days are used when Tue/Thu can't hold everything.
  var ATTEND_DAYS = [1, 3];            // Mon, Wed
  var STUDY_DAYS = [2, 4];             // Tue, Thu
  var STUDY_OVERFLOW = [5, 6, 0, 1, 3]; // Fri, Sat, Sun, Mon, Wed
  var DAY_END_MIN = 24 * 60;           // no block may run past midnight

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  // Minutes-since-midnight -> "H:MM" 12-hour, no AM/PM, no 24h conversion shown.
  // 480 -> "8:00", 810 -> "1:30"? no: 810=13:30 -> "1:30". 840 (14:00) -> "2:00".
  function formatTime(min) {
    var h24 = Math.floor(min / 60);
    var m = min % 60;
    var h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ":" + pad2(m);
  }

  // Parse "H:MM" or "HH:MM" (24h or 12h-without-meridiem as entered) -> minutes.
  function parseTime(str) {
    if (str == null) return null;
    var s = String(str).trim();
    var m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var mm = parseInt(m[2], 10);
    if (isNaN(h) || isNaN(mm) || mm > 59) return null;
    return h * 60 + mm;
  }

  // Decimal hours, trailing zeros stripped: 90 -> "1.5", 120 -> "2", 30 -> "0.5".
  function formatTotal(min) {
    var hrs = min / 60;
    if (Number.isInteger(hrs)) return String(hrs);
    return String(parseFloat(hrs.toFixed(2)));
  }

  // "M/D", no leading zeros.
  function formatDate(d) {
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  // Weekday letter for the form date column. Two letters where one would be
  // ambiguous: M, Tu, W, Th, F, Sa, Su.
  var DAY_ABBR = { 0: "Su", 1: "M", 2: "Tu", 3: "W", 4: "Th", 5: "F", 6: "Sa" };
  function dayAbbr(d) {
    return DAY_ABBR[d.getDay()] || "";
  }

  // "M 6/22", "Tu 6/23" — weekday letter + space + M/D.
  function formatDateWithDay(d) {
    var ab = dayAbbr(d);
    return (ab ? ab + " " : "") + formatDate(d);
  }

  function isScheduled(c) {
    return !!(c.meetings && c.meetings.length);
  }

  /*
   * Build the ordered class blocks for a single day (original async behavior,
   * kept intact for the no-scheduled-classes path and the test harness).
   * classes: [{ code, startMin?, endMin? }]
   */
  function buildBlocks(classes, dayStartMin, blockMinutes) {
    var blocks = [];
    var cursor = dayStartMin;
    for (var i = 0; i < classes.length; i++) {
      var c = classes[i];
      var start = (c.startMin != null) ? c.startMin : cursor;
      var end = (c.endMin != null) ? c.endMin : start + blockMinutes;
      blocks.push({ code: c.code, startMin: start, endMin: end });
      cursor = end; // next class chains off this one's end
    }
    return blocks;
  }

  // First start >= from where [start, start+dur) touches none of the claimed
  // intervals. Intervals need not be sorted.
  function nextFreeStart(from, dur, claimed) {
    var s = from;
    var moved = true;
    while (moved) {
      moved = false;
      for (var i = 0; i < claimed.length; i++) {
        var iv = claimed[i];
        if (s < iv.endMin && iv.startMin < s + dur) {
          s = iv.endMin;
          moved = true;
        }
      }
    }
    return s;
  }

  // Validate scheduled meetings: each must run forward, and no two claimed
  // intervals may overlap on the same day. Returns null or { message }.
  function validateMeetings(classes) {
    var perDay = {}; // day -> [{code, startMin, endMin}]
    for (var i = 0; i < classes.length; i++) {
      var c = classes[i];
      if (!isScheduled(c)) continue;
      for (var j = 0; j < c.meetings.length; j++) {
        var m = c.meetings[j];
        if (m.endMin <= m.startMin) {
          return { message: "Check the times for “" + c.code + "” — its end time must be after its start time." };
        }
        if (!perDay[m.day]) perDay[m.day] = [];
        perDay[m.day].push({ code: c.code, startMin: m.startMin, endMin: m.endMin });
      }
    }
    var days = Object.keys(perDay);
    for (var d = 0; d < days.length; d++) {
      var list = perDay[days[d]].slice().sort(function (a, b) { return a.startMin - b.startMin; });
      for (var k = 1; k < list.length; k++) {
        if (list[k].startMin < list[k - 1].endMin) {
          var dayName = DAY_NAMES[days[d]];
          if (list[k].code === list[k - 1].code) {
            return { message: "“" + list[k].code + "” has two meeting times that overlap on " + dayName + " — check the times." };
          }
          return {
            message: "These two classes overlap on " + dayName + " — check the times. (" +
              list[k - 1].code + " and " + list[k].code + ")"
          };
        }
      }
    }
    return null;
  }

  // Split a class's weekly study minutes into blocks: default-size blocks with
  // the final one shorter or longer so the exact total is always hit.
  function studyChunks(totalMin, blockMinutes) {
    var chunks = [];
    var rem = totalMin;
    while (rem >= blockMinutes * 1.5) {
      chunks.push(blockMinutes);
      rem -= blockMinutes;
    }
    if (rem > 0) chunks.push(rem);
    return chunks;
  }

  /*
   * Build the weekly timetable template from a config.
   * Returns {
   *   error: null | { message },
   *   attendance: [ [ {code,startMin,endMin,scheduled} ] x7 ],   // by getDay()
   *   study:      [ [ {code,startMin,endMin} ] x7 ],
   *   asyncPlaceholders: [ {startMin,endMin} | null per class ], // display only
   *   classWeekMin, studyWeekMin
   * }
   */
  function buildWeekTemplate(config) {
    var blockMinutes = config.blockMinutes || 90;
    var dayStartMin = (config.dayStartMin != null) ? config.dayStartMin : 8 * 60;
    var classes = config.classes || [];
    var d, i, j;

    var error = validateMeetings(classes);
    if (error) return { error: error };

    var attendance = [[], [], [], [], [], [], []];
    var study = [[], [], [], [], [], [], []];
    var asyncClasses = classes.filter(function (c) { return !isScheduled(c); });
    var anyScheduled = classes.length !== asyncClasses.length;

    // 1. Scheduled classes claim their exact days and times. Immovable.
    for (i = 0; i < classes.length; i++) {
      var c = classes[i];
      if (!isScheduled(c)) continue;
      for (j = 0; j < c.meetings.length; j++) {
        var m = c.meetings[j];
        attendance[m.day].push({ code: c.code, startMin: m.startMin, endMin: m.endMin, scheduled: true });
      }
    }

    // 2. Async classes auto-sequence on Mon & Wed, skipping claimed intervals.
    var asyncByDay = {}; // day -> blocks aligned with asyncClasses order
    for (d = 0; d < ATTEND_DAYS.length; d++) {
      var day = ATTEND_DAYS[d];
      var claimed = attendance[day].slice();
      var blocks = [];
      var cursor = dayStartMin;
      for (i = 0; i < asyncClasses.length; i++) {
        var a = asyncClasses[i];
        var start, end;
        if (a.startMin != null) {
          start = a.startMin; // explicit override wins, exactly as before
          end = (a.endMin != null) ? a.endMin : start + blockMinutes;
        } else {
          start = nextFreeStart(cursor, blockMinutes, claimed);
          end = (a.endMin != null) ? a.endMin : start + blockMinutes;
        }
        var b = { code: a.code, startMin: start, endMin: end, scheduled: false };
        blocks.push(b);
        attendance[day].push(b);
        cursor = end;
      }
      asyncByDay[day] = blocks;
    }

    // Sort each day's attendance by start time (stable).
    for (d = 0; d < 7; d++) {
      var withIdx = attendance[d].map(function (b, idx) { return { b: b, idx: idx }; });
      withIdx.sort(function (x, y) {
        return (x.b.startMin - y.b.startMin) || (x.idx - y.idx);
      });
      attendance[d] = withIdx.map(function (x) { return x.b; });
    }

    // Per-class weekly class minutes (drives the 1:1 study rule).
    var classMins = [];
    var classWeekMin = 0;
    for (i = 0; i < classes.length; i++) {
      var mins = 0;
      if (isScheduled(classes[i])) {
        for (j = 0; j < classes[i].meetings.length; j++) {
          mins += classes[i].meetings[j].endMin - classes[i].meetings[j].startMin;
        }
      } else {
        var ai = asyncClasses.indexOf(classes[i]);
        for (d = 0; d < ATTEND_DAYS.length; d++) {
          var blk = asyncByDay[ATTEND_DAYS[d]][ai];
          mins += Math.max(0, blk.endMin - blk.startMin);
        }
      }
      classMins.push(mins);
      classWeekMin += mins;
    }

    // 3. Study, 1:1 with class hours.
    var studyWeekMin = 0;
    if (!anyScheduled) {
      // Original behavior, preserved exactly: study mirrors the class blocks
      // onto Tue & Thu.
      var monBlocks = asyncByDay[ATTEND_DAYS[0]]; // Mon and Wed are identical here
      for (d = 0; d < STUDY_DAYS.length; d++) {
        var sday = STUDY_DAYS[d];
        for (i = 0; i < monBlocks.length; i++) {
          var src = monBlocks[i];
          study[sday].push({ code: src.code, startMin: src.startMin, endMin: src.endMin });
          studyWeekMin += Math.max(0, src.endMin - src.startMin);
        }
      }
    } else {
      // Distribute each class's study blocks across Tue/Thu (alternating), with
      // per-day cursors that skip every claimed attendance interval; overflow
      // in the fixed order Fri, Sat, Sun, Mon, Wed.
      var cursors = {};
      for (d = 0; d < 7; d++) cursors[d] = dayStartMin;
      for (i = 0; i < classes.length; i++) {
        var chunks = studyChunks(classMins[i], blockMinutes);
        for (j = 0; j < chunks.length; j++) {
          var dur = chunks[j];
          if (dur <= 0) continue;
          var firstDay = STUDY_DAYS[j % 2];
          var otherDay = STUDY_DAYS[(j + 1) % 2];
          var tryDays = [firstDay, otherDay].concat(STUDY_OVERFLOW);
          var placed = false;
          for (var t = 0; t < tryDays.length; t++) {
            var td = tryDays[t];
            var s = nextFreeStart(cursors[td], dur, attendance[td]);
            if (s + dur <= DAY_END_MIN) {
              study[td].push({ code: classes[i].code, startMin: s, endMin: s + dur });
              cursors[td] = s + dur;
              studyWeekMin += dur;
              placed = true;
              break;
            }
          }
          if (!placed) {
            return { error: { message: "There isn’t room in the week for all the study hours — check the class times." } };
          }
        }
      }
    }

    /*
     * Times the UI shows on each async row (null for scheduled rows).
     *
     * The forms schedule every attendance day independently, so one async class
     * can sit at different times on Mon than on Wed. A row has a single
     * Start/End pair, so the display re-runs the same sequencing against the
     * union of every meeting claimed on the async attendance days. That keeps
     * the shown time clear of every scheduled class it shares a day with, which
     * is the one hard rule; when the days already agree it is exactly the
     * earliest day's times, and with no scheduled class at all it reduces to
     * the original Mon/Wed sequence unchanged.
     *
     * Display-only: nothing here feeds the rows the PDFs are built from.
     */
    var displayClaims = [];
    for (d = 0; d < ATTEND_DAYS.length; d++) {
      var cday = attendance[ATTEND_DAYS[d]];
      for (i = 0; i < cday.length; i++) {
        if (cday[i].scheduled) displayClaims.push(cday[i]);
      }
    }
    var displayBlocks = [];
    var dispCursor = dayStartMin;
    for (i = 0; i < asyncClasses.length; i++) {
      var da = asyncClasses[i];
      var dStart, dEnd;
      if (da.startMin != null) {
        dStart = da.startMin; // explicit override wins, exactly as on the forms
        dEnd = (da.endMin != null) ? da.endMin : dStart + blockMinutes;
      } else {
        dStart = nextFreeStart(dispCursor, blockMinutes, displayClaims);
        dEnd = (da.endMin != null) ? da.endMin : dStart + blockMinutes;
      }
      displayBlocks.push({ startMin: dStart, endMin: dEnd });
      dispCursor = dEnd;
    }
    var asyncPlaceholders = classes.map(function (cl) {
      if (isScheduled(cl)) return null;
      var db = displayBlocks[asyncClasses.indexOf(cl)];
      return db ? { startMin: db.startMin, endMin: db.endMin } : null;
    });

    return {
      error: null,
      attendance: attendance,
      study: study,
      asyncPlaceholders: asyncPlaceholders,
      classWeekMin: classWeekMin,
      studyWeekMin: studyWeekMin
    };
  }

  /*
   * Find qualifying day-of-month numbers for a month, matching weekdays, within clip.
   * weekdays: array of JS getDay() values (Sun=0..Sat=6).
   */
  function qualifyingDates(year, month, weekdays, startDay, endDay) {
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var lo = startDay || 1;
    var hi = endDay || daysInMonth;
    if (hi > daysInMonth) hi = daysInMonth;
    var out = [];
    for (var d = lo; d <= hi; d++) {
      var date = new Date(year, month, d);
      if (weekdays.indexOf(date.getDay()) !== -1) out.push(date);
    }
    return out;
  }

  /*
   * Build the row list for one form from per-weekday template blocks.
   * Returns [{ date: "Day M/D"|"", code, start, end, total, hours, dateObj, isFirstOfDay }]
   * Date string only present on the first row of each day's group.
   */
  function buildRowsFromTemplate(dates, blocksByDay) {
    var rows = [];
    for (var i = 0; i < dates.length; i++) {
      var date = dates[i];
      var blocks = blocksByDay[date.getDay()] || [];
      for (var j = 0; j < blocks.length; j++) {
        var b = blocks[j];
        var mins = b.endMin - b.startMin;
        rows.push({
          dateObj: date,
          isFirstOfDay: j === 0,
          date: j === 0 ? formatDateWithDay(date) : "",
          code: b.code,
          start: formatTime(b.startMin),
          end: formatTime(b.endMin),
          total: formatTotal(mins),
          hours: mins / 60
        });
      }
    }
    return rows;
  }

  // Original single-blocklist row builder (kept for compatibility/tests).
  function buildRows(dates, blocks) {
    var byDay = [blocks, blocks, blocks, blocks, blocks, blocks, blocks];
    return buildRowsFromTemplate(dates, byDay);
  }

  // ISO-ish week key (Monday-start) for grouping weekly hours.
  function weekKey(d) {
    var tmp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = (tmp.getDay() + 6) % 7; // Mon=0..Sun=6
    tmp.setDate(tmp.getDate() - day); // back to Monday
    return tmp.getFullYear() + "-" + (tmp.getMonth() + 1) + "-" + tmp.getDate();
  }

  function mondayOf(d) {
    var tmp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = (tmp.getDay() + 6) % 7;
    tmp.setDate(tmp.getDate() - day);
    return tmp;
  }

  /*
   * Combined weekly hours (class + study). Returns sorted array of
   * { label, monday, hours }.
   */
  function weeklyHours(attendanceRows, studyRows) {
    var map = {};
    function add(rows) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var k = weekKey(r.dateObj);
        if (!map[k]) map[k] = { monday: mondayOf(r.dateObj), hours: 0 };
        map[k].hours += r.hours;
      }
    }
    add(attendanceRows);
    add(studyRows);
    var keys = Object.keys(map).map(function (k) { return map[k]; });
    keys.sort(function (a, b) { return a.monday - b.monday; });
    return keys.map(function (w) {
      var mon = w.monday;
      var sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
      return {
        label: formatDate(mon) + "–" + formatDate(sun),
        monday: mon,
        hours: Math.round(w.hours * 100) / 100
      };
    });
  }

  // Weekdays (getDay values) that carry at least one block, ascending.
  function activeWeekdays(blocksByDay) {
    var out = [];
    for (var d = 0; d < 7; d++) {
      if (blocksByDay[d] && blocksByDay[d].length) out.push(d);
    }
    return out;
  }

  /*
   * Top-level: from a config object produce everything the app needs.
   * config = {
   *   name, institution, hanaId,
   *   classes: [{code, startMin?, endMin?, meetings?: [{day, startMin, endMin}]}],
   *   dayStartMin, blockMinutes, month (0-11), year, startDay, endDay
   * }
   * Returns { error } when scheduled meetings collide, otherwise the full result.
   */
  function compute(config) {
    var tmpl = buildWeekTemplate(config);
    if (tmpl.error) return { error: tmpl.error };

    var attDates = qualifyingDates(config.year, config.month,
      activeWeekdays(tmpl.attendance), config.startDay, config.endDay);
    var studyDates = qualifyingDates(config.year, config.month,
      activeWeekdays(tmpl.study), config.startDay, config.endDay);

    var attendanceRows = buildRowsFromTemplate(attDates, tmpl.attendance);
    var studyRows = buildRowsFromTemplate(studyDates, tmpl.study);

    return {
      error: null,
      template: tmpl,
      attendanceRows: attendanceRows,
      studyRows: studyRows,
      weekly: weeklyHours(attendanceRows, studyRows),
      classWeekMin: tmpl.classWeekMin,
      studyWeekMin: tmpl.studyWeekMin,
      monthYearLabel: MONTHS[config.month] + " " + config.year,
      monAbbr: MON_ABBR[config.month]
    };
  }

  return {
    MONTHS: MONTHS,
    MON_ABBR: MON_ABBR,
    DAY_NAMES: DAY_NAMES,
    pad2: pad2,
    formatTime: formatTime,
    parseTime: parseTime,
    formatTotal: formatTotal,
    formatDate: formatDate,
    dayAbbr: dayAbbr,
    formatDateWithDay: formatDateWithDay,
    isScheduled: isScheduled,
    buildBlocks: buildBlocks,
    validateMeetings: validateMeetings,
    studyChunks: studyChunks,
    buildWeekTemplate: buildWeekTemplate,
    qualifyingDates: qualifyingDates,
    buildRows: buildRows,
    buildRowsFromTemplate: buildRowsFromTemplate,
    weeklyHours: weeklyHours,
    compute: compute
  };
});
