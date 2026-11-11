---
"@effected/ai-plugins": patch
---

## Bug Fixes

* The `effected-renovate` `applicable.mjs` no longer crashes with `ENOBUFS` on a repository with minified bundles: it raises its git buffer, skips committed build output in detect searches and caps each hit line
* The renovate install step clears `NODE_OPTIONS`, because a session started through `pnpm run` inherits `--import=tsx`, which kills a fresh install before `tsx` exists

## Documentation

* The skills document the new action worker tables, the build lock and the workspaces sync throws, and the shell, walker, workspaces and npm changes
* The `effected-renovate` upgrade ledger records this release's kit changes in ten entries: the shell README guard bypass, the throwing `getWorkspacePackagesSync`, the engine build lock, the bundler worker tables, the memfs and walker path fixes, the `@rspack/*` release-age exemption, the per-worker import check and `NpmWorkspacePatterns` adoptions, and the check-run PATCH retrying a 404

## Maintenance

* Closes the `effected-renovate` upgrade-ledger round released in 0.51.0, so the shipped ledger starts empty from that release. A repository older than the new baseline still gets every entry it crossed, fetched from the 0.51.0 release tag.
* Three traps from the round move into the standing table: `effect/package.json` not resolving from the root, `noUndeclaredDependencies` on `@effected/plugin` beside a `schemastore.config.*`, and `TS2883` after a kit package stops importing a dependency in its declarations.
* The `NODE_OPTIONS` install trap joins the standing table
