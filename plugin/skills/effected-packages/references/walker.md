# @effected/walker

Directory-chain traversal in both directions: `Walker.ascend` climbs toward the filesystem root returning the first candidate satisfying a predicate; `descend` (round 3) expands a compiled glob pattern DOWNWARD against a real directory tree. The kit's one absorbing traversal loop — `config-file`, `xdg` and `workspaces` all build on the upward half. Boundary tier: peers on `effect` and, since round 3, `@effected/glob` (for `descend`'s `GlobPattern` input); `FileSystem`/`Path` arrive through `R` from the consumer's platform layer.

## Import

```ts
import { Walker, descend } from "@effected/walker";
import type { DescendError, DescendOptions } from "@effected/walker";
```

Single entrypoint; no subpaths. Note `descend` is a top-level named export sitting ALONGSIDE `Walker`, not a static on it — the package's own `index.d.ts` re-export line is `export { type AscendOptions, DescendError, type DescendOptions, Walker, descend };`.

**Platform**: `ascend` needs only `Path` (core ships a POSIX `Path.layer`); anything touching the filesystem (`findUpward`, an `fs.exists` predicate, `descend`) needs `FileSystem` at the edge — `@effect/platform-node`'s `NodeFileSystem.layer` + `NodePath.layer`, or `@effect/platform-bun`.

## Core API

- **`Walker.ascend(start, options?: { stopAt?, maxDepth? })`** — each directory from `start` to the root, nearest first: `Effect<ReadonlyArray<string>, never, Path.Path>`. `start` is required; the walker never reads `process.cwd()` itself.
- **`Walker.firstMatch(candidates, predicate)`** — the single primitive: first candidate whose `Effect<boolean, E, R>` predicate is true; per-candidate failures are absorbed, defects propagate. `Effect<Option<string>, never, R>`.
- **`Walker.findUpward(dirs, candidatesFor)`** — flattens candidates directory-major, then `firstMatch(..., fs.exists)`.
- **`Walker.findRoot(dirs, isRoot)`** — marker-based root detection.
- **`descend(pattern: GlobPattern, options: DescendOptions)`** → `Effect<ReadonlyArray<string>, DescendError, FileSystem.FileSystem | Path.Path>` — expand a COMPILED `@effected/glob` `GlobPattern` (from `GlobPattern.compile`) against the real filesystem, returning matching FILE paths relative to `cwd` (POSIX separators), sorted. A literal pattern (no magic, not negated) fast-paths to a single stat: `[source]` if it resolves to a file, `[]` otherwise. A magic pattern walks from `GlobPattern.enumerationPrefix` (its longest literal directory prefix); a NEGATED pattern walks from `cwd` itself (its matches can land outside the inner pattern's prefix); a missing base directory, a pattern that climbs above `cwd` via `..` segments, or zero matches is an empty result, never an error. Only FILES match — a symlink counts when it stat-resolves to a file, a symlinked directory is never descended into (cycle safety via a `readLink` probe), a dangling symlink is not a match. `DescendOptions`: `cwd` (required, absolute — `descend` never reads `process.cwd()` either), `maxDepth?` (default `256`, hard cap below the pattern's literal prefix), `prune?` (directory names never descended into; default `["node_modules", ".git"]` — a custom list REPLACES the default, it does not merge), `onUnreadable?: "fail" | "skip"` (default `"fail"` — an unreadable directory mid-walk fails typed rather than silently under-reporting; `"skip"` absorbs it and continues).
- **`DescendError`** — tagged struct: `pattern` (the glob's source text), `reason: "unreadableDirectory" | "depthExceeded"`, `path` (the offending directory, relative to `cwd`; `""` is the walk's base), `limit?` (the depth cap, present only when `reason` is `"depthExceeded"`).

## Usage

```ts
import { Walker } from "@effected/walker";
import { Effect, FileSystem, Path } from "effect";

const findRepoRoot = Effect.gen(function* () {
  const dirs = yield* Walker.ascend(process.cwd());
  return yield* Walker.findRoot(dirs, (dir) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.exists(`${dir}/.git`);
    }),
  );
});
```

Compiling a glob once and expanding it downward with `descend` — the shape every consumer materializing a glob against disk reaches for, folding the one remaining typed failure (a depth-cap trip; an uncompilable pattern is handled separately) into a domain error rather than leaking `DescendError`:

```ts
import type { DescendError } from "@effected/walker";
import { descend } from "@effected/walker";
import { GlobPattern } from "@effected/glob";
import { Effect, FileSystem, Option, Path, Schema } from "effect";

class InvalidGlobError extends Schema.TaggedErrorClass<InvalidGlobError>()("InvalidGlobError", {
  glob: Schema.String,
  reason: Schema.String,
}) {}

const materializeGlob = (
  source: string,
  cwd: string,
): Effect.Effect<ReadonlyArray<string>, InvalidGlobError, FileSystem.FileSystem | Path.Path> =>
  Effect.option(GlobPattern.compile(source)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed<ReadonlyArray<string>>([]), // uncompilable pattern → no matches
        onSome: (pattern) =>
          descend(pattern, { cwd, onUnreadable: "skip" }).pipe(
            Effect.mapError(
              (error: DescendError) => new InvalidGlobError({ glob: source, reason: error.message }),
            ),
          ),
      }),
    ),
  );
```

## Testing machinery

None exported — none needed: test with core's `Path.layer` (POSIX, built into `effect`) and `FileSystem.layerNoop({ exists, ... })`. No platform package required in tests.

## Gotchas

- `ascend` is lexical, not physical — symlinks are not resolved; ascending out of a symlinked directory follows the path you gave it.
- A non-positive-integer `maxDepth` (0, `NaN`, `2.5`) is a defect, not a silent empty result — true for both `ascend` and `descend`.
- `findUpward` is directory-major: every candidate in the nearest directory is exhausted before ascending — a distant ancestor's marker can never beat a nearer directory's.
- Every `ascend`/`findUpward`/`findRoot` error channel is `never`: not-found and cannot-look (`EACCES`) are indistinguishable by design; discovery is best-effort. `descend` is the one surface with a real typed error — depth exhaustion is a typed failure, never a silent truncation, because silently truncating would silently change which files match.
- `descend`'s traversal is an explicit worklist (a queue dequeued by head index), never true recursion — it cannot stack-overflow no matter how wide or deep the tree.
- A directory that vanishes between its parent's listing and its own read (a benign race) reads as empty, not an error.
- `descend` takes a COMPILED `GlobPattern`, not a source string — compile once (`GlobPattern.compile`) and reuse it when descending the same pattern repeatedly; a raw string reach for `descend` doesn't exist, unlike some of `@effected/glob`'s own APIs that accept either.
