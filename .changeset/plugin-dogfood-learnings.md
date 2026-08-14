---
"@effected/app": patch
---

## Documentation

The "effected" Claude Code plugin, which versions with this package, gained the learnings from the `@spencerbeggs/reposets` dogfood loop:

* **`effect-v4-schema`** — a do-this-not-this on decode's silent excess-key tolerance. A typo'd key and a correct-but-absent one are indistinguishable by default, which has now caused two failures from independent directions: a lint rule that ran on defaults because its option key was typo'd, and a config loader that could report neither a typo'd section nor a field its schema deliberately removed. Covers pairing `onExcessProperty: "error"` with `errors: "all"`, the `StructWithRest` carve-out, and why a `Never` rest is not a substitute.
* **`building-a-format-package`** — a green conformance corpus proves conformance, not reachability, so every format package keeps a standing fixture drawn from a real document. Generalised with a second witness: a loop in which a duplicate module, a silent name collision, an unreachable export, a truncated list read and a normaliser that dropped its own typed input were each green in the suite of whoever wrote that code.
* **`testing-actions`**, **`building-a-github-action`**, **`effected-packages`**, **`effect-v4-cli`** — updated for the surfaces released in `@effected/github@0.4.0` and `@effected/cli@0.1.0`.

## Bug Fixes

* `building-a-format-package`'s skill file contained a **literal NUL byte** — inside the very passage instructing authors to write control characters as escapes and never as literal bytes. It made the file read as binary, so `grep` returned nothing and exited silently: the skill was invisible to content search for any agent that looked for it that way. Both control characters are now escapes, and the file reads as UTF-8 text.
