---
type: Gotcha
title: A root workspace:* devDependency puts its whole closure into turbo's global hash
description: "Turbo folds the root package.json's internal dependencies into globalCacheInputs.hashOfInternalDependencies, so a root devDependency at workspace:* makes an edit to any package in its closure, even a test file, miss every task's cache; the root declares them link:packages/<name> instead."
status: stable
resource: ../../package.json
stale_after: 2027-05-21T00:00:00Z
tags:
  - ci
  - performance
  - dx
sources:
  - id: root-package-json
    resource: ../../package.json
  - id: turbo-json
    resource: ../../turbo.json
  - id: ci-cache-runs
    resource: GitHub Actions runs of the Silk workflow on PR 1382 and five other pull requests
    last_modified: 2026-11-21T00:00:00Z
generated:
  by: "okfit/claude-code"
  at: 2026-11-21T19:43:06Z
integrity:
  generated:
    body: 4209adc78a0290aa
---

# A root workspace:* devDependency puts its whole closure into turbo's global hash

## What a reader sees

Every CI pull-request run builds and typechecks everything from scratch: 0 of 81 turbo tasks hit the cache, and the S3 remote cache reports `0 hits, 110 misses, 110 uploads`, on PR 1382 and five other PR runs measured on 2026-11-21.[^ci-cache-runs] The cache is configured, uploads succeed, and the task inputs in `turbo.json` look narrow, so nothing in the configuration explains it.

## What they wrongly conclude

That the remote cache is broken, that the runners' cache scope is wrong, or that some task's `inputs` glob is too wide. None of those is the cause, and tuning `inputs` changes nothing.

## What is actually true

Turbo treats the **root** `package.json`'s workspace dependencies as internal dependencies of the whole repository and folds their hashes into the global hash, `globalCacheInputs.hashOfInternalDependencies`, which every task's hash includes. The root declared three devDependencies at `workspace:*` (`@effected/plugin`, `@effected/changesets`, `@effected/workspaces`), and their transitive closure reached about 51 packages. Editing any file in any of them, a test file included, changed the global hash and therefore every task's hash. A fresh clone proved it: a one-line comment added to `packages/env/__test__/RuntimeEnv.test.ts` changed the hash of `@effected/semver#types:check`, a task with no edge to `env`.

The root now declares them `link:packages/<name>`.[^root-package-json] The lockfile resolution is the same (`version: link:packages/<name>`), the bins are still linked into `node_modules/.bin`, and turbo no longer treats them as internal dependencies. A simulated pull request went from 0 to 33 of 40 `types:check` cache hits.

**Never restore `workspace:*` on the root `package.json`.** This applies to the root manifest only: packages keep `workspace:*` and `workspace:^` for their internal edges.

## The tell

```bash
turbo run types:check --dry=json | jq .globalCacheInputs.hashOfInternalDependencies
```

The result must be empty. A non-empty value means a root dependency is being treated as internal again, and every task's cache key moves with it.[^turbo-json]

[^root-package-json]: `package.json` — the root `devDependencies` declare `@effected/changesets`, `@effected/plugin` and `@effected/workspaces` as `link:packages/<name>`.
[^turbo-json]: `turbo.json` — the task graph whose hashes include the global hash; nothing in it narrows `hashOfInternalDependencies`.
[^ci-cache-runs]: GitHub Actions Silk workflow runs, 2026-11-21: turbo's run summary reported 0/81 cache hits and the S3 cache step `0 hits, 110 misses, 110 uploads`.
