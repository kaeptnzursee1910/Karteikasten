// KI für die Artefakt-Version: Claude über die sample-Fähigkeit des Artefakts.
// Gleiche Schnittstelle wie js/ai.js; Einstellungen für lokale Modelle entfallen.

export const ARTIFACT = true;
export const BROWSER_MODELS = [];
export const CLOUD_SERVICES = {};
export const settings = { provider: "claude", model: "Claude" };

let sample = null, limits = null;

export async function loadSettings() {
  sample = window.claude?.use ? await window.claude.use("sample") : null;
  if (sample) limits = await sample.limits().catch(() => null);
}
export async function saveSettings() {}
export const hasProxy = () => false;
export const defaultBaseUrl = () => "";
export const mixedContentProblem = () => false;
export const isConfigured = () => !!sample;
export const canSeeImages = () => !!limits?.images;
export const providerLabel = () => "Claude";
export const modelLabel = () => "Claude";
export const cloudModel = () => "Claude";
export async function setModel() {}
export async function listModels() { return ["Claude"]; }
export async function detectVision() { return null; }
export const browserSupported = () => false;
export const browserModelLoaded = () => false;
export async function loadBrowserModel() { throw new Error("Nicht verfügbar."); }

/** Ungefähre Zeichenmenge an Lernstoff; eine Anfrage darf höchstens 256 KB Text enthalten. */
export function maxInputChars() {
  return Math.min(110000, Math.floor((limits?.maxPromptBytes || 262144) / 2.2));
}

function errorText(e) {
  switch (e?.code) {
    case "not_granted": return "Claude wurde für diese Seite nicht erlaubt. Du kannst es im Berechtigungsmenü des Artefakts freigeben.";
    case "rate_limited": return "Gerade zu viele Anfragen an Claude. Versuch es in einer Minute noch einmal.";
    case "image_rejected": return "Ein Bild aus dem Dokument wurde abgelehnt. Versuch es mit weniger Seiten.";
    case "images_unavailable": return "In dieser Ansicht können keine Bilder an Claude geschickt werden.";
    case "input_too_large": return "Der Lernstoff ist zu lang. Gib nur einen Teil davon ein.";
    default: return "Claude ist gerade nicht erreichbar (" + (e?.message || e?.code || "Fehler") + ").";
  }
}

export async function generate({ prompt, context = "", images = [], signal, onText }) {
  if (!sample) throw new Error("Claude ist in dieser Ansicht nicht verfügbar.");
  const input = context ? context + "\n\n" + prompt : prompt;
  const opts = { signal, cache: false, onText: ({ text }) => onText?.(text) };
  const max = limits?.images?.maxCount || 0;
  if (images.length && max) opts.images = images.slice(0, max);
  try {
    const { text } = await sample(input, opts);
    return stripThinking(text);
  } catch (e) {
    if (e?.code === "cancelled") throw new DOMException("Abgebrochen", "AbortError");
    throw new Error(errorText(e));
  }
}

export function stripThinking(t) { return String(t || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim(); }

export function parseJson(text) {
  const t = stripThinking(text).replace(/```(?:json)?/gi, "");
  try { return JSON.parse(t); } catch (e) { /* weiter suchen */ }
  const start = t.search(/[{[]/);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { /* unten */ }
  }
  throw new Error("Claude hat keine lesbare Kartenliste geliefert. Versuch es noch einmal.");
}
