---
"@effected/schemastore-cli": patch
---

## Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/env | dependency | added | — | 0.1.0 |
| @effected/glob | dependency | added | — | 0.9.0 |
| @effected/walker | dependency | added | — | 0.14.1 |

The bin now depends on `@effected/env`, `@effected/walker` and `@effected/glob`, the new required peers of `@effected/cli`, so a global or `npx` install resolves them.
