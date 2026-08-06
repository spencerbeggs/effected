# @effected/git

Typed git over core's `ChildProcessSpawner`: **69 service members in two
tiers** — a read tier (31 members) that reads a repository's state at any ref
without touching the working tree, including the one network read (`lsRemote`)
and the index read (`lsFiles`), plus a clearly-marked mutating tier (38
members: checkout/fetch, the restore trio, stash, branches, tags, remotes,
worktrees, `commit`/`push`/`pull`, submodules, sparse checkout, config writes
and staging) that changes it — nothing serializes concurrent access, so a
caller running two mutating calls (or a mutating call alongside a read)
against the same `cwd` owns the race. Alongside the service sits a **pure
git-config document core** (`GitConfig` + `Gitmodules`) with no subprocess
anywhere near it. Boundary tier: peers only on `effect`, zero runtime deps,
zero `node:` imports — the spawner is required in `R` and discharged once by
the consumer's platform layer.

## Import

```ts
import { Git, GitCommand, GitConfig, Gitmodules } from "@effected/git";
import type { GitInvocation, GitShape } from "@effected/git";
```

Single entrypoint; no subpaths.

**Platform**: provide `ChildProcessSpawner` once at the edge —
`@effect/platform-node`'s `NodeServices.layer` (or `@effect/platform-bun`'s
equivalent), as in the example below. `GitConfig`/`Gitmodules` need nothing at
all; they are pure.

## Core API

- **`Git`** — `Context.Service`; `Git.layer` resolves `ChildProcessSpawner` at
  construction so every method's `R` is `never`. Every method takes `cwd`
  explicitly; every failure is one of the typed errors below or a documented
  non-error degradation (`Option.none()`, `false`, `[]`).

### Read tier (31 members; `R = never`)

