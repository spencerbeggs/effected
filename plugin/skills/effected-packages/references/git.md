# @effected/git

Typed git introspection over core's `ChildProcessSpawner`: a read tier that reads a repository's state at any ref without checking it out, plus a clearly-marked mutating tier (`checkout`, `fetch`, `submoduleUpdate`, `submoduleAdd`, `sparseCheckoutSet`, `configSet`, `add`) that changes it — nothing serializes concurrent access, so a caller running two mutating calls (or a mutating call alongside a read) against the same `cwd` owns the race. Boundary tier: peers only on `effect`, zero runtime deps, zero `node:` imports — the spawner is required in `R` and discharged once by the consumer's platform layer.

## Import

```ts
import { Git, GitCommand } from "@effected/git";
```

Single entrypoint; no subpaths.

**Platform**: provide `ChildProcessSpawner` once at the edge — `@effect/platform-node`'s `NodeServices.layer` (or `@effect/platform-bun`'s equivalent), as in the example below.

## Core API

- **`Git`** — `Context.Service`; `Git.layer` resolves `ChildProcessSpawner` at construction so every method's `R` is `never`:
  - `show(cwd, ref, path)` → `Effect<Option<string>, GitCommandError | NotARepositoryError>` — absent-at-ref is `Option.none()`, never an error.
  - `lsTree(cwd, ref)` → `LsTreeEntry[]` (mode/type/oid/path, NUL-safe parsing).
  - `refExists(cwd, ref)` → `boolean` — a non-resolving ref is `false`, never an error.
  - `mergeBase(cwd, a, b)` → SHA (`UnknownRefError` when the range fails).
  - `changedFiles(cwd, { base, head, relative? })` — committed-range diff.
  - `workingChanges(cwd, { relative? })` — deduplicated unstaged + staged + untracked.
  - `revParse(cwd, ref)` → normalized SHA.
  - `checkout(cwd, ref)`, `fetch`, `submoduleUpdate`, `submoduleAdd`, `sparseCheckoutSet`, `configSet`, `add` — the mutating tier; caller owns serialization against the same `cwd`.
- **`GitCommand`** — 24 pure constructors returning core `ChildProcess.StandardCommand` values, inspectable without spawning.
- **Errors** — `GitCommandError` (carries `args`/`cwd`/`exitCode`/`stderr`), `NotARepositoryError`, `UnknownRefError`.

## Usage

```ts
import { Git } from "@effected/git";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";

const program = Effect.gen(function* () {
 const git = yield* Git;
 const manifest = yield* git.show("/repo", "HEAD", "package.json");
 const changed = yield* git.changedFiles("/repo", { base: "main", head: "HEAD", relative: true });
 return { manifest, changed };
}).pipe(Effect.provide(Git.layer), Effect.provide(NodeServices.layer));
```

## Testing machinery

None exported — mock the spawner from core instead: `Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(mockSpawn))` with `ChildProcessSpawner.makeHandle({...})` over in-memory streams (`effect/unstable/process`). No real git repo needed.

## Gotchas

- Every ref/range argument is validated before any spawn — a value starting with `-` fails typed rather than being parsed as a git flag. The `GitCommand` constructors do NOT validate; only the `Git` service does.
- `checkout` is not safe to run concurrently with other work in the same `cwd`; nothing serializes it.
- stderr classification is unanchored substring matching over `LC_ALL=C` phrases — a path containing such a phrase could misclassify; accepted trade-off.
- `mergeBase`/`changedFiles` report `UnknownRefError.ref` as the `"a...b"` range label, not an individual ref.
