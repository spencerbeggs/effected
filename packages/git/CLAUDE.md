# @effected/git

Typed git introspection over core's `ChildProcessSpawner`: a read tier that
reads a repository's state at any ref without checking it out, plus a
clearly-marked mutating tier (`checkout`, `fetch`, `fetchAny`,
`submoduleUpdate`, `submoduleAdd`, `sparseCheckoutSet`, `configSet`, `add`)
that changes it. The
nineteenth library package, created inside the monorepo for the point-in-time
port rather than migrated from a v3 source repo; it absorbed the git half of
workspaces' `GitReader`, which is now gone — `@effected/workspaces` runs
`ChangeDetector` and `WorkspaceSnapshots` on this package's `Git`.

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

- `GitCommand.ts` — 24 pure constructors returning core
  `ChildProcess.StandardCommand` values. Read tier: `show`, `lsTree`,
  `refExists`, `mergeBase`, `changedFiles`, `unstagedChanges`,
  `stagedChanges`, `untrackedFiles`, `revParse`, `nameStatus`,
  `defaultBranch`, `currentBranch`, `repoRoot`, `commitInfo`, `configGet`,
  `remoteUrl`, `status`. Mutating tier: `checkout`, `fetch`,
  `submoduleUpdate`, `submoduleAdd`, `sparseCheckoutSet`, `configSet`, `add`.
  (`Git.workingChanges` and `Git.fetchAny` are the 25th and 26th `Git`
  service methods, but each composes existing methods —
  `unstagedChanges` + `stagedChanges` + `untrackedFiles`, and tag-form
  `fetch` then plain `fetch` — rather than adding its own `GitCommand`
  constructor.) `changedFiles` and the three
  working-tree diff constructors take a `relative` flag whose diff flag is
  **explicit in both branches** — `true` passes `--relative`, `false` passes
  `--no-relative`. The `--no-relative` is load-bearing: git honors a configured
  `diff.relative=true` when no flag is passed, so an omitted flag would yield
  cwd-relative paths on such a machine even for `relative: false`, breaking the
  repo-root alignment `workingChanges` dedups on. `untrackedFiles` inverts the
  flag — `false` adds `--full-name` so its `ls-files` output shares the
  `--no-relative` diffs' repo-root base (see `workingChanges`). Every one is
  cwd-less: the private
  `git` helper pins `{ env: { LC_ALL: "C" }, extendEnv: true }` and nothing
  else. `Git` applies `cwd` per call via `ChildProcess.setCwd`, which is dual
  and returns a **new** command, leaving the pure constructor's value
  untouched.
- `internal/run.ts` — `runCollected` (scoped `spawner.spawn` + `Effect.all`
  over `[stdout, stderr, exitCode]` with `{ concurrency: "unbounded" }`) and
  `available`. **Not exported** from the package. `Git.ts` consumes
  `runCollected` only; `available` has no production consumer — its intended
  caller `GitReader` dissolved without needing it, and it is kept deliberately
  with its tests rather than deleted-and-reintroduced.
- `Git.ts` — the `Context.Service` (tag id `"@effected/git/Git"`) over the
  exported `GitShape` interface (the `WorkspaceDiscoveryShape` precedent —
  consumers type fakes/fields against it instead of re-declaring the
  surface), the error
  taxonomy (`GitCommandError`, `NotARepositoryError`, `UnknownRefError`), the
  parsed-result models (`LsTreeEntry`, `NameStatusEntry`, `CommitInfo`,
  `StatusEntry`), and the private `classify`/`runClassified` pair where git's
  stderr/exit-code taxonomy is read exactly once.

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
`classify` takes a `ClassifyKind`
(`"show" | "refExists" | "quiet" | "noSuchRemote" | "generic"`) that gates
which method-specific rows apply on top of the shared taxonomy:

| stderr / exit shape | kind gate | classification | surfaces as |
| --- | --- | --- | --- |
| `exitCode === 0` | any | `success` | the method's success value |
| contains `"not a git repository"` | any | `notARepository` | `NotARepositoryError` |
| contains an unknown-revision phrase, incl. `"couldn't find remote ref"` | any | `unknownRef` | `UnknownRefError` — except `refExists`, which degrades to `false` |
| contains an absent-at-ref phrase | `"show"` only | `absent` | `Option.none()` |
| `exitCode === 1` and `stderr === ""` | `"quiet"` only | `absent` | `Option.none()` |
| contains `"No such remote"` | `"noSuchRemote"` only | `absent` | `Option.none()` |
| `exitCode === 1` | `"refExists"` only | `refMissing` | `false` |
| spawn-level `PlatformError` | any | `failure` | `GitCommandError` with `detail` set, no `exitCode` |
| per-run timeout (30s) | any | `failure` | `GitCommandError` with `detail: "timed out after 30s"`, no `exitCode` |
| anything else non-zero | any | `failure` | `GitCommandError` with `exitCode` + `stderr` |

