// Lokaler Speicher im Browser (IndexedDB): Stapel, Bilder und Einstellungen.
const DB_NAME = "karteikasten";
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("decks", { keyPath: "id" });
      db.createObjectStore("images");
      db.createObjectStore("settings");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Speichern abgebrochen"));
  });
}

export const getAllDecks = () => tx("decks", "readonly", s => s.getAll());
export const putDeck = deck => tx("decks", "readwrite", s => s.put(deck));
export const deleteDeck = id => tx("decks", "readwrite", s => s.delete(id));

export const putImage = (id, blob) => tx("images", "readwrite", s => s.put(blob, id));
export const getImage = id => tx("images", "readonly", s => s.get(id));
export const deleteImage = id => tx("images", "readwrite", s => s.delete(id));

export const getSetting = key => tx("settings", "readonly", s => s.get(key));
export const setSetting = (key, value) => tx("settings", "readwrite", s => s.put(value, key));

// Safari löscht Website-Daten sonst eventuell nach längerer Nichtnutzung
export function requestPersistence() {
  try { navigator.storage?.persist?.(); } catch (e) { /* nicht unterstützt */ }
}
