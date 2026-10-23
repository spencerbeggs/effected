---
"@effected/schemastore": minor
"@effected/schemastore-cli": minor
---

## Breaking Changes

### `HostedSchema.resolvedCurrent` returns `Option`

In `@effected/schemastore`, `HostedSchema.resolvedCurrent` returns `Option<SchemaVersion>` instead of the version or `undefined`.

### Stricter config validation in `@effected/schemastore-cli`

A config is now validated by one Schema decode that reports every problem. `ConfigLoadError.reason` is a list of `<message> at <path>` clauses joined by `; `. These configs used to load and are now rejected:

- `onDrift` missing, or set to anything other than `error` or `warn`
- a schema `drift` other than `strict`, `semantic` or `allow`
- `catalog` present but `undefined`
- a catalog `fileMatch` element that is not a string
- a non-string value in the optional catalog `versions` record, which the old checker never read
- a `target.schema` that is not a Schema

The types are unchanged; the CLI's behaviour and error output change.