| Group | Members | Notes |
| --- | --- | --- |
| Content at a ref | `show` (`Option<string>` — absent-at-ref is `None`, never an error), `lsTree` (`LsTreeEntry[]`, optional pathspec) | NUL-safe parsing |
| Index | `lsFiles` (`LsFilesEntry[]` from `ls-files --stage -z`) | the index-side sibling of `lsTree`; the only read that sees a staged-but-uncommitted `160000` gitlink |
| Refs | `refExists` (`false` for an unresolvable OR unknown-syntax ref, never an error), `revParse`, `mergeBase`, `forEachRef` (`RefEntry[]`), `revList`, `branchList` (`BranchEntry[]`, `current` decodes the `*`), `tagList` | `mergeBase`'s `UnknownRefError.ref` carries the `"a...b"` range, not one side |
| Diffs | `changedFiles`, `nameStatus` (`NameStatusEntry[]`), `workingChanges` (deduplicated union of unstaged + staged + untracked; no ref, so never `UnknownRefError`), `unstagedChanges`, `stagedChanges`, `untrackedFiles`, `status` (`StatusEntry[]`) | `relative: false` adds `--full-name` to `untrackedFiles` so `workingChanges` unions one path base |
| Repo facts | `repoRoot`, `currentBranch` (`None` on detached `HEAD`, never the literal `"HEAD"`), `defaultBranch` (`None` when `origin/HEAD` is unset), `isShallow`, `commitInfo` (`CommitInfo`; raw untrimmed message) | `isShallow` is a dedicated predicate, deliberately not folded into `revParse` |
| Config reads | `configGet` (`None` when unset), `configGetAll` (`[]` when unset), `configList` (`ConfigListEntry[]`) | `configList` splits at the first newline so multi-line values survive |
| Remotes / network | `remoteUrl` (`None` when the remote doesn't exist), `lsRemote` (`LsRemoteEntry[]` — the ONE network read, still a read) | `LsRemoteEntry.shortName` and `.nearMatches` are pure decode-side statics; the near-miss suggestion policy lives on the entry VALUE, not the service |
| Misc | `stashList` (`StashEntry[]` — array position IS the current stash index), `worktreeList` (`WorktreeEntry[]`), `submoduleStatus` (`SubmoduleStatusEntry[]`), `checkIgnore` (`[]` when nothing is ignored) | |

### Mutating tier (38 members) — nothing serializes concurrent access to the same `cwd`

Every mutating method's TSDoc opens with the literal word `"Mutating:"`; that
marker is the only signal a caller gets.

| Group | Members | Notes |
| --- | --- | --- |
| Checkout / fetch | `checkout`, `fetch`, `fetchAny`, `fetchUnshallow` | `fetchAny` tries the tag form, then the plain form on `UnknownRefError` or a `GitCommandError` — except `kind: "refused"` (a pre-spawn guard rejection), which re-fails at once; if both fail the PLAIN error surfaces. `fetchUnshallow` does NOT tolerate a non-shallow repo — probe with `isShallow` first |
| Restore trio | `reset` (`mode`/`ref`), `clean` (`--force` unconditional), `restore` (paths always behind a literal `--`) | `reset`/`clean` fail LOUDLY on any non-zero exit — a silent no-op would hand a retry the same dirty tree |
| Branches / tags | `branchCreate` (`{ startPoint?, checkout?, force? }` — one member, `branch [-f]` or `checkout -b/-B`), `branchDelete`, `tagCreate`, `tagDelete` | branch creation is a branch member, not a `checkout` option |
| Commit / push / pull | `commit` (`{ all?, allowEmpty?, amend?, author? }`), `push` (`{ remote?, refspec?, force?, forceWithLease?, tags?, setUpstream? }`), `pull` (`{ remote?, ref?, rebase?, ffOnly? }`) | `push` additionally fails `NonFastForwardError`; `pull` additionally fails `MergeConflictError` / `DirtyWorktreeError` |
| Stash | `stashPush`, `stashPop`, `stashApply`, `stashDrop` | `stashPop`/`stashApply` additionally fail `MergeConflictError` / `DirtyWorktreeError`; a NaN or fractional `index` is refused typed, pre-spawn |
| Remotes | `remoteAdd`, `remoteRemove`, `remoteSetUrl` | the `url` positional rides the redaction mask |
| Worktrees | `worktreeAdd`, `worktreeRemove` | |
| Submodules | `submoduleUpdate`, `submoduleAdd`, `submoduleInit`, `submoduleDeinit`, `submoduleSync`, `submoduleSetUrl`, `submoduleSetBranch`, `submoduleAbsorbgitdirs`, `submoduleForeach` | `submoduleStatus` is the tier's one READ; `submoduleForeach` is marked mutating because the shell command it runs can mutate anything |
| Index / config / sparse | `add`, `rm`, `mv`, `configSet`, `configUnset`, `sparseCheckoutSet` | `configSet` guards `key`, `value` AND `options.file` against a leading `-` (git config has no `--` separator), so a legitimate value starting with `-` cannot be written through it |

- **`GitShape`** — the exported interface behind `Git`'s tag. Two uses beyond
  the obvious: `Pick<GitShape, "mergeBase" | "nameStatus" | ...>` narrows a
  downstream service's dependency to exactly the methods it reads;
  `Layer.succeed(Git, fake)` accepts any `GitShape`-shaped object as a full
  test double.
- **`GitCommand`** — 67 pure, `cwd`-less constructors returning `GitInvocation`
  values (a core `ChildProcess.StandardCommand` plus `redactedArgs`),
  inspectable without spawning. (`workingChanges` and `fetchAny` are `Git`
  methods with no matching constructor — each composes others.)
- **Errors** — `GitCommandError` (`args` are the REDACTED argv; plus
  `cwd`/`exitCode`/`stderr`/optional `detail` for an absorbed spawn failure or
  timeout), `NotARepositoryError` (`cwd`), `UnknownRefError` (`ref`, `cwd`),
  and three that appear on **new members only**, so no pre-existing member's
  error union changed: `NonFastForwardError` (`push`),
  `MergeConflictError` / `DirtyWorktreeError` (`pull`, `stashPop`,
  `stashApply`).

## The pure git-config core

`GitConfig` and `Gitmodules` are a **format package living inside a host
package** — no subprocess, no `R`, usable from any pure context.

- **`GitConfig`** — a lossless git-config document model (text + structural
  index; `stringify` is byte-for-byte identity on an unmodified document), with
  `GitConfigSection` / `GitConfigEntry` / `GitConfigInclude` /
  `GitConfigDiagnostic` and the typed `GitConfigParseError` /
  `GitConfigEditError`. Semantics are **git-config, not generic INI**:
  case-insensitive section/key names, case-SENSITIVE quoted subsections, the
  deprecated `[a.b]` dotted form, multi-valued keys (`getAll`/`append`), the
  bare-`key` boolean shorthand, quoting/escapes/continuations, and
  `include`/`includeIf` surfaced by `includes()` but never resolved. Edits
  (`set`/`append`/`unset`/`unsetAll`/`addSection`/`removeSection`/
  `renameSection`) are text splices + re-parse, so git's own formatting
  survives. Malformed INPUT fails typed; a hand-built `GitConfig.make` over
  unparseable text dies as a defect.
- **`Gitmodules`** — the typed `.gitmodules` view over it: `GitmodulesEntry`
  (`name`/`path`/`url` plus optional `branch`/`shallow`/`update`/`ignore`/
  `fetchRecurseSubmodules`), `fromConfigResult`/`parseResult`/`parse`, the
  `FromString` codec, canonical `stringify`, and entry-level mutation statics
  (`setUrl`/`setPath`/`setBranch`/`setShallow`/`add`/`remove`/`rename`) that
  compile into `GitConfig`'s surgical edits, so a mutated `.gitmodules` keeps
  its formatting. `update` stays a raw string deliberately (git accepts
  `!command` values).

## The redaction policy — argv never leaks a secret

Every `GitCommand` constructor returns a `GitInvocation`: the spawnable command
**plus `redactedArgs`**, the same argv with every sensitive positional masked.
The mask lives on the pure constructor because that is the one place that knows
which positionals are sensitive:

- `configSet`'s value is masked wholesale as `<redacted>` (a config value can
  be a secret).
