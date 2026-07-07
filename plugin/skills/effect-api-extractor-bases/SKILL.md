---
name: effect-api-extractor-bases
description: Use when API Extractor reports ae-forgotten-export for anonymous base classes of Effect class factories (Schema.Class, Schema.TaggedClass, Schema.TaggedErrorClass, Context.Service) — the house idiom is a named, exported, @public X_base const with an explicit type annotation, re-exported from the entry point, documented as not for direct use. Yields a zero-warning issues.json.
---

# API Extractor × Effect class factories

`class X extends Schema.Class<X>("X")({...}) {}` produces an anonymous
heritage type. API Extractor reports it as `ae-forgotten-export` — CI-fatal
under the silk bundler. The three possible states are mutually exclusive
(verified empirically on @effected/semver):

1. **Inline factory call** → `ae-forgotten-export` (CI-fatal). Not viable.
2. **Named `@internal` base** → residual `ae-incompatible-release-tags`
   warnings (non-fatal, but they keep `issues.json` dirty and trip the
   tsdoc monitor). Rejected 2026-07-07.
3. **Named `@public` base** → zero warnings; two public exports per
   concept. **This is the house policy.** The extra surface is the accepted
   cost of a clean artifact under the binary release-tag policy — each base
   carries a doc comment stating it is not meant to be referenced directly,
   which distinguishes it from the v3 `*ErrorBase` ceremony (undocumented
   API Extractor workarounds presented as real surface).

## The idiom

```ts
/**
 * Schema-generated base class backing {@link SemVer}. Not meant to be
 * referenced directly — named and exported only so API Extractor can
 * resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const SemVer_base: Schema.Class<
 SemVer,
 Schema.Struct<{ readonly major: typeof nonNegativeInteger /* ... */ }>,
 {}
> = Schema.Class<SemVer>("SemVer")({ /* fields */ });

/** ... @public */
export class SemVer extends SemVer_base { /* ... */ }
```

Rules that are each load-bearing:

- **The explicit type annotation is mandatory.** Splitting the factory call
  out of the heritage clause forfeits TypeScript's inline circular-inference
  special case; without the annotation TS reports `'X_base' implicitly has
  type 'any' because it is referenced ... in its own initializer`. Copy the
  factory's return-type shape from the installed `effect` `.d.ts`
  (`Schema.Class<Self, Fields, Inherited>`, `Context.ServiceClass<...>`).
- **Re-export every `X_base` from `src/index.ts`.** API Extractor only sees
  symbols reachable from the entry point; exporting from the defining module
  alone still reports forgotten-export.
- **Schema helpers referenced by the annotation become `@public` exports
  too** (e.g. field schemas like `nonNegativeInteger`) — they appear in the
  base's type, and the binary release-tag policy propagates: anything a
  `@public` signature references must itself be `@public`. Give each the
  same not-for-direct-use doc comment.
- **Ordering:** a base whose fields reference another class in the same file
  (`UnsatisfiedRangeError_base` referencing `Range`) must be declared AFTER
  that class.
- **Do not suppress warnings.** The `@public` tagging makes
  `dist/prod/issues.json` genuinely clean (zero warnings on
  @effected/semver); suppressions would only hide regressions.

## Related

Links from TSDoc to inherited members (`{@link SemVer.make}` where `make`
comes from the base) are unresolvable — use a backtick code span instead.
