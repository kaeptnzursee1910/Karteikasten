// Anbindung an ein KI-Modell.
//  - "server":  lokales Modell über Ollama (native API) oder einen OpenAI-kompatiblen Server (LM Studio, llama.cpp …)
//  - "browser": WebLLM, das Modell läuft per WebGPU direkt im Browser
//  - "cloud":   Claude über das Anthropic-SDK oder ein anderer Cloud-Dienst mit OpenAI-kompatibler Schnittstelle
import { getSetting, setSetting } from "./store.js";

const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/lib/index.js";
const ANTHROPIC_SDK_URL = "../vendor/anthropic/anthropic-sdk.min.js";

export const BROWSER_MODELS = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 · 1,5 B", size: "ca. 1 GB", ctx: 4096 },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 · 3 B", size: "ca. 2 GB", ctx: 4096 },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 · 3 B", size: "ca. 2 GB", ctx: 4096 },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi 3.5 mini · 3,8 B", size: "ca. 2,2 GB", ctx: 4096 },
];

export const CLOUD_SERVICES = {
  anthropic: { label: "Claude (Anthropic)", short: "Claude", keyHint: "sk-ant-…", keyPage: "console.anthropic.com", model: "claude-opus-5-5", ctx: 1000000 },
  openai: { label: "OpenAI (ChatGPT)", short: "OpenAI", baseUrl: "https://api.openai.com/v1", keyHint: "sk-…", keyPage: "platform.openai.com", ctx: 128000 },
  gemini: { label: "Google Gemini", short: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyHint: "AIza…", keyPage: "aistudio.google.com", ctx: 1000000 },
  mistral: { label: "Mistral", short: "Mistral", baseUrl: "https://api.mistral.ai/v1", keyHint: "", keyPage: "console.mistral.ai", ctx: 128000 },
  openrouter: { label: "OpenRouter (viele Anbieter)", short: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyHint: "sk-or-…", keyPage: "openrouter.ai", ctx: 128000 },
  custom: { label: "Anderer Dienst (OpenAI-kompatibel)", short: "Cloud", keyHint: "", keyPage: "", ctx: 128000 },
};

// Claude-Modelle mit serverseitigem Ersatzmodell bei Ablehnungen (fallbacks: "default")
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
// Höchste Ausgabelänge je Claude-Modell, aus der Modellliste
const claudeMaxTokens = new Map();
// So viel Lernstoff schicken wir höchstens an einen Cloud-Dienst (Kosten im Blick behalten)
const CLOUD_MAX_CHARS = 400000;

