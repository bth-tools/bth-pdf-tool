/* Dev-only regression tests: recurring holidays and exact study/attendance parity. */
const assert = require('node:assert/strict');
const S = require('./schedule.js');
const date = value => new Date(value + 'T12:00:00');
const holiday = value => S.uhHoliday(date(value));
const expected = {
  2026: ['01-01','01-19','02-16','03-26','04-03','05-25','06-11','07-03','08-21','09-07','11-03','11-11','11-26','12-25'],
  2027: ['01-01','01-18','02-15','03-26','05-31','06-11','07-05','08-20','09-06','11-11','11-25','12-24','12-31']
};
// Compare complete years against published dates, including observed New Year 2028.
for (const [year, days] of Object.entries(expected)) {
  const actual = [];
  for (let d = new Date(+year, 0, 1, 12); d.getFullYear() === +year; d.setDate(d.getDate() + 1)) {
    if (S.uhHoliday(d)) actual.push(`${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }
  assert.deepEqual(actual, days, `published holiday calendar ${year}`);
}
assert.match(holiday('2027-03-26'), /Kuhio.*Good Friday/);
assert.equal(holiday('2026-11-27'), null, 'non-instructional Friday is not excluded');
assert.equal(holiday('2027-03-17'), null, 'spring break is not excluded');
assert.equal(holiday('2026-06-19'), null, 'no federal-only Juneteenth exclusion');
assert.equal(holiday('2027-11-02'), null, 'no election holiday in odd years');
assert.match(holiday('2100-03-26'), /Good Friday/, 'Gregorian century boundary');

function minutes(rows) { return Math.round(rows.reduce((n, r) => n + r.hours * 60, 0)); }
function group(rows) {
  const result = {};
  rows.forEach(r => {
    const d = new Date(r.dateObj); d.setDate(d.getDate() - d.getDay());
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}/${r.code}`;
    result[key] = (result[key] || 0) + Math.round(r.hours * 60);
  });
  return result;
}
function verify(cfg) {
  const result = S.compute(cfg);
  assert.equal(result.error, null);
  assert.deepEqual(group(result.studyRows), group(result.attendanceRows), 'per-class, per-week minute parity');
  const scheduled = new Set(cfg.classes.filter(c => c.meetings).map(c => c.code));
  const days = {};
  for (const rows of [result.attendanceRows, result.studyRows]) {
    let previous = null;
    for (const r of rows) {
      assert.match(r.start, /^\d{1,2}:\d{2}[ap]$/);
      assert.match(r.end, /^\d{1,2}:\d{2}[ap]$/);
      if (scheduled.has(r.code)) assert.equal(S.uhHoliday(r.dateObj), null);
      const key = r.dateObj.toDateString();
      assert.equal(r.isFirstOfDay, key !== previous);
      assert.equal(Boolean(r.date), key !== previous);
      previous = key;
      (days[key] ||= []).push(r);
    }
  }
  for (const rows of Object.values(days)) {
    rows.sort((a,b) => S.parseTime(a.start) - S.parseTime(b.start));
    for (let i=1; i<rows.length; i++) {
      const end = S.parseTime(rows[i-1].start) + Math.round(rows[i-1].hours * 60);
      assert(end <= S.parseTime(rows[i].start), `overlap on ${rows[i].dateFull}`);
    }
  }
  return result;
}
const scheduled = {code:'SET', credits:3, meetings:[{day:1,startMin:720,endMin:795}]};
for (const addRemainder of [false,true]) {
  const r = verify({year:2026,month:8,classes:[{...scheduled,addRemainder}]});
  assert.equal(r.studyWeekMin, addRemainder ? 180 : 75);
  assert.equal(minutes(r.attendanceRows), addRemainder ? 645 : 225);
}
const mixed = [scheduled, {code:'ASYNC',credits:3},
  {code:'FRIDAY',credits:4,meetings:[{day:5,startMin:780,endMin:830}],addRemainder:true}];
const september = verify({year:2026,month:8,classes:mixed});
assert(september.attendanceRows.some(r => r.dateFull === 'M 9/7' && r.code === 'ASYNC'));
const november = verify({year:2026,month:10,classes:mixed});
assert(november.studyRows.some(r => r.dateFull === 'Th 11/26' && r.code === 'ASYNC'));
assert(november.attendanceRows.some(r => r.dateFull === 'F 11/27' && r.code === 'FRIDAY'));
verify({year:2026,month:8,startDate:'2026-09-09',endDate:'2026-09-10',classes:mixed});
verify({year:2026,month:8,classes:[{code:'OVERRIDE',credits:3,startMin:480,endMin:540}]});
const impossible = S.compute({year:2026,month:8,startDate:'2026-09-14',endDate:'2026-09-14',
  classes:[{code:'LONG',credits:3,meetings:[{day:1,startMin:480,endMin:1440}]}]});
assert.match(impossible.error.message, /isn't room/);
// Duplicate course codes must not merge allowances: each row keeps an internal identity.
verify({year:2026,month:8,classes:[{...scheduled,code:'SAME'}, {code:'SAME',credits:1,meetings:[{day:3,startMin:900,endMin:930}]}]});
for (let year=2020; year<=2100; year++) {
  for (let month=0; month<12; month++) verify({year,month,classes:mixed});
}
console.log('PASS: published calendars, 972 monthly schedules, holiday/async rules, exact weekly parity, clipping, no-room error, overlap checks, date labels, and a/p formatting.');
