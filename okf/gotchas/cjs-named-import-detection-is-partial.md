---
type: Gotcha
title: Node detects only some of a CommonJS dependency's named exports, not all or none
description: "cjs-module-lexer analyzes a CommonJS module's named exports heuristically, so a named import can succeed for one export and throw at runtime for its neighbour in the very same module."
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - compat
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-14T02:44:47Z
  body_sha256: 1e7fbd776dd4d4eef2ee0cc27855358226ca79dc5b7f2f1646b5769e2a8a0541
---

# Node detects only some of a CommonJS dependency's named exports, not all or none

## What a reader sees

A named import from a CommonJS dependency works: `import { blake2b } from
"blakejs"` typechecks, bundles, and runs. The shorthand conclusion this
invites — "it's CommonJS, so named imports either all work or all throw"
— then gets generalized to the dependency's other exports without
re-checking each one.

## What they wrongly conclude

That because one named import from a CJS package works (or because CJS
interop is known to be all-or-nothing in some other ecosystem's tooling),
every other named export from the same module is equally safe to import
by name — or, in the opposite direction, that a CJS module can never
support named imports at all, so a test asserting "this import throws"
can be written against the module in general rather than against the one
symbol it was meant to test.

## What is actually true

Node's ESM loader runs `cjs-module-lexer` over a CommonJS dependency to
detect which of its exports can be named imports, and that detection is
**heuristic and per-symbol**, not all-or-nothing. Measured on `blakejs`
(2026-08-13, Node 26): the CJS export object carries ten keys and exactly
one, `blake2b`, is detected as a named export. The other nine —
`blake2bHex` among them — are not:

```text
import { blake2b }    from "blakejs"   // OK
import { blake2bHex } from "blakejs"   // SyntaxError at runtime, builds cleanly
```

The undetected import type-checks, bundles, and builds cleanly, then
throws only on first execution — there is no static signal distinguishing
a detected export from an undetected one short of running the import.

This was reported and partly retracted by `spencerbeggs/reposets`'s
dogfood loop: an initial finding that generalized a real `blake2bHex`
failure into a blanket "this module rejects named imports" claim was
challenged and narrowed back to the one undetected symbol once tested
against the actual export set.

## The check

- A test asserting that *a named import throws* must name the specific
  symbol it was written for, never generalize to "the module."
- A test asserting *which* symbols are importable should pin the
  detected set directly (a snapshot of what actually works), not the
  module's declared format — a new caller reaching for an undetected
  symbol then fails with a reason at review time instead of a runtime
  crash in production.
