# @effected/walker

Upward path traversal. Sixth migration; the first package extracted from an
already-merged sibling rather than ported from a `*-effect` repo.

**Design doc:** `@../../.claude/design/effected/packages/walker.md`

## Tier: boundary

**Boundary tier**: `effect` is the only peer and there are no runtime
dependencies, but walker does IO. `FileSystem` and `Path` arrive through the `R`
channel from `effect` core, so the consumer's platform layer is the single place
POSIX-vs-win32 semantics are chosen. Requiring core services costs no dependency.

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

Every public error channel is `never`. There is no error module.

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

`savvy.build.ts` carries **no** `suppressWarnings`. Walker declares no classes,
so no `_base` symbol is synthesized. Keep the list empty; fix exports instead.

Never run `node savvy.build.ts --target prod` directly.
