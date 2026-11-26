---
name: effect-api-extractor-bases
description: "Use when API Extractor reports ae-forgotten-export for the anonymous base of an Effect class factory (Schema.Class, TaggedClass, TaggedError, Opaque, Context.Service) under `effected package build`, or ae-unresolved-link and the other ae-*/tsdoc-* diagnostics a package build surfaces, or when reading dist/prod/issues.json to tell a clean build from a misleading one. Also use when: X_base, _base forgotten export, Schema.Class base, ae-forgotten-export, ae-unresolved-link, link selector, link to an overloaded function, link to a namespace member, link to an inherited member, link to a schema field, cross-package link, suppressWarnings _base, suppressed bucket, zero-warning issues.json"
---

# API Extractor × Effect class factories

`class X extends Schema.Class<X>("X")({...}) {}` (and `TaggedClass` /
`TaggedError` / `Opaque` / `Context.Service`) produces an anonymous
heritage type. API Extractor reports it as `ae-forgotten-export` on a
synthesized `X_base` symbol — CI-fatal under `effected package build`.

## The policy: inline factory + scoped `_base` suppression

Write the factory **inline** — no split-out base const, no hand-written
annotation — and suppress the synthesized-base warning narrowly. The build's
default `meta.tsdoc.suppressWarnings` is exactly that one rule, so a package
with no `effected.toml` already has it. A package that sets its own list
replaces the default and must restate the rule in its `effected.toml`:

```toml
[package.build.meta.tsdoc]
suppressWarnings = [{ messageId = "ae-forgotten-export", pattern = "_base" }]
```

