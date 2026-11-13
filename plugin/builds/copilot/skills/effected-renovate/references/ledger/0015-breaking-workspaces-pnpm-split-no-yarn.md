---
id: "0015"
title: "@effected/workspaces: PnpmSettings and PeerDependencyRules come from @effected/pnpm, yarn roots are refused, and link:/file: catalog entries resolve as written"
kind: breaking
shows: typed
applies:
  "@effected/workspaces": ">=0.48.0"
detect: ["PnpmSettings", "NoPeerDependencyRules", "PeerDependencyRules", "peerDependencyRules:[[:space:]]*\\{", "\"yarn\"", "yarn\\.lock"]
changesets: ["workspaces-pnpm-split-no-yarn"]
---

Act on each hit:

1. **`PnpmSettings`, `PnpmSettingsError` and their option and source types are `@effected/pnpm`'s.** Where a hit imports them from `@effected/workspaces`, import them from `@effected/pnpm` and add that package to the dependencies (`catalog:effected`). The load options keep their shape.
2. **`PeerDependencyRules` is a class in `@effected/pnpm`, and `NoPeerDependencyRules` is gone.** Replace `NoPeerDependencyRules` with `PeerDependencyRules.empty`. An object literal no longer satisfies `PeerCheckOptions.peerDependencyRules`: build one with `PeerDependencyRules.make({ ... })`; every axis is optional.
3. **Yarn is unsupported.** `"yarn"` is no longer a `PackageManagerName`. Acting on a yarn root (`LocalExec`, `localExecContextSync`, package-manager detection) fails `UnsupportedPackageManagerError`, and a root whose only evidence is an undeclared `yarn.lock` now reports unsupported where it used to fall back to npm. Discovery still reads a yarn repository's `package.json#workspaces`. Remove yarn branches, and handle the new error where your code meets arbitrary repositories.
4. **Catalog resolution follows pnpm 12**: a `link:` or `file:` catalog entry resolves as written. Check any test that asserted a rewritten form.

Check each name against the installed `.d.ts`, then run the typecheck and tests.
