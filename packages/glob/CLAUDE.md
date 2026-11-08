# @effected/glob

Full-fidelity glob matching as Effect schemas: the complete minimatch dialect
compiled to pure string predicates, plus the separate `Wildcard` matcher.
Seventh migration. 14 `src/` files (11 engine + 3 facade), 9 test files.

**Tier: pure.** Peer-depends on `effect` only. Zero runtime deps, no IO, no
services. The `minimatch` devDependency is the **test oracle only** — pinned
exactly to 11.0.5, the version whose behaviour the engine follows, and imported
only under `__test__/`. Never add it to `dependencies`; never move it without
reconciling the engine against the new version first.

**Design doc:** `@./okf/modules/glob.md` — load when
changing the public API, the dialect, the error set, or the hardening story.

## Engine/facade split

`src/internal/` is a **vendored engine** ported with attribution: minimatch
(BlueOak-1.0.0, Isaac Z. Schlueter), brace-expansion 5.0.12 and balanced-match
4.0.4 (MIT, Julian Gruber). The minimatch files keep 10.2.5's regexp-and-`AST`
shape and take minimatch 11.0.5's behaviour (listed below), so their headers
still say 10.2.5 and their port notes name each change taken; brace-expansion's
`expand_` follows 5.0.12's iterative scan (one loop over a string's groups,
which also decides once whether empty results drop), and `parseCommaParts`
keeps 5.0.7's recursive shape behind guard 2. Every ported file carries
its license header — **never edit the notice text**; the two MIT files carry
the full permission notice as license compliance.

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
Every magic portion is matched by minimatch 11.0.5's own one-portion
matcher, vendored as `internal/matcher.ts` and `internal/matcherClass.ts`
(`@isaacs/nonrecursive-glob-match` 1.1.0, BlueOak-1.0.0). The portion's regexp
is compile-time validation only (`compileOrFail`, `InvalidRegExp`): matching through it backtracked O(n^k) on k stars
separated by literals (`*a` fourteen times then `b` took 25 s against 40
characters) and read UTF-16 code units where 11 reads code points (`?` did
not match `😀`). The matcher tests a chain of `*`, `?`, classes and literals
in O(path × pattern); otherwise it compiles the portion to a graph and
simulates it with state sets, caching each state's next state per character
(its `Dfa`, cleared past `DFA_BUDGET`). It replaced a position walk that was
polynomial at best (37 s and 2.2 GB for `*(a)` sixteen thousand times
against 200 characters) and exponential in nesting at worst. Its `Sim#add`
is a worklist, not 11's recursion: 11.0.5 itself overflows its stack on
`*(a)` × 16,000. **Never route a magic portion back to a regexp or a walk.**

