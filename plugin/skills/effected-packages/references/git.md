# @effected/git

Typed git introspection over core's `ChildProcessSpawner`: a read tier (18 methods) that reads a repository's state at any ref without checking it out, plus a clearly-marked mutating tier (8 methods: `checkout`, `fetch`, `fetchAny`, `submoduleUpdate`, `submoduleAdd`, `sparseCheckoutSet`, `configSet`, `add`) that changes it — nothing serializes concurrent access, so a caller running two mutating calls (or a mutating call alongside a read) against the same `cwd` owns the race. Boundary tier: peers only on `effect`, zero runtime deps, zero `node:` imports — the spawner is required in `R` and discharged once by the consumer's platform layer.

## Import

```ts
import { Git, GitCommand } from "@effected/git";
import type { GitShape } from "@effected/git";
```

Single entrypoint; no subpaths.

**Platform**: provide `ChildProcessSpawner` once at the edge — `@effect/platform-node`'s `NodeServices.layer` (or `@effect/platform-bun`'s equivalent), as in the example below.

## Core API

- **`Git`** — `Context.Service`; `Git.layer` resolves `ChildProcessSpawner` at construction so every method's `R` is `never`. Every method takes `cwd` explicitly; every failure is one of the three typed errors below or a documented non-error degradation (`Option.none()`, `false`).

### Read tier (never fails `UnknownRefError` unless noted; `R = never`)

| Method | Signature | Result | Notes |
| --- | --- | --- | --- |
| `show` | `(cwd, ref, path)` | `Option<string>` | absent-at-ref is `None`, never an error |
| `lsTree` | `(cwd, ref, { pathspec? })` | `LsTreeEntry[]` | recursive, NUL-safe parsing |
| `refExists` | `(cwd, ref)` | `boolean` | unresolvable OR unknown-syntax ref is `false`, never an error |
| `mergeBase` | `(cwd, a, b)` | `string` (SHA) | `UnknownRefError.ref` carries the `"a...b"` range, not one side |
| `changedFiles` | `(cwd, { base, head, relative? })` | `string[]` | committed-range diff |
| `workingChanges` | `(cwd, { relative? })` | `string[]` | deduplicated union of unstaged + staged + untracked; no ref, so never `UnknownRefError` |
| `unstagedChanges` | `(cwd, { relative? })` | `string[]` | |
| `stagedChanges` | `(cwd, { relative? })` | `string[]` | `--cached` |
| `untrackedFiles` | `(cwd, { relative? })` | `string[]` | `relative: false` adds `--full-name` to share `workingChanges`' repo-root base |
| `revParse` | `(cwd, ref)` | `string` (SHA) | |
| `nameStatus` | `(cwd, { base, head?, relative? })` | `NameStatusEntry[]` | `head` omitted diffs the working tree against `base` |
| `status` | `(cwd)` | `StatusEntry[]` | `git status --porcelain -z` |
| `defaultBranch` | `(cwd, { remote? })` | `Option<string>` | `None` when `origin/HEAD` is unset |
| `currentBranch` | `(cwd)` | `Option<string>` | `None` on detached `HEAD` (never the literal string `"HEAD"`) |
| `repoRoot` | `(cwd)` | `string` | absolute path |
| `configGet` | `(cwd, key)` | `Option<string>` | `None` when unset |
| `remoteUrl` | `(cwd, { remote? })` | `Option<string>` | `None` when the remote doesn't exist |
| `commitInfo` | `(cwd, ref?)` | `CommitInfo` | sha / signature verdict / raw untrimmed message; `ref` defaults to `HEAD` |

### Mutating tier — nothing serializes concurrent access to the same `cwd`

