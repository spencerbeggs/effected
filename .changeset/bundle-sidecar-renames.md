---
"@effected/bundler": minor
---

## Breaking Changes

### The documentation sidecar is `bundle.json`

The manifest the meta pass writes, and the source files it reads, are named `bundle.json` instead of `tsdoctor.json`. That covers the emitted `meta/bundle.json`, every `[package.build.meta] localPaths` copy, and the source files at the package root and the workspace root.

* A build deletes a leftover `tsdoctor.json` from `meta/` and from each `localPaths` copy, and never writes one
* A source file still named `tsdoctor.json` is not read. The build reports it as a `bundle-manifest-retired-source` warning and carries on
* `TSDOCTOR_MANIFEST_FILENAME` is removed. Use `BUNDLE_MANIFEST_FILENAME`

### `[package.tsdoctor]` is `[package.bundle]`

The `effected.toml` table is renamed, with the same keys. The old table fails the config decode, and the error says it was renamed to `[package.bundle]`.

### The tsdoctor-named API takes Bundle names

Renamed, with no aliases:

* `TsdoctorConfig`, `TsdoctorOpenGraphConfig`, `TsdoctorOpenGraphImage` and `TsdoctorRegistryRef` are `BundleConfig`, `BundleOpenGraphConfig`, `BundleOpenGraphImage` and `BundleRegistryRef`, and `PackageConfig.tsdoctor` is `PackageConfig.bundle`
* `TsdoctorEmitError` and `TsdoctorSourceError` are `BundleManifestEmitError` and `BundleManifestSourceError`, `_tag`s included
* `loadTsdoctorSources` and `TsdoctorSources` are `loadBundleManifestSources` and `BundleManifestSources`
* `TsdoctorMetaOptions` is `BundleMetaOptions`, and `composeTsdoctorManifest` is `composeBundleManifest`
* The `Bundler.build` option `tsdoctor` is `bundle`
* The meta pass's issue codes are `bundle-manifest-source-invalid`, `bundle-manifest-emit-failed` and `bundle-manifest-workspace-discovery-failed`

### Migration

1. `git mv` each checked-in `tsdoctor.json` to `bundle.json`.
2. Rename `[package.tsdoctor]` to `[package.bundle]` in `effected.toml`.
3. Update imports of the renamed names, and any reader of `meta/tsdoctor.json` or of a `localPaths` copy.
4. A reader that only decodes the manifest can depend on `@effected/manifest` instead of the bundler.

## Features

### Write string keys over the emitted `package.json`

`[package.build.manifest] set` writes top-level string keys over the emitted manifest, after `drop`. `set.name` renames everything the build names: the publish groups, `targets.json` and the API model, so two workspace packages can emit as one published name.

```toml
[package.build.manifest]
set = { name = "@modules/versioned", description = "The v1 line" }
```

* Only keys `package.json` types as a string are written: `name`, `description`, `homepage`, `license`, and the string forms of `author`, `bugs`, `funding`, `repository`, `browser` and `man`
* Keys the build or the release owns, such as `version`, `private`, `exports` and the dependency maps, fail `ConfigValidationError` at `manifest.set.<key>`
* A renamed package publishes under the emitted name, while changesets, the CHANGELOG and the git tag keep the source name

### The `effected-built` export condition

A source export can name its built output under the `effected-built` condition, listed first. A plain-Node workspace consumer run with `--conditions=effected-built` then loads built JS, while vitest, tsx and TypeScript keep resolving source.

```json
"exports": {
  ".": { "effected-built": "./dist/prod/npm/pkg/index.js", "default": "./src/index.ts" }
}
```

* The build strips the condition, so it never reaches the published manifest
* It must be the first key, a literal path under `./dist/prod/`, followed by an `import` or `default` source condition. Anything else fails `ConfigValidationError`
* A target that is not the file a group emitted warns `exports-built-condition-unmatched`, naming the path to write
* `--conditions` reaches Node's resolver only. A bundler the consumer runs needs the condition in its own list, such as rspack's `resolve.conditionNames`

## Documentation

* An `outSubdir` override ships a framework runtime one file per source, with its own externals and `import.meta.env` left unresolved. That is the `@savvy-web/rspress-builder` `runtime: true` shape, and it is now covered end to end

## Dependencies

The manifest schema now comes from `@effected/manifest`. Every manifest name is still exported from the bundler's root as the same value.

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| @effected/manifest | dependency | added | — | 0.1.0 |
