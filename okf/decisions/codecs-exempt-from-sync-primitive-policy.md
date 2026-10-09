---
type: Decision
title: ConfigCodec is exempt from the sync primitive policy
description: A ConfigCodec's Effect-returning members are not required to carry a synchronous Result twin, because their Effect return type expresses interface polymorphism, not a wrapped span.
status: stable
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 1425675059278747031db7071c0142af7e1dbd8f26f2d9f1740eb1fdab37a840
verified:
  - by: human:spencer
    at: 2026-10-09T17:01:48Z
---

# ConfigCodec is exempt from the sync primitive policy

## Context

The kit's [sync primitive policy](../conventions/sync-primitive-policy.md) asks a public pure boundary whose `Effect` wrapper carries nothing but a span to expose the sync `Result` form as the primitive and derive the `Effect` form from it. Format packages like `jsonc`, `yaml` and `toml` follow this exactly: `parseResult`/`stringifyResult` hold the real engine, and `parse`/`stringify` are `Effect.fromResult` behind a named span. `ConfigCodec.parse`/`ConfigCodec.stringify` also return `Effect`, which invites the same question — should each codec ship a `Result` twin too?

## Decision

`ConfigCodec` implementations are exempt from the sync primitive policy. Their `Effect`-returning members do not carry a `Result` twin.

## Alternatives rejected

Requiring every `ConfigCodec` implementation to also expose a `parseResult`/`stringifyResult` twin, mirroring the format packages underneath them, was rejected. The reasoning that makes the policy apply to a format package does not transfer here: `ConfigCodec.parse`'s `Effect` return type is not a thin span wrapped around a synchronous primitive that could be exposed directly. It is **interface polymorphism** — `ConfigFile.layer` and the resolver/strategy pipeline are written once against the `ConfigCodec` interface and compose with whichever codec a consumer supplies, decorator codecs included (`EncryptedCodec`, `ConfigMigration.make`). A decorator codec's own `parse` may need to run a real asynchronous or effectful step (a key derivation via WebCrypto's `subtle` API is not synchronous), so `ConfigCodec.parse`'s `Effect` return is part of the interface's actual contract, not a stylistic wrapper around code that is secretly total and synchronous underneath.

## Consequences

Consumers of `ConfigCodec` directly (via `ConfigFile.layer`, or by writing their own decorator) always compose against `Effect`, with no synchronous escape hatch expected or promised. The underlying pure format packages each still expose their own `Result` primitive per the policy — `Jsonc.parseResult`, `Yaml.parseResult`, `Toml.parseResult` — so a caller wanting a synchronous parse of raw JSONC/YAML/TOML text can reach for the format package directly rather than going through `config-file`'s codec seam. This decision only exempts the `ConfigCodec` interface boundary itself, not the format packages it wraps.
