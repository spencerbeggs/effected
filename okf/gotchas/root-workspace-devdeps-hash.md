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
  - id: build-inputs-test
    resource: ../../__test__/build-inputs.test.ts
  - id: ci-cache-runs
    resource: GitHub Actions runs of the Silk workflow on PR 1382 and five other pull requests
    last_modified: 2026-11-21T00:00:00Z
generated:
  by: "okfit/claude-code"
  at: 2026-11-28T00:38:15Z
x-okfit-integrity:
  generated:
    body: 7cec6dcff935e81d
---

# A root workspace:* devDependency puts its whole closure into turbo's global hash

## What a reader sees

Every CI pull-request run builds and typechecks everything from scratch: 0 of 81 turbo tasks hit the cache, and the S3 remote cache reports `0 hits, 110 misses, 110 uploads`, on PR 1382 and five other PR runs measured on 2026-11-21.[^ci-cache-runs] The cache is configured, uploads succeed, and the task inputs in `turbo.json` look narrow, so nothing in the configuration explains it.

## What they wrongly conclude

That the remote cache is broken, that the runners' cache scope is wrong, or that some task's `inputs` glob is too wide. None of those is the cause, and tuning `inputs` changes nothing.

## What is actually true

Turbo treats the **root** `package.json`'s workspace dependencies as internal dependencies of the whole repository and folds their hashes into the global hash, `globalCacheInputs.hashOfInternalDependencies`, which every task's hash includes. The root declared three devDependencies at `workspace:*` (`@effected/plugin`, `@effected/changesets`, `@effected/workspaces`), and their transitive closure reached about 51 packages. Editing any file in any of them, a test file included, changed the global hash and therefore every task's hash. A fresh clone proved it: a one-line comment added to `packages/env/__test__/RuntimeEnv.test.ts` changed the hash of `@effected/semver#types:check`, a task with no edge to `env`.

The root now declares them `link:packages/<name>`.[^root-package-json] The lockfile resolution is the same (`version: link:packages/<name>`), the bins are still linked into `node_modules/.bin`, and turbo no longer treats them as internal dependencies. A simulated pull request went from 0 to 33 of 40 `types:check` cache hits.

**That global hash was also, by accident, the only thing tying a build to the tool that ran it.** Every package's `build` runs `effected package build`, and no package depends on `@effected/plugin`, so no `^` edge reaches the bundler, engine or cli source. With the root edges gone, a pull request that changed only `packages/bundler/src` left every other package's `build` hash unchanged and would have replayed `dist` built by the old bundler. The `build` task therefore names the toolchain's sources as explicit inputs: one `$TURBO_ROOT$/packages/<dir>/src/**` entry for each package in `@effected/plugin`'s workspace closure (runtime, peer and optional edges), `public/**` (the tsconfig presets every package extends live in `packages/plugin/public`) and `package.json` for every package.[^turbo-json] The list once was a glob over every package's source, on the reading that the closure was 51 of 55 packages; it is 37 of 56, and the glob cost every package's build its cache whenever any of the other 19 changed, which put a cold full build on most pull requests' critical path. `__test__/build-inputs.test.ts` derives the closure from the manifests and fails until `turbo.json` names exactly it, so a new edge into the tool cannot go unhashed.[^build-inputs-test] A test-only edit still leaves every other package's `build` alone, and `types:check` keeps none of these inputs, which is where the cache gain lives.

**Never restore `workspace:*` on the root `package.json`, and never drop the toolchain inputs from `build` or edit their list by hand to silence the test.** The first brings back the zero-hit cache; the second lets a bundler change ship stale `dist`. This applies to the root manifest only: packages keep `workspace:*` and `workspace:^` for their internal edges.

## The tell

```bash
turbo run types:check --dry=json | jq .globalCacheInputs.hashOfInternalDependencies
```

The result must be empty. A non-empty value means a root dependency is being treated as internal again, and every task's cache key moves with it.[^turbo-json] The second half of the tell: append a line to `packages/bundler/src/Bundler.ts` and `turbo run build --filter=@effected/semver --dry=json` must report a different `@effected/semver#build` hash with the same `@effected/semver#types:check` hash.

[^root-package-json]: `package.json` — the root `devDependencies` declare `@effected/changesets`, `@effected/plugin` and `@effected/workspaces` as `link:packages/<name>`.
[^turbo-json]: `turbo.json` — the task graph whose hashes include the global hash, and the `build` task's toolchain inputs; nothing in it narrows `hashOfInternalDependencies`.
[^build-inputs-test]: `__test__/build-inputs.test.ts` — `toolClosure`, and the test that `turbo.json`'s build source inputs equal it.
[^ci-cache-runs]: GitHub Actions Silk workflow runs, 2026-11-21: turbo's run summary reported 0/81 cache hits and the S3 cache step `0 hits, 110 misses, 110 uploads`.
