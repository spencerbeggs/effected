---
status: current
module: effected
category: architecture
created: 2026-07-14
updated: 2026-07-14
last-synced: 2026-07-14
completeness: 80
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../roadmap.md
  - commands.md
  - workspaces.md
  - glob.md
---

# @effected/git design

## Overview

Target design for `@effected/git`, a **boundary-tier** package created by the point-in-time workstream (2026-07-14) and on the `0.1.0` gate. It is typed git introspection for the kit: read a repository's state — file contents at a ref, tree listings, merge bases, changed paths — without checking anything out, plus exactly one mutating operation, `checkout`. It is built on [`@effected/commands`](commands.md)' `CommandRunner` seam and is the foundation `@effected/workspaces`' `ChangeDetector` and new `WorkspaceSnapshots` service stand on.

Scope is closed by its two consumers — workspaces, and savvy-web/systems' dependency-regeneration engine — not by git's porcelain. There are no ambitions toward a general git client; an operation earns a method here when a consumer needs it typed.

Names and exact signatures below are design-level; they are confirmed at the effect-v4-planning gate when implementation starts, verified against the installed `effect` beta.

## Origin: GitReader dissolves

`@effected/workspaces` v1 shipped `GitReader` — a subprocess seam contract (`run(cwd, args)`, `available(cwd)`) with a `layerNode` default over `node:child_process.execFile` — because core declares a `ChildProcessSpawner` it implements for no runtime, and taking `@effect/platform-node` would have made workspaces tier 3 for every consumer ([workspaces.md](workspaces.md#gitreader--the-subprocess-seam)). The seam was right; its location and flavor were provisional, and the point-in-time workstream is what exposed both:

1. **The spawning half is not git-specific.** `run(cwd, args)` is a subprocess runner wearing a git name. It generalizes into `CommandRunner` in [`@effected/commands`](commands.md), where the two hard-won `layerNode` details — locale-pinned env (`LC_ALL=C`) and the per-command timeout — survive as runner capabilities that git *configures* rather than owns.
2. **The git half deserves real types, not raw strings.** Both consumers were about to interpret git output and exit codes themselves: workspaces' snapshot reader needs "file at ref, or none", and systems' DepsRegen today hand-rolls `git merge-base` and `git ls-tree` through `execFileSync` next to its engine. Interpreting git — the exit-code and stderr taxonomy, the absent-vs-error distinction, tree-entry parsing — is a concern that should exist **once**, typed, in a package named for it.

So `GitReader` dissolves: the mechanism goes down into commands, the meaning comes here, and workspaces re-targets. **Now is the only cheap time.** Nothing publishes before the kit ships together at `0.1.0`, so this relocation is a refactor commit — the same reasoning that timed the runtimes rename and the walker extraction ([runtimes.md](runtimes.md#the-runtimes-rename), [walker.md](walker.md#consumer-impact-the-config-file-refactor)). After `0.1.0` it would be a breaking release across two packages.

## Tier and dependencies

**Boundary tier**, argued against the [dependency policy](../effect-standards.md#dependency-policy):

- **R1** — `peerDependencies: { effect: "catalog:effect" }`; the only `@effected` edge is `@effected/commands` (`workspace:*`, declared in both `devDependencies` and `peerDependencies` per the walker precedent). **No external runtime dependencies**, and no `node:` built-ins anywhere in this package — spawning is entirely behind the commands seam.
- **R3** — `@effected/commands` is boundary, and boundary does not propagate; git stays tier 2. Its own IO (running git) is discharged by the consumer choosing a `CommandRunner` layer at the edge.
- **R4** — tier follows this package's own surface: it performs IO through the seam, which is boundary; it takes nothing tier 3, so R2 never fires.

## Public surface

### `GitCommand` — pure, inspectable invocations

A git-flavored extension of the commands `Command` model: constructors that know the `git` executable, the argument conventions of each operation, and the environment git needs pinned (`LC_ALL=C`, so stderr classification is locale-stable). `GitCommand.show(ref, path)`, `GitCommand.lsTree(ref)`, `GitCommand.mergeBase(a, b)` and the rest produce **values** — a test can assert the exact argv an operation will run without spawning anything, and a consumer can log or display an invocation before executing it.

### `Git` — the service

A `Context.Service` whose layer requires `CommandRunner`. Every method takes `cwd` explicitly — the same "never read `process.cwd()` silently" rule walker set; the caller who knows where "here" is passes it in.

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

## Errors: classification happens once

The design rule: **no consumer of this package ever string-matches stderr.** Git's failure modes are classified here, once, into a small typed taxonomy:

- **`GitCommandError`** — subprocess mechanics: git ran and failed in a way that is not one of the recognized domain cases. Carries `args`, `cwd`, `exitCode`, `stderr` (the same fields workspaces' v1 `GitCommandError` carries — the name and shape relocate with the seam).
- **`NotARepositoryError`** — the cwd is not inside a git work tree. Every consumer wants to branch on this (systems degrades, workspaces fails discovery), so it is a distinct tag, not a `GitCommandError` the caller regex-matches.
- **`UnknownRefError`** — the ref does not resolve. Distinct because "diff against a base branch that does not exist locally" is an actionable, user-facing condition, not mechanics.

And one **non-error**: a path absent at a valid ref is `Option.none` from `show` (and simply missing from `lsTree` output). The v3 point-in-time reader's correctness leaned on this — absent paths degrade, never raise — and the snapshot diffing built on top inherits it from the type rather than from prose.

The classification uses git's documented exit codes plus the locale-pinned stderr shapes, which is exactly why `LC_ALL=C` is pinned in `GitCommand`'s env: classification against localized stderr is a latent bug, and the pin makes the recognized shapes stable.

## Module layout

```text
packages/git/
  src/
    GitCommand.ts   # the pure invocation constructors
    Git.ts          # Git service + layer, the error taxonomy, output parsers
    index.ts        # public surface, re-exports only
  __test__/
    Git.test.ts             # semantics over a mocked CommandRunner
    integration/Git.int.test.ts  # against a real fixture repository
```

Output parsing (`lsTree` entries, SHA validation) lives with the service in `Git.ts` unless it grows enough to earn an `internal/` module — small enough that a single concept module is the honest shape, per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept).

## Observability

Named spans on the public fallible boundaries — each `Git` method — annotated with stable identifiers (`cwd`, `ref`), never file contents. No logging, no metrics; telemetry-agnostic per the [observability standard](../effect-standards.md#observability-standards).

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in `__test__/`.

- **Unit: `Git` over a mocked `CommandRunner`** (`Layer.succeed`), pinning the classification boundary — the highest-value tests in the package:
  - `show` on a path absent at a valid ref yields `Option.none`, not an error;
  - a not-a-repository failure yields `NotARepositoryError`, not `GitCommandError`;
  - an unresolvable ref yields `UnknownRefError`;
  - an unrecognized failure falls through to `GitCommandError` with `exitCode`/`stderr` intact.
- **Unit: `GitCommand` constructors** — exact argv and env assertions, no spawning.
- **Integration: a fixture repository** built in test setup (`git init`, commits, refs, a file deleted between two commits), driven through the real `layerNode` runner: `show` at two refs, `lsTree` filtered by a compiled glob set, `mergeBase` on a branched history, `changedFiles` across a known range, `refExists` both ways, and `checkout` — isolated in its own temp-dir fixture, since it mutates.
- Consumers mock at whichever seam fits: `Layer.succeed(Git, …)` for domain tests (workspaces' change-detection tests keep needing no repository), or a mocked `CommandRunner` to exercise git's own classification.

## Consumers

- **`@effected/workspaces`** — `ChangeDetector` re-targets `Git.changedFiles`; the new `WorkspaceSnapshots` service reads refs through `show`/`lsTree`/`refExists` ([workspaces.md](workspaces.md)). The `GitReader` contract, its `layerNode` and `GitCommandError` leave workspaces in the same commit this package lands.
- **savvy-web/systems `DepsRegen`** — replaces its hand-rolled synchronous `execFileSync` helpers (`gitMergeBase`, `gitListChangesetFilesAtRef`) with `mergeBase` and `lsTree`, gaining typed errors and testability without a real repository.
