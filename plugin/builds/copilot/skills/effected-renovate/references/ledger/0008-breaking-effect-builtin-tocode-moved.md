---
id: "0008"
title: "effect: built-in schemas and checks no longer carry a toCode annotation; Codegen generates their code"
kind: breaking
shows: behavioural
applies:
  "effect": ">=4.1.6"
detect: ["toCode([^A-Za-z]|$)"]
---

The code that writes TypeScript for built-in schemas and checks moved into `effect/Codegen`, so a built-in schema's or check's `annotations.toCode` is now `undefined` (probed: `Schema.DateTimeUtc` and an `isMinLength` check). The source `Codegen.Module` prints is unchanged for built-ins. The type of `annotations` still has an optional `toCode`, so the compiler does not catch code that reads it off a built-in. It fails at runtime instead.

Search for code that reads `toCode` from an annotation. If it reads a built-in's, pass the schema's representation to `Codegen.Module`'s `addSchemas` and call `print()` instead. A custom declaration or check that defines its own `toCode` keeps working. If you change a built-in's representation id, give it your own `toCode`, because the generator no longer recognises it. The generator now uses the arguments recorded when the schema or check was made, so a `Date` bound mutated afterwards generates its original value. Check against the installed `effect/Codegen` `.d.ts`.
