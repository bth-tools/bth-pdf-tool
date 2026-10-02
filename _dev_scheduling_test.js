const assert=require('node:assert/strict'),S=require('./schedule'),fs=require('fs'),P=require('pdf-lib'),F=require('./pdffill');
const base={year:2026,month:8,startDate:'2026-09-13',endDate:'2026-09-19',classes:[{code:'ASYNC',credits:3}]};
const sum=rs=>rs.reduce((n,r)=>n+Math.round(r.hours*60),0);
const iso=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
function verify(cfg){const r=S.compute(cfg);assert.equal(r.error,null);const days={};const budgets={};for(const [kind,rows]of [['attendance',r.attendanceRows],['study',r.studyRows]])for(const row of rows){const d=row.dateObj,start=S.parseTime(row.start),end=start+Math.round(row.hours*60),key=d.toDateString();for(const b of cfg.unavailable||[])if(d.getDay()===b.day&&(!b.startDate||iso(d)>=b.startDate)&&(!(b.endDate||b.startDate)||iso(d)<=(b.endDate||b.startDate)))assert(end<=b.startMin||start>=b.endMin,'unavailable conflict');(days[key]??=[]).push([start,end]);const sun=new Date(d);sun.setDate(sun.getDate()-sun.getDay());const k=sun.toDateString()+row.code;(budgets[k]??={attendance:0,study:0})[kind]+=end-start;}for(const blocks of Object.values(days)){blocks.sort((a,b)=>a[0]-b[0]);for(let i=1;i<blocks.length;i++)assert(blocks[i][0]>=blocks[i-1][1],'overlap');}for(const b of Object.values(budgets))assert(b.study<=b.attendance);return r;}
let r=verify({...base,unavailable:[{day:1,startMin:480,endMin:600},{day:2,startMin:480,endMin:600}]});assert.equal(sum(r.attendanceRows),180);assert.equal(sum(r.studyRows),180);assert.equal(r.attendanceRows[0].start,'10:00a');
r=verify({...base,classes:[{code:'CUSTOM',credits:3,customStudy:true,studySlots:[{day:5,startMin:1140}]}]});assert.equal(r.studyRows.length,1);assert.equal(r.studyRows[0].start,'7:00p');assert.equal(r.studyRows[0].end,'10:00p');
r=verify({...base,classes:[{code:'SPLIT',credits:3,customStudy:true,studySlots:[{day:2,startMin:1140},{day:4,startMin:1140}]}]});assert.equal(r.studyRows.length,2);assert(r.studyRows.every(x=>x.hours===1.5));
r=verify({...base,classes:[{code:'SPLIT',credits:3,customStudy:true,studySlots:[{day:2,startMin:1140,minutes:60},{day:4,startMin:1140}]}]});assert.deepEqual(r.studyRows.map(x=>x.hours),[1,2]);
r=verify({...base,unavailable:Array.from({length:7},(_,day)=>({day,startMin:0,endMin:1440}))});assert.equal(r.attendanceRows.length,0);assert.equal(r.studyRows.length,0);assert.equal(r.shortfalls[0].minutes,180);
// Fragmented time must be used even when no full 90-minute block fits.
const unavailable=[];for(let day=0;day<7;day++){unavailable.push({day,startMin:0,endMin:480});for(let start=510;start<1440;start+=60)unavailable.push({day,startMin:start,endMin:Math.min(1440,start+30)});}
r=verify({...base,unavailable});assert.equal(sum(r.attendanceRows),180);assert.equal(sum(r.studyRows),180);
r=verify({...base,startDate:'2026-09-06',endDate:'2026-09-12',classes:[{code:'SET',credits:3,meetings:[{day:3,startMin:720,endMin:840}],customStudy:true,studySlots:[{day:1,startMin:480}]}]});assert.equal(r.studyRows[0].dateFull,'M 9/7');assert.equal(sum(r.studyRows),120);
r=verify({...base,startDate:'2026-09-07',endDate:'2026-09-07'});assert.equal(sum(r.attendanceRows),90);assert.equal(sum(r.studyRows),90);
// An attendance-filled date still produces output, with an explicit study shortfall.
const partial=S.compute({...base,startDate:'2026-09-14',endDate:'2026-09-14',classes:[{code:'LONG',meetings:[{day:1,startMin:480,endMin:1440}]}]});assert.equal(partial.shortfalls[0].minutes,960);assert.equal(partial.attendanceRows.length,1);
const remainder=verify({...base,unavailable:[{day:3,startMin:720,endMin:1080}],classes:[{code:'HYBRID',credits:4,meetings:[{day:1,startMin:720,endMin:810}],addRemainder:true}]});assert.equal(sum(remainder.attendanceRows),240);assert.equal(sum(remainder.studyRows),240);
const moved=verify({...base,unavailable:[{day:5,startMin:1140,endMin:1440}],classes:[{code:'MOVE',credits:3,customStudy:true,studySlots:[{day:5,startMin:1140}]}]});assert.equal(sum(moved.studyRows),180);
const incomplete=S.compute({...base,classes:[{code:'EMPTY',meetsSetTimes:true,meetings:[]}]});assert.equal(incomplete.attendanceRows.length,0);assert(incomplete.warnings.length);
// Fixed meetings are retained quietly; movable attendance and study avoid both
// their actual times and unavailable intervals without asking for user repair.
const fixedConfig={...base,unavailable:[1,3].map(day=>({day,startMin:540,endMin:660})),classes:[
  {code:'MATH 103',credits:3,meetings:[1,3].map(day=>({day,startMin:600,endMin:675}))},
  {code:'ASYNC',credits:3,customStudy:true,studySlots:[{day:1,startMin:600}]}
]};
const quietFixed=S.compute(fixedConfig);assert.equal(quietFixed.error,null);assert.deepEqual(quietFixed.warnings,[]);assert.deepEqual(quietFixed.shortfalls,[]);
const retained=quietFixed.attendanceRows.filter(row=>row.code==='MATH 103');assert.equal(retained.length,2);assert(retained.every(row=>row.start==='10:00a'&&row.end==='11:15a'));
const claims=[...fixedConfig.unavailable,...retained.map(row=>({day:row.dateObj.getDay(),startMin:S.parseTime(row.start),endMin:S.parseTime(row.end)}))];
const movable=[...quietFixed.attendanceRows.filter(row=>row.code==='ASYNC'),...quietFixed.studyRows];
for(const row of movable){const day=row.dateObj.getDay(),start=S.parseTime(row.start),end=start+Math.round(row.hours*60);for(const b of claims.filter(b=>b.day===day))assert(end<=b.startMin||start>=b.endMin,'movable row overlaps fixed meeting or unavailable time');claims.push({day,startMin:start,endMin:end});}
for(const code of ['MATH 103','ASYNC']){const expected=code==='MATH 103'?150:180;assert.equal(sum(quietFixed.attendanceRows.filter(row=>row.code===code)),expected);assert.equal(sum(quietFixed.studyRows.filter(row=>row.code===code)),expected);}
// A single calendar date moves only that week's automatic attendance or study.
const datedBase={year:2026,month:9,classes:[{code:'DATED',credits:3}]};
const oneDay={day:1,startMin:480,endMin:600,startDate:'2026-10-12'};
const dated=verify({...datedBase,unavailable:[oneDay]});
assert.deepEqual(dated.attendanceRows.filter(row=>row.dateObj.getDay()===1).map(row=>[iso(row.dateObj),row.start]),[
  ['2026-09-28','8:00a'],['2026-10-05','8:00a'],['2026-10-12','10:00a'],['2026-10-19','8:00a'],['2026-10-26','8:00a']]);
