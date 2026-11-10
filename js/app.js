import * as store from "./store.js";
import * as ai from "./ai.js";
import { parseCards, deckToText, FORMAT_EXAMPLE, CHAT_PROMPT } from "./textformat.js";
import { docs, DOC_ACCEPT, importFiles, removeDoc, loadImage, imageSource, scaleCanvas, cropCanvas, toBlob } from "./docs.js";

const COLORS = ["#d9534f", "#2847b8", "#2f8a4f", "#c07a12", "#7a3fb0", "#14879a"];
const INTERVALS = [0, 0, 1, 3, 7, 16, 35]; // Tage je Fach (Fach 1–6)
const DAY = 86400000;
const MAX_IMAGES_TO_MODEL = 6;
const $app = document.getElementById("app");
const $layer = document.getElementById("layer");
const $layer2 = document.getElementById("layer2");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ---------- Stapel speichern ---------- */
let decks = [];

async function saveDeck(deck) {
  deck.updatedAt = Date.now();
  const i = decks.findIndex(d => d.id === deck.id);
  if (i >= 0) decks[i] = deck; else decks.push(deck);
  try { await store.putDeck(JSON.parse(JSON.stringify(deck))); }
  catch (e) { toast("Nicht gespeichert: " + (e.message || e)); }
}
async function removeDeck(id) {
  deckById(id)?.cards.forEach(c => { dropImg(c.frontImg); dropImg(c.backImg); });
  decks = decks.filter(d => d.id !== id);
  try { await store.deleteDeck(id); } catch (e) { toast("Löschen fehlgeschlagen"); }
}

/* ---------- Bilder auf Karten (als Blob in IndexedDB, Verweis "img:<id>") ---------- */
const urlCache = new Map();
const imgTag = (ref, alt = "") => ref ? `<img data-img="${esc(ref.slice(4))}" alt="${esc(alt)}">` : "";

async function imageUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await store.getImage(id);
  const url = blob ? URL.createObjectURL(blob) : "";
  urlCache.set(id, url);
  return url;
}
function hydrate(root = document) {
  root.querySelectorAll("img[data-img]:not([src])").forEach(async img => {
    const url = await imageUrl(img.dataset.img);
    if (url) img.src = url; else img.alt = "Bild fehlt";
  });
}
async function storeImage(canvas) {
  const id = uid();
  await store.putImage(id, await toBlob(scaleCanvas(canvas, 1400)));
  return "img:" + id;
}
function dropImg(ref) {
  if (!ref) return;
  const id = ref.slice(4);
  store.deleteImage(id).catch(() => {});
  const url = urlCache.get(id);
  if (url) { URL.revokeObjectURL(url); urlCache.delete(id); }
}

function exampleDeck() {
  const now = Date.now();
  const cards = [
    ["Was ist die Hauptstadt von Australien?", "Canberra"],
    ["Wie lautet die Formel für die Kreisfläche?", "A = π · r²"],
    ["Was bedeutet „ephemer“?", "Kurzlebig, nur vorübergehend bestehend."],
    ["In welchem Jahr fiel die Berliner Mauer?", "1989 (9. November)"],
    ["Was ist Photosynthese in einem Satz?", "Pflanzen bauen mit Lichtenergie aus CO₂ und Wasser Zucker auf und geben dabei Sauerstoff ab."],
    ["Englisch: „nachhaltig“", "sustainable"],
  ].map(([front, back]) => ({ id: uid(), front, back, box: 1, due: now }));
  return { id: uid(), name: "Beispiel: Allgemeinwissen", color: COLORS[1], cards, createdAt: now, updatedAt: now };
}

/* ---------- Zustand der Oberfläche ---------- */
let view = { name: "home" };
let session = null;

const deckById = id => decks.find(d => d.id === id);
const dueCards = deck => { const now = Date.now(); return deck.cards.filter(c => (c.due ?? 0) <= now); };

function render() {
  if (view.name === "deck" && !deckById(view.id)) view = { name: "home" };
  if (view.name === "home") renderHome();
  else if (view.name === "deck") renderDeck(deckById(view.id));
  else if (view.name === "study") renderStudy();
  hydrate($app);
}

function aiStatus() {
  const ok = ai.isConfigured();
  return `<button class="ghost sm status" data-act="settings" title="KI-Einstellungen"><i class="${ok ? "ok" : "warn"}"></i>${ok ? `KI: ${esc(ai.modelLabel())} (${esc(ai.providerLabel())})` : "KI einrichten"}</button>`;
}

function renderHome() {
  const totalDue = decks.reduce((n, d) => n + dueCards(d).length, 0);
  $app.innerHTML = `
    <header class="top">
      <div class="title">
        <h1>Karteikasten</h1>
        <span class="row" style="gap:4px">${aiStatus()}</span>
      </div>
      <button class="primary" data-act="gen">✦ Mit KI erstellen</button>
      <button class="icon" data-act="menu" aria-label="Daten und Einstellungen">⋯</button>
    </header>
    ${decks.length ? `
      <p class="muted" style="margin-bottom:18px">${totalDue ? `Heute fällig: <strong>${totalDue}</strong> ${totalDue === 1 ? "Karte" : "Karten"}` : "Für heute ist alles gelernt."}</p>
      <div class="decks">
        ${decks.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(d => {
          const due = dueCards(d).length;
          return `<div class="deckcell"><button class="deck" data-act="open" data-id="${d.id}" style="--deckc:${esc(d.color)}">
            <span class="bar"></span>
            <h3>${esc(d.name)}</h3>
            <span class="stats">
              <span class="chip">${d.cards.length} ${d.cards.length === 1 ? "Karte" : "Karten"}</span>
              ${due ? `<span class="chip due">${due} fällig</span>` : ""}
            </span>
          </button></div>`;
        }).join("")}
        <div class="deckcell"><button class="deck new" data-act="newdeck">+ Neuer Stapel</button></div>
      </div>` : `
      <div class="empty">
        <h2>Noch keine Stapel</h2>
        <p class="muted">Lege einen Stapel an und schreibe Karten selbst, oder lass dein lokales KI-Modell Karten aus einem Thema, einem PDF, einem Word-Dokument oder Fotos deiner Notizen erstellen.</p>
        <div class="row" style="justify-content:center">
          <button class="primary" data-act="gen">✦ Mit KI erstellen</button>
          <button data-act="newdeck">Stapel anlegen</button>
          <button data-act="import">Karten importieren</button>
          <button class="ghost" data-act="example">Beispielstapel laden</button>
        </div>
      </div>`}
  `;
}

