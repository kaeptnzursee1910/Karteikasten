// Anbindung an ein lokales KI-Modell.
//  - "server":  Ollama (native API) oder ein OpenAI-kompatibler Server (LM Studio, llama.cpp, vLLM …)
//  - "browser": WebLLM, das Modell läuft per WebGPU direkt im Browser
import { getSetting, setSetting } from "./store.js";

const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/lib/index.js";

export const BROWSER_MODELS = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 · 1,5 B", size: "ca. 1 GB", ctx: 4096 },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 · 3 B", size: "ca. 2 GB", ctx: 4096 },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 · 3 B", size: "ca. 2 GB", ctx: 4096 },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi 3.5 mini · 3,8 B", size: "ca. 2,2 GB", ctx: 4096 },
];

export const settings = {
  provider: "server",      // "server" | "browser"
  api: "ollama",           // "ollama" | "openai"
  baseUrl: "",             // leer = automatisch
  model: "",
  vision: false,           // Bilder an das Modell senden
  numCtx: 16384,           // Kontextlänge (nur Ollama)
  browserModel: BROWSER_MODELS[0].id,
};

let proxyAvailable = false;

export async function loadSettings() {
  try { Object.assign(settings, (await getSetting("ai")) || {}); } catch (e) { /* Standardwerte */ }
  // Läuft die App über server.py, gibt es unter /ki/ einen Proxy zum lokalen Modellserver
  try {
    const r = await fetch("ki/", { method: "GET", cache: "no-store" });
    proxyAvailable = r.headers.get("x-karteikasten-proxy") === "1";
  } catch (e) { proxyAvailable = false; }
}
export const saveSettings = () => setSetting("ai", { ...settings });

export function hasProxy() { return proxyAvailable; }

export function defaultBaseUrl(api = settings.api) {
  if (proxyAvailable) return new URL(api === "ollama" ? "ki" : "ki/v1", location.href).href;
  return api === "ollama" ? "http://localhost:11434" : "http://localhost:1234/v1";
}
export function baseUrl() { return (settings.baseUrl || defaultBaseUrl()).replace(/\/+$/, ""); }

export function isConfigured() {
  return settings.provider === "browser" ? !!settings.browserModel : !!settings.model;
}
export function canSeeImages() { return settings.provider === "server" && settings.vision; }

export function modelLabel() {
  if (settings.provider === "browser") return BROWSER_MODELS.find(m => m.id === settings.browserModel)?.label || settings.browserModel;
  return settings.model || "kein Modell gewählt";
}

/** Ungefähre Zeichenmenge an Lernstoff, die in den Kontext des Modells passt. */
export function maxInputChars(imageCount, cardCount) {
  const ctx = settings.provider === "browser"
    ? (BROWSER_MODELS.find(m => m.id === settings.browserModel)?.ctx || 4096)
    : (settings.api === "ollama" ? settings.numCtx : 32768);
  const reserve = 900 + cardCount * 90 + imageCount * 900; // Anweisungen, Antwort, Bilder
  return Math.max(2000, Math.floor((ctx - reserve) * 3));
}

/** Warnung, wenn eine https-Seite einen http-Server im Netzwerk ansprechen soll (blockiert der Browser). */
export function mixedContentProblem() {
  if (settings.provider !== "server" || location.protocol !== "https:") return false;
  try {
    const u = new URL(baseUrl());
    return u.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch (e) { return false; }
}

async function errorFrom(res) {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const t = await res.text();
    try { const j = JSON.parse(t); msg = j.error?.message || j.error || j.message || msg; } catch (e) { if (t) msg = t.slice(0, 300); }
  } catch (e) { /* kein Text */ }
  return new Error(msg);
}

function connectionError(e) {
  if (e.name === "AbortError") return e;
  return new Error(`Der Modellserver unter ${baseUrl()} ist nicht erreichbar. Läuft er, und ist CORS freigegeben? (Siehe Anleitung in den Einstellungen.)`);
}

/** Verfügbare Modelle des Servers. */
export async function listModels() {
  const base = baseUrl();
  let res;
  try { res = await fetch(base + (settings.api === "ollama" ? "/api/tags" : "/models")); }
  catch (e) { throw connectionError(e); }
  if (!res.ok) throw await errorFrom(res);
  const j = await res.json();
  return settings.api === "ollama" ? (j.models || []).map(m => m.name) : (j.data || []).map(m => m.id);
}

/** Ob ein Ollama-Modell Bilder versteht (null = unbekannt). */
export async function detectVision(model) {
  if (settings.api !== "ollama") return null;
  try {
    const res = await fetch(baseUrl() + "/api/show", { method: "POST", body: JSON.stringify({ model }) });
    if (!res.ok) return null;
    const j = await res.json();
    if (Array.isArray(j.capabilities)) return j.capabilities.includes("vision");
    return /llava|vision|-vl|vl:|gemma3|minicpm-v|moondream|bakllava/i.test(model) ? true : null;
  } catch (e) { return null; }
}

const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

