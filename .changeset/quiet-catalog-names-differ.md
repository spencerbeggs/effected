---
"@effected/schemastore": minor
"@effected/schemastore-cli": minor
---

## Breaking Changes

### The merged catalog blocks on a duplicate entry name

The merged catalog now refuses two slices that advertise the same catalog `name`, exactly as it already refused a duplicate `url`: `build` and `check` exit `1` with `CatalogMergeError`, and the merged file is left untouched. Two configs in one `catalogDir` that each default to the same key-derived name passed before and now fail. Give one of them a `catalog.name`.

The `conflicts` entries in the `--format json` report and on `CatalogMergeError` are now discriminated by `kind`:

* `{ kind: "url", url, slices }` for a catalog URL advertised by more than one slice
* `{ kind: "name", name, slices }` for an entry name advertised by more than one slice

Code that read `conflict.url` unconditionally must narrow on `kind` first.

## Features

### `catalog.name` — a display name for the catalog entry

`defineConfig`'s `catalog` block takes an optional `name`, the catalog entry's display name. It defaults to the schema key, so existing configs produce identical output.

The key still names the file, the `$id` and every catalog URL. Only the entry's displayed name changes, so a versioned `<version>/<name>.json` layout with `appendVersion: false` keeps short file names while the catalog shows a descriptive name such as `reposets.config.toml`.

`defineConfig` rejects a config in which two cataloged schemas resolve to the same catalog name, whether set by `catalog.name` or defaulted from the key, and the error names both keys. Across configs, the merged catalog enforces the same rule (see Breaking Changes).

Closes #924.
