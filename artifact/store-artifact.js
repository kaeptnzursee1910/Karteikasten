// Speicher für die Artefakt-Version auf claude.ai: Stapel in der Datenbank des Artefakts,
// Bilder im Asset-Speicher. Gleiche Schnittstelle wie js/store.js.
// Stapel liegen in der Sammlung "decks", damit auch Claude sie im Chat anlegen und ergänzen kann.

const claudeApi = window.claude;
let db = null, assets = null, user = null;

const ready = (async () => {
  if (!claudeApi?.use) throw new Error("Diese Version läuft nur als Artefakt auf claude.ai.");
  [db, assets, user] = await Promise.all([claudeApi.use("db"), claudeApi.use("assets"), claudeApi.use("user")]);
  if (!db) throw new Error("Der Speicher ist nicht verfügbar. Bist du bei claude.ai angemeldet?");
  await migrateFromPrivate();
})();

const decks = () => db.collection("decks");

export async function getAllDecks() {
  await ready;
  const snap = await decks().get();
  return snap.docs.map(d => d.data()).filter(Boolean).map(d => JSON.parse(JSON.stringify(d)));
}
export async function putDeck(deck) { await ready; await decks().doc(deck.id).set(deck); }
export async function deleteDeck(id) { await ready; await decks().doc(id).delete(); }

/** Änderungen von außen (z. B. von Claude im Chat) mitbekommen. */
export function subscribe(onDecks) {
  ready.then(() => decks().onSnapshot(
    snap => onDecks(snap.docs.map(d => d.data()).filter(Boolean).map(d => JSON.parse(JSON.stringify(d)))),
    () => { /* Abo beendet: die Seite funktioniert weiter mit dem letzten Stand */ },
  )).catch(() => {});
}

export const imageUrl = id => "/_blob/" + id;
export async function putImage(_id, blob) {
  await ready;
  if (!assets) throw new Error("Bilder können hier nur Personen hochladen, die das Artefakt bearbeiten dürfen.");
  return (await assets.upload(blob)).id;
}
export async function getImage(id) {
  const r = await fetch(imageUrl(id));
  return r.ok ? r.blob() : undefined;
}
export async function deleteImage(id) {
  await ready;
  if (assets) await assets.delete(id);
}

// Kleine Einstellungen pro Gerät
export async function getSetting(key) {
  try { const v = localStorage.getItem("karteikasten." + key); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; }
}
export async function setSetting(key, value) {
  try { localStorage.setItem("karteikasten." + key, JSON.stringify(value)); } catch (e) { /* nicht verfügbar */ }
}
export function requestPersistence() {}

// Frühere Artefakt-Version: Stapel lagen privat unter data/users/<id>. Einmalig übernehmen.
async function migrateFromPrivate() {
  try {
    const id = user ? await user.id() : null;
    if (!id) return;
    const old = db.collection("data/users/" + id);
    const snap = await old.get();
    for (const doc of snap.docs) {
      const deck = doc.data();
      if (!deck || !Array.isArray(deck.cards)) continue;
      for (const c of deck.cards) {
        for (const side of ["frontImg", "backImg"]) {
          const ref = c[side];
          if (!ref) continue;
          if (ref.startsWith("asset:")) c[side] = "img:" + ref.slice(6);
          else if (ref.startsWith("data:") && assets) c[side] = "img:" + (await assets.upload(await (await fetch(ref)).blob())).id;
          else if (ref.startsWith("data:")) delete c[side];
        }
      }
      await decks().doc(deck.id || doc.id).set(deck);
      await old.doc(doc.id).delete();
    }
  } catch (e) { /* Übernahme beim nächsten Öffnen erneut versuchen */ }
}