Matching is polynomial and bounded by the input, not close to linear
everywhere. Measured: `*(a|?)` × 10,000 (60 KB) against 1,000 characters,
14 ms; `x` + 1,600 × `!(a)` against `x` + 1,600 × `b`, 23 ms. The slow shape
the matcher inherits from 11 is a chain of negations separated by literals:
each negation's run stays in every later state, so `x!(a)` repeated against
`xb` repeated is about cubic: 22 ms at a 400-character path, 1.6 s at 2,000
(11.0.5 is slower still). `hostility.test.ts` pins its growth, and the `**`
routes below are the others. A caller with untrusted patterns or paths bounds
the input (`@./okf/decisions/glob-hostile-pattern-bound.md`).
`matches()` is **total**: every compile-time guard throws before an instance
exists; nothing throws at match time. **No regexp is built at match time**:
every regexp the matcher tests with (classes, nocase folds, a folded
literal) is built when its `Matcher` is, at compile, into the portion's
`PortionPlan` (`ast.ts`, port note 9), through the same typed `InvalidRegExp`
catch; never add a `new RegExp` on the match path. `compileOrFail` also runs
each regexp once on a one-byte subject (`test("")`) and once on a two-byte
one (`test("\u0100")`) inside that catch: `new RegExp` checks the syntax only,
and V8 builds the code for each kind of subject on its first exec of that
kind, so a source too large for it (`"a".repeat(32_781) + "*"`, or
`"ā".repeat(33_000) + "*"`, whose one-byte code is trivial) passed compile and
threw from `matches`. `maxGlobstarRecursion` is schema-bounded
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
pre-check regex; brace-expansion 5.0.12's `EXPANSION_MAX_LENGTH` (4,000,000
characters of results, or of a comma set's alternatives together, against
CVE-2026-14257; it **fails typed**, where upstream truncates) and
`EXPANSION_MAX_REWRITES` (1,000 restarts of the quadratic `{a},b}` rewrite,
past which the rest **stays literal**, exactly as upstream: a parse rule, not a
truncated result, so it is not a failure; the count is **shared** by every
group of one left-to-right scan, as 5.0.12's single scan loop holds it, so a
chain of groups draws on one 1,000, while a comma part or `{{...}}` body is a
fresh scan with its own); minimatch 11.0.5's
`optimizationLevel` 2 bound on the `**/..` split (GHSA-g3hv-75wg-m249:
`braceExpandMax` rows or `MAX_SPLIT_CELLS = 1_000_000` added path portions,
**failing typed** as `ExpansionBudgetExceeded` where upstream throws a
`RangeError`, and a keyed dedupe in place of the pairwise one);
`maxExtglobRecursion` (accepted, and validated as a positive integer, but it
**no longer limits anything**: every extglob portion is matched by 11's
matcher, which has no such cap, and nesting is bounded by
`MAX_NESTING_DEPTH` instead); `maxGlobstarRecursion` (default 200, exceeding it is
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

`parseClass` (`braceExpressions.ts`) keeps a per-glob memo so a run of `[`
is linear: the indices an unclosed scan reached in a neutral state (past the
first character, not escaping, no range pending), from which every later
scan that reaches one never closes, so it stops there. Without it a run
of unclosed `[`, `[\]` or `[` before `[:alpha:]` was quadratic: 2,000 `[`
took 5 s. **Never drop it**; `hostility.test.ts` pins the shapes.

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

## The behavioral deviations from upstream (and one opt-in adaptation)

1. **No ambient environment detection**: `platform` is an explicit option
   defaulting to `"posix"`; `process.platform` is never read. Win32 handling
   (UNC, drive letters, backslash splitting) is kept behind the option.
2. **Typed budget exhaustion** instead of silent truncation (above).

Beside them, `extglobBang` is an **opt-in adaptation** (off by default, so the
oracle contract and its compliance rows hold): `parseNegate` stops before a `!`
that opens an extglob, as picomatch does. It is parity at that one point only.

Plus the workspaces-inherited mandate: **`**` is real** — `packages/**`
matches `packages/a/b` (glob-core's issue-#62 rewrite is not carried forward).

## What the engine takes from minimatch 11.0.5

The engine answers as the 11.0.5 oracle does, except the divergences below:

- **`**` matching** (`#matchGlobstar`, `#matchGlobStarBodySections`): a
  section's last start comes from the portions it and the later sections need;
  a body stops short of the tail, and the last `**` does not walk it; under
  `partial` the body can run past the path and matches only when the path is
  used up; and the `tried` set above. minimatch 10.2.3–10.2.6 got patterns with
  more than one `**`, and `partial` with any `**`, wrong;
  `__test__/globstar.test.ts` keeps those rows as regressions, checked against
  the oracle and a reference matcher.
- **Portions**: an empty path portion matches only an empty pattern portion
  (`a/b/` does not match `a/b/?(x)`); a class is a literal only when its body
  is one code point (`[a-a]` is magic, `[😀]` is not); and a portion that is exactly an empty
  extglob is read with extglobs off (`*()` is a `*` and a literal `()`;
  `+(|)` keeps its meaning and matches nothing); a `[` that never closes is a
  literal and parsing goes on (`[+(a)` matches `[a`; port note 10: `#parseAST`
  reads a class whole, as `parseClass` does, where 10 tracked an open class
  to the end of the portion and parsed no extglob after it); and an extglob
  opener that is
  never closed is literal text, with what follows read as at the enclosing
  level (`a*(` does not match `ax(`; in `@(a|*(b)` the `*(b)` stays an
  extglob). That last one reuses the alternatives already parsed instead of
  parsing the rest again, and `isEnd` asks a null-typed node's parent once,
  not twice: together they keep a chain of unclosed openers linear
  (`hostility.test.ts` pins `a` + 120 × `@(` and the growth ratio).
- **11's matcher** (`internal/matcher.ts`, port note 9 in `ast.ts`) answers
  every magic portion, so 11's dot rules hold (a wildcard, class or `!(...)`
  never takes the leading dot of a dotfile without `dot`, nor any character
  of `.` or `..`), a `!(...)` negates exactly its sub-pattern (`!(*)` matches
  nothing, `x/a!(b)*` matches `x/ab`), and `?` takes one code point (`?.txt`
  matches `😀.txt`). A portion with **any extglob** builds no regexp at all
  (a never-matching placeholder carries its plan): filling a regexp's
  negations doubled per negation (`x` + 25 × `!(a)`, 101 bytes, ran out of
  memory). Any other magic portion still builds its regexp, as validation
  only. Only a portion that is exactly `+()` or `@()` stays text.
- **Escapes**: a character reaches the regexp escaped only if it is regexp
  syntax, 11's `reEscape` set `\ ^ $ . * + ? ( ) [ ] { } | /`, whether it was
  escaped in the glob, loose, or a one-character class (`#parseGlob`,
  `parseClass`). 10 missed `|` (`\|*` was an alternation that matched `b`)
  and escaped `!`, `,`, `#`, `-` and whitespace, which the `u` flag a POSIX
  class turns on rejects (`[[:alpha:]]-*` failed `InvalidRegExp`, #1279).
- **Numeric ranges** (#1278): a `{lo..hi}` of 100 or more values, unescaped,
  not after `$`, with safe-integer ends, is not expanded but marked
  (`expandMarked`, 11's `#expandBraces`, including its fall-back to expanding
  all when a `[` precedes a mark in its portion); the marked portion is
  answered by 11's matcher with its `rangeMark` (`rangePortion`,
  `internal/numericRange.ts`). So `hasMagic` is true, `enumerationRoots` and
  `enumerationPrefix` stop at it, and no budget applies to it. `GlobSet`
  classifies with `braceAlternatives` (no 11 counterpart): each alternative is
  written back as text, a kept range as `{lo..hi}` (an unescaped `\` just
  before it dropped, as 11's matcher takes it with the range), and every brace
  the expansion unescaped escaped again, so `\{a,b}` is the literal `{a,b}`
  and is never expanded twice. After a `$` or a literal (escaped) backslash a
  range would not read alone as one, so that include, like one whose
  alternative does not compile alone, stays one wildcard: the whole pattern.
  `GlobSet.compileResult` classifies eagerly, and the schema check classifies
  too, so no guard can trip in `matches`. An alternative that is exactly `!`,
  `#` or `/` does not mean alone what it means in the whole (as on 0.x before
  this); the rest do.
- **Shared compile work** (`CompileBudget`, `ast.ts`): one compile shares
  each identical portion across rows (`#portions`, as 11 shares a `Matcher`)
  and each identical matcher regexp, and counts its work against
  `MAX_REGEXP_WORK` (8,000,000 units): a kept regexp's source length plus
  2,048 per `\p{...}` (a matcher's class regexps, shared), a portion's
  validation regexp's length plus `VALIDATION_PROPERTY_WEIGHT` (1,536) per
  `\p{...}`, and
  `GRAPH_ITEM_WEIGHT` (4) per matcher graph item, charged before the graph is
  built (matcher port note 6; an item holds about 50 bytes). A kept range is
  684 items for the widest ends, and each brace alternative around it holds
  its own copy: `{$,a}{-9007199254740991..9007199254740991}` twelve times
  (504 characters) took 16.7 s and 4.2 GB, and now fails typed in about
  0.2 s at about 125 MB of heap; seven times still compiles (about 110 ms,
  35 MB), eight times too, and nine fails, as 11 refuses nine and more. A
  `GlobSet` is one compile: `classify` builds every engine it keeps under one
  budget and hands it to its pattern (`patternWithEngine`), so twenty members
  that each compile alone can fail the set typed (twenty at eight times
  retained 1.6 GB with a budget each). Past the budget the compile fails
  typed as `CompileBudgetExceeded` before the regexp or graph is built:
  `[[:alpha:]]{0..99}{0..99}{0..9}` (100,000 alternatives, each with its own
  validation regexp) ran the process out of memory at about 1 GB and now
  fails in about 1.2 s at about 370 MB of peak RSS. 11 builds matchers lazily
  and compiles it in 275 ms: a documented refusal (below).
- **Validation regexps** (#1287, `validate` in `ast.ts`): a non-extglob
  magic portion's `^…$` regexp is validation only, so it is built, run on
  both subjects and **dropped**: the portion's `set` entry is a
  never-matching placeholder carrying the plan, as for an extglob portion
  (a kept POSIX-class regexp held about 25 KB). Its source is checked
  **once per compile** (`CompileBudget.validated`; V8 reuses a compiled
  source anyway), so `GlobSet` members sharing `[[:alpha:]]*.ts` cost it
  once and compile at 20,000. The weight is measured time, **inside one
  compile filled to the budget** (a source built alone reads 30% cheap): the
  costliest escape (`[[:print:]]`'s `\p{C}`) costs about 465 us under both
  `u` and `nocase`'s `iu`, a literal character 0.30 to 0.33 us, so 1,536; a
  set whose every member has its own `[[:alpha:]]` portion fits about 2,550
  members, `[[:word:]]` about 1,280. A compile is ONE budget: `compileResult`
  builds its defaults engine (the value invariant) and its effective engine
  on one budget, and builds the class unchecked (the defaults engine was the
  check); `GlobSet` compiles each include whole on the set's budget and
  reuses that engine when the include stays whole or has one alternative.
  Before, each had a budget of its own, so `nocase` did twice one budget's
  work (6 s at HEAD) and a set about twice (3.5 s). Time adds up across a
  compile but the memory V8 holds while it builds ONE regexp (about 400 KB
  an escape, superlinear past about 1,000) does not, so one validation
  regexp is capped on its own at `MAX_VALIDATION_PROPERTIES` = 256 escapes
  (about 94 MB and 105 ms at the cap), failing typed `CompileBudgetExceeded`
  with `limit` 256; before it, 3,800 `[[:print:]]` in one portion fit the
  budget and peaked at 3.2 GB. **Never keep the validation regexp, and never
  drop the per-regexp cap to "simplify" the charge.** `GlobSet`'s
  `classifyInclude` marks the budget before an include's alternatives and
  rewinds it (`rewindBudget`: spend, shared regexps and validations after
  the mark) when the include stays whole, so the whole is charged once.
- **Fast paths**: 11 has no `*.ext`/`?ext` fast path, and neither does the
  kit now; 10's compared an escaped extension with its backslash (`*\.` did
  not match `a.`).
- **Win32 roots**: a `..` can not remove a drive letter or a UNC host and
  share (`#rootIndex`, in all three `..` passes); a UNC host and share compare
  without case; `//?/UNC/host/share` matches `//host/share`; a matching drive
  letter starts the match after itself instead of rewriting the compiled
  pattern. Under `windowsNoMagicRoot` (on by default with `nocase`) a UNC
  root with a host and no share (`//b`, `//?`) stays a string, as in 11, so
  `hasMagic` is false for it. (Before this the port kept 10's win32 handling,
  which let `C:/a/../../x` match `x`.)
- **`optimizationLevel` 2**: the `**/..` split bound and the keyed dedupe
  (above), which also fixes `{**/x,x/y}`.

Not taken from 11: the `normalize` option and
the `minimatch()` cache. The kit
still accepts `maxExtglobRecursion`, which 11 removed, but it limits nothing
now (above).

## Documented divergences from the oracle

One difference in match answers remains, named in `compliance.test.ts`,
never a blanket skip: the oracle's brace merge (below). Beside it, a pattern
can fail typed where 11 matches: an over-budget expansion (11 truncates; a
range of 100 or more values is not expanded, so this is a comma set, a
smaller range, or every range of a portion where a `[` precedes one); nesting
past `MAX_NESTING_DEPTH` (256, where brace-expansion 5.0.12 turns literal at
1,000); `InvalidRegExp` (11 has no regexp to reject), whose one known
cause is a portion's regexp too large for the runtime (about 32,000 literal
characters and a wildcard in one portion; `hostility.test.ts` still reaches
it); and `CompileBudgetExceeded`, a compile whose work passes
`MAX_REGEXP_WORK` (thousands of alternatives each with its own POSIX class,
`[[:alpha:]]{0..99}{0..99}`, or more than 256 POSIX-class properties in one
portion), which 11 compiles because it builds its matchers lazily; a kept
range copied into thousands of alternatives, which 11 refuses as too long;
or a `GlobSet` whose members together pass it, where each alone compiles. Those are
typed failures, never wrong answers.

- **The oracle's brace merge** (an 11.0.5 defect). minimatch 11 joins a
  pattern's brace alternatives into one Matcher with `|`, so a `[` in one
  alternative and a `]` in a later one become a class, and the alternatives
  between them are lost: `b**{Z..a}` (alternatives `b**[`, `b**`, `b**]`, …)
  does not match its own text in 11, though `b**` does. The engine answers
  the union of the alternatives. Balanced alternatives hit it too:
  `b[a-#{Z..a}[.]` expands to alternatives that each match `ba` in 11, yet
  11's merged matcher does not. `compliance.test.ts` names it
  `bracketsAcrossAlternatives` (any alternative with a `[` or `]`) and judges
  only those patterns by the union of 11's own per-alternative answers. 11.0.5
  also throws `TypeError: pattern is too long` from its row merge on some
  short brace patterns (one is 92 bytes), which the kit compiles.

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
  Classifies **per expanded brace alternative** (`braceAlternatives`, so a
  numeric range of 100 or more values is one wildcard alternative). Pins
  default options; no options surface.

## Testing and building

Tests in `__test__/`, `@effect/vitest`, `assert.*` never `expect`. The
compliance gate (`compliance.test.ts` + `hostility.test.ts` +
`globstar.test.ts`) runs against the raw engine: a 130-row fixture table asserting expected AND oracle agreement on
every row, oracle property tests, and the hostile-input suite. **If the engine
disagrees with the oracle, fix the engine, never the expectation** — except
the documented deviations and the brace-merge divergence, each tested on its own
and never by a blanket skip. Oracle calls map `platform: "posix"` →
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
  `enumerationPrefix`/`crossesSegments` have now held under three
  independent consumers (`crossesSegments` was corrected once, #1282: it is
  measured from the prefix every alternative shares, so `{apps,packages}/*`
  crosses segments; single-alternative patterns answer as before) — `@effected/workspaces`' enumerator (shipped; the
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
- The enumerator getters (`enumerationPrefix`, `crossesSegments`,
  `enumerationRoots`, `literalPrefix`) are computed under the pattern's own
  options. Under `matchBase` a compiled row of ONE portion matches by
  basename at any depth (`isBasenameRow` in `GlobPattern.ts`, the test
  `Minimatch.match` applies), so it has no literal prefix and is deep from
  `""` (#1261: `*.js` and `x/../*.js` match `b/d/f/g.js`). The public
  `matchesByBasename` getter reports whether any row is one: walker reads it
  instead of re-deriving the fact from the source, which went wrong twice
  (#1250's hidden-directory rule, then a text reading that unbounded
  `src/[ab]/*.ts`). Because the rule reads the compiled row, glob's collapse
  routes (`<p>/..` popped, globstars merged, level 2's `.` drops) are covered
  by construction. Win32 interaction of the getters stays undocumented.
