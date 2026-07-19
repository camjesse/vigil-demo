/* Vigil offline write outbox (PWA Phase 2).
 *
 * A dependency-free IndexedDB queue + sync engine for field creates. When a
 * write can't reach the server (offline / network error) it is queued with a
 * client-generated idempotency key and replayed in order on reconnect. The
 * backend's Idempotency-Key handling means a retried sync never duplicates.
 *
 * Usage from a page:
 *   const r = await VigilOutbox.post('/api/incidents', body);
 *   if (r.queued) // show "saved offline, will sync"
 *   else if (r.ok) // r.data has the server response
 *
 * Sync runs automatically on the 'online' event and on load. Pages can also
 * call VigilOutbox.sync() and subscribe via VigilOutbox.onChange(cb).
 */
(function () {
  const API = window.VIGIL_API_BASE || 'https://vigil-production-17ca.up.railway.app';
  const DB = 'vigil-outbox';
  const STORE = 'queue';
  const listeners = new Set();

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function put(item) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(item); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
  async function del(id) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
  async function all() { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const q = tx.objectStore(STORE).getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); }

  function token() {
    try { return (JSON.parse(localStorage.getItem('vigil_session') || 'null') || {}).token || null; } catch { return null; }
  }
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function notify() {
    all().then((items) => {
      const n = items.length;
      listeners.forEach((cb) => { try { cb(n); } catch {} });
      // Report queue depth up to a hosting shell (module pages run inside its
      // iframe) so a global "N pending sync" badge updates instantly on change.
      try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'VIGIL_OUTBOX', pending: n }, '*'); } catch {}
    });
  }

  // One live attempt for a queued item. Returns 'done' (synced or permanently
  // rejected), 'retry' (still offline — stop and keep it), or 'auth' handled.
  async function send(item, allowRefresh) {
    // The body is stored encrypted at rest — decrypt just before sending. A hard
    // decrypt failure means the key is gone (post-wipe), so the item is
    // unrecoverable; drop it rather than block the queue forever.
    let body;
    try { body = window.VigilCrypto ? await VigilCrypto.decrypt(item.body) : item.body; }
    catch { item.error = 'Queued item could not be decrypted'; return 'failed'; }
    let res;
    try {
      res = await fetch(API + item.path, {
        method: item.method || 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, 'Idempotency-Key': item.id },
        body: JSON.stringify(body),
      });
    } catch {
      return 'retry'; // network error → still offline
    }
    if (res.status === 401 && allowRefresh && window.vigilRefreshAccessToken) {
      const fresh = await window.vigilRefreshAccessToken();
      if (fresh) return send(item, false); // retry once with the new token
      return 'retry'; // couldn't refresh (e.g. offline) — keep it queued
    }
    if (res.ok || (res.status >= 200 && res.status < 300)) return 'done';
    // 409 = another sync (a second tab, or the shell syncing the shared queue)
    // is already replaying this key. Not a rejection — keep the item; the
    // in-flight one completes and a later sync gets the stored 2xx via the
    // idempotent replay.
    if (res.status === 409) return 'retry';
    // A 4xx that isn't auth means the write itself is invalid — don't block the
    // queue forever. Mark it failed and drop it (surfaced to the page).
    if (res.status >= 400 && res.status < 500) {
      item.error = (await res.json().catch(() => ({}))).error || `Rejected (${res.status})`;
      return 'failed';
    }
    return 'retry'; // 5xx / transient — try again later
  }

  const Outbox = {
    // Try to POST now; queue it if we're offline or the request can't be sent.
    async post(path, body, method) {
      const id = uuid();
      const online = navigator.onLine;
      if (online) {
        try {
          const res = await fetch(API + path, {
            method: method || 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, 'Idempotency-Key': id },
            body: JSON.stringify(body),
          });
          if (res.status === 401 && window.vigilRefreshAccessToken) {
            const fresh = await window.vigilRefreshAccessToken();
            if (fresh) {
              const res2 = await fetch(API + path, { method: method || 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fresh}`, 'Idempotency-Key': id }, body: JSON.stringify(body) });
              const data2 = await res2.json().catch(() => ({}));
              return { ok: res2.ok, status: res2.status, data: data2 };
            }
          }
          const data = await res.json().catch(() => ({}));
          return { ok: res.ok, status: res.status, data };
        } catch {
          // fell through to offline below
        }
      }
      // Encrypt the body at rest — queued writes can hold injury details / PII.
      const storedBody = window.VigilCrypto ? await VigilCrypto.encrypt(body) : body;
      const item = { id, path, method: method || 'POST', body: storedBody, createdAt: Date.now(), attempts: 0 };
      await put(item);
      notify();
      return { queued: true, id };
    },

    async pendingCount() { return (await all()).length; },
    async pending() { return all(); },

    // Replay the queue in order. Stops at the first item that's still offline.
    async sync() {
      const items = (await all()).sort((a, b) => a.createdAt - b.createdAt);
      const results = { synced: 0, failed: 0, remaining: 0 };
      for (const item of items) {
        item.attempts = (item.attempts || 0) + 1;
        const outcome = await send(item, true);
        if (outcome === 'done') { await del(item.id); results.synced++; }
        else if (outcome === 'failed') { await del(item.id); results.failed++; if (Outbox.onFailed) Outbox.onFailed(item); }
        else { await put(item); results.remaining++; break; } // still offline — stop, keep order
      }
      notify();
      return results;
    },

    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };

  window.VigilOutbox = Outbox;
  // Auto-sync when connectivity returns and once on load.
  window.addEventListener('online', () => Outbox.sync());
  if (navigator.onLine) setTimeout(() => Outbox.sync(), 1500);
  // Report the current queue depth on load so a hosting shell's badge is
  // accurate even before the first change this session.
  notify();
})();