`"couldn't find remote ref"` was added to `UNKNOWN_REF_PATTERNS` for the
mutating tier's ref-fetching operations. It classifies as `UnknownRefError`
for every method that reaches `classify`, but in practice only `fetch`,
`submoduleUpdate` and `submoduleAdd` produce it — it is the typed signal a
tag-then-branch fetch fallback (`Effect.orElse`) branches on.

`"quiet"` backs `defaultBranch` and `configGet`: both run their git command
with `--quiet`/rely on a silent exit 1 to mean "unset", so any exit-1 WITH
stderr text is a real failure, not an absence. `"noSuchRemote"` backs
`remoteUrl`: `git remote get-url` prints `"No such remote '<name>'"` on a
missing remote, which degrades to `Option.none()` rather than
`GitCommandError`.

Two methods additionally degrade a *successful* run's output rather than its
exit code: `currentBranch` maps the literal answer `"HEAD"` (git's spelling of
"detached") to `Option.none()` — a fake branch name would be worse than an
honest absence — and `defaultBranch` strips the `<remote>/` prefix from
`git symbolic-ref`'s short output before returning it.

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

## The option-injection guard

Every ref/range argument (`show`/`lsTree`/`refExists`/`revParse`/`checkout`
refs, both sides of `mergeBase` and `changedFiles`) is validated BEFORE any
spawn: a value beginning with `-` fails typed as `GitCommandError` — git
would parse it as a flag, and `checkout("-b")` would create a branch. A
blanket `--` separator is deliberately NOT used (it flips `checkout` into
pathspec mode). `GitCommand`'s pure constructors do not validate; the `Git`
service is the guard's home. Pinned by the option-injection-guard test block,
including a never-spawn mock proving rejection happens pre-spawn.

## The `-z` rule

`lsTree`, `changedFiles` and the three working-tree constructors
(`unstagedChanges`/`stagedChanges`/`untrackedFiles`) **always** use `-z`
(NUL-terminated output) and split on `"\0"` via the shared `parseNulSeparated`
helper — never on `"\n"`. git paths may themselves contain newlines; a
newline-split parse would silently corrupt any path containing one. Every one
bakes `-z` into the argv unconditionally — there is no non-`-z` code path to
regress into.

## The three parsed models

`Git.ts` defines three `Schema.Class` models beyond `LsTreeEntry`, each
backing exactly one `-z`-terminated parser:

- `NameStatusEntry` — `nameStatus`'s `git diff --name-status -z` parser
  (`parseNameStatus`). A plain entry is two NUL tokens (`<code>`, `<path>`); a
  rename/copy entry is three: `<R|C><score>`, the OLD path, then the NEW path.
  `path` always holds the current (new, for a rename/copy) path; `oldPath` is
  set only on rename/copy entries.
- `StatusEntry` — `status`'s `git status --porcelain -z` parser
  (`parseStatus`). Each entry is `XY <path>`, and a rename/copy entry appends
  ONE extra NUL token: the ORIGINAL path, AFTER the new path.
- `CommitInfo` — `commitInfo`'s `git log -1 --format=%H%x00%G?%x00%B` parser
  (`parseCommitInfo`). `message` is the raw `%B` output, deliberately
  untrimmed — it includes git's trailing format newline. Trimming is left to
  the caller; this package does not decide what "the message" means for a
  consumer that cares about trailing whitespace.

**`NameStatusEntry` and `StatusEntry` order their rename token OPPOSITE each
other** — `diff --name-status -z` emits old-path-then-new-path, `status
--porcelain -z` emits new-path-then-old-path. The two parsers (`parseNameStatus`
and `parseStatus`) must never be conflated or refactored into one shared
implementation; each is correct only for its own token order.

## workingChanges is the deduplicated union

`Git.workingChanges(cwd, { relative? })` runs `unstagedChanges`,
`stagedChanges` and `untrackedFiles` and returns `[...new Set(...)]` of their
paths — the full working-tree delta against `HEAD`. It takes no ref, so
`UnknownRefError` cannot arise (the arm stays declared for switch
exhaustiveness). The `relative`/`--full-name` inversion on `untrackedFiles`
exists precisely so the `Set` dedups: from a nested `cwd` the diffs and
`ls-files` must share one path base, or one file appears under two spellings.
`ChangeDetector`'s `includeUncommitted` path consumes this with
`relative: true`.

## The mutating tier

