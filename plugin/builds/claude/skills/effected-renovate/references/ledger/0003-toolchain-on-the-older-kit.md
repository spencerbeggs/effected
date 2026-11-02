---
id: "0003"
title: Build tools still on the 4.0.x kit load a second Effect
kind: tooling
shows: none
applies:
  effect: ">=4.1.0"
detect: ["readPackage([^A-Za-z]|$)", "packageExtensions"]
---

Every kit package's `effect` peer is now on the 4.1 minor (`~4.1.0`). A kit package built on Effect 4.0.x does not satisfy it and cannot be mixed in, and a published kit built on 4.0.x imports `Crypto` from the `effect` root, which 4.1 removed: under the plugin's graph-wide `effect` override it binds the new `effect` and dies at import (`does not provide an export named 'Crypto'`).

That matters when your **build toolchain** loads published `@effected/*` packages: packages you build with rather than ship, such as `@savvy-web/*`, okfit, tsdoctor or vitest-agent.

What to do:

1. **Update the toolchain first.** The published toolchain has moved to the 4.1 kit: bump `@savvy-web/pnpm-plugin-silk` with the other config dependencies, and `@vitest-agent/*`, `@savvy-web/*` and `@okfit/*` to their latest releases. Usually that is all it takes, and no bridge is needed.
2. **Check for a second copy** after the reinstall: `grep -nE "^  effect@[0-9]" pnpm-lock.yaml` must print one version. If it prints two, find the puller with `pnpm why effect`. Compare each `@effected/*` package you use (`pnpm view @effected/<pkg>@<version> peerDependencies`) against what you declare, and run `pnpm peers check`. Never silence a warning.
3. **Only if a tool you cannot update still runs the 4.0.x kit**, bridge it with a root `.pnpmfile.cjs` `readPackage` hook that turns that tool's, and the published kit's, `effect` and `@effect/*` 4.x edges into regular dependencies on npm aliases of the old release (`npm:effect@4.0.7`). The alias slips past the plugin's version-selector override. Bridge the tools that load the kit too, not only the kit: a tool on the new `effect` handing values to a kit on the old one runs two copies and crashes (`Cannot convert a Symbol value to a string`). A `packageExtensions` entry cannot do this, because it selects by version and your workspace may hold the same versions. Leave `private` workspace packages alone, and skip `@effect/tsgo` and `@effect/language-service`, which version separately. Also bridge every effect-line package at exactly the old version, or an override lifts a satellite such as `@effect/platform-node-shared` onto the new release bound to the old `effect` (`Cannot find module …/effect/dist/process/CommandLine.js`).

After a bridge, confirm no lockfile snapshot pairs a 4.1 satellite with the old `effect` (`grep -E "@4\.1\.[0-9]+\([^)]*effect@4\.0\." pnpm-lock.yaml` prints nothing), your importers resolve the new `effect`, and each tool's CLI starts. Remove the hook once every tool has republished on the 4.1 kit.

Detect hits name existing `readPackage` hooks and `packageExtensions` entries: an old Effect bridge among them may now be removable, or may be fighting the new catalog.
