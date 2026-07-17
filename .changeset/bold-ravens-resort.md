---
"@effected/package-json": minor
---

## Breaking Changes

### Canonical key order re-baselined to `sort-package-json@4.0.0`

`PackageFormatOptions`'s default sort (`sort: true`, the default) now places top-level keys in `sort-package-json@4.0.0`'s exact order rather than the kit's prior hand-maintained subset. This **changes the emitted bytes** of any `package.json` formatted with the default options — notably `packageManager` now sorts before `engines` / `devEngines`, and `sideEffects` moves after `publisher`, before `type`. `scripts`, `engines` and `bin` are now alphabetized alongside the dependency maps (previously only the dependency maps were sorted). An absent `scripts` key no longer materializes as `"scripts": {}` on encode — it's stripped like the dependency maps.

Anything that diffs or snapshots formatted `package.json` output — CI checks, golden fixtures — will see a one-time reformat on upgrade. Pass `sort: false` to opt out and preserve prior key ordering.

Because every `@effected/*` package is pre-`1.0.0` (majors are locked until Effect v4 GA), this ships as a `minor` rather than a `major` — treat it as breaking for compatibility planning regardless of the semver label.

## Features

### `PackageIndent` — tab and preserve-source indentation

`PackageFormatOptions.indent` widens from `number` to `PackageIndent` (`number | "tab" | "preserve"`). `"tab"` indents with real tabs; `"preserve"` reuses the indentation detected from the original source text.

```ts
import type { PackageFormatOptions } from "@effected/package-json";

const options: PackageFormatOptions = { indent: "preserve" };
```

### `sourceText` option

A new `sourceText` option backs `indent: "preserve"`: pass the original file text and its indentation (tabs vs. N spaces, detected from the first indented line) is reused; falls back to two spaces when absent. `PackageJsonFile.write` supplies the existing file's text automatically when `indent: "preserve"` is set without an explicit `sourceText` — reading the file being overwritten before it re-serializes.
