---
name: effect-api-extractor-bases
description: Use when API Extractor reports ae-forgotten-export for the anonymous base of an Effect class factory (Schema.Class, TaggedClass, TaggedErrorClass, Opaque, Context.Service) under the silk bundler. The house policy is to write the factory INLINE and suppress the synthesized X_base warning narrowly via savvy.build.ts meta.tsdoc.suppressWarnings [{ messageId ae-forgotten-export, pattern _base }] — no @public base const, no hand-written annotation. Yields a zero-warning issues.json with the base warnings in the suppressed bucket.
---

# API Extractor × Effect class factories

`class X extends Schema.Class<X>("X")({...}) {}` (and `TaggedClass` /
`TaggedErrorClass` / `Opaque` / `Context.Service`) produces an anonymous
heritage type. API Extractor reports it as `ae-forgotten-export` on a
synthesized `X_base` symbol — CI-fatal under the silk bundler.

## The policy: inline factory + scoped `_base` suppression

Write the factory **inline** — no split-out base const, no hand-written
annotation — and suppress the synthesized-base warning narrowly in the
package's `savvy.build.ts`:

```ts
// savvy.build.ts
import { build } from "@savvy-web/bundler";

await build({
  meta: {
    localPaths: ["../../website/lib/models/X"],
    tsdoc: {
      suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
    },
  },
});
```

```ts
// src/X.ts — inline, no base const, no annotation
/** ... @public */
export class SemVer extends Schema.Class<SemVer>("SemVer")({
  major: nonNegativeInteger,
  minor: nonNegativeInteger,
  patch: nonNegativeInteger,
}) {
  /** ... */
  static readonly FromString = /* ... */;
}
```

That yields `dist/prod/issues.json` = `{ warnings: 0, errors: 0, suppressed: N }`,
with the `SemVer_base` (and every other `*_base`) entry in the **`suppressed`**
bucket.

### Why this is principled, not a "silence the warning" cop-out

The emitted `.d.ts` proves the base is genuinely internal:

```ts
declare const SemVer_base: Schema.Class<SemVer, /* full inlined shape */>;
declare class SemVer extends SemVer_base { /* full shape: fields, statics, methods */ }
export { SemVer /* , ... */ };   // <- SemVer_base is NOT exported
```

`X_base` is a module-local `declare const` that never appears in the export
list, and the exported class carries its full shape. A consumer can neither
name nor need `X_base`. The suppression is **narrow** (`pattern: "_base"`
matches only these synthesized symbols), **accounted for** (it lands in the
`suppressed` bucket and the build log reports the count — it is logged, not
silenced), and **harmless** (`ae-forgotten-export` means "a public API names a
type a consumer can't import"; here nothing a consumer needs is lost). That is
categorically different from muting, say, an `ae-missing-release-tag` you don't
feel like fixing.

### Validated across every factory kind (2026-07-08)

Confirmed clean (`warnings: 0`, the `*_base` in `suppressed`) with `tsgo`
green and **no hand-written annotations** on:

- `Schema.Opaque`, `Schema.asClass`, `Schema.Class`, `TaggedClass`,
  `TaggedErrorClass`.
- **Recursive `Schema.Class` + `Schema.suspend`** (a node whose field
  references itself): the inline form has **no TS2506** and needs none of the
  old `Schema.Schema<Self>` base-annotation gymnastics — that failure mode was
  an artifact of splitting the annotated base const out of the heritage clause,
  and it evaporates inline. The suspend callback still takes its normal
  `(): Schema.Schema<Self> => Self` return type; that is ordinary recursive-schema
  practice, not a base annotation.
- **`Context.Service`** (`class R extends Context.Service<R, Shape>()("id") {}`):
  same `R_base` suppression, no annotation.
- **Named field-schema consts** (`major: nonNegativeInteger`): the const's type
  **inlines into `X_base`** rather than emitting as `typeof nonNegativeInteger`,
  so it does **not** forgotten-export and does **not** need `@public`. The old
  "schema helpers referenced by the annotation become `@public`" cascade retires
  with the annotation that caused it.

So the former ceremony — the `@public X_base` export, the mandatory explicit
annotation, the recursive `Schema.Schema<Self>` special-casing, re-exporting
every base from `index.ts`, and marking field consts `@public` — is all gone.
Write the class the way Effect's own docs write it and add the one-line
suppression.

## The suppression is `_base`-scoped ONLY — it does not cover method signatures

The binary release-tag rule still applies to **method and function
parameter/return types**: *anything a `@public` signature names must itself be
`@public`*. An internal type on a public method signature is a **different
symbol** (not suffixed `_base`), so `pattern: "_base"` does **not** suppress it —
by design, so genuine surface leaks are never masked. In the yaml port, one
internal `RawDiagnostic` parameter on a `@public`
`YamlDiagnostic.fromRaw(raw: RawDiagnostic, …)` produced **12**
forgotten-export warnings (the whole `internal/diagnostics` module). These are
real and must be fixed, not suppressed:

- **Inline a structural type** on the public signature so no internal symbol is
  named — best for engine-internal record types that should not become public
  surface:

  ```ts
  static fromRaw(
   raw: { readonly code: YamlErrorCode; readonly message: string; readonly offset: number; readonly length: number },
   text: string,
  ): YamlDiagnostic { … }
  ```

- **Or tag the referenced type `@public`** and re-export it — only when it is
  genuinely part of the API.

Prefer the structural-inline form for anything under `src/internal/`. Watch for
this on `X.fromRaw` / `X.of` / codec-adapter statics that bridge the internal
engine to the public classes — exactly where an internal record type sneaks
onto a `@public` signature.

## TSDoc `{@link}` traps

Links from TSDoc to inherited members (`{@link SemVer.make}` where `make` comes
from the base) are unresolvable — use a backtick code span instead. The same
trap fires for any name carrying **both a value and a type declaration** — e.g.
a branded scalar (a `const` schema plus its exported `type` of the same name,
like `PackageName` or `SpdxLicense`): API Extractor cannot disambiguate the two
declarations, so **both** the bare `{@link X}` **and** the member
`{@link X.member}` resolve to `ae-unresolved-link`. Use backtick code spans
(`` `PackageName` ``, `` `PackageName.of` ``) for those, not `{@link}`.

## History

This supersedes two earlier idioms: the `@internal`-tagged base (residual
non-fatal `ae-incompatible-release-tags`, rejected 2026-07-07) and the
`@public X_base` const-with-explicit-annotation idiom (ratified 2026-07-07,
retired 2026-07-08 once the inline form + scoped `_base` suppression was
validated on the recursive and `Context.Service` cases).

The inline factory + scoped `_base` suppression is the **single policy** — use
it for all new code. The already-migrated packages (`semver`, `jsonc`, `yaml`,
`package-json`, `npm`) still carry the old `@public X_base` form; that is a
**transitional backlog to convert, not an alternative convention**. The
conversion is a mechanical narrowing (delete the base const + annotation, inline
the factory into the heritage clause, add the suppression line), not a redesign
— do it when you next touch each file.
