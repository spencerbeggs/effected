---
status: current
module: effected
category: migration
created: 2026-07-25
updated: 2026-07-25
last-synced: 2026-07-25
completeness: 90
related:
  - README.md
  - ../packages/github-actions.md
  - ../packages/commands.md
  - ../packages/glob.md
---

# silk-runtime-action — migration map

## Overview

`/Users/spencer/workspaces/savvy-web/silk-runtime-action` provisions a job's toolchain — Node, Bun, Deno and a raw Biome binary — restores the dependency cache, and stands up an embedded Turbo remote-cache server backed by either the Actions cache or an S3-compatible bucket.

**Blast radius.** Ten src files and six test files import `@savvy-web/github-action-effects`. This is the **sixth consumer**, missed by the original six-repo spec and surveyed separately in `2026-07-25-silk-runtime-action-survey.md`; it is the only repo that touches the **runner-local half** of the package exclusively — no GitHub API services, no SBOM, no publishing. It is also the reason `BlobStore` survives the split at all.

Four capabilities here exist nowhere else in the consumer set, and each one drove a Phase 3 design decision: the detached long-lived child process with a pid that outlives its phase, a secret-carrying config handoff across a process boundary, `ToolInstaller` as a real toolchain provisioner, and the `ActionCache` restore-key ladder.

## `@savvy-web/github-action-effects`

| Old construct | Where used | Effected replacement | Status |
| --- | --- | --- | --- |
| `Action` | `src/main.ts`, `src/post.ts` | `Action.run` (`@effected/github-actions`) | Phase 3 pending |
| `Step` | `src/post.ts`, `src/program.ts` | `ActionLogger` buffered step renderer (`@effected/github-actions`) | Phase 3 pending |
| `ActionInput` | `src/program.ts` | `ActionInput.string` / `.boolean` / `.redacted` — `Config`-backed (`@effected/github-actions`) | Phase 3 pending |
| `ActionOutputs` / `ActionOutputsShape` | `src/program.ts`, `src/services/runtime-installer.ts`, `src/services/turbo-cache/apply.ts` | `ActionOutputs` (`@effected/github-actions`) | Phase 3 pending |
| `ActionState` / `ActionStateLive` | `src/post.ts`, `src/program.ts`, `src/layers/app.ts`, `src/services/cache.ts`, `src/services/turbo-cache/apply.ts` | `ActionState`, plus `saveSecret(key, secret)` for the plaintext-by-protocol case (`@effected/github-actions`) | Phase 3 pending |
| `ActionEnvironment` / `ActionEnvironmentLive` | `src/services/cache.ts`, `src/layers/app.ts` | `ActionEnvironment` (`@effected/github-actions`) | Phase 3 pending |
| `ActionCache` / `ActionCacheLive` / `ActionCacheError` | `src/post.ts`, `src/layers/app.ts`, `src/services/cache.ts` + 3 test files | `ActionCache` + the new `CacheKey` module (`@effected/github-actions`) | Phase 3 pending |
| `ToolInstaller` / `ToolInstallerLive` / `ToolInstallerError` | `src/program.ts`, `src/layers/app.ts`, `src/services/runtime-installer.ts` + tests | `ToolInstaller` — download / extract / cache (`@effected/github-actions`) | Phase 3 pending |
| `CommandRunner` / `CommandRunnerLive` | `src/program.ts`, `src/layers/app.ts`, `src/services/cache.ts`, `src/services/runtime-installer.ts` + tests | **not a service** — `Run.collect` free combinators over core's `ChildProcessSpawner` (`@effected/commands`) | shipped |
| `Glob` / `GlobLive` (incl. `glob.hashFiles`) | `src/layers/app.ts`, `src/services/cache.ts` | pattern matching → `@effected/glob` (shipped); `hashFiles` → `CacheKey.hashFiles` (`@effected/github-actions`) | shipped / Phase 3 pending |
| `BlobStore` / `GitHubBlobStoreLive` / `S3BlobStoreLive` | `src/services/turbo-cache/handler.ts`, `src/turbo-server.ts` | `BlobStore` with a per-call metadata schema; `BlobStore.layerGitHubCache` and `BlobStore.layerS3(config)` (`@effected/github-actions`) | Phase 3 pending |
| `GithubMarkdown` | `src/services/summary.ts` | `ActionLogger` summary surface (`@effected/github-actions`) | Phase 3 pending |
| `./testing` doubles — `ActionCacheTest`, `ActionEnvironmentTest`, `ActionLoggerTest`, `ActionOutputsTest`, `ActionStateTest`, `CommandRunnerTest`, `GlobTest`, `ToolInstallerTest`, `BlobStoreTest` | `src/program.test.ts`, `src/post.test.ts`, `src/services/cache.test.ts`, `src/services/runtime-installer.test.ts`, `src/services/turbo-cache/{apply,handler}.test.ts` | per-service `layerTest(overrides?)` on the main entry; **no `./testing` subpath**. `CommandRunnerTest`'s exit-0-for-unregistered lie dies with it | Phase 3 pending |

## `@savvy-web/silk-effects`

Not consumed. Zero occurrences repo-wide.

## `@effected/*` already in use

| Package | Where | Constructs |
| --- | --- | --- |
| `@effected/jsonc` | `src/services/config-loader.ts` | `Jsonc` |

## Hand-rolled code the kit absorbs

