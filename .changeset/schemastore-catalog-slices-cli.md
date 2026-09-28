---
"@effected/schemastore-cli": minor
---

## Breaking Changes

The CLI now builds catalogs from per-config slices and maintains the merged `catalog.json` itself. This follows the `@effected/schemastore` config change: `name` is required and `catalogPath` is replaced by `catalogDir`.

* The JSON report's `catalog` field is now `{ slice?, merged? }` instead of a single value.
* Configs without a `name`, or using `catalogPath`, are rejected when loaded.

## Features

### Slice-and-merge catalogs

Each config writes its own slice to `<catalogDir>/<name>.json`. The CLI maintains the merged `catalog.json` in `catalogDir`'s parent (default `<outputDir>/catalog.json`, the same URL as before). It is the url-sorted union of all slices, so the result is deterministic whichever config builds last.

* A duplicate url across slices blocks the merge with exit 1.
* An invalid slice blocks the merge with exit 1, naming each reason. A slice is invalid if it is not JSON, is not an array, is unreadable, or has an entry that fails decoding (including excess keys).
* A `catalogDir` that cannot be listed is a config error (exit 2), reported before anything is written.
* Orphaned slices and an orphaned merged file are reported, never deleted. The merged catalog keeps advertising an orphaned slice's entries until that slice is deleted.
* A slice claimed only through case folding is reported as `caseFoldedMatch`.

## Bug Fixes

* Two configs sharing an `outputDir` no longer clobber each other's `catalog.json` (#754).
* Step-summary table cells are escaped.
