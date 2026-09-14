# @effected/schemastore-cli

The `schemastore` command: a **bin-only** companion to `@effected/schemastore`. It loads a `schemastore.config.ts`, builds or checks every declared schema and catalog entry under a per-schema `published` flag and a drift policy, and reports to a terminal, JSON or a GitHub step summary.

**Design doc:** `@./okf/modules/schemastore-cli.md` — the config contract, the drift table, the command and exit-code contracts, and the reporting shapes. Read it before touching any of them.

## A companion package — bin-only, no tier

- Companion, not library: tier measures what an importer pays, and nothing imports this package (the `pnpm-plugin-effect` precedent; see `okf/glossary/companion-package.md`). It runs under a CLI environment and touches the filesystem, which would make a library integrated, but that cost falls on nobody.
- Its published surface is the `schemastore` executable and `./package.json`. **Never add an `exports` entry beyond `./package.json`**, and never add an `index.ts`: nothing is importable from this package. Every type a config needs (`defineConfig`, `SchemaTarget`, the versioning helpers) comes from `@effected/schemastore`.
- `savvy.build.ts` sets `emitDts: false`. There are no declarations to bundle and no API model to extract, and the bundler's prod meta pass refuses a package with zero entry points. No api-extractor model, no website page — the documentation is `--help`, the README and the library's page.
- It runs under `Command.Environment` (`NodeServices.layer` from `@effect/platform-node`), loads consumer TypeScript through `jiti`, and touches the real filesystem.

## The peer rule and why

`effect` and `@effected/schemastore` are **peerDependencies**, never dependencies. The consumer's config constructs `SchemaTarget` values and annotates schemas with symbols that the CLI's pipeline pattern-matches and `Schema.toJsonSchemaDocument` reads; a bundled second copy of either package would fail in ways no type-check catches. One `effect`, one `@effected/schemastore` instance — always.

## Release

A changesets **fixed** group holds `@effected/schemastore` and `@effected/schemastore-cli` at one version, and the CLI's peer range on the library is that exact version (`workspace:*` in source). The package `version` therefore always equals the library's.

## Modules (`src/`)

- `bin.ts` → `main.ts` — the process boundary and nothing else: the ONLY reads of `process.argv`/`cwd()`/`env`, then `NodeServices.layer`, `CliRuntime.reportFailures` (`3` fallback, renders `error.message`, `[]` for `ShowHelp`) and `NodeRuntime.runMain`.
- `cli/program.ts` — `program(args, deps)`: `Command.runWith` over the tree plus the exit-code mapping (`ShowHelp` → `64` with parse errors / `0` without; `ConfigNotFoundError`/`ConfigLoadError` → `2`, a load error's stack trimmed to its first line and the rest logged at debug) and `loggerLayer` (`CliLogger` with `stderrFrom: "All"` — stdout is `Console.log` only, every log level is stderr). Tests drive this over a test `Command.Environment`.
- `cli/root.ts` and `cli/commands/` — `makeCommands(deps)`: the command tree (`build`, `check`) closed over `ExecuteDeps` (`cwd`, optional `importModule` and `validator` test seams). Environment variables are never injected: they are read through `Config` against the ambient `ConfigProvider` (a `Context.Reference` defaulting to `fromEnv()`), and tests swap it with `ConfigProvider.layer(ConfigProvider.fromEnv({ env }))`.
- `cli/flags.ts` — the shared config argument and `--drift`/`--on-drift`/`--force`/`--format` flags. `--force` is sugar for `--drift=allow` and nothing else: combined with an explicit non-`allow` `--drift` it is a contradiction, not a precedence question.
- `cli/execute.ts` — the shared body: first, before the config loads, `--force` with an explicit `--drift` other than `allow` fails `ConflictingFlagsError` marked exit `64` (a usage error, never a silent resolution to `allow`); then load, merge flags over the config's drift block, run, emit, step summary, then `GateError`/`DriftError`, and for `check` a `StaleError` when any document would be written (all marked exit `1` — `check` is the CI gate, so a stale tree fails it). `DriftError` carries `drifted: [{ $id, change, version?, nextVersion? }]` — one entry per schema whose verdict is `drift`, `count` derived — and its message lists one line per schema.
- `ConfigLoader` — discovery and `jiti` loading of the config, `defineConfig` validation (exit `2`), plus the shape re-checks a forged brand could skip (a malformed target; a `catalog` that is not an array), each guarded ahead of the dereference it protects.
- `Runner` — the shared build/check walk over `SchemaPipeline`, drift table applied. A catalog entry is compared with ONE `readFileString` (`NotFound` → absent, unparseable → different) and the library's `CanonicalJson.equals`; no `exists` pre-check and no local `deepEqual`.
- `Report` — human and JSON renderers. The human summary's `drift` count is verdict-based: under `onDrift: warn` a drifting schema is written AND counted as drift, so the four counts need not sum to the schema total.
- `StepSummary` — the `GITHUB_STEP_SUMMARY` append (`Config.String(...).pipe(Config.option)`; an empty value is absent), logged-not-fatal.

## Testing and building

- `pnpm build --filter @effected/schemastore-cli`; never run `savvy.build.ts` directly. Confirm `dist/dev/issues.json` `generatedAt` postdates your edit.
- Prove the bin: `node dist/dev/pkg/bin/schemastore.js --help` exits `0`; `--bogus` exits `64`.
- Tests live in `__test__/`, drive `Command.run` in-process over `@effected/memfs`, and assert with `assert.*`. Run them with `vitest run --project @effected/schemastore-cli`.
