/* Prakash sign-in (Google, through Firebase Authentication) and the Firestore transport used by the sync engine.
   Firebase is loaded only when the person opens Account and sync AND firebase-config.js has been filled in. Nothing here runs at startup.
   Pinned to one Firebase version. No Analytics, no Storage, no Functions. */
const V = '12.18.0', BASE = 'https://www.gstatic.com/firebasejs/' + V + '/';
let fb = null, loading = null;

export async function configState() {
  try { const m = await import('./firebase-config.js'); return m.firebaseConfigured && m.firebaseConfig && m.firebaseConfig.apiKey ? { ok: true, config: m.firebaseConfig } : { ok: false, why: 'not-configured' }; }
  catch (e) { return { ok: false, why: 'no-config-file' }; }
}
export function warm() {
  if (fb) return Promise.resolve(fb); if (loading) return loading;
  loading = (async () => {
    const c = await configState(); if (!c.ok) throw Error(c.why);
    const [app, auth, fs] = await Promise.all([import(BASE + 'firebase-app.js'), import(BASE + 'firebase-auth.js'), import(BASE + 'firebase-firestore.js')]);
    const a = app.initializeApp(c.config), au = auth.getAuth(a), db = fs.getFirestore(a);
    let persist = true; try { await auth.setPersistence(au, auth.browserLocalPersistence); } catch (e) { persist = false; }
    fb = { app, auth, fs, a, au, db, persist }; return fb;
  })().catch(e => { loading = null; throw e; });
  return loading;
}
export const ready = () => !!fb;
export function onUser(cb) { return fb.auth.onAuthStateChanged(fb.au, u => cb(u ? { uid: u.uid, email: u.email || '', name: u.displayName || '' } : null)); }
export function currentUser() { const u = fb && fb.au.currentUser; return u ? { uid: u.uid, email: u.email || '' } : null; }
const isNative = () => { try { return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()); } catch (e) { return false; } };
/* On the web this must be called straight from a tap, with nothing awaited before it, so the browser allows the popup.
   In the Android app there is no popup: the phone's own Google sign-in sheet gives back a Google ID token, which signs in to Firebase. */
export function signIn() {
  if (isNative()) return (async () => {
    const P = window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseAuthentication; if (!P) throw Object.assign(Error('no-plugin'), { code: 'native/no-plugin' });
    const r = await P.signInWithGoogle({ skipNativeAuth: true }), idToken = r && r.credential && r.credential.idToken;
    if (!idToken) throw Object.assign(Error('no-token'), { code: 'native/no-token' });
    return fb.auth.signInWithCredential(fb.au, fb.auth.GoogleAuthProvider.credential(idToken));
  })();
  const p = new fb.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return fb.auth.signInWithPopup(fb.au, p);
}
export async function signOutUser() { if (isNative()) { try { await window.Capacitor.Plugins.FirebaseAuthentication.signOut(); } catch (e) {} } return fb.auth.signOut(fb.au); }
export const persistenceOk = () => !!(fb && fb.persist);

/* ---- Firestore: only ever below users/{uid}/ ---- */
const col = (uid, store) => fb.fs.collection(fb.db, 'users', uid, store);
export function makeIo(uid) {
  const { fs } = fb;
  return {
    async write(store, id, doc) {
      const ref = fs.doc(fb.db, 'users', uid, store, id);
      return fs.runTransaction(fb.db, async tx => {
        const cur = await tx.get(ref);
        if (cur.exists()) { const r = cur.data().rev, c = r ? (r.w - doc.rev.w) || (r.c - doc.rev.c) || String(r.d).localeCompare(String(doc.rev.d)) : -1;
          if (doc.rev.w === 0 || c > 0) return 'stale';   // a first-sync placeholder (w = 0) never replaces a record that already exists
          if (c === 0) return 'same'; }
        tx.set(ref, { ...doc, srv: fs.serverTimestamp() }); return 'written';
      });
    },
    listen(store, since, cb, onErr) {
      const q = fs.query(col(uid, store), fs.where('srv', '>', fs.Timestamp.fromMillis(Math.max(0, since - 60000))));
      return fs.onSnapshot(q, snap => cb(snap.docChanges().filter(ch => ch.type !== 'removed' && !ch.doc.metadata.hasPendingWrites).map(ch => { const d = ch.doc.data(); return { id: ch.doc.id, ...d, srv: d.srv && d.srv.toMillis ? d.srv.toMillis() : 0 }; })), e => onErr && onErr(e));
    },
    async keyDocs() { const s = await fs.getDocs(col(uid, 'journalKeys')); return s.docs.map(d => ({ id: d.id, ...d.data() })); },
    async createKeyOnce(keyId, doc) {   // create-once: two first devices can never replace each other's key
      const ref = fs.doc(fb.db, 'users', uid, 'journalKeys', keyId);
      return fs.runTransaction(fb.db, async tx => { const cur = await tx.get(ref); if (cur.exists()) return 'exists'; tx.set(ref, { ...doc, srv: fs.serverTimestamp() }); return 'created'; });
    }
  };
}
export function plainError(e) {
  const c = String((e && (e.code || e.message)) || '');
  if (/popup-closed|cancelled-popup|user-cancelled|cancel/i.test(c)) return { quiet: true };
  if (/native\/no-plugin/.test(c)) return { text: 'Google sign-in is not part of this build of the app.' };
  if (/no credential|NoCredential|12500|10:|developer.?error|DEVELOPER_ERROR/i.test(c)) return { text: 'Google did not accept this app yet. The app’s fingerprint may not be registered in Firebase.' };
  if (/popup-blocked/.test(c)) return { text: 'The browser blocked the sign-in window. Allow pop-ups for this page, or open Prakash in your normal browser.' };
  if (/unauthorized-domain/.test(c)) return { text: 'This web address is not on the allowed list in Firebase yet. Add it under Authentication, Settings, Authorized domains.' };
  if (/operation-not-allowed/.test(c)) return { text: 'Google sign-in is not switched on in Firebase yet.' };
  if (/network|unavailable/.test(c)) return { text: 'No connection just now. Your records are safe on this phone. Try again when you are online.' };
  return { text: 'Sign-in did not work this time. Nothing on this phone changed.' };
}
