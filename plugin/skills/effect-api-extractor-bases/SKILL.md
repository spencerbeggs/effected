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

  (This is the **landed** form, not a hypothetical: `@effected/yaml`'s
  `YamlDiagnostic.fromRaw` ships exactly this structural-inline signature — the
  12-warning `RawDiagnostic` incident above is what motivated it.)

- **Or tag the referenced type `@public`** and re-export it — only when it is
  genuinely part of the API.

Prefer the structural-inline form for anything under `src/internal/`. Watch for
this on `X.fromRaw` / `X.of` / codec-adapter statics that bridge the internal
engine to the public classes — exactly where an internal record type sneaks
onto a `@public` signature.

### …nor does it cover a type in the class factory's GENERIC

The same gap bites one step earlier, in the **heritage clause itself**. An
unexported interface passed as a *type argument* to the factory —

```ts
interface VersionCacheShape { … }   // NOT exported from index.ts

export class VersionCache extends Context.Service<VersionCache, VersionCacheShape>()(
 "@effected/semver/VersionCache",
) {}
```

— leaks as a plain `ae-forgotten-export` on **`VersionCacheShape`**, whose symbol
name has no `_base` suffix, so `pattern: "_base"` does not match it.

**Measured** on `@effected/semver` by un-exporting exactly that interface and
rebuilding:

| | warnings | suppressed | code | `ciFatal` |
| --- | --- | --- | --- | --- |
| baseline | 0 | 12 | — | — |
| interface un-exported | **1** | 12 (unchanged) | `ae-forgotten-export` | **`true`** |

> `The symbol "VersionCacheShape" needs to be exported by the entry point index.d.ts`

The suppressed bucket stayed at 12 and every entry in it ends in `_base` — the
narrow suppression does exactly what it says and nothing more.

The fix is to **export the shape type** from the entrypoint (it is genuinely part
of the API — it is the service's contract), not to widen the suppression. This is
the case a reviewer walks you into: nitting "dedupe this shape into a named
interface" is right on the merits, but the moment the name exists it must also be
exported, or the gate goes red. Applies equally to `Schema.Class<Self, Fields>`
and every other class factory that takes a type argument.

## TSDoc `{@link}` traps

**Merged value + type names: use a member-reference selector, not a backtick.**

Any name carrying **both a value and a type declaration** — an `interface` plus
a `const` of the same name (`ConfigCodec`, `MergeStrategy`, `VersionAccess`), or
a branded scalar's `const` schema plus its exported `type` (`PackageName`,
`SpdxLicense`) — cannot be disambiguated by API Extractor from a bare link. Both
`{@link X}` and `{@link X.member}` resolve to `ae-unresolved-link`, and the
diagnostic says so literally: *"the reference is ambiguous… you need to add a
TSDoc member reference selector."*

The fix is the selector, and the link keeps working:

```ts
/** Wrap any {@link (ConfigCodec:interface)} with AES-GCM encryption. */
/** See {@link (ConfigResolver:variable).staticDir}. */
/** The decoded form of {@link (ConfigEventPayload:variable)}. */
/** A branded scalar: {@link (PackageName:type)}. */
```

Pick the selector that names the declaration you mean: `:interface`, `:variable`,
`:class`, `:type`. Getting it wrong still emits `ae-unresolved-link` — `:type` on
an interface does not resolve — so a zero-warning build is the proof you chose
correctly. `@effected/yaml` (`{@link (YamlSegment:type)}`) and
`@effected/config-file` (`{@link (ConfigCodec:interface)}`) both ship these
zero-warning.

**Do not "fix" these by deleting the link.** Replacing a resolvable
`{@link (X:interface)}` with an inert backtick span silently removes an API-doc
cross-reference. This skill previously prescribed exactly that, on the false
premise that no `{@link}` form resolves for a merged name; the `@effected/config-file`
port disproved it (five selectors, warnings → 0).

**Member of a const-only namespace object: link through the exported name — no
selector, and the bare member name never resolves.** Every package entry point
in this repo exports the shape

```ts
const ascend = (...) => ...                    // module-local, NOT exported
export const Walker = { ascend } as const;     // the only export
```

Here `{@link ascend}` is `ae-unresolved-link` — not because the name is
ambiguous, but because **there is no export by that name**, so no selector can
fix it (`{@link (ascend:variable)}` stays red). Do not pattern-match "bare link
unresolved ⇒ reach for a selector"; that heuristic belongs to the merged-name
case above, where the diagnostic says "ambiguous". When the diagnostic says
*"does not have an export"*, the fix is a plain member reference through the
exported const — `{@link Walker.ascend}` — with no selector, because `Walker`
carries a value declaration only. `packages/config-file/src/ConfigMigration.ts`
(`{@link ConfigMigration.make}`) and `packages/walker/src/Walker.ts` both ship
this form warnings-clean. Expect the mistake to recur: `Jsonc`,
`ConfigResolver`, `ConfigMigration`, `ConfigCodec`, `MergeStrategy`, and
`Walker` all use this export shape, and the failure is invisible to `pnpm test`
and `types:check` — it only surfaces in the **prod** build's `issues.json`.

**Backtick spans remain correct for two cases**, where no selector helps:

1. **Inherited members** — `{@link SemVer.make}` where `make` comes from the
   synthesized base. There is no selector for a member the declaration does not
   own. Write `` `SemVer.make` ``.
2. **Cross-package symbols you only `import type`.** A selector disambiguates
   *between local declarations*; it cannot reach a symbol API Extractor never
   rolled up into this package entry point. An adapter that does
   `import type { ConfigCodec } from "@effected/config-file"` and writes
   `{@link (ConfigCodec:interface)}` still gets `ae-unresolved-link`. Write
   `` `ConfigCodec` ``. Expect this on **every** adapter package that plugs
   into a seam it does not own.

**A note on reading `issues.json`.** Its `file` names the source, but its `line`
indexes the **generated `.d.ts`**. Locate a `tsdoc-*` or `ae-unresolved-link`
defect textually, not by jumping to that line number — the position routinely
lands on a class declaration thirty lines from the offending comment, which has
sent more than one agent chasing an innocent symbol.

## Reading the gate without fooling yourself

`issues.json` is a **false-green oracle**. Three rules, each learned by being burned:

1. **Build through Turbo, never the raw script.** `build:prod` dependsOn
   `types:check` and `build:dev`. Running `node savvy.build.ts --target prod`
   directly skips `build:dev`, emits no `.d.ts`, and API Extractor dies inside
   `SourceMapper` with *"The referenced path was not found: …/pkg/index.d.ts"*.
   Use `pnpm build --filter <pkg>` from the repo root.

2. **A crashed build writes a truncated `issues.json`** — `errors: 0,
   warnings: 0, suppressed: 0` — byte-shaped exactly like a perfectly clean
   gate. **`suppressed: 0` is the tell**: a package with class factories always
   has one `_base` entry per factory. Always check the build's exit code before
   trusting the file. Never conclude "clean" from the file alone.

3. **An incremental build can hide warnings.** A stale `dist/.tsbuildinfo.lib`
   feeds API Extractor an old `.d.ts`, so a warning present in a cold build is
   absent from the incremental one. Read the gate from a cold build (`rm -rf`
   the package's `dist` first) whenever the answer matters.

`dist/` is gitignored and shared. It carries no commit, no cleanliness, and no
exit-code provenance, so it is only evidence when *your* build exited 0 against
a clean tree with nothing else building. If you mutate source to prove a fix is
load-bearing, **rebuild afterward** — otherwise you leave an artifact that
describes a tree no commit ever contained.

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
