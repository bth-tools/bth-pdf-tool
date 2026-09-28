# Release notes

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
