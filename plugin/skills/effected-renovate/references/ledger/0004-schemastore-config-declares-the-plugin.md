---
id: "0004"
title: "@effected/plugin belongs in the manifest of the package that holds schemastore.config.*, not only the root"
kind: tooling
shows: behavioural
applies:
  "@effected/schemastore": ">=0.30.0"
detect: ["defineSchemastore", "defineConfig.*from \"@effected/schemastore\"", "\"@effected/schemastore-cli\""]
closes: ["spencerbeggs/effected#1243"]
---

This corrects step 2 of the entry that replaces the `schemastore` bin and `@effected/schemastore-cli` with `effected schema`. That step says to add `@effected/plugin` as a root devDependency. Do this instead:

- **Declare `@effected/plugin` in the manifest of the package that holds the `schemastore.config.*`**, through `catalog:effected` where the repository uses the catalog. That is the root only when the config is at the root. A config at `package/lib/configs/schemastore.config.ts` needs it in `package/package.json`.
- **Keep it at the root as well** when the `effected` bin runs from the root, such as a root script or CI step that calls `effected schema check`.
- **Delete `@effected/schemastore-cli` from every manifest that listed it**, as before.

The import of `defineSchemastore` from `@effected/plugin` resolves through the root `node_modules` either way, so the build and `effected schema` pass with a root-only declaration. Biome does not: its `noUndeclaredDependencies` rule checks an import against the nearest manifest, and reports `Dependency @effected/plugin isn't specified in package/package.json`. Declaring it in that package also puts the `effected` bin in the package's own `node_modules/.bin`.

Verify by running the repository's lint on the config file and `effected schema check` on the config, from the directory its scripts run in.