```text
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
bucket. The same form holds for recursive `Schema.Class` + `Schema.suspend`,
`Context.Service` and named field-schema consts, with no annotation and no
`@public` on the consts. A `@public X_base` const is the retired idiom: inline
the factory and delete the const.

When a reviewer asks why suppressing is not a cop-out, or a recursive class or
`Context.Service` seems to need a base annotation, load
[class-factory-bases.md](references/class-factory-bases.md) before you add one:
it holds the emitted `.d.ts` that proves the base is internal and the factory
kinds the inline form is proven on.

## The suppression covers `_base` ONLY

`pattern: "_base"` matches only the synthesized bases, by design, so genuine
surface leaks are never masked. The binary release-tag rule still applies:
*anything a `@public` signature names must itself be `@public`*. Two leaks it
does not cover, both real and both to be fixed, not suppressed:

- **An internal type on a `@public` method or function signature** — watch the
  `X.fromRaw` / `X.of` / codec-adapter statics that bridge an internal engine to
  the public classes. **Inline the type structurally** on the signature (best
  for anything under `src/internal/`), or tag it `@public` and re-export it when
  it is genuinely API.
- **An unexported interface passed as a factory's type argument**
  (`Context.Service<VersionCache, VersionCacheShape>()`,
  `Schema.Class<Self, Fields>`) — it leaks under its own name, which has no
  `_base` suffix. **Export the shape type**: it is the service's contract.

**Three escapes that look like they should work and do not:**

| Attempted escape | Result |
| --- | --- |
| Mark the *method* `@internal` and leave it on the `@public` class | **Still fails.** The gate follows the class's release tag; an `@internal` method of a `@public` class is still reachable rollup surface. |
| Mark the *referenced type* `@internal` | **Still fails**, and differently — now you get `ae-incompatible-release-tags` instead. `@internal` never resolves an `ae-forgotten-export`; it only relabels the problem. |
| Extract the shape to a named `type` alias and use that | **Still fails.** An alias is a named symbol like any other, so it forgotten-exports under its own name. Naming the thing is precisely what you cannot do. |

Only two things work: **inline the type structurally** (no name exists, so
nothing can be forgotten), or **export it** and accept it as public API. A
declared dependency's own generic (octokit's `Endpoints[R]`, say) is the
opposite case: API Extractor imports it as an external, so name the precise
third-party type rather than widening to `unknown`.

Before you widen a suppression pattern, or when a forgotten-export names a
type that is not an `X_base`, load
[class-factory-bases.md](references/class-factory-bases.md): it has the
structural-inline signature, the type-argument leak with its exact diagnostic,
and the declared-dependency condition for third-party types.

## TSDoc `{@link}`: the one rule

> `{@link}` resolves **only to symbols the entry point exports, under the name it
> exports them by**. Everything else is a backtick span.

Read the diagnostic rather than pattern-matching on "unresolved":

| Diagnostic says | Means | Fix |
| --- | --- | --- |
| *"ambiguous… add a TSDoc member reference selector"* on a merged value + type name | A selector works | `{@link (ConfigCodec:interface)}`, `:variable`, `:class`, `:type`; never delete the link |
| *"ambiguous…"* on an overloaded function | The selector is the 1-based overload index, parenthesized | `{@link (descend:1)}`, not `:function` |
| *"ambiguous…"* on a same-named `static` and instance member | No selector is accepted | Remove the collision, else backticks |
| *"does not have an export"* | No selector ever will | Link through the exported const (`{@link Walker.ascend}`), else backticks |
| *"not supported yet by the resolver"* | The resolver cannot follow the declaration | Backticks |

Backticks are the only answer for an inherited member (`SemVer.make`), a
`Schema.Class` field, a symbol you only `import type` from another package, a
module-private const, and a root-only symbol linked from a second entry
point's module.

Two traps that report on the wrong line:

- **Never markdown-link a scoped package name in TSDoc**, in the label or the
  URL: the URL's bare `@scope` trips `tsdoc-at-sign-in-word`, reported at the
  next declaration. Backtick the name; put a bare URL beside it if it matters.
- **A backtick code span must open and close on one comment line.** A span
  wrapped by reflow fans out into `tsdoc-code-span-missing-delimiter`,
  `tsdoc-escape-right-brace` and `tsdoc-malformed-inline-tag` warnings below
  the comment. Rejoin the span; never escape the braces.

`issues.json`'s `line` indexes the generated `.d.ts`, not your source, so find a
`tsdoc-*` or `ae-unresolved-link` defect by its text.

Before you fix any `ae-unresolved-link`, `tsdoc-at-sign-in-word` or
`tsdoc-code-span-missing-delimiter`, load
[link-resolution.md](references/link-resolution.md): the overload, field and
selector-keyword cases each look like a selector problem and are not, and a
wrong selector or an escaped brace costs a full build cycle to discover.

## Entry points

Each entry point in `exports` is its own API Extractor pass and its own closed
surface. **Re-export from a second entry point (`./testing`, `./node`) every
kit type its own signatures name**; "already exported from `.`" never satisfies
that entry point's gate. A bin-only package (`exports` only
`"./package.json"`) fails with `Cannot merge zero API models`: set
`[package.build] emitDts = false`, never a fake `index.ts`.

Before you add a second subpath, make one import its own root's types, or
build a bin-only package, load [entry-points.md](references/entry-points.md):
the self-import pattern needs three parts together (`dtsExternals`, an
entry-scoped suppression and a declaration test), and two alone hide a real
leak.

## Reading the gate

`issues.json` is a **false-green oracle**. **Read `buildOk` first**: a crashed
build leaves every bucket empty, exactly like a clean one, and a package with
class factories always has at least one `_base` entry in `suppressed`. Trust a
read only right after your own serial, cold, exit-0 build: an incremental build
can hide warnings and a concurrent build tears `dist/`.

Before you report a package build as clean, load
[reading-the-gate.md](references/reading-the-gate.md): it has the four rules
that keep an empty `issues.json` from passing for a green one, and the
dollar-alias names that look like a defect and are not.

## Additional resources

- [references/class-factory-bases.md](references/class-factory-bases.md) — why the `_base` suppression is principled (the emitted `.d.ts`), the factory kinds it is proven on, the retired `@public X_base` idiom and the grep for packages that override the default, the internal-type-on-a-signature leak, third-party generics, and the type-argument leak with its diagnostic. Load when: a forgotten-export names a type that is not `X_base`, a reviewer challenges the suppression, a recursive class or `Context.Service` seems to need an annotation, or you find a `@public X_base` const.
- [references/link-resolution.md](references/link-resolution.md) — every way a name fails the export rule, member-reference selectors for merged names, const-only namespace members, the four backtick-only cases, the overload index selector and its probe table, selector-keyword member names, `tsdoc-at-sign-in-word` and `tsdoc-code-span-missing-delimiter`. Load when: the build reports `ae-unresolved-link` or a `tsdoc-*` code, you add an overload to an exported function, or you write a `{@link}` to a field, an inherited member or another package's type.
- [references/entry-points.md](references/entry-points.md) — a second entry point's own surface with a worked example, the three-part self-import pattern, and the bin-only `emitDts = false` shape. Load when: adding or reviewing a subpath export, a subpath's gate reports a forgotten export the root already exports, or a build fails with `Cannot merge zero API models`.
- [references/reading-the-gate.md](references/reading-the-gate.md) — the four rules for trusting `issues.json`, the `.d.ts`-relative line numbers and the dollar-alias names in built declarations. Load when: deciding whether a package build passed, a build looks flaky, or you are about to report a gate result.

## Related skills

`authoring-tsdoc` owns the general policy this skill assumes: the binary
release-tag rule, the supported-tag allow-list, custom tags, when a
suppression is legitimate, the `typeof local` forgotten export, and every
other `ae-*`/`tsdoc-*` fix. Load it when the diagnostic is not about a class
factory, a link or an entry point. `building-a-package` owns `effected.toml`
and the build itself; load it before you change a build key. The `tsdoc-fixer`
agent carries all three and runs the fix loop end to end.
