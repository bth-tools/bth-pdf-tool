# Bridge to Hope — DHS Hours Auto-Filler

Current release: **v7.1.3** (`7.1.3` in package metadata). The version appears beneath
the app title. This release makes one functional correction: zero-hour reports
explain when course dates are outside the selected period, and empty forms are
not downloaded. Import keeps the selected month. Reports with some usable hours
still generate the selected forms that contain rows. Date-specific unavailable
times from v7.1.2 remain available. Under the owner's counting convention, the last digit advances
for each functional update and carries into the middle digit every ten updates
(for example, v7.0.9 → v7.1.0). The leading digit identifies the major tool generation.
Update this label, `index.html`, asset cache versions, and `package.json` together.

Local scenario evidence uses the owner's numbered folders: `01/Test 1`, `01/Test 2`,
and the same pattern for `02` through `30`. Save each future run in the next unused
`Test N` folder inside its scenario, retaining previous runs. Shared reports, matrices
and inventories belong in the existing corpus `INFO` folder.

A single static web page that auto-fills the First-To-Work (TANF) report-period forms
for student-parents in the **Bridge to Hope** program:

- **DHS 816** *Educational Activity Attendance Form* — records scheduled attendance; automatic defaults are **Monday & Wednesday**.
- **DHS 819** *Unsupervised Study Timesheet* — records study; automatic defaults are **Tuesday & Thursday**.
- **DHS 817** *Monitored Study Session Form* — gets the **same study schedule**
  as the DHS 819. Its certification block (study-monitor name, signature, date, phone,
  email, other contact) is left **blank and fillable** for the monitor to complete.

You enter the student, the month, and the class list once, then tick which form(s) you
want; the tool generates only the selected filled PDFs and downloads them. It runs
**entirely in the browser** — no backend, no build step, no data ever leaves the device,
and no form data is stored. Only the appearance preference is saved locally.

Use **Appearance → System, Light, or Dark** at the top of the page. System follows
the device's color preference. Light and Dark are remembered on this browser;
if browser storage is blocked, the choice still works for the current page.
The theme affects the screen only, not the generated PDFs.

---

## Import a STAR schedule (optional)

In **MyUH Services → STAR GPS Registration**, select the current term, then
**Print → Save as PDF**. Choose that PDF in **Import a STAR schedule**, above Student.
Review the name, institution, course codes, credits, meeting times and date ranges.
Compare the course count with the original too. Check any extraction notices,
check the review box, then select **Use these classes**.

**Everything stays editable after import.** The importer fills the normal form controls;
it does not lock them. You can change student information, courses, credits, attendance
types, meeting times, dates, additional hours and study preferences, or add/remove classes.
Course dates and individual meeting dates are under their optional disclosure controls.
Both date limits apply; when extending a course, review its meeting limits too.

Import replaces the class list after confirmation. Report month, unavailable times and
form selections remain. Additional approved hours start off. A course without extracted
meeting days/times defaults to async, including TBA/ONLINE. Mixed scheduled/TBA components do not
automatically receive extra attendance. Study and automatic async times come from the
existing scheduler, not from the PDF. Imported date limits persist when switching months.

Damaged meeting text is flagged for review without blocking import. Check the original
and add missing fixed meetings in the normal class fields. Clearly stated single-campus
institutions are recovered where possible; multiple-campus enrollment keeps the existing
editable institution field without selecting a primary campus.

Text extraction and scanned-page OCR run locally in the browser. No schedule is sent to
an OCR or AI service. Supported input is the STAR print view (up to 12 pages / 30 MB).
Scans require careful review. Different layouts or mixed image/text pages can omit or
misread information; manual entry remains available, and a failed import preserves existing entries.

PDF.js and OCR assets load only when needed, so ordinary manual entry does not download
them. Vendored assets total about 26 MB; a scan uses only its browser-compatible OCR core.
Hosting must serve `.mjs` as JavaScript over HTTP(S). GitHub Pages needs no backend or build step.
Third-party versions, licenses and asset details are in `lib/IMPORT-LIBRARIES.md`.

---

## Install as an app