async function readStream(res, onLine) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  }
  if (buf.trim()) onLine(buf.trim());
}

/* ---------- WebLLM ---------- */
let engine = null, engineModel = null, enginePromise = null;

export function browserSupported() { return !!navigator.gpu; }
export function browserModelLoaded() { return engine && engineModel === settings.browserModel; }

export async function loadBrowserModel(onProgress) {
  if (!navigator.gpu) throw new Error("Dieser Browser unterstützt kein WebGPU. Auf dem iPad ab iPadOS 26 in Safari verfügbar, am Rechner in aktuellem Chrome oder Edge.");
  const id = settings.browserModel;
  if (engine && engineModel === id) return engine;
  if (enginePromise && engineModel === id) return enginePromise;
  engineModel = id;
  enginePromise = (async () => {
    onProgress?.("Lade WebLLM…", 0);
    const webllm = await import(WEBLLM_URL);
    if (engine) { try { await engine.unload(); } catch (e) { /* egal */ } }
    engine = await webllm.CreateMLCEngine(id, { initProgressCallback: r => onProgress?.(r.text, r.progress) });
    return engine;
  })();
  try { return await enginePromise; }
  catch (e) { engine = null; engineModel = null; throw e; }
  finally { enginePromise = null; }
}

/**
 * Fragt das Modell. Gibt den kompletten Antworttext zurück.
 * @param {object} o
 * @param {string} o.prompt
 * @param {Blob[]} [o.images]   nur bei Vision-Modellen auf dem Server
 * @param {object} [o.schema]   JSON-Schema für strukturierte Antworten
 * @param {AbortSignal} [o.signal]
 * @param {(text:string)=>void} [o.onText]  ganzer bisheriger Text
 * @param {(msg:string, p:number)=>void} [o.onProgress]  Laden des Browser-Modells
 */
export async function generate({ prompt, images = [], schema, signal, onText, onProgress }) {
  let text = "";
  const push = delta => { if (!delta) return; text += delta; onText?.(text); };

  if (settings.provider === "browser") {
    const eng = await loadBrowserModel(onProgress);
    const req = { messages: [{ role: "user", content: prompt }], stream: true, temperature: 0.4 };
    if (schema) req.response_format = { type: "json_object", schema: JSON.stringify(schema) };
    const onAbort = () => { try { eng.interruptGenerate(); } catch (e) { /* egal */ } };
    signal?.addEventListener("abort", onAbort);
    try {
      const chunks = await eng.chat.completions.create(req);
      for await (const ch of chunks) {
        if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
        push(ch.choices?.[0]?.delta?.content);
      }
    } finally { signal?.removeEventListener("abort", onAbort); }
    return stripThinking(text);
  }

  const base = baseUrl();
  if (settings.api === "ollama") {
    const msg = { role: "user", content: prompt };
    if (images.length) msg.images = await Promise.all(images.map(blobToBase64));
    const body = { model: settings.model, messages: [msg], stream: true, options: { num_ctx: settings.numCtx, temperature: 0.4 } };
    if (schema) body.format = schema;
    let res;
    try { res = await fetch(base + "/api/chat", { method: "POST", body: JSON.stringify(body), signal }); }
    catch (e) { throw connectionError(e); }
    if (!res.ok) throw await errorFrom(res);
    await readStream(res, line => {
      const j = JSON.parse(line);
      if (j.error) throw new Error(j.error);
      push(j.message?.content);
    });
    return stripThinking(text);
  }

  // OpenAI-kompatibel
  const content = images.length
    ? [{ type: "text", text: prompt }, ...(await Promise.all(images.map(async b => ({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + await blobToBase64(b) } }))))]
    : prompt;
  const body = { model: settings.model, messages: [{ role: "user", content }], stream: true, temperature: 0.4 };
  if (schema) body.response_format = { type: "json_schema", json_schema: { name: "antwort", schema } };
  const send = b => fetch(base + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b), signal });
  let res;
  try {
    res = await send(body);
    if (!res.ok && schema && res.status === 400) { delete body.response_format; res = await send(body); }
  } catch (e) { throw connectionError(e); }
  if (!res.ok) throw await errorFrom(res);
  await readStream(res, line => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    const j = JSON.parse(data);
    if (j.error) throw new Error(j.error.message || j.error);
    push(j.choices?.[0]?.delta?.content);
  });
  return stripThinking(text);
}

export function stripThinking(t) { return t.replace(/<think>[\s\S]*?<\/think>/g, "").trim(); }

/** JSON aus einer Modellantwort holen, auch wenn drumherum Text oder ```-Blöcke stehen. */
export function parseJson(text) {
  const t = stripThinking(text).replace(/```(?:json)?/gi, "");
  try { return JSON.parse(t); } catch (e) { /* weiter suchen */ }
  const start = t.search(/[{[]/);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { /* unten */ }
  }
  throw new Error("Das Modell hat keine lesbare Kartenliste geliefert. Versuch es noch einmal oder nimm ein größeres Modell.");
}
