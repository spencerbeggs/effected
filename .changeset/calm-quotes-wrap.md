---
"@effected/env": minor
---

## Features

* `ShellExports.quote` takes `{ dialect: "posix" }` to keep control characters literal inside `'…'` instead of `$'…'`, and `{ always: true }` to single-quote words that would otherwise be bare.
* `ShellExports.quoteResult` returns a `Result` and fails with the new `ShellQuoteError` (`reason: "nul" | "lone-surrogate"`) instead of throwing a `RangeError`.
