# @effected/walker

Directory-chain traversal in both directions: `Walker.ascend` climbs toward the filesystem root returning the first candidate satisfying a predicate; `descend` expands a compiled glob pattern DOWNWARD against a real directory tree, with `Effect` and synchronous drivers over one shared walk. The kit's one absorbing traversal loop — `config-file`, `xdg` and `workspaces` all build on the upward half. Boundary tier: peers on `effect` and `@effected/glob` (for `descend`'s `GlobPattern` input); `FileSystem`/`Path` arrive through `R` from the consumer's platform layer.

## Import

```ts
import { Walker, confineReal, confineRealSync, confineRelative, descend, descendEntries, descendEntriesSync, descendSync, relativeWithin, relativeWithinSync } from "@effected/walker";
import type { DescendEntry, DescendError, DescendOptions, DescendSyncOptions, UpwardMatches } from "@effected/walker";
import { nodeWalkerFileSystem, nodeWalkerPath, nodeWalkerSyncOps } from "@effected/walker/node-sync";
```

The root plus `./node-sync`, the only module importing `node:` (`node:fs`, `node:path`). `descend`, `descendEntries` and their sync forms are top-level named exports ALONGSIDE `Walker`, not statics on it.

**Platform**: `ascend` needs only `Path` (core ships a POSIX `Path.layer`); anything touching the filesystem (`ascendWithin`, `findUpward`, an `fs.exists` predicate, `descend`) needs `FileSystem` at the edge — `@effect/platform-node`'s `NodeFileSystem.layer` + `NodePath.layer`, or `@effect/platform-bun`. The sync forms take their platform as plain values in the options (`nodeWalkerSyncOps` from `./node-sync`) and need no Effect runtime.

## Core API

