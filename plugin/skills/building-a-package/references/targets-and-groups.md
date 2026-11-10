# Publish targets and groups

`publishConfig.targets` in the source `package.json` decides where a package publishes and under which names. `effected.toml` has no key for it. With no `targets` declared, there is one group, `npm`, under the package's own name.

## `publishConfig.targets`

A map from a target id (`npm`, `github` or a custom key) to one of:

| Value | Meaning |
| --- | --- |
| `true` | The well-known registry for `npm` or `github`, under the base name |
| `"@scope/name"` | A name override, on the id's well-known registry |
| `{ registry?, name?, from?, releases?, provenance? }` | The object form |

- `registry` is required for a custom key and defaulted for `npm` (`https://registry.npmjs.org`) and `github` (`https://npm.pkg.github.com`).
- `name` gives the target a group of its own. `from` reuses another target's group bytes on this target's registry. They are mutually exclusive, a target may not name itself in `from`, and `from` does not chain.
- `releases` is `"all"` (the default), `"stable"` or `"prerelease"`. It filters at publish time, never at build time, so targets sharing a group share bytes.
- `provenance` forces the attestation on or off, over the registry-derived default.
- `github: true` needs a scoped base name.

The build fails `ConfigValidationError` at `publishConfig.targets.<id>` on a target it cannot resolve, and on an empty `targets` map.

## Groups

**A group is one distinct published name, and each builds into its own directory.** Every `true` target collapses into one canonical group under the base name, foldered `npm` when `npm` is among them, else under the first such id. A target with a `name` override gets a group of its own. A `from` target adds no bytes.

```json
"publishConfig": {
  "access": "public",
  "targets": {
    "npm": true,
    "github": true,
    "mirror": { "registry": "https://registry.example.com", "from": "npm", "releases": "stable" }
  }
}
```

That builds one group, `npm`, published to three registries.

`publishConfig.access === "public"` is what makes a package publishable. A source manifest may stay `"private": true`; the build derives the emitted `private` from `access`.

## What lands on disk

```text
dist/prod/
  <group>/pkg/     what is packed and published: JS, declarations, the emitted package.json, bin/<binary> for an exe
  <group>/meta/    <unscoped>.api.json, package.json, tsconfig.json, and bundle.json and og/ when produced
  targets.json     { groups: [{ id, name, dir }], targets: [{ id, group, name, registry, releases, provenance? }] }
  issues.json      the build's verdict and diagnostics
```

- `pkg` drops declaration source maps. `meta` exists only when the model ran: not under `meta = false`, `emitDts = false`, or for an exe-only package.
- `targets.json` is written after the JS and declaration passes, and nothing removes it beforehand: a build failing earlier writes none, so the file left there is the previous build's, if there was one. Use it only after a build of the current tree ended `buildOk: true` with a fresh `generatedAt` ([reading-issues.md](reading-issues.md)).
- `[package.build.manifest] set.name` renames every group that has no `name` of its own, plus `targets.json` and the API model; see [outputs.md](outputs.md).
- A release packs `dist/prod/<group>/pkg`. Never publish a package from its source directory: the source manifest's `exports` name `src/` and, when present, `effected-built` paths the tarball does not contain.