Eighteen of `Git`'s twenty-six methods only read repository state at an
arbitrary `ref` without touching the working tree. Eight are mutating:
`checkout`, `fetch`, `fetchAny`, `submoduleUpdate`, `submoduleAdd`,
`sparseCheckoutSet`, `configSet`, `add`. The tier rule is simple and absolute: every mutating
method's TSDoc opens with the literal word `"Mutating:"`, and that is the
ONLY signal a caller gets — nothing in this package serializes concurrent
access. A caller running two mutating calls (or a mutating call alongside a
read) against the same `cwd` at once owns the race; `Git` does not queue,
lock, or detect it.

`configSet` carries a recorded limitation from this same option-injection
discipline: git config has no documented `--` separator, so `configSet`
guards all three of its string inputs — `key`, `value`, AND `options.file` —
through `rejectOptionLikeRefs`, not just the ref-shaped ones. The
consequence: a legitimate config value that happens to start with `-` (e.g.
`git config foo.bar -- -x`-style values git itself would accept) cannot be
written through this method. It is refused typed, before any spawn, rather
than risking git reading it as a flag.

`fetch`, `submoduleUpdate` and `submoduleAdd` are the tier's ref-fetching
trio; see the classification table above for `"couldn't find remote ref"`,
the typed `UnknownRefError` signal a tag-then-branch fetch fallback branches
on. `fetchAny` IS that fallback, shipped: it guards `remote`/`ref` once up
front, runs the tag-form `fetch` (`tag: true`), and on `UnknownRefError` OR
any `GitCommandError` (unclassified tag-form stderr shapes stay on the
fallback path) retries as a plain `fetch`. `NotARepositoryError` propagates
from the tag attempt — the plain form would fail identically. When both
attempts fail, the PLAIN fetch's error surfaces; the tag attempt's failure is
discarded.

## Testing and building

135 tests in `__test__/`: 30 `GitCommand` (pure constructor shape + the
`setCwd` non-mutation guarantee, covering all 24 constructors), 6
`internal/run` (including defect passthrough through `available`), 71 `Git`
(the full classification matrix across all five `ClassifyKind`s, the
option-injection guard block — every guarded positional has a no-spawn
rejection test — `workingChanges`' union/dedup, `fetchAny`'s
tag-then-plain fallback matrix — single-spawn success, both fallback
triggers, plain-error surfacing, `NotARepositoryError` short-circuit, and a
no-spawn guard rejection — and the parsers
for `NameStatusEntry`/`CommitInfo`/`StatusEntry`, mocked spawner), and 28
integration split across two files: 14 in
`__test__/integration/Git.int.test.ts` (the original surface —
show/lsTree/refExists/mergeBase/changedFiles/workingChanges/revParse/checkout
— plus the dual-stream backpressure test below) and 14 in
`__test__/integration/GitSurface.int.test.ts` (the Task 3–6 additions:
`nameStatus`, the promoted working-tree primitives, the quiet probes,
`commitInfo`/`status`, and the full mutating tier), both real git +
`@effect/platform-node`. `@effect/vitest`, `assert.*` — never `expect`.

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
- The integration suites' lifecycle is plain `beforeAll`/`afterAll` +
  `Effect.runPromise` — the first of its kind in this repo's `@effect/vitest`
  suites. Triage is done: this is SANCTIONED as a second integration-suite
  pattern for shared, expensive real-world fixtures; `app`'s `Effect.ensuring`
  per-test pattern remains the default for cheap per-test fixtures.
- **`GitSurface.int.test.ts` sets `process.env.GIT_ALLOW_PROTOCOL = "file"` at
  module scope.** git ≥ 2.38 (CVE-2022-39253) blocks a `file://` submodule
  remote by default; this is a CALLER-ENVIRONMENT decision, not something
  `Git`'s argv enables — nothing this package spawns sets it. A repo-local
  `git config protocol.file.allow always` on the superproject does NOT reach
  `git submodule add`'s internal clone subprocess (verified against the
  installed git 2.54); only a command-line `-c`, the environment, or global
  config do, which is why the module-scope env var is load-bearing. It is
  contained by the `forks` pool's per-file process isolation, so it cannot
  leak into other suites in the same run.
- Mock the spawner with
  `Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(mockSpawn))`
  and `ChildProcessSpawner.makeHandle({...})` over in-memory streams for unit
  tests; only the integration suites spawn real git.
- `savvy.build.ts` carries the **narrow** `_base` suppression (`{ messageId:
  "ae-forgotten-export", pattern: "_base" }`) for the synthesized bases behind
  every `Schema.TaggedErrorClass`/`Schema.Class` export (`GitCommandError`,
  `NotARepositoryError`, `UnknownRefError`, `LsTreeEntry`, `NameStatusEntry`,
  `CommitInfo`, `StatusEntry`, `Git`). Never widen it.
- Never run `node savvy.build.ts --target prod` directly.
