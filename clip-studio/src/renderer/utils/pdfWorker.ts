// Custom pdf.js worker entry: install the Uint8Array hex/base64 polyfill in the
// worker context BEFORE the real pdf.js worker loads (it calls Uint8Array.prototype
// .toHex, absent in Electron 33's Chromium 130). Wired via GlobalWorkerOptions
// .workerPort in scriptParser.ts. Bundled by Vite's `?worker` import.
import "./uint8Polyfill";
import "pdfjs-dist/build/pdf.worker.min.mjs";
