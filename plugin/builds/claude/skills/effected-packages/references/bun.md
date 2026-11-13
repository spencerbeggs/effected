# @effected/bun

The kit's package for what bun owns alone. Pure tier: `effect` is its only peer besides `@effected/semver` (which closes `@effected/npm`'s peer), and `@effected/npm` and `@effected/jsonc` its dependencies. It never depends on `@effected/lockfiles`.

## Import

```ts
import { BunExtension, BunLockDocument } from "@effected/bun";
```

## Core API

- **`BunLockDocument`** (`Schema.Class`) — the text lockfile `bun.lock` as bun writes it: `lockfileVersion`, `workspaces` (keyed by workspace path, `""` for the root), `packages` (tuples kept as arrays of unknown values, since their shape is under-documented upstream), and the header `catalog`, `catalogs`, `overrides` and `trustedDependencies`. `BunLockDocument.parse(content)` → `Effect<BunLockDocument, LockfileDocumentError>` (the error is `@effected/npm`'s): `reason: "syntax"` for text that is not JSONC, with `line` from the first diagnostic, `"shape"` for the wrong shape. No `lockfileVersion` is rejected. The binary `bun.lockb` is not read.
- **`BunExtension`** (`Schema.Class`, `_tag: "bun"`) — the header fields bun alone records, as `@effected/lockfiles`' `Lockfile.extension` carries them.

To read a `bun.lock` into the manager-neutral `Lockfile` model (packages, importers, workspace edges), use `@effected/lockfiles`' `Lockfile.parse(content, { format: "bun" })`, which parses through `BunLockDocument` and normalises it.

## What is not here

- **The `catalog:` and `workspace:` protocols.** bun reads them as pnpm 12 does, so the resolver contracts (`CatalogResolver`, `WorkspaceResolver`) and the specifier grammar (`DependencySpecifier`) are `@effected/npm`'s, and catalog assembly from a root `package.json` (`CatalogSet.fromManifestWorkspaces`) is `@effected/workspaces`'.
- **`bunfig.toml`.** No settings model exists in the kit.
