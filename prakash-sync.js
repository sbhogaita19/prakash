/* Prakash sync engine. Storage-agnostic and Firebase-agnostic, so it can be tested with a fake store.
   What it does, in plain words:
   - It notices which records changed on this phone (by comparing a fingerprint with the last one it saw) and queues each change.
   - Each change carries a revision (wall clock, counter, device id). When two devices change the same record, the higher revision wins
     (last write wins). Device clocks can be wrong, so this is a trade-off, not a promise of correctness. Different records never clash.
   - Deletes are kept as tombstones, so an offline device cannot bring a deleted record back.
   - Local saving never waits for the network. Nothing is marked "synced" until the server has acknowledged it.
   - Journal records arrive here already encrypted (iv + ct). This file never sees journal plaintext of its own accord: it is handed
     `enc.seal` / `enc.open` by the caller, and it never logs record contents. */

export const cmpRev = (a, b) => (a.w - b.w) || (a.c - b.c) || String(a.d).localeCompare(String(b.d));
export const hlcNext = (h, now) => { const w = Math.max(now, h.w); return { w, c: w === h.w ? h.c + 1 : 0 }; };
export const hlcSee = (h, r, now) => { const w = Math.max(now, h.w, r.w); const c = w === h.w && w === r.w ? Math.max(h.c, r.c) + 1 : w === h.w ? h.c + 1 : w === r.w ? r.c + 1 : 0; return { w, c }; };
export const MAX_DOC = 900000;   // bytes of text in one record; Firestore's own limit is about 1 MiB
export function fp(str) {        // cyrb53: a quick non-cryptographic fingerprint, only to spot changes
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export function classify(e) {
  const c = String((e && (e.code || e.message)) || '').toLowerCase();
  if (/permission-denied/.test(c)) return 'rules';
  if (/resource-exhausted|quota/.test(c)) return 'quota';
  if (/unauthenticated|auth\//.test(c)) return 'auth';
  if (/unavailable|network|offline|failed-precondition|deadline|aborted|timeout|fetch/.test(c)) return 'network';
  if (/toolarge/.test(c)) return 'toolarge';
  return 'other';
}

/* cfg:
     uid, deviceId, now(), io { write(store, id, doc) -> 'written'|'stale', listen(store, sinceMs, onDocs, onErr) -> unsub },
     adapter { plain() -> Map(id -> {type, obj}), journal() -> Map(id -> {type, obj}),
               applyPlain(id, obj|null), applyJournal(id, obj|null), after() },
     enc { ready() -> {keyId} | null, seal(id, obj) -> {iv, ct}, open(id, keyId, box) -> obj },
     state { load() -> st, save(st) }   st = { rec:{id:{h,rev,st}}, since:{records,journal}, hlc:{w,c}, lost:[] }
     queue { load() -> ops[], save(ops) }
     onStatus(status) */
export function createEngine(cfg) {
  const { uid, deviceId, io, adapter, enc, state, queue, onStatus } = cfg, now = cfg.now || (() => Date.now());
  let st = state.load() || {}; st.rec = st.rec || {}; st.since = st.since || { records: 0, journal: 0 }; st.hlc = st.hlc || { w: 0, c: 0 }; st.lost = st.lost || [];
  let ops = queue.load() || [], journalListening = false, unsubs = [], timer = null, scanTimer = null, running = false, attempts = 0, stopped = true, err = null, lastSync = st.lastSync || 0, online = true, held = false;
  const persist = () => { st.lastSync = lastSync; state.save(st); queue.save(ops); };
  const status = () => ({ state: stopped ? 'off' : err ? 'error' : held ? 'locked' : !online ? 'offline' : running ? 'syncing' : 'idle', pending: ops.length, lastSync, error: err });
  const emit = () => { try { onStatus && onStatus(status()); } catch (e) {} };
  const fpRec = (type, obj) => fp(type + '|' + JSON.stringify(obj));
  const keepLost = (key, rec) => { st.lost.push({ key, at: now(), type: rec.type, json: JSON.stringify(rec.obj).slice(0, 4000) }); st.lost = st.lost.slice(-200); };

  /* ---- find what changed on this phone, and queue it ---- */
  async function scan(opts) {
    opts = opts || {}; const seen = new Set(); let added = 0;
    const enqueue = op => { ops = ops.filter(o => !(o.store === op.store && o.id === op.id)); ops.push(op); added++; };
    const sources = [['records', adapter.plainReady() ? adapter.plain() : null], ['journal', enc.ready() && adapter.journalReady() ? adapter.journal() : null]];
    for (const [store, map] of sources) {
      if (!map) continue;
      for (const [id, { type, obj }] of map) {
        const key = store + ':' + id; seen.add(key); const h = fpRec(type, obj), m = st.rec[key];
        if (m && m.h === h) continue;
        const rev = opts.adopt && !m ? { w: 0, c: 0, d: deviceId } : (st.hlc = hlcNext(st.hlc, now()), { w: st.hlc.w, c: st.hlc.c, d: deviceId });
        const op = { store, id, type, rev, deleted: false };
        if (store === 'records') { op.json = JSON.stringify(obj); if (op.json.length > MAX_DOC) { err = { kind: 'toolarge' }; continue; } }
        else { const k = enc.ready(); op.box = await enc.seal(id, { type, obj }); op.keyId = k.keyId; }
        st.rec[key] = { h, rev, st: 'pending' }; enqueue(op);
      }
    }
    const gone = Object.keys(st.rec).filter(key => { const sk = key.split(':')[0]; return !seen.has(key) && !st.rec[key].gone && ((sk === 'records' && sources[0][1]) || (sk === 'journal' && sources[1][1])); });
    if (gone.length > 10 && gone.length > Object.keys(st.rec).length / 2 && !opts.allowMass) { err = { kind: 'massdelete', count: gone.length }; persist(); emit(); return added; }   // a wipe is never sent silently
    for (const key of gone) {            // gone on this phone: a tombstone
      const [store, ...r] = key.split(':'), id = r.join(':');
      st.hlc = hlcNext(st.hlc, now()); const rev = { w: st.hlc.w, c: st.hlc.c, d: deviceId };
      st.rec[key] = { h: 'gone', rev, st: 'pending', gone: true }; enqueue({ store, id, type: 'gone', rev, deleted: true });
    }
    persist(); emit(); if (added || ops.length) kick(0);
    return added;
  }

  /* ---- send queued changes, one at a time, oldest first ---- */
  async function flush() {
    if (running || stopped) return; running = true; emit();
    try {
      while (ops.length && !stopped) {
        const op = ops[0], key = op.store + ':' + op.id;
        const doc = op.deleted ? { type: op.type, rev: op.rev, w: op.rev.w, deleted: true, schema: 1 }
          : op.store === 'records' ? { type: op.type, rev: op.rev, w: op.rev.w, deleted: false, json: op.json, schema: 1 }
          : { type: op.type, rev: op.rev, w: op.rev.w, deleted: false, iv: op.box.iv, ct: op.box.ct, keyId: op.keyId, schema: 1 };
        const r = await io.write(op.store, op.id, doc);
        ops = ops.filter(o => o !== op);
        if ((r === 'written' || r === 'same') && st.rec[key] && cmpRev(st.rec[key].rev, op.rev) === 0) st.rec[key].st = 'synced';   // 'stale' means the cloud holds a newer one; it arrives by the listener
        lastSync = now(); attempts = 0; err = null; persist(); emit();
      }
    } catch (e) {
      const k = classify(e);
      if (k === 'network') { online = false; attempts++; if (attempts <= 6) kick(Math.min(300000, 2000 * 2 ** attempts)); }
      else { err = { kind: k }; }
    } finally { running = false; persist(); emit(); }
  }
  function kick(ms) { if (stopped) return; clearTimeout(timer); timer = setTimeout(flush, ms); }

  /* ---- take in what other devices wrote ---- */
  async function onDocs(store, docs) {
    let changed = false, maxSrv = st.since[store] || 0;
    for (const d of docs) {
      if (d.srv && d.srv > maxSrv) maxSrv = d.srv;
      const key = store + ':' + d.id, m = st.rec[key], rev = d.rev; if (!rev) continue;
      st.hlc = hlcSee(st.hlc, rev, now());
      if (m && cmpRev(m.rev, rev) >= 0 && !(m.rev.w === 0 && m.st === 'pending')) continue;   // we already hold this or something newer (a first-sync placeholder always gives way to what the cloud already holds)
      if (store === 'journal' && !d.deleted && !enc.ready()) { held = true; maxSrv = Math.min(maxSrv, st.since[store] || 0); continue; }   // locked: leave it for after unlock
      let obj = null, type = d.type;
      if (!d.deleted) {
        if (store === 'records') { try { obj = JSON.parse(d.json); } catch (e) { continue; } }
        else { try { const o = await enc.open(d.id, d.keyId, { iv: d.iv, ct: d.ct }); obj = o.obj; type = o.type; } catch (e) { err = { kind: 'decrypt' }; continue; } }
      }
      // a record that differs on this phone and was never confirmed synced loses to the cloud version: keep the phone's copy aside
      if (m && m.st === 'pending' && !m.gone) { const loc = (store === 'records' ? adapter.plain() : adapter.journal()).get(d.id); if (loc) keepLost(key, loc); }
      if (store === 'records') adapter.applyPlain(d.id, d.deleted ? null : { type, obj }); else adapter.applyJournal(d.id, d.deleted ? null : { type, obj });
      const cur = (store === 'records' ? adapter.plain() : adapter.journal()).get(d.id);
      st.rec[key] = d.deleted ? { h: 'gone', rev, st: 'synced', gone: true } : { h: cur ? fpRec(cur.type, cur.obj) : fpRec(type, obj), rev, st: 'synced' };
      ops = ops.filter(o => !(o.store === store && o.id === d.id && cmpRev(o.rev, rev) < 0));
      changed = true;
    }
    if (!(store === 'journal' && held)) st.since[store] = maxSrv;
    online = true; err = err && err.kind === 'decrypt' ? err : null; lastSync = now(); persist();
    if (changed) { try { adapter.after(); } catch (e) {} } emit();
  }

  return {
    status,
    stats: () => ({ pending: ops.length, tracked: Object.keys(st.rec).length }),
    lost: () => st.lost.slice(),
    async start(opts) {
      opts = opts || {}; stopped = false; held = false; emit();
      await scan(opts.adopt ? { adopt: true } : {});   // anything changed while sync was not running is queued now
      unsubs.push(io.listen('records', st.since.records, d => onDocs('records', d), e => { const k = classify(e); if (k === 'network') { online = false; } else err = { kind: k }; emit(); }));
      if (enc.ready()) { journalListening = true; unsubs.push(io.listen('journal', st.since.journal, d => onDocs('journal', d), e => { const k = classify(e); if (k === 'network') { online = false; } else err = { kind: k }; emit(); })); }
      kick(0);
    },
    stop() { stopped = true; journalListening = false; clearTimeout(timer); clearTimeout(scanTimer); unsubs.forEach(u => { try { u(); } catch (e) {} }); unsubs = []; emit(); },
    scan, flush,
    scanSoon() { clearTimeout(scanTimer); scanTimer = setTimeout(() => scan(), 1200); },
    retry() { err = null; attempts = 0; online = true; emit(); kick(0); },
    online() { online = true; attempts = 0; kick(0); },
    offline() { online = false; emit(); },
    async unlocked() { held = false; if (!journalListening && !stopped) { journalListening = true; st.since.journal = 0; unsubs.push(io.listen('journal', 0, d => onDocs('journal', d), e => { err = { kind: classify(e) }; emit(); })); } await scan(); },
    confirmMass() { err = null; return scan({ allowMass: true }); },
    markSeen(store, id, type, obj, rev) { st.rec[store + ':' + id] = { h: fpRec(type, obj), rev: rev || { w: 0, c: 0, d: deviceId }, st: 'synced' }; persist(); },
    forget() { st = { rec: {}, since: { records: 0, journal: 0 }, hlc: { w: 0, c: 0 }, lost: [] }; ops = []; persist(); }
  };
}