const boxes = n => `<span class="boxes" title="Fach ${n} von 6">${[1, 2, 3, 4, 5, 6].map(i => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;

function renderDeck(deck) {
  const due = dueCards(deck).length;
  $app.innerHTML = `
    <header class="top">
      <button class="icon" data-act="home" aria-label="Zurück">←</button>
      <div class="title">
        <h1 style="font-size:1.7rem">${esc(deck.name)}</h1>
        <span class="sync">${deck.cards.length} Karten · ${due} fällig</span>
      </div>
      <button class="icon" data-act="editdeck" aria-label="Stapel bearbeiten">⋯</button>
    </header>
    <div class="hero-actions">
      <button class="primary" data-act="study" ${deck.cards.length ? "" : "disabled"}>${due ? `${due} fällige lernen` : "Alle wiederholen"}</button>
      ${due && due < deck.cards.length ? `<button data-act="studyall">Alle ${deck.cards.length} üben</button>` : ""}
      <button data-act="addcard">+ Karte</button>
      <button data-act="import" data-id="${deck.id}">Importieren</button>
      <button data-act="gen" data-id="${deck.id}">✦ Karten mit KI</button>
    </div>
    ${deck.cards.length ? `<div class="cardlist">
      ${deck.cards.map(c => `<button class="mini" data-act="editcard" data-cid="${c.id}">
        <span class="row" style="justify-content:space-between"><span class="label">Vorderseite</span>${boxes(c.box || 1)}</span>
        ${imgTag(c.frontImg)}
        <span class="q">${esc(c.front)}</span>
        <span class="a">${imgTag(c.backImg)}${esc(c.back)}</span>
      </button>`).join("")}
    </div>` : `<div class="empty"><p class="muted">Dieser Stapel ist noch leer. Füge eine Karte hinzu oder lass die KI welche aus einem Dokument erstellen.</p></div>`}
  `;
}

/* ---------- Lernen (Leitner-System mit 6 Fächern) ---------- */
function startStudy(deck, all) {
  const pool = all ? deck.cards.slice() : dueCards(deck);
  const queue = pool.sort(() => Math.random() - 0.5).map(c => c.id);
  session = { deckId: deck.id, queue, total: queue.length, done: 0, flipped: false, stats: { 1: 0, 2: 0, 3: 0, 4: 0 }, explain: null };
  view = { name: "study" };
  render();
}

function nextDueLabel(box) {
  const d = INTERVALS[Math.min(box, 6)];
  return d === 0 ? "gleich" : d === 1 ? "morgen" : `in ${d} Tagen`;
}

function renderStudy() {
  const deck = deckById(session.deckId);
  if (!deck) { view = { name: "home" }; return render(); }
  const card = deck.cards.find(c => c.id === session.queue[0]);
  const pct = session.total ? Math.round(session.done / session.total * 100) : 100;
  if (!card) {
    const s = session.stats;
    $app.innerHTML = `
      <header class="top"><button class="icon" data-act="back" aria-label="Zurück">←</button><div class="title"><h2>${esc(deck.name)}</h2></div></header>
      <div class="done">
        <span class="label">Runde geschafft</span>
        <span class="big">${session.total}</span>
        <p class="muted">${session.total === 1 ? "Karte" : "Karten"} gelernt · ${s[1]}× nochmal · ${s[2]}× schwer · ${s[3]}× gut · ${s[4]}× leicht</p>
        <div class="row" style="justify-content:center"><button class="primary" data-act="back">Zum Stapel</button><button data-act="home">Alle Stapel</button></div>
      </div>`;
    return;
  }
  const b = card.box || 1;
  $app.innerHTML = `
    <header class="top">
      <button class="icon" data-act="back" aria-label="Lernen beenden">✕</button>
      <div class="title"><h3>${esc(deck.name)}</h3><span class="sync">Karte ${session.done + 1} von ${session.total} · Fach ${b}</span></div>
    </header>
    <div class="study">
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="flip ${session.flipped ? "on" : ""}" data-act="flip" role="button" tabindex="0" aria-label="Karte umdrehen">
        <div class="flip-inner">
          <div class="face card front"><span class="side">Frage</span><div class="txt">${imgTag(card.frontImg, "Bild zur Frage")}${card.front ? `<span>${esc(card.front)}</span>` : ""}</div><span class="hint">Tippen zum Umdrehen · Leertaste</span></div>
          <div class="face card back"><span class="side">Antwort</span><div class="txt">${imgTag(card.backImg, "Bild zur Antwort")}${card.back ? `<span>${esc(card.back)}</span>` : ""}</div><span class="hint">Wie gut wusstest du es?</span></div>
        </div>
      </div>
      ${session.flipped ? `
        <div class="rate">
          <button class="r1" data-act="rate" data-r="1">Nochmal<small>gleich</small></button>
          <button class="r2" data-act="rate" data-r="2">Schwer<small>${nextDueLabel(Math.max(2, b))}</small></button>
          <button class="r3" data-act="rate" data-r="3">Gut<small>${nextDueLabel(Math.min(6, b + 1))}</small></button>
          <button class="r4" data-act="rate" data-r="4">Leicht<small>${nextDueLabel(Math.min(6, b + 2))}</small></button>
        </div>
        ${ai.isConfigured() ? (session.explain != null
          ? `<div class="explain" id="explain">${session.explain ? esc(session.explain) : `<span class="thinking"><span class="dot"></span>Das Modell denkt nach…</span>`}</div>`
          : `<button class="ghost" data-act="explain">✦ Von der KI erklären lassen</button>`) : ""}
      ` : `<button class="primary" data-act="flip" style="min-width:220px">Antwort zeigen</button>`}
    </div>`;
}

function rate(r) {
  const deck = deckById(session.deckId);
  const card = deck.cards.find(c => c.id === session.queue[0]);
  const b = card.box || 1;
  const nb = r === 1 ? 1 : r === 2 ? Math.max(2, b) : r === 3 ? Math.min(6, b + 1) : Math.min(6, b + 2);
  card.box = nb;
  card.due = r === 1 ? Date.now() : Date.now() + INTERVALS[nb] * DAY;
  session.stats[r]++;
  session.queue.shift();
  if (r === 1) session.queue.push(card.id); else session.done++;
  session.flipped = false;
  session.explain = null;
  explainCtl?.abort();
  render();
  saveDeck(deck);
}

let explainCtl = null;
async function explain() {
  const deck = deckById(session.deckId);
  const card = deck.cards.find(c => c.id === session.queue[0]);
  session.explain = "";
  render();
  explainCtl = new AbortController();
  const cardId = card.id;
  const show = text => {
    if (session?.queue[0] !== cardId) return;
    session.explain = text;
    const el = document.getElementById("explain");
    if (el) el.textContent = text;
  };
  const note = card.frontImg || card.backImg ? "\n(Die Karte enthält zusätzlich ein Bild, das du nicht siehst.)" : "";
  const prompt = `Du hilfst beim Lernen mit Karteikarten. Erkläre die Antwort auf diese Karte kurz und verständlich (3–5 Sätze), gib eine Eselsbrücke, wenn eine passt. Antworte in der Sprache der Karte, ohne Überschriften und ohne Markdown.\n\nFrage: ${card.front || "(nur Bild)"}\nAntwort: ${card.back || "(nur Bild)"}${note}`;
  try {
    const text = await ai.generate({
      prompt, signal: explainCtl.signal,
      onText: t => show(ai.stripThinking(t) || "…"),
      onProgress: (msg, p) => show(`Modell wird geladen: ${Math.round((p || 0) * 100)} %`),
    });
    show(text);
  } catch (e) {
    if (e.name === "AbortError") return;
    show(e.message || String(e));
  }
}

/* ---------- Sheets ---------- */
function openSheet(html, onMount, cls = "") {
  $layer.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
  const sh = $layer.querySelector(".sheet");
  onMount?.(sh);
  hydrate(sh);
  const first = sh.querySelector("input:not([type=file]):not([type=checkbox]), textarea");
  if (first && matchMedia("(pointer: fine)").matches) setTimeout(() => first.focus(), 50);
}
function closeSheet() { genCtl?.abort(); $layer.innerHTML = ""; $layer2.innerHTML = ""; }

function deckSheet(deck) {
  const isNew = !deck;
  let color = deck?.color || COLORS[decks.length % COLORS.length];
  openSheet(`
    <div class="sheet-head"><h2>${isNew ? "Neuer Stapel" : "Stapel bearbeiten"}</h2><button class="icon" data-act="close" aria-label="Schließen">✕</button></div>
    <div class="field"><label class="label" for="deckname">Name</label><input id="deckname" value="${esc(deck?.name || "")}" placeholder="z. B. Biologie – Zellaufbau"></div>
    <div class="field"><span class="label">Farbe</span><div class="swatches">${COLORS.map(c => `<button class="swatch ${c === color ? "on" : ""}" data-c="${c}" style="background:${c}" aria-label="Farbe ${c}"></button>`).join("")}</div></div>
    ${!isNew && deck.cards.length ? `<div class="field"><span class="label">Als Text</span>
      <div class="row"><button class="sm" id="dtcopy">Karten als Text kopieren</button><button class="sm" id="dtsave">Als .txt-Datei speichern</button><span class="small muted" id="dtmsg"></span></div>
      <textarea id="dtfallback" rows="6" hidden readonly></textarea>
    </div>` : ""}
    <div class="row">${!isNew ? `<button class="danger" id="deldeck">Stapel löschen</button>` : ""}<span class="spacer"></span><button class="primary" id="savedeck">${isNew ? "Anlegen" : "Speichern"}</button></div>
    <p class="small" id="delconfirm" hidden><button class="danger" id="delyes">Ja, Stapel mit allen Karten löschen</button></p>
  `, sh => {
    sh.querySelectorAll(".swatch").forEach(s => s.onclick = () => { color = s.dataset.c; sh.querySelectorAll(".swatch").forEach(x => x.classList.toggle("on", x === s)); });
    sh.querySelector("#savedeck").onclick = () => {
      const name = sh.querySelector("#deckname").value.trim();
      if (!name) { sh.querySelector("#deckname").focus(); return; }
      const d = deck || { id: uid(), cards: [], createdAt: Date.now() };
      d.name = name; d.color = color;
      saveDeck(d); closeSheet(); view = { name: "deck", id: d.id }; render();
    };
    if (!isNew && deck.cards.length) {
      sh.querySelector("#dtcopy").onclick = async () => {
        const ok = await copyText(deckToText(deck), sh.querySelector("#dtfallback"));
        sh.querySelector("#dtmsg").textContent = ok ? "Kopiert." : "Text unten markiert, bitte selbst kopieren.";
      };
      sh.querySelector("#dtsave").onclick = () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([deckToText(deck)], { type: "text/plain;charset=utf-8" }));
        a.download = deck.name.replace(/[\\/:*?"<>|]+/g, "-") + ".txt";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      };
    }
    if (!isNew) {
      sh.querySelector("#deldeck").onclick = () => { sh.querySelector("#delconfirm").hidden = false; };
      sh.querySelector("#delyes").onclick = () => { removeDeck(deck.id); closeSheet(); view = { name: "home" }; render(); toast("Stapel gelöscht"); };
    }
  });
}

/* Karte manuell anlegen/bearbeiten – jede Seite kann ein Bild haben */
function cardSheet(deck, card) {
  const isNew = !card;
  // je Seite: { ref } = gespeichertes Bild, { canvas } = neu gewählt, null = kein Bild
  const pics = { front: card?.frontImg ? { ref: card.frontImg } : null, back: card?.backImg ? { ref: card.backImg } : null };
  const picPreview = p => !p ? "" : p.canvas ? `<img src="${scaleCanvas(p.canvas, 400).toDataURL("image/jpeg", 0.8)}" alt="">` : imgTag(p.ref);
  const sideCtl = side => `
    <div class="sideimg">
      ${picPreview(pics[side])}
      <label class="btn sm">📷 Foto/Bild<input type="file" accept="image/*" data-picfile="${side}"></label>
      <button class="sm" data-picdoc="${side}">📄 Aus Dokument</button>
      ${pics[side] ? `<button class="sm ghost danger" data-picrm="${side}">Bild entfernen</button>` : ""}
    </div>`;
  openSheet(`
    <div class="sheet-head"><h2>${isNew ? "Neue Karte" : "Karte bearbeiten"}</h2><button class="icon" data-act="close" aria-label="Schließen">✕</button></div>
    <div class="field"><label class="label" for="cfront">Vorderseite (Frage)</label><textarea id="cfront" rows="3">${esc(card?.front || "")}</textarea><div id="ctl-front"></div></div>
    <div class="field"><label class="label" for="cback">Rückseite (Antwort)</label><textarea id="cback" rows="4">${esc(card?.back || "")}</textarea><div id="ctl-back"></div></div>
    <p class="small" id="cardmsg" hidden></p>
    <div class="row">
      ${!isNew ? `<button class="danger" id="delcard">Löschen</button><button id="resetcard">Zurück in Fach 1</button>` : ""}
      <span class="spacer"></span>
      ${isNew ? `<button id="saveadd">Speichern & nächste</button>` : ""}
      <button class="primary" id="savecard">Speichern</button>
    </div>
  `, sh => {
    const drawCtl = side => { const el = sh.querySelector("#ctl-" + side); el.innerHTML = sideCtl(side); hydrate(el); };
    drawCtl("front"); drawCtl("back");
    sh.addEventListener("change", async e => {
      const side = e.target.dataset?.picfile;
      if (!side || !e.target.files[0]) return;
      try {
        const im = await loadImage(URL.createObjectURL(e.target.files[0]));
        pics[side] = { canvas: await imageSource(im, "").render(1600) };
        drawCtl(side);
      } catch (err) { toast(err.message); }
    });
    sh.addEventListener("click", e => {
      const d = e.target.closest("[data-picdoc]"), r = e.target.closest("[data-picrm]");
      if (d) docPicker(canvas => { pics[d.dataset.picdoc] = { canvas }; drawCtl(d.dataset.picdoc); });
      if (r) { pics[r.dataset.picrm] = null; drawCtl(r.dataset.picrm); }
    });
    const $msg = sh.querySelector("#cardmsg");
    const save = async again => {
      const front = sh.querySelector("#cfront").value.trim(), back = sh.querySelector("#cback").value.trim();
      if (!front && !pics.front) { sh.querySelector("#cfront").focus(); return; }
      if (!back && !pics.back) { sh.querySelector("#cback").focus(); return; }
      sh.querySelectorAll("button").forEach(b => b.disabled = true);
      $msg.hidden = false; $msg.textContent = "Wird gespeichert…";
      const refs = {};
      for (const side of ["front", "back"]) {
        const old = card?.[side + "Img"] || null;
        const p = pics[side];
        refs[side] = p ? (p.canvas ? await storeImage(p.canvas) : p.ref) : null;
        if (old && old !== refs[side]) dropImg(old);
      }
      const target = card || { id: uid(), box: 1, due: Date.now() };
      Object.assign(target, { front, back, frontImg: refs.front, backImg: refs.back });
      if (!refs.front) delete target.frontImg;
      if (!refs.back) delete target.backImg;
      if (isNew) deck.cards.push(target);
      await saveDeck(deck); render();
      if (again) {
        sh.querySelectorAll("button").forEach(b => b.disabled = false);
        $msg.hidden = true;
        sh.querySelector("#cfront").value = ""; sh.querySelector("#cback").value = "";
        pics.front = pics.back = null; drawCtl("front"); drawCtl("back");
        sh.querySelector("#cfront").focus(); toast("Karte gespeichert");
      } else closeSheet();
    };
    sh.querySelector("#savecard").onclick = () => save(false);
    if (isNew) sh.querySelector("#saveadd").onclick = () => save(true);
    else {
      sh.querySelector("#delcard").onclick = () => { dropImg(card.frontImg); dropImg(card.backImg); deck.cards = deck.cards.filter(c => c.id !== card.id); saveDeck(deck); closeSheet(); render(); toast("Karte gelöscht"); };
      sh.querySelector("#resetcard").onclick = () => { card.box = 1; card.due = Date.now(); saveDeck(deck); closeSheet(); render(); };
    }
  });
}

/* ---------- Zweite Ebene: Bild aus Dokument wählen und zuschneiden ---------- */
function openLayer2(html) {
  $layer2.innerHTML = `<div class="scrim top2" data-act="scrim2"><div class="sheet wide" role="dialog" aria-modal="true">${html}</div></div>`;
  return $layer2.querySelector(".sheet");
}
const closeLayer2 = () => { $layer2.innerHTML = ""; };

function docPicker(onPick) {
  const list = () => {
    const withSources = docs.filter(d => d.sources.length);
    const sh = openLayer2(`
      <div class="sheet-head"><h2>Bild aus Dokument</h2><button class="icon" data-close2 aria-label="Schließen">✕</button></div>
      <div class="row"><label class="btn">📄 Dokument importieren<input type="file" accept="${DOC_ACCEPT}" multiple id="pickfile"></label><span class="small muted" id="pickstatus"></span></div>
      ${withSources.length ? withSources.map(d => `
        <div class="field"><span class="label">${esc(d.name)}</span>
          <div class="thumbs">${d.sources.map((s, i) => `<button class="thumb ${s.figure && d.kind === "PDF" ? "fig" : ""}" data-doc="${d.id}" data-src="${i}"><span class="ph" data-thumb="${d.id}:${i}"><span class="dot"></span></span>${esc(s.label)}</button>`).join("")}</div>
        </div>`).join("")
      : `<p class="muted">Importiere ein PDF, ein Word-Dokument oder ein Foto. Danach kannst du eine Seite oder Abbildung antippen und den passenden Ausschnitt wählen.</p>`}
      ${docs.some(d => d.kind === "PDF") ? `<p class="small muted">Blau umrandete Seiten enthalten Abbildungen.</p>` : ""}
    `);
    sh.querySelector("[data-close2]").onclick = closeLayer2;
    sh.querySelector("#pickfile").onchange = async e => {
      const st = sh.querySelector("#pickstatus");
      const errors = await importFiles([...e.target.files], s => { st.textContent = s; });
      if (errors.length) toast(errors[0]);
      list();
    };
    sh.querySelectorAll("[data-src]").forEach(b => b.onclick = () => {
      const src = docs.find(d => d.id === b.dataset.doc).sources[+b.dataset.src];
      cropView(src, null, onPick, list);
    });
    (async () => { // Vorschaubilder nacheinander erzeugen
      for (const ph of sh.querySelectorAll("[data-thumb]")) {
        if (!ph.isConnected) return;
        const [did, i] = ph.dataset.thumb.split(":");
        const src = docs.find(d => d.id === did)?.sources[+i];
        if (!src) continue;
        try { src.thumb ||= (await src.render(240)).toDataURL("image/jpeg", 0.7); ph.innerHTML = `<img src="${src.thumb}" alt="">`; }
        catch (e) { ph.textContent = "–"; }
      }
    })();
  };
  list();
}

/** Zuschneide-Ansicht. onPick(canvas, box) bekommt den Ausschnitt in hoher Auflösung. */
async function cropView(src, initialBox, onPick, onBack) {
  const sh = openLayer2(`
    <div class="sheet-head">${onBack ? `<button class="icon" data-back2 aria-label="Zurück">←</button>` : ""}<h2>${esc(src.label)}</h2><button class="icon" data-close2 aria-label="Schließen">✕</button></div>
    <p class="small muted">Ziehe mit dem Finger einen Rahmen um den Bereich, der auf die Karte soll.</p>
    <div class="crop" id="croparea"><span class="thinking" style="line-height:1.5"><span class="dot"></span>Wird geladen…</span></div>
    <div class="row"><button id="cropall">Ganzes Bild</button><span class="spacer"></span><button class="primary" id="cropok" ${initialBox ? "" : "disabled"}>Ausschnitt übernehmen</button></div>
  `);
  sh.querySelector("[data-close2]").onclick = closeLayer2;
  if (onBack) sh.querySelector("[data-back2]").onclick = onBack;
  const canvas = await src.render(1800);
  if (!sh.isConnected) return;
  const area = sh.querySelector("#croparea");
  area.innerHTML = "";
  area.appendChild(canvas);
  const sel = document.createElement("div");
  sel.className = "sel"; sel.hidden = true;
  area.appendChild(sel);
  let box = initialBox ? initialBox.slice() : null, start = null;
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const draw = () => {
    if (!box) { sel.hidden = true; return; }
    sel.hidden = false;
    Object.assign(sel.style, {
      left: box[0] * canvas.offsetWidth + "px", top: box[1] * canvas.offsetHeight + "px",
      width: (box[2] - box[0]) * canvas.offsetWidth + "px", height: (box[3] - box[1]) * canvas.offsetHeight + "px",
    });
  };
  requestAnimationFrame(draw);
  area.onpointerdown = e => { start = pos(e); area.setPointerCapture(e.pointerId); box = null; draw(); };
  area.onpointermove = e => {
    if (!start) return;
    const p = pos(e);
    box = [Math.min(start[0], p[0]), Math.min(start[1], p[1]), Math.max(start[0], p[0]), Math.max(start[1], p[1])];
    draw();
  };
  area.onpointerup = () => {
    start = null;
    if (box && (box[2] - box[0] < 0.02 || box[3] - box[1] < 0.02)) box = null;
    draw();
    sh.querySelector("#cropok").disabled = !box;
  };
  const finish = b => { onPick(cropCanvas(canvas, b), b); closeLayer2(); };
  sh.querySelector("#cropall").onclick = () => finish([0, 0, 1, 1]);
  sh.querySelector("#cropok").onclick = () => box && finish(box);
}

/* ---------- KI-Einstellungen ---------- */
function settingsSheet(then) {
  const s = ai.settings;
  const customBrowserModel = !ai.BROWSER_MODELS.some(m => m.id === s.browserModel);
  openSheet(`
    <div class="sheet-head"><h2>KI-Modell</h2><button class="icon" data-act="close" aria-label="Schließen">✕</button></div>
    <p class="small muted">Mit einem lokalen Modell bleiben deine Dokumente auf deinem Gerät bzw. in deinem Heimnetz. Mit einer Cloud-KI wie Claude werden sie an den Anbieter geschickt.</p>
    <div class="field"><span class="label">Wo läuft das Modell?</span>
      <div class="seg" id="sprov">
        <button data-p="server" class="${s.provider === "server" ? "on" : ""}">Auf einem Rechner (Ollama, LM Studio)</button>
        <button data-p="browser" class="${s.provider === "browser" ? "on" : ""}">Direkt im Browser (WebGPU)</button>
        <button data-p="cloud" class="${s.provider === "cloud" ? "on" : ""}">Cloud-KI (Claude, OpenAI, Gemini …)</button>
      </div>
    </div>

    <div id="pserver" ${s.provider === "server" ? "" : "hidden"} style="display:grid;gap:14px">
      <div class="row">
        <div class="field" style="flex:1 1 200px"><label class="label" for="sapi">Schnittstelle</label>
          <select id="sapi"><option value="ollama" ${s.api === "ollama" ? "selected" : ""}>Ollama</option><option value="openai" ${s.api === "openai" ? "selected" : ""}>OpenAI-kompatibel (LM Studio, llama.cpp, Jan …)</option></select>
        </div>
        <div class="field" style="flex:2 1 280px"><label class="label" for="surl">Adresse</label>
          <input id="surl" value="${esc(s.baseUrl)}" placeholder="${esc(ai.defaultBaseUrl())}" autocapitalize="off" autocorrect="off" spellcheck="false">
        </div>
      </div>
      ${ai.hasProxy() ? `<p class="small muted">Die App läuft über <code>server.py</code>. Leer lassen, dann geht die Verbindung automatisch über diesen Rechner.</p>` : ""}
      <div class="row"><button id="stest">Verbinden & Modelle laden</button><span class="small muted" id="stestmsg"></span></div>
      <div class="row">
        <div class="field" style="flex:2 1 260px"><label class="label" for="smodel">Modell</label>
          <input id="smodel" list="smodels" value="${esc(s.model)}" placeholder="z. B. gemma3:4b" autocapitalize="off" autocorrect="off" spellcheck="false"><datalist id="smodels"></datalist>
        </div>
        <div class="field" id="sctxwrap" style="flex:1 1 160px" ${s.api === "ollama" ? "" : "hidden"}><label class="label" for="sctx">Kontextlänge</label>
          <select id="sctx">${[4096, 8192, 16384, 32768, 65536].map(n => `<option value="${n}" ${n === s.numCtx ? "selected" : ""}>${n.toLocaleString("de-DE")} Tokens</option>`).join("")}</select>
        </div>
      </div>
      <label class="check small"><input type="checkbox" id="svision" ${s.vision ? "checked" : ""}> Das Modell kann Bilder sehen (Vision-Modell wie gemma3, qwen2.5vl, llava). Dann werden Seiten mit Abbildungen mitgeschickt.</label>
      <div class="note warn" id="smixed" hidden>Diese Seite läuft über https, der Modellserver aber über http im Netzwerk. Das blockiert der Browser. Starte die App stattdessen mit <code>server.py</code> auf dem Rechner mit dem Modell und öffne die dort angezeigte Adresse.</div>
      <details class="note"><summary>Anleitung: Ollama einrichten</summary>
        <span>1. Ollama installieren (ollama.com) und ein Modell laden, z. B. <code>ollama pull gemma3:4b</code> (sieht auch Bilder) oder <code>ollama pull qwen2.5:7b</code>.</span>
        <span>2. Am einfachsten: im Ordner der App <code>python3 server.py</code> starten und auf dem iPad die angezeigte Adresse öffnen. Dann ist sonst nichts einzustellen.</span>
        <span>3. Ohne server.py muss Ollama Anfragen von der App erlauben: <code>OLLAMA_ORIGINS=*</code> setzen, für Zugriff vom iPad zusätzlich <code>OLLAMA_HOST=0.0.0.0</code>, und als Adresse <code>http://IP-des-Rechners:11434</code> eintragen.</span>
      </details>
    </div>

    <div id="pbrowser" ${s.provider === "browser" ? "" : "hidden"} style="display:grid;gap:14px">
      ${ai.browserSupported() ? "" : `<div class="note warn">Dieser Browser unterstützt kein WebGPU. Auf dem iPad geht das ab iPadOS 26 in Safari, am Rechner in aktuellem Chrome oder Edge.</div>`}
      <div class="field"><label class="label" for="sbmodel">Modell</label>
        <select id="sbmodel">${ai.BROWSER_MODELS.map(m => `<option value="${m.id}" ${m.id === s.browserModel ? "selected" : ""}>${esc(m.label)} · Download ${esc(m.size)}</option>`).join("")}<option value="__custom" ${customBrowserModel ? "selected" : ""}>Anderes Modell (ID eingeben)…</option></select>
      </div>
      <div class="field" id="sbcustomwrap" ${customBrowserModel ? "" : "hidden"}><label class="label" for="sbcustom">Modell-ID aus WebLLM</label>
        <input id="sbcustom" value="${customBrowserModel ? esc(s.browserModel) : ""}" placeholder="z. B. Qwen2.5-7B-Instruct-q4f16_1-MLC" autocapitalize="off" autocorrect="off" spellcheck="false">
        <span class="small muted">Alle Modelle mit „-MLC“ am Ende aus der WebLLM-Modellliste (github.com/mlc-ai/web-llm). Größere Modelle brauchen mehr Speicher, als viele iPads haben.</span>
      </div>
      <p class="small muted">Das Modell wird beim ersten Mal aus dem Internet geladen und danach im Browser gespeichert. Es läuft dann offline auf deinem Gerät. Kleine Modelle sind langsamer und ungenauer als Modelle auf einem Rechner, sehen keine Bilder und können nur kürzere Dokumente verarbeiten (etwa 5 Seiten Text).</p>
      <div class="row"><button id="sbload">Modell jetzt laden</button><span class="small muted" id="sbmsg">${ai.browserModelLoaded() ? "Geladen." : ""}</span></div>
      <div class="bar-progress" id="sbbar" hidden><div></div></div>
    </div>

    <div id="pcloud" ${s.provider === "cloud" ? "" : "hidden"} style="display:grid;gap:14px">
      <div class="note small">Die Karten erstellt dann ein Cloud-Dienst. Deine Dokumente, Bilder und Hinweise werden dafür an den gewählten Anbieter geschickt, und die Nutzung wird über dein Konto dort abgerechnet. Der API-Schlüssel wird nur in diesem Browser gespeichert.</div>
      <div class="field"><label class="label" for="ccsvc">Anbieter</label>
        <select id="ccsvc">${Object.entries(ai.CLOUD_SERVICES).map(([k, v]) => `<option value="${k}" ${k === s.cloudService ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select>
      </div>
      <div class="field" id="ccurlwrap" hidden><label class="label" for="ccurl">Adresse der API</label>
        <input id="ccurl" value="${esc(s.cloudBaseUrl)}" placeholder="https://…/v1" autocapitalize="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="field"><label class="label" for="cckey">API-Schlüssel</label>
        <input id="cckey" type="password" value="${esc(s.cloudKeys[s.cloudService] || "")}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
        <span class="small muted" id="cckeyhint"></span>
      </div>
      <div class="row"><button id="cctest">Verbinden & Modelle laden</button><span class="small muted" id="cctestmsg"></span></div>
      <div class="field"><label class="label" for="ccmodel">Modell</label>
        <input id="ccmodel" list="ccmodels" value="${esc(s.cloudModels[s.cloudService] ?? (ai.CLOUD_SERVICES[s.cloudService]?.model || ""))}" autocapitalize="off" autocorrect="off" spellcheck="false"><datalist id="ccmodels"></datalist>
      </div>
      <label class="check small" id="ccvisionrow"><input type="checkbox" id="ccvision" ${s.cloudVision ? "checked" : ""}> Das Modell kann Bilder sehen. Dann werden Seiten mit Abbildungen mitgeschickt.</label>
    </div>

    <div class="row"><span class="spacer"></span><button class="primary" id="ssave">Speichern</button></div>
  `, sh => {
    let provider = s.provider;
    const q = id => sh.querySelector(id);
    let svc = s.cloudService;
    const read = () => ({
      cloudService: svc, cloudBaseUrl: q("#ccurl").value.trim(), cloudVision: q("#ccvision").checked,
      cloudKeys: { ...s.cloudKeys, [svc]: q("#cckey").value.trim() },
      cloudModels: { ...s.cloudModels, [svc]: q("#ccmodel").value.trim() },
      provider, api: q("#sapi").value, baseUrl: q("#surl").value.trim(), model: q("#smodel").value.trim(),
      vision: q("#svision").checked, numCtx: +q("#sctx").value, browserModel: q("#sbmodel").value === "__custom" ? (q("#sbcustom").value.trim() || ai.BROWSER_MODELS[0].id) : q("#sbmodel").value,
    });
    const apply = () => { Object.assign(ai.settings, read()); q("#smixed").hidden = !ai.mixedContentProblem(); };
    apply();
    sh.querySelectorAll("#sprov button").forEach(b => b.onclick = () => {
      provider = b.dataset.p;
      sh.querySelectorAll("#sprov button").forEach(x => x.classList.toggle("on", x === b));
      q("#pserver").hidden = provider !== "server";
      q("#pbrowser").hidden = provider !== "browser";
      q("#pcloud").hidden = provider !== "cloud";
      apply();
    });
    // Felder des gewählten Cloud-Dienstes füllen
    const fillCloud = () => {
      const info = ai.CLOUD_SERVICES[svc];
      q("#ccurlwrap").hidden = svc !== "custom";
      q("#cckey").value = s.cloudKeys[svc] || "";
      q("#cckey").placeholder = info.keyHint || "";
      q("#cckeyhint").textContent = info.keyPage ? `Einen Schlüssel bekommst du unter ${info.keyPage}.` : "";
      q("#ccmodel").value = s.cloudModels[svc] ?? (info.model || "");
      q("#ccmodel").placeholder = svc === "anthropic" ? "claude-opus-5-5" : "Erst verbinden, dann Modell wählen";
      q("#ccmodels").innerHTML = "";
      q("#ccvisionrow").hidden = svc === "anthropic";
      q("#cctestmsg").textContent = "";
    };
    fillCloud();
    q("#ccsvc").onchange = () => { apply(); svc = q("#ccsvc").value; fillCloud(); apply(); };
    ["#ccurl", "#cckey", "#ccmodel", "#ccvision"].forEach(id => q(id).addEventListener("input", apply));
    q("#ccvision").onchange = apply;
    q("#cctest").onclick = async () => {
      apply();
      const msg = q("#cctestmsg");
      msg.textContent = "Verbinde…";
      try {
        const models = await ai.listModels();
        q("#ccmodels").innerHTML = models.map(m => `<option value="${esc(m)}">`).join("");
        if (!q("#ccmodel").value && models[0]) { q("#ccmodel").value = models[0]; apply(); }
        msg.textContent = `Verbunden: ${models.length} ${models.length === 1 ? "Modell" : "Modelle"} verfügbar.`;
      } catch (e) { msg.textContent = e.message || String(e); }
    };
    q("#sapi").onchange = () => {
      q("#surl").placeholder = ai.defaultBaseUrl(q("#sapi").value);
      q("#sctxwrap").hidden = q("#sapi").value !== "ollama";
      apply();
    };
    q("#surl").oninput = apply;
    if (provider === "server") ai.listModels().then(models => { q("#smodels").innerHTML = models.map(m => `<option value="${esc(m)}">`).join(""); }).catch(() => {});
    q("#sbmodel").onchange = () => { q("#sbcustomwrap").hidden = q("#sbmodel").value !== "__custom"; apply(); };
    q("#sbcustom").oninput = apply;
    q("#stest").onclick = async () => {
      apply();
      const msg = q("#stestmsg");
      msg.textContent = "Verbinde…";
      try {
        const models = await ai.listModels();
        q("#smodels").innerHTML = models.map(m => `<option value="${esc(m)}">`).join("");
        if (!q("#smodel").value && models[0]) q("#smodel").value = models[0];
        msg.textContent = models.length ? `Verbunden: ${models.length} ${models.length === 1 ? "Modell" : "Modelle"} gefunden (${models.slice(0, 4).join(", ")}${models.length > 4 ? " …" : ""}).` : "Verbunden, aber noch kein Modell installiert.";
        detect();
      } catch (e) { msg.textContent = e.message; }
    };
    const detect = async () => {
      apply();
      const v = await ai.detectVision(q("#smodel").value.trim());
      if (v != null) q("#svision").checked = v;
    };
    q("#smodel").onchange = detect;
    q("#sbload").onclick = async () => {
      apply();
      const bar = q("#sbbar"), msg = q("#sbmsg");
      bar.hidden = false;
      q("#sbload").disabled = true;
      try {
        await ai.loadBrowserModel((text, p) => { msg.textContent = text; bar.firstElementChild.style.width = Math.round((p || 0) * 100) + "%"; });
        msg.textContent = "Geladen. Das Modell ist jetzt auf diesem Gerät gespeichert.";
        bar.firstElementChild.style.width = "100%";
      } catch (e) { msg.textContent = e.message || String(e); }
      finally { q("#sbload").disabled = false; }
    };
    q("#ssave").onclick = async () => {
      apply();
      await ai.saveSettings();
      closeSheet();
      render();
      if (then && ai.isConfigured()) then();
    };
  });
}