export const settings = {
  provider: "server",      // "server" | "browser" | "cloud"
  api: "ollama",           // "ollama" | "openai" (nur server)
  baseUrl: "",             // leer = automatisch
  model: "",
  vision: false,           // Bilder an das lokale Modell senden
  numCtx: 16384,           // Kontextlänge (nur Ollama)
  browserModel: BROWSER_MODELS[0].id,
  cloudService: "anthropic",
  cloudBaseUrl: "",        // nur für "custom"
  cloudModels: {},         // Dienst → Modell
  cloudKeys: {},           // Dienst → API-Schlüssel (nur in diesem Browser gespeichert)
  cloudVision: true,       // Bilder an OpenAI-kompatible Cloud-Dienste senden
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
export const saveSettings = () => setSetting("ai", JSON.parse(JSON.stringify(settings)));

export function hasProxy() { return proxyAvailable; }

export function defaultBaseUrl(api = settings.api) {
  if (proxyAvailable) return new URL(api === "ollama" ? "ki" : "ki/v1", location.href).href;
  return api === "ollama" ? "http://localhost:11434" : "http://localhost:1234/v1";
}
export function baseUrl() { return (settings.baseUrl || defaultBaseUrl()).replace(/\/+$/, ""); }

const service = () => CLOUD_SERVICES[settings.cloudService] || CLOUD_SERVICES.anthropic;
export const cloudModel = () => settings.cloudModels[settings.cloudService] ?? (service().model || "");
export const cloudKey = () => settings.cloudKeys[settings.cloudService] || "";

/** Die aktuell gewählte Verbindung. */
function conn() {
  if (settings.provider === "browser") return { kind: "browser", model: settings.browserModel };
  if (settings.provider === "cloud") {
    if (settings.cloudService === "anthropic") return { kind: "anthropic", model: cloudModel(), key: cloudKey() };
    const base = (settings.cloudService === "custom" ? settings.cloudBaseUrl : service().baseUrl || "").replace(/\/+$/, "");
    return { kind: "openai", base, model: cloudModel(), key: cloudKey(), cloud: true };
  }
  return { kind: settings.api, base: baseUrl(), model: settings.model };
}

export function isConfigured() {
  const c = conn();
  if (c.kind === "browser") return !!c.model;
  if (settings.provider === "cloud") return !!(c.key && c.model && (c.kind === "anthropic" || c.base));
  return !!c.model;
}

export function canSeeImages() {
  if (settings.provider === "cloud") return settings.cloudService === "anthropic" || settings.cloudVision;
  return settings.provider === "server" && settings.vision;
}

export function providerLabel() {
  if (settings.provider === "browser") return "im Browser";
  if (settings.provider === "cloud") return service().short;
  return settings.api === "ollama" ? "Ollama" : "Server";
}

export function modelLabel() {
  if (settings.provider === "browser") return BROWSER_MODELS.find(m => m.id === settings.browserModel)?.label || settings.browserModel;
  if (settings.provider === "cloud") return cloudModel() || "kein Modell gewählt";
  return settings.model || "kein Modell gewählt";
}

/** Das Modell der aktuellen Verbindung wechseln. */
export async function setModel(model) {
  if (settings.provider === "browser") settings.browserModel = model;
  else if (settings.provider === "cloud") settings.cloudModels[settings.cloudService] = model;
  else {
    settings.model = model;
    const v = await detectVision(model);
    if (v != null) settings.vision = v;
  }
  await saveSettings();
}

/** Ungefähre Zeichenmenge an Lernstoff, die in den Kontext des Modells passt. */
export function maxInputChars(imageCount, cardCount) {
  let ctx;
  if (settings.provider === "browser") ctx = BROWSER_MODELS.find(m => m.id === settings.browserModel)?.ctx || 4096;
  else if (settings.provider === "cloud") ctx = service().ctx;
  else ctx = settings.api === "ollama" ? settings.numCtx : 32768;
  const reserve = 900 + cardCount * 90 + imageCount * 1600; // Anweisungen, Antwort, Bilder
  const chars = Math.max(2000, Math.floor((ctx - reserve) * 3));
  return settings.provider === "cloud" ? Math.min(chars, CLOUD_MAX_CHARS) : chars;
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
  if (res.status === 401 || res.status === 403) msg = `Der API-Schlüssel wurde abgelehnt (${msg}).`;
  return new Error(msg);
}

function connectionError(e, c) {
  if (e.name === "AbortError") return e;
  if (c.cloud) return new Error(`Keine Verbindung zu ${c.base}. Prüfe die Internetverbindung. Manche Dienste erlauben keinen direkten Zugriff aus dem Browser.`);
  return new Error(`Der Modellserver unter ${c.base} ist nicht erreichbar. Läuft er, und ist CORS freigegeben? (Siehe Anleitung in den Einstellungen.)`);
}

function authHeaders(c) {
  const h = { "Content-Type": "application/json" };
  if (c.key) h.Authorization = "Bearer " + c.key;
  return h;
}

/* ---------- Claude (Anthropic-SDK) ---------- */
let sdkPromise = null;
const loadSdk = () => sdkPromise ||= import(ANTHROPIC_SDK_URL).then(m => m.default);

async function claudeClient(key) {
  const Anthropic = await loadSdk();
  // Der Schlüssel liegt nur in diesem Browser; die Anfragen gehen direkt an die Anthropic-API.
  return { Anthropic, client: new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }) };
}

