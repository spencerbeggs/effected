---
"@effected/schemastore": minor
---

## Dependencies

| Dependency | Type           | Action  | From           | To             |
| :--------- | :------------- | :------ | :------------- | :------------- |
| effect     | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

## Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.

## Bug Fixes

- `StoreDocument` assembly now correctly names an encoded-side `$defs` entry with an `Encoded` suffix (e.g. `PersonEncoded`) when the encoded AST has no identifier of its own, matching upstream's updated encoded-schema naming in `4.0.0-beta.107`. Consumers that pinned generated `$defs` keys by name should re-check them after upgrading.
