---
"@effected/cli-kit": patch
---

## Refactoring

* File and OSC 8 link encoding replaces unpaired UTF-16 surrogates with core's `String.toWellFormed` instead of a hand-rolled regular expression; the encoded output is unchanged
