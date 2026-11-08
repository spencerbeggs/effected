---
id: "0016"
title: "@effected/npm: NpmRegistry.manifest reads a version's dependency fields through the registry service"
kind: adopt
shows: none
applies:
  "@effected/npm": ">=0.31.0"
detect: ["pnpm view", "npm view"]
closes: ["spencerbeggs/effected#1170"]
---

Offer this to the user; never apply it unasked. It removes the last reason to shell out to `pnpm view` beside `NpmRegistry`, which resolves one package through two registry and credential paths that can disagree.

`NpmRegistry.manifest(name, version, target?)` answers an `Option` of `VersionManifest`, carrying `name`, `version`, `dependencies`, `peerDependencies`, `optionalDependencies`, `peerDependenciesMeta` and `engines`. Each dependency field is absent when the document does not declare it. It routes as `version` does, GitHub Packages included, and takes the same `RegistryTarget`.

- A 404 or an absent version is `Option.none()`.
- A malformed dependency record fails `RegistryReadError` with kind `decode`, rather than reading as "no peers".
- An `engines` value in the legacy array form is omitted rather than failing the read.

Check the fields a shell-out's caller reads against what `VersionManifest` carries, because anything else in the document is not exposed. Read the installed `.d.ts` for the exact shapes.
