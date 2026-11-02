---
id: "0007"
title: ChildProcess arguments are CommandLine.Word
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["ChildProcess\\.TemplateExpression", "TemplateExpressionItem", "ChildProcess\\.(StandardCommand|isStandardCommand)", "\\.args\\.(join|includes|indexOf)\\("]
---

`ChildProcess` arguments are typed `CommandLine.Word` (`string | Redacted<string>`), and `env` values may be `Redacted`. `ChildProcess.TemplateExpression` and `TemplateExpressionItem` moved to `CommandLine`.

How it shows itself: code that reads a command's `args` as `string[]` (`.join`, `.includes`, string comparison) stops compiling, and so does an import of the moved types. Normalise with `args.map(String)` where you only need text; a `Redacted` argument stringifies as `<redacted>`, so never use that to recover a secret.

Check against the installed `effect/dist/process/ChildProcess.d.ts` and `CommandLine.d.ts`.
