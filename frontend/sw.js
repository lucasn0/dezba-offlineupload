// Dezba Service Worker
// Handles app-shell caching + Background Sync for offline upload queue

importScripts('/config.js'); // provides DEZBA_API_URL global

const CACHE    = 'dezba-v1';
const SYNC_TAG = 'sync-uploads';

const SHELL = [
  '/',
  '/index.html',
  '/config.js',
  '/css/style.css',
  '/scripts/db.js',
  '/scripts/app.js',
  '/imgs/dezba_logo_PNG.png'
];

// ── LIFECYCLE ────────────────────────────────────────────────

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── FETCH (cache-first for shell, network-first for API) ─────

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return; // let API calls fall through

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

// ── BACKGROUND SYNC ──────────────────────────────────────────
// Fires when connectivity returns, even if all tabs are closed

self.addEventListener('sync', e => {
  if (e.tag === SYNC_TAG) {
    e.waitUntil(syncPendingUploads());
  }
});

async function syncPendingUploads() {
  const db      = await openDB();
  const pending = await getAllPending(db);

  for (const item of pending) {
    try {
      const res = await fetch(`${DEZBA_API_URL}/api/upload`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:        item.name,
          description: item.description,
          img_base64:  item.img_base64,
          img_type:    item.img_type
        })
      });

      if (res.ok) {
        await deletePending(db, item.id);
        broadcast({ type: 'UPLOAD_SUCCESS', name: item.name });
      }
    } catch {
      // Network still unreliable — will retry on next sync opportunity
    }
  }

  broadcast({ type: 'SYNC_COMPLETE' });
}

function broadcast(msg) {
  self.clients
    .matchAll({ includeUncontrolled: true })
    .then(clients => clients.forEach(c => c.postMessage(msg)));
}

// ── INDEXEDDB (mirrored here — SW can't import from db.js) ───

const _DB  = 'dezba-uploads';
const _VER = 1;
const _ST  = 'pending';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_DB, _VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(_ST))
        db.createObjectStore(_ST, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

function getAllPending(db) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(_ST, 'readonly').objectStore(_ST).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function deletePending(db, id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(_ST, 'readwrite').objectStore(_ST).delete(id);
    req.onsuccess = resolve;
    req.onerror   = () => reject(req.error);
  });
}
