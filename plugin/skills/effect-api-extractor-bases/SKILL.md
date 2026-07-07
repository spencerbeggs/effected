---
name: effect-api-extractor-bases
description: Use when API Extractor reports ae-forgotten-export for anonymous base classes of Effect class factories (Schema.Class, Schema.TaggedClass, Schema.TaggedErrorClass, Context.Service) — the house idiom is a named, exported, @internal X_base const with an explicit type annotation, re-exported from the entry point, accepting residual non-fatal ae-incompatible-release-tags warnings.
---

# API Extractor × Effect class factories

`class X extends Schema.Class<X>("X")({...}) {}` produces an anonymous
heritage type. API Extractor reports it as `ae-forgotten-export` — CI-fatal
under the silk bundler. The three possible states are mutually exclusive
(verified empirically on @effected/semver):

1. **Inline factory call** → `ae-forgotten-export` (CI-fatal). Not viable.
2. **Named `@internal` base** → residual `ae-incompatible-release-tags`
   warnings (non-fatal). **This is the house policy.**
3. **Named `@public` base** → zero warnings but two public exports per
   concept — the v3 `*ErrorBase` ceremony, banned by effect-standards.

## The idiom

```ts
/**
 * Schema-generated base class backing {@link SemVer}. Not meant to be
 * referenced directly — named and exported only so API Extractor can
 * resolve the heritage clause of the class it backs.
 *
 * @internal
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
- **Schema helpers referenced by the annotation become `@internal` exports
  too** (e.g. field schemas like `nonNegativeInteger`) — they now appear in
  the base's type.
- **Ordering:** a base whose fields reference another class in the same file
  (`UnsatisfiedRangeError_base` referencing `Range`) must be declared AFTER
  that class.
- **Do not suppress warnings and do not mark bases `@public`.** The residual
  `ae-incompatible-release-tags` entries in `dist/prod/issues.json` are the
  accepted cost until `@savvy-web/tsdown-plugins` ships an allowance for the
  pattern.

## Related

Links from TSDoc to inherited members (`{@link SemVer.make}` where `make`
comes from the base) are unresolvable — use a backtick code span instead.
