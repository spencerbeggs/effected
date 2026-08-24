---
status: current
module: effected
category: architecture
created: 2026-07-14
updated: 2026-08-23
last-synced: 2026-08-23
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

`@effected/git` is typed git for the kit, one service in two tiers: a **read tier** that reads a repository's state — file contents at a ref, tree and index listings, merge bases, changed paths, branch/tag/ref/config/remote/commit introspection, porcelain status, worktrees, ignore probes and the one network read (`ls-remote`) — without touching the working tree, and a **clearly-marked mutating tier** (checkout, fetch, the working-tree restore trio, the stash family, branches and tags, remotes, worktrees, `commit`/`push`/`pull`, the submodule and sparse-checkout operations, config writes, staging) that changes it. See `src/Git.ts` for the surface. It programs against **core's** subprocess contract (`ChildProcessSpawner` and `ChildProcess.Command` values from `effect/unstable/process`), requiring the spawner in its `R` channel exactly as the kit's boundary packages require core `FileSystem`: the consumer's platform layer (`@effect/platform-node`'s `NodeServices.layer` provides `ChildProcessSpawner`) discharges it once at the edge.

Scope is closed by its consumers — `@effected/workspaces` and savvy-web/systems' tooling (the DepsRegen engine plus the `@savvy-web/cli` / `@savvy-web/mcp` / `silk-effects` adoption wave, whose gap analysis is [issue #82](https://github.com/spencerbeggs/effected/issues/82)) — not by git's porcelain. There is no ambition toward a general git client; an operation earns a method here when a consumer needs it typed. Issue #82's open design question — where do mutating operations live? — was resolved as **grow `Git` itself**: one service, two tiers, rather than a second service or package. The tier marker is documentary and absolute: every mutating method's TSDoc opens with the literal word `"Mutating:"`, and that is the only signal — nothing in this package serializes concurrent access, so a caller running a mutating call alongside anything else against the same `cwd` owns the race, per cwd.

## Why it owns git interpretation

Interpreting git — the exit-code and stderr taxonomy, the absent-vs-error distinction, tree-entry parsing — is a concern that should exist **once**, typed, in a package named for it. The consumers would otherwise interpret git output and exit codes themselves: workspaces' snapshot reader needs "file at ref, or none", and systems' tooling hand-rolls `git` through `execFileSync`/platform `Command` across its cli, mcp and silk-effects packages. Those responsibilities live here instead, behind a small typed surface. `@effected/workspaces`' `ChangeDetector` and `WorkspaceSnapshots` service stand on this package.

## Tier and dependencies

**Boundary tier**, per the [dependency policy](../effect-standards.md#dependency-policy). `effect` is the only peer; there are **no `@effected` edges, no external runtime dependencies and no `node:` built-ins anywhere** — spawning is entirely behind core's `ChildProcessSpawner` contract, required in `R`. Requiring a core-declared service in `R` costs the consumer nothing ([R3](../effect-standards.md#dependency-policy)): the IO is discharged by the platform layer provided once at the edge, the identical argument that keeps walker, xdg and config-file at boundary tier over core `FileSystem`. `@effect/platform-node` appears only in `devDependencies`, for the integration suites — devDependencies never count toward tier.

## Public surface

See `src/GitCommand.ts` and `src/Git.ts` for the full surface; the index re-exports only.

### `GitCommand` — pure, inspectable invocations

One git-flavored constructor per operation, producing **core `ChildProcess.StandardCommand` values** (wrapped in `GitInvocation`, see the redaction policy), covering both tiers. They know the `git` executable, each operation's argument conventions, and the environment git needs pinned (`LC_ALL=C` via the command's `env` + `extendEnv: true`, so stderr classification is locale-stable without replacing the inherited environment). Every constructor returns a cwd-less value: a test can assert the exact `command`/`args`/`options` an operation runs without spawning, and `Git` applies the working directory per call via `ChildProcess.setCwd`.

Three invariants ride on the argv:

- **The `-z` rule.** Every **path**-emitting constructor — `lsTree`, `lsFiles`, `changedFiles`, `nameStatus`, `status`, `checkIgnore`, `worktreeList`, `configList`/`configGetAll` (whose values are arbitrary text) and the three working-tree constructors — always emits NUL-terminated output and splits on `"\0"`, never `"\n"`: git paths may themselves contain newlines, so a newline-split parse would silently corrupt them. The rule is about what the output can contain, not about uniformity — the **ref**-emitting constructors (`branchList`, `forEachRef`, `tagList`, `revList`) split records on newlines, safely, because refname grammar forbids one; `branchList` and `forEachRef` still separate their *fields* with NUL (`%00` in the format) so no field delimiter can collide with content. Two parsers are line-based with no choice in the matter, because git offers no `-z` mode at all: `lsRemote` (safe — a refname holds neither newline nor tab) and `submoduleStatus` (**not** safe, a recorded git-imposed limitation).
- **`checkIgnore` bakes stdin into the pure command value** — `check-ignore -z --stdin`, paths fed NUL-separated. It is the only constructor that does, and the form is forced: git rejects `-z` without `--stdin`, and the non-`-z` output C-quotes special-character paths. Nothing caller-controlled enters its argv as a result, so it needs no option-injection guard.
- **Explicit relative flag.** `changedFiles`, `nameStatus` and the working-tree diff constructors pass `--relative` when `relative` is true and `--no-relative` when false — never omitted, because git honors a configured `diff.relative=true` on an omitted flag and would silently produce cwd-relative paths for `relative: false`. `untrackedFiles` inverts the flag: `relative: false` adds `--full-name` so its `ls-files` output shares the un-`--relative` diffs' repo-root base. That alignment is why `workingChanges` can union its three path sources without mixing coordinate systems.

### `Git` — the service, read tier

A `Context.Service` whose layer resolves `ChildProcessSpawner` once at construction, so every method's `R` is `never`. The service's shape is the **exported `GitShape` interface** (`Context.Service<Git, GitShape>`), not an inferred object type: exporting it lets a consumer write a function that accepts any `GitShape` — a test double, a decorated instance — without naming the service class, and it makes the surface a reviewable declaration rather than whatever the implementation happened to return. Every method takes `cwd` explicitly — the caller who knows where "here" is passes it in. The per-operation ceiling is git's own policy (30 seconds via `Effect.timeoutOrElse`, owned here, not a spawner option). Small internal helpers over the spawner (a collected-run and an `available` probe) live in `internal/run.ts`, not on the public surface.

The founding read contracts are unchanged: `show(cwd, ref, path)` returns `Option<string>` — **absent-at-ref degrades to `Option.none`, never an error**, the invariant `WorkspaceSnapshots.at` depends on; `lsTree` (now with an optional pathspec) returns the `LsTreeEntry[]` a compiled [`@effected/glob`](glob.md) set filters; `refExists` answers a non-resolving ref as `false`, never an error; `mergeBase` and `changedFiles` are the committed-range primitives `ChangeDetector` runs on; `revParse` normalizes refs for snapshot cache keys.

Four seams beyond those founding contracts are worth stating, because each one's shape was a decision:

- **Working-tree primitives are public.** `unstagedChanges`, `stagedChanges` and `untrackedFiles` are service methods in their own right (systems' branch analyzer needs the untracked overlay alone); `workingChanges` remains and composes them as the deduplicated union, its options now optional.
- **`nameStatus`** is the semantically-typed diff: each `NameStatusEntry` carries a typed status vocabulary rather than name-only paths, renames/copies carry `oldPath`, and it takes both a `base...head` two-ref form and a single-arg working-tree-vs-ref form.
- **The absence family.** Four introspection probes degrade "not there" to `Option.none` rather than an error, extending `show`'s founding invariant: `defaultBranch` (unset remote HEAD; the `<remote>/` prefix is stripped from the answer), `currentBranch` (detached HEAD — git's literal `"HEAD"` answer maps to none, because a fake branch name would be worse than an honest absence), `configGet` (unset key) and `remoteUrl` (missing remote).
- **Commit and status models.** `commitInfo` parses into `CommitInfo` (sha, `%G?` signature-status literals, and the raw `%B` message — deliberately untrimmed, because this package does not decide what "the message" means for a caller that cares about trailing whitespace). `status` parses `git status --porcelain -z` into `StatusEntry` values.

The listing reads are each backed by one parsed model, and four of them carry a fact worth knowing before reading the parser: `lsRemote` is the one **network** read and preserves the full advertised refname including `^{}` peel entries; `lsFiles` is the index-side sibling of `lsTree` and the only read that sees a staged-but-uncommitted `160000` gitlink; a `StashEntry`'s array position **is** its current stash index; and `configList`/`configGetAll` split at the first newline so a multi-line value survives. `tagList`, `revList` and `checkIgnore` need no model, because a bare string is the whole answer.

Two placement decisions there are worth keeping: **`LsRemoteEntry.shortName` and `LsRemoteEntry.nearMatches` are pure decode-side statics on the entry value, not service behavior** — `lsRemote` returns the full listing and the caller owns the matching policy, so the near-miss suggestion helper (the monorepo-prefixed-tag case, where a caller asks for `4.0.0-beta.101` and the remote advertises `effect@4.0.0-beta.101`) cannot quietly become a network round trip. And **`isShallow` is a dedicated predicate**, deliberately not folded into `revParse`, whose contract stays "resolve this ref".

One trap is load-bearing enough to record: **`NameStatusEntry` and `StatusEntry` order their rename token pair opposite each other** — `diff --name-status -z` emits old-path-then-new-path, `status --porcelain -z` emits new-path-then-original-path. The two parsers must never be conflated or refactored into one shared implementation; each is correct only for its own token order.

### `Git` — the service, mutating tier

The mutating tier covers checkout and the fetch family, the working-tree restore trio (`reset`, `clean`, `restore`), branches, tags, stashes, remotes, worktrees, `commit`/`push`/`pull`, the path movers, config writes, staging, and the submodule and sparse-checkout operations — see `src/Git.ts`, where every one of them opens its TSDoc with `"Mutating:"`. They exist for savvy-web/systems' repos domain — the `savvy repos` CLI and `repos_manage` MCP tool managing vendored read-only submodules — and for checkout's original snapshot use. `submoduleForeach` is marked mutating because the shell command it runs can mutate anything, and `submoduleStatus` is that group's one read. `fetch`, `submoduleUpdate` and `submoduleAdd` are the ref-fetching trio whose unknown-ref failures surface typed (see the classification below); `sparseCheckoutSet` spells `--cone`/`--no-cone` explicitly in both branches rather than defaulting to git's config.

**`fetchAny` is that typed classification cashed in.** The tag-then-branch fallback was previously left to consumers; it is now a method, because every consumer of a "fetch this ref, I don't know which kind it is" operation would otherwise rebuild the same composition — and rebuilding it on stderr strings is exactly what the typed errors exist to prevent. It composes `fetch(tag: true)` with `Effect.catchTag(["UnknownRefError", "GitCommandError"], …)`, whose handler routes on the caught error's structure — retrying as a plain `fetch` except when the `GitCommandError`'s `kind` is `"refused"`, which it re-fails unchanged:

- **`UnknownRefError`** is the typed "not a tag on the remote" signal — the intended fallback trigger.
- **`GitCommandError`** falls back too, so an unclassified tag-form stderr shape still reaches the plain attempt rather than failing a fetch that would have succeeded.
- **`NotARepositoryError` deliberately propagates.** The plain form would fail identically, so retrying is pure waste — a fallback that retries an error whose cause it cannot change is a fallback that only doubles the latency of a certain failure.
- On double failure, **the plain attempt's error surfaces**, not the tag attempt's: the second error is the one describing the form the caller most likely meant.
- **The refused-ref short-circuit rides on `kind`.** `fetchAny` no longer duplicates an up-front `rejectOptionLikeRefs` guard: the tag-form `fetch` runs its own guard, and when it refuses an option-like ref the resulting `GitCommandError` carries `kind === "refused"`, on which the fallback handler re-fails immediately rather than routing through the plain attempt. A refused ref would be rejected identically by the plain form's own guard, so short-circuiting yields a single rejection with zero further spawns — and avoids surfacing a rejection from a phantom tag-form fallback that describes the wrong invocation. Routing on the structural `kind` is what let the duplicated guard drop.

Five postures inside the tier are decisions rather than defaults:

- **`reset` and `clean` fail loudly on any non-zero exit.** They exist so a consumer can restore a tree before retrying a non-idempotent operation (`@changesets/apply-release-plan` deletes the changesets it consumes), and a reset that silently did nothing would hand the retry the same dirty tree. `clean` passes `--force` unconditionally for the same reason: under git's default `clean.requireForce`, a forceless clean is a guaranteed no-op.
- **`restore` is a separate member** — git's own verb for the `checkout -- <paths>` shape — so `checkout`'s option-like-ref refusal is never weakened to admit pathspecs. Its paths sit behind a literal `--`; only its `source` ref is guarded.
- **Branch creation is a branch member, not a checkout option.** `branchCreate(cwd, name, { startPoint?, checkout?, force? })` is one member with two argvs: `git branch [-f] <name> [<start>]`, or `git checkout (-b | -B) <name> [<start>]` under `checkout: true`, the `-b`/`-B` being the constructor's own literal rather than a caller-supplied flag. `force` exists because the delete-then-create longhand swallows a real edge — `branch -D` refuses the currently checked-out branch while `checkout -B` resets it fine. `branchDelete` emits `-d`, or `-D` under `force`.
- **`fetchUnshallow` is a distinct mode, and the caller guards.** git rejects `--unshallow` in a non-shallow repository, and this method deliberately does not tolerate that failure — tolerating it would swallow every other fetch failure shape — so a caller probes with `isShallow` first. Its remote is a URL positional and rides the redaction mask.
- **The pre-spawn typed refusal generalized beyond refs.** Alongside the option-injection guard, a natural-number guard refuses a NaN or fractional stash index or `revList` limit before any spawn, because every relational comparison admits NaN. The stash members render `stash@{n}` from that validated integer.

## Rendering status back to text

`StatusEntry.toLine()` renders one `XY <path>` line and `StatusEntry.format(entries)` newline-joins them (no trailing newline), taking the whole round trip from `git status --porcelain -z` back to line-oriented text through this package instead of through each consumer's ad-hoc string building. **The rename convention is decided here, once**: the default renders a rename/copy entry's new path only — the entry's current path, the one a line-oriented consumer can actually open — a recorded divergence from git's own non-`-z` `orig -> new` rendering, which stays available opt-in via `StatusRenderOptions`' `{ renames: "arrow" }`. A second recorded divergence: paths are emitted raw, never C-quoted, because the rendering targets whitespace-insensitive text consumers; a machine parser should consume the decoded entries directly and never re-parse this output.

### The shipped test double

`Git.makeTest(overrides)` returns a `GitShape` whose every unstubbed member **dies with a defect naming itself**, and `Git.layerTest(overrides)` is that value behind `Layer.succeed`. The design choice is the defect: no honest default exists for any member — a fabricated answer would leak into consumer logic as fact — so an unstubbed call cannot be swallowed by a test's error handling, and the double doubles as a proof that a test touched nothing but the methods it stubbed. It grows with `GitShape`, which is why a consumer's hand-enumerated fake is a maintenance liability rather than an alternative: every service growth breaks one. The double deliberately models **none** of the live service's semantics — no classification, no option-injection guard, no `LC_ALL=C`, no timeout — so a suite exercising any of those wants `Git.layer` over a mocked spawner (or real git) instead. `layerTest` is a parameterized factory, so bind its result to a `const`: layers memoize by reference.

## Errors: classification happens once

The design rule: **no consumer of this package ever string-matches stderr.** Git's failure modes are classified in a single private `classify` step in `Git.ts` — nowhere else in the package inspects `stderr`, `stdout` or `exitCode`. The founding taxonomy is three typed errors, carried unchanged through every surface growth:

- **`GitCommandError`** — git ran and failed in a way that is not a recognized domain case, **or** the spawn itself failed, **or** a pre-spawn guard refused the invocation. The spawner's `PlatformError` and a per-run timeout are absorbed here rather than leaked raw, so consumers of `Git` see git's taxonomy, not core's plumbing. Carries `args`, `cwd`, `exitCode` and `stderr` when git ran; a `detail` string carries the absorbed spawn failure or timeout when it did not (the non-`NotFound` arms keep the underlying `PlatformError` reason and message so `PermissionDenied` / `TimedOut` diagnostics survive absorption). A **required `kind` discriminant** (`kind: Schema.Literals(["refused", "failed"])`) splits those cases structurally: `"refused"` is a pre-spawn guard rejection (an option-like ref rejected by `rejectOptionLikeRefs` before any process spawned); `"failed"` is a genuine git failure (a non-zero exit, or an absorbed spawn/timeout failure via `classify` / `runClassified`). Composed retry/fallback logic routes on `kind` structurally instead of parsing the `detail` prose. `kind` is required, so every construction site supplies it — the deliberate choice was to keep the error union stable by adding a field to the existing class rather than splitting off a new tagged error, which stays non-breaking because consumers catch and read the error rather than construct it.
- **`NotARepositoryError`** — the cwd is not inside a git work tree. Every consumer branches on this, so it is a distinct tag rather than a `GitCommandError` the caller regex-matches.
- **`UnknownRefError`** — the ref does not resolve. Actionable and user-facing ("diff against a base branch that does not exist locally"), so it is distinct from mechanics. The two-ref methods (`mergeBase`, `changedFiles`) report `ref` as the `"a...b"` range label; the single-ref methods report the plain ref value. `UNKNOWN_REF_PATTERNS` includes `"couldn't find remote ref"` so the ref-fetching trio's failures land here typed — the signal [`fetchAny`](#git--the-service-mutating-tier)'s `catchTag` tag-then-plain fallback branches on.

Three more exist on the rule **a typed error exists only where a consumer branches**, and each is raised by only the members introduced with it:

- **`NonFastForwardError`** — `push` rejected because the remote moved (or a `--force-with-lease` lease failed). The consumer's branch is real: fetch-and-retry rather than surface a failure.
- **`DirtyWorktreeError`** — git refused before touching anything, because local changes would be overwritten (`pull`, `stashPop`, `stashApply`).
- **`MergeConflictError`** — git wrote conflict markers; the tree now needs resolution, a categorically different follow-up from either of the above.

**Those three are kind-gated, so adding them changed no other member's error union.** `"push"` backs only `push` and `"merge"` backs only `pull`/`stashPop`/`stashApply`, which is why `checkout` failing on dirty-worktree stderr still surfaces as `GitCommandError` — pinned by a regression test rather than by intent. Widening an existing member's typed errors would be a silent breaking change to every `catchTag` on it.

Three probe-settled facts (against the installed git 2.54) are recorded because rediscovering them costs a live network or conflict fixture:

- **A push rejection's wording is `fetch first`, not the classic `non-fast-forward`.** The patterns are gated on the stderr also containing `[rejected]`, so a branch or path merely named "fetch first" cannot misclassify; the `--force-with-lease` lease failure says `stale info`.
- **Merge-conflict text arrives on STDOUT** for a merge-mode `pull` and for `stash pop`/`apply` (`CONFLICT (`, `Automatic merge failed`), while a rebase-mode pull's `could not apply` lands on stderr. This is the one place `classify` reads stdout at all.
- **`git check-ignore -z` requires `--stdin`** — git rejects `-z` on its own, which is why the paths are fed NUL-separated over stdin rather than as argv.

`classify` is gated by a `ClassifyKind` (`"show" | "refExists" | "quiet" | "noSuchRemote" | "push" | "merge" | "generic"`) selecting which method-specific rows apply on top of the shared taxonomy: the absent-at-ref degrade for `show`; the exit-1-is-false degrade for `refExists`; `"quiet"` (a silent exit 1 — empty stderr — means "unset" and degrades to an absence, while exit 1 **with** stderr stays a real failure) backing `defaultBranch`, `configGet` and, since round 2, `configGetAll` (unset key → `[]`) and `checkIgnore` (nothing ignored → `[]`); `"noSuchRemote"` (git's `"No such remote"` stderr degrades to `Option.none`) backing `remoteUrl`; and the two round-2 kinds above. Both `PlatformError` and `Cause.TimeoutError` are absorbed inside `runClassified`, so a `Git` method's error channel only ever sees this package's typed errors — never core's raw plumbing.

Two invariants sit alongside the taxonomy:

- **Non-error: a path absent at a valid ref is `Option.none`** from `show` (and simply missing from `lsTree` output), and the introspection absence family above inherits the same shape. The snapshot diffing built on top inherits this from the type rather than from prose.
- **Option-injection guard.** Every caller-supplied positional that is not protected by a literal `--` in the argv — refs, ranges, remotes, config keys, submodule urls and paths — is validated before any spawn: a leading-dash value fails typed as `GitCommandError` rather than reaching git's argv parser, where it would read as a flag (`checkout -b` being the dangerous case; a blanket `--` is not a safe alternative because it switches `checkout` into pathspec mode, which is also why `add` — a genuine pathspec operation — is the one constructor that does use a literal `--`). `configSet` has no documented `--` separator, so it guards all three of its string inputs — `key`, `value` **and** `options.file` — with the recorded limitation that a legitimate config value beginning with `-` is refused typed rather than risked. The pure `GitCommand` constructors deliberately do not validate; the service is the fallible boundary.

The stderr matching is **unanchored substring matching** against `LC_ALL=C`-pinned phrases — a path or ref name that literally contains one of these phrases could misclassify. This is an accepted, recorded tradeoff (see the comment above `UNKNOWN_REF_PATTERNS` in `Git.ts`); anchoring is deferred until a real collision is observed.

### Config reads are scopeable; config writes are not

`configList` and `configGet` take an optional `scope` (`local`, `global`, `system`, `worktree`). **Omitted still means the MERGED read** — repository-local plus global plus system — because that is the right answer to "what is the effective value" and the compatible one for every existing caller.

It is the wrong answer to "what does THIS checkout declare", and that mismatch was a live defect rather than a nicety: a globally set key shadows a decision that is really about one repository, and an enumerate-then-remove flow reads more broadly than `configRemoveSection` writes, which defaults to the local file — so the enumeration proposes removing entries the write cannot reach. `{ scope: "local" }` is the precise read. `file` and `scope` both select a source and git accepts only one, so passing both fails typed as a `GitCommandError` rather than silently preferring either.

**`configSet` is repository-local, always, and takes no scope option.** A bare `git config <key> <value>` writes the checkout's own `.git/config`, and the method emits no scope flag. The asymmetry with the reads is deliberate: a read has a defensible "effective value" default and a write does not. Writing global or system config would leak a setting onto a shared machine or a CI runner for every unrelated step in the job, so it is **not offered at all** rather than hidden behind an option that is easy to pass by accident. The documentation says so on the method, because the absence of an option is not self-explaining.

## The pure git-config core

A **pure git-config parser/serializer lives inside this package**, rather than as an INI codec in `config-file` or as shell-out-only access — `.gitmodules` is a reconcilable authority downstream, and git-config is not INI. Two public modules and one engine, following the format-package discipline at module (not package) granularity:

- **`GitConfig`** is text-first and lossless: the document holds its source text plus a structural index, `stringify` returns the text (byte-for-byte identity on unmodified documents), and every edit — `set`/`append`/`unset`/`unsetAll`/`addSection`/`removeSection`/`renameSection` — compiles to a minimal text splice and re-parses, so comments, ordering and whitespace outside the edited span survive. Semantics are git's: case-insensitive section/variable names, case-sensitive quoted subsections, the deprecated `[a.b]` dotted form (subsection compared case-insensitively), multi-valued keys, the bare-`key` boolean shorthand, quoting/escape/continuation rules, and `include`/`includeIf` surfaced but never resolved. Malformed *input* fails typed (`GitConfigParseError`, diagnostics array); a hand-built `GitConfig.make` over unparseable text is bad *wiring* and dies as a defect at first use. Edits that can be refused fail typed as `GitConfigEditError` (`missingSection`/`missingKey`/`invalidSectionName`/`invalidSubsection`/`invalidKey`/`invalidValue`). `parse` derives from `parseResult` per the kit's Result-parity policy. The engine (`internal/config.ts`) is a single iterative line scanner — no recursion surface, so no depth cap.
- **`Gitmodules`** is the typed view: `GitmodulesEntry { name, path, url, branch?, shallow?, update?, ignore?, fetchRecurseSubmodules? }` decoded with git's boolean vocabulary and last-wins duplicate-section merging; decode failures are typed and name the entry and field. Entry-level mutations (`setUrl`/`setPath`/`setBranch`/`setShallow`/`add`/`remove`/`rename`) deliberately take and return a `GitConfig` — they compile into the surgical editor so git's own formatting survives — while `stringify`/`FromString` render a canonical document for consumers with no source formatting to preserve.

## The redaction policy — documented policy, not convention

- **The mask lives on the pure constructor.** Every `GitCommand` constructor returns a `GitInvocation { command, redactedArgs }`; the constructor is the one place that knows which positionals are sensitive. Two mask kinds: a config value (`configSet`) is replaced wholesale by `<redacted>`; a URL positional keeps everything but an embedded `userinfo@` credential, so remote names and credential-free URLs stay fully debuggable. Every remote-accepting constructor rides the URL mask — `fetch`, `fetchUnshallow`, `lsRemote`, `push`, `pull`, `remoteAdd`, `remoteSetUrl`, `submoduleAdd` and `submoduleSetUrl` — and the rule generalizes: a new constructor taking a remote or URL positional applies the mask, and a constructor with no sensitive positional produces element-wise identical raw and redacted argvs, pinned by the test helper's default.
- **The error model itself is redacted.** `classify` persists only `redactedArgs` into `GitCommandError.args`, and `message` renders that vector — raw argv never survives into an error value. A pre-spawn guard refusal of a sensitive value reports `<redacted>` too.
- **Span annotations carry stable identifiers only** — `cwd`, refs, keys, paths, remote names — never config values and never URLs. Both halves of this policy, error redaction and span discipline, are what a new method must satisfy before it ships.

## Module layout

Six source modules, per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept):

- `GitCommand.ts` — the pure invocation constructors, both tiers, returning `GitInvocation` values carrying the redaction mask.
- `Git.ts` — the `Git` service, its live layer and its test double, the error taxonomy, the `classify`/`runClassified` pair, and the parsed-result models with their output parsers. `submoduleStatus`'s parser is line-based because git offers no `-z` for `submodule status` — a recorded git-imposed limitation, unlike `lsRemote`'s line split, which is safe by refname grammar.
- `GitConfig.ts` — the lossless git-config document model and surgical editor (above).
- `Gitmodules.ts` — the typed `.gitmodules` view (above).
- `internal/run.ts` — the collected-run and `available` helpers over `ChildProcessSpawner`, not exported (a helper earns export only when a second package asks for it).
- `internal/config.ts` — the git-config engine: raw scanner records and splice/serialize primitives behind the cycle firewall.

## Observability

Named spans on each `Git` method, annotated with stable identifiers (`cwd`, `ref`), never file contents. No logging, no metrics — telemetry-agnostic per the [observability standard](../effect-standards.md#observability-standards). The stable-identifiers-only rule is half of the documented redaction policy above.

`savvy.build.ts` carries a narrow `_base` suppression (`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the synthesized schema bases; never widen it. Gate on a cold `pnpm build --filter @effected/git`, never the raw script.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in `__test__/`.

- **Unit: `Git` over a mocked `ChildProcessSpawner`** pins the classification boundary — the highest-value tests in the package (the full matrix across every `ClassifyKind`, the absence-family degrades, the option-injection and natural-number guards rejecting pre-spawn, the `NameStatusEntry`/`CommitInfo`/`StatusEntry` parsers with their opposed rename token orders, redaction surviving through `classify`, and unrecognized failures falling through to `GitCommandError` with `exitCode`/`stderr` intact).
- **Unit: `GitCommand` constructors** — exact argv and env assertions plus the redaction mask (and argv identity where there is no sensitive positional), no spawning.
- **Unit: the pure modules** — `GitConfig`'s conformance corpus (count-guarded; each case asserts lookups **and** byte-for-byte round-trip), its malformed-input family proving typed failure never a defect, its surgical-edit family, and `Gitmodules`' decode/mutation suites.
- **Unit: the test double** — that an unstubbed member dies named, and that no slot is `undefined`.
- **Integration: fixture repositories** driven through `@effect/platform-node`'s real `ChildProcessSpawner` layer, with the mutating tier isolated in its own temp-dir fixtures since it mutates.

**A new typed error ships with a control.** The `push`/`merge` classification rows are pinned both positively and negatively: a test asserts the errors fire on their own members, and a control asserts another member fed the same stderr still fails `GitCommandError`. Without the control, kind gating is an intention rather than a guarantee.

Three testing decisions are load-bearing:

- **Do not delete the dual-stream backpressure integration test.** It is the only thing that exercises `runCollected`'s `{ concurrency: "unbounded" }` collection — a mock spawner over in-memory streams cannot deadlock the way a real OS pipe can. It pressures both stdout and stderr simultaneously; a single-stream case would not discriminate sequential from concurrent collection.
- **The integration suites use plain `beforeAll`/`afterAll` + `Effect.runPromise`.** This is a sanctioned second integration-suite pattern for shared, expensive real-world fixtures, alongside (not replacing) `app`'s `Effect.ensuring` per-test pattern, which remains the default for cheap per-test fixtures.
- **File-protocol submodules are a caller-environment decision.** git ≥ 2.38 (CVE-2022-39253) blocks `file://` submodule remotes by default, and a repo-local `protocol.file.allow` on the superproject does **not** reach `git submodule add`'s internal clone subprocess (verified against git 2.54) — only a command-line `-c`, the environment or global config do. Nothing this package spawns enables the protocol; the submodule integration suite sets `GIT_ALLOW_PROTOCOL=file` at module scope, contained by the `forks` pool's per-file process isolation.

## Consumers

- **`@effected/workspaces`** — `ChangeDetector` runs on `Git` (the committed range via `changedFiles(relative: true)`, `includeUncommitted` via `workingChanges(relative: true)`); the `WorkspaceSnapshots` service reads refs through `show`/`lsTree` ([workspaces.md](workspaces.md)). A non-repository surfaces as this package's typed `NotARepositoryError`. Its tests consume `Git.layerTest` rather than a hand-enumerated fake.
- **savvy-web/systems** — the DepsRegen engine replaces its hand-rolled synchronous `execFileSync` helpers with `mergeBase` and `lsTree`; the `@savvy-web/cli` / `@savvy-web/mcp` / `silk-effects` adoption wave consumes the introspection tier (name-status diffs, branch/config/remote/commit probes, porcelain status) per [issue #82](https://github.com/spencerbeggs/effected/issues/82)'s gap analysis; and the repos domain (`savvy repos` CLI, `repos_manage` MCP tool) managing vendored read-only submodules is the mutating tier's consumer (fetch, submodule and sparse-checkout operations). `lsRemote`'s `nearMatches` and `lsFiles`' staged-gitlink visibility exist for it specifically.
- **silk-release-action (dogfood)** — the release loop's raw-spawn census drove the mutating-tier expansion: the restore trio for pre-retry cleanup, `branchCreate`/`push`/`commit` for the release branch, the stash family, and porcelain rendering for its job summaries ([#193](https://github.com/spencerbeggs/effected/issues/193), [#289](https://github.com/spencerbeggs/effected/issues/289)).
