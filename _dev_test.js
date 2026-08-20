/* Dev-only acceptance test harness. Not part of the deployed app. */
const fs = require("fs");
const path = require("path");
const PDFLib = require("pdf-lib");
const Sched = require("./schedule.js");
const Fill = require("./pdffill.js");

const DIR = __dirname;
const OUT = path.join(DIR, "_dev_out");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  PASS  " + name);
  else { failures++; console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}

function snapRows(rows) {
  return rows.map(r => ({
    date: r.date, code: r.code, start: r.start, end: r.end, total: r.total, hours: r.hours
  }));
}
function snap(res) {
  return {
    attendanceRows: snapRows(res.attendanceRows),
    studyRows: snapRows(res.studyRows),
    weekly: res.weekly.map(w => ({ label: w.label, hours: w.hours })),
    monthYearLabel: res.monthYearLabel,
    monAbbr: res.monAbbr
  };
}

// Every block on the same weekday (attendance + study together) must be
// non-overlapping. Uses the weekly template.
function assertNoOverlaps(label, tmpl) {
  let ok = true, detail = "";
  for (let d = 0; d < 7; d++) {
    const all = tmpl.attendance[d].concat(tmpl.study[d])
      .slice().sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < all.length; i++) {
      if (all[i].startMin < all[i - 1].endMin) {
        ok = false;
        detail = `day ${d}: ${all[i - 1].code} ${all[i - 1].startMin}-${all[i - 1].endMin} overlaps ${all[i].code} ${all[i].startMin}-${all[i].endMin}`;
      }
    }
  }
  check(label + ": no overlaps anywhere", ok, detail);
}

function sumHours(rows) {
  return Math.round(rows.reduce((a, r) => a + r.hours, 0) * 100) / 100;
}

async function fillAll(prefix, res, header) {
  const f816 = fs.readFileSync(path.join(DIR, "ClassAttend_DHS 816.pdf"));
  const f819 = fs.readFileSync(path.join(DIR, "StudyTimesheet_DHS 819.pdf"));
  const f817 = fs.readFileSync(path.join(DIR, "MonitoredStudy_DHS 817.pdf"));
  const out816 = await Fill.fill(PDFLib, f816, "816", header, res.attendanceRows);
  const out819 = await Fill.fill(PDFLib, f819, "819", header, res.studyRows);
  const out817 = await Fill.fill(PDFLib, f817, "817", header, res.studyRows);
  fs.writeFileSync(path.join(OUT, prefix + "_816.pdf"), out816.bytes);
  fs.writeFileSync(path.join(OUT, prefix + "_819.pdf"), out819.bytes);
  fs.writeFileSync(path.join(OUT, prefix + "_817.pdf"), out817.bytes);
  return { out816, out819, out817 };
}

