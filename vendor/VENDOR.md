# Vendored third-party files (pinned, no runtime CDN)

| File | Source | Version | SHA-256 | Licence |
|---|---|---|---|---|
| argon2.umd.min.js | npm hash-wasm, dist/argon2.umd.min.js (https://github.com/Daninet/hash-wasm) | 4.12.0 | dcec617a2e1b700fa132d1583a186cb70611113395e869f2dd6cc82b415d3094 | MIT (LICENSE-hash-wasm.txt) |
| bip39-english.js | BIP-39 English list, https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt | source file sha256 2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda | see header | MIT (BIP-39) |

The word list is used only to write a recovery phrase in words. The key is made with Argon2id, not the wallet PBKDF2 step.
Firebase (Auth, Firestore) is loaded from gstatic.com at version 12.18.0 only when the person opens Account and sync and has configured it.
