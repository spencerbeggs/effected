---
type: Decision
title: No bin on the library — the executable lives in the effected tool
description: "@effected/schemastore ships no bin entry; the schema commands are effected schema, a command of the effected tool whose carrier pins the library exactly."
status: stable
sources:
  - id: package-json
    resource: ../../packages/schemastore/package.json
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-09-13T00:00:00Z
generated:
  by: "claude-code/opus-5"
  at: 2026-11-05T06:55:47Z
integrity:
  generated:
    body: b2e04578b3f20289
  verified:
    by: human:spencer
    at: 2026-11-02T17:04:46Z
    content: 1a38124cf1d89298
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
  - by: human:spencer
    at: 2026-11-02T17:04:46Z
---

# No bin on the library — the executable lives in the effected tool

## Context

A package that builds and validates artifacts is sometimes packaged as
a CLI a consumer invokes directly, rather than as a library a consumer's
own script imports. `@effected/schemastore` needed to pick one shape —
and then, once six consuming repositories had each written the same
generator script around the library, needed to pick where the shared
executable would live. It first lived in a bin-only companion package,
and moved into the [effected tool](schema-commands-live-in-the-tool.md)
when the tool became the home of every kit build command.

## Decision

`@effected/schemastore` ships no `bin` entry.[^package-json] It is a
library whose inputs — `SchemaTarget`s, the gating policy, the contract
policy — are TypeScript values.

The command-line tool those values feed is `effected schema`, a command of
the effected tool: the [cli](../modules/cli.md) holds its flags, the
[engine](../modules/engine.md) its logic, and the carrier
[`@effected/plugin`](../modules/plugin.md) pins the library exactly through a
`workspace:*` chain. Its input is still TypeScript — a
`schemastore.config.ts` whose default export is `defineConfig(...)`
(the carrier re-exports it as `defineSchemastore`), and `defineConfig`
lives in the library, not the tool, so the config and the pipeline share
one `effect` and one `SchemaTarget` class.

## Alternatives rejected

**Ship a `bin` entry on the library running `SchemaPipeline` over a
config file.** Rejected because a library consumed through `R` and a
binary with an exit-code contract have different dependency shapes: the
bin needs `jiti`, a platform layer and `@effected/cli-kit`, none of which a
consumer composing the pipeline in its own program should install.

**Ship the command with its own copy of the library and re-export
`defineConfig` from it.** Rejected because the consumer's config
constructs `SchemaTarget`s and `Schema`s from ITS `node_modules`; a second
`effect` or `@effected/schemastore` instance inside the tool would make
class identity and annotation symbols diverge in ways no type-check
reports. The catalog keeps one `effect`, the pin keeps the library at the
version the tool was built against, and [the version
check](schema-version-mismatch-check.md) names a config that came from
another copy.

**Leave every consumer its own generator script.** The status quo: six
repositories carried the same two hundred lines and the same drift test.
Rejected by the owner on 2026-09-13.[^owner]

## Consequences

A consumer installs `@effected/plugin` as a devDependency and, when its
runtime code uses `HostedSchema`, `@effected/schemastore` beside it; the
pin chain means a library bump reaches the tool only with a carrier
release.

[^package-json]: `packages/schemastore/package.json` — no `bin` field.
[^owner]: The owner's design conversation of 2026-09-13 that scoped the companion package.
