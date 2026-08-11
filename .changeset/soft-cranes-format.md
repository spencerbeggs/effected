---
"@effected/yaml": minor
---

## Dependencies

| Dependency | Type           | Action  | From           | To             |
| :--------- | :------------- | :------ | :------------- | :------------- |
| effect     | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

## Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
- Updated `Yaml` and `YamlDocument`'s internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

## Bug Fixes

- Fixed parsing of block mappings that use explicit-key syntax (`? key` / `: value`) with a compact collection starting on the `:` line (YAML 1.2 `s-l+block-indented`). Previously the compact mapping's first key was consumed as a scalar value and the remainder became a phantom null-keyed entry, so two such entries failed with a spurious `DuplicateKey` — the shape pnpm 11 writes for lockfile snapshot keys longer than 1024 characters, which made real `pnpm-lock.yaml` files unparseable. Nested explicit entries also no longer swallow a following `?` key belonging to an ancestor mapping, and a genuine duplicate-null-key report now points at the offending `:` indicator instead of position 0:0.
- Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report.
