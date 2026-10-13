---
type: Gotcha
title: "Calling ajv-formats' default import is a TS2349, and the one-hop `.default` is not a bug"
description: "The ajv-formats default import type-checks as a module namespace, not a function, so a reader reaches for a cast or a runtime interop shim — but `ajvFormats.default` is the plugin itself under both Node's ESM interop and an __esModule-honouring bundler, and that one hop is the correct, fully typed binding."
status: draft
resource: ../../packages/schemastore-cli/src/AjvValidator.ts
stale_after: "2027-03-21T00:00:00Z"
tags:
  - compat
  - dx
sources:
  - id: ajv-validator
    resource: ../../packages/schemastore-cli/src/AjvValidator.ts
  - id: engine-suite
    resource: ../../packages/schemastore-cli/__test__/ajv-validator.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: '2782966684039222'
---

# Calling ajv-formats' default import is a TS2349, and the one-hop `.default` is not a bug

## What a reader sees

`import ajvFormats from "ajv-formats"` followed by `ajvFormats(ajv, …)`
fails to compile with `TS2349: This expression is not callable`. The
kit's engine, `AjvValidator` in `@effected/schemastore-cli`, instead
binds `const addFormats = ajvFormats.default;` and calls
that.[^ajv-validator] The extra hop looks like a workaround for a
broken package, or like the classic CJS/ESM interop trap that needs a
`typeof imported === "function" ? imported : imported.default` branch.

## What they would wrongly conclude

That the binding is fragile — correct under vitest but wrong under a
bundler, or vice versa — and that it should be replaced by a runtime
interop shim, an `as unknown as` cast, or a `createRequire` detour.

## What is actually true

`ajv-formats` does `module.exports = exports = formatsPlugin` and then
`exports.default = formatsPlugin`: the plugin points at itself, so
`addFormats.default === addFormats` (probed under plain Node ESM
against the built artifact, `ajv-formats@3.0.1`). That makes `.default`
the callable in **both** worlds — Node's ESM interop, where the default
binding is `module.exports`, and an `__esModule`-honouring bundler,
where it is `exports.default`. The `TS2349` comes from the shipped
`.d.ts`, which declares `export default` in a CJS-mode file, so
TypeScript models the default import as the namespace the upstream
`module.exports` reassignment contradicts. The one hop lands on the
plugin with its real types and no cast; the kit is ESM-only, so no
runtime branch is needed. Do not reintroduce a shim or a cast, and do
not "fix" the hop.[^ajv-validator]

The engine suite pins the registration itself — the standard vocabulary
compiles clean under strict mode, an unknown format string still answers
one root-pathed finding, and `formatMaximum`/`formatMinimum` and their
exclusive variants stay rejected (the case a future `addFormats(ajv)`
without `keywords: false` would silently turn green).[^engine-suite]
Registering formats does not move ajv's meta-schema (`validateSchema`)
verdict: a non-URI-reference `$id` and an invalid `pattern` fail
identically before and after (probed on `ajv@8.20.0`).

[^ajv-validator]: `packages/schemastore-cli/src/AjvValidator.ts` — the
    header comment above `const addFormats = ajvFormats.default` and the
    `addFormats(ajv, { keywords: false })` call in `layer`.
[^engine-suite]: `packages/schemastore-cli/__test__/ajv-validator.test.ts`
    — the format-registration pins.
