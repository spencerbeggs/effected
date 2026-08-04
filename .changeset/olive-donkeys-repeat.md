---
"@effected/app": patch
---

## Documentation

Reconciles the "effected" plugin's package index with `@effected/schemastore@0.2.0`.

- Adds `effected-packages/references/schemastore.md`, the per-package reference the index row previously stood in for. Covers the emit pipeline as the entry point, the content-comparing file IO and its `outcome`-is-authoritative rule, change classification, the shipped ajv validation, and the assembly/lint/catalog/versioning surface.
- Corrects the `@effected/schemastore` routing row, which advertised **boundary** tier and "a `SchemaValidator` seam the consumer closes with ajv". Both became false when the package took ajv as a direct dependency and shipped the seam closed, so the row was directing agents to write an adapter that no longer exists.
- Removes the schemastore block from the plugin's construct-coverage allow list. That block documented itself as provisional — "writing `references/schemastore.md` removes this whole block, not just entries" — and the reference file is what removes it, rather than the block growing entries for each new export.
