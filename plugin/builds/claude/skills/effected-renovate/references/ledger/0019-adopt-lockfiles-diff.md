---
id: "0019"
title: "@effected/lockfiles: LockfileDiff.compare reports catalog and importer changes between two lockfiles"
kind: adopt
shows: none
applies:
  "@effected/lockfiles": ">=0.23.0"
detect: ["compareLockfiles", "compareCatalogs", "compareImporters"]
closes: ["spencerbeggs/effected#1211"]
---

Offer this to the user; never apply it unasked. It replaces a local before-and-after comparison over the kit's `Lockfile` model, the kind an update tool runs to report what moved after an install.

`LockfileDiff.compare(before, after)` is pure and total. It answers `catalogs` and `importers`, plus a `hasChanges` getter. Each `CatalogChange` and `ImporterChange` carries `specifier` and `version` as `{ before, after }` and a `kind` of `added`, `removed` or `changed`. A `CatalogChange` also lists its `consumers`. An `ImporterChange` carries its `depType`.

Resolved versions are normalized across formats: pnpm's come from where it records them, and bun's and npm's through the importer's resolved edge to the package entry. Yarn always compares empty, because it records no importers or catalogs.

Check two things against a local version before swapping. Changes name importers by path (`.` for the root), so a report that shows package names keeps its own importer-to-package mapping. The default catalog is named `default` in every format. Read the installed `.d.ts` for the exact shapes.
