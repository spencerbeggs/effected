---
"@effected/jsonl": minor
---

## Dependencies

| Dependency              | Type           | Action  | From           | To           |
| :---------------------- | :------------- | :------ | :------------- | :----------- |
| effect                  | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 |

## Refactoring

- Adopted effect rc.108's relocation of `SchemaError` into the `Schema` module: `InvalidData`'s self-schema now declares via `Schema.isSchemaError`. The error surface and call shapes are unchanged; no consumer action is required.
