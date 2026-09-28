# Schedule import dependencies

These files are vendored locally; no CDN or external OCR/AI service is used at runtime.

| Component | Version | License file |
| --- | --- | --- |
| pdfjs-dist (PDF.js) | 5.6.205 | pdfjs/LICENSE |
| Tesseract.js | 7.0.0 | ocr/TESSERACT-LICENSE.md |
| tesseract.js-core | 7.0.0 | ocr/CORE-LICENSE |
| English Tesseract language data | 4.0.0 distribution | Apache-2.0 (ocr/CORE-LICENSE) |

English data source: https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz
JavaScript distributions were copied from the corresponding installed npm packages.

The reader explicitly uses LSTM-only OCR (OEM 1). Ship the baseline, SIMD and relaxed-SIMD
`*-lstm.wasm.js` cores so the worker can select the supported one. Those files contain their
WASM bytes; separate `.wasm` binaries and legacy recognition cores are unnecessary.
PDF.js loads on import; OCR and the English data load only for scanned pages.
Do not pre-cache all OCR assets or add external data uploads when changing this implementation.
