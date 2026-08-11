---
"@effected/jsonc": minor
---

## Dependencies

| Dependency | Type           | Action  | From           | To             |
| :--------- | :------------- | :------ | :------------- | :------------- |
| effect     | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

## Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
- Updated `Jsonc`'s internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

## Bug Fixes

- Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report.
