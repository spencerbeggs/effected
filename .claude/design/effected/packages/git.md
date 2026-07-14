---
status: current
module: effected
category: architecture
created: 2026-07-14
updated: 2026-07-14
last-synced: 2026-07-14
completeness: 95
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../roadmap.md
  - workspaces.md
  - glob.md
---

# @effected/git design

## Overview

**Implemented 2026-07-14** on `feat/git` (G1–G6), with every gate green: 44/44 tests, a `dist/prod/issues.json` at 0 errors / 0 warnings / 5 suppressed `_base` symbols. This doc records the *as-built* design; per the semver/jsonc/app precedent it stays `current`, with deviations from the pre-port draft noted inline as "As-built:".

Target design for `@effected/git`, a **boundary-tier** package created by the point-in-time workstream (2026-07-14) and on the `0.1.0` gate. It is typed git introspection for the kit: read a repository's state — file contents at a ref, tree listings, merge bases, changed paths — without checking anything out, plus exactly one mutating operation, `checkout`. It programs against **core's** subprocess contract — `ChildProcessSpawner` and `Command` values from `effect/unstable/process` — requiring the spawner in its `R` channel exactly as the kit's boundary packages require core `FileSystem`: the consumer's platform layer (`@effect/platform-node`'s `NodeServices.layer` provides `ChildProcessSpawner` among its services) discharges it once at the edge. It is the foundation `@effected/workspaces`' `ChangeDetector` and new `WorkspaceSnapshots` service stand on.

Scope is closed by its two consumers — workspaces, and savvy-web/systems' dependency-regeneration engine — not by git's porcelain. There are no ambitions toward a general git client; an operation earns a method here when a consumer needs it typed.

Names and exact signatures below are design-level; they are confirmed at the effect-v4-planning gate when implementation starts, verified against the installed `effect` beta.

## Origin: GitReader dissolves

`@effected/workspaces` v1 shipped `GitReader` — a subprocess seam contract (`run(cwd, args)`, `available(cwd)`) with a `layerNode` default over `node:child_process.execFile` — on the reasoning that core had no subprocess API and taking `@effect/platform-node` would have made workspaces tier 3 for every consumer ([workspaces.md](workspaces.md#gitreader--the-subprocess-seam)). At beta.97 both halves of that reasoning are dead, and the point-in-time workstream is what exposed it:

1. **The spawning half is not git-specific — and its contract already exists in core.** `run(cwd, args)` is a subprocess runner wearing a git name, and `effect/unstable/process` publishes the public contract (`Command` values, `ChildProcessSpawner`) it was privately re-deriving. And the "taking platform-node = tier 3" half conflated a *dependency edge* with an *R-channel requirement*: requiring a core-declared service in `R` costs a consumer nothing ([R3](../effect-standards.md#dependency-policy)) — it is exactly how walker, xdg and config-file stay boundary over core `FileSystem`. Git requires `ChildProcessSpawner` the same way; no seam package exists anywhere. The two hard-won `layerNode` details survive as git decisions — locale-pinned env (`LC_ALL=C`) rides on core's `env` + `extendEnv` command options, and the per-run ceiling composes as `Effect.timeout`.
2. **The git half deserves real types, not raw strings.** Both consumers were about to interpret git output and exit codes themselves: workspaces' snapshot reader needs "file at ref, or none", and systems' DepsRegen today hand-rolls `git merge-base` and `git ls-tree` through `execFileSync` next to its engine. Interpreting git — the exit-code and stderr taxonomy, the absent-vs-error distinction, tree-entry parsing — is a concern that should exist **once**, typed, in a package named for it.

So `GitReader` dissolves: the mechanism was never the kit's to own — core declares it, platform layers provide it — and the meaning comes here; workspaces re-targets. **Now is the only cheap time.** Nothing publishes before the kit ships together at `0.1.0`, so this relocation is a refactor commit — the same reasoning that timed the runtimes rename and the walker extraction ([runtimes.md](runtimes.md#the-runtimes-rename), [walker.md](walker.md#consumer-impact-the-config-file-refactor)). After `0.1.0` it would be a breaking release across two packages.

## Tier and dependencies

**Boundary tier**, argued against the [dependency policy](../effect-standards.md#dependency-policy):

- **R1** — `peerDependencies: { effect: "catalog:effect" }`; **no `@effected` edges and no external runtime dependencies at all**, and no `node:` built-ins anywhere in this package — spawning is entirely behind core's `ChildProcessSpawner` contract, required in `R`.
- **R3** — requiring a core-declared service in `R` costs the consumer nothing: the IO is discharged by the platform layer provided once at the edge (`@effect/platform-node`'s `NodeServices.layer` carries `ChildProcessSpawner` alongside `FileSystem` and `Path`). This is the identical argument that keeps walker, xdg and config-file at tier 2 over core `FileSystem`.
- **R4** — tier follows this package's own surface: it performs IO through a core contract, which is the boundary-tier definition; it takes nothing tier 3, so R2 never fires. `@effect/platform-node` appears only in `devDependencies`, for the integration suite — devDependencies never count toward tier (the workspaces `self.int.test.ts` precedent).

## Public surface

### `GitCommand` — pure, inspectable invocations

Git-flavored constructors producing **core `Command` values** (`ChildProcess.make` under the hood): they know the `git` executable, the argument conventions of each operation, and the environment git needs pinned (`LC_ALL=C` via the command's `env` + `extendEnv: true`, so stderr classification is locale-stable without replacing the inherited environment). `GitCommand.show(ref, path)`, `GitCommand.lsTree(ref)`, `GitCommand.mergeBase(a, b)` and the rest produce values — a test can assert the exact `command`/`args`/`options` an operation will run without spawning anything, and a consumer can log or display an invocation before executing it.

### `Git` — the service

A `Context.Service` whose layer requires **`ChildProcessSpawner`** (core's contract, arriving in `R`). Two small **internal** helpers over the spawner — a collected-run (`spawn` scoped, stdout and stderr gathered concurrently, exit awaited: the stdout/stderr/exit-code triple every classification consumes) and an `available` probe (`git --version` through the spawner; a non-zero exit still proves existence, only a spawn-level failure means absent) — live in `internal/`, not on the public surface. Every method takes `cwd` explicitly — the same "never read `process.cwd()` silently" rule walker set; the caller who knows where "here" is passes it in. The per-operation ceiling is git's own policy — 30 seconds via `Effect.timeout`, owned here, not a spawner option.

| Method | git plumbing | Returns | Notes |
| --- | --- | --- | --- |
| `show(cwd, ref, path)` | `git show ref:path` | `Option<string>` | **Absent-at-ref degrades to `Option.none`, never an error** — the invariant `WorkspaceSnapshots.at` depends on: a package that does not exist at a ref is a fact about the ref, not a failure |
| `lsTree(cwd, ref)` | `git ls-tree -r` | parsed entries: path + object type | The input the compiled [`@effected/glob`](glob.md) set filters — glob.md recorded this exact use when at-ref discovery was deferred |
| `refExists(cwd, ref)` | `git cat-file -e` | `boolean` | The probe the v3 point-in-time reader used |
| `mergeBase(cwd, a, b)` | `git merge-base` | SHA | Replaces systems' hand-rolled `execFileSync` call |
| `changedFiles(cwd, { base, head })` | `git diff --name-only` | paths | What `ChangeDetector` runs on today via raw `GitReader` args |
| `revParse(cwd, ref)` | `git rev-parse` | SHA | Ref normalization for snapshot cache keys |
| `checkout(cwd, ref)` | `git checkout` | — | **The one mutating operation in the package**, documented as such; everything else is read-only |

`checkout` is deliberately alone. The read-only surface is what the two consumers need; `checkout` is the single mutation with a named consumer story (tooling that moves a worktree to a resolved ref). Further mutations (stash, worktree add/remove, commit) were considered and **rejected** — no current consumer, and a read-mostly package whose mutations are one clearly-marked method is easier to reason about than a porcelain grab-bag.

**As-built — `refExists` answering `false` for an unknown ref was a review-caught Critical fix (`bd5e0101`).** The first pass let an unrecognized-ref-syntax failure fall through to a die; the method's contract is "does `ref` resolve", so both a syntactically-valid-but-missing ref and an outright-unrecognized one now answer `false` — never an error, never a defect.

**As-built — `mergeBase` and `changedFiles` report `UnknownRefError.ref` as the `"a...b"` range label**, not either individual ref. A deliberate deviation from the single-ref methods (`show`, `lsTree`, `revParse`), which report the plain ref value; recorded here rather than left for a future reader to reverse-engineer from the source.

**As-built — the stderr taxonomy is unanchored substring matching** against `LC_ALL=C`-pinned phrases (`"not a git repository"`, `"unknown revision"`, `"does not exist in"`, etc.). A path or ref name that happened to literally contain one of these phrases could misclassify; accepted for now (see the acceptance comment above `UNKNOWN_REF_PATTERNS` in `Git.ts`), with anchoring deferred until a real collision is observed.

## Errors: classification happens once

The design rule: **no consumer of this package ever string-matches stderr.** Git's failure modes are classified here, once, into a small typed taxonomy:

- **`GitCommandError`** — git ran and failed in a way that is not one of the recognized domain cases, **or** the spawn itself failed (the spawner's `PlatformError` is absorbed here rather than leaked raw — consumers of `Git` see git's taxonomy, not core's plumbing). Carries `args`, `cwd`, `exitCode`, `stderr` when git ran (the fields workspaces' v1 `GitCommandError` carries — the name relocates with the seam), and the underlying cause when it did not. As-built: the absorbed `PlatformError` surfaces through `detail` — the NotFound arm renders the friendly install/cwd message, every other arm keeps the reason tag plus the platform error's own message, so `PermissionDenied`/`TimedOut` diagnostics survive the absorption (fresh-eyes PR review finding, pinned by a test).
- **`NotARepositoryError`** — the cwd is not inside a git work tree. Every consumer wants to branch on this (systems degrades, workspaces fails discovery), so it is a distinct tag, not a `GitCommandError` the caller regex-matches.
- **`UnknownRefError`** — the ref does not resolve. Distinct because "diff against a base branch that does not exist locally" is an actionable, user-facing condition, not mechanics.

As-built (2026-07-14, PR review): every caller-supplied ref/range is validated before any spawn — a leading-dash value fails typed as `GitCommandError` rather than reaching git's argv parser, where it would read as a flag (`checkout -b` being the dangerous case; a blanket `--` is not a safe alternative because it switches `checkout` into pathspec mode). The pure `GitCommand` constructors deliberately do not validate; the service is the fallible boundary.

And one **non-error**: a path absent at a valid ref is `Option.none` from `show` (and simply missing from `lsTree` output). The v3 point-in-time reader's correctness leaned on this — absent paths degrade, never raise — and the snapshot diffing built on top inherits it from the type rather than from prose.

The classification uses git's documented exit codes plus the locale-pinned stderr shapes, which is exactly why `LC_ALL=C` is pinned in `GitCommand`'s env: classification against localized stderr is a latent bug, and the pin makes the recognized shapes stable.

**As-built — classification happens exactly once, in a private `classify` function gated by a `ClassifyKind`** (`"show" | "refExists" | "generic"`) that selects which method-specific rows apply on top of the shared taxonomy. `PlatformError` and `Cause.TimeoutError` (via `Effect.timeoutOrElse` at the `GIT_TIMEOUT = 30s` ceiling) are absorbed into the same `Classified` union inside `runClassified`, so a `Git` method's error channel only ever sees `GitCommandError | NotARepositoryError | UnknownRefError` — never core's raw plumbing.

## Module layout

```text
packages/git/
  src/
    GitCommand.ts   # the pure invocation constructors
    Git.ts          # Git service + layer, the error taxonomy, output parsers
    internal/
      run.ts        # collected-run + available helpers over ChildProcessSpawner
    index.ts        # public surface, re-exports only
  __test__/
    Git.test.ts             # semantics over a mocked ChildProcessSpawner
    integration/Git.int.test.ts  # against a real fixture repository
```

The collected-run and `available` helpers are **internal** (`src/internal/run.ts`) — they exist for `Git`'s own operations, not as public API; a helper earns export only when a second package asks for it (the evidence rule). Output parsing (`lsTree` entries, SHA validation) lives with the service in `Git.ts` unless it grows enough to earn its own `internal/` module — small enough that a single concept module is the honest shape, per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept).

## Observability

Named spans on the public fallible boundaries — each `Git` method — annotated with stable identifiers (`cwd`, `ref`), never file contents. No logging, no metrics; telemetry-agnostic per the [observability standard](../effect-standards.md#observability-standards).

**As-built: `savvy.build.ts` carries the narrow `_base` suppression** (`{ messageId: "ae-forgotten-export", pattern: "_base" }`), landed at G4 and reverified at G6 — `dist/prod/issues.json` is `errors: 0, warnings: 0, suppressed: 5` (`GitCommandError_base`, `NotARepositoryError_base`, `UnknownRefError_base`, `LsTreeEntry_base`, `Git_base`). Gate: a cold `pnpm build --filter @effected/git`, never the raw script. Also verified against the installed `effect@4.0.0-beta.97`: `Effect.fork` is `Effect.forkChild` at this beta — a naming drift from the earlier-verified `effect-v4-idioms` skill content, applied in the die-passthrough test in `__test__/Git.test.ts`.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in `__test__/`.

- **Unit: `Git` over a mocked `ChildProcessSpawner`** (`Layer.succeed`, or a scripted `ChildProcessSpawner.make(spawn)`), pinning the classification boundary — the highest-value tests in the package:
  - `show` on a path absent at a valid ref yields `Option.none`, not an error;
  - a not-a-repository failure yields `NotARepositoryError`, not `GitCommandError`;
  - an unresolvable ref yields `UnknownRefError`;
  - an unrecognized failure falls through to `GitCommandError` with `exitCode`/`stderr` intact.
- **Unit: `GitCommand` constructors** — exact argv and env assertions, no spawning.
- **Integration: a fixture repository** built in test setup (`git init`, commits, refs, a file deleted between two commits), driven through `@effect/platform-node`'s real `ChildProcessSpawner` layer (a devDependency, the workspaces `self.int.test.ts` precedent): `show` at two refs, `lsTree` filtered by a compiled glob set, `mergeBase` on a branched history, `changedFiles` across a known range, `refExists` both ways, and `checkout` — isolated in its own temp-dir fixture, since it mutates.
- Consumers mock at whichever seam fits: `Layer.succeed(Git, …)` for domain tests (workspaces' change-detection tests keep needing no repository), or a mocked `ChildProcessSpawner` to exercise git's own classification.

**As-built: 44 tests** — 8 `GitCommand` (pure constructor argv/env + the `setCwd` non-mutation guarantee), 6 `internal/run` (including defect passthrough through `available`), 18 `Git` (the full classification matrix over a mocked spawner), 12 integration (`__test__/integration/Git.int.test.ts`, real git via `@effect/platform-node`, including a real nonexistent-ref case). The integration suite's lifecycle is **plain `beforeAll`/`afterAll` + `Effect.runPromise`** — the first of its kind among this repo's `@effect/vitest` suites. Triage is done: this is SANCTIONED as a second integration-suite pattern for shared, expensive real-world fixtures, alongside (not replacing) `app`'s `Effect.ensuring` per-test pattern, which remains the default for cheap per-test fixtures. The concurrency option on `internal/run.ts`'s `runCollected` (`{ concurrency: "unbounded" }` over `[stdout, stderr, exitCode]`) is proven by a dedicated **dual-stream backpressure** integration test that pressures both stdout and stderr simultaneously — no mock spawner over in-memory streams can regress this, since it needs a real OS pipe to deadlock; do not delete that test.

## Consumers

- **`@effected/workspaces`** — `ChangeDetector` re-targets `Git.changedFiles`; the new `WorkspaceSnapshots` service reads refs through `show`/`lsTree`/`refExists` ([workspaces.md](workspaces.md)). The `GitReader` contract, its `layerNode` and `GitCommandError` leave workspaces in the same commit this package lands.
- **savvy-web/systems `DepsRegen`** — replaces its hand-rolled synchronous `execFileSync` helpers (`gitMergeBase`, `gitListChangesetFilesAtRef`) with `mergeBase` and `lsTree`, gaining typed errors and testability without a real repository.
