/* Runs Argon2id off the main thread so the screen stays responsive. Receives { pass, salt, p }, answers { ok, out }. */
importScripts('./vendor/argon2.umd.min.js');
self.onmessage = async e => {
  try {
    const { pass, salt, p } = e.data;
    const out = await self.hashwasm.argon2id({ password: pass, salt, parallelism: p.p, iterations: p.t, memorySize: p.m, hashLength: p.len, outputType: 'binary' });
    self.postMessage({ ok: true, out: out.buffer }, [out.buffer]);
  } catch (err) { self.postMessage({ ok: false }); }
};
