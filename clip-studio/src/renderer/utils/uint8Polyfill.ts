/**
 * Polyfill the TC39 Uint8Array ↔ hex/base64 methods.
 *
 * pdfjs-dist v6 calls `Uint8Array.prototype.toHex` (in its worker) and
 * `.toBase64` / `Uint8Array.fromBase64` (main thread). Those shipped in
 * Chromium 133, but Electron 33 bundles Chromium 130 — so without this the
 * import throws "a.toHex is not a function" the moment a PDF is parsed.
 *
 * Import this before pdfjs in BOTH contexts (main thread and the worker entry).
 * No-op on engines that already have the methods.
 */

const U8 = Uint8Array.prototype as unknown as {
  toHex?: () => string;
  toBase64?: () => string;
};
const U8Static = Uint8Array as unknown as {
  fromHex?: (hex: string) => Uint8Array;
  fromBase64?: (b64: string) => Uint8Array;
};

const HEX = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));

function def(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, writable: true, configurable: true });
}

if (typeof U8.toHex !== "function") {
  def(Uint8Array.prototype, "toHex", function (this: Uint8Array): string {
    let s = "";
    for (let i = 0; i < this.length; i++) s += HEX[this[i]];
    return s;
  });
}

if (typeof U8Static.fromHex !== "function") {
  def(Uint8Array, "fromHex", (hex: string): Uint8Array => {
    const clean = hex.length % 2 ? hex.slice(0, -1) : hex;
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  });
}

if (typeof U8.toBase64 !== "function") {
  def(Uint8Array.prototype, "toBase64", function (this: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < this.length; i++) bin += String.fromCharCode(this[i]);
    return btoa(bin);
  });
}

if (typeof U8Static.fromBase64 !== "function") {
  def(Uint8Array, "fromBase64", (b64: string): Uint8Array => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  });
}