function claudeError(e, Anthropic) {
  if (e instanceof Anthropic.APIUserAbortError) return new DOMException("Abgebrochen", "AbortError");
  if (e instanceof Anthropic.AuthenticationError) return new Error("Der Claude-API-Schlüssel wurde abgelehnt. Prüfe ihn in den Einstellungen.");
  if (e instanceof Anthropic.PermissionDeniedError) return new Error("Dieser API-Schlüssel darf das gewählte Modell nicht nutzen.");
  if (e instanceof Anthropic.NotFoundError) return new Error("Dieses Claude-Modell gibt es nicht. Wähle eins aus der Liste.");
  if (e instanceof Anthropic.RateLimitError) return new Error("Zu viele Anfragen an Claude. Warte kurz und versuch es noch einmal.");
  if (e instanceof Anthropic.BadRequestError) return new Error("Claude hat die Anfrage nicht angenommen: " + (e.error?.error?.message || e.message));
  if (e instanceof Anthropic.APIStatusError) return new Error(`Claude ist gerade nicht erreichbar (Fehler ${e.status}). Versuch es später noch einmal.`);
  if (e instanceof Anthropic.APIConnectionError) return new Error("Keine Verbindung zu Claude. Prüfe die Internetverbindung.");
  return e;
}

// Strukturierte Ausgaben verlangen additionalProperties: false an jedem Objekt
function strictSchema(s) {
  if (Array.isArray(s)) return s.map(strictSchema);
  if (!s || typeof s !== "object") return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) out[k] = strictSchema(v);
  if (s.type === "object") out.additionalProperties = false;
  return out;
}

async function claudeModels(key) {
  const { Anthropic, client } = await claudeClient(key);
  const ids = [];
  try {
    for await (const m of client.models.list()) {
      ids.push(m.id);
      if (m.max_tokens) claudeMaxTokens.set(m.id, m.max_tokens);
    }
  } catch (e) { throw claudeError(e, Anthropic); }
  return ids;
}

async function claudeGenerate({ c, prompt, context, images, schema, signal, push }) {
  const { Anthropic, client } = await claudeClient(c.key);
  if (!claudeMaxTokens.size) { try { await claudeModels(c.key); } catch (e) { /* ohne Liste weiter */ } }
  const content = [];
  for (const b of images) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobToBase64(b) } });
  // Der Lernstoff bleibt bei mehreren Durchgängen gleich und wird zwischengespeichert
  if (context) content.push({ type: "text", text: context, cache_control: { type: "ephemeral" } });
  content.push({ type: "text", text: prompt });
  const params = {
    model: c.model,
    max_tokens: Math.min(64000, claudeMaxTokens.get(c.model) || 32000),
    messages: [{ role: "user", content }],
  };
  if (schema) params.output_config = { format: { type: "json_schema", schema: strictSchema(schema) } };
  try {
    const stream = FALLBACK_MODELS.has(c.model)
      ? client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal })
      : client.messages.stream(params, { signal });
    stream.on("text", delta => push(delta));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("Claude hat die Anfrage abgelehnt. Formuliere das Thema anders oder nimm einen anderen Ausschnitt.");
    if (msg.stop_reason === "max_tokens" && schema) throw new Error("Die Antwort war zu lang und wurde abgeschnitten. Lass weniger Karten auf einmal erstellen.");
  } catch (e) { throw claudeError(e, Anthropic); }
}

/* ---------- Server und OpenAI-kompatible Dienste ---------- */