| Method | Signature | Notes |
| --- | --- | --- |
| `checkout` | `(cwd, ref, { detach? })` | moves the working tree (and `HEAD`, for a branch ref) |
| `fetch` | `(cwd, { ref, remote?, depth?, tag? })` | an unknown-on-remote `ref` is typed `UnknownRefError` |
| `fetchAny` | `(cwd, { ref, remote?, depth? })` | tries the tag form first; on `UnknownRefError` or any `GitCommandError` retries the plain form. `NotARepositoryError` from the tag attempt propagates immediately (a plain fetch would fail identically); if both fail, the PLAIN fetch's error surfaces |
| `submoduleUpdate` | `(cwd, { init?, depth?, paths? })` | |
| `submoduleAdd` | `(cwd, { url, path, depth? })` | registers + clones a new submodule |
| `sparseCheckoutSet` | `(cwd, patterns, { cone })` | |
| `configSet` | `(cwd, key, value, { file? })` | `key`/`value`/`file` are ALL guarded against a leading `-` (config has no `--` separator) |
| `add` | `(cwd, paths)` | stages for the next commit |

- **`GitShape`** — the exported interface behind `Git`'s tag. Two uses beyond the obvious: `Pick<GitShape, "mergeBase" | "nameStatus" | ...>` narrows a downstream service's dependency to exactly the methods it reads (documents intent, and lets a test double implement fewer methods); `Layer.succeed(Git, fake)` accepts any `GitShape`-shaped object as a full test double, no real repository needed.
- **`GitCommand`** — 24 pure, `cwd`-less constructors returning core `ChildProcess.StandardCommand` values, inspectable without spawning. (`workingChanges` and `fetchAny` are `Git` methods with no matching `GitCommand` constructor — each composes other constructors' commands rather than adding its own.)
- **Errors** — `GitCommandError` (carries `args`/`cwd`/`exitCode`/`stderr`/optional `detail` for an absorbed spawn failure or timeout), `NotARepositoryError` (`cwd`), `UnknownRefError` (`ref`, `cwd`).

## Usage

Composing several read methods into a domain diff, mapping the typed errors onto a caller's own error type:

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

A mutating-tier lifecycle — vendor a new dependency into the working tree by URL, shallow and sparse:

```ts
import { Git } from "@effected/git";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";

const vendor = (cwd: string, url: string, path: string, ref: string, sparse?: ReadonlyArray<string>) =>
 Effect.gen(function* () {
  const git = yield* Git;
  yield* git.submoduleAdd(cwd, { url, path, depth: 1 });
  yield* git.configSet(cwd, `submodule.${path}.shallow`, "true", { file: ".gitmodules" });
  // fetchAny covers both a branch and a tag ref without the caller knowing which.
  yield* git.fetchAny(`${cwd}/${path}`, { ref, depth: 1 });
  yield* git.checkout(`${cwd}/${path}`, "FETCH_HEAD", { detach: true });
  if (sparse?.length) yield* git.sparseCheckoutSet(`${cwd}/${path}`, sparse, { cone: false });
  yield* git.add(cwd, [".gitmodules", path]);
 }).pipe(Effect.provide(Git.layer), Effect.provide(NodeServices.layer));
```

Resolving `Git` once and re-injecting it as a fixed value keeps a dependent service's own layer's `R` free of `ChildProcessSpawner` — the platform requirement stays discharged exactly once, at the outermost edge:

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

None exported — mock the spawner from core instead: `Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(mockSpawn))` with `ChildProcessSpawner.makeHandle({...})` over in-memory streams (`effect/unstable/process`). No real git repo needed. For a consumer service that only reads a few `Git` methods, prefer faking the narrowed `Pick<GitShape, ...>` type directly via `Layer.succeed` over mocking the spawner — less surface to implement.

## Gotchas

- Every ref/range argument is validated before any spawn — a value starting with `-` fails typed rather than being parsed as a git flag. The `GitCommand` constructors do NOT validate; only the `Git` service does.
- `checkout` (and every mutating method) is not safe to run concurrently with other work in the same `cwd`; nothing serializes it.
- stderr classification is unanchored substring matching over `LC_ALL=C` phrases — a path containing such a phrase could misclassify; accepted trade-off.
- `mergeBase`/`changedFiles` report `UnknownRefError.ref` as the `"a...b"` range label, not an individual ref.
- `NameStatusEntry.status`/`StatusEntry` use this package's own decoded vocabulary (`"typeChanged"`, `"broken"`), not git porcelain's spelling (`"typechange"`) — translate if mapping onto an existing enum that follows porcelain naming.
- `fetchAny` discards the tag attempt's failure when both attempts fail — only the plain fetch's error surfaces.
