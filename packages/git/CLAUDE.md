# @effected/git

Typed git introspection over core's `ChildProcessSpawner`: a read tier that
reads a repository's state at any ref without checking it out (including the
network read `lsRemote` and the index read `lsFiles`), plus a clearly-marked
mutating tier — checkout/fetch, the working-tree restore trio and the stash
family, branches and tags, remotes, worktrees, `commit`/`push`/`pull`, the
submodule tier, sparse checkout, config writes and staging — that changes
it. Since the 2026-08-05 git-suite slice it also carries a **pure
git-config core**: `GitConfig` (a lossless, surgical-edit git-config
document model) with `Gitmodules` (the typed `.gitmodules` view) on top, no
subprocess anywhere near them. The
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

## The redaction policy (#86) — documented, not just convention

Every `GitCommand` constructor returns a **`GitInvocation`** — the spawnable
`ChildProcess.StandardCommand` plus `redactedArgs`, the same argv with every
sensitive positional masked. The mask lives on the pure constructor because
the constructor is the one place that knows which positionals are sensitive:
`configSet`'s value is masked wholesale as `<redacted>` (a config value can
be a secret), and URL positionals (the remote of `fetch`, `fetchUnshallow`,
`lsRemote`, `push` and `pull`, and the url of `submoduleAdd`,
`submoduleSetUrl`, `remoteAdd` and `remoteSetUrl`) keep everything but an
embedded `userinfo@` credential — a plain remote name or credential-free URL
passes through untouched. The userinfo mask is greedy through the LAST `@`
before the first path slash, so a password containing a literal `@` is
masked whole. `classify` persists ONLY `redactedArgs` into
`GitCommandError.args`, and `message` renders that redacted vector, so raw
argv never survives into an error value; a pre-spawn guard refusal of a
sensitive value reports `<redacted>` too. The second half of the policy:
**span annotations carry stable identifiers only** — `cwd`, refs, keys,
paths, remote names — never config values and never URLs. A new method must
follow both halves before it ships; a constructor with no sensitive
positional produces element-wise identical raw and redacted argvs, pinned by
the `assertGitCommand` helper's default.

## Six source modules

`GitCommand` is a static class with a private constructor, not an `as const`
namespace object — an `as const` object's member types are inferred in the
built `.d.ts` and lose their TSDoc entirely, while a class's `static readonly`
declarations keep it (the `@effected/commands` precedent, `11a121e0`). Call
syntax is unaffected (`GitCommand.show(...)`).

- `GitCommand.ts` — 67 pure constructors returning `GitInvocation` values
  (the core `ChildProcess.StandardCommand` plus the redacted argv — see the
  redaction policy above). Read tier: `show`, `lsTree`, `lsFiles`,
  `refExists`, `mergeBase`, `changedFiles`, `unstagedChanges`,
  `stagedChanges`, `untrackedFiles`, `revParse`, `isShallow`, `nameStatus`,
  `defaultBranch`, `currentBranch`, `repoRoot`, `commitInfo`, `configGet`,
  `configList`, `configGetAll`, `remoteUrl`, `status`, `submoduleStatus`,
  `lsRemote` (the one network read), `stashList`, `branchList`, `tagList`,
  `forEachRef`, `revList`, `checkIgnore`, `worktreeList`. Mutating tier:
  `checkout`, `fetch`, `fetchUnshallow`, `reset`, `clean`, `restore`,
  `branchCreate`, `branchDelete`, `submoduleUpdate`, `submoduleAdd`,
  `submoduleInit`, `submoduleDeinit`, `submoduleSync`, `submoduleSetUrl`,
  `submoduleSetBranch`, `submoduleAbsorbgitdirs`, `submoduleForeach`,
  `sparseCheckoutSet`, `configSet`, `configUnset`, `add`, `rm`, `mv`,
  `remoteAdd`, `remoteRemove`, `remoteSetUrl`, `stashPush`, `stashPop`,
  `stashApply`, `stashDrop`, `tagCreate`, `tagDelete`, `commit`, `push`,
  `pull`, `worktreeAdd`, `worktreeRemove`.
  (`Git.workingChanges` and `Git.fetchAny` compose existing methods —
  `unstagedChanges` + `stagedChanges` + `untrackedFiles`, and tag-form
  `fetch` then plain `fetch` — rather than adding their own `GitCommand`
  constructors.) `checkIgnore` is the one constructor carrying STDIN baked
  into the pure command value (`check-ignore -z --stdin` — the only fully
  robust form, and nothing caller-controlled enters the argv); the stash
  index constructors render `stash@{n}` from an INTEGER the service
  validates (`rejectNonNaturalNumber` — a NaN or fractional index is
  refused typed, pre-spawn, because every relational guard admits NaN).
  `changedFiles` and the three
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
  `StatusEntry`, `SubmoduleStatusEntry`), and the private
  `classify`/`runClassified` pair where git's
  stderr/exit-code taxonomy is read exactly once. `submoduleStatus` is the
  ONE path-emitting parser without a `-z` rule to lean on — git offers no
  `-z` for `submodule status`, so its parse is line-based and a path
  containing a newline (or a literal space-parenthesis suffix mimicking the
  describe parenthesis) would corrupt it; a
  recorded git-imposed limitation, not an oversight.
