/* STAR print-view import. Pure parsing; ambiguous facts are kept for review. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BTHImport=factory();})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  function dates(text){const out=[];const re=/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|0CT|NOV|DEC)\s+(\d{1,2})\s+(20\d{2})\b/g;let m;while((m=re.exec(text))){const month=months.indexOf(m[1].replace('0CT','OCT'))+1;out.push(m[3]+'-'+String(month).padStart(2,'0')+'-'+m[2].padStart(2,'0'));}return out;}
  function clock(s){if(!/^\d{3,4}$/.test(s))return null;const n=s.padStart(4,'0'),h=Number(n.slice(0,2)),m=Number(n.slice(2));return h<24&&m<60?h*60+m:null;}
  function parse(pages){
    const text=pages.map(p=>p.text).join('\n').replace(/\u00a0/g,' ').replace(/\bM\s+aui\b/g,'Maui').replace(/\bM\s+anoa\b/g,'Manoa');
    const starts=[...text.matchAll(/\b([A-Z]{2,5})\s+(\d{3}[A-Z]{0,2})\s*:\s*([^\n]*)/g)];
    const courses=[];
    for(let i=0;i<starts.length;i++){
      const m=starts[i],chunk=text.slice(m.index,i+1<starts.length?starts[i+1].index:text.length);
      const code=m[1]+' '+m[2];
      const credit=/Credits\s*:\s*(\d+(?:\.\d+)?)/i.exec(chunk);
      const campus=/Campus\s*:\s*([^\n]*?)(?=\s+CRN\s*:|\n|$)/i.exec(chunk);
      const when=/When\s*\/\s*Where\s*:\s*([\s\S]*?)(?=Credits\s*:|CRN\s*:|Start\s+date\s*:|End\s+date\s*:|$)/i.exec(chunk);
      const startLabel=/Start\s+date\s*:\s*([^\n]*)/i.exec(chunk),endLabel=/End\s+date\s*:\s*([^\n]*)/i.exec(chunk);
      const from=dates(startLabel?startLabel[1]:''),until=dates(endLabel?endLabel[1]:'');
      const times=when?when[1]:'';const components=[...times.matchAll(/([MTWRFSU]+)?\s*\(\s*(\d{3,4}|TBA)\s+to\s+(\d{3,4}|TBA)\s*\)/gi)];
      const meetings=[],notes=[];
      components.forEach((c,j)=>{const start=clock(c[2]),end=clock(c[3]);if(start==null||end==null||!c[1])return;
        for(const day of c[1].toUpperCase()){meetings.push({day:{U:0,M:1,T:2,W:3,R:4,F:5,S:6}[day],startMin:start,endMin:end,startDate:from[j]||from[0]||'',endDate:until[j]||until[0]||''});}});
      const explicitAsync=/ONLINE\s+ASYNC/i.test(chunk),hasTBA=components.some(c=>/TBA/i.test(c[0]));
      const mode=meetings.length?'scheduled':explicitAsync?'async':'unknown';
      if(mode==='unknown')notes.push('No confirmed meeting times or explicit ASYNC label. Confirm whether this course is async or enter its scheduled meetings.');
      if(meetings.length&&hasTBA)notes.push('Also lists a TBA component. No extra attendance hours have been assumed.');
      if(!from.length||!until.length)notes.push('Course dates were not fully read. Check them against the schedule.');
      if(!credit||![1,2,3,4].includes(Number(credit[1])))notes.push('Check credits: this tool supports 1–4 credits.');
      const allFrom=from.slice().sort(),allUntil=until.slice().sort();
      courses.push({code,credits:credit?Number(credit[1]):null,campus:campus?campus[1].trim():'',mode,meetings,startDate:allFrom[0]||'',endDate:allUntil[allUntil.length-1]||'',notes,source:chunk.trim()});
    }
    const head=text.slice(0,starts[0]?starts[0].index:0);
    // Handwritten totals on redacted scans can resemble the name/program separator.
    // Only accept a name-shaped prefix; leave ambiguous OCR text for manual entry.
    const nameMatch=/^([^\n|]{3,80})\s*\|/m.exec(head);
    const candidate=nameMatch?nameMatch[1].trim():'';
    const name=/^[\p{L}\p{M}][\p{L}\p{M} .'’ʻ-]+$/u.test(candidate)&&candidate.split(/\s+/).length>=2?candidate:'';
    const campuses=[...new Set(courses.map(c=>c.campus).filter(Boolean))];
    return {name,institution:campuses.length===1?(campuses[0]==='Maui College'?'UH Maui College':'UH '+campuses[0]):'',courses,ocr:pages.some(p=>p.ocr),pages:pages.length};
  }
  return {parse};
});
