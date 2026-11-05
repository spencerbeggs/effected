---
type: Decision
title: A config from another schemastore version fails the CLI and only warns the MCP
description: "The effected tool compares the @effected/schemastore version stamped on a config's values with the version it was built against: effected schema refuses a mismatch at exit 2 unless --ignore-version-mismatch is given, the MCP tools run anyway and return a loud warning, the version is stamped from process.env.__PACKAGE_VERSION__ and a HostedSchema is recognized by a Symbol.for brand so the engine, not the config's own evaluation, decides."
status: draft
tags:
  - architecture
  - deps
  - dx
sources:
  - id: design
    resource: ../../docs/superpowers/specs/2026-11-04-effected-schema-design.md
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-11-04T00:00:00Z
  - id: version-check
    resource: ../../packages/engine/src/schema/VersionCheck.ts
  - id: schemastore-version
    resource: ../../packages/schemastore/src/SchemastoreVersion.ts
  - id: version-module
    resource: ../../packages/schemastore/src/internal/version.ts
  - id: hosted-schema
    resource: ../../packages/schemastore/src/HostedSchema.ts
generated:
  by: "okfit/claude-code"
  at: 2026-11-05T06:55:47Z
integrity:
  generated:
    body: ea0032c57ca4badc
---

# A config from another schemastore version fails the CLI and only warns the MCP

## Context

A config's values, its `defineConfig` result and any `HostedSchema` it carries, are built by the copy of
`@effected/schemastore` the consumer's tree resolves, while the tool runs the pipeline of the copy it was built against.
The [pin chain](schema-commands-live-in-the-tool.md) and the catalog normally keep those equal, but a partial bump, such as
a Dependabot-style PR that moves only the carrier, can leave an older copy beside the new one. Before this check
`defineConfig` tested `hosted` with `Schema.instanceOf(HostedSchema)`, so a value from the other copy threw inside the
config's own evaluation, before the engine saw anything and where no flag could reach.[^design]

## Decision

- **The version is stamped, not discovered.** The bundler replaces the exact expression `process.env.__PACKAGE_VERSION__`
  with the package's version at build time, kept in one small module so the library's boundary rules still hold, with
  `"0.0.0"` as the unbuilt fallback.[^version-module] The library stamps that version, non-enumerable and under
  `Symbol.for("@effected/schemastore/version")`, on `HostedSchema`'s prototype and on the `defineConfig` result, so a
  structural comparison, a spread and `Schema` encoding never see it. `SchemastoreVersion.current` and `.of(value)` read it.
- **The engine compares.** `VersionCheck.inspect` collects every stamp that differs from the version the tool was built
  against and answers a `VersionMismatch` naming both versions and how to align them. A value with no stamp, and `"0.0.0"` on
  either side, is passed over.[^version-check]
- **The CLI refuses by default.** `effected schema build|check|validate` fails `VersionMismatchError` at exit `2`, before
  anything is generated, because the run could not start. `--ignore-version-mismatch` prints a loud warning and proceeds; the
  flag is the user's informed override, and its name says what they are doing.
- **The MCP runs anyway and says so.** The tools take no flag. Every `schema_*` tool, `schema_build` included, runs under
  a mismatch and returns the warning in its declared result, naming both versions, so the agent reading the result cannot
  miss it; a refusal that follows a warned mismatch repeats the warning, because the engine's errors do not carry it.
- **Recognition crosses copies.** `defineConfig` recognizes a `HostedSchema` by a `Symbol.for` brand, the way the config
  brand already works, instead of `instanceOf`, so a foreign value reaches the engine. `ResolvedSchema.hosted` keeps the value
  as given, and the resolver rebuilds the identity from the foreign value's raw fields with this copy's rules, whatever the
  other copy's getters do.
- **The limit is stated.** Two copies at the same version are not flagged; they are not the case this targets, and brand
  recognition keeps them working.

## Alternatives rejected

- **A hard failure everywhere.** An agent on the MCP cannot pass a flag, and a refusal tells it nothing it can act on
  except that the tool will not run. A result carrying the warning lets it finish the task and report the mismatch.
- **A warning everywhere.** CI and a person at a terminal would proceed past a config the tool does not fully understand,
  and an automated build under `onDrift: "error"` could pass on output the wrong copy shaped.
- **An MCP flag mirroring the CLI's.** It would add a parameter whose only use is to be set to quiet a warning the agent
  is meant to read.
- **Keep `instanceOf` and let the engine fail first.** The foreign value throws in the config's own evaluation, before the
  engine runs, so neither the refusal nor the override could exist.

## Consequences

- A consumer who bumps the library without the carrier sees the mismatch at the next `effected schema` run, naming both
  versions, instead of a silent runtime divergence.
- The packed-install e2e builds a second `@effected/schemastore` by rewriting the real tarball's version and stamp, because
  a stale copy has nothing to install from, and covers a CLI refusal, a CLI override and an MCP warning.
- The check bounds [the schema commands' contract](../interfaces/schema-commands.md#the-version-mismatch-check).

[^design]: `docs/superpowers/specs/2026-11-04-effected-schema-design.md`: the Version mismatch check section.
[^version-module]: `packages/schemastore/src/internal/version.ts`: the one module that reads `process.env.__PACKAGE_VERSION__`, the stamp key and `stampVersion`.
[^version-check]: `packages/engine/src/schema/VersionCheck.ts`: `VersionCheck.inspect`, `VersionMismatch` and `VersionMismatchError`.
