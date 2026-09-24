---
type: Interface
title: The package-json entry-point resolver
description: "resolveEntryPoint answers which file is a manifest's root entry: pure, Result-returning, over a structural { exports?, main? } input rather than a Package; the condition list is the caller's ordered policy, a present exports encapsulates the package and never falls through to main, and every failure names its discriminated reason."
status: stable
kind: api
resource: ../../packages/package-json/src/EntryPoint.ts
tags:
  - dx
sources:
  - id: entry-point-source
    resource: ../../packages/package-json/src/EntryPoint.ts
  - id: entry-point-test
    resource: ../../packages/package-json/__test__/EntryPoint.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
  body_sha256: 2b3d0dab707e641baf242da95fb9d8129a4c11f70a7b7c9d0605cbf4008b8d82
verified:
  - by: human:spencer
    at: 2026-09-24T00:12:21.362Z
---

# The package-json entry-point resolver

## What stays stable

`resolveEntryPoint(manifest, options?)` answers "which file is this
manifest's `"."` entry?" and nothing else. Three properties of its
shape are the contract:

- **Pure, IO-free and `Result`-returning.** It reads no disk and runs no
  `Effect`; the answer is `Result<string, UnresolvedEntryPointError>`,
  so lint hosts and tarball inspectors call it synchronously and Effect
  hosts lift it with `Effect.fromResult`.
- **The input is structural, not a `Package`.** `EntryPointManifest` is
  `{ exports?: unknown; main?: unknown }`, so a manifest read straight
  out of a tarball or a `node_modules` tree resolves with nothing else
  validated — a document the strict `Package` decode would reject still
  gets an answer here.[^entry-point-source]
- **The condition list is caller-supplied and ordered — the order IS the
  policy.** `options.conditions` is honoured in the order given, never
  in the manifest's key order, and conditions recurse
  (`{ "import": { "node": "./n.js" } }` resolves through both levels).
  The default is the package's own `DEFAULT_CONDITIONS`; a caller with a
  different policy passes its own list.

All three legal `exports` spellings are honoured: the string shorthand,
the subpath map with a `"."` entry, and root conditions with no `"."`
key.

## A present `exports` encapsulates the package

When `exports` is present but nothing in it matches, the answer is a
typed failure — `main` is **not** consulted. That is Node's own rule,
and the lenient reading (fall through to `main`, then to `index.js`) is
exactly what a future reader would "fix" it back to, because it looks
friendlier: it answers a file the package deliberately does not export,
which then loads and behaves plausibly instead of failing. A test pins
the strict behaviour by name.[^entry-point-test] `main`, and then the
legacy `index.js` default, are consulted only when `exports` is
**absent**. An `exports` form the resolver does not implement (an array
fallback list, or any non-string non-object value) is likewise a
failure, not a fall-through — encapsulation still applies.

## The failure names its reason

`UnresolvedEntryPointError` carries a discriminated `reason` —
`noRootExport` (a subpath map with no `"."` entry), `noConditionMatched`
(a root entry exists but none of the requested conditions are present,
with the `conditions` tried carried on the error so the message can name
them) and `unsupportedExportsForm`. Never collapse these to one
"not found" sentinel: the three call for different responses from a
caller, and the test suite asserts each reason separately.

[^entry-point-source]: `packages/package-json/src/EntryPoint.ts` — the
    `EntryPointManifest` shape, `resolveEntryPoint` and the
    `UnresolvedEntryPointError` reasons.
[^entry-point-test]: `packages/package-json/__test__/EntryPoint.test.ts`
    — the "exports encapsulates the package" group, including "does NOT
    fall back to main when exports is present and nothing matched".
