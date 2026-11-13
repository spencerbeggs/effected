---
id: "0014"
title: "@effected/npm: ReleaseAgeGate moves to @effected/pnpm, the yarn shapes are gone, and @effect/platform-node is an optional peer"
kind: breaking
shows: typed
applies:
  "@effected/npm": ">=0.35.0"
detect: ["ReleaseAgeGate", "yarn-(classic|berry)", "isYarnChecksum"]
changesets: ["npm-transport-and-pnpm-split"]
---

`@effected/npm` now models only what npm, pnpm and bun share. Act on each hit:

1. **`ReleaseAgeGate` and `PartialReleaseAgeGate` live in `@effected/pnpm`.** Where a hit imports either from `@effected/npm`, import it from `@effected/pnpm` instead and add `@effected/pnpm` to the package's dependencies (`catalog:effected`). The names and shapes are unchanged; npm's own `min-release-age` is the separate `NpmReleaseAge` in `@effected/npm`.
2. **Yarn is not a manager this package models.** `PackageManagerPin`, `PackageManagerCache` (no `yarn-classic` or `yarn-berry`), `IntegrityHash` (no yarn checksum form, no `isYarnChecksum`), `PackageTarball` and `NpmConfig` drop their yarn branches, so a value that only decoded as yarn now fails to decode. Remove the yarn cases from your code; the compiler flags each reference to a removed member or literal.
3. **The Node transport is a subpath with an optional peer.** `NpmHttpClient` and `NpmTransportError` import from `@effected/npm/node`, which needs `@effect/platform-node` installed. The root entry never loads it.
4. **pnpm-mode proxy variables read upper case first** (`HTTPS_PROXY` before `https_proxy`) in `NpmConfig.proxyFor`, as pnpm 12 does. Check any test that sets both spellings to different values.

Check each name against the installed `.d.ts` of `@effected/npm` and `@effected/pnpm`, then run the typecheck and tests.
