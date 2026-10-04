# Testing 1.19.1 (the pause) on top of 1.19.0

1.19.1: with a Stop pending and a schedule due, nothing appears on Today and no notification is sent; no notifications ask in You; Sit › Through the day › A pause opens the overlay with the new wording and counts one when you leave it. Syntax and 412 px layout unchanged.

# Testing 1.19.0 (polish pass)

Run on 1.19.0 at 412 px from a seeded 1.18.0 data set (days, moments, a journal entry, a heard talk, a half-played talk): all present after the upgrade. Checked: Eat add sheet heading; Write with the food question last (both layers) and the entry list; the six new moment feelings (same size, save and show); one prayer card at 22:00, 08:30 and 12:15 with the lamp unlit; setup Skip; Account and sync as a visitor while sign-in is still starting; the update card opens Moments, then goes; a played talk shows in the week looked back on, and talks marked heard before 1.19 are still counted; pointers fire only on a real pattern (none for a new user) and Leave it hides one for the week; no horizontal overflow on Today, Eat, Body, Write, Listen, You or Account. `node --test test/crypto.test.mjs test/sync.test.mjs`: 23 pass. Feature diff against 1.18.0: nothing removed except the two renamed icon files.
Not run: offline reload of the installed web app (the test browser will not register the service worker; the cache list was checked against the files), a real phone, real sign-in.

---

# Testing 1.17.0 (including 1.15.1 and 1.16.0)

Throwaway data only. Test phrases are random and thrown away. Nothing here was run against your Firebase project or your Google account.

## Run, and passed
**Automated** (`node --test test/crypto.test.mjs test/sync.test.mjs`): 6 crypto tests (official BIP-39 vectors, phrase validation, Argon2id parameters, wrap and unwrap, wrong phrase / other uid / other key id / tampering all refused, fresh IV every time, authenticated data) and 14 sync tests (two devices, offline queue, higher revision wins on both, tombstones, ciphertext-only journal, wrong key leaves the cloud alone, locked then unlocked, first-sync conflict keeps the phone copy aside, quota, oversize, mass-delete guard, empty answer is not a wipe, changes made while sync was off are sent on start).
**Firestore rules** against Google's own local emulator (`test/rules`): signed out denied; own paths in records, journal and journalKeys can be created, read, updated, deleted and queried; another user's paths and every other root denied both ways.
**Real transport code against the emulator** (transactions, stale refusal, create-once key, listener with cursor) and all Firebase functions used exist in the pinned 12.18.0 build.
**Browser, with a local fake cloud and fake sign-in** (`test/fixtures`): adoption of existing records; encrypted journal setup with real Argon2id in a worker; wrong confirmation word; recovery on a second device with merge by id and a wrong phrase refused; locked state (writes, moments and backup refused; nothing sent or deleted while locked); offline reopen; sealed drafts; sign out, separate local workspace, same-account return, different-account isolation (a guest entry never leaked); two devices: add, delete, no resurrection; privacy canary in every journal field: none in localStorage, IndexedDB, queue or cloud after migration.
**Layer 1** reproduced the look-back crash on 1.15.0, then confirmed fixed with no logs, food logged, a training draft pending and none; the Train draft review; the stretch-timer Cancel; the third-answer-only entry.
**Layer 2** whole picture rows, Ask the mirror copy against what is really sent, My record contents and its left-out line, Moments (photo, line, tags; edit, delete, backdate; week and two-week playback; backup and restore with the photo), the two journal layers, old entries still render, Body shortcuts.
**Upgrade** from 1.15.0 data: nothing lost, settings and goals kept. **Fresh install**, **unconfigured** copy (no outside requests), **412 and 360 px** for the new screens, feature inventory diff.

## Not run (needs you, a phone or a second real device)
- Real Google sign-in, authorised-domain and provider errors, popup blocked or cancelled, installed web app sign-in, restricted persistence.
- Real second device and a real recovery.
- Offline reload of the installed web app (the test browser would not register the service worker). The cached file list was checked to be complete.
- Argon2id timing on a real phone (your memory use and wait). It took about a quarter of a second on this Mac.
- A browser that cannot keep the key (then the phrase is asked for on every open).
- Two tabs open together (one runs sync, the other waits).
- Real Spark quota, and a real oversize record.
- Screen-reader pass, light theme.
