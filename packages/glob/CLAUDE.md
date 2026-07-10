# @effected/glob

Full-fidelity glob matching as Effect schemas: the complete minimatch dialect
compiled to pure string predicates. Seventh migration. 12 `src/` files
(10 engine + 2 facade), 6 test files, 134 tests.

**Tier: pure.** Peer-depends on `effect` only. Zero runtime deps, no IO, no
services. The `minimatch` devDependency is the **test oracle only** — pinned
exactly to the ported version (10.2.5) and imported only under `__test__/`.
Never add it to `dependencies`; never let it drift from the vendored version.

**Design doc:** `@../../.claude/design/effected/packages/glob.md` — load when
changing the public API, the dialect, the error set, or the hardening story.

## Engine/facade split

`src/internal/` is a **vendored engine** ported with attribution: minimatch
10.2.5 (BlueOak-1.0.0, Isaac Z. Schlueter), brace-expansion 5.0.7 and
balanced-match 4.0.4 (MIT, Julian Gruber). Every ported file carries its
license header — **never edit the notice text**; the two MIT files carry the
full permission notice as license compliance.

The split is a **cycle firewall** (`noImportCycles` is error-level): the
engine throws raw `GuardExceeded` records (`internal/limits.ts`) at compile
time and never imports the facade; only `GlobPattern.ts`/`GlobSet.ts`
materialize them into the typed `GlobPatternError`. Upstream let `ast.ts` and
`index.ts` import each other's types circularly — the shared types live in
`internal/types.ts` instead.

## Hardening invariant

Malformed or hostile input fails through the typed `E` channel — never a
defect, never `RangeError: Maximum call stack size exceeded`, never a hang.
`matches()` is **total**: every compile-time guard throws before an instance
exists; nothing throws at match time.

Upstream guards **preserved**: the 64KB `MAX_PATTERN_LENGTH`; brace-expansion's
`EXPANSION_MAX` budget, the `{a},b}` for-loop rewrite and lazy `post`
evaluation (both load-bearing DoS fixes); the CVE-2022-3517 ReDoS-safe brace
pre-check regex; `maxExtglobRecursion` (default 2, over-nesting **degrades to
literal**, never errors); `maxGlobstarRecursion` (default 200, exceeding it is
upstream's deliberate **false negative** — never converted to an error).

New guards **added**, all at `MAX_NESTING_DEPTH = 256` (`internal/limits.ts`):

1. `braceExpansion.ts` `expand_` — comma-bearing nesting depth.
2. `braceExpansion.ts` `parseCommaParts` — sequential comma-group chains
   (upstream recursed unbounded; >256 groups now fail typed).
3. `ast.ts` `#parseAST` — a **structural backstop** counting every descent.
   This fixes a real upstream hole: coalescible extglob types recurse with
   `depthAdd = 0`, so stock minimatch 10.2.5 **stack-overflows at default
   options** on `"@(".repeat(20000) + "a" + ")".repeat(20000)` (~60KB, under
   its own length cap; verified 2026-07-09). Know this before touching ast.ts.
4. `ast.ts` `toRegExpSource` ↔ `#partsToRegExp`, `#flatten`, `clone`/`copyIn`
   — depth counters on the remaining AST recursion surfaces.

`balancedMatch.ts` is fully **iterative — no guard; do not add one**. Budget
exhaustion **throws typed** (`ExpansionBudgetExceeded`) where upstream
silently truncated — silent truncation silently changes match semantics.
NaN/non-integer caps die as `TypeError` defects via `assertCap` (wiring bugs,
not input).

## The two behavioral deviations from upstream

1. **No ambient environment detection**: `platform` is an explicit option
   defaulting to `"posix"`; `process.platform` is never read. Win32 handling
   (UNC, drive letters, backslash splitting) is kept behind the option.
2. **Typed budget exhaustion** instead of silent truncation (above).

Plus the workspaces-inherited mandate: **`**` is real** — `packages/**`
matches `packages/a/b` (glob-core's issue-#62 rewrite is not carried forward).

## Public surface

- `GlobPattern` — schema class; validity check = **compilability under default
  options** on every construction path (`make`, `new`, decode, `FromString`).
  Options refine matching; they never admit defaults-rejected patterns.
  Compiled engine cached in a non-encoded private field, pre-warmed by
  `compile`, lazy otherwise. `compile`/`GlobSet.compile` carry the only
  `Effect.fn` spans; `matches` and the getters are span-free.
- `GlobPatternOptions` — full minimatch surface, schema-validated; invalid
  options throw at `make` (defect). `braceExpandMax` is bounded `[1, 100_000]`
  — caps tighten, never raise (keeps the defaults-compilability invariant).
- `GlobPatternError` — `pattern`/`reason`/`limit`/`actual`. Uses
  `Schema.Literals([...])` for the reason union: the v3 variadic
  `Schema.Literal(a, b, c)` **silently ignores arguments after the first** in
  beta.94.
- `GlobSet` — include/exclude SET semantics (leading `!` = exclusion filter,
  distinct from minimatch whole-pattern negation — both exist on purpose).
  Classifies **per expanded brace alternative**. Pins default options; no
  options surface.

## Testing and building

Tests in `__test__/`, `@effect/vitest`, `assert.*` never `expect`. The
compliance gate (`compliance.test.ts` + `hostility.test.ts`) runs against the
raw engine: a 130-row fixture table asserting expected AND oracle agreement on
every row, oracle property tests, and the hostile-input suite. **If the engine
disagrees with the oracle, fix the engine, never the expectation** — except
the two documented deviations. Oracle calls map `platform: "posix"` →
`"linux"` (upstream's Platform type has no posix member; linux is behaviorally
identical and immune to ambient drift).

```bash
pnpm vitest run --project @effected/glob   # this package's tests
pnpm build --filter @effected/glob         # dev + prod, from the repo root
```

Never run `node savvy.build.ts --target prod` directly. `savvy.build.ts`
carries one narrow suppression `{ messageId: "ae-forgotten-export", pattern:
"_base" }` for the four synthesized class heritage symbols — **never widen
it**. `package.json` stays `"private": true`.

## Open questions (design-doc OPEN items)

- `enumerationPrefix`/`crossesSegments` validate against the real workspaces
  enumerator when that package ports; their `matchBase`/win32 interaction is
  undefined (documented for default-options patterns only).
