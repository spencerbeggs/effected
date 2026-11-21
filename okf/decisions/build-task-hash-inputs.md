---
type: Decision
title: The build task hashes CI and GITHUB_ACTIONS, not pending changesets
description: "turbo.json's build task dropped $TURBO_ROOT$/.changeset/** from its inputs and hashes the CI and GITHUB_ACTIONS environment variables instead, because pending changesets only feed optimistic next versions, which CI turns off."
status: stable
tags:
  - ci
  - performance
  - release
sources:
  - id: turbo-json
    resource: ../../turbo.json
  - id: bundler-ts
    resource: ../../packages/bundler/src/Bundler.ts
  - id: cli-main-ts
    resource: ../../packages/cli/src/main.ts
generated:
  by: "okfit/claude-code"
  at: 2026-11-21T19:43:06Z
integrity:
  generated:
    body: 410a057ae9cfb291
  verified:
    by: human:spencer
    at: 2026-11-21T19:47:48Z
    content: 7e2076ed7de2bf48
verified:
  - by: human:spencer
    at: 2026-11-21T19:47:48Z
---

# The build task hashes CI and GITHUB_ACTIONS, not pending changesets

## Context

The `build` task listed `$TURBO_ROOT$/.changeset/**` among its inputs. The bundler reads pending changesets for one thing: the optimistic next version it writes into a package's API-model meta bundle. Optimism is `"auto"` by default, and `"auto"` resolves to false under CI.[^bundler-ts] The `effected` CLI passes `isCI(process.env)` as that flag.[^cli-main-ts] So in CI every new or edited changeset changed every `build` hash and changed no output: the input was pure cache-busting on the one path where the cache matters most.

## Decision

`build` no longer hashes `.changeset/**`. It hashes the `CI` and `GITHUB_ACTIONS` environment variables instead, through the task's `env` key, so a CI build and a local build of the same source never share a cache entry: they can legitimately differ, because optimism is on locally and off in CI.[^turbo-json]

## Consequences

- A pull request that adds a changeset no longer misses every `build` in CI.
- **Accepted cost, local only:** after a changeset edit, a locally cached `build` replays with the next version it computed before the edit, so the meta bundle's next version can be stale until a source input changes or the cache is bypassed. Publishes are unaffected, because they build in CI, where the next version is never read from changesets.

## Alternatives rejected

- **Keep `.changeset/**` as an input.** That preserves local accuracy of a field that only matters locally, and pays for it with a full `build` miss on every CI run that touches a changeset.
- **Hash `.changeset/**` only outside CI.** Turbo task inputs cannot be conditioned on the environment, and hashing `CI` already separates the two cases.

[^turbo-json]: `turbo.json` — `build` has `"env": ["CI", "GITHUB_ACTIONS"]` and no `.changeset/**` entry in `inputs`.
[^bundler-ts]: `packages/bundler/src/Bundler.ts` — `optimistic: config.meta.optimistic === "auto" ? !options.ci : config.meta.optimistic`.
[^cli-main-ts]: `packages/cli/src/main.ts` — `run(options, { cwd: process.cwd(), ci: isCI(process.env) }, ...)`.
