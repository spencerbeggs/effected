---
type: Decision
title: PackedInstall packs the prod npm directory by default
description: "Probe P3 compared pnpm-packing a package's source against npm-packing its dist/prod/npm/pkg build, and PackedInstall's default packFrom became { directory: \"dist/prod/npm/pkg\" }."
status: stable
tags:
  - architecture
sources:
  - id: packed-install-ts
    resource: ../../packages/workspaces/src/PackedInstall.ts
  - id: p3-probe
    resource: probe P3, run 2026-09-23 in the gitignored scratchpad workspace (not committed)
  - id: packed-install-e2e
    resource: ../../packages/workspaces/__test__/e2e/PackedInstall.e2e.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-24T01:41:28Z
  body_sha256: 6c56e28c0ca5287c0424caac8399e07e6262c6b97c65d4a046aaa097657dc595
---

# PackedInstall packs the prod npm directory by default

## Context

`PackedInstall` needs a tarball per closure package, and a package can be
packed from two places. Candidate A runs `pnpm pack` in the package's source
directory, where pnpm honours `publishConfig.directory` and rewrites
`workspace:` and `catalog:` specifiers. Candidate B runs `npm pack` in
`dist/prod/npm/pkg`, the effected bundler's prod npm output, whose manifest
the build has already made publish-ready.

Probe P3 packed five packages (`engine`, `mcp`, `cli`, `schemastore`,
`schemastore-cli`) both ways under npm 11.19.1, pnpm 12.5.1 and bun 1.4.2,
with yarn absent from the machine.[^p3-probe] Its eight criteria and what it
recorded:

| Criterion | Result |
| --- | --- |
| C1: the pack exits 0 with exactly one `.tgz` | both candidates, all five packages |
| C2: no `workspace:` or `catalog:` specifier survives in the packed manifest | both candidates, all five packages |
| C3: every `exports` and `bin` target is in the tarball | both candidates, all five packages |
| C4: the tarball's file list equals `dist/prod/npm/pkg` | B: empty difference for all five. A: every `*.js.map` and `*.d.ts.map` only in the tarball, `tsdoc-metadata.json` only in the prod build, for every package |
| C5: `private` is `false` in the packed manifest | both candidates, all five packages |
| C6: scenario installs (S1: `mcp` with its `engine` peer; S2: the `schemastore-cli` bin) | exit 0 for both candidates under npm, pnpm and bun |
| C7: the installed code runs from the consumer root | S2 passes everywhere. S1 passes under npm and bun, and fails `ERR_MODULE_NOT_FOUND` on `@effected/engine` under pnpm, identically for both candidates |
| C8: `pnpm pack` rewrites `workspace:^` in a never-installed workspace | no: it fails `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`, exit 1 |

C4 is the discriminator. Under the effected bundler `publishConfig.directory`
names `dist/dev/pkg`, so candidate A packs the **dev** build: source maps
present, `tsdoc-metadata.json` absent. Candidate B is the file list a release
actually publishes.

The literal outcome rule read "F", because neither candidate cleared C7 under
pnpm for S1. That failure is not a pack-source property: the S1 consumer
imported `@effected/engine` without declaring it, and pnpm's isolated layout
links only declared dependencies at a project's top level. The override
resolved the peer correctly inside `mcp` for both candidates; npm and bun
hoist, and passed.

## Decision

The default `packFrom` is `{ directory: "dist/prod/npm/pkg" }` (outcome D),
packed with `npm pack --ignore-scripts`.[^packed-install-ts] It is the
artifact a release publishes. `"source"` stays available as an explicit
choice.

The S1 finding became an option rather than a verdict: `consumerDependencies`
declares every package the consumer's own code imports, and its TSDoc names
pnpm's isolated layout as the reason.

## Alternatives rejected

**`"source"` as the default (candidate A).** It proves the dev build, not the
published one: a file the prod build drops, or a map the prod build omits,
would pass here and differ in the release. It also fails outright in a
workspace that has never been `pnpm install`ed (C8), which is exactly the
state of a fresh CI checkout that skipped install, or a generated fixture.

**No default (outcome F taken literally).** It would make every consumer
choose a pack source to work around a fixture defect that affected both
candidates equally.

## Consequences

- A consumer must build before running `PackedInstall`. A missing
  `dist/prod/npm/pkg/package.json` fails `PackSourceMissing`, naming the
  package to build.
- A repository not on the effected bundler passes its own `{ directory }`.
- Source mode needs the workspace installed first. `PackedInstall` detects
  pnpm's error code and says so in the `PackFailed` message.
- The e2e proves both modes against a generated fixture: the default mode
  without a `packFrom`, and source mode after an offline
  `pnpm install`.[^packed-install-e2e]

[^p3-probe]: Probe P3's results and findings, recorded here because the
    scratchpad is not committed.
[^packed-install-ts]: `packages/workspaces/src/PackedInstall.ts` —
    `DEFAULT_PACK_FROM` and the `PackSource` TSDoc.
[^packed-install-e2e]: `packages/workspaces/__test__/e2e/PackedInstall.e2e.test.ts`
    — the prod-default and source-mode tests.
