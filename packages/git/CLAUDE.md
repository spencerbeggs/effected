# @effected/git

Typed git introspection over core's `ChildProcessSpawner`: read a repository's
state at any ref without checking it out, plus `checkout`, the one mutating
operation. The nineteenth library package, created inside the monorepo for the
point-in-time port rather than migrated from a v3 source repo; it absorbs the
git half of workspaces' `GitReader`, which dissolves in the workspaces piece.

**Design doc:** `@../../.claude/design/effected/packages/git.md`

## Tier: boundary

`effect` is the only peer; there are **zero runtime dependencies and zero
`node:` imports anywhere in `src/`**. IO goes through core's
`ChildProcessSpawner`, arriving via the `R` channel — the same R3 shape as
`FileSystem`/`Path` in `@effected/xdg` and `@effected/walker`. `Git.layer`
resolves the spawner once at construction (`Layer.effect` reading
`ChildProcessSpawner.ChildProcessSpawner`), so every `Git` method's `R` is
`never`. Consumers that only need the typed surface pay nothing for the
spawn machinery beyond providing a `ChildProcessSpawner` layer once, at the
edge.

`@effect/platform-node` is a **devDependency used only by integration
tests** (`__test__/integration/Git.int.test.ts`) — the `@effected/workspaces`
`self.int.test.ts` precedent. It must never appear in `dependencies` or
`peerDependencies`; a consumer of this package chooses its own platform
backend.

## Three source modules

- `GitCommand.ts` — seven pure constructors (`show`, `lsTree`, `refExists`,
  `mergeBase`, `changedFiles`, `revParse`, `checkout`) returning core
  `ChildProcess.StandardCommand` values. Every one is cwd-less: the private
  `git` helper pins `{ env: { LC_ALL: "C" }, extendEnv: true }` and nothing
  else. `Git` applies `cwd` per call via `ChildProcess.setCwd`, which is dual
  and returns a **new** command, leaving the pure constructor's value
  untouched.
- `internal/run.ts` — `runCollected` (scoped `spawner.spawn` + `Effect.all`
  over `[stdout, stderr, exitCode]` with `{ concurrency: "unbounded" }`) and
  `available`. **Not exported** from the package; `Git.ts` is the only
  consumer.
- `Git.ts` — the `Context.Service` (tag id `"@effected/git/Git"`), the error
  taxonomy (`GitCommandError`, `NotARepositoryError`, `UnknownRefError`), and
  the private `classify`/`runClassified` pair where git's stderr/exit-code
  taxonomy is read exactly once.

## LC_ALL=C + extendEnv: true

Pinned on every `GitCommand`, unconditionally. git's classification depends
on stable, untranslated stderr text (`"not a git repository"`, `"unknown
revision"`, etc.) — a localized message would silently misclassify into
`GitCommandError` instead of the typed domain error. `extendEnv: true` is
required alongside it: `extendEnv`'s default is owned by whichever platform
backend implements `ChildProcessSpawner`, not by core, so a command that
still needs `PATH` and the rest of the parent environment must request the
merge explicitly rather than rely on an implementation-specific default.

## Classification happens once

Every `Git` method funnels its run through the private `classify` step in
`Git.ts` — nowhere else in the package inspects `stderr` or `exitCode`.
`classify` takes a `ClassifyKind` (`"show" | "refExists" | "generic"`) that
gates which method-specific rows apply on top of the shared taxonomy:

| stderr / exit shape | kind gate | classification | surfaces as |
| --- | --- | --- | --- |
| `exitCode === 0` | any | `success` | the method's success value |
| contains `"not a git repository"` | any | `notARepository` | `NotARepositoryError` |
| contains an unknown-revision phrase | any | `unknownRef` | `UnknownRefError` — except `refExists`, which degrades to `false` |
| contains an absent-at-ref phrase | `"show"` only | `absent` | `Option.none()` |
| `exitCode === 1` | `"refExists"` only | `refMissing` | `false` |
| spawn-level `PlatformError` | any | `failure` | `GitCommandError` with `detail` set, no `exitCode` |
| per-run timeout (30s) | any | `failure` | `GitCommandError` with `detail: "timed out after 30s"`, no `exitCode` |
| anything else non-zero | any | `failure` | `GitCommandError` with `exitCode` + `stderr` |

