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
console.log('PASS: async defaults, header/name review, quoted campus labels, multi-campus preservation, damaged OCR warnings, weekday spacing, mixed components and course boundaries');
