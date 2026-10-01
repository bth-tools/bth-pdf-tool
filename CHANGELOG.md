# Release notes

## v7.0.5 — September 30, 2026

Five importer accuracy updates:

- Courses without extracted meeting days/times default to async, matching manual entry.
- Student-name extraction continues past invalid print headers and leaves conflicting names for review.
- Campus extraction separates quoted CRN labels from clearly stated campus names. Multi-campus presentation remains unchanged.
- Higher-resolution local OCR recovers small names and dense scanned meeting lines more accurately.
- Damaged meeting text receives a review notice without blocking import or inventing fixed meetings.

Existing scheduling calculations, approved-hours allowance, editable fields and PDF formatting are preserved.
Validation: existing scheduling, holiday and PDF suites passed. All 30 STAR scenarios
(131 courses) matched names, credits, fixed meetings and course date envelopes before
correction. All 26 single-campus institutions matched; four multi-campus entries needed
manual completion. Independent checks passed for 72 corpus PDFs (144 pages), plus
targeted manual/editability checks. Corrected evidence retains historical runs and
discloses rotating-availability and other verification limits. Hosted release is pending.

## v7.0.0 — September 27, 2026

- Import a STAR print-view schedule PDF before entering student information. Review extracted
  name, institution, actual course codes, credits, meeting days/times and course dates before applying.
- All imported values remain editable in the normal form. Adding/removing classes, custom study
  times, additional class hours, unavailable times and manual entry continue to work.
- Recognize scanned pages locally, without uploading schedules to an OCR/AI service.
- Ask the user to resolve unclear attendance types. TBA entries do not silently become async or
  add unverified attendance hours. Additional approved class hours remain opt-in.
- Respect editable course and individual meeting date ranges when generating each report month.
- Keep the existing FTW report periods, UH holiday rules, attendance/study parity, a/p notation,
  PDF naming and editable PDF forms.

Validation: three STAR schedules (17 courses), September 2026 forms 816 and 819, six PDF
readbacks and 12 rendered pages; post-import editing and ordinary manual entry; existing
holiday, scheduling and PDF regression suites; synthetic import/date-boundary checks.

Scope: supported STAR print layouts still require review. This does not add automatic semester
batch generation or saved student data. Refreshing the page clears the form as before.
