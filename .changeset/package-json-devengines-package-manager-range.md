---
"@effected/package-json": minor
---

## Features

### Read devEngines.packageManager as a PackageManagerRange

`PackageManagerRange.fromDevEngine(engine)` and `fromDevEngineResult(engine)` read a `devEngines.packageManager` entry onto the same model as the `packageManager` field. The entry's `version` holds the same `<range>[+<integrity>]` tail, and it is validated the same way. `range` gives the bare value to write back: the operator stays and the integrity goes, so `^12.6.0+sha512.<hex>` becomes `^12.6.0`. An entry with no `version` fails.

`PackageManagerRange.parse(input)` and `parseResult(input)` parse a `packageManager` string. Every entry point now fails with `InvalidPackageManagerRangeError`, whose `reason` names the part that failed: `"format"`, `"name"`, `"range"` or `"integrity"`. `FromString` decodes through `parseResult` and still reports a `SchemaError`.

Two renderings are new:

* `bare` renders `<name>@<range>`, without the integrity.
* `toString()` renders the value as it was parsed.

### Re-anchor a range on a new version

`PackageManagerRange.withVersion(version)` and `withVersionResult(version)` move a single exact, caret or tilde range onto a new version. They keep the operator and drop the integrity, so `^12.6.0+sha512.<hex>` moved to `12.8.1` gives `^12.8.1`. The new `operator` and `baseVersion` getters return the parts of such a range as an `Option`. A compound range, or a version that isn't pinnable, fails with `reason: "range"`.

`fromDevEngine` and `fromDevEngineResult` now also take a plain `{ name, version? }` object, the new exported `DevEnginePackageManagerEntry` type, so an entry read straight from `package.json` no longer has to be turned into a `DevEngine` first.
