---
type: Decision
title: No bin on the library — the CLI is a fixed-version companion package
description: "@effected/schemastore ships no bin entry; the schemastore executable lives in @effected/schemastore-cli, a bin-only companion released in a fixed group with the library."
status: draft
sources:
  - id: package-json
    resource: ../../packages/schemastore/package.json
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-09-13T00:00:00Z
generated:
  by: "claude-code/opus-5"
---

# No bin on the library — the CLI is a fixed-version companion package

## Context

A package that builds and validates artifacts is sometimes packaged as
a CLI a consumer invokes directly, rather than as a library a consumer's
own script imports. `@effected/schemastore` needed to pick one shape —
and then, once six consuming repositories had each written the same
generator script around the library, needed to pick where the shared
executable would live.

## Decision

`@effected/schemastore` ships no `bin` entry.[^package-json] It is a
library whose inputs — `SchemaTarget`s, the gating policy, the contract
policy — are TypeScript values.

The command-line tool those values feed is a separate package,
[`@effected/schemastore-cli`](../modules/schemastore-cli.md): bin-only,
nothing importable, peering on `effect` and on the library at an exact
version, released with it in one changesets fixed group. Its input is
still TypeScript — a `schemastore.config.ts` whose default export is
`defineConfig(...)`, and `defineConfig` lives in the library, not the
CLI, so the config and the pipeline share one `effect` and one
`SchemaTarget` class.

## Alternatives rejected

**Ship a `bin` entry on the library running `SchemaPipeline` over a
config file.** Rejected because a library consumed through `R` and a
binary with an exit-code contract have different dependency shapes: the
bin needs `jiti`, a platform layer and `@effected/cli`, none of which a
consumer composing the pipeline in its own program should install.

**Ship the CLI with its own copy of the library and re-export
`defineConfig` from it.** Rejected because the consumer's config
constructs `SchemaTarget`s and `Schema`s from ITS `node_modules`; a second
`effect` or `@effected/schemastore` instance inside the CLI would make
class identity and annotation symbols diverge in ways no type-check
reports. The library is a peer of the CLI for the same reason `effect`
is a peer of every kit package.

**Leave every consumer its own generator script.** The status quo: six
repositories carried the same two hundred lines and the same drift test.
Rejected by the owner on 2026-09-13.[^owner]

## Consequences

`packages/schemastore-cli/` is a package under active development, not
the ignored build residue an earlier revision of this decision described.
A consumer installs both packages as devDependencies; a version bump in
one is a bump in the other.

[^package-json]: `packages/schemastore/package.json` — no `bin` field.
[^owner]: The owner's design conversation of 2026-09-13 that scoped the companion package.
