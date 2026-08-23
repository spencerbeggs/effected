# Discovery — @effected/workspaces

Why the enumerator, the root ascent, `WorkspacePackage` and `PackageManagerDetector` are shaped the way they are. The rules themselves are in the parent; this is the reasoning behind them.

**Parent:** [@effected/workspaces context](./CLAUDE.md)

## The `packages:` enumerator (workspaces issue #62)

v3's `glob-core.ts` silently rewrote a trailing `/**` to `/*`, so `packages/**` matched one level and a nested package went undiscovered with **no diagnostic**. `internal/enumerate.ts` is the fix: `GlobSet` classifies the pattern set, `GlobPattern.crossesSegments` picks a single-level read vs. a bounded iterative descent, `enumerationPrefix` says where to start. The descent is a **worklist, not a recursion** (cannot overflow), bounded by `maxDepth` (integer-guarded: `NaN` and `2.5` are **defects** — a bare `depth < maxDepth` admits both, then enumerates nothing, indistinguishable from a legitimate empty result), a visit budget, and an unconditional `node_modules` / `.git` prune.

## One traversal, two entry points

Both entry points drive **one traversal state machine**, `internal/traverse.ts`, which owns the dequeue order (a head index, never `Array.shift()`), the depth rule, the visit budget and the prune list. Two hand-written copies is exactly how they drifted: the sync copy once returned a package one level past the cap the Effect enumerator rejected. The only deliberate difference is at the bound — Effect fails typed, sync truncates — and `__test__/WorkspacesSync.test.ts` drives both against one tree at the boundary.

