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
  - id: interactive-cli-kit-design
    resource: ../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md
    title: Interactive CLI kit design, sections 4.2 and 10
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T19:52:41Z
  body_sha256: d0cfc8034ab1fb462f8ed70c4ecac2844394ab9bab24d9d53c5d9ddc2a79fb30
---

# std-osc8's pure core is ported into env, not wrapped

## Context

`@effected/env` needs terminal-emulator and hyperlink detection. std-osc8
already has it, but its `constants.ts` snapshots `process.env` and isTTY when
the module is imported, and its pure internals are not exported.[^std-osc8-constants]
Wrapping the published package would make detection depend on the process
at import time, defeating a test's `layerTest` control and breaking the rule
that `env` reads nothing at import and imports nothing from `node:`.[^interactive-cli-kit-design]

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
[^interactive-cli-kit-design]: `../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md`
