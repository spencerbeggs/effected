# @effected/walker

Path traversal: upward (`Walker.ascend` / `firstMatch` / `findUpward` /
`findRoot`) and downward (`descend`, the public glob-file walker). Sixth
migration; the first package extracted from an already-merged sibling rather
than ported from a `*-effect` repo.

**Design doc:** `@../../.claude/design/effected/packages/walker.md`

## Tier: boundary

**Boundary tier**: `effect` and `@effected/glob` are the only peers and there
are no runtime dependencies, but walker does IO. `FileSystem` and `Path` arrive
through the `R` channel from `effect` core, so the consumer's platform layer is
the single place POSIX-vs-win32 semantics are chosen. Requiring core services
costs no dependency. The `@effected/glob` peer is type-and-property only —
`descend` imports `GlobPattern` as a type and calls `matches()`; no value
imports, mirroring config-file's peering on the format packages.

Walker needs **no platform package, even in tests** — `Path.layer` and
`FileSystem.layerNoop` come from core. Do not add `@effect/platform-node`.

## The one absorbing loop

`firstMatch` is the whole algorithm. `findRoot` is a genuine one-line
specialization of it (`firstMatch(dirs, isRoot)` — the candidate expansion is the
identity). `findUpward` first flattens each directory's candidates in
**directory-major** order, then reuses the same loop.

Three properties are load-bearing. Each has a test, and each test has been
watched failing against a deliberately broken implementation:

- **Absorption is per candidate.** A failing probe means "this candidate did not
  match", never "abort the scan". One `EACCES` ancestor must not hide a valid
  root above it. The corollary: not-found and cannot-look are deliberately
  **indistinguishable** to the caller. Discovery is best-effort, and a `None` may
  mean a directory was unreadable rather than empty.
- **Defects propagate.** `firstMatch` uses `Effect.catch`, which catches failures
  and not defects. **Never** change it to `Effect.catchCause`.
- **`firstMatch` short-circuits.** The scan stops at the first match; later
  candidates are never probed. A marker predicate can be expensive —
  `isWorkspaceRoot` reads and parses a `package.json` — so this is not just an
  optimization.

Every upward error channel is `never`. The one typed error in the package is
`descend`'s `DescendError` — see below.

## `descend` — the downward glob-file walker

`descend(pattern, options)` expands a compiled `@effected/glob` `GlobPattern`
under `options.cwd`, returning matching FILE paths relative to `cwd`, POSIX
separators, sorted. The walker is **semantics-free**: dotfile behavior and
every other matching option are carried by the compiled pattern the caller
hands in — never re-derived here.

- A literal pattern (no magic, not negated) fast-paths to one stat; missing is
  zero matches. A magic pattern walks from `enumerationPrefix`; a **negated**
  pattern walks from `cwd` itself (its matches can land outside the inner
  pattern's prefix); a missing base directory is an **empty result**, not an
  error. A pattern that lexically climbs above `cwd` via `..` segments is
  zero matches, refused before any filesystem access — the walk never reads
  outside its documented root.
- Only files match. A symlink counts when it stat-resolves to a file (`stat`
  follows links, as node's does); a symlinked **directory is never descended**
  (cycle safety, detected by a `readLink` success-probe); dangling = no match.
- Unreadable directory mid-walk: `onUnreadable: "fail"` (default) fails typed
  as `DescendError` — the OPPOSITE of the upward per-probe absorption, because
  a swallowed subtree in a downward enumeration is silently missing
  membership. `"skip"` absorbs and continues. A NotFound mid-walk is a benign
  vanished-directory race and reads as empty in both modes.
- Depth past `maxDepth` (default 256) is a typed `depthExceeded` failure,
  never a truncation; an invalid `maxDepth` is a **defect**, exactly
  `ascend`'s guard.
- The descent is a worklist dequeued by head index (never `Array.shift()`),
  and a pattern that cannot match below one level (`crossesSegments` false and
  not negated) reads a single level and never descends.
- `prune` suppresses **directories only** — a FILE named `.git` (a submodule
  or worktree gitlink) stays matchable.

## Invariants

- `ascend` is **lexical, not physical**: `Path.dirname` does not resolve
  symlinks, so ascending out of a symlinked directory follows the given path.
  Correct for config discovery.
- `ascend` is a bounded `for` loop, not recursion. It terminates at `dirname`'s
  root fixpoint; `maxDepth` (default 256) guards a pathological `Path`.
- `maxDepth` must be a **positive integer**. Anything else — `< 1`, `NaN`, or a
  non-integer like `2.5` — is a **defect** (`Effect.die`), never a silently-empty
  chain. The guard is `!Number.isInteger(maxDepth) || maxDepth < 1`, because
  `NaN < 1` and `2.5 < 1` are both `false`.
- `findUpward` is **directory-major**: every candidate in the nearest directory is
  exhausted before ascending. A candidate-major interleave would let a distant
  ancestor's `.apprc` beat a nearer `config/.apprc`.
- `start` is required. Walker never reads `process.cwd()`.

## Build

`savvy.build.ts` carries the one narrow `_base` suppression
(`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the synthesized
base of the `DescendError` class factory. Never widen it.

Never run `node savvy.build.ts --target prod` directly.
