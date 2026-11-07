# Traps

Things the upgrade process has hit in real repositories, each with what it looks like and what it actually is. The first section is the base and stays across releases; the second collects traps found since the last ledger reset.

## Standing traps

| Looks like | Actually |
| --- | --- |
| A green install with none of the new versions | The lockfile was kept. Its config-dependency document pins the old plugin; drop the lockfile and reinstall. |
| `npm view` fails with `EBADDEVENGINES` | npm enforces `devEngines.packageManager` in a pnpm repository. Use `pnpm view`. |
| `pnpm clean` deleted something unexpected, or nothing | A root `clean` script overrides the built-in. Read it before running step 2. |
| `does not provide an export named …` at import, from a published kit package | Two Effect minors in the tree: a kit or tool built on one minor is loading the other. Step 3 finds it. |
| `Layer<…> is not assignable to Layer<…>` with identical-looking types | Two resolved copies of `effect` or a kit package, not a signature change. Check the lockfile before the `.d.ts`. |
| A missing native binary after install | `--ignore-scripts` skipped postinstall builds. `pnpm rebuild <name>`. |
| A clean local build, then API Extractor errors in CI | Its findings are warnings locally and fatal in CI. Read `issues.json`, not the build log. |
| `pnpm peers check` crashes with `ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC` | A pnpm bug with config-dependency catalogs in peers. Report it and check packages one at a time with `--filter`. |

## Found this round

<!-- effected-renovate: traps found since the last ledger reset go below this line -->

| Looks like | Actually |
| --- | --- |
| `Cannot find module 'effect/package.json'` from the root after a good install | `node -p` resolves from the current directory, and the root does not declare `effect`. Check with `pnpm why effect --depth 0` instead. |
| Biome's `noUndeclaredDependencies` reports `@effected/plugin` in a workspace package | The package holds a `schemastore.config.*` that imports from `@effected/plugin`, which only the root declares. Declare it in that package too. |