| Local file | What it hand-rolls | Effected construct | Status |
| --- | --- | --- | --- |
| `src/services/turbo-cache/codec.ts` | `encodeArtifact` / `decodeArtifact` — a fixed 8-byte header (BE u32 tag length + BE u32 duration ms) then UTF-8 tag then body; a truncated frame silently decodes to `null` | `BlobEnvelope.encodeResult` / `.decodeResult` — magic prefix, version byte, caller-owned metadata schema, and a typed `BlobEnvelopeError` with `notAnEnvelope` / `truncated` / `unsupportedVersion` reasons (`@effected/github-actions`) | Phase 3 pending |
| `src/services/turbo-cache/handler.ts` | `ARTIFACT_KEY_VERSION = "v2"` prefixed into every storage key so a codec change orphans old blobs | **deleted by construction** — the envelope carries the version, so keys stay stable across format revisions and a stale entry is a clean miss (`@effected/github-actions`) | Phase 3 pending |
| `src/services/turbo-cache/lifecycle.ts` (`spawnTurboServer`) | `node:child_process.spawn` with `detached: true`, stdio to a log file, `child.unref()` | `DetachedProcess.spawn(options)` — the fd-level spawn lives in the one package permitted to do it (`@effected/github-actions`) | Phase 3 pending |
| `src/services/turbo-cache/lifecycle.ts` (`waitForServer`) | `fetch` against `/v8/artifacts/status` under `Effect.retry` + `Schedule.spaced`, never failing | `DetachedProcess.awaitReady(probe, options?)` (`@effected/github-actions`) | Phase 3 pending |
| `src/services/turbo-cache/lifecycle.ts` (`killProcess`) | `process.kill` with a `pid <= 0` guard and an already-gone swallow | `DetachedProcess.reap(pid, signal?)` — the `pid <= 0` guard is typed, and `ProcessId` is validated coming *out* of `ActionState` too (`@effected/github-actions`) | Phase 3 pending |
| `src/program.ts` + `src/services/turbo-cache/lifecycle.ts` (`buildSpawnSpec`) + `src/turbo-server.ts` | `Redacted.value` → plaintext `TURBOGHA_S3_*` env vars → `Redacted.make` on the far side, with a separate `outputs.setSecret` call to mask | `Secret.forChildEnv(entries)` (masks *as* it declassifies) and `Secret.adopt(name)` on the far side (`@effected/github-actions`) | Phase 3 pending — decisions-log item 14 |
| `src/services/cache.ts` | `generateCacheKey` (`platform-versionHash8-branchHash8-lockfileHash8`) and `generateRestoreKeys` (the two-rung ladder, empty under `cacheBust`) | `CacheKey` — primary key, restore ladder, branch-aware derivation (`@effected/github-actions`) | Phase 3 pending |
| `src/services/cache.ts` | `hashString` — `node:crypto` SHA-256 truncated to 8 hex — and `hashFiles` over the lockfile glob set | `CacheKey.hashFiles` over a compiled `@effected/glob` pattern set (`@effected/github-actions`) | Phase 3 pending |
| `src/turbo-server.ts` | `ManagedRuntime.make(liveLayer)` — a second Effect bootstrap outside `Action.run`, because the detached server is a raw `node:http` process | **stays local** — `Action.run` is a phase entry point; a detached server legitimately builds its own runtime | consumer-side composition |
| `src/program.test.ts`, `src/services/config-loader.test.ts` | `Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({...}))` with bespoke fake `SystemError` classes | core `FileSystem.layerNoop` plus per-service `layerTest` — no fake error classes | Phase 3 pending |
| `src/post.test.ts` | A capturing `Logger.make(…)` to assert on emitted lines | `ActionLogger.layerTest` / `layerSilent()` (`@effected/github-actions`) | Phase 3 pending |
| `src/program.test.ts` | A hand-duplicated copy of the `program` orchestration, because `src/program.ts`'s real pipeline is `/* v8 ignore */`-ed as untestable | dissolves with `layerTest(Partial<Shape>)` doubles — the pipeline becomes testable in place | Phase 3 pending |

## Stays local

- **The Turbo remote-cache protocol** — `/v8/artifacts` routing, the `x-artifact-tag` / `x-artifact-duration` semantics, and the raw `node:http` server. The kit owns framing and storage; Turbo's contract is this repo's domain.
- **`src/descriptors/{node,bun,deno,biome}.ts`** — per-runtime download URLs, archive shapes and platform/arch binary-name maps. `ToolInstaller` provides the mechanism; which URL to fetch is policy. Adjacent to `@effected/runtimes`, which resolves *versions* but does not install them.
- **`src/services/config-loader.ts`** — already on `@effected/jsonc`.
- **Backend selection by `TURBOGHA_BACKEND`** and the S3-vs-Actions-cache decision.
- **The `installBiome` special case** — a single raw binary rather than an archive, so it drives `ToolInstaller` primitives directly.

## Open questions

1. **`@effected/runtimes` overlap.** This repo installs Node/Bun/Deno from hand-maintained descriptors while `@effected/runtimes` resolves semver-compatible versions for exactly those three. Nothing in the program decides whether the descriptors should consume `runtimes`, and it is not a `github-actions` concern.
2. **The `CacheKey.hashFiles` home is explicitly provisional.** The design records the escalation: a second, non-Actions consumer moves it to a `@effected/hash` package or back into `walker` once core grows a digest contract. This repo is the only consumer today.
3. **Two Effect bootstrap paths.** `Action.run` in the main phases and `ManagedRuntime.make` in the detached server. The Phase 3 design covers the spawn and the handoff, not the far side's runtime construction — the detached process's layer wiring stays hand-written.
4. **`src/turbo-server.ts` is the one file that is both a consumer and a server.** It imports `BlobStore` backends directly rather than through the action's layer graph, which is what makes the plaintext env handoff necessary at all. Whether `Secret.adopt` is sufficient there, or the far side wants a designed config-envelope, was not settled.
