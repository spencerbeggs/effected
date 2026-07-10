# @effected/semver

Strict SemVer 2.0.0 versions, ranges and comparators as Effect schemas. First
migrated package and the repo's **DX north star** — when in doubt about API
shape elsewhere, copy what this package does.

**Pure tier:** peer-depends on `effect` only, zero runtime deps, no IO,
`"sideEffects": false`. Never add a filesystem, network or clock dependency
here; a boundary-tier consumer owns that.

**Design doc:** `@../../.claude/design/effected/packages/semver.md` — load when
changing the public API, the error set, or the grammar pipeline.

## Public surface

`src/index.ts` is the only re-exporting module. Its full export list:

- `src/SemVer.ts` — `SemVer`, `SemVerBump`, `InvalidVersionError`
- `src/Comparator.ts` — `Comparator`, `InvalidComparatorError`
- `src/Range.ts` — `Range`, `ComparatorSet` (type), `InvalidRangeError`,
  `UnsatisfiableConstraintError`
- `src/VersionDiff.ts` — `VersionDiff`
- `src/VersionCache.ts` — `VersionCache`, `VersionCacheShape` (type),
  `EmptyCacheError`, `VersionNotFoundError`, `UnsatisfiedRangeError`

Layout is module-per-concept, not the kind-based `errors/` + `schemas/` folders
the v3 source repo used; each concept owns its tagged errors. `src/internal/`
holds `grammar.ts` (recursive-descent parser), `desugar.ts`
(caret/tilde/x-range/hyphen), `normalize.ts` and `order.ts` (compare
primitives). Outside `index.ts`, modules import explicitly — no barrels.

## Conventions

- **The class is the schema.** `SemVer`, `Comparator`, `Range` are
  `Schema.Class`; `VersionDiff` is a `Schema.TaggedClass`. Each string form is
  a `static readonly FromString` transformation.
- **No floating functions.** Instance methods are canonical; cross-cutting ops
  are `Fn.dual` statics on the owning class (`SemVer.gt`, `Range.filter`, ...).
- **Construct with `.make()`**, never `new` — `make` runs validation.
  `SemVer.of(1, 2, 3)` is the positional convenience form.
- **Errors** are `Schema.TaggedErrorClass` with a `message` getter derived from
  structured fields; never store a preformatted message.
- **`Effect.fn("Name.op")` spans on fallible public boundaries only** — `parse`
  statics, `Range.intersect`, every fallible `VersionCache` method.

## Gotchas

- `SemVer.diff` does **not** exist: `VersionDiff` fields reference `SemVer`, so
  a delegating static would cycle (`noImportCycles` is error-level). Use
  `VersionDiff.between(a, b)`.
- `SemVer` overrides **both** `[Equal.symbol]` and `[Hash.symbol]`. Equality
  ignores build metadata (§10), includes prerelease identifiers (§11), and
  `Equal.equals` fast-paths on hash mismatch — the two must agree.
  `VersionCache` dedupe inherits these semantics.
- `prereleaseIdentifier` in `src/SemVer.ts` is **lookahead-free** on purpose:
  fast-check cannot synthesize lookahead, and `Schema.toArbitrary(SemVer)`
  powers the `it.effect.prop` round-trip tests.
- `Range.test` implements node-semver's prerelease restriction — a prerelease
  version matches a set only when some comparator carries a prerelease on the
  same `major.minor.patch` tuple.
- `Range.isSubset` (and thus `equivalent`, `simplify`) is a conservative
  approximation; false negatives are expected and safe. Read the in-source
  remark before "fixing" it.
- `savvy.build.ts` carries a **narrow** api-extractor suppression,
  `{ messageId: "ae-forgotten-export", pattern: "_base" }`, for the heritage
  symbols inline class factories synthesize. Never widen it — four sibling
  packages depend on this precedent staying narrow.

## Test and build

Tests live in `__test__/` (6 files, 194 tests), use `@effect/vitest`, and
assert with `assert.*` — never `expect`. Default to `it.effect`; `VersionCache`
suites use one top-level `layer(VersionCache.layer)(...)` group. Shared cases
live in `__test__/fixtures/`.

```bash
pnpm vitest run packages/semver          # this package's tests
pnpm build --filter @effected/semver     # dev + prod, from the repo root
```

Never run `node savvy.build.ts --target prod` directly: it skips `build:dev`,
emits no `.d.ts`, and leaves a truncated `issues.json` that looks exactly like
a clean gate.
