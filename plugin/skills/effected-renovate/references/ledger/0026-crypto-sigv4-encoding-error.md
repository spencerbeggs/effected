---
id: "0026"
title: "@effected/crypto: SigV4 signing fails with SigV4EncodingError on ill-formed text instead of dying"
kind: behaviour
shows: typed
applies:
  "@effected/crypto": ">=0.6.0"
detect: ["SigV4\\.(sign|canonicalize)"]
changesets: ["lone-surrogates-fail"]
closes: ["spencerbeggs/effected#1262"]
---

`SigV4.sign` and `SigV4.canonicalize` add `SigV4EncodingError` to their error channel. A lone UTF-16 surrogate in the path, a query key or value, a header name or value, the method or the host fails with it, naming the `component`, where it used to die inside `encodeURIComponent`. A string body is hashed as the bytes `fetch` sends and is not checked.

- **An exhaustive handler** of the error channel (`catchTags`, `Match`) gets a type error until it handles the new tag. Map it where the input came from: it means the caller passed text that is not well-formed Unicode.
- **A pre-check of your own** for surrogates before signing can stay; it now duplicates the kit's.

Verify with a test that signs a path holding `"\ud800"` and asserts the typed failure. Read the installed `.d.ts` for the exact shapes.
