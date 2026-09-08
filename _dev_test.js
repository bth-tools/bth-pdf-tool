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

const BLANKS = {
  "816": "ClassAttend_DHS 816.pdf",
  "819": "StudyTimesheet_DHS 819.pdf",
  "817": "MonitoredStudy_DHS 817.pdf"
};

/*
 * Render every selected form the way app.js does, including the overflow split
 * into "_continued" copies, and report how many files each form needed. Returns
 * { "816": fileCount, ... } so tests can assert the overflow behavior.
 */
async function fillAll(prefix, res, header) {
  const rowsFor = { "816": res.attendanceRows, "819": res.studyRows, "817": res.studyRows };
  const counts = {};
  for (const key of ["816", "819", "817"]) {
    const blank = fs.readFileSync(path.join(DIR, BLANKS[key]));
    const parts = Fill.splitIntoForms(rowsFor[key], key);
    counts[key] = parts.length;
    for (let p = 0; p < parts.length; p++) {
      const out = await Fill.fill(PDFLib, blank, key, header, parts[p]);
      const sfx = p === 0 ? "" : (p === 1 ? "_continued" : "_continued" + p);
      fs.writeFileSync(path.join(OUT, prefix + "_" + key + sfx + ".pdf"), out.bytes);
      check(`${prefix}/${key}${sfx}: nothing truncated`, out.overflow === 0, String(out.overflow));
    }
  }
  return counts;
}

// Read one filled PDF back and return its non-empty row cells, so the tests
// inspect what the student will actually see rather than trusting the writer.
async function readBackRows(file, formKey) {
  const spec = Fill.FORMS[formKey];
  const doc = await PDFLib.PDFDocument.load(fs.readFileSync(file));
  const form = doc.getForm();
  const get = (name) => { try { return form.getTextField(name).getText() || ""; } catch (e) { return ""; } };
  const rows = [];
  for (const sfx of spec.suffixes) {
    const row = {
      date: get(spec.cols.date + sfx), code: get(spec.cols.code + sfx),
      start: get(spec.cols.start + sfx), end: get(spec.cols.end + sfx),
      total: get(spec.cols.total + sfx)
    };
    if (row.code) rows.push(row);
  }
  return rows;
}

const fmt = b => `${b.code} ${Sched.formatTime(b.startMin)}-${Sched.formatTime(b.endMin)}`;
const T = (h, m) => h * 60 + (m || 0);

