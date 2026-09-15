# Migrating a generator script

Repositories that adopted `@effected/schemastore` before the CLI each own a
`lib/scripts/generate-schema.ts`: a `targets` array, a `--check` flag that
calls `SchemaPipeline.check`, a `--force` flag that swaps the contract policy
to `"allow"`, a per-result log line, a `SchemaContractChangeError` handler
that names the next version, sometimes a `CATALOGUED` constant and a
hand-rolled catalog-entry write — plus a `__test__/generate-schema.test.ts`
that imports `targets` and asserts `SchemaPipeline.check` finds nothing to
write. Stripped of comments they are one program, and the CLI is that
program. What varies between them is exactly the config it takes.

## The mapping

| In the script | In the config / CLI |
| --- | --- |
| `export const targets: ReadonlyArray<SchemaTarget> = [ … ]` | `defineConfig({ outputDir, schemas: { <name>: { schema, … } } })` — one entry per schema, keyed by its file base name |
| `resolve(REPO_ROOT, "schemas", …)` paths | `outputDir` plus paths resolved against the config file's directory (absolute paths still pass through) |
| `SchemaVersioning.parseResult("5.0.0")` + `Result.getOrThrowWith` | `versions: ["5.0.0"]` (and `current`, if not the newest) — `defineConfig` parses each label and throws naming an invalid one |
| `SchemaVersioning.fileName(name, version)` in `path` | derived — `$id`, `path` and every catalog URL come from the schema's key, `outputDir`, `baseUrl` and `layout`; there is no `path` or `$id` to spell by hand |
| `const JSON_SCHEMA_OPTIONS = { onExcessProperty: "error" }` shared across targets | `jsonSchema: { onExcessProperty: "error" }` on each schema entry |
| `--check` / `--dry-run` → `SchemaPipeline.check` | `schemastore check` |
| `--force` / `--allow-contract-change` → `contractChanges: "allow"` | `--force` (sugar for `--drift=allow`) |
| `const CATALOGUED = false` selecting `"allow"` vs `"block-versioned"` | `published: false` on the schema entry; flip to `true` when the entry is accepted |
| `CatalogEntry.assemble({ name, description, fileMatch, baseUrl, versions })` + `Schema.encodeSync` + a file write | the `catalog: { description, fileMatch }` block on each schema entry — `name`, `url` and `versions` derive from the schema's own key and `versions`, and every entry lands in the single `catalogPath` file |
| a previous published label kept as a second `SchemaTarget` in the array | append the new label to `versions` and set `current`; the old label freezes and is verified, not regenerated |
| the `SchemaContractChangeError` handler printing `version → nextVersion` | the `DRIFT contract at published X → suggest Y` line and `nextVersion` in the JSON report |
| per-result `Effect.logInfo` of advisory findings | the indented finding lines under each schema |
| `NodeServices.layer` + `SchemaFile.layer` + `SchemaValidator.layer` wiring | the CLI's own runtime |
| `__test__/generate-schema.test.ts` asserting nothing would be written | `schema:check` in CI |
| `"generate-schema": "tsx lib/scripts/generate-schema.ts"` | `"schema:build": "schemastore build"`, `"schema:check": "schemastore check"` |

## Steps

1. Add `@effected/schemastore-cli` as a devDependency at the same version as
   `@effected/schemastore`. Keep `effect` and `@effected/schemastore`.
2. Write `schemastore.config.ts` beside the script (or at the repository
   root, where upward discovery finds it). Set `outputDir` to the directory
   the script wrote into, and for each target turn the `SchemaTarget.make`
   call into a keyed `schemas.<name>` entry: `name` becomes the key, `$id`
   and `path` are dropped (they are now derived), and `version` becomes
   `versions: [version]`.
3. Decide `published` per schema entry. A label that is already in the
   SchemaStore catalog is `published: true`; one still being iterated on is
   not.
4. If the script wrote a catalog entry, replace the assembled call with a
   `catalog: { description, fileMatch }` block on the matching schema entry —
   `name`, `url` and `versions` are now derived, never written. Set
   `baseUrl`/`layout` so the derived layout matches where the script actually
   wrote files: `baseUrl: "schemastore"` for a flat SchemaStore-hosted layout,
   or a custom `https://` `baseUrl` with `layout: "flat"` or `"versioned"`
   otherwise. A layout the config derives that does not match the script's
   old file locations means renaming files on disk — treat that move as the
   version bump it is, since it changes a URL a consumer may pin.
5. Replace the `generate-schema` script with `schema:build` and
   `schema:check`; point turbo's `build` at `schema:build`.
6. Run `pnpm schema:check`. `unchanged` on every line (exit `0`) proves the
   config reproduces the committed documents; `would write` (exit `1`,
   stale) means a target moved in translation — diff the generated file
   before trusting the config. `FrozenVersionMissingError` (exit `1`) means
   a `versions` label the config now advertises has no file on disk yet —
   either the file needs to be generated once as `current` and then frozen,
   or the label does not belong in `versions`.
7. Delete the script, its drift test, the `CATALOGUED` constant, the
   hand-written catalog-entry write, and `tsx` if nothing else used it. The
   remaining `__test__` files that assert on the *documents* (decoding a
   fixture against the emitted schema, say) stay — they test the schema, not
   the generator.

## What does not move

- The Effect Schemas and their annotations stay where they are; the config
  imports them.
- The `$id` constants (`SCHEMA_URL`) stay exported from the schema module so
  the runtime payloads and the config agree on one string.
- Any test that imported `targets` from the script now imports the config's
  default export and reads `.schemas`.
