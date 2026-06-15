/*
 * schedule.js — pure scheduling + formatting logic for the Bridge to Hope PDF filler.
 * No DOM, no pdf-lib. Shared by the browser app and the Node test harness.
 * Exposed as window.BTHSchedule (browser) and module.exports (node).
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

  /*
   * Build the ordered class blocks for a single day.
   * classes: [{ code, startMin?, endMin? }]
   * dayStartMin: default start for auto-sequencing
   * blockMinutes: default block length (90)
   * Auto-sequences back-to-back from dayStartMin unless a block carries its own times.
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
   * Build the row list for one form.
   * Returns [{ date: "M/D"|"", code, start, end, total, hours, dateObj, isFirstOfDay }]
   * Date string only present on the first row of each day's group.
   */
  function buildRows(dates, blocks) {
    var rows = [];
    for (var i = 0; i < dates.length; i++) {
      var date = dates[i];
      for (var j = 0; j < blocks.length; j++) {
        var b = blocks[j];
        var mins = b.endMin - b.startMin;
        rows.push({
          dateObj: date,
          isFirstOfDay: j === 0,
          date: j === 0 ? formatDate(date) : "",
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

  /*
   * Top-level: from a config object produce everything the app needs.
   * config = {
   *   name, institution, hanaId,
   *   classes: [{code, startMin?, endMin?}],
   *   dayStartMin, blockMinutes, month (0-11), year, startDay, endDay
   * }
   */
  function compute(config) {
    var blockMinutes = config.blockMinutes || 90;
    var dayStartMin = (config.dayStartMin != null) ? config.dayStartMin : 8 * 60;
    var blocks = buildBlocks(config.classes, dayStartMin, blockMinutes);

    var attDates = qualifyingDates(config.year, config.month, [1, 3], config.startDay, config.endDay); // Mon, Wed
    var studyDates = qualifyingDates(config.year, config.month, [2, 4], config.startDay, config.endDay); // Tue, Thu

    var attendanceRows = buildRows(attDates, blocks);
    var studyRows = buildRows(studyDates, blocks);

    return {
      blocks: blocks,
      attendanceRows: attendanceRows,
      studyRows: studyRows,
      weekly: weeklyHours(attendanceRows, studyRows),
      monthYearLabel: MONTHS[config.month] + " " + config.year,
      monAbbr: MON_ABBR[config.month]
    };
  }

  return {
    MONTHS: MONTHS,
    MON_ABBR: MON_ABBR,
    pad2: pad2,
    formatTime: formatTime,
    parseTime: parseTime,
    formatTotal: formatTotal,
    formatDate: formatDate,
    buildBlocks: buildBlocks,
    qualifyingDates: qualifyingDates,
    buildRows: buildRows,
    weeklyHours: weeklyHours,
    compute: compute
  };
});