`PlatformError` and `Cause.TimeoutError` are **absorbed inside
`runClassified`** — via `Effect.catch` and `Effect.timeoutOrElse` — and never
escape a `Git` method. The `GIT_TIMEOUT` ceiling (`Duration.seconds(30)`) is
owned by this package, not by the caller.

The stderr matching is **unanchored substring matching** against
`LC_ALL=C`-pinned phrases (see the comment above `UNKNOWN_REF_PATTERNS` in
`Git.ts`) — a path or ref name that happened to literally contain one of
these phrases could misclassify. Accepted as a deliberate deviation for now;
anchoring is deferred until a real collision is observed. Do not "fix" this
without discussion — it is a recorded, accepted tradeoff, not an oversight.

`refExists` answering `false` for both an unrecognized-ref-syntax error
(`unknownRef`) and a syntactically valid but missing ref (`refMissing`) was a
review-caught Critical fix (`bd5e0101`): the method's contract is "does this
resolve", and dying on an unknown ref broke that promise.

`mergeBase` and `changedFiles` — the two-ref methods — report `UnknownRefError`
with `ref` set to the `"a...b"` range label, not either individual ref. This
is a deliberate deviation from the single-ref methods' plain `ref` value,
recorded here rather than re-derived by a future reader.

## The `-z` rule

`lsTree` and `changedFiles` **always** use `-z` (NUL-terminated output) and
split on `"\0"` via the shared `parseNulSeparated` helper — never on `"\n"`.
git paths may themselves contain newlines; a newline-split parse would
silently corrupt any path containing one. Both `GitCommand.lsTree` and
`GitCommand.changedFiles` bake `-z` into the argv unconditionally — there is
no non-`-z` code path to regress into.

## checkout is the one mutation

Every other method reads repository state at an arbitrary `ref` without
touching the working tree. `checkout` is the sole exception — it moves the
working tree (and, for a branch ref, `HEAD`). Treat it accordingly in any
caller: it is not safe to run concurrently with other work against the same
`cwd`, and nothing in this package serializes that for you.

## Testing and building

44 tests in `__test__/`: 8 `GitCommand` (pure constructor shape + the
`setCwd` non-mutation guarantee), 6 `internal/run` (including defect
passthrough through `available`), 18 `Git` (the full classification matrix,
mocked spawner), 12 integration (`__test__/integration/Git.int.test.ts`,
real git + `@effect/platform-node`, including a real nonexistent-ref case and
the dual-stream backpressure test below). `@effect/vitest`, `assert.*` —
never `expect`.

```bash
pnpm vitest run packages/git
pnpm build --filter @effected/git   # from the repo root
```

- **Do not delete the dual-stream backpressure integration test.** It is the
  only thing that actually exercises `runCollected`'s
  `{ concurrency: "unbounded" }` collection — a mock spawner over in-memory
  streams cannot deadlock the way a real OS pipe can, so this is the sole
  regression guard for that concurrency option. It puts pressure on *both*
  stdout and stderr simultaneously; a large-output-on-one-stream case would
  not discriminate sequential collection from concurrent collection.
- The integration suite's lifecycle is plain `beforeAll`/`afterAll` +
  `Effect.runPromise` — the first of its kind in this repo's `@effect/vitest`
  suites. Triage is done: this is SANCTIONED as a second integration-suite
  pattern for shared, expensive real-world fixtures; `app`'s `Effect.ensuring`
  per-test pattern remains the default for cheap per-test fixtures.
- Mock the spawner with
  `Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(mockSpawn))`
  and `ChildProcessSpawner.makeHandle({...})` over in-memory streams for unit
  tests; only the integration suite spawns real git.
- `savvy.build.ts` carries the **narrow** `_base` suppression (`{ messageId:
  "ae-forgotten-export", pattern: "_base" }`) for the five synthesized bases
  (`GitCommandError`, `NotARepositoryError`, `UnknownRefError`, `LsTreeEntry`,
  `Git`). Never widen it.
- Never run `node savvy.build.ts --target prod` directly.
