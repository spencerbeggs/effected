# Review: semver-effect → @effected/semver

Source: `/Users/spencer/workspaces/spencerbeggs/semver-effect` (Effect v3, ~2,900 LoC src, ~520 tests).
Target: `@effected/semver`, pure tier, Effect v4-first redesign per
`.claude/design/effected/effect-standards.md`. This is a design review, not a v3-idiom
critique — v3 constructs are noted only where the v4 mapping matters.

## 1. What is done well

The "DX exemplar" reputation is earned, and the specific reasons are worth naming so the
redesign preserves them deliberately:

- **The class IS the domain type.** `SemVer`, `Range`, `Comparator`, `VersionDiff` are
  `Schema.TaggedClass` with real instance methods and getters:
  `v.bump.minor()`, `v.gt(other)`, `v.isStable`, `range.test(v)`, `comp.test(v)`.
  Consumers never juggle a bag of free functions plus a dumb record — the value carries
  its own behavior. This maps 1:1 onto the v4 `Schema.Class` norm.
- **The fluent `v.bump.*` namespace.** Grouping `major/minor/patch/prerelease/release`
  under a `bump` accessor keeps the class surface readable while making the operation
  family discoverable in autocomplete. The prerelease bump semantics (identifier switch
  resets counter, `1.0.0` → `1.0.1-0`) are node-semver-compatible and well tested.
- **Effect-native vocabulary throughout.** `Order.Order<SemVer>` instances
  (`SemVerOrder`, `SemVerOrderWithBuild`), `Option` for absence (`max`, `min`,
  `maxSatisfying`, `next`/`prev`), `SortedSet` + `Ref` for the cache,
  `Match.exhaustive` for tag dispatch, `Function.dual` for data-first/data-last. The
  library reads like an Effect core module, which is exactly the house style.
- **Spec-correct custom `Equal`/`Hash`.** Structural equality deliberately ignores build
  metadata (SemVer §10) while including prerelease identifiers (§11). This is load-bearing:
  `SortedSet` dedupe and `Equal.equals` both inherit spec semantics. Must survive migration.
- **Typed error channel with rich payloads.** Parse errors carry `input` and character
  `position`; `UnsatisfiedRangeError` carries the `range` and the `available` versions;
  `UnsatisfiableConstraintError` carries the conflicting constraints. `message` is derived
  via getter from structured fields, never preformatted strings. This is the error-design
  bar for the whole monorepo.
- **Hand-rolled recursive-descent parser (`utils/grammar.ts`, 607 LoC).** No regex, exact
  failure positions, leading-zero and safe-integer enforcement, and a clever parameterized
  fail-constructor (`FailFn<E>`) so the same low-level token parsers produce
  `InvalidVersionError` vs `InvalidRangeError` vs `InvalidComparatorError` per entry point.
  Sugar desugaring (`^`, `~`, x-ranges, hyphen) is isolated in `desugar.ts`; comparator
  normalization (sort + semantic dedupe ignoring build metadata) is a separate pass in
  `normalize.ts`. Clean pipeline: grammar → desugar → normalize.
- **Range algebra with honest semantics.** `union`/`intersect`/`isSubset`/`equivalent`/
  `simplify`; `intersect` fails typed (`UnsatisfiableConstraintError`) instead of returning
  an unsatisfiable range; `isSubset`'s conservative-approximation limitation is documented
  with a concrete counterexample and a safety argument. Preserve this documentation habit.
- **Correct layer discipline (in v3 terms).** `Layer.succeed` for the pure parser,
  `Layer.effect` for the Ref-backed cache; dependencies (`SemVerParser`) expressed in the
  layer type, never leaked into service method signatures. Interface-only `VersionFetcher`
  shows the right "library defines the port, consumer provides the adapter" instinct.
- **Documentation and test discipline.** TSDoc with `@example` on effectively every
  export, `@see` cross-links, a `docs/` suite including node-semver migration and spec
  compliance, ~520 tests including a dedicated spec-compliance suite and fixtures.

## 2. What is confusing or awkward (do not carry forward)

