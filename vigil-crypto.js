/* Vigil at-rest encryption for the offline stores (PWA Phase 2).
 *
 * Wraps sensitive on-device data (cached worker emergency profiles / medical
 * alerts, queued write bodies) in AES-GCM before it lands in IndexedDB. The key
 * is a NON-EXTRACTABLE CryptoKey held in its own `vigil-keys` database: its raw
 * bytes are never exposed to JS and never sit in a DB file as usable plaintext,
 * and it is destroyed on logout. This raises the bar against casual disk
 * inspection, other apps reading the origin's IndexedDB files, and forensic
 * recovery — it does NOT (and in a browser cannot) defend against code already
 * running in this origin. That residual risk is covered by wipe-on-logout.
 *
 * Usage:
 *   const blob = await VigilCrypto.encrypt(value);   // {__enc,iv,ct}
 *   const value = await VigilCrypto.decrypt(blob);    // legacy plaintext passes through
 *   await VigilCrypto.wipe();                          // drop the key (logout)
 *
 * Degrades gracefully: if crypto.subtle is unavailable (e.g. insecure context),
 * encrypt() returns the value unchanged and decrypt() is a no-op, so offline
 * still works — just unencrypted, as before.
 */
(function () {
  const KEYDB = 'vigil-keys';
  const STORE = 'keys';
  const KEYID = 'offline-key';
  const subtle = (window.crypto && window.crypto.subtle) || null;
  const encTxt = new TextEncoder();
  const decTxt = new TextDecoder();

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(KEYDB, 1);
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kvGet(k) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const q = tx.objectStore(STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  async function kvPut(k, v) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }

  let keyPromise = null;
  function getKey() {
    if (!subtle) return Promise.resolve(null);
    if (keyPromise) return keyPromise;
    keyPromise = (async () => {
      let key = await kvGet(KEYID).catch(() => null);
      if (key) return key;
      // extractable = false: the raw key can never leave the crypto subsystem.
      key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await kvPut(KEYID, key).catch(() => {});
      return key;
    })();
    return keyPromise;
  }

  const VigilCrypto = {
    available() { return !!subtle; },

    // Encrypt a JSON-able value → {__enc:1, iv, ct}. If crypto is unavailable,
    // returns the value unchanged so callers can store it as-is.
    async encrypt(value) {
      const key = await getKey();
      if (!key) return value;
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encTxt.encode(JSON.stringify(value)));
      return { __enc: 1, iv, ct };
    },

    // Decrypt a blob produced by encrypt(). Legacy plaintext (no __enc marker)
    // and null pass through untouched, so pre-encryption data still reads.
    async decrypt(blob) {
      if (!blob || blob.__enc !== 1) return blob;
      const key = await getKey();
      if (!key) throw new Error('offline key unavailable');
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: blob.iv }, key, blob.ct);
      return JSON.parse(decTxt.decode(pt));
    },

    // Drop the key database so any remaining ciphertext becomes undecryptable.
    async wipe() {
      keyPromise = null;
      return new Promise((res) => {
        let done = false; const finish = () => { if (!done) { done = true; res(); } };
        try { const r = indexedDB.deleteDatabase(KEYDB); r.onsuccess = finish; r.onerror = finish; r.onblocked = finish; }
        catch { finish(); }
        setTimeout(finish, 600);
      });
    },
  };

  window.VigilCrypto = VigilCrypto;
})();
