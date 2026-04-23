// IndexedDB helpers — shared between app.js (main thread) and referenced by sw.js

const _DB_NAME    = 'dezba-uploads';
const _DB_VERSION = 1;
const _STORE      = 'pending';

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_DB_NAME, _DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(_STORE)) {
        db.createObjectStore(_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

async function savePending(item) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_STORE, 'readwrite');
    const req = tx.objectStore(_STORE).add(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function getAllPending() {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_STORE, 'readonly');
    const req = tx.objectStore(_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function deletePending(id) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_STORE, 'readwrite');
    const req = tx.objectStore(_STORE).delete(id);
    req.onsuccess = resolve;
    req.onerror   = () => reject(req.error);
  });
}

async function getPendingCount() {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_STORE, 'readonly');
    const req = tx.objectStore(_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
