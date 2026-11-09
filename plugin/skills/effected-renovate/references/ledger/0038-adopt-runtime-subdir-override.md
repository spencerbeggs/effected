---
id: "0038"
title: "An outSubdir override replaces @savvy-web/rspress-builder's runtime: true, shipping the runtime one file per source"
kind: adopt
shows: none
applies:
  "@effected/plugin": ">=0.4.0"
  "@effected/bundler": ">=0.2.0"
detect: ["runtime:[[:space:]]*true", "@savvy-web/rspress-builder"]
changesets: ["bundle-sidecar-renames"]
closes: ["spencerbeggs/effected#1303"]
---

Offer this to the user; never apply it unasked. It fits an RSPress plugin that built with `@savvy-web/rspress-builder` and `runtime: true`. No new key is needed: `runtime: true` was an override, and `effected.toml` writes it directly.

```toml
[package.build]
externals = ["@rspress/core"]

[[package.build.overrides]]
entries = ["./runtime"]
outSubdir = "runtime"
platform = "browser"
externals = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "@rspress/core", "@theme"]
css = { modules = { localsConvention = "camelCaseOnly", namedExport = false }, inject = true }
```

- The whole directory holding the `./runtime` export's source ships one file per source, including components the barrel never imports. Test files are excluded.
- `import.meta.env` is left unresolved, so drop the old identity define. Do not name a runtime variable `TSDOWN_*`, which tsdown does define.
- The `css` table needs `@tsdown/css` installed in the package.
- One export per `outSubdir` override.

Verify by building and listing `dist/prod/<group>/pkg/runtime/`, and checking that `issues.json` has no unresolved-import warning.
