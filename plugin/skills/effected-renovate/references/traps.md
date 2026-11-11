# Traps

Things the upgrade process has hit in real repositories, each with what it looks like and what it actually is. The first section is the base and stays across releases; the second collects traps found since the last ledger reset.

## Standing traps

| Looks like | Actually |
| --- | --- |
| A green install with none of the new versions | The lockfile was kept. Its config-dependency document pins the old plugin; drop the lockfile and reinstall. |
| `npm view` fails with `EBADDEVENGINES` | npm enforces `devEngines.packageManager` in a pnpm repository. Use `pnpm view`. |
| `pnpm clean` deleted something unexpected, or nothing | A root `clean` script overrides the built-in. Read it before running step 2. |
| `does not provide an export named …` at import, from a published kit package | A kit package took a peer from another release line: two Effect minors, or a tool on the previous kit release whose caret ranges let a newer kit patch land beside an older peer. Step 3's `stale-edges.mjs` lists the stale edges and prints the parent-scoped override bridge. |
| `Layer<…> is not assignable to Layer<…>` with identical-looking types | Two resolved copies of `effect` or a kit package, not a signature change. Check the lockfile before the `.d.ts`. |
| `Cannot find package 'tsx'` then `pnpmfile worker exited` on an install with no `node_modules` | The install inherited `NODE_OPTIONS=--import=tsx`. pnpm writes the workspace's `nodeOptions` into the environment of every process `pnpm run`, `pnpm exec` or a lifecycle script starts, turbo tasks under them included, and a `pnpm install` started from one passes it to the Node process that loads pnpmfiles, which dies on the import before tsx is installed. Run step 2 from a plain shell, or prefix it with `NODE_OPTIONS=`. `--config.node-options=` alone does not help. |
| A missing native binary after install | `--ignore-scripts` skipped postinstall builds. `pnpm rebuild <name>`. |
| A clean local build, then API Extractor errors in CI | Its findings are warnings locally and fatal in CI. Read `issues.json`, not the build log. |
| `pnpm peers check` crashes with `ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC` | A pnpm bug with config-dependency catalogs in peers. Report it and check packages one at a time with `--filter`. |
| `Cannot find module 'effect/package.json'` from the root after a good install | `node -p` resolves from the current directory, and the root does not declare `effect`. Check with `pnpm why effect --depth 0` instead. |
| Biome's `noUndeclaredDependencies` reports `@effected/plugin` in a workspace package | The package holds a `schemastore.config.*` that imports from `@effected/plugin`, which only the root declares. Declare it in that package too. |
| `TS2883: The inferred type of '…' cannot be named without a reference to '…' from '../../<sibling>/node_modules/…'` after a kit bump, in a package that never imports the named package | A kit package's declarations stopped importing that package, so the dependent's program no longer resolves it from its own `node_modules`. Declaring it does not help. Re-export the types from the sibling that does import it, as in `export type { ConfigCodecError, ConfigReadError } from "@effected/config-file"`, and name them through that sibling. |

## Found this round

<!-- effected-renovate: traps found since the last ledger reset go below this line -->
