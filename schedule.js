/*
 * schedule.js — THE SCHEDULING ENGINE.
 *
 * This file decides WHEN every class and study block happens. It is the single
 * place that works this out: the on-screen times, the live hours panel, and the
 * generated PDFs all call into here, so they can never disagree with each other.
 *
 * It only does arithmetic on dates and times. It never touches the page and
 * never touches a PDF, which makes it safe to read and test on its own.
 * Loaded as window.BTHSchedule in the browser, module.exports under Node.
 *
 * The tool is a weekly-timetable builder. Every class carries a CREDITS number
 * (1-4, normally 3), used for automatic async attendance and flexible allowances:
 *  - SCHEDULED classes (meetings: [{day, startMin, endMin}]) claim their exact
 *    days and times. Immovable. They document their real meetings and nothing
 *    more, unless the student opts in to remainder blocks (addRemainder), in
 *    which case whatever is left of the credit hours is mirrored onto the
 *    partner day.
 *  - ASYNC classes (no meetings) earn attendance equal to their credits, laid
 *    out as back-to-back blocks on the default attendance days (Mon & Wed) from
 *    the day start time, skipping any interval a scheduled class already claims.
 *  - STUDY matches the class's actual attendance, on both study forms.
 *    It is laid out in blocks (default 1.5 hr, the last one adjusted to hit the
 *    exact total) on the default study days (Tue & Thu), overflowing to Fri,
 *    Sat, Sun, Mon, Wed.
 * Every duration is computed from exact minutes, so a 12:00a-12:50p meeting is
 * 0.83 hours and a 9:00a-12:20p meeting is 3.33 — never rounded to a half hour.
 * When no class is scheduled and every class is the usual 3 credits, everything
 * reduces exactly to the original Mon/Wed + mirrored Tue/Thu behavior.
 *
 * That weekly timetable is then repeated across an FTW REPORT PERIOD rather
 * than a calendar month — see "FTW report periods" below — and every time is
 * printed with a compact meridiem (8:00a, 1:30p) so screen and paper agree.
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

  /* ============================ THE GROUND RULES ============================
   * The program's defaults. Change a number here and the whole tool follows.
   * Online classes are logged Mon & Wed; study time is logged Tue & Thu; if a
   * week's hours will not fit on their usual days they spill onto the extra
   * days in the order listed. Days are JavaScript weekday numbers (Sunday = 0).
   */
  var ATTEND_DAYS = [1, 3];              // Mon, Wed
  var ATTEND_OVERFLOW = [5, 6, 0, 2, 4]; // Fri, Sat, Sun, Tue, Thu
  var STUDY_DAYS = [2, 4];               // Tue, Thu
  var STUDY_OVERFLOW = [5, 6, 0, 1, 3];  // Fri, Sat, Sun, Mon, Wed
  var DAY_END_MIN = 24 * 60;             // no block may run past midnight

  /*
   * Credits a class carries when nothing is chosen, and the range the picker
   * offers. The common student never touches this: three credits behaves
   * exactly as the tool always has.
   */
  var DEFAULT_CREDITS = 3;
  var MIN_CREDITS = 1;
  var MAX_CREDITS = 4;

  /*
   * Where a remainder block goes (see the credits rule further down): it
   * mirrors onto the meeting day's partner. Mon and Wed pair with each other,
   * Tue and Thu pair with each other, and a class meeting at the end of the
   * week mirrors onto Monday.
   */
  var PARTNER_DAY = { 1: 3, 3: 1, 2: 4, 4: 2, 5: 1, 6: 1, 0: 1 };

  /* ===================== WRITING TIMES AND DATES THE WAY =====================
   * ===================== THE PAPER FORMS EXPECT THEM =========================
   * The DHS forms use a 12-hour clock with a COMPACT MERIDIEM — no leading
   * zero, one lowercase letter, no space ("8:00a", "1:30p") — dates with no
   * leading zeros ("9/8"), and hours as decimals ("1.5", "0.83"). These small
   * helpers are the only place that formatting is decided, so the screen and
   * the printed form can never disagree about a time.
   */

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  /*
   * Minutes-since-midnight -> "H:MMa" / "H:MMp", 12-hour with the compact
   * meridiem the forms use.
   *   480 -> "8:00a"    700 -> "11:40a"   810 (13:30) -> "1:30p"
   *   720 -> "12:00p" (noon)              0 -> "12:00a" (midnight)
   * A block ending exactly at midnight (1440) reads "12:00a", not "12:00p".
   */
  function formatTime(min) {
    var h24 = Math.floor(min / 60) % 24;
    var m = min % 60;
    var h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ":" + pad2(m) + (h24 < 12 ? "a" : "p");
  }

  /*
   * Parse a typed time -> minutes. Accepts 24-hour ("13:30"), a bare 12-hour
   * clock ("1:30", as this tool has always taken), and the same compact
   * meridiem it now prints ("1:30p", "8:00a") — so a time copied straight off
   * the screen back into an override box still reads correctly. Longer forms
   * ("1:30 PM") are accepted too; anything else returns null.
   */
  function parseTime(str) {
    if (str == null) return null;
    var s = String(str).trim();
    var m = s.match(/^(\d{1,2}):(\d{2})\s*([aApP])?[mM]?\.?$/);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var mm = parseInt(m[2], 10);
    if (isNaN(h) || isNaN(mm) || mm > 59) return null;
    var mer = m[3] ? m[3].toLowerCase() : null;
    if (mer) {
      if (h < 1 || h > 12) return null;
      if (mer === "a" && h === 12) h = 0;
      else if (mer === "p" && h !== 12) h += 12;
    }
    if (h > 24 || (h === 24 && mm !== 0)) return null;
    return h * 60 + mm;
  }

  /*
   * Minutes -> decimal hours the way the forms want them: worked out from the
   * exact minute count, rounded to two decimal places, trailing zeros stripped.
   *   50 -> "0.83"   100 -> "1.67"   165 -> "2.75"   200 -> "3.33"
   *   90 -> "1.5"    120 -> "2"      30  -> "0.5"
   * Every totals column and every number in the hours panel comes from here, so
   * they always agree to the same precision.
   */
  function formatTotal(min) {
    var hrs = min / 60;
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

  // "M 6/22", "Sa 8/29" — weekday letter + space + M/D.
  function formatDateWithDay(d) {
    var ab = dayAbbr(d);
    return (ab ? ab + " " : "") + formatDate(d);
  }

  /* =================== FTW REPORT PERIODS (THE FRIDAY RULE) =================
   * First-To-Work does not report calendar months. It reports whole SUNDAY-TO-
   * SATURDAY weeks, and a week belongs to the report month its FRIDAY falls
   * in. So a report month is every Sun-Sat week whose Friday lands in that
   * calendar month, which is why the September 2026 form opens on Su 8/30 and
   * closes on Sa 9/26 — and why dates from the neighbouring calendar month
   * print with their real dates rather than being trimmed away.
   *
   * Everything below follows from that one rule and is worked out for any
   * month of any year, so there is no calendar to keep up to date. The year
   * boundary needs no special case either: January's period opens in late
   * December of the year before, December's closes before New Year's.
   */

  var FRIDAY = 5;

  /*
   * Whole days since the epoch, ignoring clock time and daylight saving, so
   * two dates can be compared or subtracted without an hour's drift changing
   * the answer.
   */
  function dayNumber(d) {
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  // "YYYY-MM-DD" — the format an <input type="date"> reads and writes.
  function toISODate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /*
   * A Date, a "YYYY-MM-DD" string, or nothing -> a plain local Date or null.
   * Parsed by hand rather than with new Date(str): the browser reads a bare
   * ISO date as UTC midnight, which lands on the day before anywhere west of
   * Greenwich — including Hawaii, where this tool is used.
   */
  function fromISODate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    var parts = String(v).split("-");
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10), mo = parseInt(parts[1], 10), da = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(mo) || isNaN(da)) return null;
    return new Date(y, mo - 1, da);
  }

  // "Aug 30–Sep 26"; "Feb 1–28" when the whole period sits inside one month.
  function periodLabel(start, end) {
    var from = MON_ABBR[start.getMonth()] + " " + start.getDate();
    var sameMonth = start.getMonth() === end.getMonth() &&
                    start.getFullYear() === end.getFullYear();
    var to = sameMonth ? String(end.getDate())
                       : MON_ABBR[end.getMonth()] + " " + end.getDate();
    return from + "–" + to;
  }

  /*
   * The report period for one calendar month (month is 0-11): from the SUNDAY
   * of the week holding that month's first Friday, to the SATURDAY of the week
   * holding its last Friday.
   *
   * Out-of-range day numbers handed to new Date(y, m, d) roll into the
   * neighbouring month — and the neighbouring year — on their own, which is
   * exactly the behavior wanted here.
   *
   * Returns { start, end, weeks, label, startISO, endISO }.
   */
  function reportPeriod(year, month) {
    var firstOfMonth = new Date(year, month, 1);
    var firstFriday = 1 + ((FRIDAY - firstOfMonth.getDay() + 7) % 7);

    var lastOfMonth = new Date(year, month + 1, 0);
    var lastFriday = lastOfMonth.getDate() - ((lastOfMonth.getDay() - FRIDAY + 7) % 7);

    var start = new Date(year, month, firstFriday - 5); // that week's Sunday
    var end = new Date(year, month, lastFriday + 1);    // that week's Saturday

    return {
      start: start,
      end: end,
      weeks: (dayNumber(end) - dayNumber(start) + 1) / 7,
      label: periodLabel(start, end),
      startISO: toISODate(start),
      endISO: toISODate(end)
    };
  }

  function isScheduled(c) {
    return !!(c.meetsSetTimes || (c.meetings && c.meetings.length));
  }

  /*
   * A class's credits, as chosen on its row. Anything missing or unreadable
   * falls back to the usual 3, and the value is held inside the offered range
   * so a stray number can never distort the week.
   */
  function creditsOf(c) {
    var n = (c && c.credits != null) ? parseInt(c.credits, 10) : DEFAULT_CREDITS;
    if (isNaN(n)) n = DEFAULT_CREDITS;
    if (n < MIN_CREDITS) n = MIN_CREDITS;
    if (n > MAX_CREDITS) n = MAX_CREDITS;
    return n;
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

  /* ======================= CHECKING WHAT WAS TYPED IN =======================
   * Catches the two mistakes a person can make when entering set meeting
   * times: an end time that is not after its start, and two classes booked on
   * top of each other on the same day. Returns nothing when all is well, or a
   * plain-English message the page shows under the class list.
   */
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

  /* ===================== SPLITTING A BUDGET INTO BLOCKS =====================
   * A number of hours broken into sittings of the standard length, with the
   * last one made shorter or longer so the total comes out exact. Used for
   * both online class time and study time, so both behave the same way.
   *   3 credits -> 1.5 + 1.5       1 credit  -> a single 1.0
   *   4 credits -> 1.5 + 1.5 + 1   2 credits -> a single 2.0
   */
  function splitIntoBlocks(totalMin, blockMinutes) {
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
   *   attendance: [ [ {code,startMin,endMin,scheduled,remainder?} ] x7 ], // by getDay()
   *   study:      [ [ {code,startMin,endMin} ] x7 ],
   *   asyncPlaceholders: [ {startMin,endMin} | null per class ], // display only
   *   classInfo: [ per class: credits and its minute totals ],
   *   classWeekMin, studyWeekMin
   * }
   */
  function legacyWeekTemplate(config) {
    var blockMinutes = config.blockMinutes || 90;
    var dayStartMin = (config.dayStartMin != null) ? config.dayStartMin : 8 * 60;
    var classes = config.classes || [];
    var d, i, j, k, t;

    var error = validateMeetings(classes);
    if (error) return { error: error };

    var attendance = [[], [], [], [], [], [], []];
    var study = [[], [], [], [], [], [], []];
    var asyncClasses = classes.filter(function (c) { return !isScheduled(c); });
    var anyScheduled = classes.length !== asyncClasses.length;

    // Every class's credit hours, in minutes. This one number drives its online
    // class time and the size of any remainder blocks. Study follows attendance.
    var creditMins = classes.map(function (c) { return creditsOf(c) * 60; });

    // 1. Scheduled classes claim their exact days and times. Immovable.
    var meetingMins = [];
    for (i = 0; i < classes.length; i++) {
      meetingMins.push(0);
      var c = classes[i];
      if (!isScheduled(c)) continue;
      for (j = 0; j < c.meetings.length; j++) {
        var m = c.meetings[j];
        attendance[m.day].push({ code: c.code, classIndex: i, startMin: m.startMin, endMin: m.endMin, scheduled: true });
        meetingMins[i] += m.endMin - m.startMin;
      }
    }

    /*
     * 1b. Remainder blocks — OPT-IN, one switch per class row.
     *
     * By default a class that meets at set times documents its real meetings
     * and nothing else. When a class meets for fewer hours than it carries in
     * credits, its row offers to add the difference as flexible blocks; that is
     * for a hybrid class with a real online component, or for a student whose
     * case worker credits the full hours. Nothing is added unless the switch is
     * turned on.
     *
     * The extra block mirrors the first meeting onto its partner day at the
     * same clock time and lasts however long is still owed — a real Monday
     * 12:00-1:15 on a 3-credit class earns a Wednesday block of 1.75 hours. If
     * that slot is already taken it slides later that day, like everything
     * else. On the form it is an ordinary attendance row carrying the class
     * code.
     */
    var remainderMins = [];
    for (i = 0; i < classes.length; i++) {
      remainderMins.push(0);
      var rc = classes[i];
      if (!isScheduled(rc)) continue;
      var owed = creditMins[i] - meetingMins[i];
      if (owed <= 0 || !rc.addRemainder) continue;
      var firstMeeting = rc.meetings[0];    // several days mirror the first one
      var pDay = PARTNER_DAY[firstMeeting.day];
      var pStart = nextFreeStart(firstMeeting.startMin, owed, attendance[pDay]);
      if (pStart + owed > DAY_END_MIN) {
        return { error: { message: "There isn’t room on " + DAY_NAMES[pDay] +
          " for the remaining hours of “" + rc.code +
          "” — check the times, or turn that switch off." } };
      }
      attendance[pDay].push({
        code: rc.code, classIndex: i, startMin: pStart, endMin: pStart + owed,
        scheduled: true, remainder: true
      });
      remainderMins[i] = owed;
    }

    // Everything claimed before online classes are laid in. Online blocks
    // sequence off their own day cursor and step over these.
    var claimedByDay = [];
    for (d = 0; d < 7; d++) claimedByDay.push(attendance[d].slice());

    /*
     * 2. Online (async) classes earn attendance equal to their credits, split
     * into standard blocks that alternate across the attendance days: a
     * 3-credit class is 1.5 hours on Mon and 1.5 on Wed exactly as before, a
     * 1-credit class is a single 1.0-hour block, a 4-credit class is
     * 1.5 + 1.5 + 1. Each day keeps its own cursor so blocks run back to back
     * and step over any time a scheduled class already claims.
     *
     * A row with its own Start/End typed in keeps the old override behavior
     * untouched: those exact times, once on each attendance day.
     */
    var asyncMins = [];      // weekly attendance placed, per class
    var asyncDay0Mins = [];  // of that, how much landed on the first attendance day
    var asyncByDay = {};     // day -> the online blocks placed there, in row order
    var cursors = {};
    for (d = 0; d < 7; d++) { asyncByDay[d] = []; cursors[d] = dayStartMin; }

    for (i = 0; i < classes.length; i++) {
      asyncMins.push(0);
      asyncDay0Mins.push(0);
      var a = classes[i];
      if (isScheduled(a)) continue;

      if (a.startMin != null || a.endMin != null) {
        // Typed-in times: one block per attendance day, exactly as before.
        for (d = 0; d < ATTEND_DAYS.length; d++) {
          var oday = ATTEND_DAYS[d];
          var ostart = (a.startMin != null)
            ? a.startMin
            : nextFreeStart(cursors[oday], blockMinutes, claimedByDay[oday]);
          var oend = (a.endMin != null) ? a.endMin : ostart + blockMinutes;
          var ob = { code: a.code, classIndex: i, startMin: ostart, endMin: oend, scheduled: false };
          attendance[oday].push(ob);
          asyncByDay[oday].push(ob);
          cursors[oday] = oend;
          asyncMins[i] += Math.max(0, oend - ostart);
          if (oday === ATTEND_DAYS[0]) asyncDay0Mins[i] += Math.max(0, oend - ostart);
        }
        continue;
      }

      var chunks = splitIntoBlocks(creditMins[i], blockMinutes);
      for (k = 0; k < chunks.length; k++) {
        var dur = chunks[k];
        if (dur <= 0) continue;
        var tryDays = [ATTEND_DAYS[k % ATTEND_DAYS.length],
                       ATTEND_DAYS[(k + 1) % ATTEND_DAYS.length]].concat(ATTEND_OVERFLOW);
        var placed = false;
        for (t = 0; t < tryDays.length; t++) {
          var td = tryDays[t];
          var s = nextFreeStart(cursors[td], dur, claimedByDay[td]);
          if (s + dur <= DAY_END_MIN) {
            var nb = { code: a.code, classIndex: i, startMin: s, endMin: s + dur, scheduled: false };
            attendance[td].push(nb);
            asyncByDay[td].push(nb);
            cursors[td] = s + dur;
            asyncMins[i] += dur;
            if (td === ATTEND_DAYS[0]) asyncDay0Mins[i] += dur;
            placed = true;
            break;
          }
        }
        if (!placed) {
          return { error: { message: "There isn’t room in the week for all of “" + a.code +
            "”’s class hours — check the class times." } };
        }
      }
    }

    // Sort each day's attendance by start time (stable).
    for (d = 0; d < 7; d++) {
      var withIdx = attendance[d].map(function (b, idx) { return { b: b, idx: idx }; });
      withIdx.sort(function (x, y) {
        return (x.b.startMin - y.b.startMin) || (x.idx - y.idx);
      });
      attendance[d] = withIdx.map(function (x) { return x.b; });
    }

    /*
     * What each class actually documents as attendance: the real meetings plus
     * any remainder blocks that were switched on, or the online blocks laid out
     * above. This is what the hours panel reports and what the forms carry.
     */
    var classMins = [];
    var classWeekMin = 0;
    for (i = 0; i < classes.length; i++) {
      var mins = isScheduled(classes[i])
        ? meetingMins[i] + remainderMins[i]
        : asyncMins[i];
      classMins.push(mins);
      classWeekMin += mins;
    }

    /*
     * 3. Both study forms match each class's actual attendance minutes,
     * including flexible blocks when selected and any async time overrides.
     */
    var studyMins = classMins.slice();
    var studyWeekMin = 0;

    /*
     * When nothing is scheduled and every class's online time already sits as
     * an equal share of its credits on each attendance day, the whole week
     * mirrors onto Tue & Thu — the original behavior, kept intact down to the
     * block order. Anything else (a scheduled class, an unusual credit count,
     * typed-in times that do not match the credits) is laid out block by block
     * below.
     */
    var canMirror = !anyScheduled;
    for (d = 0; d < 7 && canMirror; d++) {
      if (ATTEND_DAYS.indexOf(d) === -1 && attendance[d].length) canMirror = false;
    }
    for (i = 0; i < classes.length && canMirror; i++) {
      if (asyncMins[i] !== creditMins[i]) canMirror = false;
      else if (asyncDay0Mins[i] * ATTEND_DAYS.length !== creditMins[i]) canMirror = false;
    }

    if (canMirror) {
      var srcBlocks = asyncByDay[ATTEND_DAYS[0]];
      for (d = 0; d < STUDY_DAYS.length; d++) {
        var sday = STUDY_DAYS[d];
        for (i = 0; i < srcBlocks.length; i++) {
          var src = srcBlocks[i];
          study[sday].push({ code: src.code, classIndex: src.classIndex, startMin: src.startMin, endMin: src.endMin });
          studyWeekMin += Math.max(0, src.endMin - src.startMin);
        }
      }
    } else {
      // Each class's study blocks alternate across Tue/Thu, with per-day
      // cursors that step over every claimed attendance interval; overflow in
      // the fixed order Fri, Sat, Sun, Mon, Wed.
      var scursors = {};
      for (d = 0; d < 7; d++) scursors[d] = dayStartMin;
      for (i = 0; i < classes.length; i++) {
        var schunks = splitIntoBlocks(studyMins[i], blockMinutes);
        for (j = 0; j < schunks.length; j++) {
          var sdur = schunks[j];
          if (sdur <= 0) continue;
          var sTryDays = [STUDY_DAYS[j % STUDY_DAYS.length],
                          STUDY_DAYS[(j + 1) % STUDY_DAYS.length]].concat(STUDY_OVERFLOW);
          var sPlaced = false;
          for (t = 0; t < sTryDays.length; t++) {
            var std = sTryDays[t];
            var ss = nextFreeStart(scursors[std], sdur, attendance[std]);
            if (ss + sdur <= DAY_END_MIN) {
              study[std].push({ code: classes[i].code, classIndex: i, startMin: ss, endMin: ss + sdur });
              scursors[std] = ss + sdur;
              studyWeekMin += sdur;
              sPlaced = true;
              break;
            }
          }
          if (!sPlaced) {
            return { error: { message: "There isn’t room in the week for all the study hours — check the class times." } };
          }
        }
      }
    }

    /*
     * Times the UI shows on each online row (null for scheduled rows).
     *
     * The forms schedule every attendance day independently, so one online
     * class can sit at different times on Mon than on Wed. A row has a single
     * Start/End pair, so the display re-runs the same sequencing against the
     * union of every meeting claimed on the attendance days. That keeps the
     * shown time clear of every scheduled class it shares a day with, which is
     * the one hard rule; when the days already agree it is exactly the earliest
     * day's times, and with no scheduled class at all it reduces to the
     * original Mon/Wed sequence unchanged. A class carrying more blocks than
     * there are attendance days shows the first of them.
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
      var gi = classes.indexOf(da);
      var dStart, dEnd;
      if (da.startMin != null || da.endMin != null) {
        dStart = (da.startMin != null)
          ? da.startMin
          : nextFreeStart(dispCursor, blockMinutes, displayClaims);
        dEnd = (da.endMin != null) ? da.endMin : dStart + blockMinutes;
      } else {
        var firstDur = splitIntoBlocks(creditMins[gi], blockMinutes)[0] || blockMinutes;
        dStart = nextFreeStart(dispCursor, firstDur, displayClaims);
        dEnd = dStart + firstDur;
      }
      displayBlocks.push({ startMin: dStart, endMin: dEnd });
      dispCursor = dStart + (asyncDay0Mins[gi] || (dEnd - dStart));
    }
    var asyncPlaceholders = classes.map(function (cl) {
      if (isScheduled(cl)) return null;
      var db = displayBlocks[asyncClasses.indexOf(cl)];
      return db ? { startMin: db.startMin, endMin: db.endMin } : null;
    });

    /*
     * One entry per class, for the page: what it carries in credits, what its
     * meetings literally document, whether it falls short of its credits (which
     * is what puts the quiet note and the remainder switch on its row), and
     * what it ends up documenting. The page never works any of this out itself.
     */
    var classInfo = classes.map(function (cl, ix) {
      return {
        code: cl.code,
        credits: creditsOf(cl),
        creditMin: creditMins[ix],
        scheduled: isScheduled(cl),
        meetingMin: meetingMins[ix],
        remainderMin: remainderMins[ix],
        shortfallMin: isScheduled(cl) ? Math.max(0, creditMins[ix] - meetingMins[ix]) : 0,
        attendanceMin: classMins[ix],
        studyMin: studyMins[ix]
      };
    });

    return {
      error: null,
      attendance: attendance,
      study: study,
      asyncPlaceholders: asyncPlaceholders,
      classInfo: classInfo,
      classWeekMin: classWeekMin,
      studyWeekMin: studyWeekMin
    };
  }

  /* ================ TURNING ONE WEEK INTO ONE REPORT PERIOD =================
   * Everything above plans a single typical week. The rest of the file repeats
   * that week across the chosen month's FTW REPORT PERIOD to produce the
   * actual dated rows the forms are filled with. The dated planner reapplies
   * availability and holiday rules separately for each FTW week.
   */

  /*
   * Every date inside the report period that falls on one of the given
   * weekdays, narrowed by the optional custom start/end dates on the Report
   * period card — the "part of a period" clip.
   *
   * The period is always the outer bound: a custom date outside it narrows
   * nothing, so a stray entry can never pull in dates the form does not cover.
   */
  function qualifyingDates(period, weekdays, fromDate, untilDate) {
    var lo = period.start;
    var hi = period.end;
    if (fromDate && dayNumber(fromDate) > dayNumber(lo)) lo = fromDate;
    if (untilDate && dayNumber(untilDate) < dayNumber(hi)) hi = untilDate;

    var out = [];
    var hiNum = dayNumber(hi);
    var cur = new Date(lo.getFullYear(), lo.getMonth(), lo.getDate());
    while (dayNumber(cur) <= hiNum) {
      if (weekdays.indexOf(cur.getDay()) !== -1) {
        out.push(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()));
      }
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  /*
   * Build the row list for one form from per-weekday template blocks.
   * Returns [{ date, dateFull, code, start, end, total, hours, dateObj, isFirstOfDay }]
   * `date` is blank on every row but the first of each day, matching the paper
   * forms; `dateFull` always carries it, for the rare case where one day's rows
   * have to be split across two copies of a form.
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
          dateFull: formatDateWithDay(date),
          date: j === 0 ? formatDateWithDay(date) : "",
          code: b.code,
          classIndex: b.classIndex,
          start: formatTime(b.startMin),
          end: formatTime(b.endMin),
          total: formatTotal(mins),
          hours: mins / 60
        });
      }
    }
    return rows;
  }

  // The Sunday that opens the FTW week a date belongs to.
  function weekStart(d) {
    var tmp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    tmp.setDate(tmp.getDate() - tmp.getDay()); // back to Sunday
    return tmp;
  }

  /*
   * Class + study hours added up per FTW week, used for reporting. Weeks are
   * grouped Sunday to Saturday — the same weeks the report period is built
   * from — so a week's total is the total its Friday reports.
   * Each entry is { label, start, end, hours }.
   */
  function weeklyHours(attendanceRows, studyRows) {
    var map = {};
    function add(rows) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var sun = weekStart(r.dateObj);
        var k = dayNumber(sun);
        if (!map[k]) map[k] = { start: sun, hours: 0 };
        map[k].hours += r.hours;
      }
    }
    add(attendanceRows);
    add(studyRows);
    var weeks = Object.keys(map).map(function (k) { return map[k]; });
    weeks.sort(function (a, b) { return a.start - b.start; });
    return weeks.map(function (w) {
      var sat = new Date(w.start.getFullYear(), w.start.getMonth(), w.start.getDate() + 6);
      return {
        label: formatDate(w.start) + "–" + formatDate(sat),
        start: w.start,
        end: sat,
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

  // Recurring UH holidays, shared by all campuses. Observed dates follow the
  // State calendar linked by UH OHR: Saturday -> Friday; Sunday -> Monday.
  // Sources: hawaii.edu/academic-calendar/ and hawaii.edu/ohr/benefits-leave/benefit/holidays/
  // Breaks, non-instructional days, and one-off closures are deliberately excluded.
  var holidayCache = {};
  function uhHolidays(year) {
    if (holidayCache[year]) return holidayCache[year];
    var dates = {};
    function add(date, name) {
      var key = dayNumber(date);
      dates[key] = dates[key] ? dates[key] + " / " + name : name;
    }
    function fixed(y, month, day, name) {
      var date = new Date(y, month, day);
      if (date.getDay() === 6) date.setDate(date.getDate() - 1);
      else if (date.getDay() === 0) date.setDate(date.getDate() + 1);
      add(date, name);
    }
    function nth(month, weekday, n, name) {
      var first = new Date(year, month, 1);
      add(new Date(year, month, 1 + (weekday - first.getDay() + 7) % 7 + 7 * (n - 1)), name);
    }
    fixed(year, 0, 1, "New Year's Day");
    // Next January's observed holiday can fall on this December 31.
    fixed(year + 1, 0, 1, "New Year's Day");
    nth(0, 1, 3, "Martin Luther King Jr. Day");
    nth(1, 1, 3, "Presidents' Day");
    fixed(year, 2, 26, "Prince Kuhio Day");
    // Gregorian Easter (Meeus/Jones/Butcher), then subtract two days.
    var a = year % 19, b = Math.floor(year / 100), c = year % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var em = Math.floor((h + l - 7 * m + 114) / 31);
    var ed = (h + l - 7 * m + 114) % 31 + 1;
    add(new Date(year, em - 1, ed - 2), "Good Friday");
    var lastMay = new Date(year, 4, 31);
    add(new Date(year, 4, 31 - (lastMay.getDay() + 6) % 7), "Memorial Day");
    fixed(year, 5, 11, "King Kamehameha I Day");
    fixed(year, 6, 4, "Independence Day");
    nth(7, 5, 3, "Statehood Day");
    nth(8, 1, 1, "Labor Day");
    if (year % 2 === 0) {
      var nov = new Date(year, 10, 1);
      add(new Date(year, 10, 2 + (1 - nov.getDay() + 7) % 7), "General Election Day");
    }
    fixed(year, 10, 11, "Veterans Day");
    nth(10, 4, 4, "Thanksgiving");
    fixed(year, 11, 25, "Christmas");
    holidayCache[year] = dates;
    return dates;
  }

  function uhHoliday(date) {
    return uhHolidays(date.getFullYear())[dayNumber(date)] || null;
  }

  // Plan within one FTW week. Existing templates supply preferred positions;
  // unavailable intervals are hard boundaries for all movable activities.
  function planWeek(config, seed, dates) {
    var classes = config.classes || [], warnings = [], shortfalls = [];
    var att = [[], [], [], [], [], [], []], study = [[], [], [], [], [], [], []];
    var blocked = [[], [], [], [], [], [], []], available = {};
    var dayStart = config.dayStartMin == null ? 480 : Math.max(0, Math.min(1439, config.dayStartMin));
    if (dates) dates.forEach(function (date) { available[date.getDay()] = date; });
    else for (var d = 0; d < 7; d++) available[d] = true;
    function valid(b) {
      return Number.isInteger(b.day) && b.day >= 0 && b.day < 7 &&
        Number.isFinite(b.startMin) && Number.isFinite(b.endMin) &&
        b.startMin >= 0 && b.endMin <= 1440 && b.endMin > b.startMin;
    }
    (config.unavailable || []).forEach(function (b) {
      var limited=!!(b.startDate||b.endDate),from=fromISODate(b.startDate),until=fromISODate(b.endDate||b.startDate);
      var validDates=!limited||(from&&until&&toISODate(from)===b.startDate&&
        toISODate(until)===(b.endDate||b.startDate)&&from<=until);
      if (!valid(b)||!validDates) {warnings.push("An unavailable time or date range is incomplete or invalid and was not applied.");return;}
      var date=available[b.day];
      // Dated limits belong to the actual calendar date, never to every copy
      // of that weekday or to the undated template used for placeholders.
      if(!limited||(date&&date!==true&&inDates(date,{startDate:b.startDate,endDate:b.endDate||b.startDate})))
        blocked[b.day].push(b);
    });
    function inDates(date, entry) {
      if (date === true) return true;
      var iso = toISODate(date);
      return (!entry.startDate || iso >= entry.startDate) && (!entry.endDate || iso <= entry.endDate);
    }
    function allowed(day, ix, kind) {
      return available[day] && inDates(available[day], classes[ix]) && (kind === "study" || !isScheduled(classes[ix]) ||
        available[day] === true || !uhHoliday(available[day]));
    }
    function claims(day) { return blocked[day].concat(att[day], study[day]); }
    function add(day, start, duration, ix, kind, extra) {
      var block = Object.assign({code: classes[ix].code, classIndex: ix,
        startMin: start, endMin: start + duration}, extra || {});
      (kind === "study" ? study : att)[day].push(block);
    }
    // Fixed meetings claim their entered times before movable activities are placed.
    classes.forEach(function (c, ix) {
      if (!isScheduled(c)) return;
      if (!(c.meetings || []).length || c.incompleteMeetings) warnings.push(c.code + ": incomplete meeting times were omitted; enter a day, start and end to record them.");
      (c.meetings || []).forEach(function (m) {
        if (!valid(m)) { warnings.push(c.code + ": an invalid meeting was omitted."); return; }
        if (!allowed(m.day, ix, "attendance") || !inDates(available[m.day], m)) return;
        add(m.day, m.startMin, m.endMin - m.startMin, ix, "attendance", {scheduled:true});
      });
    });
    // Try an intact preferred block first, then split into all usable gaps.
    function place(ix, kind, minutes, preferences) {
      var remaining = minutes;
      preferences.forEach(function (pref) {
        if (!remaining || !allowed(pref.day, ix, kind)) return;
        var duration = Math.min(remaining, pref.minutes == null ? remaining : pref.minutes);
        var start = nextFreeStart(pref.startMin, duration, claims(pref.day));
        if (duration > 0 && start + duration <= 1440) {
          add(pref.day, start, duration, ix, kind); remaining -= duration;
        }
      });
      var order = kind === "study" ? STUDY_DAYS.concat(STUDY_OVERFLOW) : ATTEND_DAYS.concat(ATTEND_OVERFLOW);
      // Gaps on preferred days are considered first when a whole block cannot fit.
      var attempts = preferences.concat(order.map(function (day) { return {day:day,startMin:dayStart}; }));
      attempts.forEach(function (pref) {
        if (!remaining || !allowed(pref.day, ix, kind)) return;
        var occupied = claims(pref.day).slice().sort(function (a,b) { return a.startMin-b.startMin; });
        occupied.push({startMin:1440,endMin:1440});
        var cursor = pref.startMin;
        occupied.forEach(function (b) {
          var duration = Math.min(remaining, Math.max(0,b.startMin-cursor));
          if (duration > 0) { add(pref.day,cursor,duration,ix,kind); remaining-=duration; }
          cursor=Math.max(cursor,b.endMin);
        });
      });
      if (remaining) shortfalls.push({code:classes[ix].code,kind:kind,minutes:remaining});
    }
    classes.forEach(function (c, ix) {
      var prefs = [];
      if (seed && !seed.error) {
        seed.attendance.forEach(function (blocks, day) {
          blocks.forEach(function (b) {
            if (b.classIndex === ix && (!b.scheduled || b.remainder) && allowed(day,ix,"attendance"))
              prefs.push({day:day,startMin:b.startMin,minutes:b.endMin-b.startMin});
          });
        });
      } else if (isScheduled(c)) {
        var meetings=(c.meetings || []).filter(valid);
        var owed=Math.max(0,creditsOf(c)*60-meetings.reduce(function (n,m) { return n+m.endMin-m.startMin; },0));
        if (c.addRemainder && meetings.length) {
          var day=PARTNER_DAY[meetings[0].day];
          if (allowed(day,ix,"attendance")) prefs.push({day:day,startMin:meetings[0].startMin,minutes:owed});
        }
      } else {
        var chunks=splitIntoBlocks(creditsOf(c)*60,config.blockMinutes || 90);
        if (c.startMin != null || c.endMin != null) {
          var start=c.startMin == null ? dayStart : c.startMin;
          var end=c.endMin == null ? start+(config.blockMinutes || 90) : c.endMin;
          if (start>=0 && end<=1440 && end>start) chunks=[end-start,end-start];
          else { chunks=[]; warnings.push(c.code+": invalid attendance times were omitted."); }
        }
        chunks.forEach(function (minutes,j) { var day=ATTEND_DAYS[j%2];
          if (allowed(day,ix,"attendance")) prefs.push({day:day,startMin:c.startMin == null ? dayStart : c.startMin,minutes:minutes}); });
      }
      place(ix,"attendance",prefs.reduce(function(n,p){return n+p.minutes;},0),prefs);
    });
    var attendanceMins=classes.map(function(_,ix) { return att.reduce(function(n,blocks) {
      return n+blocks.reduce(function(m,b){return m+(b.classIndex===ix?b.endMin-b.startMin:0);},0); },0); });
    // Explicit study preferences take priority over automatic study placements.
    var order=classes.map(function(_,ix){return ix;}).sort(function(a,b){return Number(!!classes[b].customStudy)-Number(!!classes[a].customStudy);});
    order.forEach(function(ix) {
      var c=classes[ix], minutes=attendanceMins[ix], prefs=[];
      if (c.customStudy) {
        var slots=(c.studySlots || []).filter(function(p){return Number.isInteger(p.day)&&p.day>=0&&p.day<7&&Number.isFinite(p.startMin)&&p.startMin>=0&&p.startMin<1440;});
        if (slots.length !== (c.studySlots || []).length) warnings.push(c.code+": an incomplete study preference was not applied.");
        var left=minutes;
        slots.forEach(function(p,j) {
          var duration=p.minutes>0 ? Math.min(left,p.minutes) : Math.ceil(left/(slots.length-j));
          prefs.push({day:p.day,startMin:p.startMin,minutes:duration});left-=duration;
        });
        if (!slots.length) warnings.push(c.code+": no complete study time was entered; study was scheduled automatically.");
      } else if (seed && !seed.error) {
        seed.study.forEach(function(blocks,day){blocks.forEach(function(b){
          if(b.classIndex===ix) prefs.push({day:day,startMin:b.startMin,minutes:b.endMin-b.startMin});
        });});
      }
      place(ix,"study",minutes,prefs);
    });
    [att,study].forEach(function(days){days.forEach(function(blocks){blocks.sort(function(a,b){return a.startMin-b.startMin;});});});
    return {attendance:att,study:study,warnings:warnings,shortfalls:shortfalls};
  }

  function buildWeekTemplate(config) {
    var seed=legacyWeekTemplate(config);
    var weeklyUnavailable=(config.unavailable||[]).filter(function(b){return !b.startDate&&!b.endDate;});
    // Preserve established automatic defaults, including display placeholders.
    if (!seed.error && !weeklyUnavailable.length && !(config.classes || []).some(function(c){return c.customStudy;})) return seed;
    var plan=planWeek(config,seed,null), classes=config.classes || [];
    function minutes(days,ix) {return days.reduce(function(n,blocks){return n+blocks.reduce(function(m,b){return m+(b.classIndex===ix?b.endMin-b.startMin:0);},0);},0);}
    var info=classes.map(function(c,ix){
      var meeting=(c.meetings || []).reduce(function(n,m){return n+Math.max(0,m.endMin-m.startMin);},0);
      var attended=minutes(plan.attendance,ix);
      return {code:c.code,credits:creditsOf(c),creditMin:creditsOf(c)*60,scheduled:isScheduled(c),meetingMin:meeting,
        remainderMin:Math.max(0,attended-meeting),shortfallMin:isScheduled(c)?Math.max(0,creditsOf(c)*60-meeting):0,
        attendanceMin:attended,studyMin:minutes(plan.study,ix)};
    });
    return Object.assign(plan,{error:null,classInfo:info,
      asyncPlaceholders:classes.map(function(c,ix){if(isScheduled(c))return null;
        for(var d=0;d<7;d++){var b=plan.attendance[d].find(function(b){return b.classIndex===ix;});if(b)return {startMin:b.startMin,endMin:b.endMin};}return null;}),
      classWeekMin:info.reduce(function(n,c){return n+c.attendanceMin;},0),studyWeekMin:info.reduce(function(n,c){return n+c.studyMin;},0)});
  }

  function datedRows(config, tmpl, period, from, until) {
    var attendanceRows=[],studyRows=[],warnings=[],shortfalls=[];
    var dates=qualifyingDates(period,[0,1,2,3,4,5,6],from,until),weeks={};
    dates.forEach(function(date){var key=dayNumber(weekStart(date));(weeks[key] || (weeks[key]=[])).push(date);});
    var seed=legacyWeekTemplate(config);
    Object.keys(weeks).sort(function(a,b){return Number(a)-Number(b);}).forEach(function(key){
      var weekDates=weeks[key],plan=planWeek(config,seed,weekDates);
      attendanceRows=attendanceRows.concat(buildRowsFromTemplate(weekDates,plan.attendance));
      studyRows=studyRows.concat(buildRowsFromTemplate(weekDates,plan.study));
      plan.warnings.forEach(function(w){if(warnings.indexOf(w)<0)warnings.push(w);});
      plan.shortfalls.forEach(function(s){shortfalls.push(Object.assign({week:formatDate(weekStart(weekDates[0]))},s));});
    });
    return {error:null,attendanceRows:attendanceRows,studyRows:studyRows,warnings:warnings,shortfalls:shortfalls};
  }

  /* ========================= THE ONE ENTRY POINT ============================
   * Hand this the filled-in form and it returns everything needed to build the
   * PDFs: the report period, the dated attendance rows, the dated study rows,
   * the weekly hour totals and the month label. Fixed meetings keep their entered
   * times; movable activities use the remaining available openings.
   */

  /*
   * Top-level: from a config object produce everything the app needs.
   * config = {
   *   name, institution, hanaId,
   *   classes: [{code, credits?, startMin?, endMin?,
   *              meetings?: [{day, startMin, endMin}], addRemainder?}],
   *   dayStartMin, blockMinutes, month (0-11), year,
   *   startDate, endDate        // optional clip, Date or "YYYY-MM-DD"
   * }
   *
   * The rows cover the month's FTW REPORT PERIOD, not its calendar days, so a
   * September form legitimately carries dates in August. The Month/Year field
   * on the paper form still reads the plain month name and year.
   *
   * Returns the full result with notices for invalid entries or unplaced hours.
   */
  function compute(config) {
    var tmpl = buildWeekTemplate(config);
    if (tmpl.error) return { error: tmpl.error };

    var period = reportPeriod(config.year, config.month);
    var from = fromISODate(config.startDate);
    var until = fromISODate(config.endDate);

    var dated = datedRows(config, tmpl, period, from, until);
    if (dated.error) return { error: dated.error };
    var attendanceRows = dated.attendanceRows;
    var studyRows = dated.studyRows;

    return {
      error: null,
      template: tmpl,
      warnings: dated.warnings,
      shortfalls: dated.shortfalls,
      period: period,
      attendanceRows: attendanceRows,
      studyRows: studyRows,
      weekly: weeklyHours(attendanceRows, studyRows),
      classWeekMin: tmpl.classWeekMin,
      studyWeekMin: tmpl.studyWeekMin,
      monthYearLabel: MONTHS[config.month] + " " + config.year,
      monAbbr: MON_ABBR[config.month]
    };
  }

  /*
   * What the rest of the app is allowed to use. Everything above that is not
   * listed here is a helper used only inside this file.
   *   compute            — the whole report period, ready for the PDFs
   *   buildWeekTemplate  — one week's timetable (what the screen shows)
   *   reportPeriod       — a month's FTW span: { start, end, weeks, label, ... }
   *   parseTime          — read a typed time, e.g. "9:30" or "1:30p", into minutes
   *   formatTime         — turn minutes back into "9:30a"
   *   formatTotal        — turn minutes into decimal hours, e.g. "1.5", "0.83"
   *   MONTHS             — month names for the month dropdown
   *   CREDIT_OPTIONS     — the numbers the Credits picker offers
   *   DEFAULT_CREDITS    — what a new class row starts at
   */
  var CREDIT_OPTIONS = [];
  for (var cOpt = MIN_CREDITS; cOpt <= MAX_CREDITS; cOpt++) CREDIT_OPTIONS.push(cOpt);

  return {
    uhHoliday: uhHoliday,
    MONTHS: MONTHS,
    CREDIT_OPTIONS: CREDIT_OPTIONS,
    DEFAULT_CREDITS: DEFAULT_CREDITS,
    parseTime: parseTime,
    formatTime: formatTime,
    formatTotal: formatTotal,
    reportPeriod: reportPeriod,
    buildWeekTemplate: buildWeekTemplate,
    compute: compute
  };
});
