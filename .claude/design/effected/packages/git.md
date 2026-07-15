---
status: current
module: effected
category: architecture
created: 2026-07-14
updated: 2026-07-15
last-synced: 2026-07-15
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - workspaces.md
  - glob.md
---

# @effected/git design

## Overview

`@effected/git` is typed git introspection for the kit: read a repository's state — file contents at a ref, tree listings, merge bases, changed paths — without checking anything out, plus exactly one mutating operation, `checkout`. It programs against **core's** subprocess contract (`ChildProcessSpawner` and `ChildProcess.Command` values from `effect/unstable/process`), requiring the spawner in its `R` channel exactly as the kit's boundary packages require core `FileSystem`: the consumer's platform layer (`@effect/platform-node`'s `NodeServices.layer` provides `ChildProcessSpawner`) discharges it once at the edge.

Scope is closed by its two consumers — `@effected/workspaces` and savvy-web/systems' dependency-regeneration engine — not by git's porcelain. There is no ambition toward a general git client; an operation earns a method here when a consumer needs it typed. The read-only surface plus `checkout` is what those consumers need; further mutations (stash, worktree add/remove, commit) are deliberately excluded until a consumer needs one.

## Why it owns git interpretation

Interpreting git — the exit-code and stderr taxonomy, the absent-vs-error distinction, tree-entry parsing — is a concern that should exist **once**, typed, in a package named for it. Both consumers would otherwise interpret git output and exit codes themselves: workspaces' snapshot reader needs "file at ref, or none", and systems' dependency-regeneration engine would hand-roll `git merge-base` and `git ls-tree` through `execFileSync`. Those responsibilities live here instead, behind a small typed surface. `@effected/workspaces`' `ChangeDetector` and `WorkspaceSnapshots` service stand on this package.

## Tier and dependencies

**Boundary tier**, per the [dependency policy](../effect-standards.md#dependency-policy). `effect` is the only peer; there are **no `@effected` edges, no external runtime dependencies and no `node:` built-ins anywhere** — spawning is entirely behind core's `ChildProcessSpawner` contract, required in `R`. Requiring a core-declared service in `R` costs the consumer nothing ([R3](../effect-standards.md#dependency-policy)): the IO is discharged by the platform layer provided once at the edge, the identical argument that keeps walker, xdg and config-file at boundary tier over core `FileSystem`. `@effect/platform-node` appears only in `devDependencies`, for the integration suite — devDependencies never count toward tier.

## Public surface

See `src/GitCommand.ts` and `src/Git.ts` for the full surface; the index re-exports only.

### `GitCommand` — pure, inspectable invocations

Git-flavored constructors producing **core `ChildProcess.StandardCommand` values**. They know the `git` executable, each operation's argument conventions, and the environment git needs pinned (`LC_ALL=C` via the command's `env` + `extendEnv: true`, so stderr classification is locale-stable without replacing the inherited environment). Every constructor returns a cwd-less value: a test can assert the exact `command`/`args`/`options` an operation runs without spawning, and `Git` applies the working directory per call via `ChildProcess.setCwd`.

Two invariants ride on the argv:

- **The `-z` rule.** `lsTree`, `changedFiles` and the three working-tree constructors always emit NUL-terminated output and split on `"\0"`, never `"\n"` — git paths may themselves contain newlines, so a newline-split parse would silently corrupt them.
- **Explicit relative flag.** `changedFiles` and the working-tree diff constructors pass `--relative` when `relative` is true and `--no-relative` when false — never omitted, because git honors a configured `diff.relative=true` on an omitted flag and would silently produce cwd-relative paths for `relative: false`. `untrackedFiles` inverts the flag: `relative: false` adds `--full-name` so its `ls-files` output shares the un-`--relative` diffs' repo-root base. That alignment is why `workingChanges` can union its three path sources without mixing coordinate systems.

### `Git` — the service

A `Context.Service` whose layer resolves `ChildProcessSpawner` once at construction, so every method's `R` is `never`. Every method takes `cwd` explicitly — the caller who knows where "here" is passes it in. The per-operation ceiling is git's own policy (30 seconds via `Effect.timeoutOrElse`, owned here, not a spawner option). Small internal helpers over the spawner (a collected-run and an `available` probe) live in `internal/run.ts`, not on the public surface.

| Method | git plumbing | Returns | Notes |
| --- | --- | --- | --- |
| `show(cwd, ref, path)` | `git show ref:path` | `Option<string>` | **Absent-at-ref degrades to `Option.none`, never an error** — the invariant `WorkspaceSnapshots.at` depends on |
| `lsTree(cwd, ref)` | `git ls-tree -r -z` | `LsTreeEntry[]` (mode/type/oid/path) | The input a compiled [`@effected/glob`](glob.md) set filters |
| `refExists(cwd, ref)` | `git cat-file -e` | `boolean` | A ref that does not resolve is the negative answer, never an error |
| `mergeBase(cwd, a, b)` | `git merge-base` | SHA | Replaces systems' hand-rolled `execFileSync` call |
| `changedFiles(cwd, { base, head, relative? })` | `git diff --name-only -z` | paths | The committed-range diff `ChangeDetector` runs on; `relative` gives cwd-relative output scoped to the subtree |
| `workingChanges(cwd, { relative? })` | unstaged + staged + untracked | paths | The deduplicated union of working-tree changes — the `includeUncommitted` source `ChangeDetector` needs; takes no ref |
| `revParse(cwd, ref)` | `git rev-parse --verify` | SHA | Ref normalization for snapshot cache keys |
| `checkout(cwd, ref)` | `git checkout` | — | **The one mutating operation**; not safe to run concurrently against the same `cwd`, and nothing here serializes that |

## Errors: classification happens once

The design rule: **no consumer of this package ever string-matches stderr.** Git's failure modes are classified in a single private `classify` step in `Git.ts` — nowhere else in the package inspects `stderr` or `exitCode`. The taxonomy is three typed errors:

- **`GitCommandError`** — git ran and failed in a way that is not a recognized domain case, **or** the spawn itself failed. The spawner's `PlatformError` and a per-run timeout are absorbed here rather than leaked raw, so consumers of `Git` see git's taxonomy, not core's plumbing. Carries `args`, `cwd`, `exitCode` and `stderr` when git ran; a `detail` string carries the absorbed spawn failure or timeout when it did not (the non-`NotFound` arms keep the underlying `PlatformError` reason and message so `PermissionDenied` / `TimedOut` diagnostics survive absorption).
- **`NotARepositoryError`** — the cwd is not inside a git work tree. Every consumer branches on this, so it is a distinct tag rather than a `GitCommandError` the caller regex-matches.
- **`UnknownRefError`** — the ref does not resolve. Actionable and user-facing ("diff against a base branch that does not exist locally"), so it is distinct from mechanics. The two-ref methods (`mergeBase`, `changedFiles`) report `ref` as the `"a...b"` range label; the single-ref methods report the plain ref value.

`classify` is gated by a `ClassifyKind` (`"show" | "refExists" | "generic"`) selecting which method-specific rows apply on top of the shared taxonomy — the absent-at-ref degrade for `show`, the exit-1-is-false degrade for `refExists`. Both `PlatformError` and `Cause.TimeoutError` are absorbed inside `runClassified`, so a `Git` method's error channel only ever sees the three typed errors — never core's raw plumbing.

Two invariants sit alongside the taxonomy:

- **Non-error: a path absent at a valid ref is `Option.none`** from `show` (and simply missing from `lsTree` output). The snapshot diffing built on top inherits this from the type rather than from prose.
- **Option-injection guard.** Every caller-supplied ref/range is validated before any spawn: a leading-dash value fails typed as `GitCommandError` rather than reaching git's argv parser, where it would read as a flag (`checkout -b` being the dangerous case; a blanket `--` is not a safe alternative because it switches `checkout` into pathspec mode). The pure `GitCommand` constructors deliberately do not validate; the service is the fallible boundary.

The stderr matching is **unanchored substring matching** against `LC_ALL=C`-pinned phrases — a path or ref name that literally contains one of these phrases could misclassify. This is an accepted, recorded tradeoff (see the comment above `UNKNOWN_REF_PATTERNS` in `Git.ts`); anchoring is deferred until a real collision is observed.

## Module layout

Three source modules, per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept):

