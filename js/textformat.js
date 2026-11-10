// Karteikasten-Textformat: Karten als einfacher Text, z. B. aus einem KI-Chat kopiert.
//
//   Stapel: Zellbiologie
//
//   F: Was ist eine Zelle?
//   A: Die kleinste lebende Einheit.
//
//   F: Welche Aufgaben hat der Zellkern?
//   A: Er speichert die DNA
//   und steuert die Zelle.
//
// "Stapel:" beginnt einen neuen Stapel (mehrere pro Text möglich), "F:" eine neue Karte,
// "A:" deren Rückseite. Weitere Zeilen gehören zum Feld davor. Daneben werden JSON,
// tabulatorgetrennte Listen (Anki, Quizlet) und CSV mit Semikolon erkannt.

const OPT = String.raw`(?:[-*]\s+)?(?:\*\*|__)?`; // Markierungen stehen am Zeilenanfang
const END = String.raw`(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s?`;
const DECK = new RegExp(`^${OPT}(?:Stapel|Deck|Thema)${END}(.+)$`, "i");
const FRONT = new RegExp(`^${OPT}(?:F|Q|Frage|Vorderseite|Front|Question)${END}(.*)$`, "i");
const BACK = new RegExp(`^${OPT}(?:A|Antwort|Rückseite|Back|Answer)${END}(.*)$`, "i");
const HEADING = /^#{1,3}\s+(.+)$/;
const FENCE = /^\s*```/;

export const FORMAT_EXAMPLE = `Stapel: Zellbiologie

F: Was ist eine Zelle?
A: Die kleinste lebende Einheit eines Organismus.

F: Welche Aufgaben hat der Zellkern?
A: Er speichert die DNA
und steuert die Vorgänge in der Zelle.`;

export const CHAT_PROMPT = `Erstelle Karteikarten zu folgendem Thema: [THEMA ODER TEXT HIER EINFÜGEN]

Gib die Karten in einem einzigen Codeblock genau in diesem Format aus, ohne weiteren Text im Codeblock:

Stapel: <kurzer Name des Stapels>

F: <Frage>
A: <Antwort>

F: <nächste Frage>
A: <nächste Antwort>