/** Verfügbare Modelle der aktuellen Verbindung. */
export async function listModels() {
  const c = conn();
  if (c.kind === "browser") return BROWSER_MODELS.map(m => m.id);
  if (c.kind === "anthropic") {
    if (!c.key) throw new Error("Bitte zuerst den API-Schlüssel eintragen.");
    return claudeModels(c.key);
  }
  if (c.cloud && !c.key) throw new Error("Bitte zuerst den API-Schlüssel eintragen.");
  let res;
  try { res = await fetch(c.base + (c.kind === "ollama" ? "/api/tags" : "/models"), { headers: c.key ? authHeaders(c) : {} }); }
  catch (e) { throw connectionError(e, c); }
  if (!res.ok) throw await errorFrom(res);
  const j = await res.json();
  const ids = c.kind === "ollama" ? (j.models || []).map(m => m.name) : (j.data || j.models || []).map(m => (m.id || m.name || "").replace(/^models\//, ""));
  return ids.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/** Ob ein Ollama-Modell Bilder versteht (null = unbekannt). */
export async function detectVision(model) {
  if (settings.provider !== "server" || settings.api !== "ollama") return null;
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
 * @param {string} o.prompt     die Aufgabe
 * @param {string} [o.context]  Lernstoff, der bei mehreren Durchgängen gleich bleibt (steht vor der Aufgabe)
 * @param {Blob[]} [o.images]   nur wenn canSeeImages()
 * @param {object} [o.schema]   JSON-Schema für strukturierte Antworten
 * @param {AbortSignal} [o.signal]
 * @param {(text:string)=>void} [o.onText]  ganzer bisheriger Text
 * @param {(msg:string, p:number)=>void} [o.onProgress]  Laden des Browser-Modells
 */
export async function generate({ prompt, context = "", images = [], schema, signal, onText, onProgress }) {
  let text = "";
  const push = delta => { if (!delta) return; text += delta; onText?.(text); };
  const c = conn();
  const full = context ? context + "\n\n" + prompt : prompt;

  if (c.kind === "anthropic") {
    await claudeGenerate({ c, prompt, context, images, schema, signal, push });
    return stripThinking(text);
  }

  if (c.kind === "browser") {
    const eng = await loadBrowserModel(onProgress);
    const req = { messages: [{ role: "user", content: full }], stream: true, temperature: 0.4 };
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

  if (c.kind === "ollama") {
    const msg = { role: "user", content: full };
    if (images.length) msg.images = await Promise.all(images.map(blobToBase64));
    const body = { model: c.model, messages: [msg], stream: true, options: { num_ctx: settings.numCtx, temperature: 0.4 } };
    if (schema) body.format = schema;
    let res;
    try { res = await fetch(c.base + "/api/chat", { method: "POST", body: JSON.stringify(body), signal }); }
    catch (e) { throw connectionError(e, c); }
    if (!res.ok) throw await errorFrom(res);
    await readStream(res, line => {
      const j = JSON.parse(line);
      if (j.error) throw new Error(j.error);
      push(j.message?.content);
    });
    return stripThinking(text);
  }

  // OpenAI-kompatibel (lokaler Server oder Cloud-Dienst)
  const content = images.length
    ? [{ type: "text", text: full }, ...(await Promise.all(images.map(async b => ({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + await blobToBase64(b) } }))))]
    : full;
  const body = { model: c.model, messages: [{ role: "user", content }], stream: true };
  if (!c.cloud) body.temperature = 0.4;
  if (schema) body.response_format = { type: "json_schema", json_schema: { name: "antwort", schema } };
  const send = b => fetch(c.base + "/chat/completions", { method: "POST", headers: authHeaders(c), body: JSON.stringify(b), signal });
  let res;
  try {
    res = await send(body);
    if (!res.ok && schema && res.status === 400) {
      body.response_format = c.cloud ? { type: "json_object" } : undefined;
      res = await send(body);
      if (!res.ok && res.status === 400 && body.response_format) { delete body.response_format; res = await send(body); }
    }
  } catch (e) { throw connectionError(e, c); }
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
