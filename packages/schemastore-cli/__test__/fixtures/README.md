# Fixtures

Every fixture here is **hand-authored**; none is copied from an upstream
repository or produced by a tool. Each exists to pin one property of
`ConfigLoader` that the memfs unit tests cannot reach: the real-filesystem,
real-module-loader path through `jiti`.

## `basic/`

A minimal consumer repository as `@effected/schemastore` users lay one out:
a `schemastore.config.ts` at the root and the schema it publishes under `src/`.

- `schemastore.config.ts` imports `./src/config-schema.js` — a **`.js`
  specifier that resolves to a `.ts` source**, the NodeNext shape the consumer
  repos use. That is the property the fixture pins: `jiti` (2.6.x, as
  declared in this package's `package.json`) must transpile the config in
  place and follow that specifier, with the config file itself as the
  resolution base so `@effected/schemastore` resolves from the consumer's
  side, not the CLI's.
- It declares one **versioned** target (`name` + `version: "1.0"`) plus a
  **catalog** entry of the same name, so the loaded config exercises
  `defineConfig`'s catalog assembly (`entry.url`) and the loader's resolution
  of both the target `path` and the catalog `path` against the config's
  directory.

The fixture has no oracle output: the integration test asserts on the loaded
value, not on a generated file. It is exercised by
`__test__/integration/config-loader.int.test.ts` alone.
