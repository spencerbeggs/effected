---
"@effected/tsconfig-json": patch
---

## Refactoring

`PortableTsconfig`, `ResolvedTsconfig`, `TsEnumCodec`, `TsconfigDiscovery`,
`TsconfigLoader` and `TsconfigLoaderSync` are now static classes with a
private constructor rather than `as const` namespace objects. Call syntax is
unchanged (`TsconfigLoader.resolve(...)`); each member's TSDoc now ships in
the built `.d.ts`, where an `as const` object's inferred member types
previously dropped it.
