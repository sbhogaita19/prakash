# Prakash 1.17.0: account, sync and the encrypted journal

Optional, and off until you add your Firebase config. Without it, Prakash works exactly as before, fully on the phone.

## Setting it up (you do this, in your own browser)
1. Download an encrypted backup first (You > Backup and restore).
2. Firebase console: create a project on the free Spark plan. No card, no Blaze, no Analytics.
3. Authentication > Sign-in method: switch on Google. Authentication > Settings > Authorized domains: add `sbhogaita19.github.io` (hostname only).
4. Firestore Database: create the default database, Standard edition, **production mode**. You choose the region yourself, and it cannot be changed (London, europe-west2, is the usual UK choice).
5. Firestore > Rules: paste `firestore.rules` from this folder and Publish. Never use test-mode rules.
6. Project settings > Your apps > add a Web app. Do not turn on Hosting. Copy only the `firebaseConfig` object.
7. Put it into `firebase-config.js` and set `firebaseConfigured = true`. Never paste a service-account key or a recovery phrase anywhere.
8. Upload the new files to GitHub Pages as usual. Sign in yourself: normal browser first, then the installed web app, then a second device and a recovery.

## What syncs
- **Encrypted on the phone before it leaves it** (AES-256-GCM, one random data key): journal entries (every answer, tags, layer), moments (words, who, where, how it felt; the photo stays local), gratitude lines, weekly notes, reading notes, notes on talks, the Stop note.
- **Synced as ordinary records, not end-to-end encrypted:** each day's log (food, steps, water, sleep, stress, gut and symptoms, including notes typed on those), weight, waist, blood pressure, workouts, sittings, the talks marked heard, and a profile allowlist (goals, targets, height, date of birth, sex, units, day times, sections shown).
- **Never leaves the phone:** photos, voice notes, Gemini and other AI keys, the training plan and history, saved dishes and favourites, timers, caches.

## How the journal key works
- A random 256-bit data key encrypts each journal record on its own, with a fresh 12-byte IV every time, a 128-bit tag, and the format, uid, record id and key id bound in as authenticated data.
- The data key is wrapped (AES-256-GCM) by a key made from your 12 recovery words with **Argon2id v1.3**: random 16-byte salt, 64 MiB, 3 passes, 1 lane, 32-byte output. These parameters are stored beside the wrapped key.
- The 12 words are a BIP-39 phrase (128 random bits plus a checksum). BIP-39 is only the way the words are written; the key comes from Argon2id.
- Cloud holds only: the wrapped key, its IV, salt, parameters and key id; and per journal record the ciphertext, IV, key id, a revision, a deleted flag and a record type.
- Google sign-in is not the journal key. The phrase is never saved, copied, logged or sent. On a new device: sign in, enter the phrase, the key is unwrapped locally.
- The unwrapped key is kept as a **non-extractable** CryptoKey in this browser's storage so the journal opens offline. If a browser cannot keep it, you enter the phrase on each open.
- **If you lose every device and the phrase, the journal cannot be recovered.** Google cannot help.

## How records are merged
- Each record has a revision (clock time, a counter, device id). Two devices editing the same record: the higher revision wins (last write wins; clocks can be wrong). Different records never clash. Deletes are kept as tombstones so a device that was offline cannot bring a record back.
- First sync: a record that differs on this phone loses to the cloud version, and this phone's version is kept aside (the Account page tells you how many).
- A large number of missing records is never sent silently; the page asks first.

## Workspaces
Signing in and agreeing moves what is on the phone into that account's own workspace. Signing out returns to a separate local workspace (so your account's records are not shown as local ones). Signing in again with the same account brings them back. Account data is kept on the phone between times; signing out does not remove every trace.

## Limits and things to know
- Sync is not a backup: a delete on one device is a delete on all. Keep downloading backups.
- Plain backups you downloaded earlier may contain readable journal text.
- An unlocked, open phone can be read by whoever holds it. Login is not an app passcode. This was not independently audited.
- Cleared browser data loses anything not yet synced and the photos and voice notes.
- Free Spark limits are shared across the project (50,000 reads and 20,000 writes a day). When one is reached, sync pauses and local use goes on. It never upgrades anything.
- The Android app does not include sync yet.
- An edit made in the last fraction of a second before the browser is killed may need to be typed again.