- `GitCommand.ts` — the pure invocation constructors.
- `Git.ts` — the `Git` service and layer, the error taxonomy, the `classify`/`runClassified` pair and the output parsers.
- `internal/run.ts` — the collected-run and `available` helpers over `ChildProcessSpawner`, not exported (a helper earns export only when a second package asks for it).

## Observability

Named spans on each `Git` method, annotated with stable identifiers (`cwd`, `ref`), never file contents. No logging, no metrics — telemetry-agnostic per the [observability standard](../effect-standards.md#observability-standards).

`savvy.build.ts` carries a narrow `_base` suppression (`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the synthesized schema bases; never widen it. Gate on a cold `pnpm build --filter @effected/git`, never the raw script.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in `__test__/`.

- **Unit: `Git` over a mocked `ChildProcessSpawner`** pins the classification boundary — the highest-value tests in the package (absent-at-ref yields `Option.none`; not-a-repository yields `NotARepositoryError`; an unresolvable ref yields `UnknownRefError`; the option-injection guard rejects pre-spawn; an unrecognized failure falls through to `GitCommandError` with `exitCode`/`stderr` intact).
- **Unit: `GitCommand` constructors** — exact argv and env assertions, no spawning.
- **Integration: a fixture repository** driven through `@effect/platform-node`'s real `ChildProcessSpawner` layer, with `checkout` isolated in its own temp-dir fixture since it mutates.

Two testing decisions are load-bearing:

- **Do not delete the dual-stream backpressure integration test.** It is the only thing that exercises `runCollected`'s `{ concurrency: "unbounded" }` collection — a mock spawner over in-memory streams cannot deadlock the way a real OS pipe can. It pressures both stdout and stderr simultaneously; a single-stream case would not discriminate sequential from concurrent collection.
- **The integration suite uses plain `beforeAll`/`afterAll` + `Effect.runPromise`.** This is a sanctioned second integration-suite pattern for shared, expensive real-world fixtures, alongside (not replacing) `app`'s `Effect.ensuring` per-test pattern, which remains the default for cheap per-test fixtures.

## Consumers

- **`@effected/workspaces`** — `ChangeDetector` runs on `Git` (the committed range via `changedFiles(relative: true)`, `includeUncommitted` via `workingChanges(relative: true)`); the `WorkspaceSnapshots` service reads refs through `show`/`lsTree` ([workspaces.md](workspaces.md)). A non-repository surfaces as this package's typed `NotARepositoryError`.
- **savvy-web/systems dependency-regeneration engine** — replaces its hand-rolled synchronous `execFileSync` helpers with `mergeBase` and `lsTree`, gaining typed errors and testability without a real repository.
