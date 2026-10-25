---
type: Gotcha
title: "New ae-forgotten-export errors after a bundler bump are TypeScript 7.1 emitting typeof a module local, not a bundler regression"
description: "Since @savvy-web/tsdown-plugins 2.11.0 (bundler 2.6.1) declarations come from TypeScript 7.1, which types a public member whose initializer is a bare non-exported local as typeof that local; API Extractor reports ae-forgotten-export (CI-fatal) and the API docs show no signature. Fix the site by inlining, a static method, or an explicit annotation; never suppress, never export the local."
status: draft
stale_after: "2027-04-25T00:00:00Z"
tags: [ci, dx, docs, compat]
sources:
  - id: systems-issue-824
    resource: https://github.com/savvy-web/systems/issues/824
  - id: systems-gotcha
    resource: https://github.com/savvy-web/systems/blob/main/okf/gotchas/tsgo-typeof-forgotten-export.md
  - id: integrity-hash-ts
    resource: ../../packages/npm/src/IntegrityHash.ts
  - id: spdx-expression-ts
    resource: ../../packages/spdx/src/SpdxExpression.ts
generated:
  by: "okfit/claude-code"
  at: 2026-10-25T19:59:29Z
integrity:
  generated:
    body: bc469123ea5a912c
  verified:
    by: human:spencer
    at: 2026-10-25T20:07:35Z
    content: 91997e8132de3136
verified:
  - by: human:spencer
    at: 2026-10-25T20:07:35Z
---

# New ae-forgotten-export errors after a bundler bump are TypeScript 7.1 emitting typeof a module local, not a bundler regression

## What a reader sees

After `@savvy-web/bundler` 2.6.1 (`@savvy-web/tsdown-plugins` 2.11.0 or
later), a package whose source did not change fails its prod build with
`ae-forgotten-export`, one per affected member, and its API docs page
renders those members with no signature. The signal comes from the
bundler's declaration emit, outside this repository.[^systems-issue-824]

## What a reader wrongly concludes

That the bundler regressed, or that the named symbol needs an `export`
keyword or a suppression entry in `savvy.build.ts`.

## What is actually true

Declarations are now emitted by TypeScript 7.1 (tsgo). A public member
whose initializer is a bare identifier naming a non-exported module local
is declared as `typeof local`, where TypeScript 6 inlined its
signature.[^systems-gotcha] The three shapes:

- a class static, `static readonly x = x`;
- an `Object.assign` statics object, `Object.assign(schema, { isRange })`;
- an object literal, `{ firstMatch, layeredMerge } as const`.

API Extractor then sees a public declaration naming an unexported symbol.
This is a different symbol from the un-nameable `_base` heritage type in
[the class-factory gotcha](api-extractor-forgotten-export-on-class-factories.md):
that one has nothing to export and takes a narrow suppression; this one has
a real signature the emit lost, and the site is fixed.

## The rule

Fix each site, in this order of preference:

1. **Inline the body into the member**, so the initializer is the function
   itself rather than a reference to it.
2. **Convert the member to a static method.**
3. **Annotate the member's type explicitly**, with a one-line reason at the
   site, when the local must stay (it is reused, or recursive).[^spdx-expression-ts]

Type an `Object.assign` statics object with an exported `*Statics`
interface (`IntegrityHashStatics`, joined to the schema type with `&`, the
literal checked with `satisfies`).[^integrity-hash-ts] Never suppress the
warning and never export the local to silence it: either leaves the docs
without a signature. The branch that adopted 2.6.1 cleared 174 such
warnings across 15 packages this way.

## The check

The diagnostic names a lowercase local (`isRange`, `parseResult`) rather
than a `*_base` symbol, and the member's `.d.ts` line reads
`typeof <name>`. After the fix, the build's `issues.json` has no entry for
it in either the warnings or the suppressed bucket.

[^systems-issue-824]: <https://github.com/savvy-web/systems/issues/824>
[^systems-gotcha]: <https://github.com/savvy-web/systems/blob/main/okf/gotchas/tsgo-typeof-forgotten-export.md>
[^integrity-hash-ts]: `packages/npm/src/IntegrityHash.ts` — `IntegrityHashStatics`
    and `CorepackIntegrityHashStatics`.
[^spdx-expression-ts]: `packages/spdx/src/SpdxExpression.ts` — the annotated
    facade locals, each with its reason comment.
