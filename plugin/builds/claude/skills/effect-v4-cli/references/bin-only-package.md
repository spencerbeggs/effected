# A bin-only CLI package

Loaded from `effect-v4-cli`. Covers `emitDts: false`, the `exports: "./package.json"` shape, and why `Cannot merge zero API models` is not an extractor bug.

## A bin-only CLI package: `emitDts: false`, `exports` = `./package.json`

A CLI that exports nothing for import — `bin` only — is a legitimate package
shape, and the build pipeline has an opinion about it. With `exports` limited
to `"./package.json"` and no `index.ts`, the default `@savvy-web/bundler`
build still runs the declaration pass and then the prod meta (API Extractor)
pass over **zero** entry points, and dies with the opaque
`Cannot merge zero API models`. The switch is `emitDts: false` in
`savvy.build.ts` — documented on `BuildConfigInput.emitDts` as *"intended for
JS-only artifacts that never consume declarations (e2e fixtures, bins,
internal tools)"* — which skips the dts pass and, with nothing to read, the
meta pass, while still emitting JS, the byte-variant targets and the
transformed `package.json`:

~~~ts
// savvy.build.ts of a bin-only package
import { build } from "@savvy-web/bundler";

await build({ emitDts: false });
~~~

Three consequences follow, and each looks like a gap until you know why:

- **No `_base` suppression, no `tsdoc.json`, no api-extractor model, no
  website page.** There is no `.d.ts` to extract from. The documentation is
  `--help`, the README and the library page of the package the bin fronts.
- **Every type a consumer's config file needs comes from the library
  package**, never from the bin — a bin-only package has no import surface,
  so `defineConfig`-style helpers live in the sibling library.
- **Tooling that enumerates packages by their doc model must exclude it**,
  or it reports the bin as a perpetually missing build. The test is the
  `exports` map: every key is `"./package.json"`.

The trap this replaces: reading `Cannot merge zero API models` as an
extractor bug, or as a sign the bin needs an `index.ts` to satisfy the gate.
See `effect-api-extractor-bases` for how the gate reads for the *other* case.
