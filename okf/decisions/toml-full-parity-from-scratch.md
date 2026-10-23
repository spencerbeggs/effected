---
type: Decision
title: toml is a full-parity package built from scratch
description: @effected/toml ships parse, stringify, Schema, a lossless CST, edit-in-place, formatter and visitor on a from-scratch engine, rather than a minimal port with only what the first consumer needs.
status: stable
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: d7020d91b87c85f3
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 30f2c4d6ac4dde96
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# toml is a full-parity package built from scratch

## Context

`@effected/toml`'s first named consumer, `@soda3js/config` (via `config-file`), needs only parse and stringify. A format package could reasonably ship just that pair and stop. Separately, an existing, widely-used TOML implementation (`smol-toml`) already exists and could have been ported or wrapped instead of writing a new engine.

## Decision

`@effected/toml` is a **full-parity** format package: parse, stringify, Schema integration, a lossless CST, edit-in-place, a formatter, and a visitor — the same surface contract as its siblings `jsonc`, `yaml` and `markdown`. It runs on a **from-scratch, Effect-native engine** rather than a port of `smol-toml`; `smol-toml` is retained only as an exact-pinned devDependency oracle for differential testing.

## Alternatives rejected

**Parse/stringify-only, scoped to the first consumer's needs**, was rejected. A consumer's stated need defines a format package's *minimum*, never its maximum — the kit's format packages share one surface contract deliberately, because that shared contract is what lets consumer code be written generically over "a document codec" rather than per-format. `glob` took the same reasoning to a full-fidelity minimatch port for the identical reason.

**Porting `smol-toml`'s engine** was rejected. `smol-toml` fights the house model on three fronts: throw-based errors instead of typed diagnostics, a `Date` subclass standing in for TOML's four distinct datetime types, and a lossy value-only parse with no CST to build lossless editing on top of. Because TOML is a small, stable, precisely specified grammar with a first-class compliance corpus (BurntSushi's toml-test suite), writing a new engine against the spec directly was a bounded bet rather than an open-ended one — and it made `toml` the first format package in the repository with no vendored code and therefore no attribution burden.

## Consequences

The package carries a larger implementation surface than a parse/stringify-only package would (the linear-CST-plus-semantic-pass architecture, four datetime classes, a full edit/format/visitor surface) in exchange for participating fully in the kit's format-package parity contract and for having a design not fighting the house typed-error and lossless-editing model. The from-scratch engine also had to prove itself against the toml-test 1.1.0 corpus with a no-skip-list pass and a differential oracle test against `smol-toml`, since there was no existing engine's track record to lean on. `smol-toml` surviving only as a devDependency oracle means its API and error model never leak into `@effected/toml`'s public surface.
