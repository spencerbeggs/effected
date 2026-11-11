---
id: "0012"
title: "ink moves from silk's catalog to effected:build"
kind: tooling
shows: none
applies:
  "@effected/pnpm-plugin-effected": ">=0.26.2"
detect: ["\"ink\":[[:space:]]*\"catalog:silk"]
changesets: ["ink-in-build-catalog", "cli-ink-build-catalog"]
---

The kit's catalog plugin now serves `ink` in `effected:build` and `effected:build:peers`, beside React, because it is the renderer the CLI layer's UI (`@effected/cli-kit`) runs on. silk's catalog still carries it for now and will drop it in a later silk release, so move off it this round.

Where the search matched, rewrite `"ink": "catalog:silk"` to `"ink": "catalog:effected:build"`, and `"ink": "catalog:silk:peers"` to `"ink": "catalog:effected:build:peers"`. Keep each entry in the field it was in (`dependencies`, `devDependencies` or `peerDependencies`).

Verify with `pnpm install` and `pnpm why ink --depth 0`: one `ink` must resolve, and a packed tool or library must still publish the same `ink` range it did before.
