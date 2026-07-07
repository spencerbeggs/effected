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
- **Recursive classes: annotate self-references as `Schema.Schema<Self>`.**
  For a `Schema.suspend`-recursive class (e.g. an AST node whose `children`
  field references itself), copying the factory return type verbatim makes
  `typeof Self` circular (`TS2506` "referenced in its own base expression"),
  and `Schema.Codec<Self>` fails because Encoded (plain struct) differs from
  Type (class with methods). Use `Schema.Schema<Self>` for the suspend
  callback's return type AND the self-referential field inside the base
  annotation — lazy, type-only, and still yields a zero-warning
  `issues.json` (proven on @effected/jsonc's `JsoncNode_base`).
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

## Internal types in `@public` signatures cascade

The binary release-tag rule — *anything a `@public` signature references must
itself be `@public`* — applies to **method and function parameter/return
types**, not just heritage clauses. A single internal type on a public
signature triggers a cascade: API Extractor reports `ae-forgotten-export`
for that type AND every const/type it transitively references. In the yaml
port, one internal `RawDiagnostic` parameter on a `@public`
`YamlDiagnostic.fromRaw(raw: RawDiagnostic, …)` produced **12**
forgotten-export warnings (the whole `internal/diagnostics` module — the
record type, its staged code-const arrays, and their derived unions).

Two fixes:

- **Inline a structural type** on the public signature so no internal symbol
  is named — best for engine-internal record types that should not become
  public surface:

  ```ts
  static fromRaw(
   raw: { readonly code: YamlErrorCode; readonly message: string; readonly offset: number; readonly length: number },
   text: string,
  ): YamlDiagnostic { … }
  ```

- **Or tag the referenced type `@public`** and re-export it — only when it is
  genuinely part of the API.

Prefer the structural-inline form for anything living under `src/internal/`;
publishing an internal record type just to satisfy the rollup is the same
mistake as the banned `*Base` ceremony. Watch for this on `X.fromRaw` /
`X.of` / codec-adapter statics that bridge the internal engine to the public
classes — they are exactly where an internal record type sneaks onto a
`@public` signature.

## Related

Links from TSDoc to inherited members (`{@link SemVer.make}` where `make`
comes from the base) are unresolvable — use a backtick code span instead.
