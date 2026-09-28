/* Local-only PDF extraction. OCR assets are served with the app, never a service. */
export async function readSchedule(file, status) {
  if(file.size>30*1024*1024)throw new Error('Please use a schedule PDF smaller than 30 MB.');
  const pdfjs=await import('./lib/pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('./lib/pdfjs/pdf.worker.mjs',import.meta.url).href;
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
  let worker;const pages=[];
  try {
    if(pdf.numPages>12)throw new Error('Please choose the STAR schedule printout (up to 12 pages).');
    for(let i=1;i<=pdf.numPages;i++){
      status('Reading page '+i+' of '+pdf.numPages+'…');
      const page=await pdf.getPage(i),content=await page.getTextContent();
      let text=content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('');let ocr=false;
      if(text.replace(/\s/g,'').length<80){
        status('Recognizing scanned page '+i+' locally. Please wait…');
        if(!worker){
          if(!window.Tesseract)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='lib/ocr/tesseract.min.js';script.onload=resolve;script.onerror=()=>reject(new Error('Could not load local text recognition.'));document.head.appendChild(script);});
          worker=await window.Tesseract.createWorker('eng',1,{workerPath:new URL('./lib/ocr/worker.min.js',import.meta.url).href,corePath:new URL('./lib/ocr/',import.meta.url).href,langPath:new URL('./lib/ocr',import.meta.url).href,cacheMethod:'none',workerBlobURL:false});
        }
        const view=page.getViewport({scale:2}),canvas=document.createElement('canvas');canvas.width=view.width;canvas.height=view.height;
        await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
        text=(await worker.recognize(canvas)).data.text;ocr=true;
      }
      pages.push({text,ocr});
    }
    return window.BTHImport.parse(pages);
  } finally {if(worker)await worker.terminate();await pdf.destroy();}
}
