---
type: Runbook
title: Regenerate the runtimes bundled offline defaults
description: Refresh the three offline version snapshots @effected/runtimes falls back to, from the live release feeds.
status: stable
resource: ../../packages/runtimes/lib/scripts/generate-defaults.ts
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: de592266e0468f91
---

# Regenerate the runtimes bundled offline defaults

## Trigger

The offline snapshots in `packages/runtimes/src/internal/defaults/`
(`node.ts`, `bun.ts`, `deno.ts` — see
[the bundled-defaults data model](../models/runtimes-bundled-defaults.md))
have drifted from the live Node, Bun and Deno release feeds, or a
scheduled workflow run detects that drift automatically. This runs daily
via CI and can also be run by hand.

## Steps

1. Run `pnpm --filter @effected/runtimes exec tsx lib/scripts/generate-defaults.ts`.
   The script is a devDependency-only script (`oxc-parser`, `tsx`) — it is
   never invoked by the test suite, because it performs live network IO.
2. The script fetches each of the three live feeds through the package's
   own `internal/feeds.ts` layer — the same tag-strip, skip and parse
   rules the runtime resolvers use at runtime, single-sourced rather than
   reimplemented as a standalone client.
3. For each target file, the script parses it with `oxc-parser` and
   splices only the byte span of each exported const's initializer,
   leaving headers, imports, TSDoc and type annotations untouched — the
   same technique `@effected/spdx`'s vendored-data regeneration uses.
   Records are written in feed order; the script never re-sorts, so the
   generated diff reflects only what upstream actually changed.
4. Every record is filtered through the library's own parse before
   writing, so a snapshot holds only resolvable versions — the same rule
   the live resolvers apply to live data.
5. **If any feed returns a zero-length result, the script refuses the
   write outright** rather than committing an empty or truncated
   snapshot over a good one. A failed or truncated fetch must never
   silently corrupt the offline fallback the auto and offline strategies
   depend on.
6. When the script produces a diff, review it: it should touch only the
   snapshot bodies (the const initializers), never headers, imports,
   TSDoc or type annotations.
7. Confirm the package builds and stays green on the regenerated data —
   `pnpm build --filter @effected/runtimes` and the package's test suite.
8. A second run of the script against the same live feeds should be
   idempotent (no further diff).

## Observable end state

The three snapshot files under `src/internal/defaults/` reflect the
current live feed contents, filtered to resolvable versions and ordered
as the feed returned them; the package builds and its test suite passes
against the regenerated data. In CI, a diff produced this way is
committed via an auto-merging pull request carrying both the regenerated
snapshots and a `patch` changeset, with the verification build run with
coverage disabled — this repository's vitest config enforces global
coverage thresholds a single-package subset run cannot meet, and that
mismatch would abort the job for a reason unrelated to whether the
regenerated data is correct.
