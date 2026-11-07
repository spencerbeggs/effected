# @effected/glob

Full-fidelity glob matching as Effect schemas: the complete minimatch dialect
compiled to pure string predicates, plus the separate `Wildcard` matcher.
Seventh migration. 13 `src/` files (10 engine + 3 facade), 9 test files.

**Tier: pure.** Peer-depends on `effect` only. Zero runtime deps, no IO, no
services. The `minimatch` devDependency is the **test oracle only** — pinned
exactly to the ported version (10.2.5) and imported only under `__test__/`.
Never add it to `dependencies`; never let it drift from the vendored version.

**Design doc:** `@./okf/modules/glob.md` — load when
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
defect, never `RangeError: Maximum call stack size exceeded`. Matching time is
polynomial, bounded by the recursion cap; a hostile pattern can still be slow.
`matches()` is **total**: every compile-time guard throws before an instance
exists; nothing throws at match time. `maxGlobstarRecursion` is schema-bounded
at `MAX_GLOBSTAR_RECURSION_CEILING = 1000` (`internal/limits.ts`): the
body-section walk recurses once per `**` section, and on Node 26's default
stack it first overflowed at about 3,250 sections (2,100 under 5,000 caller
frames, 1,600 at `--stack-size=500`). `GlobPattern.matches` also catches a
`RangeError` (and only that) and answers the cap's no-match answer — `false`,
or `true` for a negated pattern — for a caller with less stack than measured.
Never widen that catch, and never raise the ceiling without re-measuring.
The kit does not bound total matching work (`@./okf/decisions/glob-hostile-pattern-bound.md`):
callers with untrusted patterns bound the input and lower `braceExpandMax`.
Matching is synchronous and blocks the thread, so never recommend
`Effect.timeout` as the lever; a deadline has to be enforced off-thread
(a terminated worker, a subprocess, the host's own deadline).

Upstream guards **preserved**: the 64KB `MAX_PATTERN_LENGTH`; brace-expansion's
`EXPANSION_MAX` budget, the `{a},b}` for-loop rewrite and lazy `post`
evaluation (both load-bearing DoS fixes); the CVE-2022-3517 ReDoS-safe brace
pre-check regex; `maxExtglobRecursion` (default 2, over-nesting **degrades to
literal**, never errors); `maxGlobstarRecursion` (default 200, exceeding it is
upstream's deliberate **false negative** — never converted to an error; the cap
only ever produces a false negative, and under `partial` a walk that used up
the path is a correct match, as in minimatch 11).

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

`#matchGlobStarBodySections` also keeps a `tried` set, from minimatch 11, so
sections that all fail stop at a place already tried. Without it, `**/a` twelve
times against 30 `a` portions and a dot portion takes seconds, with or without
`partial`, and each further `**` multiplies that. It costs at most
`(maxGlobstarRecursion + 1) × path portions` entries for one match. **Never drop
it to save the allocation.**

`balancedMatch.ts` is fully **iterative — no guard; do not add one**. Budget
exhaustion **throws typed** (`ExpansionBudgetExceeded`) where upstream
silently truncated — silent truncation silently changes match semantics.
NaN/non-integer caps die as `TypeError` defects via `assertCap` (wiring bugs,
not input).

## The three behavioral deviations from upstream (and one opt-in adaptation)

1. **No ambient environment detection**: `platform` is an explicit option
   defaulting to `"posix"`; `process.platform` is never read. Win32 handling
   (UNC, drive letters, backslash splitting) is kept behind the option.
2. **Typed budget exhaustion** instead of silent truncation (above).
3. **`**` matching takes minimatch 11.0.4's fixes**, and nothing else from that
   rewrite, in `#matchGlobstar` and `#matchGlobStarBodySections`. The oracle
   has the bugs, so it answers wrongly on patterns with more than one `**`, and
   on `partial` with any `**`. Four things differ: a section's last start comes
   from the portions it and the later sections need; a body stops short of the
   tail, and the last `**` does not walk it; under `partial` the body can run
   past the path and matches only when the path is used up; and the `tried` set
   above. `__test__/globstar.test.ts` pins hard-coded answers and a reference
   matcher, and the oracle properties skip patterns with two or more `**`.
   11's other changes are **not** taken: `a/b/` still matches `a/b/?(x)`, regexps
   and `AST` stay, and so does its win32 handling.

Beside them, `extglobBang` is an **opt-in adaptation** (off by default, so the
oracle contract and its compliance rows hold): `parseNegate` stops before a `!`
that opens an extglob, as picomatch does. It is parity at that one point only.

Plus the workspaces-inherited mandate: **`**` is real** — `packages/**`
matches `packages/a/b` (glob-core's issue-#62 rewrite is not carried forward).

## Public surface

- `GlobPattern` — schema class; validity check = **compilability under default
  options** on every construction path (`make`, `new`, decode, `FromString`).
  Options refine matching; they never admit defaults-rejected patterns.
  Compiled engine cached in a non-encoded private field, pre-warmed by
  `compile`, lazy otherwise.
- **The sync `Result` form is the primitive; the `Effect` form derives from
  it.** `GlobPattern.compileResult` and `GlobSet.compileResult` hold the
  compilation; each `compile` twin is `Effect.fromResult(...)` behind its
  existing span and adds nothing else — the span is the whole reason the
  `Effect` form exists. Never re-derive compilation on the `Effect` side. Kit
  convention — `@./okf/conventions/sync-primitive-policy.md` and
  `@./okf/decisions/sync-form-named-result.md`. `compile`/`GlobSet.compile` carry the only `Effect.fn`
  spans; `matches` and the getters are span-free.
- `GlobPatternOptions` — full minimatch surface, schema-validated; invalid
  options throw at `make` (defect). `braceExpandMax` is bounded `[1, 100_000]`
  — caps tighten, never raise (keeps the defaults-compilability invariant).
- `GlobPatternError` — `pattern`/`reason`/`limit`/`actual`. Uses
  `Schema.Literals([...])` for the reason union: the v3 variadic
  `Schema.Literal(a, b, c)` **silently ignores arguments after the first** in
  beta.94.
- `Wildcard` / `WildcardOptions` (`Wildcard.ts`) — `*` and `?` only, no
  separator, brace, class, negation, escape or dotfile semantics; a wildcard
  never matches whitespace; `nocase` is Unicode simple folding (`iu`). Not a
  glob dialect and shares nothing with the engine. Matching is an NFA
  simulation over tokens, **never a regex built from the pattern** (a
  backtracking `\S*a\S*a…` regex is a ReDoS); consecutive stars collapse.
- `GlobSet` — include/exclude SET semantics (leading `!` = exclusion filter,
  distinct from minimatch whole-pattern negation — both exist on purpose).
  Classifies **per expanded brace alternative**. Pins default options; no
  options surface.

## Testing and building

Tests in `__test__/`, `@effect/vitest`, `assert.*` never `expect`. The
compliance gate (`compliance.test.ts` + `hostility.test.ts` +
`globstar.test.ts`) runs against the raw engine: a 130-row fixture table asserting expected AND oracle agreement on
every row, oracle property tests, and the hostile-input suite. **If the engine
disagrees with the oracle, fix the engine, never the expectation** — except
the documented deviations. Oracle calls map `platform: "posix"` →
`"linux"` (upstream's Platform type has no posix member; linux is behaviorally
identical and immune to ambient drift).

```bash
pnpm vitest run --project @effected/glob   # this package's tests, from the repo root
pnpm build --filter @effected/glob   # from the repo root
```

The bundler's default config
carries one narrow suppression `{ messageId: "ae-forgotten-export", pattern:
"_base" }` for the four synthesized class heritage symbols — **never widen
it**. `package.json` stays `"private": true`.

## Open questions (design-doc OPEN items)

- **The enumeration contract is materially de-risked, not closed.**
  `enumerationPrefix`/`crossesSegments` have now held unmodified under three
  independent consumers — `@effected/workspaces`' enumerator (shipped; the
  "when that package ports" caveat this item used to carry is spent),
  `@effected/walker`'s `descend`, and `@effected/github-actions`' cache
  search-root derivation, the last under real filesystem enumeration. What
  remains open is narrower: **no dedicated conformance run against a reference
  enumerator** has been performed, so nothing asserts case-by-case agreement
  with `@actions/glob` or another reference implementation. See
  `@./okf/modules/glob.md`.
- **`enumerationRoots`** is the per-alternative form walker consumes: one
  `EnumerationRoot { prefix, deep, spellings }` per brace alternative, prefixes
  canonical, roots inside a deep root absorbed into it — except that a climbing
  prefix (`../`) is never inside the base root `""`: it stays its own root so a
  walker can refuse it. Matching stays
  spelling-sensitive, which is why each root carries its `spellings` — never
  canonicalize a match. `dot` defaults to `false` (minimatch's default); Vitest
  globs use `dot: true`, so say so to agree with it. See `@./okf/modules/glob.md`.
- Both getters are computed under default options; their `matchBase`/win32
  interaction stays undefined (documented for default-options patterns only).