- **The static-wiring hack is the biggest wart.** Cross-cutting statics (`SemVer.parse`,
  `SemVer.compare`, `Range.parse`, `Range.satisfies`, `Comparator.parse`, ...) are declared
  as *uninitialized typed fields* on the classes and assigned at module load by `index.ts`
  (lines 84–120). Consequences:
  - Deep-importing `schemas/SemVer.js` yields a class whose statics are `undefined` at
    runtime — the JSDoc literally warns "Always import from semver-effect".
  - `package.json` must declare `"sideEffects": ["**/index.js"]`, defeating tree-shaking.
  - A parallel `*.module.test.ts` suite exists solely to verify the wiring happened.
  - Awkward inline `import("effect/Effect").Effect<...>` type annotations everywhere.
  Root cause is the kind-based folder split (`schemas/` can't import `utils/` that import
  `schemas/`). Module-per-concept + `src/internal/` dissolves the cycles; statics become
  ordinary class-body members.
- **Triple API surface.** Every comparison exists three ways: instance method (`v.gt(b)`),
  static (`SemVer.gt`), and floating dual function (`gt`). Bumps exist as `v.bump.major()`
  plus floating `bumpMajor(v)` wrappers that just delegate. Plus an `eq` alias for `equal`.
  Pick two canonical forms (instance method + dual static on the class) and delete the
  floating layer entirely — the standards doc already mandates "no floating functions".
- **Error `*Base` export pairs.** Ten errors × two exports each
  (`InvalidVersionError` + `InvalidVersionErrorBase`, ...) — an API Extractor workaround
  for `Data.TaggedError`'s anonymous base class. Twenty public symbols for ten concepts.
  `Schema.TaggedErrorClass` in v4 makes this pattern unnecessary; verify API Extractor
  behavior once, then export exactly one class per error.
- **Dead errors.** `InvalidBumpError` and `InvalidPrereleaseError` are exported and
  documented but never raised anywhere in `src/`. Error proliferation ahead of need —
  define errors when an operation actually fails with them.
- **Unvalidated schema fields.** `major`/`minor`/`patch` are bare `Schema.Number`
  (negative and fractional values pass), prerelease numeric identifiers are unconstrained,
  and internal code constructs via `new SemVer({...})` everywhere, bypassing even the
  weak validation. In v4: `.check(...)` non-negative-integer constraints in-schema and
  construction via `.make` per standards.
- **`VersionCache` interface inconsistencies.**
  - `versions` is a property getter while `latest()`/`oldest()` are thunks — pick one.
  - `filter` fails with `EmptyCacheError` when the cache is empty but returns `[]` when
    non-empty with no matches: two representations of "nothing" on one method.
  - `next`/`prev` return `Effect<Option<SemVer>, VersionNotFoundError>` — Option AND the
    error channel encoding two different absences; defensible but subtle enough to trip
    consumers.
  - `groupBy` returns a mutable `Map<string, ...>` from an otherwise immutable API
    (`HashMap` or a record would fit the house style).
  - 14 methods spanning mutation/query/resolution/grouping/navigation. The grouping ops
    (`groupBy`, `latestByMajor`, `latestByMinor`) are pure derivations over the version
    array and don't need to live on the service.
- **`SemVerParser` is pure-function indirection.** The live layer delegates directly to
  the grammar functions; its only in-repo consumer is `VersionCacheLive.resolveString`.
  In a pure-tier package, parsing is a static on the class, not a service. Drop it unless
  pluggable parse strategies are a demonstrated requirement.
- **Cycle-dodging logic duplication.** `comparePre` is inlined in `SemVer.ts` "to avoid
  circular dep with order.ts", and `satisfiesSet` (including the prerelease-tuple rule) is
  inlined in `Range.ts` duplicating `utils/matching.ts` semantics. Spec rules now live in
  two places each. Module-per-concept removes the excuse.
- **`prettyPrint`/`Printable`.** A `Match` dispatcher that calls `.toString()` on four
  types that all already have `.toString()`. Pure API noise — drop.
- **Minor:** mutable `_bump` memo field on an otherwise immutable value class; verbose
  free-function names forced by the flat namespace (`parseValidSemVer`,
  `parseSingleComparator`) that duplicate `SemVer.parse`/`Comparator.parse`; custom
  `toJSON` hand-mirrors what schema encoding should own.
