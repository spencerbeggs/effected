---
"@effected/lockfiles": patch
---

## Bug Fixes

### pnpm `npm:` aliases no longer report a false unresolved edge

pnpm records an aliased dependency (`typescript-classic: npm:typescript@^6.0.3`) with the referenced instance's own key as the version — `typescript@6.0.3`, peer suffix included when one applies. The bare `name@version` composition (`typescript-classic@typescript@6.0.3`) matches nothing, so the edge landed in `unresolvedEdges`, and one layer up `@effected/workspaces`' `PeerCheck` reported `unverified ("unresolvedEdge")` for a lockfile pnpm itself considers clean. A failed composition now gets a second reading — the recorded version itself as an instance id — on both the snapshot-body and importer paths. Still compose-then-verify: a plain version (`6.0.3`) can never be an instance id, because ids always carry a name, so the reading admits exactly the alias shape.

### Snapshot `link:` edges into a declared `publishDirectory` now resolve

`publishConfig.linkDirectory` makes a workspace link point at a package's publish directory (`link:packages/jsonc/dist/dev/pkg`), a build output that is no importer. The importer path already resolved these via the `workspace:`-specifier ancestor walk, but snapshot bodies carry no specifier, so their edges stayed unnameable. The lockfile itself supplies exact evidence: each importer entry may declare `publishDirectory`. The parser now reads it, builds a map from normalized `<importerPath>/<publishDirectory>` to the importer's instance id (the root importer's key is the normalized publishDirectory alone), and consults it on both paths — unconditionally, since a declaration is the lockfile's own claim rather than a guess. On the importer path it runs before the specifier-gated ancestor walk; a `link:` into a directory no importer declares stays honestly in `unresolvedEdges`.