- `GitConfig.ts` — the pure git-config document model: `GitConfig` (text +
  structural index; `stringify` is byte-for-byte identity on unmodified
  documents), `GitConfigSection`/`GitConfigEntry`/`GitConfigInclude`,
  `GitConfigDiagnostic`, and the typed `GitConfigParseError` /
  `GitConfigEditError`. Semantics are git-config, NOT generic INI:
  case-insensitive section/key names, case-SENSITIVE quoted subsections, the
  deprecated `[a.b]` dotted form (its subsection compares case-insensitively),
  multi-valued keys (`getAll`/`append`), the bare-`key` boolean shorthand,
  quoting/escapes/continuations, and `include`/`includeIf` surfaced by
  `includes()` but never resolved. Edits (`set`/`append`/`unset`/`unsetAll`/
  `addSection`/`removeSection`/`renameSection`) are text splices + re-parse,
  so git's own formatting survives; malformed INPUT fails typed, while a
  hand-built `GitConfig.make` over unparseable text dies as a defect (bad
  wiring, not bad input). `parse` derives from `parseResult` per
  Result-parity.
- `Gitmodules.ts` — the typed `.gitmodules` view: `GitmodulesEntry`
  (`name`/`path`/`url` plus optional `branch`/`shallow`/`update`/`ignore`/
  `fetchRecurseSubmodules`), decode via `fromConfigResult`/`parseResult`/
  `parse`, the `FromString` codec, canonical `stringify`, and entry-level
  mutation statics (`setUrl`/`setPath`/`setBranch`/`setShallow`/`add`/
  `remove`/`rename`) that compile into `GitConfig`'s surgical edits so a
  mutated `.gitmodules` keeps its formatting. `update` stays a raw string
  deliberately (git accepts `!command` values).
- `internal/config.ts` — the git-config engine: the line-oriented scanner
  emitting raw records + diagnostics (the cycle firewall — it never imports
  the public classes) and the splice/serialize primitives the facade
  compiles edits into. No recursion anywhere, so no depth cap is needed —
  the scanner is a single loop over lines.

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
`Git.ts` — nowhere else in the package inspects `stderr`, `stdout` or
`exitCode`. `classify` takes a `ClassifyKind`
(`"show" | "refExists" | "quiet" | "noSuchRemote" | "push" | "merge" |
"generic"`) that gates which method-specific rows apply on top of the shared
taxonomy:

| stderr / exit shape | kind gate | classification | surfaces as |
| --- | --- | --- | --- |
| `exitCode === 0` | any | `success` | the method's success value |
| contains `"not a git repository"` | any | `notARepository` | `NotARepositoryError` |
| contains an unknown-revision phrase, incl. `"couldn't find remote ref"` | any | `unknownRef` | `UnknownRefError` — except `refExists`, which degrades to `false` |
| contains an absent-at-ref phrase | `"show"` only | `absent` | `Option.none()` |
| `exitCode === 1` and `stderr === ""` | `"quiet"` only | `absent` | `Option.none()` |
| contains `"No such remote"` | `"noSuchRemote"` only | `absent` | `Option.none()` |
| `exitCode === 1` | `"refExists"` only | `refMissing` | `false` |
| stderr has `"[rejected]"` AND one of `non-fast-forward` / `fetch first` / `stale info` | `"push"` only | `nonFastForward` | `NonFastForwardError` |
| stderr contains `"would be overwritten by"` | `"merge"` only | `dirtyWorktree` | `DirtyWorktreeError` |
| STDOUT **or** stderr contains `"CONFLICT ("` / `"Automatic merge failed"` / `"could not apply"` | `"merge"` only | `mergeConflict` | `MergeConflictError` |
| spawn-level `PlatformError` | any | `failure` | `GitCommandError` with `detail` set, no `exitCode` |
| per-run timeout (30s) | any | `failure` | `GitCommandError` with `detail: "timed out after 30s"`, no `exitCode` |
| anything else non-zero | any | `failure` | `GitCommandError` with `exitCode` + `stderr` |

`"couldn't find remote ref"` was added to `UNKNOWN_REF_PATTERNS` for the
mutating tier's ref-fetching operations. It classifies as `UnknownRefError`
for every method that reaches `classify`, but in practice only `fetch`,
`submoduleUpdate` and `submoduleAdd` produce it — it is the typed signal a
tag-then-branch fetch fallback (`Effect.catchTag`) branches on.