- **Tests are plain vitest.** `describe/it` + `Effect.runSync`/`runPromise` in 11 files;
  no `@effect/vitest`. Fine for v3-era code, but the v4 standard is `it.effect` +
  top-level `layer(...)` groups, and the `*.module.test.ts` wiring-verification suite
  disappears with the hack it tests.

## 3. v4 migration implications (this codebase specifically)

| v3 construct (here) | v4 target |
| --- | --- |
| `Schema.TaggedClass<SemVer>()("SemVer", {...})` + methods | `Schema.Class` domain model (schema IS the class); keep `_tag` only where serialized discrimination is needed (`VersionDiff` yes; `Comparator` arguably not) |
| `new SemVer({...})` (used internally ~everywhere) | `SemVer.make(...)`; add `.check(...)` non-negative-int constraints so `make` actually validates |
| `parseValidSemVer` grammar → class, wired via index.ts | `SemVer.FromString` schema transformation (`Schema.String` → `SemVer` via `decodeTo`, driven by the internal grammar); `SemVer.parse` = `Effect.fn("SemVer.parse")` wrapping decode + `catchTag("SchemaError", → InvalidVersionError)` per boundary-normalization standard. `toString()` becomes the encode direction — round-trip for free, plus `toArbitrary`/JSON-schema derivation from one source of truth. Same for `Range.FromString`, `Comparator.FromString` |
| `const XErrorBase = Data.TaggedError("X")` + subclass with `message` getter | Single `Schema.TaggedErrorClass` per error; payload fields reference the `SemVer`/`Range` schema classes directly, so `UnsatisfiedRangeError` becomes fully serializable. Keep derived-message discipline |
| `Context.Tag("semver-effect/VersionCache")<Self, Shape>` | `Context.Service` class with identifier + shape in one place (only `VersionCache` survives; `SemVerParser` deleted, `VersionFetcher` extracted — see §5) |
| `layers/VersionCacheLive.ts` (separate file) | Layer co-located in `VersionCache.ts` as `VersionCache.layer` / exported const; stays `Layer.effect` (Ref construction). Parser dependency disappears with `SemVerParser` — `resolveString` calls `Range.parse` directly |
| `Function.dual` floating functions (`gt`, `satisfies`, `truncate`, ...) | Dual *statics* on the owning class (`SemVer.gt`, `Range.satisfies`); instance methods remain the canonical form |
| `SemVerOrder` / `SemVerOrderWithBuild` consts in `utils/order.ts` | `SemVer.Order` / `SemVer.OrderWithBuild` statics |
| Custom `[Equal.symbol]`/`[Hash.symbol]` (build-ignoring) | Verify the v4 `Schema.Class` equality customization hook and port deliberately — `SortedSet` dedupe semantics depend on it. Add a regression test pinning "equal ignoring build" |
| No instrumentation anywhere (`Effect.fn`/`withSpan`/log: zero hits) | `Effect.fn("SemVer.parse")`, `Effect.fn("Range.parse")`, `Effect.fn("Range.intersect")`, `Effect.fn("VersionCache.resolve")` etc. at operation boundaries per observability standard |
| Plain vitest + `Effect.runSync` | `@effect/vitest` `it.effect`; `layer(VersionCache.layer)(...)` for cache suites; `it.effect.prop` + `Schema.toArbitrary(SemVer)` for parse/print round-trip properties (the existing spec-compliance fixtures convert directly) |
| `"sideEffects": ["**/index.js"]` | `"sideEffects": false` once index.ts is re-exports only |

Not a v4 problem: the grammar's mutable `ParserState` threaded through `Effect.gen` is
fine as internal implementation; it can even become plain synchronous code surfaced only
through the schema transformation.

## 4. Candidate module-per-concept layout