Open the hosted tool in Chrome or Edge and choose **Install BTH Tool** (or the
browser's **Install this site as an app** menu option). The installed app opens in
its own window and uses the Bridge to Hope bridge-and-sun icon. Choose a desktop
shortcut if the browser offers that option. On iPhone or iPad, use Safari's
**Share → Add to Home Screen**.

If you installed the tool before these icons were added and still see the old
icon, uninstall that shortcut/app and reinstall from the updated site. Browser
installation does not add offline support; an internet connection is still needed.

`manifest.webmanifest` uses relative URLs so installation works under the GitHub
Pages repository path. The PNGs in `icons/` use the bridge-and-sun portion of the
official `BTH_logo.png` from `BTH Tool/Updated BTH Tool Training Dossier/Reusable Assets/`,
centered on white. Sizes are 32px (browser tab), 180px (Apple touch icon), and
192px/512px (installed app).

---

## FTW report periods, not calendar months

First-To-Work does not report calendar months. It reports whole **Sunday-to-Saturday
weeks**, and a week counts for the month its **Friday** falls in. A report month is
therefore every Sun–Sat week whose Friday lands in that calendar month, which means a
form legitimately opens or closes in the month next door:

| You pick | The form covers | Weeks |
| --- | --- | --- |
| September 2026 | Su 8/30 – Sa 9/26 | 4 |
| October 2026 | Su 9/27 – Sa 10/31 | 5 |
| January 2027 | Su 12/27/26 – Sa 1/30/27 | 5 |

- Spans are computed from that one rule for any month of any year — there is no table to
  keep up to date, and the year boundary needs no special case.
- The month dropdown shows each span beside the name: *September 2026 (Aug 30–Sep 26)*.
- Dates from the neighbouring month print with their **real** dates (`Su 8/30`, `M 8/31`).
- The form's own **Month/Year** field still reads the plain month: *September 2026*.
- The optional partial-period clip is a pair of **dates** (not day numbers, which would be
  ambiguous across two calendar months), bounded to the chosen period and defaulting to
  its full span. A date outside the period is refused.
- The hours panel states the span plainly: *This period: 4 FTW weeks (Aug 30–Sep 26)*.

Recurring **UH observed holidays** are calculated each year: New Year's Day,
MLK Day, Presidents' Day, Prince Kūhiō Day, Good Friday, Memorial Day,
King Kamehameha I Day, Independence Day, Statehood Day, Labor Day, general
Election Day (even years), Veterans Day, Thanksgiving, and Christmas.
Fixed-date holidays falling on Saturday are observed Friday; Sunday holidays
are observed Monday. A following year's New Year holiday may fall on December 31.
These are the current recurring rules, projected through the supported year range;
future changes to UH policy will require an update.

Classes with **set times enabled** omit holiday attendance (including additional
class hours). Async attendance and **all study** may occur on holidays. Study is
limited to actual recorded attendance per class, per FTW week, after date clipping.
If time is insufficient, the tool records what fits, lists unplaced hours, and
still generates the selected PDFs. It does not enforce a 20- or 30-hour target.

### Unavailable times and custom study

The optional **Unavailable Times** section appears before Classes. Select one or
more weekdays and enter start/end times for recurring work or other commitments.
The clocks match scheduled class meetings. Use **+ Add time** for another period
on the same selected days; every period in that group applies to all of those days.
Use **+ Add unavailable days** when a different day selection is needed. Remove
one time independently, or remove the group's days and all its times together.
Automatic async attendance, additional class hours, and all study avoid these
intervals. Enter an overnight shift as two blocks: Monday 10 p.m.–midnight, then
Tuesday midnight–6 a.m., for example. Choose 12:00 a.m. (`00:00`) for midnight;
as an end time, it means the end of the selected day, preserving the former `24:00` endpoint.
Fixed meetings remain as entered; automatic attendance and study update around them.
Incomplete or invalid scheduling entries are omitted with a notice, without
preventing output for complete entries.

**Choose study times** is off by default on each course. One preferred day/start
receives the whole weekly allowance, with its end calculated automatically.
Use **+ Add study time** for another preferred time. Leave all Hours blank to divide
the weekly allowance evenly; enter Hours to request a particular time's duration.
Preferred times can move or split around conflicts. The scheduler
searches other openings in the same FTW week if needed, starting automatic times
at the configured day start (8:00 a.m. by default). It never moves hours into another
week or exceeds that week's recorded attendance. Custom study is placed before
automatic study. Expand **Scheduled study times** to review actual dated results,
including holidays and partial weeks. Both 819 and 817 use those same results.
Changing or removing any block immediately updates the schedule and hours summary.

Spring break, other non-instructional days, semester boundaries, emergency closures,
and FTW employment holiday rules are **not** automatically excluded. Review the
PDFs for your actual course dates. Sources checked September 27, 2026:
[UH academic calendar](https://www.hawaii.edu/academic-calendar/) and
[UH holiday policy](https://www.hawaii.edu/ohr/benefits-leave/benefit/holidays/).

---

## What it does

The tool is a **weekly-timetable builder**: each class contributes weekly attendance
blocks, study blocks fill in around them, and the PDFs report the timetable.

- Each class row carries a **Credits** number (1–4, default **3**). The common student
  never touches it. Credits determine automatic async attendance and the optional
  flexible-hour allowance:
  - how much class time an *online* class earns per week — 3 credits = 3.0 hrs, laid out
    as 1.5 + 1.5 on Mon & Wed exactly as before; 1 credit = a single 1.0-hr block;
    4 credits = 1.5 + 1.5 + 1;
  - **Study aims to match attendance when space permits**, including selected flexible blocks and typed async
    overrides. A 3-credit class meeting for 1.25 hours gets 1.25 study hours; with
    1.75 flexible attendance hours added, it gets 3 study hours in a non-holiday week.
- Each class row also asks: **"Does this class meet in person or online at scheduled times?"** (off by default).
  - **Off** — the class is treated as online/asynchronous and auto-sequences from the day
    start time on Mon & Wed. You can still override an individual block's start/end, in
    which case those times are preferred on both days and move around conflicts.
  - **On** — the row expands into one or more meetings (Day + Starts + Ends, with
    "+ Add another day"). Those meetings claim their exact days and times on the forms,
    and **by default that is all the class documents.**
- Async blocks automatically **skip over** any time already claimed by a scheduled class
  on the same day and all unavailable intervals. Fixed meetings stay as entered
  without an overlap repair notice; automatic blocks never add overlaps.
- **Remainder blocks are opt-in.** When a scheduled class meets for fewer hours than it
  carries in credits, its row shows a quiet note — *"This class meets 1.5 of its 4 credit
  hours."* — and one switch: **"Include additional approved class hours", off by
  default. Leave it off and the class documents its real meetings only.** Turn it on and
  the difference is added as a flexible block mirrored onto the meeting day's partner
  (Mon↔Wed, Tue↔Thu; Fri/Sat/Sun mirror to Mon) at the same clock time, sliding later in
  the day if that slot is taken. For online activities counted as class time,
  such as recorded lectures. A class already meeting its
  credit hours or more shows no note and no switch.
- **Every time carries a compact meridiem** — no leading zero, one lowercase letter, no
  space: `8:00a`, `11:40a`, `12:00p` (noon), `1:30p`, `10:35p`. The on-screen automatic
  Start/End times and the hours panel use the identical format, so the screen and the
  paper can never disagree. Duration columns are unchanged decimals.
- **Every duration is computed from exact minutes** and printed to 2 decimals with
  trailing zeros trimmed: 12:00–12:50 is `0.83`, 10:00–11:40 is `1.67`, 9:00–12:20 is
  `3.33`, 14:00–16:45 is `2.75`, 90 minutes is `1.5`. The totals column and the hours
  panel use the same precision, so they can never disagree.
- Study is laid out in 1.5-hour blocks (the final block shorter or longer to hit the
  exact total) on Tue & Thu from the day start time, skipping claimed intervals,
  overflowing to Fri, Sat, Sun, Mon, Wed if needed.
- DHS 816 lists **every** day of the week that carries attendance blocks in the report
  period; DHS 819/817 list every day carrying study blocks — with an optional start/end
  date clip for part of a period. Day letters cover the full week (M, Tu, W, Th, F,
  Sa, Su), so a Saturday class prints `Sa 8/29`.
- Lets you pick any combination of the three forms with checkboxes (none selected by
  default); generates and downloads only the ones you check.
- Prints the date only on the **first** class row of each day (matching the official forms).
- Formats exactly like the paper forms: dates `M/D` (no leading zeros), times `H:MMa` /
  `H:MMp`, totals as decimals. Every value is measured against its own box and set a
  step smaller if it would not fit, so nothing is ever silently clipped.
- Leaves all signature / instructor / "Department Use" fields **blank** so the student
  signs in Adobe after download.
- Overflows cleanly from page 1 to page 2 of each form — and **never silently truncates**.
  A period with more rows than one copy of a form holds continues into an additional filled
  copy of the same blank form, named with a `_continued` suffix, and the student is told
  plainly to submit both. The continuation's first row carries its date even when one
  day's rows are split across the boundary.
- Shows a live hours summary below the Classes section (class attendance, study time, and
  total hrs/period for the checked forms) that reflects the actual dated rows after
  holiday exclusions, availability and date clipping. Study cannot exceed attendance; selecting both
  study forms does not double-count the same study time in the summary.
  The panel is informational only — required hours vary by situation and should be
  confirmed with the FTW case manager or BTH Campus Contact. It also names the report
  period the forms will cover, as neutral context.

Students with only online/asynchronous 3-credit classes using full report periods see
the same default timetable —
leaving Credits on 3 and every toggle off produces output identical to the previous
version of the tool.

The filled PDFs stay **fillable**, so the student can still type corrections and sign in
Adobe before submitting.

---

## Files

```
index.html                 the page
styles.css                 styling
app.js                     UI wiring
schedule.js                date/schedule/formatting logic
pdffill.js                 fills the AcroForm fields with pdf-lib
lib/pdf-lib.min.js         the pdf-lib library (bundled locally, not a CDN)
ClassAttend_DHS 816.pdf    blank attendance form     (you provide — see below)
StudyTimesheet_DHS 819.pdf blank study timesheet     (you provide — see below)
MonitoredStudy_DHS 817.pdf blank monitored-study form (you provide — see below)
```

`pdf-lib` is bundled locally at `lib/pdf-lib.min.js` — there is nothing to install or
build, but that file **must** be deployed along with everything else or the Generate
button will fail.

---

## Adding the two blank PDFs

The app fills the official blank forms in place, so the two blank PDFs must sit next to
`index.html` with these **exact** filenames:

- `ClassAttend_DHS 816.pdf`
- `StudyTimesheet_DHS 819.pdf`
- `MonitoredStudy_DHS 817.pdf`

They are already included in this folder. If you ever replace them with newer official
versions, keep the same filenames (or update the `blank:` entries in the `FORMS` table at
the top of `app.js`). The forms must keep their fillable AcroForm fields — all current
versions do.

---

## Running locally

Because the app **fetches** the blank PDFs, opening `index.html` directly with `file://`
will be blocked by the browser. Serve the folder over HTTP instead:

```bash
# from inside this folder
python -m http.server 8000
```

Then open <http://localhost:8000/> in your browser.

(Any static server works — e.g. `npx serve` if you prefer Node.)

---

## Deploying to GitHub Pages (shareable link)

1. Create a new GitHub repository (e.g. `bth-pdf-tool`).
2. Upload **all** the files in this folder to the repo root — including the two blank
   PDFs. (Web UI: *Add file → Upload files*, drag everything in, **Commit changes**.)
3. In the repo, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
5. Choose branch **`main`** and folder **`/ (root)`**, then **Save**.
6. Wait ~1 minute. GitHub shows the live URL at the top of the Pages settings, like:
   `https://<your-username>.github.io/bth-pdf-tool/`
7. Share that link with BTH. Done — it's live and updates whenever you push changes.

> **When you change `app.js`, `schedule.js`, or `styles.css`, bump the `?v=` number**
> on the matching `<script>` / `<link>` tags in `index.html` (e.g. `app.js?v=2` →
> `app.js?v=3`) and push both files together. Browsers cache those files, and without
> the bump a returning user can end up running a *stale* `app.js` against the new
> `index.html` — the page looks updated but its buttons and fields do nothing. The
> version query forces a fresh copy. If a page ever does load in that broken state, it
> now shows a "This page didn't load correctly" message instead of failing silently.

> Tip: the folder may include dev-only files (`_dev_test.js`, `package.json`,
> `node_modules/`). They're harmless on Pages, but you can skip uploading them to keep the
> repo tidy. The app itself only needs `index.html`, `styles.css`, `app.js`,
> `schedule.js`, `pdffill.js`, and the three blank PDFs.

---

## How to use

1. Tick the form(s) you want: Class Attendance (816), Unsupervised Study (819), and/or
   Monitored Study (817). Any combination works.
2. Enter the student name and institution. **e.g. UHMC** is a placeholder, not a prefilled value.
3. Pick the month and year (default to the current month/year). The dropdown shows the
   FTW report period each month covers, and the start/end dates start on that full
   period — narrow them only for part of a period.
4. Optionally add recurring work or other commitments under **Unavailable Times**.
   Then add each class by course code and number, such as ENG 100. Automatic attendance
   and study times start at **8:00 a.m.**; expand **Automatic scheduling** to adjust
   that start time. Scheduled meetings keep their entered times. Leave **Credits** on 3 unless a class
   is worth a different number.
5. For a class that meets at a set day and time (a Zoom class or an in-person class),
   turn on **"Does this class meet in person or online at scheduled times?"** and enter its day(s) and start/end
   times. Online classes with no set meeting time: skip this — the tool handles them.
6. If such a class meets for fewer hours than its credits, its row says so and offers
   **"Include additional approved class hours"**. For online activities counted as class time,
   such as recorded lectures. The note shows how many hours this adds before holidays.
7. Optionally enable **Choose study times** per course. Choose a day/start, add slots
   to split hours, and review **Scheduled study times** for the calculated end times.
   Check the hours summary — it totals the selected dates after UH holiday adjustments.
   Study matches attendance when space permits; unplaced hours appear in notices and
   do not prevent generation. Review course-specific
   breaks and closures yourself; those are not filtered automatically.
8. Click **Generate & download selected forms**.
9. Open each PDF in Adobe, review, sign (and have the monitor complete Section 1 of the
   817 if generated), and submit. If a period needed more rows than one form holds you
   also get a file ending **`_continued`** — submit that one too.

---

## Privacy

Everything happens in the browser. No student data is uploaded, logged, or stored —
there is no application backend. Only the appearance preference uses browser storage.
Refreshing the page clears all form input.

---

## Developer note (optional)

`_dev_test.js` runs the same `schedule.js` / `pdffill.js` logic in Node against the real
blank PDFs to run the acceptance tests (all-async regression against `_dev_golden.json`,
the mixed scheduled/async scenario, collision detection, odd evening hours, hours-panel
consistency, per-class credits, two real 6- and 7-class student schedules with their
decimal totals and Saturday rows, the `_continued` overflow split read back out of the
filled PDFs, and the remainder switch being genuinely opt-in) — plus the report-period
suite: the 2026 spans against FTW's published calendar, the Friday rule checked directly
over 2024–2031, four- and five-week periods, the custom date clip, and a measurement of
every value written into every generated PDF against the box it has to fit:

```bash
npm install pdf-lib
node _dev_test.js
node _dev_holidays_test.js
node _dev_scheduling_test.js
node _dev_import_test.js
# Run all suites:
npm test
```

The holiday suite checks published 2026/2027 dates and per-class weekly equality,
holiday exclusions, async retention, overlaps, and a/p formatting across every
month from 2020 to 2100, plus partial ranges and insufficient-space partial output.

The scheduling suite covers unavailable intervals, split/custom study, holiday study,
fragmented gaps, partial output, 120 varied workloads, and editable PDF readback.

The PDF suite writes filled PDFs to `_dev_out/` for inspection. `_dev_golden.json` is a snapshot of
the original tool's output for all-async configs; the suite fails if the **weekly
pattern** — which blocks, in what order, on which weekday, with which totals — ever
departs from it. Only the span of dates and the time format are allowed to differ, which
is exactly what the report-period and meridiem changes altered. Not needed to run or
deploy the app.