async function main() {

  /* ================= TEST 1 — all-async regression vs golden ================= */
  console.log("\nTEST 1 — all-async regression (must be identical to the old tool)");
  // Golden snapshot of the ORIGINAL (pre-timetable) tool's output for all-async
  // configs; checked in as _dev_golden.json so the regression stays enforceable.
  // Four 3-credit online classes on the defaults must still land here exactly.
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
    // The same four classes with Credits explicitly set to 3 must be identical
    // too — the picker's default can never change the common student's output.
    const explicit = Sched.compute({
      name: "Jane Tester", institution: "UHMC", hanaId: "", dayStartMin: 480, blockMinutes: 90,
      classes: [{ code: "ACC 201", credits: 3 }, { code: "MATH 115", credits: 3 },
                { code: "BLAW 200", credits: 3 }, { code: "ECON 130", credits: 3 }],
      month: 7, year: 2026, startDay: null, endDay: null
    });
    check("golden match: credits explicitly 3",
      JSON.stringify(snap(explicit)) === JSON.stringify(golden.test1_aug2026));
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
  check("test1: no class offers a remainder switch",
    res1.template.classInfo.every(c => c.shortfallMin === 0));
  const n1 = await fillAll("t1", res1, { name: cfg1.name, institution: cfg1.institution, hanaId: "", monthYear: res1.monthYearLabel });
  check("test1: one file per form (no overflow)",
    n1["816"] === 1 && n1["819"] === 1 && n1["817"] === 1, JSON.stringify(n1));

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
  // Study follows CREDITS, not attendance: a default 3-credit class earns 3 hrs
  // of study even though it documents 4 hours of class time.
  check("test4: study 3 hrs/wk (credits, not attendance)", t4.studyWeekMin === 180, String(t4.studyWeekMin));
  check("test4: meets more than its credits, so no remainder offer",
    t4.classInfo[0].shortfallMin === 0);
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
    const cfgHours = Math.round(((res.classWeekMin + res.studyWeekMin) / 60) * 100) / 100;
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

  /* ================= TEST 6 — credits drive online class time ================= */
  console.log("\nTEST 6 — per-class credits on online classes");
  const res6 = Sched.compute({
    name: "Jane Tester", institution: "UHMC", hanaId: "",
    classes: [
      { code: "ONE CR", credits: 1 },
      { code: "TWO CR", credits: 2 },
      { code: "THREE CR", credits: 3 },
      { code: "FOUR CR", credits: 4 }
    ],
    dayStartMin: 480, blockMinutes: 90, month: 8, year: 2026, startDay: null, endDay: null
  });
  const t6 = res6.template;
  console.log("  Mon:", t6.attendance[1].map(fmt).join(", "));
  console.log("  Wed:", t6.attendance[3].map(fmt).join(", "));
  console.log("  Study Tue:", t6.study[2].map(fmt).join(", "));
  console.log("  Study Thu:", t6.study[4].map(fmt).join(", "));
  const att6 = {};
  for (let d = 0; d < 7; d++) t6.attendance[d].forEach(b => { att6[b.code] = (att6[b.code] || 0) + (b.endMin - b.startMin); });
  check("test6: attendance equals credits per class",
    att6["ONE CR"] === 60 && att6["TWO CR"] === 120 && att6["THREE CR"] === 180 && att6["FOUR CR"] === 240,
    JSON.stringify(att6));
  const oneCrBlocks = [];
  for (let d = 0; d < 7; d++) t6.attendance[d].forEach(b => { if (b.code === "ONE CR") oneCrBlocks.push(b); });
  check("test6: 1 credit is a single 1.0-hr block",
    oneCrBlocks.length === 1 && Sched.formatTotal(oneCrBlocks[0].endMin - oneCrBlocks[0].startMin) === "1");
  const fourStudy = [];
  [2, 4, 5, 6, 0, 1, 3].forEach(d => t6.study[d].forEach(b => { if (b.code === "FOUR CR") fourStudy.push(b.endMin - b.startMin); }));
  check("test6: 4 credits of study = 1.5 + 1.5 + 1",
    JSON.stringify(fourStudy.slice().sort((a, b) => b - a)) === JSON.stringify([90, 90, 60]),
    JSON.stringify(fourStudy));
  check("test6: study 10 hrs/wk (1+2+3+4)", t6.studyWeekMin === 600, String(t6.studyWeekMin));
  check("test6: attendance 10 hrs/wk", t6.classWeekMin === 600, String(t6.classWeekMin));
  assertNoOverlaps("test6", t6);

  /* ================= TEST 7 — HILO, 7 classes, Fall 2026 ================= */
  console.log("\nTEST 7 — HILO (7 classes, September 2026)");
  const cfgH = {
    name: "Hilo Student", institution: "UH Hilo", hanaId: "",
    classes: [
      { code: "SOC 200", credits: 1, meetings: [{ day: 3, startMin: T(12), endMin: T(12, 50) }] },
      { code: "SOC 280", credits: 3, addRemainder: true, meetings: [{ day: 1, startMin: T(12), endMin: T(13, 15) }] },
      { code: "SOC 280L", credits: 1 },
      { code: "SOC 365", credits: 3, meetings: [{ day: 2, startMin: T(11), endMin: T(12, 15) }, { day: 4, startMin: T(11), endMin: T(12, 15) }] },
      { code: "SOC 390", credits: 3, meetings: [{ day: 2, startMin: T(12, 30), endMin: T(13, 45) }, { day: 4, startMin: T(12, 30), endMin: T(13, 45) }] },
      { code: "SOC 400", credits: 3, meetings: [{ day: 3, startMin: T(14), endMin: T(16, 45) }] },
      { code: "SOC 360", credits: 3 }
    ],
    dayStartMin: 480, blockMinutes: 90, month: 8, year: 2026, startDay: null, endDay: null
  };
  const resH = Sched.compute(cfgH);
  check("hilo: no error", !resH.error, resH.error && resH.error.message);
  const tH = resH.template;
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((n, d) => {
    if (tH.attendance[d].length) console.log("  " + n + ":", tH.attendance[d].map(fmt).join(", "));
  });
  console.log("  Study Tue:", tH.study[2].map(fmt).join(", "));
  console.log("  Study Thu:", tH.study[4].map(fmt).join(", "));
  assertNoOverlaps("hilo", tH);
  // Wednesday carries the two literal blocks (0.83 and 2.75) with the online and
  // remainder blocks flowed around them.
  const wedTotals = tH.attendance[3].map(b => Sched.formatTotal(b.endMin - b.startMin));
  console.log("  Wed totals:", wedTotals.join(", "));
  check("hilo: Wed has literal 0.83 and 2.75 blocks",
    wedTotals.includes("0.83") && wedTotals.includes("2.75"), JSON.stringify(wedTotals));
  check("hilo: SOC 200 prints 12:00-12:50 = 0.83",
    tH.attendance[3].some(b => b.code === "SOC 200" && fmt(b) === "SOC 200 12:00-12:50" &&
      Sched.formatTotal(b.endMin - b.startMin) === "0.83"));
  check("hilo: SOC 400 prints 2:00-4:45 = 2.75",
    tH.attendance[3].some(b => b.code === "SOC 400" && fmt(b) === "SOC 400 2:00-4:45" &&
      Sched.formatTotal(b.endMin - b.startMin) === "2.75"));
  const remH = [];
  for (let d = 0; d < 7; d++) tH.attendance[d].forEach(b => { if (b.remainder) remH.push({ d, b }); });
  check("hilo: exactly one remainder block, SOC 280, 1.75 hrs, mirrored to Wed",
    remH.length === 1 && remH[0].b.code === "SOC 280" && remH[0].d === 3 &&
    Sched.formatTotal(remH[0].b.endMin - remH[0].b.startMin) === "1.75",
    JSON.stringify(remH.map(r => r.d + " " + fmt(r.b))));
  check("hilo: study totals 17 hrs/week", tH.studyWeekMin === 17 * 60, String(tH.studyWeekMin));
  const studyH = {};
  for (let d = 0; d < 7; d++) tH.study[d].forEach(b => { studyH[b.code] = (studyH[b.code] || 0) + (b.endMin - b.startMin); });
  check("hilo: each class earns exactly its credits in study",
    tH.classInfo.every(c => studyH[c.code] === c.creditMin), JSON.stringify(studyH));
  // Switches left off document literal meetings only.
  const infoH = Object.fromEntries(tH.classInfo.map(c => [c.code, c]));
  check("hilo: SOC 365 documents its 2.5 literal hours only",
    infoH["SOC 365"].attendanceMin === 150 && infoH["SOC 365"].remainderMin === 0);
  check("hilo: SOC 200 note reads 0.83 of 1",
    Sched.formatTotal(infoH["SOC 200"].meetingMin) === "0.83" && infoH["SOC 200"].credits === 1 &&
    infoH["SOC 200"].shortfallMin > 0);
  check("hilo: attendance panel = 15.58 hrs/week",
    Sched.formatTotal(tH.classWeekMin) === "15.58", Sched.formatTotal(tH.classWeekMin));
  const nH = await fillAll("hilo", resH, { name: cfgH.name, institution: cfgH.institution, hanaId: "", monthYear: resH.monthYearLabel });
  console.log("  files per form:", JSON.stringify(nH));
  check("hilo: September overflows every form into a _continued copy",
    nH["816"] > 1 && nH["819"] > 1 && nH["817"] > 1, JSON.stringify(nH));
  // Nothing may be lost: what went into the PDFs must be every computed row.
  let hiloRead = [];
  for (let p = 0; p < nH["816"]; p++) {
    const sfx = p === 0 ? "" : (p === 1 ? "_continued" : "_continued" + p);
    hiloRead = hiloRead.concat(await readBackRows(path.join(OUT, "hilo_816" + sfx + ".pdf"), "816"));
  }
  check("hilo: every attendance row reached a PDF",
    hiloRead.length === resH.attendanceRows.length,
    hiloRead.length + " of " + resH.attendanceRows.length);
  check("hilo: rows read back in order and unchanged",
    hiloRead.every((r, i) => r.code === resH.attendanceRows[i].code &&
      r.start === resH.attendanceRows[i].start && r.total === resH.attendanceRows[i].total));
  check("hilo: the continued copy opens on a dated row", hiloRead.length > 0 && !!hiloRead[0].date);
  const contFirst = await readBackRows(path.join(OUT, "hilo_816_continued.pdf"), "816");
  check("hilo: continued copy's first row carries its date", !!contFirst[0].date, JSON.stringify(contFirst[0]));

  /* ================= TEST 8 — LAW, 6 classes ================= */
  console.log("\nTEST 8 — LAW (6 classes, September 2026)");
  const cfgL = {
    name: "Law Student", institution: "UH Manoa", hanaId: "",
    classes: [
      { code: "LAW 555H", credits: 4, meetings: [{ day: 5, startMin: T(12), endMin: T(13, 30) }] },
      { code: "LAW 590P", credits: 2, meetings: [{ day: 6, startMin: T(9), endMin: T(12, 20) }] },
      { code: "LWPA 581", credits: 3, addRemainder: true, meetings: [{ day: 1, startMin: T(13, 30), endMin: T(14, 45) }, { day: 3, startMin: T(13, 30), endMin: T(14, 45) }] },
      { code: "LAW 535", credits: 3, meetings: [{ day: 2, startMin: T(15, 20), endMin: T(16, 35) }, { day: 4, startMin: T(15, 20), endMin: T(16, 35) }] },
      { code: "LAW 523", credits: 3, meetings: [{ day: 1, startMin: T(10), endMin: T(11, 40) }] },
      { code: "LAW 533", credits: 3, meetings: [{ day: 2, startMin: T(13, 30), endMin: T(14, 45) }, { day: 4, startMin: T(13, 30), endMin: T(14, 45) }] }
    ],
    dayStartMin: 480, blockMinutes: 90, month: 8, year: 2026, startDay: null, endDay: null
  };
  const resL = Sched.compute(cfgL);
  check("law: no error", !resL.error, resL.error && resL.error.message);
  const tL = resL.template;
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((n, d) => {
    if (tL.attendance[d].length) console.log("  " + n + ":", tL.attendance[d].map(fmt).join(", "));
  });
  assertNoOverlaps("law", tL);
  const infoL = Object.fromEntries(tL.classInfo.map(c => [c.code, c]));
  check("law: LAW 555H switch off — documents 1.5, note reads 1.5 of 4",
    infoL["LAW 555H"].attendanceMin === 90 && infoL["LAW 555H"].remainderMin === 0 &&
    Sched.formatTotal(infoL["LAW 555H"].meetingMin) === "1.5" && infoL["LAW 555H"].credits === 4 &&
    infoL["LAW 555H"].shortfallMin > 0);
  check("law: LAW 590P documents 3.33, offers no switch, studies 2",
    Sched.formatTotal(infoL["LAW 590P"].attendanceMin) === "3.33" &&
    infoL["LAW 590P"].shortfallMin === 0 &&
    Sched.formatTotal(infoL["LAW 590P"].studyMin) === "2");
  check("law: LWPA 581 switch on — 0.5 remainder",
    Sched.formatTotal(infoL["LWPA 581"].remainderMin) === "0.5", String(infoL["LWPA 581"].remainderMin));
  check("law: LAW 523 documents 1.67",
    Sched.formatTotal(infoL["LAW 523"].attendanceMin) === "1.67");
  check("law: attendance panel = 14.5 hrs/week",
    Sched.formatTotal(tL.classWeekMin) === "14.5", Sched.formatTotal(tL.classWeekMin));
  check("law: study panel = 18 hrs/week", Sched.formatTotal(tL.studyWeekMin) === "18",
    Sched.formatTotal(tL.studyWeekMin));
  // Saturday rows must print the "Sa" day letter.
  const satRows = resL.attendanceRows.filter(r => r.dateObj.getDay() === 6);
  console.log("  Saturday rows:", satRows.map(r => `${r.date} ${r.code} ${r.start}-${r.end} = ${r.total}`).join(" | "));
  check("law: Saturday rows print “Sa” and 3.33",
    satRows.length > 0 && satRows.every(r => /^Sa \d/.test(r.date) && r.total === "3.33"));
  // Every totals cell on both forms is a 2-decimal (or shorter) decimal number.
  const decimalOk = v => /^\d+(\.\d{1,2})?$/.test(v);
  check("law: every attendance total is a clean decimal",
    resL.attendanceRows.every(r => decimalOk(r.total)),
    JSON.stringify([...new Set(resL.attendanceRows.map(r => r.total))]));
  check("law: every study total is a clean decimal",
    resL.studyRows.every(r => decimalOk(r.total)),
    JSON.stringify([...new Set(resL.studyRows.map(r => r.total))]));
  const nL = await fillAll("law", resL, { name: cfgL.name, institution: cfgL.institution, hanaId: "", monthYear: resL.monthYearLabel });
  console.log("  files per form:", JSON.stringify(nL));
  let lawRead = [];
  for (let p = 0; p < nL["816"]; p++) {
    const sfx = p === 0 ? "" : (p === 1 ? "_continued" : "_continued" + p);
    lawRead = lawRead.concat(await readBackRows(path.join(OUT, "law_816" + sfx + ".pdf"), "816"));
  }
  check("law: every attendance row reached a PDF",
    lawRead.length === resL.attendanceRows.length,
    lawRead.length + " of " + resL.attendanceRows.length);
  const satInPdf = lawRead.filter(r => /^Sa /.test(r.date));
  check("law: the filled PDF shows Saturday dates", satInPdf.length > 0,
    JSON.stringify(satInPdf.slice(0, 2)));

  /* ================= TEST 9 — remainder switch is genuinely opt-in ========== */
  console.log("\nTEST 9 — the remainder switch changes nothing until it is turned on");
  const shortClass = day => ({
    name: "Jane Tester", institution: "UHMC", hanaId: "",
    classes: [{ code: "SHORT", credits: 3, addRemainder: false, meetings: [{ day: day, startMin: T(10), endMin: T(11, 30) }] }],
    dayStartMin: 480, blockMinutes: 90, month: 8, year: 2026, startDay: null, endDay: null
  });
  const off = Sched.compute(shortClass(1));
  const onCfg = shortClass(1); onCfg.classes[0].addRemainder = true;
  const on = Sched.compute(onCfg);
  check("test9: off — only the real Monday meeting is documented",
    off.template.attendance[1].length === 1 && off.template.attendance[3].length === 0 &&
    off.classWeekMin === 90, String(off.classWeekMin));
  check("test9: off — study is still the full 3 credits", off.studyWeekMin === 180);
  check("test9: off — the row is told it is 1.5 of 3",
    Sched.formatTotal(off.template.classInfo[0].meetingMin) === "1.5" &&
    off.template.classInfo[0].shortfallMin === 90);
  check("test9: on — a mirrored Wednesday block appears at the same clock time",
    on.template.attendance[3].length === 1 &&
    fmt(on.template.attendance[3][0]) === "SHORT 10:00-11:30" &&
    on.classWeekMin === 180, on.template.attendance[3].map(fmt).join(", "));
  check("test9: on — study is unchanged at 3 credits", on.studyWeekMin === 180);

  console.log("\n" + (failures ? failures + " FAILURE(S)" : "ALL CHECKS PASSED"));
  console.log("Filled PDFs written to _dev_out/");
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
