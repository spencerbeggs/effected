---
type: DataModel
title: The runtimes bundled offline defaults
description: Three generated TypeScript files holding a filtered, feed-ordered snapshot of Node, Bun and Deno release data, used as the offline and auto-strategy fallback.
status: stable
resource: ../../packages/runtimes/src/internal/defaults
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: aa5914e7f9b1be5a
---

# The runtimes bundled offline defaults

## Shape

`src/internal/defaults/node.ts`, `bun.ts` and `deno.ts` each export one
`const` holding an array of release records for that runtime, in the
shape the corresponding live feed produces after the package's own
parsing rules filter it. Records are stored in **feed order** — the
generator never re-sorts them, so a regeneration diff reflects only what
upstream actually changed rather than an incidental reordering.

Each file carries hand-written headers, imports, TSDoc and type
annotations around the generated `const`; only the initializer's byte
span is machine-written. This is deliberate: a human-authored comment
explaining the file's purpose, or a type annotation pinning the exported
shape, survives regeneration untouched.

## What is derived from it

`layer` (auto strategy) and `layerOffline` on each of the three resolvers
(`NodeResolver`, `BunResolver`, `DenoResolver` — see
[cache-strategy-as-layer](../decisions/cache-strategy-as-layer.md)) read
these constants with no IO. `layerOffline` never reaches the network at
all; `layer` falls back to them when a live fetch fails, and records the
fallback in the release index's provenance marker — see
[provenance lives in the engine state](../decisions/runtimes-provenance-in-engine-state.md).

## What breaks if an entry is wrong

Every record here is filtered through the library's own version parse
before it is written, so an entry that survives into these files is
guaranteed resolvable — the same rule the live resolvers apply to live
data, meaning a malformed record cannot enter through this path. What
*can* go wrong is staleness: if a scheduled regeneration silently stops
running, the offline and auto-fallback answers drift further from
reality over time, though never past what the last successful
regeneration recorded. The generation script itself
(`packages/runtimes/lib/scripts/generate-defaults.ts`) refuses to write a
zero-length result from any feed, specifically to prevent a failed or
truncated fetch from overwriting a good snapshot with an empty one.

## Regeneration

See [regenerate the runtimes bundled offline
defaults](../runbooks/regenerate-runtimes-bundled-defaults.md). The
generation script is a script-only devDependency path — nothing under
`packages/runtimes/src/**` imports `oxc-parser`, so the package's
[dependency posture](../decisions/runtimes-http-over-core-no-octokit.md)
is unaffected by how these files are produced.