assert.equal(sum(dated.attendanceRows),900);assert.equal(sum(dated.studyRows),900);
assert.deepEqual(dated.warnings,[]);assert.deepEqual(dated.shortfalls,[]);
assert.deepEqual(S.buildWeekTemplate({...datedBase,unavailable:[oneDay]}),S.buildWeekTemplate(datedBase));
const datedStudy=verify({...datedBase,unavailable:[{...oneDay,day:2,startDate:'2026-10-13'}]});
assert.deepEqual(datedStudy.studyRows.filter(row=>row.dateObj.getDay()===2).map(row=>row.start),['8:00a','8:00a','10:00a','8:00a','8:00a']);
// Bounds are inclusive, retain selected weekdays, and survive a month change.
const rangeConfig={...datedBase,unavailable:[{...oneDay,startDate:'2026-10-26',endDate:'2026-11-02'}]};
for(const month of [9,10]){
  const result=verify({...rangeConfig,month});
  for(const row of result.attendanceRows.filter(row=>row.dateObj.getDay()===1))
    assert.equal(row.start,iso(row.dateObj)>='2026-10-26'&&iso(row.dateObj)<='2026-11-02'?'10:00a':'8:00a');
  assert.equal(sum(result.attendanceRows),sum(result.studyRows));
}
const yearRange={...datedBase,month:11,unavailable:[{...oneDay,startDate:'2026-12-21',endDate:'2027-01-04'}]};
for(const [year,month] of [[2026,11],[2027,0]]){
  const result=verify({...yearRange,year,month});
  for(const row of result.attendanceRows.filter(row=>row.dateObj.getDay()===1))
    assert.equal(row.start,iso(row.dateObj)>='2026-12-21'&&iso(row.dateObj)<='2027-01-04'?'10:00a':'8:00a');
}
// Midnight means the selected day's end. Closing one complete week must not
// suppress other weeks or invent study for attendance that could not fit.
const closedWeek=verify({...datedBase,unavailable:Array.from({length:7},(_,day)=>({day,startMin:0,endMin:1440,startDate:'2026-10-11',endDate:'2026-10-17'}))});
assert.equal(sum(closedWeek.attendanceRows),720);assert.equal(sum(closedWeek.studyRows),720);
assert.deepEqual(closedWeek.shortfalls,[{code:'DATED',kind:'attendance',minutes:180,week:'10/11'}]);
const midnight=verify({...datedBase,unavailable:[{day:1,startMin:480,endMin:1440,startDate:'2026-10-12'}]});
assert(!midnight.attendanceRows.some(row=>iso(row.dateObj)==='2026-10-12'));assert.equal(sum(midnight.attendanceRows),900);
// End-only, reversed and impossible dates are rejected, never made weekly.
for(const block of [{...oneDay,startDate:'',endDate:'2026-10-12'},{...oneDay,endDate:'2026-10-11'},{...oneDay,startDate:'2026-02-30'}]){
  const result=S.compute({...datedBase,unavailable:[block]});assert.equal(result.warnings.length,1);
  assert.deepEqual(result.attendanceRows,S.compute(datedBase).attendanceRows);
}
// A date range outside the reporting period is inactive; clearing dates restores
// existing weekly behavior exactly, including placeholders and custom study.
const outOfRange=S.compute({...datedBase,unavailable:[{...oneDay,startDate:'2026-11-09'}]});assert.deepEqual(outOfRange.attendanceRows,S.compute(datedBase).attendanceRows);
const weekly={...datedBase,unavailable:[{day:1,startMin:480,endMin:600}]};
assert.deepEqual(S.compute({...weekly,unavailable:[{...weekly.unavailable[0],startDate:'',endDate:''}]}),S.compute(weekly));
const customWeekly={...weekly,classes:[{code:'CUSTOM DATES',credits:3,customStudy:true,studySlots:[{day:5,startMin:660}]}]};
const customDated=verify({...customWeekly,unavailable:[...weekly.unavailable,{day:5,startMin:660,endMin:840,startDate:'2026-10-16'}]});
assert.deepEqual(customDated.studyRows.map(row=>row.start),['11:00a','11:00a','2:00p','11:00a','11:00a']);
assert.deepEqual(S.compute({...customWeekly,unavailable:weekly.unavailable.map(b=>({...b,startDate:'',endDate:''}))}),S.compute(customWeekly));
const datedFixed={...fixedConfig,startDate:null,endDate:null,month:9,unavailable:[{day:1,startMin:540,endMin:660,startDate:'2026-10-12'}]};
const dateQuiet=S.compute(datedFixed);assert.deepEqual(dateQuiet.warnings,[]);assert.deepEqual(dateQuiet.shortfalls,[]);
assert.equal(dateQuiet.attendanceRows.filter(row=>row.code==='MATH 103'&&iso(row.dateObj)==='2026-10-12').length,1);
for(const code of ['MATH 103','ASYNC'])assert.equal(sum(dateQuiet.attendanceRows.filter(row=>row.code===code)),sum(dateQuiet.studyRows.filter(row=>row.code===code)));
// Deterministic varied constraints across all months, with both real pressure schedules.
let random=819;function rand(n){random=(random*1664525+1013904223)>>>0;return random%n;}
const scenarios=[{"name": "Test Juan", "institution": "UH Hilo", "month": 11, "classes": [{"code": "ABC 200", "credits": 1, "meetings": [{"day": 3, "startMin": 720, "endMin": 770}]}, {"code": "DEF 280", "credits": 3, "meetings": [{"day": 1, "startMin": 720, "endMin": 795}], "addRemainder": true}, {"code": "GHI 365", "credits": 3, "meetings": [{"day": 2, "startMin": 660, "endMin": 735}, {"day": 4, "startMin": 660, "endMin": 735}]}, {"code": "JKL 400", "credits": 3, "meetings": [{"day": 3, "startMin": 840, "endMin": 1005}]}, {"code": "MNO 390", "credits": 3, "meetings": [{"day": 2, "startMin": 750, "endMin": 825}, {"day": 4, "startMin": 750, "endMin": 825}]}, {"code": "PQR 280L", "credits": 1}, {"code": "STU 360", "credits": 3}], "year": 2026, "dayStartMin": 480, "blockMinutes": 90, "startDate": "2026-08-24", "endDate": "2026-12-18"}, {"name": "Test Deux", "institution": "UH Manoa", "month": 8, "classes": [{"code": "ABC 555H", "credits": 4, "meetings": [{"day": 5, "startMin": 720, "endMin": 810}], "addRemainder": true}, {"code": "DEF 590P", "credits": 2, "meetings": [{"day": 6, "startMin": 540, "endMin": 740}]}, {"code": "GHI 581", "credits": 3, "meetings": [{"day": 1, "startMin": 810, "endMin": 885}, {"day": 3, "startMin": 810, "endMin": 885}]}, {"code": "JKL 535", "credits": 3, "meetings": [{"day": 2, "startMin": 920, "endMin": 995}, {"day": 4, "startMin": 920, "endMin": 995}]}, {"code": "MNO 523", "credits": 3, "meetings": [{"day": 1, "startMin": 600, "endMin": 700}]}, {"code": "PQR 533", "credits": 3, "meetings": [{"day": 2, "startMin": 810, "endMin": 885}, {"day": 4, "startMin": 810, "endMin": 885}]}], "year": 2026, "dayStartMin": 480, "blockMinutes": 90, "startDate": "2026-08-24", "endDate": "2026-12-18"}];
for(let n=0;n<120;n++){const source=scenarios[n%2];const blocks=Array.from({length:5},()=>{const start=rand(12)*60+480;return {day:rand(7),startMin:start,endMin:Math.min(1440,start+120)};});
// Vary async workloads of the same size and credit distribution as the pressure schedules.
const classes=source.classes.map(c=>({...c,meetings:undefined,meetsSetTimes:false,customStudy:!!rand(2),studySlots:[{day:rand(7),startMin:rand(12)*60+480}]}));verify({...base,month:n%12,startDate:null,endDate:null,classes,unavailable:blocks});}
(async()=>{let count=0;for(const [label,cfg]of [['blocked',{...base,unavailable}],['custom',{...base,classes:[{code:'CUSTOM',credits:3,customStudy:true,studySlots:[{day:5,startMin:1140}]}]}],['partial',{...base,startDate:'2026-09-14',endDate:'2026-09-14',classes:[{code:'LONG',meetings:[{day:1,startMin:480,endMin:1440}]}]}]]){const result=S.compute(cfg);for(const key of ['816','819','817']){const blank={'816':'ClassAttend_DHS 816.pdf','819':'StudyTimesheet_DHS 819.pdf','817':'MonitoredStudy_DHS 817.pdf'}[key];for(const [i,rows]of F.splitIntoForms(key==='816'?result.attendanceRows:result.studyRows,key).entries()){const out=await F.fill(P,fs.readFileSync(blank),key,{name:'Release Test',institution:'UH',monthYear:result.monthYearLabel},rows);assert.equal(out.overflow,0);const doc=await P.PDFDocument.load(out.bytes),form=doc.getForm(),spec=F.FORMS[key];rows.forEach((r,n)=>{for(const k of Object.keys(spec.cols))assert.equal(form.getTextField(spec.cols[k]+spec.suffixes[n]).getText()||'',r[k]||'');});fs.writeFileSync(`_dev_out/v633_${label}_${key}_${i}.pdf`,out.bytes);count++;}}}console.log('PASS: constraints, custom/split/holiday study, partial output, 120 varied schedules and '+count+' PDF readbacks');})().catch(e=>{console.error(e);process.exit(1)});
