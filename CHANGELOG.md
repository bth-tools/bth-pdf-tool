# Release notes

## v7.1.1 — October 1, 2026

Two importer accuracy updates:

- Keep Start and End date values separate when their labels share a line. Each
  meeting inherits the correct shared range instead of using the course end as
  a later component's start date.
- Use an explicit bracketed date range beside an individual meeting, retaining
  the shared course range when that component has no date override.

Version counting carries two functional updates from v7.0.9 to v7.1.1. The
scheduler, manual input flow and fixed-meeting notice behavior are preserved.

Validation: all four regression scripts passed, including focused importer and
scheduling cases for both date formats. Archived text checks matched all 85 Suite 2
courses and preserved all 131 Suite 1 courses. Fresh PDF imports for Suite 2 cases
10 and 11 required no manual corrections; nine DHS 816/819/817 downloads across
October and December passed source-occurrence, exact-minute, overlap, editable-field
and appearance checks. All 18 form pages were rendered and reviewed. Retests are
saved in each case's Test 2 folder, with updated findings, evidence and matrix.
Scenarios 21 and 22 remain deferred.

## v7.0.9 — October 1, 2026

One functional update: remove the fixed-meeting overlap repair notice. Entered
meetings remain at their actual times, and automatic attendance and study continue
to update around those meetings and unavailable periods. Incomplete-entry and
unplaced-hours notices remain available. Help text matches this behavior.

Validation: all four regression scripts passed, including retained fixed meetings,
unavailable-time avoidance, automatic study placement and PDF readbacks. Browser
checks reproduced the MATH 103 overlap with no repair notice, confirmed automatic
times updated after meeting edits, and generated all three forms successfully.

## v7.0.8 — October 1, 2026

Three time-entry usability updates:

- Unavailable Times uses the same native clock controls as scheduled class meetings.
  A midnight end retains the end-of-day meaning used for overnight shift entry.
- Select unavailable days once and add several time periods beneath them. Remove a
  single period or the whole day group; automatic scheduling updates after each edit.
- Study uses **+ Add study time** and explains automatic equal shares versus optional
  requested hours, with end times still calculated by the existing scheduler.

Version counting follows the owner's single-digit/tens convention. Scheduling policy,
STAR import, PDF formatting and attendance/study calculations are preserved.
Test Suite 2 remains prepared and untested during this usability release.

Validation: all four existing regression scripts passed (including 972 monthly
holiday schedules, 120 varied scheduling cases, importer checks and PDF readbacks).
Browser checks covered grouped periods, independent removals, midnight endpoints,
fixed-meeting conflict notices, equal/requested study hours and a narrow-screen layout.
All three browser-generated forms retained editable fields, avoided the entered
unavailable periods and preserved matching DHS 817/819 study rows and totals.

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