- **`Walker.ascend(start, options?: { stopAt?, maxDepth? })`** — each directory from `start` to the root, nearest first: `Effect<ReadonlyArray<string>, never, Path.Path>`. `start` is required; the walker never reads `process.cwd()` itself. `stopAt` is compared **lexically**, so it never matches a symlink-resolved ceiling from a start reached through a symlink (every macOS tmpdir, any symlinked checkout) and the walk runs silently to the root — never feed it `Git.repoRoot`'s answer.
- **`Walker.ascendWithin(start, ceiling: Option<string>, options?: { maxDepth? })`** — `Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path>`. The same lexical chain, stopped at the nearest ancestor whose `realPath` equals the ceiling's: the way to bound a walk by the git root. `Option.none()` ascends exactly as `ascend(start)`, so the whole recipe is `Walker.ascendWithin(start, yield* Effect.option(git.repoRoot(start)))`. A ceiling the chain already spells costs no I/O; an ancestor whose `realPath` fails is absorbed; a relative ceiling dies.
- **`Walker.ascendToMarker(start, markers, options?: { maxDepth? })`** — `Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path>`. The chain up to and including the nearest directory holding any of `markers` (entry names, any kind: a `.git` directory or a worktree's `.git` file). Probes stop at the hit, so nothing above it is touched — reach for it instead of `findRoot` over a full `ascend` when the hit is usually near. No marker anywhere runs to the root; a failed probe is absorbed; an empty `markers` list or an empty name dies.
- **`Walker.firstMatch(candidates, predicate)`** — the single primitive: first candidate whose `Effect<boolean, E, R>` predicate is true; per-candidate failures are absorbed, defects propagate. `Effect<Option<string>, never, R>`.
- **`Walker.findUpward(dirs, candidatesFor)`** — flattens candidates directory-major, then `firstMatch(..., fs.exists)`.
- **`Walker.findUpwardAll(dirs, candidatesFor)`** → `Effect<Option<UpwardMatches>, never, FileSystem.FileSystem>` — every existing candidate of the NEAREST directory that has any, as `{ dir, found }` (`found` non-empty, in candidate order). For a caller that must report an ambiguity (two config files in one directory) rather than have `findUpward` pick the first.
- **`Walker.findRoot(dirs, isRoot)`** — marker-based root detection.
- **Sync upward forms** — `Walker.ascendSync(start, { stopAt?, maxDepth?, path })`, `Walker.ascendWithinSync(start, ceiling, { maxDepth?, ...ops })`, `Walker.ascendToMarkerSync(start, markers, { maxDepth?, ...ops })`, `Walker.findUpwardSync(dirs, candidatesFor, ops)`, `Walker.findUpwardAllSync(dirs, candidatesFor, ops)`: the same machine as the `Effect` forms, returning plain `ReadonlyArray<string>` / `Option`, a defect THROWS. `ops` is `nodeWalkerSyncOps` from `./node-sync` (or a memfs handle's `sync` port plus `node:path`). Existence is the port's `stat` succeeding. There is no `firstMatchSync`/`findRootSync`: with a synchronous predicate that is `dirs.find(isRoot)`.
- **`descend(pattern: GlobPattern, options: DescendOptions)`** → `Effect<ReadonlyArray<string>, DescendError, FileSystem.FileSystem | Path.Path>` — expand a COMPILED `@effected/glob` `GlobPattern` (from `GlobPattern.compile`, or synchronously `GlobPattern.compileResult` — never `Schema.decodeSync(GlobPattern.FromString)`) against the real filesystem, returning matching FILE paths relative to `cwd` (POSIX separators), sorted. A path is answered in the spelling the pattern matched it under (`./src/*.ts` answers `./src/a.ts`). A literal pattern (no magic, no braces, not negated) fast-paths to a single stat: `[source]` if it resolves to a file, `[]` otherwise. A magic pattern walks **each of its `GlobPattern.enumerationRoots`**, reading every directory once however many brace alternatives spell it (`packages/{a,b}/src/*.ts` reads two directories, not all of `packages/`); a NEGATED pattern walks from `cwd` itself (its matches can land outside the inner pattern's prefix); a missing base directory, a pattern that climbs above `cwd` via `..` segments, or zero matches is an empty result, never an error. Only FILES match by default — a symlink counts when it stat-resolves to a file, a dangling symlink is not a match. **`match?: "file" | "directory" | "any"`** widens that: a directory matches by its RESOLVED kind (a link to a directory matches even when it is not entered, even pointing outside `cwd` — check it with `confineReal` before deleting through it), as an entry of its parent, so `prune`, a boundary or an unentered link withhold only what lies BELOW it (`**/{dist,node_modules}` under `match: "directory"` finds every `node_modules` without reading inside one); it is tested bare and with a trailing `/` (`dist/` matches, answered as spelled); `cwd` itself never matches. **Without `followSymlinks`, a symlinked directory is never entered (an `lstat` probe), and that includes the way down**: a walk base reached through a link, or a literal pattern whose path crosses a symlinked directory, is an empty result. `followSymlinks: true` follows links under `@actions/glob`'s `traversalChain` cycle guard — a directory is a cycle only when its real path is already an ancestor on its own branch, so loops terminate while two sibling links to one target both enumerate; a link whose `realPath` fails is never entered and follows `onUnreadable` (a `NotFound` stays silent). Under it the walk can leave `cwd` physically, as `@actions/glob` does. **`boundaries?: string[]`** names marker FILES (`["package.json"]`) that make a directory strictly below `cwd` a nested unit: it contributes nothing and is never descended. `cwd` itself is never a boundary, a DIRECTORY named like a marker does not count, and the rule is about where a file sits — a boundary between `cwd` and the walk base, or between `cwd` and a literal file, also answers zero matches. It is a downward exclusion, not `ascend`'s inclusive upward `stopAt`. `DescendOptions`: `cwd` (required, absolute — `descend` never reads `process.cwd()` either; a **relative `cwd`, the empty string included, is a defect** — the `Effect` forms die, the sync forms throw — and a **missing `cwd` (absent, a file, a dangling link) is an empty result** for every pattern in every mode, so check `cwd` yourself if "nothing to look in" must differ from "nothing matched"), `match?` (above), `boundaries?`, `followSymlinks?` (default `false`), `maxDepth?` (default `256`, hard cap below the pattern's literal prefix), `prune?` (directory names never descended into; default `["node_modules", ".git"]` — a custom list REPLACES the default, it does not merge; this, NOT `boundaries`, is how a walk skips `node_modules`), `onUnreadable?: "fail" | "skip"` (default `"fail"` — an unreadable directory mid-walk fails typed rather than silently under-reporting; `"skip"` absorbs it and continues). A third mode lives on the sibling `DescendRecordOptions` type, whose `onUnreadable: "record"` absorbs it too but selects an overload resolving to `DescendResult` — `{ matches, unreadable: ReadonlyArray<UnreadableDirectory> }`, each `UnreadableDirectory` carrying the `cwd`-relative `path` and the absorbed `PlatformError` as `cause`, so a caller reporting WHY never re-reads the directory; the walk base appears as `path: ""`, and a vanished (`NotFound`) directory is never recorded in any mode). Pass a literal `"record"` or a `DescendRecordOptions` value; `DescendOptions` itself does not admit it, which is what keeps the two overloads distinguishable.
- **`descendEntries(pattern, options)`** → `Effect<ReadonlyArray<DescendEntry>, DescendError, FileSystem | Path>` — the same walk, matches, order and errors, each match as `{ path, info }` with the `FileSystem.File.Info` the walk already read (links followed) — no extra syscall. The `"record"` overload resolves to `DescendEntriesResult` (`{ matches, unreadable }`). The building block for a cache signature over a tree: map `path` and `info.mtime`/`info.size` into your own key.
- **`descendSync(pattern, options)` / `descendEntriesSync(pattern, options)`** → `Result<…, DescendError>` — the same walk driven synchronously (it is one shared traversal, so every rule above holds identically) for a caller with no Effect runtime: config evaluation, a Node SEA sidecar. Options are `DescendSyncOptions` (every `DescendOptions` field plus `WalkerSyncOps`: `fileSystem: WalkerSyncFileSystem` — `readDirectory`, `stat`, `lstat`, `realPath`, each throwing node-shaped errors, `ENOENT` being the benign race — and `path: WalkerSyncPath` — `{ sep, join, dirname, resolve, isAbsolute }`, which `node:path` satisfies), or `DescendSyncRecordOptions` for `"record"`. Results are the shared types: `ReadonlyArray<string>`, `DescendResult<unknown>`, `ReadonlyArray<DescendEntry<WalkerSyncStats>>` (the entry field is **`info`**), `DescendEntriesResult<WalkerSyncStats, unknown>` — the cause type is `unknown` because the port throws whatever it throws. An invalid `maxDepth` throws. `./node-sync` supplies the real disk: `nodeWalkerFileSystem` (`readdirSync`/`statSync`/`lstatSync`/`realpathSync`), `nodeWalkerPath` (`node:path`'s `sep`/`join`/`dirname`/`resolve`/`isAbsolute`) and `nodeWalkerSyncOps` (both; spread it into the options). `@effected/memfs`'s `syncFileSystem` port satisfies `WalkerSyncFileSystem` in tests.
- **`confineRelativeResult(base, candidate)`** → `Result<string, PathEscapeError>`, and its `Effect` twin **`confineRelative`** — confine an untrusted relative path (archive entry, manifest asset path) to `base` before touching the filesystem. Lexical, IO-free, needs no service. `/` and `\` are both separators on every platform; refuses `reason: "nulByte"`, `"absolute"` (POSIX, UNC, win32 drive including drive-relative `C:x`), `"traversal"` (a `..` that climbs above `base` after normalisation; `og/../x` is fine) and `"empty"` (`""`, `.`, `og/..`). No percent-decoding: `%2e%2e/x` is a literal name and stays confined. Success is `base` (trailing separators stripped) + `/` + the normalised path. Use it at EVERY call site that reads or writes a path an archive names, not just the extractor.
- **`relativeWithin(base, absolute, options?)`** → `Effect<Option<string>, never, FileSystem | Path>`, and **`relativeWithinSync(base, absolute, ops, options?)`** → `Option<string>` — where under `base` does an ABSOLUTE path physically sit? `Some(posix base-relative path)` (`""` for the base itself), `None` for every refusal: outside, a link carrying it out, unresolvable, relative/empty/NUL candidate. A destination that does not exist yet resolves from its deepest existing ancestor, as in `confineReal`. `options.missing`: `"ancestor"` (default) or `"refuse"` (`None` for any path that does not exist — an existing-and-inside check). A relative `base` is a defect. Reach for it instead of hand-rolling a realpath-the-existing-ancestor check; use `confineReal` when you need the typed reason.
- **`confineReal(base, candidate)`** → `Effect<string, PathEscapeError, FileSystem | Path>`, and **`confineRealSync(base, candidate, ops)`** → `Result<string, PathEscapeError>` — PHYSICAL containment: resolves links in both and succeeds with the candidate's real path only when it lies strictly inside the base's real path. The candidate may be absolute or relative to `base`; it is resolved segment by segment, so `base/link/../x` climbs out of the link's TARGET (as the OS does) instead of collapsing lexically; a tail that does not exist yet is resolved from its real existing ancestor, so a write target can be checked before creation — once its absence is proved: a dangling link is refused, even one whose target would be inside the base, because writing through it creates the target wherever it points. Adds `reason: "outside"` and `"unresolvable"` (a permission error, a link loop, `ENOTDIR`, a dangling link — containment that cannot be verified is refused, the failure in `cause`) to `PathEscapeError`; the base itself is `"empty"`; on win32 a drive-relative `C:x` or a driveless rooted `\x` is `"absolute"` and a device name or a dots-and-spaces segment is `"reservedName"`. A relative `base` (the empty string included, and on win32 a driveless `\repo`, which names whichever drive the process is on) is a defect. Use the RETURNED path. Comparison is exact on real paths, so it fails closed across case on a case-insensitive filesystem.
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

class InvalidGlobError extends Schema.TaggedError<InvalidGlobError>()("InvalidGlobError", {
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

None exported — none needed: test the `Effect` forms with core's `Path.layer` (POSIX, built into `effect`) and `@effected/memfs`'s `MemoryFileSystem.layerWith(seed, { faults })` — seed the tree the walk should find, and fault `exists` with a typed `PermissionDenied` to cover a denied probe. Never a `FileSystem.layerNoop` stub. No platform package required in tests. Test the sync forms over the same memfs volume: `{ fileSystem: handle.sync, path: posix }` (a `MemoryFileSystem.makeSync`/`makeHandle` handle, `posix` from `node:path`), faulting through `handle.withFaults({ sync })` with `MemoryFileSystem.errno`.

## Gotchas

- `confineRelative` is lexical: a symlink already inside `base` can still point out of it. Extracting into a directory you do not own needs `confineReal` on top.

- `ascend` is lexical, not physical — symlinks are not resolved; ascending out of a symlinked directory follows the path you gave it.
- A non-positive-integer `maxDepth` (0, `NaN`, `2.5`) is a defect, not a silent empty result — true for both `ascend` and `descend`.
- `findUpward` is directory-major: every candidate in the nearest directory is exhausted before ascending — a distant ancestor's marker can never beat a nearer directory's.
- Every `ascend`/`findUpward`/`findRoot` error channel is `never`: not-found and cannot-look (`EACCES`) are indistinguishable by design; discovery is best-effort. `descend` is the one surface with a real typed error — depth exhaustion is a typed failure, never a silent truncation, because silently truncating would silently change which files match.
- `descend`'s traversal is an explicit worklist (a queue dequeued by head index), never true recursion — it cannot stack-overflow no matter how wide or deep the tree.
- A directory that vanishes between its parent's listing and its own read (a benign race) reads as empty, not an error.
- `descend` takes a COMPILED `GlobPattern`, not a source string — compile once (`GlobPattern.compile`) and reuse it when descending the same pattern repeatedly; a raw string reach for `descend` doesn't exist, unlike some of `@effected/glob`'s own APIs that accept either.
