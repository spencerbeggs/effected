# @effected/schemastore-cli

The `schemastore` command: a **bin-only** companion to `@effected/schemastore`. It loads a `schemastore.config.ts`, builds or checks every declared schema and catalog entry under a per-schema `published` flag and a drift policy, and reports to a terminal, JSON or a GitHub step summary.

**Design doc:** `@./okf/modules/schemastore-cli.md` — the config contract, the drift table, the command and exit-code contracts, and the reporting shapes. Read it before touching any of them.

## Tier: integrated — and bin-only

- Its published surface is the `schemastore` executable and `./package.json`. **Never add an `exports` entry beyond `./package.json`**, and never add an `index.ts`: nothing is importable from this package. Every type a config needs (`defineConfig`, `SchemaTarget`, the versioning helpers) comes from `@effected/schemastore`.
- `savvy.build.ts` sets `emitDts: false`. There are no declarations to bundle and no API model to extract, and the bundler's prod meta pass refuses a package with zero entry points. No api-extractor model, no website page — the documentation is `--help`, the README and the library's page.
- It runs under `Command.Environment` (`NodeServices.layer` from `@effect/platform-node`), loads consumer TypeScript through `jiti`, and touches the real filesystem.

## The peer rule and why

`effect` and `@effected/schemastore` are **peerDependencies**, never dependencies. The consumer's config constructs `SchemaTarget` values and annotates schemas with symbols that the CLI's pipeline pattern-matches and `Schema.toJsonSchemaDocument` reads; a bundled second copy of either package would fail in ways no type-check catches. One `effect`, one `@effected/schemastore` instance — always.

## Release

A changesets **fixed** group holds `@effected/schemastore` and `@effected/schemastore-cli` at one version, and the CLI's peer range on the library is that exact version (`workspace:*` in source). The package `version` therefore always equals the library's.

## Modules (`src/`)

- `bin.ts` → `main.ts` — the assembled program: `Command.run`, the `ShowHelp` exit remap (`0` clean, `64` with parse errors), `CliRuntime.reportFailures` (`3` fallback), `CliLogger`.
- `cli/root.ts` and `cli/commands/` — the command tree (`build`, `check`).
- `ConfigLoader` — discovery and `jiti` loading of the config, `defineConfig` validation (exit `2`).
- `Runner` — the shared build/check walk over `SchemaPipeline`, drift table applied.
- `Report` — human and JSON renderers.
- `StepSummary` — the `GITHUB_STEP_SUMMARY` append, logged-not-fatal.

## Testing and building

- `pnpm build --filter @effected/schemastore-cli`; never run `savvy.build.ts` directly. Confirm `dist/dev/issues.json` `generatedAt` postdates your edit.
- Prove the bin: `node dist/dev/pkg/bin/schemastore.js --help` exits `0`; `--bogus` exits `64`.
- Tests live in `__test__/`, drive `Command.run` in-process over `@effected/memfs`, and assert with `assert.*`. Run them with `vitest run --project @effected/schemastore-cli`.
