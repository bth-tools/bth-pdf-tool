/* Synthetic fixtures only: no students' source schedules belong in this test. */
const assert = require('node:assert/strict');
const Import = require('./schedule-import');
const S = require('./schedule');
const fixture = `Example Student | Program
ABC 123: Example course
Campus: Maui College
When/Where: (TBA to TBA) / ONLINE ASYNC
Credits: 3
Start date: AUG 24 2026
End date: DEC 18 2026
DEF 234L: Mixed components
Campus: Maui College
When/Where: (TBA to TBA) / ONLINE, S (0900 to 1220) / ROOM
Credits: 2
Start date: AUG 24 2026 AUG 29 2026
End date: DEC 18 2026 0CT 17 2026
GHI 345: Unclear
Campus: Maui College
When/Where: (TBA to TBA) / ONLINE
Credits: 1
Start date: AUG 24 2026
End date: DEC 18 2026`;
const parsed = Import.parse([{text:fixture,ocr:true}]);
assert.equal(parsed.name,'Example Student');
assert.equal(parsed.institution,'UH Maui College');
assert.deepEqual(parsed.courses.map(c=>[c.code,c.credits,c.mode]),[
  ['ABC 123',3,'async'],['DEF 234L',2,'scheduled'],['GHI 345',1,'async']]);
assert.deepEqual(parsed.courses[1].meetings,[{day:6,startMin:540,endMin:740,startDate:'2026-08-29',endDate:'2026-10-17'}]);
assert(parsed.courses[1].notes.some(n=>n.includes('TBA')));
assert.equal(parsed.courses[2].notes.length,0,'ordinary ONLINE/TBA needs no warning');
assert.equal(Import.parse([{text:'not a schedule'}]).courses.length,0);
assert.equal(Import.parse([{text:fixture.replace('Example Student','{ Initial: 13.99 / 14 hrs'),ocr:true}]).name,'');
assert.equal(Import.parse([{text:fixture.replace('Example Student','Kaʻimi O’Brien')}]).name,'Kaʻimi O’Brien');
const incomplete=Import.parse([{text:'ABC 123: Unknown\nWhen/Where: (TBA to TBA) / ONLINE\n'}]).courses[0];
assert.equal(incomplete.mode,'async');assert.equal(incomplete.credits,null);assert.equal(incomplete.startDate,'');assert(incomplete.notes.length>=2);
assert(Import.parse([{text:fixture.replace('Credits: 3','Credits: 5')}]).courses[0].notes.some(n=>n.includes('credits')));
assert.equal(Import.parse([{text:fixture.replace('Campus: Maui College','Campus: Hilo')}]).institution,'');
const split=fixture.indexOf('DEF 234L');
assert.deepEqual(Import.parse([{text:fixture.slice(0,split)},{text:fixture.slice(split)}]).courses,parsed.courses);
const base={year:2026,month:8,dayStartMin:480,classes:[]};
const sum=rows=>rows.reduce((n,r)=>n+Math.round(r.hours*60),0);
// Midweek course boundaries apply to both async attendance and study.
let r=S.compute({...base,classes:[{code:'SHORT',credits:3,startDate:'2026-09-09',endDate:'2026-09-16'}]});
assert(r.attendanceRows.length && r.studyRows.length);
for(const row of [...r.attendanceRows,...r.studyRows]) {
  assert(row.dateObj>=new Date(2026,8,9) && row.dateObj<=new Date(2026,8,16));
}
// Per-meeting end dates take precedence over a longer overall course range.
r=S.compute({...base,classes:[{code:'FIXED',credits:3,startDate:'2026-08-24',endDate:'2026-12-18',
  meetings:[{day:3,startMin:600,endMin:675,startDate:'2026-09-09',endDate:'2026-09-16'}]}]});
