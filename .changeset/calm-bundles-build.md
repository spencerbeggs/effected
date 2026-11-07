---
"@effected/bundler": minor
---

## Features

* Adds `@effected/bundler`, the build behind the whole kit, replacing `@savvy-web/bundler` and `@savvy-web/github-action-builder`
* `Bundler.build` builds one package from its `effected.toml`: a JavaScript pass, a declaration pass, an API Extractor pass for the meta output, the SEA executable compile, and the build journals; the outputs land in `dist/prod`
* `ActionBuilder.build` bundles a GitHub Action from the `[action]` table of its `effected.toml` on rolldown, with `ActionValidation` and `PersistLocal` as separate steps
* Takes over the `tsdoctor.json` schema from `@tsdoctor/manifest`
* Emitted artifacts for the kit's packages are byte-identical to the previous bundler's output
* Adds `[package.build] copy` for shipping non-module assets in each publish group's `pkg/`, in the shape of tsdown's `copy` option, beside the zero-config `public/` directory; a directory `from` keeps its own basename under `to`, so `copy = ["../../schemas"]` ships `pkg/schemas/...` while `{ from = "../../schemas", to = "schemas" }` nests it as `pkg/schemas/schemas/...`
* Adds `[package.build.meta] localPaths` for copying the canonical group's API model into a directory a docs site reads
* Warns with `exports-pattern-unmatched` in `issues.json` when a manifest `exports` pattern matches no emitted file (an exports `*` spans `/`, so a wrongly nested copy still satisfies it)
* A subpath export written as a condition object whose `import`, `default` and `types` conditions all name one TypeScript source is published under its export key, like the bare-string form; any other condition object holding a TypeScript source fails `ConfigValidationError` before any pass, instead of a manifest that points at a file the build never writes

## Bug Fixes

* `bundledPackages` naming a workspace sibling now inlines the sibling's built declarations, as it does a registry package's, instead of failing with `tsgo did not generate a declaration file`; an unbuilt sibling fails `ConfigValidationError` before any pass, naming it and the `dependsOn: ["^build"]` its consumer needs
