// SwingLab — session history persisted in the browser via IndexedDB.
// Each record: { id, date, name, overall, swings, report, agg, measures,
//               frames, videoBlob? }  (videoBlob omitted for oversized files)

const DB_NAME = 'swinglab';
const STORE = 'sessions';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function saveSession(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Light listing: everything except the heavy fields, newest first.
export async function listSessions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = tx(db, 'readonly').openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) { resolve(out.sort((a, b) => b.date - a.date)); return; }
      const v = cur.value;
      out.push({
        id: v.id, date: v.date, name: v.name, overall: v.overall,
        swings: v.swings, hasVideo: !!v.videoBlob,
      });
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getSession(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readonly').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSession(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
