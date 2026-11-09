# Shaping what the build emits

Each section is one `[package.build]` key, or a group of them, that changes what lands in `dist/prod/<group>/pkg`. Key defaults are in [effected-toml.md](effected-toml.md).

## `copy` and `public/`: non-module assets

A `public/` directory needs no config: its contents are copied verbatim into each group's `pkg/` root. `copy` is the explicit way, for files that live elsewhere. It is tsdown's `copy` option as data.

```toml
[package.build]
copy = ["../../schemas", { from = "assets/*.png", to = "img" }]
```

- `from`, or a bare string, is a path or glob relative to the package directory.
- **A directory is copied whole and keeps its own basename under `to`.** `copy = ["../../schemas"]` ships `pkg/schemas/...`. `{ from = "../../schemas", to = "schemas" }` nests it as `pkg/schemas/schemas/...`.
- `to` is relative to the group's `pkg/` root, and one that leaves `pkg/` fails `ConfigValidationError`.
- `flatten` defaults to `true`, dropping each source's directories.
- A package that compiles only a binary runs no JS pass, so `copy` there fails `ConfigValidationError`.

**An `exports` or `bin` target naming no emitted file warns `exports-pattern-unmatched`** (`source: "config"`) without failing the build: a pattern such as `./schemas/*.json` matching nothing, or a literal path that does not exist. An `exports` `*` spans `/` (Node semantics), so a wrongly nested copy still satisfies the pattern; list `dist/prod/<group>/pkg` to confirm the layout.

## Literal exports and their sources

Export from source and the build rewrites the target to what it emits: `"./foo": "./src/foo.ts"`. A literal target written as the built file, `./dist/foo.js`, is built from `./src/foo.ts` and published at the emitted name. These fail `ConfigValidationError` before any pass, so write one literal export per entry instead:

- a `*` pattern over build sources (`./dist/*.js`, `./src/*.ts`);
- a `*` export key over one literal build source;
- a condition object naming an `exe` entry source.

## `plugins`: rolldown plugins

```toml
[package.build]
plugins = ["./lib/build/banner.ts"]
```

- Each entry is a module path resolved against the package directory, so `build/x.ts` is a file, not a package name. Modules load through jiti, so a `.ts` file works.
- The default export is a rolldown plugin (an object with a string `name`), or a factory of one, called once with no arguments.
- Loading runs the module's code and stops at the first failure, `PluginLoadError`, which `effected package build` reports as exit 2.
- **The plugin runs in the JS pass and again in the declaration pass.** In a dual-format build the declaration pass re-emits the `.cjs` chunk, so a `renderChunk` or `generateBundle` hook fires twice; guard a hook that must run once.

An inline plugin value has no place in `effected.toml`: move it to its own file.

## `looseFiles`: standalone files outside the exports

For a file a tool loads by path rather than by import, such as a `pnpmfile.mjs`. Each key is a literal root-level output filename, and each value a source path or `{ source, format? }`.

```toml
[package.build]
bundleNodeModules = true       # make each loose file self-contained

[package.build.looseFiles]
"pnpmfile.mjs" = "./src/pnpmfile.ts"
"hook.js" = { source = "./src/hook.ts", format = "esm" }
```

- The file is emitted outside the exports, declaration and meta graph: no `.d.ts`, no API model.
- `.mjs` and `.cjs` set the format; a `.js` key needs `format = "esm"`; a CJS file must be named `.cjs`. A contradicting `format`, another extension, or a key with a path separator fails `ConfigValidationError`.

## `overrides` with `outSubdir`: a framework runtime, one file per source

An override pins settings to some export paths. With `outSubdir`, it builds its one export as a sub-package under `pkg/<outSubdir>/`, one compiled file per source, mirroring the directory that holds the export's source. That is the shape a framework runtime needs when each site's own build compiles it:

```toml
[package.build]
externals = ["@rspress/core"]

[[package.build.overrides]]
entries = ["./runtime"]          # "./runtime": "./src/runtime/index.tsx" in package.json
outSubdir = "runtime"
platform = "browser"
externals = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "@rspress/core", "@theme"]
css = { modules = { localsConvention = "camelCaseOnly", namedExport = false }, inject = true }
```

- Every `.ts` and `.tsx` file in that directory ships, including ones the export never imports. `*.test.*`, `*.spec.*` and `.d.ts` files are left out.
- Each file keeps its own imports, so externals stay imports for whoever compiles the files next.
- The export gets a barrel and declarations: `./runtime` points at `./runtime/index.{js,d.ts}` in the emitted manifest.
- `import.meta.env` is left unresolved for the site's build to decide. tsdown defines `import.meta.env.<KEY>` and `process.env.<KEY>` for every `TSDOWN_`-prefixed variable in the build's environment, so never name a runtime variable `TSDOWN_*`.
- A `css` setting needs `@tsdown/css` installed in the package.
- One export per `outSubdir` override.

Verify by listing `dist/prod/<group>/pkg/runtime/` and checking `issues.json` for unresolved-import warnings.

## `bundledPackages` naming a workspace sibling

A sibling resolves to source, and the declaration pass cannot declare source outside its own project, so a `bundledPackages` entry that is a workspace sibling inlines from **the sibling's built declarations**, as a registry package's would.

- **Build the sibling first.** With no `dist/prod/<canonical group>/pkg/index.d.ts` the build fails `ConfigValidationError` naming it. Give that package's own turbo `build` task `dependsOn: ["^build"]`; no other package needs it.
- A subpath matches exactly: `bundledPackages = ["@x/a"]` leaves an import of `@x/a/sub` in place until `@x/a/sub` is listed too.
- The dependency stays in the emitted manifest; only the declarations change.

## `exe`: a single-executable binary

```toml
[package.build.exe]
fileName = "my-cli"
# entry = "./src/bin.ts"        # the default
# targets = [{ platform = "linux", arch = "x64" }]   # inferred from package.json os/cpu when absent
```

- **Exactly one binary with one target.** A package's `exports["."]` resolves to one binary, so ship each platform as its own package. More fails `ConfigValidationError`; no `os`/`cpu` and no `targets` fails too.
- The binary lands under `pkg/bin/` and compiles on any host for its declared target: the compiler cross-compiles. `--no-exe` (`noExe` on the MCP tool) is the only way to skip it, and the manifest still points at the binary.
- The emitted `exports["."]` points at the binary. The manifest has a `bin` only when the source manifest declares one.
- An exe-only package has no `meta` and runs no JS pass.

## `manifest`: drop and set

```toml
[package.build.manifest]
drop = ["devDependencies"]
set = { name = "@modules/versioned", description = "The v1 line" }
```

These stand in for a free-form manifest transform, which has no counterpart. `drop` removes top-level keys beyond the ones always stripped. `set` writes top-level **string** keys over the result, after `drop`.

- **`set` writes only keys `package.json` types as a string:** `name`, `description`, `homepage`, `license`, and the string forms of `author`, `bugs`, `funding`, `repository`, `browser` and `man`. A key typed as a boolean, an array or an object (`sideEffects`, `keywords`, `engines`, `imports`, …) is refused.
- **It refuses keys something else owns**, failing `ConfigValidationError` at `manifest.set.<key>`: `version`, `private`, `type`, `exports`, `bin`, `files`, `main`, `module`, `types`, `typings`, the dependency maps and the always-stripped build fields. A key also in `drop`, an empty key and a `name` npm would reject are refused too.
- **`set.name` renames everything the build names:** every publish group with no `name` of its own, `targets.json`, and the API model. `issues.json` and the journals keep the workspace name.
- **A renamed package publishes under the emitted name while its release keeps the source name.** Changesets, the changelog and the git tag name the workspace package. Two workspace packages emitting one name share one npm version line, so their versions must never meet.