- URL positionals (`fetch`, `fetchUnshallow`, `lsRemote`, `push`, `pull`,
  `submoduleAdd`, `submoduleSetUrl`, `remoteAdd`, `remoteSetUrl`) keep
  everything **but** an embedded `userinfo@` credential — a plain remote name
  or credential-free URL passes through untouched. The mask is greedy through
  the LAST `@` before the first path slash, so a password containing a literal
  `@` is masked whole.

Only `redactedArgs` is persisted into `GitCommandError.args`, and `message`
renders that redacted vector — **raw argv never survives into an error value**,
including a pre-spawn guard refusal. The second half of the policy: span
annotations carry stable identifiers only (`cwd`, refs, keys, paths, remote
names), never config values and never URLs. A constructor with no sensitive
positional produces element-wise identical raw and redacted argvs.

## Usage

Composing several read methods into a domain diff, mapping the typed errors
onto a caller's own error type:

```ts
import type { GitCommandError, GitShape, NotARepositoryError, UnknownRefError } from "@effected/git";
import { Git } from "@effected/git";
import { Effect, Option } from "effect";

type GitFailure = GitCommandError | NotARepositoryError | UnknownRefError;
const toDiffError =
 (command: string, cwd: string) =>
 (e: GitFailure): DiffError =>
  new DiffError({ command, cwd, reason: e.message });

// Narrow the dependency to exactly the reads this function needs.
type GitReads = Pick<GitShape, "defaultBranch" | "mergeBase" | "nameStatus" | "untrackedFiles">;

const diffAgainstBase = (git: GitReads, cwd: string, explicitBase?: string) =>
 Effect.gen(function* () {
  const base = explicitBase ?? (yield* git.defaultBranch(cwd)).pipe(Option.getOrElse(() => "main"));
  const mergeBaseSha = yield* git.mergeBase(cwd, base, "HEAD").pipe(Effect.mapError(toDiffError("merge-base", cwd)));
  const changed = yield* git
   .nameStatus(cwd, { base: mergeBaseSha })
   .pipe(Effect.mapError(toDiffError("diff --name-status", cwd)));
  const untracked = yield* git.untrackedFiles(cwd).pipe(Effect.mapError(toDiffError("ls-files", cwd)));
  return { mergeBaseSha, changed, untracked };
 });
```

Branching on the new typed errors — the whole reason they exist is that a
consumer branches on them, so publish-with-retry reads as a `catchTag`:

```ts
import { Git } from "@effected/git";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";

const publish = (cwd: string) =>
 Effect.gen(function* () {
  const git = yield* Git;
  yield* git.commit(cwd, "chore: release", { all: true });
  yield* git.push(cwd, { forceWithLease: true }).pipe(
   // A moved remote (or a failed --force-with-lease lease) is typed, not stringly.
   Effect.catchTag("NonFastForwardError", () =>
    Effect.gen(function* () {
     yield* git.pull(cwd, { rebase: true });
     yield* git.push(cwd, { forceWithLease: true });
    }),
   ),
  );
 }).pipe(Effect.provide(Git.layer), Effect.provide(NodeServices.layer));
```

