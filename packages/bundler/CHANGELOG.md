# @effected/bundler

## 0.1.0

### Features

- Adds `@effected/bundler`, the build behind the whole kit, replacing `@savvy-web/bundler` and `@savvy-web/github-action-builder`
- `Bundler.build` builds one package from its `effected.toml`: a JavaScript pass, a declaration pass, an API Extractor pass for the meta output, the SEA executable compile, and the build journals; the outputs land in `dist/prod`
- `ActionBuilder.build` bundles a GitHub Action from the `[action]` table of its `effected.toml` on rolldown, with `ActionValidation` and `PersistLocal` as separate steps
- Takes over the `tsdoctor.json` schema from `@tsdoctor/manifest`
- Emitted artifacts for the kit's packages are byte-identical to the previous bundler's output
- Adds `[package.build] copy` for shipping non-module assets in each publish group's `pkg/`, in the shape of tsdown's `copy` option, beside the zero-config `public/` directory; a directory `from` keeps its own basename under `to`, so `copy = ["../../schemas"]` ships `pkg/schemas/...` while `{ from = "../../schemas", to = "schemas" }` nests it as `pkg/schemas/schemas/...`
- Adds `[package.build.meta] localPaths` for copying the canonical group's API model into a directory a docs site reads
- Warns with `exports-pattern-unmatched` in `issues.json` when a manifest `exports` pattern matches no emitted file (an exports `*` spans `/`, so a wrongly nested copy still satisfies it)
- A subpath export written as a condition object whose `import`, `default` and `types` conditions all name one TypeScript source is published under its export key, like the bare-string form; any other condition object holding a TypeScript source fails `ConfigValidationError` before any pass, instead of a manifest that points at a file the build never writes

* A literal `./dist/foo.js` export or `bin` target, including an executable entry, points at the emitted file
* A literal export or `bin` target that names no emitted file warns `exports-pattern-unmatched`
* Every own source file in the declaration program is reported

### Bug Fixes

- `bundledPackages` naming a workspace sibling now inlines the sibling's built declarations, as it does a registry package's, instead of failing with `tsgo did not generate a declaration file`; an unbuilt sibling fails `ConfigValidationError` before any pass, naming it and the `dependsOn: ["^build"]` its consumer needs [#1249][#1249]

* A `*` pattern over build sources, a `*` key over a literal build source, and a condition object naming the executable fail with `ConfigValidationError` instead of producing a wrong manifest [#1295][#1295]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/changesets | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/config-file | dependency | updated | 0.25.0 | 0.26.0 |
| @effected/files | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/glob | dependency | updated | 0.19.0 | 0.20.0 |
| @effected/npm | dependency | updated | 0.30.1 | 0.31.0 |
| @effected/package-json | dependency | updated | 0.30.0 | 0.31.0 |
| @effected/tsconfig-json | dependency | updated | 0.20.1 | 0.20.2 |
| @effected/walker | dependency | updated | 0.25.1 | 0.26.0 |
| @effected/workspaces | dependency | updated | 0.43.0 | 0.44.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1249]: https://github.com/spencerbeggs/effected/pull/1249

[#1295]: https://github.com/spencerbeggs/effected/pull/1295
