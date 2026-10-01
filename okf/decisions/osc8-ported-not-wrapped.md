---
type: Decision
title: "std-osc8's pure core is ported into env, not wrapped"
description: "@effected/env copies std-osc8's detect, terminals, semver, wrappers and env modules into an internal directory instead of depending on the published package, because std-osc8 snapshots process.env and isTTY at import time."
status: draft
tags: [architecture, bundle, deps]
sources:
  - id: std-osc8-constants
    resource: https://github.com/spencerbeggs/std-osc8/blob/0.2.0/src/constants.ts#L6-L7
    title: std-osc8 src/constants.ts, lines 6 and 7
  - id: boundary-test
    resource: ../../packages/env/__test__/purity.test.ts
    title: "env purity: nothing reads process or imports node: at any depth of src, the ported osc8 modules included"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T14:11:47Z
  body_sha256: b98ff37bcaec6a81a9838c2d82be9ed9c13772f58c079e3178de652ed3450028
---

# std-osc8's pure core is ported into env, not wrapped

## Context

`@effected/env` needs terminal-emulator and hyperlink detection. std-osc8
already has it, but its `constants.ts` snapshots `process.env` and isTTY when
the module is imported, and its pure internals are not exported.[^std-osc8-constants]
Wrapping the published package would make detection depend on the process
at import time, defeating a test's `layerTest` control and breaking the rule
that `env` reads nothing at import and imports nothing from `node:`.[^boundary-test]

## Decision

Port std-osc8's pure core (`detect`, `terminals`, `semver`, `wrappers`,
`env`) into `packages/env/src/internal/osc8/`, together with its tests. Do
not depend on the published `std-osc8`.

Provenance: std-osc8 v0.2.0, MIT licensed, same author as this repository.

## Alternatives rejected

- **Depend on the published `std-osc8`.** Rejected: the import-time globals
  cannot be overridden from a Layer, and the pure internals that would be
  reusable are not part of its exports.

## Consequences

The port is owned here and drifts independently of upstream; the ported
detector is read through `Config`, so every variable it consults is
controllable by `layerTest`. See [`env.md`](../modules/env.md) and
[`dependency-policy`](../conventions/dependency-policy.md).

[^std-osc8-constants]: `https://github.com/spencerbeggs/std-osc8/blob/0.2.0/src/constants.ts#L6-L7`
[^boundary-test]: `packages/env/__test__/purity.test.ts` (nothing in `src`, the ported `internal/osc8` directory included, reads `process` or imports `node:`), with the `osc8.*.test.ts` files pinning the port
