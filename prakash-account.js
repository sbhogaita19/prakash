/* Prakash account storage: everything that belongs to a signed-in account lives here, apart from the guest workspace.
   - keys:    the journal data key as a NON-EXTRACTABLE CryptoKey (never raw bytes), per uid, so the journal opens offline.
   - journal: each journal record sealed (AES-GCM) on its own, per uid.
   - drafts:  a half-written journal entry, sealed.
   Nothing here ever holds the recovery phrase or the wrapping key. */
const DB = 'prakashAccount';
let dbp = null;
function open() {
  return dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('keys'); d.createObjectStore('journal'); d.createObjectStore('drafts'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
}
const tx = (store, mode, fn) => open().then(db => new Promise((res, rej) => { const t = db.transaction(store, mode), s = t.objectStore(store); let out; const q = fn(s); if (q) q.onsuccess = () => { out = q.result; }; t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }));

export async function keyPersistenceWorks() {   // can a CryptoKey be kept in IndexedDB on this browser?
  try { const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']); await tx('keys', 'readwrite', s => s.put({ key: k }, '__probe')); const g = await tx('keys', 'readonly', s => s.get('__probe')); await tx('keys', 'readwrite', s => s.delete('__probe')); return !!(g && g.key); } catch (e) { return false; }
}
export const putKey = (uid, key, keyId) => tx('keys', 'readwrite', s => s.put({ key, keyId }, uid));
export const getKey = uid => tx('keys', 'readonly', s => s.get(uid));
export const delKey = uid => tx('keys', 'readwrite', s => s.delete(uid));

const jk = (uid, id) => uid + '|' + id;
export const putJournal = (uid, id, box) => tx('journal', 'readwrite', s => s.put(box, jk(uid, id)));
export const delJournal = (uid, id) => tx('journal', 'readwrite', s => s.delete(jk(uid, id)));
export async function allJournal(uid) {
  const db = await open();
  return new Promise((res, rej) => { const out = []; const r = db.transaction('journal', 'readonly').objectStore('journal').openCursor(IDBKeyRange.bound(uid + '|', uid + '|￿')); r.onsuccess = () => { const c = r.result; if (c) { out.push({ id: String(c.key).slice(uid.length + 1), box: c.value }); c.continue(); } else res(out); }; r.onerror = () => rej(r.error); });
}
export const putDraft = (uid, box) => tx('drafts', 'readwrite', s => s.put(box, uid));
export const getDraft = uid => tx('drafts', 'readonly', s => s.get(uid));
export const delDraft = uid => tx('drafts', 'readwrite', s => s.delete(uid));
