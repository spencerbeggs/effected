---
"@effected/app": patch
---

## Documentation

The bundled effected plugin's package-index skill (`effected-packages`) is enriched across all 18 per-package references: each now enumerates the package's feature surface — services, schema classes, statics, options bags and error types — with generic usage examples distilled from real consumer integration, verified against the built declarations. Six stale claims were corrected along the way, including the single-entrypoint claim (workspaces now ships `./node-sync`), `Package.setVersion`'s string parameter, `GitHubAuth`'s real statics, and the previously undocumented `TsconfigLoaderSync` and `Manifest` surfaces.
