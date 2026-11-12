---
id: "0013"
title: "effected package build can bundle a tool's whole closure, dropping the inlined packages from its manifest and writing their licences"
kind: adopt
shows: none
applies:
  "@effected/bundler": ">=0.5.0"
  "@effected/plugin": ">=0.6.0"
detect: ["catalog:effected:exact"]
changesets: ["bundler-effect-helpers-and-bundled-closure"]
---

Offer this to the user; never apply it unasked. It applies only to a published tool on the kit (a package with a `bin`, a CLI or MCP server, or a plugin another repository installs) that pins its kit closure exactly today. Exact pins seal a tool's direct edges, but a regular dependency inside a kit library still floats, and the consumer's derived `effect` override still reaches the tool. Bundling closes both. `@effected/plugin` ships this way.

The bundler now supports it end to end:

- **`bundleNodeModules = true` with a `bundle` list** inlines those packages; a bare name such as `effect` covers its subpaths too.
- **A package inlined in every partition is dropped** from the emitted manifest's `dependencies` and `optionalDependencies`. Peers stay.
- **Each inlined package keeps its own version** where it reads `process.env.__PACKAGE_VERSION__`, so an inlined library reports its version, not the tool's.
- **`THIRD_PARTY_LICENSES.txt`** is written beside the bundle whenever another package's code was inlined.

Where the search matched `catalog:effected:exact` in a tool's manifest, read `@effected/plugin`'s `effected.toml` as the model. Keep external anything with native bindings, anything loaded by name or by path relative to its own install, and the build toolchain, and declare each of those on the tool's manifest; anything undeclared is inlined. Keep a cheap entry that config files import as its own bundle, apart from the bins. If the tool's public types mention `effect`, keep `effect` as an optional peer, so a consumer's types resolve against their own copy. Verify by packing the tool alone (`pnpm pack`), installing it in an empty directory, and running each bin; the manifest must list only the externals.
