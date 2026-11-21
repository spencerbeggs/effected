---
id: "0036"
title: "effect: String.isWellFormed and toWellFormed, Base64.encodeUnpadded and decodeLenient, TextDiff.hunks, effect/crypto/Password and TestConsole's level readers"
kind: adopt
shows: none
applies:
  effect: ">=4.1.5"
detect: ["uD800|uDBFF|uDC00", "replace\\(/=+\\$/", "@@ -", "pbkdf2|argon2|scrypt", "TestConsole"]
---

Offer these to the user; never apply them unasked. Each replaces a pattern a repository often hand-rolls.

- **`String.isWellFormed` and `String.toWellFormed`** check for and replace unpaired UTF-16 surrogates, using the native ES2024 methods when the runtime has them (Effect-TS/effect#10549). They replace a lone-surrogate regex such as `/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|…/`. Both are tagged unstable.
- **`Base64.encodeUnpadded` and `Base64.decodeLenient`** encode standard Base64 without `=` padding and decode either alphabet with or without padding (Effect-TS/effect#10557). They replace `.replace(/=+$/, "")` after an encode, and alphabet normalization before a decode. Keep a deliberately strict decoder strict.
- **`TextDiff.hunks`** groups a line diff into `diff -u` style hunks as data, optionally with the ranges that differ inside changed lines (Effect-TS/effect#10517). It replaces a hand-built hunk grouper.
- **`effect/crypto/Password`** stores passwords as PHC strings, hashing with Argon2id or PBKDF2 through `Kdf`, verifying against the algorithm and salt in the stored hash, and reporting when a hash needs rehashing (Effect-TS/effect#10734). It replaces hand-rolled password storage, not key derivation for encryption.
- **`TestConsole`** gained readers for captured warning, info, debug and trace parameters (Effect-TS/effect#10682), which replace filtering a combined capture by level.

Many matches are unrelated: read each before proposing a change. Check the installed `.d.ts` of each module for its shape.
