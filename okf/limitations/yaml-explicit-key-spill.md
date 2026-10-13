---
type: Limitation
title: A block-mapping key longer than 1024 rendered characters spills to explicit-key form
description: "YAML 1.2's implicit-key length cap forces the stringifier to switch a long key from block-implicit to explicit-key form, changing the emitted shape."
bounds: ../interfaces/yaml-stringify-options.md
status: stable
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: b4af426b107a58c1
---

# A block-mapping key longer than 1024 rendered characters spills to explicit-key form

## The condition

YAML 1.2 §8.1.3 caps an implicit block-mapping key: the `:` indicator must
appear at most 1024 characters after the key's start. Both `@effected/yaml`
stringify paths — value and node — spill a block-mapping key whose
**rendered** form exceeds that limit into explicit-key form: `? key` on its
own line, `: value` on the next.

## The symptom

A caller who stringifies a document containing a long block-mapping key
(the real-world case is the pnpm 11 lockfile `snapshots:` shape) sees the
key's line shape change from `key: value` to a two-line `? key` / `: value`
pair, rather than the emitter producing an implicit key over 1024
characters. This is not configurable and cannot be suppressed.

Three details are precise on purpose and are not bugs if they surprise a
reader:

- The measure is the **rendered** key, not the source scalar — quotes and
  escapes are what a parser counts, so a short source scalar that renders
  long (through escaping) can still spill.
- The threshold is **strictly greater than** 1024, matching the reference
  `yaml` package (a rendered key of exactly 1024 stays implicit).
- The spill is **block-context only** — flow mappings have no implicit-key
  line to overrun, so a flow-context long key never spills.

A further divergence sits inside the spilled form itself:
`EXPLICIT_COMPACT_PAD` (`src/internal/stringifier.ts:76`) pads compact
continuation lines — the lines after `: first-item` / `? first-line` — with
a structural two columns (an indicator character plus its space), never the
configured `indent`. The reference `yaml` package pads them with the
configured indent, and at `indent ≠ 2` its own strict parser then misreads
the sequence output (items merge into one scalar) or rejects the mapping
output outright. `@effected/yaml` follows the spec instead and records the
divergence rather than reproducing the reference's bug, per [the fidelity
obligation](../decisions/format-fidelity-obligation.md).

## Why this is acceptable

Without the spill the emitter would produce output that strict YAML parsers
reject on re-parse — a correctness bug against the reference, not a style
choice. The cap is a hard property of the YAML 1.2 grammar, not a kit
policy decision, so there is no non-breaking alternative: either the
stringifier changes the emitted shape past the boundary, or it emits an
implicit key a compliant parser refuses to read back.

## What the fix would take

There is no fix to make; the limit is external. What can regress is the
compact-pad divergence: byte-pinned fixtures under
`packages/yaml/__test__/fixtures/explicit-key/` pin the emit, including
both sides of the 1024/1025 boundary, and were authored once against
`yaml@2.9.0` as a strict oracle in a scratch directory outside the repo,
with provenance recorded in that directory's `ORACLE.md`. The committed
bytes are the contract thereafter; the reference package is not a
dependency of the test run, and the fixtures are never regenerated from a
live oracle.
