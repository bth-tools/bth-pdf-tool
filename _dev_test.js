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

/* ===================== DOES EVERY VALUE FIT ITS COLUMN? ====================
 * The compact meridiem adds a character to the two narrowest columns, so this
 * measures every value actually written into every filled PDF against the box
 * it has to sit in.
 *
 * The 816 and 817 are landscape pages whose widgets are rotated 270°, so the
 * run of text goes along the rectangle's HEIGHT, not its width; the 819 is an
 * upright page where it goes along the width. pdf-lib insets its generated
 * appearance by 1pt of padding plus the border, so 2pt a side is allowed for.
 */
const FIT_PADDING = 2; // points of inset per side, matching pdf-lib's appearance

async function checkFits(label, files) {
  const probe = await PDFLib.PDFDocument.create();
  const helv = await probe.embedFont(PDFLib.StandardFonts.Helvetica);
  let worst = null, bad = [];
  for (const { file, formKey } of files) {
    const doc = await PDFLib.PDFDocument.load(fs.readFileSync(file));
    for (const field of doc.getForm().getFields()) {
      if (!(field instanceof PDFLib.PDFTextField)) continue;
      const text = field.getText();
      if (!text) continue;
      // pdf-lib has no getFontSize(); the size lives in the field's default
      // appearance string, e.g. "/Helv 9 Tf 0 g". 0 there means auto-size.
      const da = field.acroField.getDefaultAppearance() || "";
      const declared = parseFloat((/([\d.]+)\s+Tf/.exec(da) || [])[1]);
      const size = declared > 0 ? declared : 9;
      const width = helv.widthOfTextAtSize(text, size);
      for (const w of field.acroField.getWidgets()) {
        const rect = w.getRectangle();
        const rotation = (w.getAppearanceCharacteristics() &&
          w.getAppearanceCharacteristics().getRotation()) || 0;
        const room = (rotation % 180 === 90 ? rect.height : rect.width) - FIT_PADDING * 2;
        const slack = room - width;
        if (!worst || slack < worst.slack) {
          worst = { slack, text, name: field.getName(), room, width, file: path.basename(file) };
        }
        if (slack < 0) bad.push(`${path.basename(file)} ${field.getName()} "${text}" needs ${width.toFixed(1)} has ${room.toFixed(1)}`);
      }
    }
  }
  check(label + ": every filled value fits its column", bad.length === 0, bad.slice(0, 4).join(" | "));
  if (worst) {
    console.log(`    tightest: "${worst.text}" in ${worst.name} — ` +
      `${worst.width.toFixed(1)}pt of ${worst.room.toFixed(1)}pt (${worst.slack.toFixed(1)}pt spare)`);
  }
}

/*
 * The weekly pattern a set of dated rows describes: for each weekday, the
 * blocks on the FIRST date that weekday appears. Independent of which dates a
 * form happens to span, which is what lets the report-period change be checked
 * against the pre-period golden snapshot.
 */
function weekPattern(rows, stripMeridiem) {
  const firstDateFor = {}, byDay = {};
  for (const r of rows) {
    const letter = r.dateFull.split(" ")[0];
    if (!firstDateFor[letter]) firstDateFor[letter] = r.dateFull;
    if (firstDateFor[letter] !== r.dateFull) continue;
    const t = s => stripMeridiem ? String(s).replace(/[ap]$/, "") : String(s);
    (byDay[letter] = byDay[letter] || []).push([r.code, t(r.start), t(r.end), r.total].join("|"));
  }
  return byDay;
}

// The golden snapshot predates dateFull, so rebuild it from the sparse `date`
// column the same way a reader going down the page would.
function goldenRows(snapshot) {
  let carried = "";
  return snapshot.map(r => {
    if (r.date) carried = r.date;
    return Object.assign({}, r, { dateFull: carried });
  });
}

