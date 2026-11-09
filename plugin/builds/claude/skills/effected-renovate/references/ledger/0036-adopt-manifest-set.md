---
id: "0036"
title: "[package.build.manifest] set writes string keys, name included, over the emitted package.json"
kind: adopt
shows: none
applies:
  "@effected/plugin": ">=0.4.0"
  "@effected/bundler": ">=0.2.0"
detect: ["pkg\\.name[[:space:]]*=[[:space:]]*[\"']"]
changesets: ["bundle-sidecar-renames"]
closes: ["spencerbeggs/effected#1302"]
---

Offer this to the user; never apply it unasked. It fits a package whose old build `transform` set `pkg.name` or another top-level string, which ledger entry 0001 could not move.

```toml
[package.build.manifest]
set = { name = "@modules/versioned", description = "The v1 line" }
```

- `set` is applied after `drop`. It writes only keys `package.json` types as a string: `name`, `description`, `homepage`, `license`, and the string forms of `author`, `bugs`, `funding`, `repository`, `browser` and `man`. Any other key, and any key the build or the release owns (`version`, `private`, `type`, `exports`, `bin`, `files`, the dependency maps and the like), fails `ConfigValidationError` at `manifest.set.<key>`.
- `set.name` renames every publish group without a `name` of its own, `targets.json` and the API model, so two workspace packages can emit as one name. `issues.json` and the journals keep the source name.
- The package publishes under the emitted name, while changesets, the CHANGELOG and the git tag keep the source name. Two sources emitting one name share one npm version line, so suit it to a docs-only pair rather than two published lines. `PackedInstall` refuses a renamed package as an override.

`detect` also matches unrelated code that assigns a name, so keep only hits in a build config. Verify by building and reading the emitted `dist/prod/<group>/pkg/package.json` and `dist/prod/targets.json`.
