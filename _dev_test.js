/* Dev-only acceptance test harness. Not part of the deployed app. */
const fs = require("fs");
const path = require("path");
const PDFLib = require("pdf-lib");
const Sched = require("./schedule.js");
const Fill = require("./pdffill.js");

const DIR = __dirname;
const OUT = path.join(DIR, "_dev_out");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

function classBlocks(codes, startMin, block) {
  return codes.map((c) => ({ code: c }));
}

async function main() {
  const config = {
    name: "Jonathan Butler",
    institution: "UHMC",
    hanaId: "",
    classes: classBlocks(["ACC 201", "MATH 115", "BLAW 200", "ECON 130"]),
    dayStartMin: 8 * 60,
    blockMinutes: 90,
    month: 2, // March (0-based)
    year: 2026,
    startDay: null,
    endDay: null
  };

  const res = Sched.compute(config);

  // --- Assertions against the acceptance test ---
  const attDates = [];
  res.attendanceRows.forEach((r) => { if (r.date) attDates.push(r.date); });
  const studyDates = [];
  res.studyRows.forEach((r) => { if (r.date) studyDates.push(r.date); });

  const expectAtt = ["3/2","3/4","3/9","3/11","3/16","3/18","3/23","3/25","3/30"];
  const expectStudy = ["3/3","3/5","3/10","3/12","3/17","3/19","3/24","3/26","3/31"];

  console.log("Attendance dates:", attDates.join(", "));
  console.log("Study dates:     ", studyDates.join(", "));
  console.log("Att match:", JSON.stringify(attDates) === JSON.stringify(expectAtt));
  console.log("Study match:", JSON.stringify(studyDates) === JSON.stringify(expectStudy));

  // First day's four blocks
  const firstFour = res.attendanceRows.slice(0, 4).map(
    (r) => `${r.code} ${r.start}-${r.end} (${r.total})`
  );
  console.log("First day blocks:\n  " + firstFour.join("\n  "));
  console.log("Att rows total:", res.attendanceRows.length, "Study rows:", res.studyRows.length);
  console.log("Weekly hours:", res.weekly.map((w) => `${w.label}=${w.hours}`).join("  "));

  const header = {
    name: config.name,
    institution: config.institution,
    hanaId: config.hanaId,
    monthYear: res.monthYearLabel
  };

  const f816 = fs.readFileSync(path.join(DIR, "ClassAttend_DHS 816.pdf"));
  const f819 = fs.readFileSync(path.join(DIR, "StudyTimesheet_DHS 819.pdf"));

  const out816 = await Fill.fill(PDFLib, f816, "816", header, res.attendanceRows);
  const out819 = await Fill.fill(PDFLib, f819, "819", header, res.studyRows);

  fs.writeFileSync(path.join(OUT, "out816.pdf"), out816.bytes);
  fs.writeFileSync(path.join(OUT, "out819.pdf"), out819.bytes);
  console.log("816 used/cap:", out816.used, out816.capacity, "overflow:", out816.overflow);
  console.log("819 used/cap:", out819.used, out819.capacity, "overflow:", out819.overflow);
  console.log("Wrote _dev_out/out816.pdf and out819.pdf");
}

main().catch((e) => { console.error(e); process.exit(1); });
