---
status: current
module: effected
category: architecture
created: 2026-07-14
updated: 2026-07-16
last-synced: 2026-07-16
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

`@effected/git` is typed git for the kit, one service in two tiers: a **read tier** that reads a repository's state — file contents at a ref, tree listings, merge bases, changed paths, branch/config/remote/commit introspection, porcelain status — without touching the working tree, and a **clearly-marked mutating tier** (checkout, fetch, the submodule and sparse-checkout operations, config writes, staging) that changes it. It programs against **core's** subprocess contract (`ChildProcessSpawner` and `ChildProcess.Command` values from `effect/unstable/process`), requiring the spawner in its `R` channel exactly as the kit's boundary packages require core `FileSystem`: the consumer's platform layer (`@effect/platform-node`'s `NodeServices.layer` provides `ChildProcessSpawner`) discharges it once at the edge.

Scope is closed by its consumers — `@effected/workspaces` and savvy-web/systems' tooling (the DepsRegen engine plus the `@savvy-web/cli` / `@savvy-web/mcp` / `silk-effects` adoption wave, whose gap analysis is [issue #82](https://github.com/spencerbeggs/effected/issues/82)) — not by git's porcelain. There is no ambition toward a general git client; an operation earns a method here when a consumer needs it typed. Issue #82's open design question — where do mutating operations live? — was resolved as **grow `Git` itself**: one service, two tiers, rather than a second service or package. The tier marker is documentary and absolute: every mutating method's TSDoc opens with the literal word `"Mutating:"`, and that is the only signal — nothing in this package serializes concurrent access, so a caller running a mutating call alongside anything else against the same `cwd` owns the race, per cwd.

## Why it owns git interpretation

Interpreting git — the exit-code and stderr taxonomy, the absent-vs-error distinction, tree-entry parsing — is a concern that should exist **once**, typed, in a package named for it. The consumers would otherwise interpret git output and exit codes themselves: workspaces' snapshot reader needs "file at ref, or none", and systems' tooling hand-rolls `git` through `execFileSync`/platform `Command` across its cli, mcp and silk-effects packages. Those responsibilities live here instead, behind a small typed surface. `@effected/workspaces`' `ChangeDetector` and `WorkspaceSnapshots` service stand on this package.

## Tier and dependencies

**Boundary tier**, per the [dependency policy](../effect-standards.md#dependency-policy). `effect` is the only peer; there are **no `@effected` edges, no external runtime dependencies and no `node:` built-ins anywhere** — spawning is entirely behind core's `ChildProcessSpawner` contract, required in `R`. Requiring a core-declared service in `R` costs the consumer nothing ([R3](../effect-standards.md#dependency-policy)): the IO is discharged by the platform layer provided once at the edge, the identical argument that keeps walker, xdg and config-file at boundary tier over core `FileSystem`. `@effect/platform-node` appears only in `devDependencies`, for the integration suites — devDependencies never count toward tier.

## Public surface

See `src/GitCommand.ts` and `src/Git.ts` for the full surface; the index re-exports only.

### `GitCommand` — pure, inspectable invocations

Git-flavored constructors producing **core `ChildProcess.StandardCommand` values**, covering both tiers. They know the `git` executable, each operation's argument conventions, and the environment git needs pinned (`LC_ALL=C` via the command's `env` + `extendEnv: true`, so stderr classification is locale-stable without replacing the inherited environment). Every constructor returns a cwd-less value: a test can assert the exact `command`/`args`/`options` an operation runs without spawning, and `Git` applies the working directory per call via `ChildProcess.setCwd`.

Two invariants ride on the argv:

- **The `-z` rule.** Every path-emitting constructor — `lsTree`, `changedFiles`, `nameStatus`, `status` and the three working-tree constructors — always emits NUL-terminated output and splits on `"\0"`, never `"\n"` — git paths may themselves contain newlines, so a newline-split parse would silently corrupt them.
- **Explicit relative flag.** `changedFiles`, `nameStatus` and the working-tree diff constructors pass `--relative` when `relative` is true and `--no-relative` when false — never omitted, because git honors a configured `diff.relative=true` on an omitted flag and would silently produce cwd-relative paths for `relative: false`. `untrackedFiles` inverts the flag: `relative: false` adds `--full-name` so its `ls-files` output shares the un-`--relative` diffs' repo-root base. That alignment is why `workingChanges` can union its three path sources without mixing coordinate systems.

### `Git` — the service, read tier

A `Context.Service` whose layer resolves `ChildProcessSpawner` once at construction, so every method's `R` is `never`. Every method takes `cwd` explicitly — the caller who knows where "here" is passes it in. The per-operation ceiling is git's own policy (30 seconds via `Effect.timeoutOrElse`, owned here, not a spawner option). Small internal helpers over the spawner (a collected-run and an `available` probe) live in `internal/run.ts`, not on the public surface.

The founding read contracts are unchanged: `show(cwd, ref, path)` returns `Option<string>` — **absent-at-ref degrades to `Option.none`, never an error**, the invariant `WorkspaceSnapshots.at` depends on; `lsTree` (now with an optional pathspec) returns the `LsTreeEntry[]` a compiled [`@effected/glob`](glob.md) set filters; `refExists` answers a non-resolving ref as `false`, never an error; `mergeBase` and `changedFiles` are the committed-range primitives `ChangeDetector` runs on; `revParse` normalizes refs for snapshot cache keys.

Issue #82 grew the tier along four seams:

- **Working-tree primitives are public.** `unstagedChanges`, `stagedChanges` and `untrackedFiles` are service methods in their own right (systems' branch analyzer needs the untracked overlay alone); `workingChanges` remains and composes them as the deduplicated union, its options now optional.
- **`nameStatus`** is the semantically-typed diff: each `NameStatusEntry` carries a typed status vocabulary rather than name-only paths, renames/copies carry `oldPath`, and it takes both a `base...head` two-ref form and a single-arg working-tree-vs-ref form.
- **The absence family.** Four introspection probes degrade "not there" to `Option.none` rather than an error, extending `show`'s founding invariant: `defaultBranch` (unset remote HEAD; the `<remote>/` prefix is stripped from the answer), `currentBranch` (detached HEAD — git's literal `"HEAD"` answer maps to none, because a fake branch name would be worse than an honest absence), `configGet` (unset key) and `remoteUrl` (missing remote).
- **Commit and status models.** `commitInfo` parses into `CommitInfo` (sha, `%G?` signature-status literals, and the raw `%B` message — deliberately untrimmed, because this package does not decide what "the message" means for a caller that cares about trailing whitespace). `status` parses `git status --porcelain -z` into `StatusEntry` values.

One trap is load-bearing enough to record: **`NameStatusEntry` and `StatusEntry` order their rename token pair opposite each other** — `diff --name-status -z` emits old-path-then-new-path, `status --porcelain -z` emits new-path-then-original-path. The two parsers must never be conflated or refactored into one shared implementation; each is correct only for its own token order.

### `Git` — the service, mutating tier

The mutating methods are `checkout` (now with a `detach` option), `fetch` (remote/ref with optional depth and tag mode), `submoduleUpdate`, `submoduleAdd`, `sparseCheckoutSet` (`--cone`/`--no-cone` explicit in both branches, never defaulted to git's config), `configSet` and `add` (whose paths sit behind a literal `--`). They exist for systems' repos domain — the `savvy repos` CLI and `repos_manage` MCP tool managing vendored read-only submodules — and for checkout's original snapshot use. `fetch`, `submoduleUpdate` and `submoduleAdd` are the ref-fetching trio whose unknown-ref failures surface typed (see the classification below) so a tag-then-branch fetch fallback can branch on the error tag rather than on stderr.

## Errors: classification happens once

The design rule: **no consumer of this package ever string-matches stderr.** Git's failure modes are classified in a single private `classify` step in `Git.ts` — nowhere else in the package inspects `stderr` or `exitCode`. The taxonomy is three typed errors, unchanged by the surface growth:

- **`GitCommandError`** — git ran and failed in a way that is not a recognized domain case, **or** the spawn itself failed. The spawner's `PlatformError` and a per-run timeout are absorbed here rather than leaked raw, so consumers of `Git` see git's taxonomy, not core's plumbing. Carries `args`, `cwd`, `exitCode` and `stderr` when git ran; a `detail` string carries the absorbed spawn failure or timeout when it did not (the non-`NotFound` arms keep the underlying `PlatformError` reason and message so `PermissionDenied` / `TimedOut` diagnostics survive absorption).
- **`NotARepositoryError`** — the cwd is not inside a git work tree. Every consumer branches on this, so it is a distinct tag rather than a `GitCommandError` the caller regex-matches.
- **`UnknownRefError`** — the ref does not resolve. Actionable and user-facing ("diff against a base branch that does not exist locally"), so it is distinct from mechanics. The two-ref methods (`mergeBase`, `changedFiles`) report `ref` as the `"a...b"` range label; the single-ref methods report the plain ref value. `UNKNOWN_REF_PATTERNS` includes `"couldn't find remote ref"` so the ref-fetching trio's failures land here typed — the signal an `Effect.orElse` tag-then-branch fetch fallback branches on.

`classify` is gated by a `ClassifyKind` (`"show" | "refExists" | "quiet" | "noSuchRemote" | "generic"`) selecting which method-specific rows apply on top of the shared taxonomy: the absent-at-ref degrade for `show`; the exit-1-is-false degrade for `refExists`; `"quiet"` (a silent exit 1 — empty stderr — means "unset" and degrades to `Option.none`, while exit 1 **with** stderr stays a real failure) backing `defaultBranch` and `configGet`; and `"noSuchRemote"` (git's `"No such remote"` stderr degrades to `Option.none`) backing `remoteUrl`. Both `PlatformError` and `Cause.TimeoutError` are absorbed inside `runClassified`, so a `Git` method's error channel only ever sees the three typed errors — never core's raw plumbing.

Two invariants sit alongside the taxonomy:

- **Non-error: a path absent at a valid ref is `Option.none`** from `show` (and simply missing from `lsTree` output), and the introspection absence family above inherits the same shape. The snapshot diffing built on top inherits this from the type rather than from prose.
- **Option-injection guard.** Every caller-supplied positional that is not protected by a literal `--` in the argv — refs, ranges, remotes, config keys, submodule urls and paths — is validated before any spawn: a leading-dash value fails typed as `GitCommandError` rather than reaching git's argv parser, where it would read as a flag (`checkout -b` being the dangerous case; a blanket `--` is not a safe alternative because it switches `checkout` into pathspec mode, which is also why `add` — a genuine pathspec operation — is the one constructor that does use a literal `--`). `configSet` has no documented `--` separator, so it guards all three of its string inputs — `key`, `value` **and** `options.file` — with the recorded limitation that a legitimate config value beginning with `-` is refused typed rather than risked. The pure `GitCommand` constructors deliberately do not validate; the service is the fallible boundary.

The stderr matching is **unanchored substring matching** against `LC_ALL=C`-pinned phrases — a path or ref name that literally contains one of these phrases could misclassify. This is an accepted, recorded tradeoff (see the comment above `UNKNOWN_REF_PATTERNS` in `Git.ts`); anchoring is deferred until a real collision is observed.

## Module layout

Three source modules, per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept):

- `GitCommand.ts` — the pure invocation constructors, both tiers.
- `Git.ts` — the `Git` service and layer, the error taxonomy, the `classify`/`runClassified` pair, the parsed-result models (`LsTreeEntry`, `NameStatusEntry`, `CommitInfo`, `StatusEntry`) and the output parsers.
- `internal/run.ts` — the collected-run and `available` helpers over `ChildProcessSpawner`, not exported (a helper earns export only when a second package asks for it).

## Observability

Named spans on each `Git` method, annotated with stable identifiers (`cwd`, `ref`), never file contents. No logging, no metrics — telemetry-agnostic per the [observability standard](../effect-standards.md#observability-standards).

`savvy.build.ts` carries a narrow `_base` suppression (`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the synthesized schema bases; never widen it. Gate on a cold `pnpm build --filter @effected/git`, never the raw script.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in `__test__/`.

- **Unit: `Git` over a mocked `ChildProcessSpawner`** pins the classification boundary — the highest-value tests in the package (the full matrix across all five `ClassifyKind`s, the absence-family degrades, the option-injection guard rejecting pre-spawn, the `NameStatusEntry`/`CommitInfo`/`StatusEntry` parsers with their opposed rename token orders, and unrecognized failures falling through to `GitCommandError` with `exitCode`/`stderr` intact).
- **Unit: `GitCommand` constructors** — exact argv and env assertions, no spawning.
- **Integration: fixture repositories** driven through `@effect/platform-node`'s real `ChildProcessSpawner` layer, with the mutating tier isolated in its own temp-dir fixtures since it mutates.

Three testing decisions are load-bearing:

- **Do not delete the dual-stream backpressure integration test.** It is the only thing that exercises `runCollected`'s `{ concurrency: "unbounded" }` collection — a mock spawner over in-memory streams cannot deadlock the way a real OS pipe can. It pressures both stdout and stderr simultaneously; a single-stream case would not discriminate sequential from concurrent collection.
- **The integration suites use plain `beforeAll`/`afterAll` + `Effect.runPromise`.** This is a sanctioned second integration-suite pattern for shared, expensive real-world fixtures, alongside (not replacing) `app`'s `Effect.ensuring` per-test pattern, which remains the default for cheap per-test fixtures.
- **File-protocol submodules are a caller-environment decision.** git ≥ 2.38 (CVE-2022-39253) blocks `file://` submodule remotes by default, and a repo-local `protocol.file.allow` on the superproject does **not** reach `git submodule add`'s internal clone subprocess (verified against git 2.54) — only a command-line `-c`, the environment or global config do. Nothing this package spawns enables the protocol; the submodule integration suite sets `GIT_ALLOW_PROTOCOL=file` at module scope, contained by the `forks` pool's per-file process isolation.

## Consumers

- **`@effected/workspaces`** — `ChangeDetector` runs on `Git` (the committed range via `changedFiles(relative: true)`, `includeUncommitted` via `workingChanges(relative: true)`); the `WorkspaceSnapshots` service reads refs through `show`/`lsTree` ([workspaces.md](workspaces.md)). A non-repository surfaces as this package's typed `NotARepositoryError`.
- **savvy-web/systems** — the DepsRegen engine replaces its hand-rolled synchronous `execFileSync` helpers with `mergeBase` and `lsTree`; the `@savvy-web/cli` / `@savvy-web/mcp` / `silk-effects` adoption wave consumes the introspection tier (name-status diffs, branch/config/remote/commit probes, porcelain status) per [issue #82](https://github.com/spencerbeggs/effected/issues/82)'s gap analysis; and the repos domain (`savvy repos` CLI, `repos_manage` MCP tool) managing vendored read-only submodules is the mutating tier's consumer (fetch, submodule and sparse-checkout operations).
