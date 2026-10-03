/* Prakash crypto: recovery phrase, Argon2id key derivation, AES-256-GCM.  No home-made primitives.
   - The recovery phrase is 12 BIP-39 words (128 bits from crypto.getRandomValues + 4-bit SHA-256 checksum). BIP-39 is used only
     to write the phrase in words; the key comes from Argon2id, not from the wallet PBKDF2 step.
   - A random 256-bit data key encrypts the journal. The phrase-derived key only wraps (encrypts) that data key.
   - Every encryption uses a fresh random 12-byte IV and a 128-bit tag; the additional authenticated data binds format, uid, record and key id.
   Nothing here ever logs or stores the phrase. */
import { WORDS } from './vendor/bip39-english.js';

export const KDF = { alg: 'argon2id', v: 19, m: 65536, t: 3, p: 1, len: 32 };   // 64 MiB, 3 passes, 1 lane, 32-byte output
const enc = new TextEncoder(), dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
const rand = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const b64e = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };
export const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/* ---------- recovery phrase ---------- */
const bitsOf = bytes => Array.from(bytes, b => b.toString(2).padStart(8, '0')).join('');
async function checksumBits(entropy) { const h = new Uint8Array(await subtle().digest('SHA-256', entropy)); return bitsOf(h.subarray(0, 1)).slice(0, entropy.length * 8 / 32); }
export async function phraseFromEntropy(entropy) {
  const bits = bitsOf(entropy) + await checksumBits(entropy), out = [];
  for (let i = 0; i < bits.length; i += 11) out.push(WORDS[parseInt(bits.slice(i, i + 11), 2)]);
  return out.join(' ');
}
export const newPhrase = () => phraseFromEntropy(rand(16));
export const normPhrase = s => String(s || '').normalize('NFKD').toLowerCase().trim().split(/\s+/).filter(Boolean).join(' ');
export async function checkPhrase(s) {
  const w = normPhrase(s).split(' ').filter(Boolean);
  if (w.length !== 12) return { ok: false, reason: 'length' };
  const idx = w.map(x => WORDS.indexOf(x)); if (idx.some(i => i < 0)) return { ok: false, reason: 'word' };
  const bits = idx.map(i => i.toString(2).padStart(11, '0')).join(''), ent = new Uint8Array(16);
  for (let i = 0; i < 16; i++) ent[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return bits.slice(128) === await checksumBits(ent) ? { ok: true, phrase: w.join(' ') } : { ok: false, reason: 'checksum' };
}

/* ---------- Argon2id (in a worker where the browser has one) ---------- */
let kdfImpl = null;
export const setKdf = fn => { kdfImpl = fn; };   // tests supply their own
function runKdf(pass, salt, p) {
  if (kdfImpl) return kdfImpl(pass, salt, p);
  return new Promise((res, rej) => {
    let w; try { w = new Worker(new URL('./prakash-kdf-worker.js', import.meta.url)); } catch (e) { return rej(Error('kdf-unavailable')); }
    w.onmessage = e => { w.terminate(); e.data && e.data.ok ? res(new Uint8Array(e.data.out)) : rej(Error('kdf-failed')); };
    w.onerror = () => { w.terminate(); rej(Error('kdf-failed')); };
    w.postMessage({ pass, salt, p });
  });
}
async function wrappingKey(phrase, salt, p) {
  const raw = await runKdf(enc.encode(normPhrase(phrase)), salt, p);
  return subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/* ---------- data key: wrap, unwrap ---------- */
const aadWrap = (uid, keyId) => enc.encode(`p1w|${uid}|${keyId}`);
const aadRec = (uid, recordId, keyId) => enc.encode(`p1|${uid}|${recordId}|${keyId}`);
export const newDataKeyBytes = () => rand(32);
export const importDataKey = bytes => subtle().importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);   // never extractable
export async function wrapDataKey(phrase, uid, keyId, dataKeyBytes) {
  const salt = rand(16), iv = rand(12), k = await wrappingKey(phrase, salt, KDF);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, tagLength: 128, additionalData: aadWrap(uid, keyId) }, k, dataKeyBytes));
  return { v: 1, keyId, kdf: { ...KDF, salt: b64e(salt) }, iv: b64e(iv), wrapped: b64e(ct) };
}
export async function unwrapDataKey(phrase, uid, doc) {
  if (!doc || doc.v !== 1 || !doc.kdf || doc.kdf.alg !== 'argon2id') throw Error('key-format');
  const k = await wrappingKey(phrase, b64d(doc.kdf.salt), doc.kdf);
  let raw; try { raw = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: b64d(doc.iv), tagLength: 128, additionalData: aadWrap(uid, doc.keyId) }, k, b64d(doc.wrapped))); } catch (e) { throw Error('wrong-phrase'); }
  try { return await importDataKey(raw); } finally { raw.fill(0); }
}

/* ---------- records ---------- */
export async function encryptRecord(key, uid, recordId, keyId, obj) {
  const iv = rand(12), ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, tagLength: 128, additionalData: aadRec(uid, recordId, keyId) }, key, enc.encode(JSON.stringify(obj))));
  return { iv: b64e(iv), ct: b64e(ct) };
}
export async function decryptRecord(key, uid, recordId, keyId, box) {
  let plain; try { plain = await subtle().decrypt({ name: 'AES-GCM', iv: b64d(box.iv), tagLength: 128, additionalData: aadRec(uid, recordId, keyId) }, key, b64d(box.ct)); } catch (e) { throw Error('record-auth'); }
  return JSON.parse(dec.decode(plain));
}
