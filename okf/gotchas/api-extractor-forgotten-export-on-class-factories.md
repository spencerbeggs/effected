---
type: Gotcha
title: "ae-forgotten-export on _base looks like a real export bug; it is a synthesized, un-nameable symbol"
description: API Extractor reports ae-forgotten-export on the anonymous heritage base an Effect class factory synthesizes; the fix is a narrow, logged suppression, never a hand-written base export.
status: stable
stale_after: "2027-03-13T00:00:00Z"
resource: ../../packages/config-file/savvy.build.ts
tags:
  - ci
  - dx
sources:
  - id: config-file-build
    resource: ../../packages/config-file/savvy.build.ts
  - id: config-file-md
    resource: ../../packages/config-file/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 8de5398de96add59
---

# ae-forgotten-export on _base looks like a real export bug; it is a synthesized, un-nameable symbol

## What a reader sees

A package build using `@savvy-web/bundler`'s API Extractor pass fails
CI-fatally with `ae-forgotten-export` naming a symbol like
`ConfigFile_base` or `SemVer_base` — a name that appears nowhere in the
package's source. The diagnostic reads exactly like every other
forgotten-export warning: "this type is referenced by an exported
declaration but is itself not exported."

## What a reader wrongly concludes

That some internal helper type needs an `export` keyword added, or that
a base class was accidentally left un-exported and needs to be split out
into its own `@public` const so API Extractor can see it.

## What is actually true

Effect class factories — `Schema.Class`, `Schema.TaggedClass`,
`Schema.TaggedError`, `Schema.Opaque`, `Context.Service` — produce an
anonymous heritage type at the call site
(`export class X extends Schema.Class<X>("X")({...}) {}`). API Extractor
names that anonymous base `X_base` in its emitted report and flags it as
forgotten, because the base genuinely has no name a consumer could ever
import — it is inlined into the exported class's own `.d.ts` shape, not
a separate declaration. There is nothing to export, because there is
nothing nameable to export.

House policy is to write the class factory inline — no split-out base
const, no hand-written annotation trying to name the anonymous type —
and suppress the synthesized-base warning narrowly in the package's
`savvy.build.ts`:

```typescript
tsdoc: {
  suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
},
```

`@effected/config-file`'s `savvy.build.ts` carries exactly this
suppression.[^config-file-build] The suppression is scoped to the
`_base` pattern only: it still shows up in the build's `issues.json`
under the `suppressed` bucket rather than disappearing silently, and it
must never be widened. An internal type named on a `@public` method or
return signature is a different symbol that also trips
`ae-forgotten-export` and genuinely needs fixing — either inlined
structurally or promoted to `@public` — because that one is real surface
a consumer can actually reach, unlike the un-nameable `_base` heritage
type.[^config-file-md]

## The check

Confirm a `savvy.build.ts` diagnostic names a `*_base` symbol before
reaching for the suppression, and confirm the package's `issues.json`
still lists it in `suppressed` (not silently absent) after adding the
entry — a suppression that vanishes the diagnostic from the report
entirely, rather than moving it to the suppressed bucket, is being
applied more broadly than the narrow pattern allows.

[^config-file-build]: `packages/config-file/savvy.build.ts:7` —
    `suppressWarnings: [{ messageId: "ae-forgotten-export", pattern:
    "_base" }]`.
[^config-file-md]: `packages/config-file/CLAUDE.md` §"The codecs" /
    testing section — "`savvy.build.ts` carries a narrow suppression …
    Never widen it."
