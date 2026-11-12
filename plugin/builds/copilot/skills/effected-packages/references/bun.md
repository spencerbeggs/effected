# @effected/bun

The kit's package for what bun owns alone. Pure tier: `effect` is its only peer besides `@effected/semver` (which closes `@effected/npm`'s peer), and `@effected/npm` its only dependency.

The root entry exports nothing yet. bun's lockfile document grammar (`bun.lock`, `bun.lockb`) and `BunExtension` are bun's alone and move here from `@effected/lockfiles`; until they do, parse a bun lockfile with `@effected/lockfiles`' `Lockfile.parse`, which reports bun's catalogs on its `BunExtension`.

## What is not here

- **The `catalog:` and `workspace:` protocols.** bun reads them as pnpm 12 does, so the resolver contracts (`CatalogResolver`, `WorkspaceResolver`) and the specifier grammar (`DependencySpecifier`) are `@effected/npm`'s, and catalog assembly from a root `package.json` (`CatalogSet.fromManifestWorkspaces`) is `@effected/workspaces`'.
- **`bunfig.toml`.** No settings model exists in the kit.