async function main() {

  /* ================= TEST 1 — all-async regression vs golden ================= */
  console.log("\nTEST 1 — all-async regression (must be identical to the old tool)");
  // Golden snapshot of the ORIGINAL (pre-timetable) tool's output for all-async
  // configs; checked in as _dev_golden.json so the regression stays enforceable.
  const goldenPath = process.argv[2] || path.join(DIR, "_dev_golden.json");
  if (goldenPath && fs.existsSync(goldenPath)) {
    const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
    const scenarios = {
      test1_aug2026: { classes: [{ code: "ACC 201" }, { code: "MATH 115" }, { code: "BLAW 200" }, { code: "ECON 130" }], month: 7, year: 2026, startDay: null, endDay: null },
      test1_clip:    { classes: [{ code: "ACC 201" }, { code: "MATH 115" }, { code: "BLAW 200" }, { code: "ECON 130" }], month: 7, year: 2026, startDay: 5, endDay: 24 },
      test1_override:{ classes: [{ code: "ACC 201" }, { code: "MATH 115", startMin: 600 }, { code: "BLAW 200" }], month: 7, year: 2026, startDay: null, endDay: null },
      test1_mar2026: { classes: [{ code: "ACC 201" }, { code: "MATH 115" }, { code: "BLAW 200" }, { code: "ECON 130" }], month: 2, year: 2026, startDay: null, endDay: null }
    };
    for (const [k, sc] of Object.entries(scenarios)) {
      const res = Sched.compute({
        name: "Jane Tester", institution: "UHMC", hanaId: "",
        dayStartMin: 480, blockMinutes: 90, ...sc
      });
      const same = JSON.stringify(snap(res)) === JSON.stringify(golden[k]);
      check("golden match: " + k, same);
    }
  } else {
    check("golden file provided", false, "pass golden.json path as argv[2]");
  }

  const cfg1 = {
    name: "Jane Tester", institution: "UHMC", hanaId: "",
    classes: [{ code: "ACC 201" }, { code: "MATH 115" }, { code: "BLAW 200" }, { code: "ECON 130" }],
    dayStartMin: 480, blockMinutes: 90, month: 7, year: 2026, startDay: null, endDay: null
  };
  const res1 = Sched.compute(cfg1);
  assertNoOverlaps("test1", res1.template);
  check("test1: panel class 12 hrs/wk", res1.classWeekMin === 720, String(res1.classWeekMin));
  check("test1: panel study 12 hrs/wk", res1.studyWeekMin === 720, String(res1.studyWeekMin));
  await fillAll("t1", res1, { name: cfg1.name, institution: cfg1.institution, hanaId: "", monthYear: res1.monthYearLabel });

  /* ================= TEST 2 — mixed scenario ================= */
  console.log("\nTEST 2 — mixed async + scheduled");
  // One: async. Two: Tue 9:00–12:00. Three: async. Four: Wed 13:00–14:30 AND Fri 13:00–14:30.
  const cfg2 = {
    name: "Jane Tester", institution: "UHMC", hanaId: "",
    classes: [
      { code: "One" },
      { code: "Two", meetings: [{ day: 2, startMin: 540, endMin: 720 }] },
      { code: "Three" },
      { code: "Four", meetings: [{ day: 3, startMin: 780, endMin: 870 }, { day: 5, startMin: 780, endMin: 870 }] }
    ],
    dayStartMin: 480, blockMinutes: 90, month: 7, year: 2026, startDay: null, endDay: null
  };
  const res2 = Sched.compute(cfg2);
  check("test2: no error", !res2.error, res2.error && res2.error.message);
  const t2 = res2.template;
  const fmt = b => `${b.code} ${Sched.formatTime(b.startMin)}-${Sched.formatTime(b.endMin)}`;
  console.log("  Mon:", t2.attendance[1].map(fmt).join(", "));
  console.log("  Tue:", t2.attendance[2].map(fmt).join(", "));
  console.log("  Wed:", t2.attendance[3].map(fmt).join(", "));
  console.log("  Fri:", t2.attendance[5].map(fmt).join(", "));
  console.log("  Study Tue:", t2.study[2].map(fmt).join(", "));
  console.log("  Study Thu:", t2.study[4].map(fmt).join(", "));
  check("test2: Mon = One 8:00-9:30, Three 9:30-11:00",
    JSON.stringify(t2.attendance[1].map(fmt)) === JSON.stringify(["One 8:00-9:30", "Three 9:30-11:00"]));
  check("test2: Tue = Two 9:00-12:00 only",
    JSON.stringify(t2.attendance[2].map(fmt)) === JSON.stringify(["Two 9:00-12:00"]));
  check("test2: Tue block total 3.0",
    Sched.formatTotal(t2.attendance[2][0].endMin - t2.attendance[2][0].startMin) === "3");
  check("test2: Wed = One, Three async then Four 1:00-2:30",
    JSON.stringify(t2.attendance[3].map(fmt)) === JSON.stringify(["One 8:00-9:30", "Three 9:30-11:00", "Four 1:00-2:30"]));
  check("test2: Fri = Four 1:00-2:30 only",
    JSON.stringify(t2.attendance[5].map(fmt)) === JSON.stringify(["Four 1:00-2:30"]));
  check("test2: study only on Tue/Thu",
    [0, 1, 3, 5, 6].every(d => t2.study[d].length === 0));
  check("test2: Tuesday study skips 9:00-12:00",
    t2.study[2].every(b => b.endMin <= 540 || b.startMin >= 720));
  check("test2: class 12 hrs/wk", t2.classWeekMin === 720, String(t2.classWeekMin));
  check("test2: study 12 hrs/wk (3 per class)", t2.studyWeekMin === 720, String(t2.studyWeekMin));
  const perClass2 = {};
  [2, 4].forEach(d => t2.study[d].forEach(b => { perClass2[b.code] = (perClass2[b.code] || 0) + (b.endMin - b.startMin); }));
  check("test2: each class gets 3 hrs study",
    ["One", "Two", "Three", "Four"].every(c => perClass2[c] === 180), JSON.stringify(perClass2));
  assertNoOverlaps("test2", t2);
  // 816 must list every weekday carrying attendance (Mon, Tue, Wed, Fri).
  const attDays2 = new Set(res2.attendanceRows.map(r => r.dateObj.getDay()));
  check("test2: 816 covers Mon+Tue+Wed+Fri", [1, 2, 3, 5].every(d => attDays2.has(d)) && !attDays2.has(4));
  await fillAll("t2", res2, { name: cfg2.name, institution: cfg2.institution, hanaId: "", monthYear: res2.monthYearLabel });

  /* ================= TEST 3 — collision ================= */
  console.log("\nTEST 3 — overlapping scheduled classes");
  const res3 = Sched.compute({
    name: "Jane Tester", institution: "UHMC", hanaId: "",
    classes: [
      { code: "ACC 201", meetings: [{ day: 2, startMin: 540, endMin: 660 }] },
      { code: "MATH 115", meetings: [{ day: 2, startMin: 600, endMin: 720 }] }
    ],
    dayStartMin: 480, blockMinutes: 90, month: 7, year: 2026, startDay: null, endDay: null
  });
  check("test3: returns error, no rows", !!res3.error && !res3.attendanceRows);
  check("test3: plain-language message",
    !!res3.error && /overlap on Tuesday — check the times/.test(res3.error.message),
    res3.error && res3.error.message);
  console.log("  message:", res3.error && res3.error.message);

  /* ================= TEST 4 — odd hours (evening class) ================= */
  console.log("\nTEST 4 — Mon 5:00 PM–9:00 PM");
  const cfg4 = {
    name: "Jane Tester", institution: "UHMC", hanaId: "",
    classes: [{ code: "NURS 320", meetings: [{ day: 1, startMin: 17 * 60, endMin: 21 * 60 }] }],
    dayStartMin: 480, blockMinutes: 90, month: 7, year: 2026, startDay: null, endDay: null
  };
  const res4 = Sched.compute(cfg4);
  const t4 = res4.template;
  console.log("  Mon:", t4.attendance[1].map(fmt).join(", "));
  console.log("  Study Tue:", t4.study[2].map(fmt).join(", "), " Thu:", t4.study[4].map(fmt).join(", "));
  check("test4: Mon prints 5:00-9:00 total 4",
    t4.attendance[1].length === 1 &&
    Sched.formatTime(t4.attendance[1][0].startMin) === "5:00" &&
    Sched.formatTime(t4.attendance[1][0].endMin) === "9:00" &&
    Sched.formatTotal(t4.attendance[1][0].endMin - t4.attendance[1][0].startMin) === "4");
  check("test4: class 4 hrs/wk", t4.classWeekMin === 240, String(t4.classWeekMin));
  check("test4: study 4 hrs/wk exactly", t4.studyWeekMin === 240, String(t4.studyWeekMin));
  check("test4: only Monday has attendance",
    [0, 2, 3, 4, 5, 6].every(d => t4.attendance[d].length === 0));
  assertNoOverlaps("test4", t4);
  await fillAll("t4", res4, { name: cfg4.name, institution: cfg4.institution, hanaId: "", monthYear: res4.monthYearLabel });

  /* ================= TEST 5 — panel totals match the PDFs ================= */
  console.log("\nTEST 5 — hours panel vs generated rows (monthly rows consistent with weekly rates)");
  // The panel shows weekly rates; the PDFs carry per-date rows. Confirm every
  // full Mon–Sun week inside the month sums to classWeekMin+studyWeekMin.
  function fullWeekCheck(label, res) {
    // res.weekly is already grouped Mon-start; count only weeks fully inside the month.
    const cfgHours = (res.classWeekMin + res.studyWeekMin) / 60;
    const full = res.weekly.filter(w => {
      const mon = w.monday;
      const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
      const first = res.attendanceRows[0].dateObj, month = first.getMonth();
      const dim = new Date(first.getFullYear(), month + 1, 0).getDate();
      return mon.getMonth() === month && sun.getMonth() === month && mon.getDate() >= 1 && sun.getDate() <= dim;
    });
    check(label + ": every full week = " + cfgHours + " hrs",
      full.length > 0 && full.every(w => w.hours === cfgHours),
      JSON.stringify(full.map(w => w.label + "=" + w.hours)));
  }
  fullWeekCheck("test5/t1", res1);
  fullWeekCheck("test5/t2", res2);
  fullWeekCheck("test5/t4", res4);
  // (Month totals for attendance vs study differ whenever the month holds an
  // unequal count of Mon/Wed vs Tue/Thu — true of the original tool as well.)
  console.log("  t1 month totals: attendance", sumHours(res1.attendanceRows), "hrs, study", sumHours(res1.studyRows), "hrs");

  console.log("\n" + (failures ? failures + " FAILURE(S)" : "ALL CHECKS PASSED"));
  console.log("Filled PDFs written to _dev_out/ (t1_*, t2_*, t4_*)");
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