Regeln:
- Jede Karte beginnt mit „F:“ (Vorderseite) und hat genau ein „A:“ (Rückseite).
- Zwischen den Karten steht eine Leerzeile.
- Antworten dürfen mehrere Zeilen haben, aber keine Zeile darf mit „F:“, „A:“ oder „Stapel:“ beginnen.
- Für mehrere Stapel jeweils eine neue Zeile „Stapel: <Name>“ davor setzen.
- Jede Karte prüft genau einen Gedanken; Antworten kurz und präzise.`;

const clean = s => String(s ?? "").replace(/\s+$/gm, "").replace(/^\n+|\n+$/g, "").trim();

/**
 * Erkennt Karten in einem Text.
 * @returns {{decks: {name: string, cards: {front: string, back: string}[]}[], skipped: number, backup?: object}}
 */
export function parseCards(text, fileName = "") {
  const raw = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const fallbackName = fileName.replace(/\.[^.]+$/, "").trim() || "Importierte Karten";
  const trimmed = raw.trim();
  if (!trimmed) return { decks: [], skipped: 0 };

  // JSON (auch innerhalb eines ```json-Blocks)
  const jsonText = trimmed.replace(/^```(?:json)?\s*|\s*```$/gi, "");
  if (/^[[{]/.test(jsonText)) {
    try { return fromJson(JSON.parse(jsonText), fallbackName); } catch (e) { /* kein gültiges JSON: als Text lesen */ }
  }

  const lines = raw.split("\n");
  const hasMarkers = lines.some(l => FRONT.test(l)) && lines.some(l => BACK.test(l));
  if (!hasMarkers) return fromTable(lines, fallbackName, /\.csv$/i.test(fileName));

  const decks = [];
  let deck = null, card = null, field = null, skipped = 0;
  const startDeck = name => { deck = { name: clean(name) || fallbackName, cards: [] }; decks.push(deck); };
  const finishCard = () => {
    if (!card) return;
    card.front = clean(card.front); card.back = clean(card.back);
    if (card.front && card.back) { if (!deck) startDeck(fallbackName); deck.cards.push(card); }
    else skipped++;
    card = null; field = null;
  };

  for (const line of lines) {
    if (FENCE.test(line)) continue;
    let m;
    if ((m = line.match(DECK)) || (!card && (m = line.match(HEADING)))) { finishCard(); startDeck(m[1].replace(/\*\*|__/g, "")); continue; }
    if ((m = line.match(FRONT))) { finishCard(); card = { front: m[1], back: "" }; field = "front"; continue; }
    if ((m = line.match(BACK))) {
      if (!card) { skipped++; continue; }
      if (field === "back") { card.back += "\n" + line; continue; } // zweites "A:" gehört zur Antwort
      card.back = m[1]; field = "back"; continue;
    }
    // beim Export eingerückte Zeilen, die sonst wie eine Markierung aussähen
    const text = line.startsWith("  ") && [FRONT, BACK, DECK].some(r => r.test(line.slice(2))) ? line.slice(2) : line;
    if (card && field) card[field] += "\n" + text;
  }
  finishCard();
  return { decks: decks.filter(d => d.cards.length), skipped };
}

function cardFrom(o) {
  if (!o || typeof o !== "object") return null;
  const front = o.front ?? o.frage ?? o.question ?? o.q ?? o.vorderseite;
  const back = o.back ?? o.antwort ?? o.answer ?? o.a ?? o.rueckseite ?? o.rückseite;
  return front != null && back != null && clean(front) && clean(back) ? { front: clean(front), back: clean(back) } : null;
}

function fromJson(data, fallbackName) {
  if (data?.app === "karteikasten" && Array.isArray(data.decks)) return { decks: [], skipped: 0, backup: data };
  const list = Array.isArray(data?.decks) ? data.decks : Array.isArray(data) && data.every(x => x && Array.isArray(x.cards)) ? data : [Array.isArray(data) ? { cards: data } : data];
  let skipped = 0;
  const decks = list.map(d => {
    const items = Array.isArray(d?.cards) ? d.cards : [];
    const cards = items.map(cardFrom).filter(Boolean);
    skipped += items.length - cards.length;
    return { name: clean(d?.deckName ?? d?.name ?? d?.stapel ?? d?.title) || fallbackName, cards };
  }).filter(d => d.cards.length);
  return { decks, skipped };
}

// Tabelle: Vorderseite und Rückseite durch Tabulator (Anki, Quizlet) oder Semikolon (CSV) getrennt
function fromTable(lines, fallbackName, isCsv) {
  const rows = lines.filter(l => l.trim() && !FENCE.test(l));
  const sep = rows.some(l => l.includes("\t")) ? "\t" : (isCsv || rows.filter(l => l.includes(";")).length >= rows.length * 0.8) ? ";" : null;
  if (!sep) return { decks: [], skipped: rows.length };
  const unquote = s => clean(s.trim().replace(/^"([\s\S]*)"$/, "$1").replace(/""/g, '"'));
  const cards = [];
  let skipped = 0;
  for (const row of rows) {
    const i = row.indexOf(sep);
    const front = i > 0 ? unquote(row.slice(0, i)) : "";
    const back = i > 0 ? unquote(row.slice(i + 1).split(sep)[0]) : "";
    if (front && back && !/^(vorderseite|front|frage|question)$/i.test(front)) cards.push({ front, back });
    else skipped++;
  }
  return { decks: cards.length ? [{ name: fallbackName, cards }] : [], skipped };
}

/** Ein Stapel im Karteikasten-Textformat. */
export function deckToText(deck) {
  const fix = s => String(s || "").split("\n").map(l => (FRONT.test(l) || BACK.test(l) || DECK.test(l)) ? "  " + l : l).join("\n");
  const cards = deck.cards.filter(c => c.front || c.back).map(c => `F: ${fix(c.front || "(Bild)")}\nA: ${fix(c.back || "(Bild)")}`);
  return `Stapel: ${deck.name}\n\n${cards.join("\n\n")}\n`;
}
