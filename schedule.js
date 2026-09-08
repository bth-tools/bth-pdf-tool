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
 * (1-4, normally 3), and credits drive both halves of the week:
 *  - SCHEDULED classes (meetings: [{day, startMin, endMin}]) claim their exact
 *    days and times. Immovable. They document their real meetings and nothing
 *    more, unless the student opts in to remainder blocks (addRemainder), in
 *    which case whatever is left of the credit hours is mirrored onto the
 *    partner day.
 *  - ASYNC classes (no meetings) earn attendance equal to their credits, laid
 *    out as back-to-back blocks on the default attendance days (Mon & Wed) from
 *    the day start time, skipping any interval a scheduled class already claims.
 *  - STUDY is always the class's CREDITS, whatever attendance ended up being.
 *    It is laid out in blocks (default 1.5 hr, the last one adjusted to hit the
 *    exact total) on the default study days (Tue & Thu), overflowing to Fri,
 *    Sat, Sun, Mon, Wed.
 * Every duration is computed from exact minutes, so a 12:00-12:50 meeting is
 * 0.83 hours and a 9:00-12:20 meeting is 3.33 — never rounded to a half hour.
 * When no class is scheduled and every class is the usual 3 credits, everything
 * reduces exactly to the original Mon/Wed + mirrored Tue/Thu behavior.
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
   * The DHS forms use a plain 12-hour clock with no AM/PM ("1:30"), dates with
   * no leading zeros ("9/8"), and hours as decimals ("1.5", "0.83"). These
   * small helpers are the only place that formatting is decided.
   */

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  // Minutes-since-midnight -> "H:MM" 12-hour, no AM/PM, no 24h conversion shown.
  // 480 -> "8:00", 810 (13:30) -> "1:30", 840 (14:00) -> "2:00".
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

  function isScheduled(c) {
    return !!(c.meetings && c.meetings.length);
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
  function buildWeekTemplate(config) {
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
    // class time, the size of any remainder blocks, and all of its study time.
    var creditMins = classes.map(function (c) { return creditsOf(c) * 60; });

    // 1. Scheduled classes claim their exact days and times. Immovable.
    var meetingMins = [];
    for (i = 0; i < classes.length; i++) {
      meetingMins.push(0);
      var c = classes[i];
      if (!isScheduled(c)) continue;
      for (j = 0; j < c.meetings.length; j++) {
        var m = c.meetings[j];
        attendance[m.day].push({ code: c.code, startMin: m.startMin, endMin: m.endMin, scheduled: true });
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
        code: rc.code, startMin: pStart, endMin: pStart + owed,
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
          var ob = { code: a.code, startMin: ostart, endMin: oend, scheduled: false };
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
            var nb = { code: a.code, startMin: s, endMin: s + dur, scheduled: false };
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
     * 3. Study time. THE RULE: a class's weekly study is its CREDITS, always,
     * whatever its attendance turned out to be. A 3-credit class that meets for
     * only 1.5 literal hours still earns 3 hours of study.
     */
    var studyMins = creditMins.slice();
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
          study[sday].push({ code: src.code, startMin: src.startMin, endMin: src.endMin });
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
              study[std].push({ code: classes[i].code, startMin: ss, endMin: ss + sdur });
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

  /* ==================== TURNING ONE WEEK INTO ONE MONTH =====================
   * Everything above plans a single typical week. The rest of the file repeats
   * that week across the chosen month to produce the actual dated rows the
   * forms are filled with.
   */

  /*
   * Every date in the month that falls on one of the given weekdays. The
   * optional start/end day is the "part of a month" clip on the Month card.
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
   * Class + study hours added up per calendar week, used for reporting.
   * Each entry is one Monday-to-Sunday week: { label, monday, hours }.
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

  /* ========================= THE ONE ENTRY POINT ============================
   * Hand this the filled-in form and it returns everything needed to build the
   * PDFs: the dated attendance rows, the dated study rows, the weekly hour
   * totals and the month label. If the entered meeting times clash it returns
   * an error message instead, and no PDF is produced.
   */

  /*
   * Top-level: from a config object produce everything the app needs.
   * config = {
   *   name, institution, hanaId,
   *   classes: [{code, credits?, startMin?, endMin?,
   *              meetings?: [{day, startMin, endMin}], addRemainder?}],
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

  /*
   * What the rest of the app is allowed to use. Everything above that is not
   * listed here is a helper used only inside this file.
   *   compute            — the whole month, ready for the PDFs
   *   buildWeekTemplate  — one week's timetable (what the screen shows)
   *   parseTime          — read a typed time, e.g. "9:30", into minutes
   *   formatTime         — turn minutes back into "9:30"
   *   formatTotal        — turn minutes into decimal hours, e.g. "1.5", "0.83"
   *   MONTHS             — month names for the month dropdown
   *   CREDIT_OPTIONS     — the numbers the Credits picker offers
   *   DEFAULT_CREDITS    — what a new class row starts at
   */
  var CREDIT_OPTIONS = [];
  for (var cOpt = MIN_CREDITS; cOpt <= MAX_CREDITS; cOpt++) CREDIT_OPTIONS.push(cOpt);

  return {
    MONTHS: MONTHS,
    CREDIT_OPTIONS: CREDIT_OPTIONS,
    DEFAULT_CREDITS: DEFAULT_CREDITS,
    parseTime: parseTime,
    formatTime: formatTime,
    formatTotal: formatTotal,
    buildWeekTemplate: buildWeekTemplate,
    compute: compute
  };
});
