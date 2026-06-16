# Bridge to Hope — DHS Hours Auto-Filler

A single static web page that auto-fills the monthly First-To-Work (TANF) forms for
student-parents in the **Bridge to Hope** program:

- **DHS 816** *Educational Activity Attendance Form* — gets **Monday & Wednesday** dates.
- **DHS 819** *Unsupervised Study Timesheet* — gets **Tuesday & Thursday** dates.
- **DHS 817** *Monitored Study Session Form* — gets the **same Tuesday & Thursday** dates
  as the DHS 819. Its certification block (study-monitor name, signature, date, phone,
  email, other contact) is left **blank and fillable** for the monitor to complete.

You enter the student, the month, and the class list once, then tick which form(s) you
want; the tool generates only the selected filled PDFs and downloads them. It runs
**entirely in the browser** — no backend, no build step, no data ever leaves the device,
and nothing is stored.

---

## What it does

- Finds every Mon/Wed (→ DHS 816) and every Tue/Thu (→ DHS 819 and DHS 817) in the chosen
  month, with an optional start-day / end-day clip for partial months.
- Lets you pick any combination of the three forms with checkboxes (none selected by
  default); generates and downloads only the ones you check.
- For each date, writes one row per class in the order you list them, with start time,
  end time, and total decimal hours.
- Classes auto-sequence as back-to-back 90-minute blocks from the day start time; you can
  override any individual block's start/end.
- Prints the date only on the **first** class row of each day (matching the official forms).
- Formats exactly like the paper forms: dates `M/D` (no leading zeros), times `H:MM` with
  no AM/PM, totals as decimals (`1.5`).
- Leaves all signature / instructor / "Department Use" fields **blank** so the student
  signs in Adobe after download.
- Overflows cleanly from page 1 to page 2 of each form.
- Shows an informational weekly-hours summary (class + study combined) and flags weeks
  below the threshold (≥ 20 hrs/week if youngest dependent is under 6; ≥ 30 hrs/week if 6+).

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
ClassAttend_DHS 816.pdf    blank attendance form     (you provide — see below)
StudyTimesheet_DHS 819.pdf blank study timesheet     (you provide — see below)
MonitoredStudy_DHS 817.pdf blank monitored-study form (you provide — see below)
```

`pdf-lib` is loaded from a CDN at runtime — there is nothing to install or build.

---

## Adding the two blank PDFs

The app fills the official blank forms in place, so the two blank PDFs must sit next to
`index.html` with these **exact** filenames:

- `ClassAttend_DHS 816.pdf`
- `StudyTimesheet_DHS 819.pdf`
- `MonitoredStudy_DHS 817.pdf`

They are already included in this folder. If you ever replace them with newer official
versions, keep the same filenames (or update the `PDF_816` / `PDF_819` / `PDF_817`
constants at the top of `app.js`). The forms must keep their fillable AcroForm fields —
all current versions do.

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

> Tip: the folder may include dev-only files (`_dev_test.js`, `package.json`,
> `node_modules/`). They're harmless on Pages, but you can skip uploading them to keep the
> repo tidy. The app itself only needs `index.html`, `styles.css`, `app.js`,
> `schedule.js`, `pdffill.js`, and the three blank PDFs.

---

## How to use

1. Tick the form(s) you want: Class Attendance (816), Unsupervised Study (819), and/or
   Monitored Study (817). Any combination works.
2. Enter the student name and institution (defaults to **UHMC**); HANA ID# is optional.
3. Pick the month and year (default to the current month/year). Optionally set start/end
   day for a partial month.
4. Set the day start time (default **8:00**) and list the classes in order. Times fill in
   automatically; override a block only if needed.
5. Click **Generate & download selected forms**.
6. Open each PDF in Adobe, review, sign (and have the monitor complete Section 1 of the
   817 if generated), and submit.

---

## Privacy

Everything happens in the browser. No student data is uploaded, logged, or stored —
there is no server and no use of browser storage. Refreshing the page clears all input.

---

## Developer note (optional)

`_dev_test.js` runs the same `schedule.js` / `pdffill.js` logic in Node against the real
blank PDFs to regression-test the output (used during development):

```bash
npm install pdf-lib
node _dev_test.js
```

It writes filled PDFs to `_dev_out/` for inspection. Not needed to run or deploy the app.
