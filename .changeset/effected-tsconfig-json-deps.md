---
"@effected/tsconfig-json": patch
---

## Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/glob | peerDependency | added | — | 0.9.0 |

The package now declares its full `@effected` peer closure: every peer required by an `@effected` package it peers on, recursively. These packages were already needed at runtime through those peers; declaring them lets your package manager report a missing one instead of relying on whatever your install happens to contain.