const fmt = b => `${b.code} ${Sched.formatTime(b.startMin)}-${Sched.formatTime(b.endMin)}`;
const T = (h, m) => h * 60 + (m || 0);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function main() {

  /* ================= TEST 1 — all-async regression vs golden =================
   * The golden file is the ORIGINAL (pre-report-period, pre-meridiem) tool's
   * output. What must still match is the WEEKLY PATTERN — which blocks, in
   * which order, on which weekday, with which totals. Only the span of dates
   * and the time format are allowed to differ. (Acceptance test T6.)
   */
  console.log("\nTEST 1 — all-async regression (weekly pattern must be identical to the old tool)");
  const goldenPath = process.argv[2] || path.join(DIR, "_dev_golden.json");
  if (goldenPath && fs.existsSync(goldenPath)) {
    const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
    const FOUR = [{ code: "ACC 201" }, { code: "MATH 115" }, { code: "BLAW 200" }, { code: "ECON 130" }];
    const scenarios = {
      test1_aug2026: { classes: FOUR, month: 7, year: 2026 },
      test1_override:{ classes: [{ code: "ACC 201" }, { code: "MATH 115", startMin: 600 }, { code: "BLAW 200" }], month: 7, year: 2026 },
      test1_mar2026: { classes: FOUR, month: 2, year: 2026 }
    };
    for (const [k, sc] of Object.entries(scenarios)) {
      const res = Sched.compute({
        name: "Jane Tester", institution: "UHMC", hanaId: "",
        dayStartMin: 480, blockMinutes: 90, startDate: null, endDate: null, ...sc
      });
      for (const which of ["attendanceRows", "studyRows"]) {
        const want = weekPattern(goldenRows(golden[k][which]), false);
        const got = weekPattern(res[which], true);
        check(`golden weekly pattern: ${k}/${which}`,
          JSON.stringify(got) === JSON.stringify(want),
          JSON.stringify(got) + " vs " + JSON.stringify(want));
      }
      check(`golden month label: ${k}`, res.monthYearLabel === golden[k].monthYearLabel);
      const goldHours = [...new Set(golden[k].weekly.map(w => w.hours))];
      check(`golden weekly hours still reachable: ${k}`,
        res.weekly.every(w => goldHours.includes(w.hours)),
        JSON.stringify(res.weekly.map(w => w.label + "=" + w.hours)));
    }
    // The same four classes with Credits explicitly set to 3 must be identical
    // too — the picker's default can never change the common student's output.
    const explicit = Sched.compute({
      name: "Jane Tester", institution: "UHMC", hanaId: "", dayStartMin: 480, blockMinutes: 90,
      classes: FOUR.map(c => ({ ...c, credits: 3 })),
      month: 7, year: 2026, startDate: null, endDate: null
    });
    const plain = Sched.compute({
      name: "Jane Tester", institution: "UHMC", hanaId: "", dayStartMin: 480, blockMinutes: 90,
      classes: FOUR, month: 7, year: 2026, startDate: null, endDate: null
    });
    check("golden match: credits explicitly 3",
      JSON.stringify(snapRows(explicit.attendanceRows)) === JSON.stringify(snapRows(plain.attendanceRows)));
  } else {
    check("golden file provided", false, "pass golden.json path as argv[2]");
  }

  const cfg1 = {
    name: "Jane Tester", institution: "UHMC", hanaId: "",
    classes: [{ code: "ACC 201" }, { code: "MATH 115" }, { code: "BLAW 200" }, { code: "ECON 130" }],
    dayStartMin: 480, blockMinutes: 90, month: 7, year: 2026, startDate: null, endDate: null
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
    dayStartMin: 480, blockMinutes: 90, month: 7, year: 2026, startDate: null, endDate: null
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
  check("test2: Mon = One 8:00a-9:30a, Three 9:30a-11:00a",
    JSON.stringify(t2.attendance[1].map(fmt)) === JSON.stringify(["One 8:00a-9:30a", "Three 9:30a-11:00a"]));
  check("test2: Tue = Two 9:00a-12:00p only",
    JSON.stringify(t2.attendance[2].map(fmt)) === JSON.stringify(["Two 9:00a-12:00p"]));
  check("test2: Tue block total 3.0",
    Sched.formatTotal(t2.attendance[2][0].endMin - t2.attendance[2][0].startMin) === "3");
  check("test2: Wed = One, Three async then Four 1:00p-2:30p",
    JSON.stringify(t2.attendance[3].map(fmt)) === JSON.stringify(["One 8:00a-9:30a", "Three 9:30a-11:00a", "Four 1:00p-2:30p"]));
  check("test2: Fri = Four 1:00p-2:30p only",
    JSON.stringify(t2.attendance[5].map(fmt)) === JSON.stringify(["Four 1:00p-2:30p"]));
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
    dayStartMin: 480, blockMinutes: 90, month: 7, year: 2026, startDate: null, endDate: null
  });
  check("test3: retains entered meetings and generates rows", !res3.error && res3.attendanceRows.length > 0);
  check("test3: no fixed-conflict repair notice", res3.warnings.length === 0);
  check("test3: fixed meeting times remain unchanged", res3.attendanceRows.every(r =>
    r.code === "ACC 201" ? r.start === "9:00a" && r.end === "11:00a" :
      r.code === "MATH 115" && r.start === "10:00a" && r.end === "12:00p"));

  /* ================= TEST 4 — odd hours (evening class) ================= */
  console.log("\nTEST 4 — Mon 5:00 PM–9:00 PM");
  const cfg4 = {
    name: "Jane Tester", institution: "UHMC", hanaId: "",
    classes: [{ code: "NURS 320", meetings: [{ day: 1, startMin: 17 * 60, endMin: 21 * 60 }] }],
    dayStartMin: 480, blockMinutes: 90, month: 7, year: 2026, startDate: null, endDate: null
  };
  const res4 = Sched.compute(cfg4);
  const t4 = res4.template;
  console.log("  Mon:", t4.attendance[1].map(fmt).join(", "));
  console.log("  Study Tue:", t4.study[2].map(fmt).join(", "), " Thu:", t4.study[4].map(fmt).join(", "));
  check("test4: Mon prints 5:00p-9:00p total 4",
    t4.attendance[1].length === 1 &&
    Sched.formatTime(t4.attendance[1][0].startMin) === "5:00p" &&
    Sched.formatTime(t4.attendance[1][0].endMin) === "9:00p" &&
    Sched.formatTotal(t4.attendance[1][0].endMin - t4.attendance[1][0].startMin) === "4");
  check("test4: class 4 hrs/wk", t4.classWeekMin === 240, String(t4.classWeekMin));
  // Study follows CREDITS, not attendance: a default 3-credit class earns 3 hrs
  // of study under the old rule; now it matches 4 hours of class time.
  check("test4: study matches 4 hrs attendance", t4.studyWeekMin === 240, String(t4.studyWeekMin));
  check("test4: meets more than its credits, so no remainder offer",
    t4.classInfo[0].shortfallMin === 0);
  check("test4: only Monday has attendance",
    [0, 2, 3, 4, 5, 6].every(d => t4.attendance[d].length === 0));
  assertNoOverlaps("test4", t4);
  await fillAll("t4", res4, { name: cfg4.name, institution: cfg4.institution, hanaId: "", monthYear: res4.monthYearLabel });

  /* ================= TEST 5 — panel totals match the PDFs =================
   * The panel shows weekly rates; the PDFs carry per-date rows. Because a
   * report period is nothing but whole Sun–Sat weeks, EVERY week on the form
   * may be lower than the template when UH holidays remove scheduled time.
   */
  console.log("\nTEST 5 — hours panel vs generated rows (every FTW week on the form)");
  function everyWeekCheck(label, res) {
    const want = Math.round(((res.classWeekMin + res.studyWeekMin) / 60) * 100) / 100;
    check(label + ": holiday weeks do not exceed the normal " + want + " hrs",
      res.weekly.length === res.period.weeks && res.weekly.every(w => w.hours <= want) &&
      Math.abs(sumHours(res.attendanceRows) - sumHours(res.studyRows)) < 0.00001,
      JSON.stringify(res.weekly.map(w => w.label + "=" + w.hours)));
  }
  everyWeekCheck("test5/t1", res1);
  everyWeekCheck("test5/t2", res2);
  everyWeekCheck("test5/t4", res4);
  console.log("  t1 period totals: attendance", sumHours(res1.attendanceRows), "hrs, study", sumHours(res1.studyRows), "hrs");

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
    dayStartMin: 480, blockMinutes: 90, month: 8, year: 2026, startDate: null, endDate: null
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
    dayStartMin: 480, blockMinutes: 90, month: 8, year: 2026, startDate: null, endDate: null
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
  check("hilo: SOC 200 prints 12:00p-12:50p = 0.83",
    tH.attendance[3].some(b => b.code === "SOC 200" && fmt(b) === "SOC 200 12:00p-12:50p" &&
      Sched.formatTotal(b.endMin - b.startMin) === "0.83"));
  check("hilo: SOC 400 prints 2:00p-4:45p = 2.75",
    tH.attendance[3].some(b => b.code === "SOC 400" && fmt(b) === "SOC 400 2:00p-4:45p" &&
      Sched.formatTotal(b.endMin - b.startMin) === "2.75"));
  const remH = [];
  for (let d = 0; d < 7; d++) tH.attendance[d].forEach(b => { if (b.remainder) remH.push({ d, b }); });
  check("hilo: exactly one remainder block, SOC 280, 1.75 hrs, mirrored to Wed",
    remH.length === 1 && remH[0].b.code === "SOC 280" && remH[0].d === 3 &&
    Sched.formatTotal(remH[0].b.endMin - remH[0].b.startMin) === "1.75",
    JSON.stringify(remH.map(r => r.d + " " + fmt(r.b))));
  check("hilo: study totals 935 minutes/week", tH.studyWeekMin === 935, String(tH.studyWeekMin));
  const studyH = {};
  for (let d = 0; d < 7; d++) tH.study[d].forEach(b => { studyH[b.code] = (studyH[b.code] || 0) + (b.endMin - b.startMin); });
  check("hilo: each class studies exactly its attendance minutes",
    tH.classInfo.every(c => studyH[c.code] === c.attendanceMin), JSON.stringify(studyH));
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
  check("hilo: the first copy opens on a dated row", hiloRead.length > 0 && !!hiloRead[0].date);
  if (nH["816"] > 1) {
    const contFirst = await readBackRows(path.join(OUT, "hilo_816_continued.pdf"), "816");
    check("hilo: continued copy's first row carries its date", !!contFirst[0].date, JSON.stringify(contFirst[0]));
  }

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
    dayStartMin: 480, blockMinutes: 90, month: 8, year: 2026, startDate: null, endDate: null
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
  check("law: LAW 590P documents and studies 3.33, offers no switch",
    Sched.formatTotal(infoL["LAW 590P"].attendanceMin) === "3.33" &&
    infoL["LAW 590P"].shortfallMin === 0 &&
    Sched.formatTotal(infoL["LAW 590P"].studyMin) === "3.33");
  check("law: LWPA 581 switch on — 0.5 remainder",
    Sched.formatTotal(infoL["LWPA 581"].remainderMin) === "0.5", String(infoL["LWPA 581"].remainderMin));
  check("law: LAW 523 documents 1.67",
    Sched.formatTotal(infoL["LAW 523"].attendanceMin) === "1.67");
  check("law: attendance panel = 14.5 hrs/week",
    Sched.formatTotal(tL.classWeekMin) === "14.5", Sched.formatTotal(tL.classWeekMin));
  check("law: study panel = 14.5 hrs/week", Sched.formatTotal(tL.studyWeekMin) === "14.5",
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
    dayStartMin: 480, blockMinutes: 90, month: 8, year: 2026, startDate: null, endDate: null
  });
  const off = Sched.compute(shortClass(1));
  const onCfg = shortClass(1); onCfg.classes[0].addRemainder = true;
  const on = Sched.compute(onCfg);
  check("test9: off — only the real Monday meeting is documented",
    off.template.attendance[1].length === 1 && off.template.attendance[3].length === 0 &&
    off.classWeekMin === 90, String(off.classWeekMin));
  check("test9: off — study matches 90 attendance minutes", off.studyWeekMin === 90);
  check("test9: off — the row is told it is 1.5 of 3",
    Sched.formatTotal(off.template.classInfo[0].meetingMin) === "1.5" &&
    off.template.classInfo[0].shortfallMin === 90);
  check("test9: on — a mirrored Wednesday block appears at the same clock time",
    on.template.attendance[3].length === 1 &&
    fmt(on.template.attendance[3][0]) === "SHORT 10:00a-11:30a" &&
    on.classWeekMin === 180, on.template.attendance[3].map(fmt).join(", "));
  check("test9: on — study is unchanged at 3 credits", on.studyWeekMin === 180);

  /* ======================================================================== *
   *                THE REPORT-PERIOD AND TIME-FORMAT ACCEPTANCE TESTS         *
   * ======================================================================== */

  /* ---- T1: computed periods must match FTW's published calendar ---- */
  console.log("\nT1 — the 2026 report periods against FTW's published calendar");
  const ANSWER_KEY_2026 = [
    ["Dec 28–Jan 31", 5], ["Feb 1–28", 4], ["Mar 1–28", 4], ["Mar 29–Apr 25", 4],
    ["Apr 26–May 30", 5], ["May 31–Jun 27", 4], ["Jun 28–Aug 1", 5], ["Aug 2–29", 4],
    ["Aug 30–Sep 26", 4], ["Sep 27–Oct 31", 5], ["Nov 1–28", 4], ["Nov 29–Dec 26", 4]
  ];
  ANSWER_KEY_2026.forEach(([label, weeks], m) => {
    const p = Sched.reportPeriod(2026, m);
    check(`T1: ${Sched.MONTHS[m]} 2026 = ${label} (${weeks} wks)`,
      p.label === label && p.weeks === weeks, p.label + " (" + p.weeks + ")");
  });
  const jan27 = Sched.reportPeriod(2027, 0);
  check("T1: January 2027 = Dec 27–Jan 30 (5 wks, across the year boundary)",
    jan27.label === "Dec 27–Jan 30" && jan27.weeks === 5 &&
    jan27.start.getFullYear() === 2026 && jan27.end.getFullYear() === 2027,
    jan27.label + " (" + jan27.weeks + ")");
  // Every period, any year, is whole Sun–Sat weeks whose Fridays are all in the
  // report month — the rule itself, checked rather than a table of answers.
  let ruleOk = true, ruleDetail = "";
  for (let y = 2024; y <= 2031 && ruleOk; y++) {
    for (let m = 0; m < 12 && ruleOk; m++) {
      const p = Sched.reportPeriod(y, m);
      const fridays = [];
      for (let d = new Date(p.start); d <= p.end; d.setDate(d.getDate() + 1)) {
        if (d.getDay() === 5) fridays.push(new Date(d));
      }
      const fridaysInMonth = new Date(y, m + 1, 0).getDate();
      let countInMonth = 0;
      for (let d = 1; d <= fridaysInMonth; d++) if (new Date(y, m, d).getDay() === 5) countInMonth++;
      if (p.start.getDay() !== 0 || p.end.getDay() !== 6 ||
          fridays.length !== p.weeks || countInMonth !== p.weeks ||
          !fridays.every(f => f.getMonth() === m && f.getFullYear() === y)) {
        ruleOk = false;
        ruleDetail = `${Sched.MONTHS[m]} ${y}: ${p.label}`;
      }
    }
  }
  check("T1: 2024–2031, every period is whole Sun–Sat weeks whose Fridays are all in its month",
    ruleOk, ruleDetail);

  /* ---- T2: September 2026, four async 3-credit classes ---- */
  console.log("\nT2 — September 2026, four async 3-credit classes (816 + 819)");
  const cfgT2 = {
    name: "Jane Tester", institution: "UHMC", hanaId: "",
    classes: [{ code: "ACC 201" }, { code: "MATH 115" }, { code: "BLAW 200" }, { code: "ECON 130" }],
    dayStartMin: 480, blockMinutes: 90, month: 8, year: 2026, startDate: null, endDate: null
  };
  const resT2 = Sched.compute(cfgT2);
  const rowsT2 = resT2.attendanceRows;
  console.log("  first rows:", rowsT2.slice(0, 3).map(r => `${r.dateFull} ${r.code} ${r.start}-${r.end}`).join(" | "));
  console.log("  last row:  ", (r => `${r.dateFull} ${r.code} ${r.start}-${r.end}`)(rowsT2[rowsT2.length - 1]));
  check("T2: period is Aug 30–Sep 26", resT2.period.label === "Aug 30–Sep 26", resT2.period.label);
  check("T2: Month/Year field still reads September 2026",
    resT2.monthYearLabel === "September 2026", resT2.monthYearLabel);
  // Four async classes sit on Mon & Wed, so the first row of the period is
  // M 8/31 — Su 8/30 carries no block for this pattern, exactly as the weekly
  // pattern dictates. Study (Tue/Thu) opens Tu 9/1.
  check("T2: the 816 opens on M 8/31, the first attendance day of the period",
    rowsT2[0].dateFull === "M 8/31", rowsT2[0].dateFull);
  check("T2: the 816 closes on W 9/23, the last attendance day of the period",
    rowsT2[rowsT2.length - 1].dateFull === "W 9/23", rowsT2[rowsT2.length - 1].dateFull);
  const allT2 = rowsT2.concat(resT2.studyRows);
  check("T2: no row falls on Sep 27–30",
    allT2.every(r => !(r.dateObj.getMonth() === 8 && r.dateObj.getDate() >= 27)),
    JSON.stringify(allT2.filter(r => r.dateObj.getMonth() === 8 && r.dateObj.getDate() >= 27).map(r => r.dateFull)));
  check("T2: rows do reach back into August",
    allT2.some(r => r.dateObj.getMonth() === 7),
    JSON.stringify([...new Set(allT2.map(r => r.dateFull))].slice(0, 3)));
  check("T2: every Sun–Sat week on the form is complete (4 weeks, all 24 hrs)",
    resT2.weekly.length === 4 && resT2.weekly.every(w => w.hours === 24),
    JSON.stringify(resT2.weekly.map(w => w.label + "=" + w.hours)));
  check("T2: panel line reads “4 FTW weeks (Aug 30–Sep 26)”",
    `${resT2.period.weeks} FTW weeks (${resT2.period.label})` === "4 FTW weeks (Aug 30–Sep 26)");
  const meridiemOk = v => /^\d{1,2}:\d{2}[ap]$/.test(v);
  check("T2: every printed time carries a/p",
    allT2.every(r => meridiemOk(r.start) && meridiemOk(r.end)),
    JSON.stringify([...new Set(allT2.map(r => r.start))].slice(0, 6)));
  check("T2: totals unchanged — 12 class + 12 study hrs/week",
    resT2.classWeekMin === 720 && resT2.studyWeekMin === 720);
  const nT2 = await fillAll("T2_sep2026", resT2, {
    name: cfgT2.name, institution: cfgT2.institution, hanaId: "", monthYear: resT2.monthYearLabel
  });
  const readT2 = await readBackRows(path.join(OUT, "T2_sep2026_816.pdf"), "816");
  check("T2: the filled 816 itself shows a/p times and an August opening date",
    readT2.length > 0 && readT2[0].date === "M 8/31" && meridiemOk(readT2[0].start),
    JSON.stringify(readT2[0]));
  console.log("  files per form:", JSON.stringify(nT2));

  /* ---- T3: the six-class law schedule on September 2026 dates ----
   * Same six classes as TEST 8, with LAW 555H's remainder switch turned ON so
   * literal meetings, a remainder block and study blocks are all exercised at
   * once against real report-period dates.
   */
  console.log("\nT3 — the six-class law schedule, September 2026 report period");
  const cfgT3 = {
    ...cfgL,
    classes: cfgL.classes.map(c => c.code === "LAW 555H" ? { ...c, addRemainder: true } : c)
  };
  const resT3 = Sched.compute(cfgT3);
  check("T3: period is Aug 30–Sep 26", resT3.period.label === "Aug 30–Sep 26", resT3.period.label);
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((n, d) => {
    if (resT3.template.attendance[d].length) {
      console.log("  " + n + ":", resT3.template.attendance[d].map(fmt).join(", "));
    }
  });
  assertNoOverlaps("T3", resT3.template);
  const findRow = (rows, dateFull, code) =>
    rows.find(r => r.dateFull === dateFull && r.code === code);
  // The Saturday meeting, on a real period date, with its exact decimal total.
  const satRow = findRow(resT3.attendanceRows, "Sa 9/5", "LAW 590P");
  check("T3: Sa 9/5 LAW 590P 9:00a–12:20p = 3.33",
    !!satRow && satRow.start === "9:00a" && satRow.end === "12:20p" && satRow.total === "3.33",
    JSON.stringify(satRow));
  // LAW 555H meets Fri 1.5 hrs of its 4 credits; with the switch on, the 2.5-hr
  // remainder mirrors onto Monday and slides past the meetings already there.
  const remRows = resT3.attendanceRows.filter(r => r.code === "LAW 555H" && r.total === "2.5");
  console.log("  LAW 555H remainder rows:", remRows.map(r => `${r.dateFull} ${r.start}-${r.end}`).join(" | "));
  check("T3: the LAW 555H remainder skips Labor Day and retains its a/p times",
    remRows.length === 3 && remRows.every(r => r.dateObj.getDay() === 1 && !Sched.uhHoliday(r.dateObj) &&
      r.start === "2:45p" && r.end === "5:15p"),
    JSON.stringify(remRows.map(r => `${r.dateFull} ${r.start}-${r.end}`)));
  // Tuesday study runs into the evening and must print p times.
  const tueStudy = resT3.studyRows.filter(r => r.dateObj.getDay() === 2);
  console.log("  Tuesday study:", tueStudy.slice(0, 6).map(r => `${r.code} ${r.start}-${r.end}`).join(" | "));
  check("T3: Tuesday study running into the evening prints p times",
    tueStudy.some(r => /p$/.test(r.end) && parseInt(r.end, 10) >= 5 && parseInt(r.end, 10) < 12),
    JSON.stringify(tueStudy.map(r => r.end)));
  check("T3: every law row carries a/p on both times",
    resT3.attendanceRows.concat(resT3.studyRows).every(r => meridiemOk(r.start) && meridiemOk(r.end)));
  check("T3: every law row sits inside Aug 30–Sep 26",
    resT3.attendanceRows.concat(resT3.studyRows).every(r =>
      r.dateObj >= resT3.period.start && r.dateObj <= resT3.period.end));
  // Labor Day is 9/7/2026: scheduled attendance must be excluded.
  const laborDay = resT3.attendanceRows.filter(r => r.dateFull === "M 9/7");
  console.log("  Labor Day M 9/7:", laborDay.map(r => `${r.code} ${r.start}-${r.end}`).join(" | "));
  check("T3: Labor Day M 9/7 excludes all set-time class blocks",
    laborDay.length === 0,
    JSON.stringify(laborDay.map(r => r.code)));
  await fillAll("T3_law_sep2026", resT3, {
    name: cfgT3.name, institution: cfgT3.institution, hanaId: "", monthYear: resT3.monthYearLabel
  });

  /* ---- T4: October 2026, a five-week period ---- */
  console.log("\nT4 — October 2026 (5-week period, Sep 27–Oct 31)");
  const cfgT4 = { ...cfgT2, month: 9 };
  const resT4 = Sched.compute(cfgT4);
  check("T4: period is Sep 27–Oct 31 with 5 weeks",
    resT4.period.label === "Sep 27–Oct 31" && resT4.period.weeks === 5,
    resT4.period.label + " (" + resT4.period.weeks + ")");
  const allT4 = resT4.attendanceRows.concat(resT4.studyRows);
  const sepDates = [...new Set(allT4.filter(r => r.dateObj.getMonth() === 8).map(r => r.dateFull))];
  console.log("  September rows on the October form:", sepDates.join(", "));
  check("T4: the form includes the Sep 27–30 rows the pattern calls for",
    sepDates.length > 0 && sepDates.every(d => /^(Su 9\/27|M 9\/28|Tu 9\/29|W 9\/30)$/.test(d)),
    JSON.stringify(sepDates));
  check("T4: weekly totals are identical across all five weeks",
    resT4.weekly.length === 5 && resT4.weekly.every(w => w.hours === 24),
    JSON.stringify(resT4.weekly.map(w => w.label + "=" + w.hours)));
  check("T4: Month/Year field reads October 2026", resT4.monthYearLabel === "October 2026");
  await fillAll("T4_oct2026", resT4, {
    name: cfgT4.name, institution: cfgT4.institution, hanaId: "", monthYear: resT4.monthYearLabel
  });

  /* ---- T5: a custom date range inside a period ---- */
  console.log("\nT5 — a custom date range inside the September 2026 period");
  const pSep = Sched.reportPeriod(2026, 8);
  const clipped = Sched.compute({ ...cfgT2, startDate: "2026-09-06", endDate: "2026-09-19" });
  const allClip = clipped.attendanceRows.concat(clipped.studyRows);
  console.log("  clipped span:", allClip[0].dateFull, "→", allClip[allClip.length - 1].dateFull);
  check("T5: nothing before 9/6 or after 9/19 survives the clip",
    allClip.every(r => iso(r.dateObj) >= "2026-09-06" && iso(r.dateObj) <= "2026-09-19"),
    JSON.stringify(allClip.filter(r => iso(r.dateObj) < "2026-09-06" || iso(r.dateObj) > "2026-09-19").map(r => r.dateFull)));
  check("T5: the clip keeps exactly the two whole weeks it covers",
    clipped.weekly.length === 2 && clipped.weekly.every(w => w.hours === 24),
    JSON.stringify(clipped.weekly.map(w => w.label + "=" + w.hours)));
  check("T5: the clipped run is a strict subset of the full period's rows",
    allClip.length < resT2.attendanceRows.concat(resT2.studyRows).length && allClip.length > 0);
  // The period is the outer bound: dates beyond it cannot widen the form. The
  // page refuses them outright; the engine simply ignores them.
  const tooWide = Sched.compute({ ...cfgT2, startDate: "2026-08-01", endDate: "2026-10-31" });
  check("T5: a date outside the period cannot widen it",
    JSON.stringify(snapRows(tooWide.attendanceRows)) === JSON.stringify(snapRows(resT2.attendanceRows)));
  check("T5: the period's own bounds are what the date boxes offer",
    pSep.startISO === "2026-08-30" && pSep.endISO === "2026-09-26",
    pSep.startISO + " .. " + pSep.endISO);
  // A range entirely outside the period yields nothing rather than wrong dates.
  const outside = Sched.compute({ ...cfgT2, startDate: "2026-10-05", endDate: "2026-10-09" });
  check("T5: a range past the period's end produces no rows at all",
    outside.attendanceRows.length === 0 && outside.studyRows.length === 0);

  /* ---- T6: width safety across every generated page ---- */
  console.log("\nT6 — every value written into every PDF fits its column");
  const generated = fs.readdirSync(OUT).filter(f => /_(816|817|819)(_continued\d*|_\d+)?\.pdf$/.test(f)).map(f => ({
    file: path.join(OUT, f),
    formKey: /_(816|817|819)(_continued\d*|_\d+)?\.pdf$/.exec(f)[1]
  }));
  console.log("  checking " + generated.length + " generated PDFs");
  await checkFits("T6", generated);

  console.log("\n" + (failures ? failures + " FAILURE(S)" : "ALL CHECKS PASSED"));
  console.log("Filled PDFs written to _dev_out/");
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