Resolving `Git` once and re-injecting it as a fixed value keeps a dependent
service's own layer's `R` free of `ChildProcessSpawner` — the platform
requirement stays discharged exactly once, at the outermost edge:

```ts
import { Git } from "@effected/git";
import { Context, Effect, Layer } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";

class Diff extends Context.Service<Diff, { readonly run: (cwd: string) => Effect.Effect<string> }>()("Diff") {}

const DiffLive: Layer.Layer<Diff, never, ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
 Diff,
 Effect.gen(function* () {
  const git = yield* Git;
  return { run: (cwd: string) => git.revParse(cwd, "HEAD").pipe(Effect.orElseSucceed(() => "unknown")) };
 }),
).pipe(Layer.provide(Git.layer));
```

## Testing machinery

**`Git.makeTest(overrides?)` / `Git.layerTest(overrides?)` are shipped.** Every
member a test did not stub **dies** naming itself (`Git.makeTest: show() was
called but not stubbed`) — no member here has an honest default, and a
fabricated answer would leak into consumer logic as fact. Stub only what the
test exercises; hand-enumerating the whole `GitShape` breaks on every growth of
the service.

```ts
const TestGit = Git.layerTest({ revParse: () => Effect.succeed("abc123") });
```

Mock the spawner instead only when the thing under test is the argv or the
classification: `Layer.succeed(ChildProcessSpawner.ChildProcessSpawner,
ChildProcessSpawner.make(mockSpawn))` with `ChildProcessSpawner.makeHandle({...})`
over in-memory streams (`effect/unstable/process`). For a consumer service that
reads only a few methods, faking the narrowed `Pick<GitShape, ...>` type via
`Layer.succeed` is less surface still.

## Gotchas

- Every ref/range argument is validated before any spawn — a value starting
  with `-` fails typed rather than being parsed as a git flag. The `GitCommand`
  constructors do NOT validate; only the `Git` service does.
- Every mutating method is unsafe to run concurrently with other work in the
  same `cwd`; nothing serializes it.
- stderr classification is unanchored substring matching over `LC_ALL=C`
  phrases — a path containing such a phrase could misclassify; accepted
  trade-off, do not "fix" it.
- `mergeBase`/`changedFiles` report `UnknownRefError.ref` as the `"a...b"`
  range label, not an individual ref.
- `NameStatusEntry.status`/`StatusEntry` use this package's own decoded
  vocabulary (`"typeChanged"`, `"broken"`), not git porcelain's spelling
  (`"typechange"`).
- `StatusEntry.toLine()` renders a rename/copy entry's NEW path only (a
  deliberate divergence from git's `orig -> new`); opt into git's form with
  `{ renames: "arrow" }`. No C-quoting of special-character paths — machine
  parsers should consume the decoded entries.
- `fetchAny` discards the tag attempt's failure when both attempts fail — only
  the plain fetch's error surfaces.
- `submoduleStatus` is the one path-emitting parser with no `-z` mode to lean
  on (git offers none), so a path containing a newline corrupts it — a recorded
  git-imposed limitation.

## Git behavior these members were probed against (git 2.54)

Facts that decide what a classifier or a test must match. All four cost a probe
to establish; do not re-derive them from git's documentation, which does not say
any of them plainly.

- **A modern push rejection says `fetch first`, NOT `non-fast-forward`.** git's
  remote-moved wording changed; a classifier matching only the classic phrase
  silently misses the common case. Match `[rejected]` plus any of
  `non-fast-forward` / `fetch first` / `stale info` (the last is
  `--force-with-lease`'s lease failure).
- **Merge-conflict text lands on STDOUT** for a merge-mode `pull` and for
  `stash pop`/`stash apply` (`CONFLICT (`, `Automatic merge failed`). Only a
  **rebase**-mode pull's `could not apply` goes to stderr. A classifier reading
  stderr alone sees a bare non-zero exit and reports nothing useful.
- **`git check-ignore -z` requires `--stdin`** — git rejects `-z` without it,
  and the non-`-z` output C-quotes special-character paths. The NUL form is
  therefore the only fully robust shape, and it takes its paths on stdin.
- **`git check-ignore` exits 1 silently when NO path is ignored.** That is an
  empty answer, not a failure — the same shape `git config --get` uses for an
  unset key, so both classify as absence rather than error.
