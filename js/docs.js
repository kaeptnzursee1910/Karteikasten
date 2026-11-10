// Dokumente importieren: PDF, Word (.docx), Bilder und Textdateien.
// Importierte Dokumente bleiben geladen, solange die Seite offen ist.
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const DOC_ACCEPT = ".pdf,.docx,.txt,.md,.csv,.text,image/*";
export const docs = [];

const scriptCache = {};
function loadScript(src) {
  return scriptCache[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete scriptCache[src]; reject(new Error("Bibliothek konnte nicht geladen werden: " + src)); };
    document.head.appendChild(s);
  });
}

async function getPdfjs() {
  await loadScript("vendor/pdfjs/pdf.min.js");
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
  return lib;
}
async function getMammoth() {
  await loadScript("vendor/mammoth/mammoth.browser.min.js");
  return window.mammoth;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Bild konnte nicht gelesen werden"));
    i.src = url;
  });
}

/** Eine Bildquelle: kann in beliebiger Breite gerendert werden. */
export function imageSource(img, label) {
  return {
    label, figure: true, w: img.naturalWidth, h: img.naturalHeight,
    async render(maxW) {
      const s = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * s));
      c.height = Math.max(1, Math.round(img.naturalHeight * s));
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c;
    },
  };
}

const words = t => t.split(/\s+/).filter(Boolean).length;

async function importFile(file, onStatus) {
  const name = file.name || "Dokument";
  const ext = (name.split(".").pop() || "").toLowerCase();
  const doc = { id: uid(), name, kind: ext.toUpperCase().slice(0, 4), text: "", sources: [], info: "" };

  if (ext === "pdf" || file.type === "application/pdf") {
    onStatus("PDF-Leser wird geladen…");
    const lib = await getPdfjs();
    const pdf = await lib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: "vendor/pdfjs/cmaps/", cMapPacked: true,
      standardFontDataUrl: "vendor/pdfjs/standard_fonts/",
      isEvalSupported: false,
    }).promise;
    const n = Math.min(pdf.numPages, 150);
    const IMG_OPS = new Set([lib.OPS.paintImageXObject, lib.OPS.paintInlineImageXObject, lib.OPS.paintImageXObjectRepeat]);
    const parts = [];
    for (let p = 1; p <= n; p++) {
      onStatus(`Lese Seite ${p} von ${n}…`);
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const text = tc.items.map(i => (i.str || "") + (i.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim();
      let hasImg = false;
      try { hasImg = (await page.getOperatorList()).fnArray.some(f => IMG_OPS.has(f)); } catch (e) { /* egal */ }
      parts.push(`[Seite ${p}]\n${text}`);
      const vp1 = page.getViewport({ scale: 1 });
      doc.sources.push({
        label: `Seite ${p}`, page: p, figure: hasImg || text.length < 40, w: vp1.width, h: vp1.height,
        async render(maxW) {
          const vp = page.getViewport({ scale: maxW / vp1.width });
          const c = document.createElement("canvas");
          c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          return c;
        },
      });
    }
    doc.text = parts.join("\n\n");
    doc.kind = "PDF";
    doc.info = `${pdf.numPages} ${pdf.numPages === 1 ? "Seite" : "Seiten"}${pdf.numPages > n ? `, die ersten ${n} gelesen` : ""}`;
  } else if (ext === "docx") {
    onStatus("Word-Dokument wird gelesen…");
    const mammoth = await getMammoth();
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    const dom = new DOMParser().parseFromString(html, "text/html");
    for (const el of [...dom.querySelectorAll("img")]) {
      try {
        const im = await loadImage(el.getAttribute("src"));
        if (im.naturalWidth < 40 || im.naturalHeight < 40) { el.replaceWith(""); continue; }
        doc.sources.push(imageSource(im, `Abbildung ${doc.sources.length + 1}`));
        el.replaceWith(dom.createTextNode(` [Abbildung ${doc.sources.length}] `));
      } catch (e) { el.replaceWith(""); }
    }
    dom.querySelectorAll("p, li, h1, h2, h3, h4, tr").forEach(el => el.append("\n"));
    doc.text = dom.body.textContent.replace(/\n{3,}/g, "\n\n").trim();
    doc.kind = "WORD";
    doc.info = `${words(doc.text)} Wörter, ${doc.sources.length} ${doc.sources.length === 1 ? "Abbildung" : "Abbildungen"}`;
  } else if (file.type.startsWith("image/") || ["jpg", "jpeg", "png", "heic", "heif", "webp", "gif"].includes(ext)) {
    onStatus("Bild wird geladen…");
    const im = await loadImage(URL.createObjectURL(file));
    doc.sources.push(imageSource(im, "Bild"));
    doc.kind = "BILD";
    doc.info = `${im.naturalWidth} × ${im.naturalHeight} px`;
  } else if (["txt", "md", "csv", "text"].includes(ext) || file.type.startsWith("text/")) {
    doc.text = await file.text();
    doc.kind = "TEXT";
    doc.info = `${words(doc.text)} Wörter`;
  } else {
    throw new Error(`„${name}“ wird nicht unterstützt. Möglich sind PDF, Word (.docx), Bilder und Textdateien.`);
  }
  docs.push(doc);
  return doc;
}

/** Importiert mehrere Dateien nacheinander; gibt Fehlermeldungen zurück. */
export async function importFiles(files, onStatus) {
  const errors = [];
  for (const f of files) {
    try { await importFile(f, s => onStatus(`${f.name}: ${s}`)); }
    catch (e) { errors.push(e.message || String(e)); }
  }
  onStatus("");
  return errors;
}

export function removeDoc(id) {
  const i = docs.findIndex(d => d.id === id);
  if (i >= 0) docs.splice(i, 1);
}

/* ---------- Bild-Helfer ---------- */
export function scaleCanvas(src, maxDim) {
  const s = Math.min(1, maxDim / Math.max(src.width, src.height));
  if (s === 1) return src;
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * s); c.height = Math.round(src.height * s);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function cropCanvas(canvas, box) {
  const [x0, y0, x1, y1] = box.map(v => Math.min(1, Math.max(0, +v || 0)));
  const sx = Math.round(x0 * canvas.width), sy = Math.round(y0 * canvas.height);
  const sw = Math.max(1, Math.round((x1 - x0) * canvas.width)), sh = Math.max(1, Math.round((y1 - y0) * canvas.height));
  const c = document.createElement("canvas");
  c.width = sw; c.height = sh;
  c.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

export const toBlob = (canvas, q = 0.85) => new Promise((resolve, reject) =>
  canvas.toBlob(b => b ? resolve(b) : reject(new Error("Bild konnte nicht erzeugt werden")), "image/jpeg", q));
