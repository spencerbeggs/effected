---
id: "0017"
title: "@effected/npm: NpmConfig.load can read the project npmrc at the workspace root"
kind: adopt
shows: none
applies:
  "@effected/npm": ">=0.31.0"
detect: ["NpmConfig\\.load"]
closes: ["spencerbeggs/effected#1170"]
---

Offer this to the user; never apply it unasked. It fits a tool that runs from a member package of a monorepo, where the default lookup misses the root `.npmrc`.

`NpmConfig.load` takes two options beside `cwd` and `env`:

- **`workspaceRoot: true`** climbs from `cwd` to the nearest directory holding a `pnpm-workspace.yaml`, or a `package.json` with a `workspaces` field. With no such directory it falls back to the default lookup.
- **`projectDir`** names the directory outright, resolved against `cwd` when relative, and wins over `workspaceRoot`.

The default stays the nearest directory holding a `package.json` or `node_modules`, as npm does it, so nothing changes without an option. Drop a local climb that exists only to find this file. Read the installed `.d.ts` for the exact shapes.