~~~text
src/
  index.ts          # re-exports only, zero side effects
  SemVer.ts         # SemVer Schema.Class: checked fields; FromString schema;
                    #   statics: parse, make/of, Order, OrderWithBuild,
                    #   compare/gt/gte/lt/lte/equal/neq (dual), sort, rsort,
                    #   max, min, truncate, diff
                    #   instance: compare/gt/.../equal, isStable, isPrerelease,
                    #   bump ops (keep grouped `.bump` namespace — it's good DX),
                    #   toString/encode
                    # errors: InvalidVersionError
                    # (InvalidPrereleaseError/InvalidBumpError only if an op
                    #  actually raises them; otherwise do not port)
  Comparator.ts     # Comparator class: FromString, parse; instance test();
                    # errors: InvalidComparatorError
  Range.ts          # Range class + ComparatorSet type: FromString, parse;
                    #   statics: satisfies/filter/maxSatisfying/minSatisfying (dual),
                    #   union, intersect, isSubset, equivalent, simplify (algebra
                    #   becomes statics — no separate algebra module in the API)
                    #   instance: test(), filter(), toString/encode
                    # errors: InvalidRangeError, UnsatisfiableConstraintError
  VersionDiff.ts    # VersionDiff class (tagged, serializable);
                    #   static VersionDiff.between(a, b) — SemVer.diff delegates
  VersionCache.ts   # Context.Service + co-located layer (Layer.effect, Ref+SortedSet);
                    #   slimmed interface (see §2): mutation + query + resolve;
                    #   grouping ops become pure statics (e.g. SemVer.latestByMajor)
                    # errors: EmptyCacheError, VersionNotFoundError,
                    #   UnsatisfiedRangeError (defined here — the cache raises it)
  internal/
    grammar.ts      # recursive-descent parser (port largely as-is)
    desugar.ts      # caret/tilde/x-range/hyphen desugaring
    normalize.ts    # comparator sort + semantic dedupe
    order.ts        # shared compare primitives (breaks the SemVer↔order cycle
                    #   that forced the comparePre/satisfiesSet inlining)
~~~

Deleted relative to v3: `errors/` (10 files), `layers/` (2 files), `utils/bump.ts`,
`utils/compare.ts`, `utils/matching.ts`, `utils/prettyPrint.ts`, `utils/parseRange.ts`,
`services/SemVerParser.ts`, `services/VersionFetcher.ts`, all `*Base` exports, the
`Printable` union, and the index.ts wiring block. 32 files → ~10.

## 5. Extraction / split / seam candidates

- **`VersionFetcher` + `VersionFetchError`: do not port into @effected/semver.** It is a
  boundary concept (registry IO port) inside a pure-tier package, has one method, and ships
  no implementation. Either drop it (consumers define their own port — it's three lines)
  or park it for a future boundary package (e.g. an npm-registry client) that would own
  both the port and a live layer. Recommendation: drop; revisit when a real fetcher exists.
- **`VersionCache`: keep, but it is the seam to watch.** It is pure (Ref + SortedSet, no
  IO) so it doesn't break the tier, but it is the only stateful/service-shaped thing in an
  otherwise data-type library. If @effected/semver is ever wanted as a minimal schema-only
  dependency, the cache is the natural second entry point (`@effected/semver/VersionCache`
  subpath export) or second package. A subpath export is probably enough.
- **`SemVerParser`: delete, don't extract.** Pure-function indirection (§2).
- **Grammar/desugar/normalize: stays internal.** Semver-specific; nothing here generalizes
  to other @effected packages.
- **Reusable *pattern* (not code) for other migrations:** the `FailFn<E>` parameterized
  error-constructor trick in grammar.ts, the derived-`message`-getter error style, and the
  documented-approximation habit (`isSubset`) are worth citing in the migration playbook as
  house patterns for jsonc/yaml/json-schema parsers.

## 6. Peer / dependency hygiene

Current state is clean and already matches the pure-tier rule:

- `peerDependencies`: `effect` only (`catalog:silkPeers`); `effect` also in
  `devDependencies` for development. No `@effect/*` satellite packages, no platform
  packages, no runtime dependencies at all. The peer closure is trivially complete —
  `effect` has no non-optional peers of its own.
- For `@effected/semver`: peer on the v4 `effect` range from the monorepo catalog
  (`packages/effect4` config dependency); `@effect/vitest` as devDependency for tests.
  No other edges needed. No cross-@effected dependencies.
- Housekeeping on port: `"sideEffects": ["**/index.js"]` → `"sideEffects": false` (only
  needed for the static-wiring hack); package name/exports per monorepo conventions
  (`packages/semver` placeholder already exists with the `@effected/semver` name).
