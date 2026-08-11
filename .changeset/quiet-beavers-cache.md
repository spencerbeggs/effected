---
"@effected/store": minor
---

## Dependencies

| Dependency | Type           | Action  | From           | To             |
| :--------- | :------------- | :------ | :------------- | :------------- |
| effect     | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

## Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
