document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
      navigator.serviceWorker.addEventListener('message', onSWMessage);
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  }

  updateConnectionStatus();
  await updatePendingCount();

  if (navigator.onLine) {
    triggerSync();
    loadRecentUploads();
  }

  window.addEventListener('online', async () => {
    updateConnectionStatus();
    showToast('Back online — uploading queued entries…', 'info');
    triggerSync();
    loadRecentUploads();
  });

  window.addEventListener('offline', () => {
    updateConnectionStatus();
    showToast('No connection — entries will be saved and synced later.', 'warning');
  });

  document.getElementById('uploadForm').addEventListener('submit', handleSubmit);
  document.getElementById('imgInput').addEventListener('change', handleImagePreview);
});

// ── FORM SUBMIT ──────────────────────────────────────────────

async function handleSubmit(e) {
  e.preventDefault();

  const name        = document.getElementById('nameInput').value.trim();
  const description = document.getElementById('descInput').value.trim();
  const file        = document.getElementById('imgInput').files[0];

  if (!name) { showToast('Truck / license plate is required.', 'error'); return; }

  setSubmitting(true);
  try {
    let img_base64 = null;
    let img_type   = null;

    if (file) {
      const r   = await readFileAsBase64(file);
      img_base64 = r.base64;
      img_type   = r.type;
    }

    const payload = { name, description, img_base64, img_type };

    if (navigator.onLine) {
      const ok = await tryDirectUpload(payload);
      if (ok) { resetForm(); loadRecentUploads(); return; }
    }

    // Queue for later (offline OR direct upload failed)
    await savePending(payload);
    await updatePendingCount();
    await triggerSync();
    showToast('Entry saved offline — will sync automatically when connected.', 'warning');
    resetForm();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    setSubmitting(false);
  }
}

// ── UPLOAD ───────────────────────────────────────────────────

async function tryDirectUpload(payload) {
  try {
    const res = await fetch(`${DEZBA_API_URL}/api/upload`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    if (res.ok) {
      showToast(`"${payload.name}" uploaded successfully!`, 'success');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── SYNC ─────────────────────────────────────────────────────

async function triggerSync() {
  const pending = await getAllPending();
  if (pending.length === 0) return;

  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.ready;
    if ('sync' in reg) {
      // Background Sync — fires even when tab is closed
      await reg.sync.register('sync-uploads');
      return;
    }
  }

  // Fallback for Firefox / Safari (no Background Sync)
  if (navigator.onLine) syncFromMainThread();
}

async function syncFromMainThread() {
  const pending = await getAllPending();
  for (const item of pending) {
    try {
      const res = await fetch(`${DEZBA_API_URL}/api/upload`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:       item.name,
          description: item.description,
          img_base64:  item.img_base64,
          img_type:    item.img_type
        })
      });
      if (res.ok) {
        await deletePending(item.id);
        showToast(`"${item.name}" uploaded!`, 'success');
      }
    } catch { /* keep in queue */ }
  }
  await updatePendingCount();
  loadRecentUploads();
}

function onSWMessage(e) {
  if (e.data.type === 'UPLOAD_SUCCESS') {
    showToast(`"${e.data.name}" uploaded!`, 'success');
  }
  if (e.data.type === 'SYNC_COMPLETE') {
    updatePendingCount();
    loadRecentUploads();
  }
}

// ── RECENT UPLOADS ───────────────────────────────────────────

async function loadRecentUploads() {
  const section   = document.getElementById('uploadsSection');
  const container = document.getElementById('recentUploads');
  if (!navigator.onLine) return;

  try {
    const res     = await fetch(`${DEZBA_API_URL}/api/uploads`);
    if (!res.ok) throw new Error();
    const uploads = await res.json();

    if (!uploads.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    container.innerHTML = uploads.map(u => `
      <div class="upload-card">
        ${u.img_type
          ? `<img src="${DEZBA_API_URL}/api/upload/${u.id}/image" alt="${esc(u.name)}" class="upload-thumb" loading="lazy">`
          : `<div class="no-thumb">No photo</div>`
        }
        <div class="upload-info">
          <div class="upload-name">${esc(u.name)}</div>
          ${u.description ? `<div class="upload-desc">${esc(u.description)}</div>` : ''}
          <div class="upload-time">${fmtDate(u.created_at)}</div>
        </div>
      </div>
    `).join('');
  } catch { /* offline or backend unreachable */ }
}

// ── UI HELPERS ───────────────────────────────────────────────

async function updatePendingCount() {
  const count = await getPendingCount();
  const wrap  = document.getElementById('pendingWrap');
  const badge = document.getElementById('pendingBadge');
  badge.textContent    = count;
  wrap.style.display   = count > 0 ? 'flex' : 'none';
}

function updateConnectionStatus() {
  const dot   = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  const banner = document.getElementById('offlineBanner');
  const online = navigator.onLine;

  dot.className      = 'status-dot ' + (online ? 'online' : 'offline');
  label.textContent  = online ? 'Online' : 'Offline';
  banner.style.display = online ? 'none' : 'flex';
}

function handleImagePreview(e) {
  const file      = e.target.files[0];
  const preview   = document.getElementById('imgPreview');
  const container = document.getElementById('previewContainer');
  if (file) {
    preview.src            = URL.createObjectURL(file);
    container.style.display = 'inline-block';
  } else {
    container.style.display = 'none';
  }
}

function removeImage() {
  document.getElementById('imgInput').value = '';
  document.getElementById('previewContainer').style.display = 'none';
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve({ base64: e.target.result.split(',')[1], type: file.type });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resetForm() {
  document.getElementById('uploadForm').reset();
  document.getElementById('previewContainer').style.display = 'none';
}

function setSubmitting(state) {
  const btn  = document.getElementById('submitBtn');
  const text = document.getElementById('submitBtnText');
  btn.disabled    = state;
  text.textContent = state ? 'Submitting…' : 'Submit Entry';
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el        = document.createElement('div');
  el.className    = `toast toast-${type}`;
  el.textContent  = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function fmtDate(s) {
  return new Date(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