The `"push"` and `"merge"` kinds (2026-08-05 round 2) are the request's
"typed errors only where consumers branch" rule made structural: `"push"`
backs only `push` (rejected-non-fast-forward, incl. the `--force-with-lease`
`stale info` lease failure — probed against git 2.54, whose remote-moved
wording is `fetch first`, NOT the classic `non-fast-forward`); `"merge"`
backs only `pull`, `stashPop` and `stashApply` (`DirtyWorktreeError` before
git touches anything, `MergeConflictError` once markers are written). The
merge-conflict row is the ONE place `classify` reads STDOUT: git's merge
machinery reports `CONFLICT (` / `Automatic merge failed` on stdout (probed
for pull and stash pop alike), while a rebase-mode pull's `could not apply`
lands on stderr. Because the rows are kind-gated, **no pre-existing member's
error union changed** — `checkout` with dirty-worktree stderr still fails
`GitCommandError`, pinned by a zero-churn regression test.

`"quiet"` backs `defaultBranch` and `configGet` — and, round 2,
`configGetAll` (unset key → `[]`) and `checkIgnore` (`git check-ignore`
exits 1 silently when NO path is ignored → `[]`). Both original occupants run their git command
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

## The parsed models

`Git.ts` defines ten `Schema.Class` models beyond `LsTreeEntry`. The round-2
seven, each backing one list parser: `LsRemoteEntry` (`sha` + full `ref`,
`^{}` peel entries preserved, plus the pure decode-side statics `shortName`
and `nearMatches` — the systems#357 near-miss suggestion helper; the
suggestion policy deliberately lives on the entry VALUE, not in the
service), `StashEntry` (from the fixed `-z` `%gd%x1f%H%x1f%gs` format —
array position IS the current stash index), `BranchEntry` (NUL-separated
for-each-ref format on `git branch --list`; `current` decodes the `*`
marker), `RefEntry` (the fixed `%(refname)%00%(objectname)%00%(objecttype)`
triple), `ConfigListEntry` (`--list -z`, first-newline key/value split so
multi-line values survive; a valueless boolean-shorthand key surfaces as
`""`), `WorktreeEntry` (porcelain `-z` attribute blocks: `head`/`branch`
optional, `detached`/`bare` flags, `locked`/`prunable` reasons), and
`LsFilesEntry` (`ls-files --stage -z`: mode/oid/stage/path — the INDEX-side
sibling of `LsTreeEntry`, the only read that sees a staged-but-uncommitted
`160000` gitlink; systems#424's addendum ask). The original three, each
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

Thirty-one of `Git`'s sixty-nine methods only read repository state
without touching the working tree (`lsRemote` reads over the NETWORK —
still a read). Thirty-eight are mutating:
`checkout`, `fetch`, `fetchAny`, `fetchUnshallow`, `reset`, `clean`,
`restore`, `branchCreate`, `branchDelete`, `submoduleUpdate`,
`submoduleAdd`, `submoduleInit`, `submoduleDeinit`, `submoduleSync`,
`submoduleSetUrl`, `submoduleSetBranch`, `submoduleAbsorbgitdirs`,
`submoduleForeach`, `sparseCheckoutSet`, `configSet`, `configUnset`, `add`,
`rm`, `mv`, `remoteAdd`, `remoteRemove`, `remoteSetUrl`, `stashPush`,
`stashPop`, `stashApply`, `stashDrop`, `tagCreate`, `tagDelete`, `commit`,
`push`, `pull`, `worktreeAdd`, `worktreeRemove`.
(`submoduleStatus` is the one
submodule-tier READ; `submoduleForeach` is marked mutating because the
shell command it runs can mutate anything, regardless of what it does.)
The tier rule is simple and absolute: every mutating
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
on. `fetchAny` IS that fallback, shipped: it runs the tag-form `fetch`
(`tag: true`), and on `UnknownRefError` OR a `GitCommandError` (unclassified
tag-form stderr shapes stay on the fallback path) retries as a plain `fetch` —
EXCEPT a `GitCommandError` whose `kind` is `"refused"`, which it re-fails
immediately. That refused case is a pre-spawn guard rejection from the tag-form
`fetch`'s own option-like-ref guard; routing on `kind` is why `fetchAny` no
longer duplicates an up-front `rejectOptionLikeRefs` guard — a refused ref would
be rejected identically by the plain form, so the short-circuit yields a single
rejection with zero further spawns. `NotARepositoryError` propagates from the
tag attempt — the plain form would fail identically. When both attempts fail,
the PLAIN fetch's error surfaces; the tag attempt's failure is discarded.

## The working-tree restore trio, branches and the shallow pair (#193)

The 2026-08-05 mutating-tier slice closed silk-release-action's raw-spawn
census. Postures that are decisions, not defaults:

- **`reset` and `clean` fail LOUDLY on any non-zero exit** (`GitCommandError`,
  `kind: "failed"`) — they exist so a consumer can restore a tree before
  retrying a non-idempotent operation (`@changesets/apply-release-plan`
  deletes the changesets it consumes), and a reset that silently did nothing
  would hand the retry the same dirty tree. `clean` passes `--force`
  unconditionally for the same reason: under default `clean.requireForce`,
  a forceless clean is a guaranteed no-op.
- **`restore` is a separate member**, git's own verb for the
  `checkout -- <paths>` shape — `checkout`'s option-like-ref refusal is NOT
  weakened. `restore`'s paths sit behind a literal `--`; only its `source`
  ref is guarded.
- **Branch creation is a branch member, not a checkout option**:
  `branchCreate(cwd, name, { startPoint?, checkout?, force? })` emits
  `git branch [-f] <name> [<start>]`, or `git checkout (-b | -B) <name>
  [<start>]` with `checkout: true` (one member, two argvs — the `-b`/`-B` is
  the constructor's own literal). `force` with `checkout` exists because the
  delete-then-create longhand swallows a real edge: `branch -D` refuses the
  currently checked-out branch, `checkout -B` resets it fine.
  `branchDelete` emits `-d`, or `-D` with `force: true`.
- **`isShallow(cwd)` is a dedicated predicate** (`rev-parse
  --is-shallow-repository`, stdout `true`/`false`), deliberately not folded
  into `revParse` — that member's contract stays "resolve this REF".
- **`fetchUnshallow` is a distinct mode, and the CALLER guards.** git rejects
  `--unshallow` in a non-shallow repo; the method does not tolerate that
  (tolerating would swallow every other fetch failure shape) — probe with
  `isShallow` first. Its remote is a URL positional and rides the `secretUrl`
  redaction mask.

## StatusEntry porcelain rendering (#289)

`StatusEntry.toLine()` renders one `XY <path>` line; `StatusEntry.format(entries)`
newline-joins them (no trailing newline). **The rename convention is decided
here, once**: the default renders a rename/copy entry's NEW path only — the
entry's current path, the one a line-oriented consumer can open — a recorded
divergence from git's own non-`-z` `orig -> new` rendering, which is opt-in
via `{ renames: "arrow" }`. Second recorded divergence: no C-quoting of
special-character paths; the rendering targets whitespace-insensitive text
consumers, and machine parsers should consume the decoded entries directly.

## Testing and building

379 tests in `__test__/`: the `GitCommand` constructor suite (pure
invocation shape + the `setCwd` non-mutation guarantee, all 67 constructors,
plus the redaction-mask block asserting `redactedArgs` for the sensitive
constructors — now including `lsRemote`/`remoteAdd`/`remoteSetUrl`/`push`/
`pull` URL remotes — and identity for the rest), 6
`internal/run` (including defect passthrough through `available`), the `Git`
suite (the full classification matrix across all seven `ClassifyKind`s, the
option-injection guard block — every guarded positional has a no-spawn
rejection test — `workingChanges`' union/dedup, `fetchAny`'s
tag-then-plain fallback matrix — single-spawn success, both fallback
triggers, plain-error surfacing, `NotARepositoryError` short-circuit, and a
no-spawn guard rejection — the parsers
for `NameStatusEntry`/`CommitInfo`/`StatusEntry`/`SubmoduleStatusEntry`, the
submodule tier incl. redaction-through-classify assertions, mocked spawner —
plus the round-2 block: lsRemote parse + `nearMatches`, the stash family
incl. the NaN/fractional index refusals, the refs/history/config/misc tiers,
the push/merge classification matrix with its zero-churn gating control, and
redaction-through-classify for the URL-carrying members),
the `GitConfig` suite (a 27-case conformance corpus — count-guarded — each
case asserting lookups AND byte-for-byte round-trip, the malformed-input
family proving typed failure never defect, and the surgical-edit family),
the `Gitmodules` suite (decode incl. git boolean vocabulary, typed decode
errors naming entry+field, the `FromString` codec, and mutation-compiles-to-
surgical-edit assertions), and 28
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
  `CommitInfo`, `StatusEntry`, `SubmoduleStatusEntry`, `Git`, the round-2
  models and errors (`LsRemoteEntry`, `StashEntry`, `BranchEntry`,
  `RefEntry`, `ConfigListEntry`, `WorktreeEntry`, `LsFilesEntry`,
  `NonFastForwardError`, `MergeConflictError`, `DirtyWorktreeError`), and
  the `GitConfig`/`Gitmodules` class families — 29 suppressed entries at
  last clean build). Never widen it.
- Never run `node savvy.build.ts --target prod` directly.
