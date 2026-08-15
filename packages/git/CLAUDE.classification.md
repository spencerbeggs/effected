# Error classification — @effected/git

The full `classify` matrix, the `ClassifyKind` gates and the success-value degradations. Every `Git` method funnels through the private `classify` step in `Git.ts`; nothing else in the package inspects `stderr`, `stdout` or `exitCode`.

**Parent:** [@effected/git context](./CLAUDE.md)

## The matrix

`classify` takes a `ClassifyKind` (`"show" | "refExists" | "quiet" | "noSuchRemote" | "push" | "merge" | "generic"`) that gates which method-specific rows apply on top of the shared taxonomy:

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

## What each kind buys

`"couldn't find remote ref"` was added to `UNKNOWN_REF_PATTERNS` for the mutating tier's ref-fetching operations. It classifies as `UnknownRefError` for every method reaching `classify`, but in practice only `fetch`, `submoduleUpdate` and `submoduleAdd` produce it — the typed signal a tag-then-branch fetch fallback (`Effect.catchTag`) branches on.

The `"push"` and `"merge"` kinds are "typed errors only where consumers branch" made structural. `"push"` backs only `push` (rejected-non-fast-forward, incl. the `--force-with-lease` `stale info` lease failure — probed against git 2.54, whose remote-moved wording is `fetch first`, NOT the classic `non-fast-forward`). `"merge"` backs only `pull`, `stashPop` and `stashApply` (`DirtyWorktreeError` before git touches anything, `MergeConflictError` once markers are written). The merge-conflict row is the ONE place `classify` reads STDOUT: git's merge machinery reports `CONFLICT (` / `Automatic merge failed` on stdout (probed for pull and stash pop alike), while a rebase-mode pull's `could not apply` lands on stderr. Because the rows are kind-gated, **no pre-existing member's error union changed** — `checkout` with dirty-worktree stderr still fails `GitCommandError`, pinned by a zero-churn regression test.

`"quiet"` backs `defaultBranch`, `configGet`, `configGetAll` (unset key → `[]`), `checkIgnore` (`git check-ignore` exits 1 silently when NO path is ignored → `[]`) and `mergeBaseOption` (no common ancestor — disjoint histories — is a silent exit 1 → `Option.none()`, probed against git 2.54; an unknown ref still exits 128 with an `UNKNOWN_REF_PATTERNS` stderr and stays `UnknownRefError`). `mergeBase` itself deliberately stays `"generic"` — the no-ancestor exit 1 fails LOUDLY there, the 0.7.0 contract installed consumers (`@savvy-web/silk-effects`) depend on; the one argv backs both members. Each runs with `--quiet` or relies on a silent exit 1 meaning "unset", so any exit-1 WITH stderr text is a real failure, not an absence. `"noSuchRemote"` backs `remoteUrl`: `git remote get-url` prints `"No such remote '<name>'"`, which degrades to `Option.none()` rather than `GitCommandError`.

## Degradations of a successful run

Two methods degrade a *successful* run's output rather than its exit code: `currentBranch` maps the literal answer `"HEAD"` (git's spelling of "detached") to `Option.none()` — a fake branch name would be worse than an honest absence — and `defaultBranch` strips the `<remote>/` prefix from `git symbolic-ref`'s short output.

`refExists` answering `false` for both an unrecognized-ref-syntax error (`unknownRef`) and a syntactically valid but missing ref (`refMissing`) was a review-caught Critical fix (`bd5e0101`): the method's contract is "does this resolve", and dying on an unknown ref broke that promise.

`mergeBase` and `changedFiles` — the two-ref methods — report `UnknownRefError` with `ref` set to the `"a...b"` range label, not either individual ref. A deliberate deviation from the single-ref methods' plain `ref` value.

## Absorption and the timeout

`PlatformError` and `Cause.TimeoutError` are **absorbed inside `runClassified`** — via `Effect.catch` and `Effect.timeoutOrElse` — and never escape a `Git` method. The `GIT_TIMEOUT` ceiling (`Duration.seconds(30)`) is owned by this package, not by the caller.

**Related:** [surface](./CLAUDE.surface.md) · [testing](./CLAUDE.testing.md)
