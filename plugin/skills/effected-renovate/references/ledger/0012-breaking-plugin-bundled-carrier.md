---
id: "0012"
title: "@effected/plugin bundles the tool's kit closure and effect: configs import their authoring surface from it, and nothing is installed through it"
kind: breaking
shows: behavioural
applies:
  "@effected/plugin": ">=0.6.0"
  "@effected/engine": ">=0.17.2"
detect: ["from[[:space:]]+[\"']@effected/schemastore[\"']", "\"@effected/plugin\""]
changesets: ["effect-4-1-4-plugin", "effect-4-1-4-engine"]
closes: ["spencerbeggs/effected#1338"]
---

The published `@effected/plugin` now carries the `effected` tool's whole closure inside its own dist: every `@effected/*` package it uses, `effect`, `@effect/platform-node` and `ajv`. Nothing in the tool resolves at install time, so the consumer's catalog, and the derived `effect` override, no longer reach into it. Its only dependencies are the build toolchain (tsdown, rolldown, rolldown-plugin-dts, `@tsdown/exe`, API Extractor and the TSDoc packages), `jiti`, Ink and React. `effect` is an optional peer, there only so a config's types check against your own `effect`.

Three things a consumer may have to change:

1. **A `schemastore.config.*` builds its values from `@effected/plugin`.** The tool runs its own bundled `@effected/schemastore`, and `effected schema build|check|validate` refuses (exit 2) a config whose values were built by a different schemastore version; the MCP tools run and return a version-mismatch warning. The plugin root now exports the whole authoring surface from the tool's own copy: `defineSchemastore`, `HostedSchema`, `SchemaTarget`, `SchemaVersion`, `SchemaVersioning`, `DriftPolicy`, `KeywordFamilies`, `CatalogEntry`, `SchemastoreVersion` and their types. Where the search matched an `@effected/schemastore` import in a config file, move the names in that list to `@effected/plugin`; a name the plugin does not export, such as `SchemaPipeline` or `SchemaFile`, stays imported from `@effected/schemastore`. `defineConfig` is not re-exported under that name: write `import { defineSchemastore } from "@effected/plugin"` and call `defineSchemastore(...)`. Values at the same schemastore version still interoperate across copies, so this matters as soon as the two drift.
2. **A `HostedSchema` your runtime code also uses** stays an import from `@effected/schemastore` in that code, and the config passes that same value as an entry's `hosted`. It passes the version check only while that copy matches the version the carrier bundles, so keep `@effected/schemastore` on `catalog:effected`, which moves with the carrier. It type-checks from `@effected/plugin` 0.6.2 and `@effected/schemastore` 0.33.1, which removed the class's private members. On `@effected/plugin` 0.6.0 and 0.6.1 the config fails `tsc` with `Types have separate declarations of a private property 'resolved'` on `hosted`, though `effected schema check` passes. Raise both packages rather than rebuilding the identity in the config from the plugin's `HostedSchema`: two derivations of one identity agree only while `schema check` keeps them equal. Where an earlier run did rebuild it, return the config to passing the runtime value.
3. **Declare what you import.** The carrier no longer installs `effect` or any kit package for you. Code that imported `effect` or an `@effected/*` package without declaring it, relying on the carrier's transitive install, now fails `ERR_MODULE_NOT_FOUND`. Where the search matched `"@effected/plugin"` in a manifest, check that every `effect` and `@effected/*` import in that package is declared in its own `dependencies` or `devDependencies`.

Verify by running `effected schema check` against your config, and the typecheck plus tests of every package that lists `@effected/plugin`.
