---
"@effected/github": minor
---

## Dependencies

| Dependency              | Type           | Action  | From           | To           |
| :---------------------- | :------------- | :------ | :------------- | :----------- |
| effect                  | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 |

## Refactoring

- Adopted effect rc.108's relocation of `SchemaError` into the `Schema` module: the GraphQL `decode` signature now types its failure as `Schema.SchemaError`. The error surface is unchanged; no consumer action is required.