`WorkspacesSync` imports nothing platform-shaped. Both entry points are **positional-path-first, options second**: `findWorkspaceRootSync(cwd, options)` / `getWorkspacePackagesSync(root, options)` (issue #110 unified them; `cwd` is required, so the module no longer reads an ambient `process.cwd()`). The options bag carries consumer-supplied `fileSystem` + `path` ops (`node:fs` / `node:path` satisfy them one-liner each), so Windows correctness is the consumer passing a win32-appropriate `path` — the `TsconfigLoaderSync` convention.

`SyncFileSystem.readDirectoryWithTypes` is an **optional** fast path (`nodeFileSystem` supplies it) collapsing readdir-then-`isDirectory`-per-entry into one `readdirSync(p, { withFileTypes: true })`; `readResolvedEntries` falls back to the four required operations when it is absent, so it is a cost optimization and never a behavior switch. It **re-resolves symbolic links through `isDirectory`** — a `Dirent` describes the link, not its target, so trusting `isDirectory` on one silently drops every symlinked package directory. Both paths are mutation-pinned in `__test__/WorkspacesSync.test.ts`; test them against `MemoryFileSystem.syncFileSystem(volume)`, which satisfies `SyncFileSystem` structurally with no import either way.

## The ascent is bounded on request

`find(cwd, options?)` takes `{ stopAt, maxDepth }`, both passed straight through to `Walker.ascend` — walker already owned both concepts. `stopAt` is inclusive (the ceiling is itself probed) and is `path.resolve`d first: walker compares it to each ancestor by string equality, so an unresolved ceiling would never match and would silently degrade to the unbounded ascent the option exists to prevent. An unmarked ceiling fails typed with `stopAt` recorded on the error, which is what distinguishes "no root anywhere above me" from "none below my ceiling". `findWorkspaceRootSync` has **not** been given the same bounds.

`WorkspaceRoot.makeTest(root)` / `layerTest(root)` are the sanctioned double — consumers were writing nine copies of `Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed("/repo") })`. The double **honours `stopAt`**: a hand-rolled `find` that ignores the ceiling makes a bounded call pass under test and fail live, the very failure `stopAt` exists to catch. It deliberately does not model `maxDepth` — it never walks, so there is no depth to cap and pretending otherwise would encode a fiction. `WorkspaceRootShape` is exported so a consumer can type a bespoke double against the contract.

## `WorkspacePackage` is deliberately tolerant

It does not embed `@effected/package-json`'s `Package`: that model requires a strict `SemVer`, so one member with an odd version would fail discovery for the whole repo. `WorkspacePackage.manifest` is the opt-in bridge to the strict model — an `Effect.fn` **static** carrying the named span, with a thin instance wrapper (`pkg.manifest()`) delegating to it. It deliberately **re-reads** the file, a point-in-time refresh; for tolerant access to fields outside the typed discovery slice (`scripts`, `exports`, …) without a second read, `manifestRecord` captures the as-read `package.json` record (values `unknown`; defaults to `{}` for values serialized before the field existed).

`workspaceRoot` is a **required carried field**, not a derived getter. Discovery resolved the root before enumerating and the sync entry point is handed it, so dropping it was pure information loss — consumers were reconstructing it by counting `relativePath` segments and re-ascending that many `..`. Required is the one breaking change here: a `WorkspacePackage` serialized before the field existed now fails decode. The asymmetry with `manifestRecord` is deliberate — `{}` is an honest "no record", but there is no honest default root, and a placeholder would hand back a wrong absolute path that consumers resolve config against, silently reading the wrong `.changeset/config.json`. Both halves are asserted in `WorkspacePackage.test.ts`; failing decode is the conservative direction because re-running discovery is cheap.

## One layer, many roots: `listPackagesIn` / `infoIn`

The layer-bound methods answer about the root resolved from `options.cwd`. A **long-lived host** — an MCP or language server — resolves that once at startup and then serves calls scoped to a git worktree of the same repo, a nested repo, or another project; it cannot vary the root per call without a fresh layer. `listPackagesIn(directory)` and `infoIn(directory)` resolve THAT directory's root by the same upward walk and re-read everything beneath it.

**They re-read; they do not re-root — and the cheap alternative is the trap.** Rewriting the layer's package `path`s onto the caller's directory yields correct-looking paths over the ORIGINAL root's manifests, so a worktree whose branch adds, removes or renames a package silently reports the other branch's membership, with names and versions wrong the same way. A downstream consumer shipped exactly that workaround and documented the limitation; these methods lift it. `__test__/WorkspaceDiscoveryPerRoot.test.ts` fixtures two workspaces that **disagree** on membership and versions, because roots that agree cannot discriminate the two implementations.

Memoization is per **resolved** root (so sibling directories in one workspace share one discovery), in a map deliberately separate from the layer-bound memo — folding them together would make every layer-bound call re-run the root ascent. It grows one entry per distinct root, which is the point for a multi-worktree host; `refresh()` clears all of them plus the layer-bound one.

**Both die unstubbed on the double.** Deriving `listPackagesIn` from `listPackages` would model every root as identical — the exact confusion the method removes — so a fabricated default could not discriminate a consumer calling the wrong one.

## `PackageManagerDetector` refuses to guess

Its chain runs three tiers: the workspace markers, then a standalone tier (`pnpm-lock.yaml`, `package-lock.json`, and the bun/yarn lockfiles under the **same** manifest conjunction the workspace tier uses), then a declaration tier (`packageManager` / `devEngines.packageManager` with no lockfile at all — a fresh clone before its first install). Nothing matching is `PackageManagerDetectionError`.

The standalone and declaration tiers run **last**, so the widening is strictly additive: no previously-resolving input can change its answer, and a stray `package-lock.json` cannot turn a pnpm workspace into an npm repo. `__test__/PackageManagerDetector.test.ts` pins that ordering; reordering the tiers is the obvious and wrong "simplification".

Adding a fallback default is the tempting wrong fix. silk-release-action did it twice and picked *different* defaults each time — `"npm"` in `main.ts`, `"pnpm"` in `detect-repo-type.ts` — the proof that the choice is policy, not detection. A consumer that wants one writes `Effect.orElseSucceed` at its own call site, visibly.

`makeTest` / `layerTest` is the sanctioned double, and an unstubbed `detect` **dies**. Failing typed is the subtler wrong shape, because `PackageManagerDetectionError` looks like a legitimate "no manager here" answer a consumer branches on, so the forgotten stub never surfaces. Both are mutation-pinned in `__test__/PackageManagerDetectorDouble.test.ts`.

**Related:** [surface](./CLAUDE.surface.md) · [catalogs](./CLAUDE.catalogs.md) · [snapshots](./CLAUDE.snapshots.md) · [peers](./CLAUDE.peers.md)