/* ---------- Daten: Sicherung exportieren / importieren ---------- */
const blobToDataUrl = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });

function menuSheet() {
  const cards = decks.reduce((n, d) => n + d.cards.length, 0);
  openSheet(`
    <div class="sheet-head"><h2>Daten & Einstellungen</h2><button class="icon" data-act="close" aria-label="Schließen">✕</button></div>
    <button data-act="settings" style="justify-content:flex-start">✦ KI-Modell einstellen</button>
    <button data-act="import" style="justify-content:flex-start">📥 Karten importieren (Text aus dem Chat, JSON, CSV)</button>
    <div class="note">
      <b>Alles bleibt auf diesem Gerät.</b>
      <span>${decks.length} Stapel mit ${cards} Karten sind in diesem Browser gespeichert. Um sie auf ein anderes Gerät zu bringen oder zu sichern, exportiere eine Sicherungsdatei und importiere sie dort.</span>
    </div>
    <div class="row">
      <button id="mexport">Sicherung exportieren</button>
      <label class="btn">Sicherung importieren<input type="file" accept=".json,application/json" id="mimport"></label>
    </div>
    <p class="small muted" id="mmsg"></p>
  `, sh => {
    const msg = sh.querySelector("#mmsg");
    sh.querySelector("#mexport").onclick = async () => {
      msg.textContent = "Sicherung wird erstellt…";
      const images = {};
      for (const d of decks) for (const c of d.cards) for (const ref of [c.frontImg, c.backImg]) {
        if (!ref) continue;
        const blob = await store.getImage(ref.slice(4));
        if (blob) images[ref.slice(4)] = await blobToDataUrl(blob);
      }
      const data = JSON.stringify({ app: "karteikasten", version: 1, exportedAt: new Date().toISOString(), decks, images });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
      a.download = `karteikasten-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      msg.textContent = "Sicherung gespeichert.";
    };
    sh.querySelector("#mimport").onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data.app !== "karteikasten" || !Array.isArray(data.decks)) throw new Error("Das ist keine Karteikasten-Sicherung. Karten als Text, JSON oder CSV importierst du über „Karten importieren“.");
        msg.textContent = await importBackup(data);
        render();
      } catch (err) { msg.textContent = err.message || String(err); }
    };
  });
}

async function importBackup(data) {
  for (const [id, url] of Object.entries(data.images || {})) await store.putImage(id, await (await fetch(url)).blob());
  let added = 0, updated = 0;
  for (const d of data.decks) {
    const cur = deckById(d.id);
    if (cur && (cur.updatedAt || 0) >= (d.updatedAt || 0)) continue;
    cur ? updated++ : added++;
    await saveDeck(d);
  }
  return `Sicherung importiert: ${added} neue, ${updated} aktualisierte Stapel.`;
}

/* ---------- Karten importieren (Karteikasten-Textformat, JSON, Tabelle) ---------- */
async function copyText(text, fallbackEl) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    if (fallbackEl) { fallbackEl.hidden = false; fallbackEl.value = text; fallbackEl.focus(); fallbackEl.select(); }
    return false;
  }
}

function importSheet(targetId) {
  let parsed = { decks: [], skipped: 0 }, fileName = "";
  openSheet(`
    <div class="sheet-head"><h2>Karten importieren</h2><button class="icon" data-act="close" aria-label="Schließen">✕</button></div>
    <p class="small muted">Füge Karten ein, die du z. B. in einem KI-Chat erstellt hast, oder wähle eine Datei. Erkannt werden das Karteikasten-Format (unten), JSON und Tabellen aus Anki oder Quizlet (Tabulator) bzw. CSV mit Semikolon.</p>
    <div class="field"><label class="label" for="itext">Text</label>
      <textarea id="itext" rows="9" placeholder="Stapel: …&#10;&#10;F: Frage&#10;A: Antwort" autocapitalize="off" spellcheck="false"></textarea>
    </div>
    <div class="row">
      <label class="btn sm">📄 Datei wählen<input type="file" accept=".txt,.md,.json,.csv,.tsv,text/*,application/json" id="ifile"></label>
      <button class="sm" id="icopy">Anleitung für den KI-Chat kopieren</button>
      <span class="small muted" id="icopymsg"></span>
    </div>
    <textarea id="icopyfallback" rows="6" hidden readonly></textarea>
    <details class="note"><summary>So sieht das Format aus</summary>
      <pre style="white-space:pre-wrap;margin:0;font:inherit;font-size:.9rem">${esc(FORMAT_EXAMPLE)}</pre>
      <span>„Stapel:“ beginnt einen Stapel (auch mehrere in einem Text), „F:“ eine neue Karte, „A:“ die Rückseite. Weitere Zeilen gehören zum Feld davor.</span>
    </details>
    <div id="ipreview"></div>
  `, sh => {
    const $text = sh.querySelector("#itext"), $prev = sh.querySelector("#ipreview");
    const deckSelect = (i, name) => `<select data-target="${i}">
        <option value="__new">Neuer Stapel „${esc(name)}“</option>
        ${decks.map(d => `<option value="${d.id}" ${d.id === targetId ? "selected" : ""}>In „${esc(d.name)}“</option>`).join("")}
      </select>`;
    const show = () => {
      if (parsed.backup) {
        $prev.innerHTML = `<div class="note">Das ist eine Karteikasten-Sicherung mit ${parsed.backup.decks.length} Stapeln.</div>
          <div class="row"><span class="spacer"></span><button class="primary" id="ibackup">Sicherung importieren</button></div>`;
        sh.querySelector("#ibackup").onclick = async () => { toast(await importBackup(parsed.backup)); closeSheet(); render(); };
        return;
      }
      const total = parsed.decks.reduce((n, d) => n + d.cards.length, 0);
      if (!total) {
        $prev.innerHTML = $text.value.trim() ? `<p class="small" style="color:var(--bad)">Keine Karten erkannt. Jede Karte braucht eine Zeile „F: …“ und eine Zeile „A: …“.</p>` : "";
        return;
      }
      $prev.innerHTML = `
        <h3 style="margin-bottom:10px">${total} ${total === 1 ? "Karte" : "Karten"} in ${parsed.decks.length} ${parsed.decks.length === 1 ? "Stapel" : "Stapeln"} erkannt</h3>
        ${parsed.skipped ? `<p class="small muted">${parsed.skipped} unvollständige ${parsed.skipped === 1 ? "Karte wurde" : "Karten wurden"} übersprungen (Vorder- oder Rückseite fehlt).</p>` : ""}
        <div style="display:grid;gap:14px">${parsed.decks.map((d, i) => `
          <div class="field">
            <span class="row"><b style="flex:1;min-width:0">${esc(d.name)} · ${d.cards.length} ${d.cards.length === 1 ? "Karte" : "Karten"}</b></span>
            ${deckSelect(i, d.name)}
            <div class="gen-list">${d.cards.slice(0, 4).map(c => `<div class="mini" style="cursor:default"><span class="q">${esc(c.front)}</span><span class="a">${esc(c.back)}</span></div>`).join("")}
              ${d.cards.length > 4 ? `<span class="small muted">… und ${d.cards.length - 4} weitere</span>` : ""}</div>
          </div>`).join("")}</div>
        <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="primary" id="igo">${total} ${total === 1 ? "Karte" : "Karten"} importieren</button></div>`;
      sh.querySelector("#igo").onclick = doImport;
    };
    let timer;
    const update = () => { parsed = parseCards($text.value, fileName); show(); };
    $text.oninput = () => { clearTimeout(timer); timer = setTimeout(update, 200); };
    sh.querySelector("#ifile").onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      fileName = f.name;
      $text.value = await f.text();
      update();
    };
    sh.querySelector("#icopy").onclick = async () => {
      const ok = await copyText(CHAT_PROMPT, sh.querySelector("#icopyfallback"));
      sh.querySelector("#icopymsg").textContent = ok ? "Kopiert. Im Chat einfügen und das Thema ergänzen." : "Text unten markiert, bitte selbst kopieren.";
    };
    async function doImport() {
      const now = Date.now();
      const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      let added = 0, dupes = 0, lastDeck = null;
      const targets = [...sh.querySelectorAll("[data-target]")].map(el => el.value);
      for (let i = 0; i < parsed.decks.length; i++) {
        const src = parsed.decks[i];
        const deck = targets[i] === "__new"
          ? { id: uid(), name: src.name, color: COLORS[decks.length % COLORS.length], cards: [], createdAt: now }
          : deckById(targets[i]);
        const seen = new Set(deck.cards.map(c => norm(c.front)));
        for (const c of src.cards) {
          if (seen.has(norm(c.front))) { dupes++; continue; }
          seen.add(norm(c.front));
          deck.cards.push({ id: uid(), front: c.front, back: c.back, box: 1, due: now });
          added++;
        }
        await saveDeck(deck);
        lastDeck = deck;
      }
      closeSheet();
      view = parsed.decks.length === 1 && lastDeck ? { name: "deck", id: lastDeck.id } : { name: "home" };
      render();
      toast(`${added} ${added === 1 ? "Karte" : "Karten"} importiert${dupes ? `, ${dupes} doppelte übersprungen` : ""}`);
    }
  });
}

/* ---------- Karten mit der KI erstellen ---------- */
let genCtl = null;

const STYLES = {
  qa: "Frage auf der Vorderseite, knappe, präzise Antwort auf der Rückseite.",
  vocab: "Vokabelkarten: Wort oder Ausdruck in der Fremdsprache auf der Vorderseite, Übersetzung (und bei Bedarf ein kurzer Beispielsatz) auf der Rückseite. Erkenne die Sprachen aus dem Stoff.",
  def: "Fachbegriff auf der Vorderseite, Definition in 1–2 Sätzen auf der Rückseite.",
};

function cardSchema(withImages) {
  const card = { type: "object", properties: { front: { type: "string" }, back: { type: "string" } }, required: ["front", "back"] };
  if (withImages) {
    card.properties.image = {
      type: "object",
      properties: { ref: { type: "integer" }, box: { type: "array", items: { type: "number" } }, side: { type: "string", enum: ["front", "back"] } },
      required: ["ref", "side"],
    };
  }
  return { type: "object", properties: { deckName: { type: "string" }, cards: { type: "array", items: card } }, required: ["deckName", "cards"] };
}

const MAX_CARDS = 200;

function genSheet(targetId) {
  if (!ai.isConfigured()) { settingsSheet(() => genSheet(targetId)); return; }
  const browser = ai.settings.provider === "browser", cloud = ai.settings.provider === "cloud";
  const currentModel = cloud ? ai.cloudModel() : ai.settings.model;
  let kind = "qa", results = null, useImages = true;
  const deckOptions = decks.map(d => `<option value="${d.id}" ${d.id === targetId ? "selected" : ""}>${esc(d.name)}</option>`).join("");
  const browserOptions = () => {
    const list = ai.BROWSER_MODELS.some(m => m.id === ai.settings.browserModel) ? ai.BROWSER_MODELS : [...ai.BROWSER_MODELS, { id: ai.settings.browserModel, label: ai.settings.browserModel, size: "eigenes Modell" }];
    return list.map(m => `<option value="${esc(m.id)}" ${m.id === ai.settings.browserModel ? "selected" : ""}>${esc(m.label)} · ${esc(m.size)}</option>`).join("");
  };
  openSheet(`
    <div class="sheet-head"><h2>✦ Karten mit KI erstellen</h2><button class="icon" data-act="close" aria-label="Schließen">✕</button></div>
    <div class="row" style="align-items:flex-end">
      <div class="field" style="flex:1 1 240px"><label class="label" for="gmodel">Modell (${esc(ai.providerLabel())})</label>
        <select id="gmodel">${browser ? browserOptions() : `<option value="${esc(currentModel)}">${esc(currentModel)}</option>`}</select>
      </div>
      <button class="ghost" data-act="settings">Einstellungen</button>
    </div>
    ${cloud ? `<p class="small muted">Dokumente, Bilder und Hinweise werden zum Erstellen an ${esc(ai.providerLabel())} geschickt.</p>` : ""}
    <div class="field">
      <span class="label">Dokumente</span>
      <div class="drop" id="gdrop">
        <div class="doclist" id="gdocs"></div>
        <div class="row"><label class="btn">📄 Dokument importieren<input type="file" accept="${DOC_ACCEPT}" multiple id="gfile"></label><span class="small muted" id="gstatus">PDF, Word (.docx), Fotos deiner Notizen oder Textdateien</span></div>
      </div>
    </div>
    <div class="field">
      <label class="label" for="gsrc">Thema, Hinweise oder Lernstoff</label>
      <textarea id="gsrc" rows="4" placeholder="Ein Thema („Französische Revolution, Ursachen und Verlauf“), Hinweise zum Dokument („nur Kapitel 3, Fokus auf Definitionen“) oder direkt eingefügter Text."></textarea>
    </div>
    <div class="row" style="align-items:flex-start">
      <div class="field"><label class="label" for="gcount">Anzahl Karten</label>
        <input id="gcount" type="number" inputmode="numeric" min="1" max="${MAX_CARDS}" step="1" value="${browser ? 5 : 10}" style="width:130px">
      </div>
      <div class="field"><span class="label">Art</span><div class="seg" id="gkind">
        <button data-k="qa" class="on">Frage – Antwort</button><button data-k="vocab">Vokabeln</button><button data-k="def">Begriffe</button>
      </div></div>
    </div>
    <p class="small muted" id="gcountnote" hidden></p>
    <label class="check small" id="gimgrow" hidden><input type="checkbox" id="gimg" checked> Abbildungen aus den Dokumenten auf Karten verwenden, wo sie helfen</label>
    <p class="small muted" id="gimgnote" hidden></p>
    <div class="field"><label class="label" for="gdeck">In Stapel</label>
      <select id="gdeck"><option value="__new">Neuer Stapel</option>${deckOptions}</select>
    </div>
    <div class="row"><span class="spacer"></span><button class="primary" id="gogen">Karten erstellen</button></div>
    <div id="gout"></div>
  `, sh => {
    const $out = sh.querySelector("#gout"), $status = sh.querySelector("#gstatus"), $docs = sh.querySelector("#gdocs");
    const statusDefault = $status.textContent;
    const drawDocs = () => {
      $docs.innerHTML = docs.map(d => `<div class="doc"><span class="kind">${esc(d.kind)}</span><span class="meta"><b>${esc(d.name)}</b><span>${esc(d.info)}</span></span><button class="icon sm ghost" data-rmdoc="${d.id}" aria-label="Entfernen">✕</button></div>`).join("");
      const hasSources = docs.some(d => d.sources.length);
      sh.querySelector("#gimgrow").hidden = !hasSources;
      const note = sh.querySelector("#gimgnote");
      note.hidden = !hasSources || ai.canSeeImages();
      note.textContent = "Dein Modell sieht keine Bilder. Es kann Abbildungen anhand des Textes zuordnen; den Ausschnitt kannst du in der Vorschau anpassen.";
    };
    drawDocs();

    // Modell wählen: auf dem Server alle installierten Modelle, im Browser die WebLLM-Modelle
    const $model = sh.querySelector("#gmodel");
    if (!browser) {
      ai.listModels().then(models => {
        if (!models.length) return;
        const cur = currentModel;
        $model.innerHTML = [...new Set([cur, ...models])].filter(Boolean).map(m => `<option value="${esc(m)}" ${m === cur ? "selected" : ""}>${esc(m)}</option>`).join("");
      }).catch(() => { /* Server gerade nicht erreichbar: aktuelles Modell bleibt */ });
    }
    $model.onchange = async () => { await ai.setModel($model.value); drawDocs(); };

    const $count = sh.querySelector("#gcount");
    const batchSize = browser ? 10 : cloud ? 40 : 20;
    const countNote = () => {
      const n = parseInt($count.value, 10);
      const el = sh.querySelector("#gcountnote");
      el.hidden = !(n > batchSize);
      el.textContent = `Bei mehr als ${batchSize} Karten erstellt das Modell sie in ${Math.ceil(n / batchSize)} Durchgängen. Das dauert entsprechend länger.`;
    };
    $count.oninput = countNote;

    $docs.onclick = e => { const b = e.target.closest("[data-rmdoc]"); if (b) { removeDoc(b.dataset.rmdoc); drawDocs(); } };
    const addFiles = async files => {
      if (!files.length) return;
      const errors = await importFiles(files, s => { $status.textContent = s || statusDefault; });
      if (errors.length) toast(errors[0]);
      drawDocs();
    };
    sh.querySelector("#gfile").onchange = e => addFiles([...e.target.files]);
    const $drop = sh.querySelector("#gdrop");
    $drop.ondragover = e => { e.preventDefault(); $drop.classList.add("over"); };
    $drop.ondragleave = () => $drop.classList.remove("over");
    $drop.ondrop = e => { e.preventDefault(); $drop.classList.remove("over"); addFiles([...e.dataTransfer.files]); };
    sh.querySelector("#gimg").onchange = e => { useImages = e.target.checked; };
    sh.querySelectorAll("#gkind button").forEach(b => b.onclick = () => { kind = b.dataset.k; sh.querySelectorAll("#gkind button").forEach(x => x.classList.toggle("on", x === b)); });

    const $go = sh.querySelector("#gogen");
    $go.onclick = async () => {
      const hint = sh.querySelector("#gsrc").value.trim();
      if (!hint && !docs.length) { sh.querySelector("#gsrc").focus(); return; }
      const count = parseInt($count.value, 10);
      if (!(count >= 1 && count <= MAX_CARDS)) { toast(`Bitte eine Anzahl zwischen 1 und ${MAX_CARDS} eingeben.`); $count.focus(); return; }
      $go.disabled = true;
      genCtl = new AbortController();
      const signal = genCtl.signal;
      const setBusy = msg => {
        $out.innerHTML = `<div class="row"><span class="thinking"><span class="dot"></span><span id="gbusy">${esc(msg)}</span></span><span class="spacer"></span><button id="gstop">Stopp</button></div>`;
        $out.querySelector("#gstop").onclick = () => genCtl.abort();
      };
      const busy = msg => { const el = $out.querySelector("#gbusy"); if (el) el.textContent = msg; };
      const cards = [];
      let deckName = "", cut = false;
      try {
        // Bildquellen: Abbildungen zuerst. Vision-Modelle bekommen die Bilder, andere nur die Liste.
        const vision = ai.canSeeImages();
        const all = useImages ? docs.flatMap(d => d.sources.map(s => ({ d, s }))) : [];
        const max = vision ? MAX_IMAGES_TO_MODEL : 30;
        const pick = all.length <= max ? all : [...all.filter(x => x.s.figure), ...all.filter(x => !x.s.figure)].slice(0, max);
        pick.sort((a, b) => all.indexOf(a) - all.indexOf(b));
        const sources = [];
        for (let k = 0; k < pick.length; k++) {
          if (signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
          const entry = { ...pick[k] };
          if (vision) {
            setBusy(`Bereite Bild ${k + 1} von ${pick.length} vor…`);
            entry.blob = await toBlob(await pick[k].s.render(896), 0.8);
          }
          sources.push(entry);
        }

        let material = docs.map(d => `=== Dokument: ${d.name} ===\n${d.text || "(kein Text, nur Bild)"}`).join("\n\n");
        const limit = ai.maxInputChars(vision ? sources.length : 0, Math.min(count, batchSize) + 15);
        if (material.length > limit) { material = material.slice(0, limit) + "\n[… gekürzt]"; cut = true; }

        const list = sources.map((x, k) => `Bild ${k + 1}: ${x.d.name}, ${x.s.label}${x.s.figure ? " (enthält Abbildungen)" : ""}`).join("\n");
        const imgRules = !sources.length ? "" : vision ? `
Bilder: Du siehst ${sources.length} Bilder aus den Dokumenten, in dieser Reihenfolge:
${list}
- Lies auch Text in den Bildern (z. B. bei Fotos von Notizen oder gescannten Seiten).
- Wenn eine Abbildung (Diagramm, Schema, Karte, Grafik, Foto, Formel, Tabelle) eine Karte wirklich besser macht, hänge sie an: "image": {"ref": <Bildnummer>, "box": [x0, y0, x1, y1], "side": "front" oder "back"}.
- "box" ist der Ausschnitt in Anteilen des Bildes (0 bis 1, links oben = 0,0). Schneide eng um die Abbildung samt Beschriftung, nicht die ganze Seite, außer die ganze Seite ist die Abbildung.
- Auf die Vorderseite nur, wenn das Bild die Antwort nicht verrät (z. B. „Was zeigt dieses Schema?“). Sonst auf die Rückseite.
- Kein Bild für reinen Fließtext, Logos oder Deko. Lieber weniger, dafür passende Bilder.` : `
Abbildungen: Die Dokumente enthalten diese Bildquellen (du siehst sie nicht, nur den Text):
${list}
- Im Text markiert [Abbildung N] die Stelle einer Abbildung in Word-Dokumenten, [Seite N] den Beginn einer PDF-Seite.
- Wenn eine Karte von einer Abbildung profitiert, deren Inhalt aus dem umgebenden Text klar hervorgeht, hänge sie an: "image": {"ref": <Bildnummer>, "side": "back"}.
- Nur selten und nur, wenn du sicher bist, dass die Abbildung zum Inhalt der Karte passt.`;

        // Lernstoff, Hinweise und Bildliste bleiben in allen Durchgängen gleich (bei Claude zwischengespeichert)
        const context = [
          hint ? `Thema / Hinweise der lernenden Person:\n"""\n${hint}\n"""` : "",
          material ? `Dokumente:\n"""\n${material}\n"""` : "",
          imgRules.trim(),
        ].filter(Boolean).join("\n\n");

        const makePrompt = (n, existing) => `Erstelle genau ${n} Lern-Karteikarten aus dem Stoff oben.

Regeln:
- ${STYLES[kind]}
- Jede Karte prüft genau einen Gedanken. Keine doppelten Karten.
- Antworten kurz halten (höchstens etwa 40 Wörter).
- Schreibe in der Sprache des Stoffs (bei einem Thema ohne Text: Deutsch).
- Wenn Dokumente oder ein Text gegeben sind, nur Inhalte daraus verwenden und die wichtigsten Inhalte abdecken.
- Schlage außerdem einen kurzen Stapelnamen vor (höchstens 5 Wörter).
${existing.length ? `
Diese Karten gibt es schon. Wiederhole sie nicht, sondern decke andere Inhalte ab:
${existing.slice(-80).map(f => "- " + f.slice(0, 120)).join("\n")}
` : ""}
Antworte ausschließlich mit JSON in genau dieser Form:
{"deckName": "…", "cards": [{"front": "…", "back": "…"${sources.length ? `, "image": {"ref": 1, ${vision ? `"box": [0.1, 0.2, 0.9, 0.6], ` : ""}"side": "back"}` : ""}}]}
${sources.length ? `"image" nur bei Karten, die ein Bild bekommen; sonst weglassen.` : ""}`;

        // Große Mengen in Durchgängen erstellen; lokale Modelle liefern sonst oft zu wenige Karten
        const seen = new Set();
        const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        const maxRounds = Math.ceil(count / batchSize) + 2;
        setBusy(browser && !ai.browserModelLoaded() ? "Modell wird geladen…" : `Das Modell liest und schreibt ${count} Karten…`);
        for (let round = 0; cards.length < count && round < maxRounds; round++) {
          const n = Math.min(batchSize, count - cards.length);
          const done = cards.length;
          const text = await ai.generate({
            prompt: makePrompt(n, cards.map(c => c.front)), context, signal, schema: cardSchema(sources.length > 0),
            images: vision ? sources.map(x => x.blob) : [],
            onText: t => busy(`Das Modell schreibt… ${Math.min(count, done + (t.match(/"front"/g) || []).length)} von ${count} Karten`),
            onProgress: (msg, p) => busy(`Modell wird geladen: ${Math.round((p || 0) * 100)} %`),
          });
          const res = ai.parseJson(text);
          if (!deckName && res?.deckName) deckName = String(res.deckName);
          const raw = Array.isArray(res?.cards) ? res.cards : Array.isArray(res) ? res : [];
          let added = 0;
          for (const c of raw) {
            if (cards.length >= count) break;
            if (!c || !(c.front || c.image) || !(c.back || c.image)) continue;
            const out = { front: String(c.front || "").trim(), back: String(c.back || "").trim() };
            const key = norm(out.front + (out.front ? "" : out.back));
            if (key && seen.has(key)) continue;
            seen.add(key);
            const im = c.image, src = im && sources[(+im.ref || 0) - 1];
            if (src) {
              let box = Array.isArray(im.box) && im.box.length === 4 ? im.box.map(Number) : [0, 0, 1, 1];
              if (!(box[2] > box[0] && box[3] > box[1])) box = [0, 0, 1, 1];
              out.src = src; out.box = box;
              out.side = im.side === "front" ? "front" : "back";
              try { out.canvas = cropCanvas(await src.s.render(1800), box); out.preview = scaleCanvas(out.canvas, 500).toDataURL("image/jpeg", 0.8); }
              catch (e) { delete out.src; }
            }
            cards.push(out);
            added++;
          }
          if (!added) break; // Modell liefert nichts Neues mehr
        }
        if (!cards.length) throw new Error("Das Modell hat keine Karten geliefert. Versuch es noch einmal oder nimm ein größeres Modell.");
        results = { name: (deckName || "Neuer Stapel").slice(0, 60), cards, cut, wanted: count };
        showResults();
      } catch (e) {
        // Bereits erstellte Karten behalten, wenn ein späterer Durchgang scheitert oder gestoppt wird
        if (cards.length) {
          results = { name: (deckName || "Neuer Stapel").slice(0, 60), cards, cut, wanted: count, stopped: e.name === "AbortError" ? "Gestoppt." : (e.message || String(e)) };
          showResults();
        } else {
          $out.innerHTML = e.name === "AbortError" ? `<p class="muted">Abgebrochen.</p>` : `<p style="color:var(--bad)">${esc(e.message || String(e))}</p>`;
        }
      } finally { $go.disabled = false; }
    };

    function showResults() {
      const withImg = results.cards.filter(c => c.canvas).length;
      $out.innerHTML = `
        <div class="row" style="margin-bottom:10px"><h3>${results.cards.length} Vorschläge${withImg ? ` · ${withImg} mit Bild` : ""}</h3><span class="spacer"></span><button class="ghost" id="gall">Alle abwählen</button></div>
        ${results.wanted && results.cards.length < results.wanted ? `<p class="note small">${results.stopped ? esc(results.stopped) + " " : ""}Das Modell hat ${results.cards.length} von ${results.wanted} Karten geliefert.${results.stopped ? "" : " Der Stoff gibt vermutlich nicht mehr unterschiedliche Karten her. Mit „Karten erstellen“ kannst du es erneut versuchen."}</p>` : ""}
        ${results.cut ? `<p class="note small">Die Dokumente waren zu lang für das Modell und wurden gekürzt. Für den Rest kannst du im Textfeld z. B. „ab Seite 10“ angeben, eine größere Kontextlänge einstellen oder das Dokument aufteilen.</p>` : ""}
        <div class="gen-list">${results.cards.map((c, i) => `
          <div class="gen-item"><input type="checkbox" id="gc${i}" checked aria-label="Karte übernehmen"><span>
            ${c.canvas && c.side === "front" ? `<img src="${c.preview}" alt="">` : ""}
            <span class="q">${esc(c.front)}</span>
            ${c.canvas && c.side === "back" ? `<img src="${c.preview}" alt="">` : ""}
            <span class="a">${esc(c.back)}</span>
            ${c.canvas ? `<span class="tag">Bild auf der ${c.side === "front" ? "Vorderseite" : "Rückseite"} · ${esc(c.src.d.name)}, ${esc(c.src.s.label)}</span>` : ""}
            <span class="gen-actions">
              ${c.canvas ? `<button class="sm" data-gcrop="${i}">Ausschnitt ändern</button><button class="sm" data-gside="${i}">Auf ${c.side === "front" ? "Rückseite" : "Vorderseite"}</button><button class="sm ghost danger" data-grm="${i}">Bild entfernen</button>`
                : docs.some(d => d.sources.length) ? `<button class="sm" data-gadd="${i}">+ Bild aus Dokument</button>` : ""}
            </span>
          </span></div>`).join("")}</div>
        <p class="small muted" id="gaddmsg" hidden></p>
        <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="primary" id="gadd">Ausgewählte hinzufügen</button></div>`;
      const boxesEl = [...$out.querySelectorAll(".gen-item input")];
      const keepChecks = () => boxesEl.map(b => b.checked);
      const restore = checks => { $out.querySelectorAll(".gen-item input").forEach((b, i) => { b.checked = checks[i]; }); };
      const redraw = () => { const ch = keepChecks(); showResults(); restore(ch); };
      const $all = $out.querySelector("#gall");
      $all.onclick = () => { const any = boxesEl.some(b => b.checked); boxesEl.forEach(b => b.checked = !any); $all.textContent = any ? "Alle auswählen" : "Alle abwählen"; };
      $out.querySelectorAll("[data-gcrop]").forEach(b => b.onclick = () => {
        const c = results.cards[+b.dataset.gcrop];
        cropView(c.src.s, c.box, (canvas, box) => { c.canvas = canvas; c.box = box; c.preview = scaleCanvas(canvas, 500).toDataURL("image/jpeg", 0.8); redraw(); });
      });
      $out.querySelectorAll("[data-gside]").forEach(b => b.onclick = () => { const c = results.cards[+b.dataset.gside]; c.side = c.side === "front" ? "back" : "front"; redraw(); });
      $out.querySelectorAll("[data-grm]").forEach(b => b.onclick = () => { const c = results.cards[+b.dataset.grm]; delete c.canvas; delete c.src; redraw(); });
      $out.querySelectorAll("[data-gadd]").forEach(b => b.onclick = () => {
        const c = results.cards[+b.dataset.gadd];
        docPicker(canvas => {
          c.canvas = canvas; c.side = "back"; c.box = [0, 0, 1, 1];
          c.src = { d: { name: "Eigene Auswahl" }, s: { label: "Ausschnitt", render: async () => canvas } };
          c.preview = scaleCanvas(canvas, 500).toDataURL("image/jpeg", 0.8);
          redraw();
        });
      });
      const $add = $out.querySelector("#gadd");
      $add.onclick = async () => {
        const chosen = results.cards.filter((_, i) => boxesEl[i].checked);
        if (!chosen.length) return;
        $add.disabled = true;
        const $msg = $out.querySelector("#gaddmsg");
        $msg.hidden = false;
        const target = sh.querySelector("#gdeck").value;
        const deck = target === "__new" ? { id: uid(), name: results.name, color: COLORS[decks.length % COLORS.length], cards: [], createdAt: Date.now() } : deckById(target);
        const now = Date.now();
        const total = chosen.filter(x => x.canvas).length;
        let k = 0;
        for (const c of chosen) {
          const card = { id: uid(), front: c.front, back: c.back, box: 1, due: now };
          if (c.canvas) { $msg.textContent = `Speichere Bild ${++k} von ${total}…`; card[c.side + "Img"] = await storeImage(c.canvas); }
          deck.cards.push(card);
        }
        await saveDeck(deck);
        closeSheet();
        view = { name: "deck", id: deck.id };
        render();
        toast(`${chosen.length} Karten zu „${deck.name}“ hinzugefügt`);
      };
    }
  });
}

/* ---------- Ereignisse ---------- */
let toastTimer;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "scrim") { if (e.target === el) closeSheet(); return; }
  if (act === "scrim2") { if (e.target === el) closeLayer2(); return; }
  const deck = view.name === "deck" ? deckById(view.id) : null;
  switch (act) {
    case "close": closeSheet(); break;
    case "home": view = { name: "home" }; session = null; render(); break;
    case "open": view = { name: "deck", id: el.dataset.id }; render(); window.scrollTo(0, 0); break;
    case "newdeck": deckSheet(null); break;
    case "editdeck": deckSheet(deck); break;
    case "example": saveDeck(exampleDeck()).then(render); break;
    case "addcard": cardSheet(deck, null); break;
    case "editcard": cardSheet(deck, deck.cards.find(c => c.id === el.dataset.cid)); break;
    case "study": startStudy(deck, dueCards(deck).length === 0); break;
    case "studyall": startStudy(deck, true); break;
    case "flip":
      if (!session.flipped) { session.flipped = true; render(); }
      else if (el.classList.contains("flip")) { session.flipped = false; render(); }
      break;
    case "rate": rate(+el.dataset.r); break;
    case "explain": explain(); break;
    case "back": explainCtl?.abort(); view = { name: "deck", id: session.deckId }; session = null; render(); break;
    case "gen": genSheet(el.dataset.id || (view.name === "deck" ? view.id : null)); break;
    case "settings": settingsSheet(); break;
    case "menu": menuSheet(); break;
    case "import": importSheet(el.dataset.id || null); break;
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") { if ($layer2.innerHTML) closeLayer2(); else if ($layer.innerHTML) closeSheet(); return; }
  if (view.name !== "study" || $layer.innerHTML || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === " " || e.key === "Enter") {
    if (e.target.tagName === "BUTTON" && e.key === "Enter") return;
    e.preventDefault(); session.flipped = !session.flipped; render();
  } else if (session?.flipped && ["1", "2", "3", "4"].includes(e.key)) rate(+e.key);
});

// Wischen auf der umgedrehten Karte: nach rechts = Gut, nach links = Nochmal
let sx = null, sy = null;
document.addEventListener("touchstart", e => { if (e.target.closest(".flip")) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } }, { passive: true });
document.addEventListener("touchend", e => {
  if (sx == null || !session?.flipped) { sx = null; return; }
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  sx = null;
  if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) { e.preventDefault(); rate(dx > 0 ? 3 : 1); }
});

/* ---------- Start ---------- */
(async () => {
  try {
    decks = await store.getAllDecks();
  } catch (e) {
    $app.innerHTML = `<div class="empty"><h2>Speicher nicht verfügbar</h2><p class="muted">Der Browser erlaubt dieser Seite keinen lokalen Speicher (z. B. im privaten Modus). Öffne die App in einem normalen Fenster.</p></div>`;
    return;
  }
  await ai.loadSettings();
  if (!decks.length && !(await store.getSetting("seeded"))) {
    await saveDeck(exampleDeck());
    await store.setSetting("seeded", true);
  }
  store.requestPersistence();
  render();
  if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
