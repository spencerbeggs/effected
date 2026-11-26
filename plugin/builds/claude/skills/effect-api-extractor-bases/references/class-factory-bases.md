# Class-factory bases in depth

The `SKILL.md` states the policy: write the factory inline and keep the one
scoped `_base` suppression. This reference holds why that suppression is
principled, which factory kinds it was proven on, and the leaks it
deliberately does not cover.

## Why this is principled, not a "silence the warning" cop-out

The emitted `.d.ts` proves the base is genuinely internal:

```text
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

## Validated across every factory kind

Clean (`warnings: 0`, the `*_base` in `suppressed`) with `tsgo` green and
**no hand-written annotations** on:

- `Schema.Opaque`, `Schema.Class`, `TaggedClass`, `TaggedError`.
  (Naming trap: there is no `Schema.asClass` — zero occurrences in
  `Schema.ts`. To give a schema value a class identity you subclass it
  directly: `class MyString extends Schema.String {}`.)
- **Recursive `Schema.Class` + `Schema.suspend`** (a node whose field
  references itself): the inline form has **no TS2506** and needs no
  `Schema.Schema<Self>` base annotation — that failure mode comes from
  splitting an annotated base const out of the heritage clause, and it
  does not occur inline. The suspend callback still takes its normal
  `(): Schema.Schema<Self> => Self` return type; that is ordinary recursive-schema
  practice, not a base annotation.
- **`Context.Service`** (`class R extends Context.Service<R, Shape>()("id") {}`):
  same `R_base` suppression, no annotation.
- **Named field-schema consts** (`major: nonNegativeInteger`): the const's type
  **inlines into `X_base`** rather than emitting as `typeof nonNegativeInteger`,
  so it does **not** forgotten-export and does **not** need `@public`.

So none of this ceremony is needed: a `@public X_base` export, an explicit
base annotation, recursive `Schema.Schema<Self>` special-casing, re-exporting
every base from `index.ts`, or marking field consts `@public`. Write the class
the way Effect's own docs write it and keep the one-line suppression.

## Rejected alternatives

Two other idioms are not used: the `@internal`-tagged base (it leaves a
residual non-fatal `ae-incompatible-release-tags`) and the `@public X_base`
const-with-explicit-annotation idiom (the inline form + scoped `_base`
suppression covers the recursive and `Context.Service` cases it existed for).
If you find a `@public X_base` const, it is code written against the retired
idiom: inline the factory into the heritage clause and delete the const.

Find the packages in a workspace that override the default suppression list,
and so must restate the `_base` rule themselves:

```bash
grep -rl --include=effected.toml "suppressWarnings" .
```

## An internal type on a public method signature

An internal record type passed to a `@public` static leaks as forgotten
exports for every symbol it reaches: one internal `RawDiagnostic` parameter on
a `@public` `YamlDiagnostic.fromRaw(raw: RawDiagnostic, …)` reports the whole
internal diagnostics module, a dozen warnings. The structural-inline form is
what `@effected/yaml` ships:

```text
static fromRaw(
 raw: { readonly code: YamlErrorCode; readonly message: string; readonly offset: number; readonly length: number },
 text: string,
): YamlDiagnostic { … }
```

Watch for this on `X.fromRaw` / `X.of` / codec-adapter statics that bridge the
internal engine to the public classes — exactly where an internal record type
sneaks onto a `@public` signature.

## Third-party generics are free

The mirror-image fear — that naming a *dependency's* generic type on a `@public`
signature will forgotten-export it — is unfounded. **API Extractor resolves
declared-dependency third-party types as externals and emits real `import`
statements in the `.d.ts`**: no `ae-forgotten-export`, no inlining, no
re-export ceremony. Octokit's `Endpoints[R]` on a `@public` signature in
`@effected/github` is an example.

The condition is that the package be a **declared dependency** (it must be
resolvable from the emitted `.d.ts`, which a `devDependency` or a transitive
package is not). Given that, write the precise third-party type rather than
widening to `unknown` or hand-copying its shape — the gate does not charge you
for it.

## A type in the class factory's generic

An unexported interface passed as a *type argument* to the factory —

```ts
import { Context } from "effect"

interface VersionCacheShape {
  readonly current: string
} // NOT exported from index.ts

export class VersionCache extends Context.Service<VersionCache, VersionCacheShape>()(
 "@effected/semver/VersionCache",
) {}
```

— leaks as a plain `ae-forgotten-export` on **`VersionCacheShape`**, whose symbol
name has no `_base` suffix, so `pattern: "_base"` does not match it. The build
reports one warning, `ciFatal: true`, while the `suppressed` bucket is unchanged
and every entry in it still ends in `_base`:

> `The symbol "VersionCacheShape" needs to be exported by the entry point index.d.ts`

The fix is to **export the shape type** from the entrypoint (it is genuinely part
of the API — it is the service's contract), not to widen the suppression. A
review nit to "dedupe this shape into a named interface" is right on the merits,
but the moment the name exists it must also be exported, or the gate goes red.
Applies equally to `Schema.Class<Self, Fields>` and every other class factory
that takes a type argument.