assert.equal(r.attendanceRows.length,2);
assert.equal(sum(r.attendanceRows),150);
assert.equal(sum(r.studyRows),150);
// A course outside the report dates contributes no rows.
r=S.compute({...base,classes:[{code:'FUTURE',credits:3,startDate:'2026-10-01',endDate:'2026-12-18'}]});
assert.equal(r.attendanceRows.length,0);assert.equal(r.studyRows.length,0);
// A print/date header must not hide the actual student/program line.
assert.equal(Import.parse([{text:'Generated 9/30/26 | Test\n'+fixture}]).name,'Example Student');
assert.equal(Import.parse([{text:'Schedule Details | Fall term\n'+fixture}]).name,'Example Student');
assert.equal(Import.parse([{text:fixture.replace('Example Student','Kaʻimi O’Brien-Santos')}]).name,'Kaʻimi O’Brien-Santos');
assert.equal(Import.parse([{text:'Another Student | Program\n'+fixture}]).name,'','conflicting names remain editable blanks');
// Quoted CRN labels caused false multi-campus results on scanned printouts.
const quoted=Import.parse([{text:fixture.replaceAll('Campus: Maui College','Campus: Maui College ‘CRN: 12345'),ocr:true}]);
assert.equal(quoted.institution,'UH Maui College');
assert(quoted.courses.every(c=>c.campus==='Maui College'));
assert.equal(Import.parse([{text:fixture.replaceAll('Campus: Maui College','Campus: Hilo ‘CRN: 12345'),ocr:true}]).institution,'UH Hilo');
// Keep multi-campus presentation unchanged; never invent a primary campus.
assert.equal(Import.parse([{text:fixture.replace('Campus: Maui College','Campus: Manoa')}]).institution,'');
const spaced=Import.parse([{text:fixture.replace('S (0900 to 1220)','M W (0900 to 1220)')}]).courses[1];
assert.deepEqual(spaced.meetings.map(m=>m.day),[1,3]);
assert(spaced.meetings.every(m=>m.startDate==='2026-08-29'&&m.endDate==='2026-10-17'));
const damaged=Import.parse([{text:fixture.replace('When/Where: (TBA to TBA) / ONLINE ASYNC','WhenWhere: Wi (12000 1250) / ROOM 208'),ocr:true}]).courses[0];
assert.equal(damaged.mode,'async');assert.equal(damaged.meetings.length,0);assert(damaged.needsMeetingReview);
assert(damaged.notes.some(n=>n.includes('meeting text')));
const slashless=Import.parse([{text:fixture.replace('When/Where: (TBA to TBA) / ONLINE ASYNC','When Where: W (1200 to 1250) / ROOM 208'),ocr:true}]).courses[0];
assert.equal(slashless.mode,'scheduled');assert.deepEqual(slashless.meetings.map(m=>[m.day,m.startMin,m.endMin]),[[3,720,770]]);
assert.equal(slashless.needsMeetingReview,false,'room numbers are not damaged times');
const mixed=Import.parse([{text:fixture.replace('S (0900 to 1220)','S (0900 to 1220), W (13000 1400)')}]).courses[1];
assert.equal(mixed.mode,'scheduled');assert.equal(mixed.meetings.length,1);assert(mixed.needsMeetingReview);
const invalid=Import.parse([{text:fixture.replace('S (0900 to 1220)','S (1260 to 1220)')}]).courses[1];
assert.equal(invalid.mode,'async');assert(invalid.needsMeetingReview);assert.equal(invalid.meetings.length,0);
// PDF extraction often puts Start and End labels on the same line. A shared
// course range must apply to both components, without reading End as a start.
const sharedRange=`ABC 123: Two meetings
Credits: 2
When/Where:
R (0810 to 0900) / ROOM A
R (1020 to 1110) / ROOM B
Start date: SEP 28 2026   End date: DEC 11 2026`;
const shared=Import.parse([{text:sharedRange}]).courses[0];
assert.deepEqual(shared.meetings.map(m=>[m.startDate,m.endDate]),[
  ['2026-09-28','2026-12-11'],['2026-09-28','2026-12-11']]);
assert.equal(shared.startDate,'2026-09-28');assert.equal(shared.endDate,'2026-12-11');
// Explicit component ranges belong to their own meeting, not to the calendar
// overview or the broader course envelope. Wrapped locations stay associated.
const offsetRange=`ABC 123: Offset lecture and workshop
Credits: 3
When/Where:
M (1310 to 1400) / ROOM A [OCT 05 2026 - DEC 07 2026]
F (1310 to 1500) / WORKSHOP
 [OCT 23 2026 - DEC 04 2026]
Start date: OCT 05 2026   End date: DEC 07 2026`;
const offset=Import.parse([{text:offsetRange}]).courses[0];
assert.deepEqual(offset.meetings,[
  {day:1,startMin:790,endMin:840,startDate:'2026-10-05',endDate:'2026-12-07'},
  {day:5,startMin:790,endMin:900,startDate:'2026-10-23',endDate:'2026-12-04'}]);
assert.equal(offset.startDate,'2026-10-05');assert.equal(offset.endDate,'2026-12-07');
// A component with no explicit range still inherits the shared labeled range.
assert.deepEqual(Import.parse([{text:offsetRange.replace(' [OCT 23 2026 - DEC 04 2026]','')}]).courses[0].meetings[1],
  {day:5,startMin:790,endMin:900,startDate:'2026-10-05',endDate:'2026-12-07'});
// Keep parallel STAR date lists aligned even when their labels share a line.
assert.deepEqual(Import.parse([{text:fixture.replace('Start date: AUG 24 2026 AUG 29 2026\nEnd date:','Start date: AUG 24 2026 AUG 29 2026 End date:')}]).courses[1].meetings,
  parsed.courses[1].meetings);
// Reconciled dates must reach the scheduler with no manual correction.
const sharedOctober=S.compute({year:2026,month:9,classes:[shared]});
assert.equal(sharedOctober.attendanceRows.length,10);assert.equal(sum(sharedOctober.attendanceRows),500);
assert.equal(sum(sharedOctober.studyRows),500);
for(const month of [9,11]){
  const scheduled=S.compute({year:2026,month,classes:[offset]});
  const workshops=scheduled.attendanceRows.filter(row=>row.dateObj.getDay()===5);
  assert.deepEqual(workshops.map(row=>[row.dateObj.getFullYear(),row.dateObj.getMonth()+1,row.dateObj.getDate()]),
    month===9?[[2026,10,23],[2026,10,30]]:[[2026,12,4]]);
  assert.equal(sum(scheduled.attendanceRows),sum(scheduled.studyRows));
}
console.log('PASS: async defaults, header/name review, quoted campus labels, multi-campus preservation, damaged OCR warnings, weekday spacing, mixed components and course boundaries');
