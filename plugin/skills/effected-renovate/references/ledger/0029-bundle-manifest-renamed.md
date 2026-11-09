---
id: "0029"
title: "The documentation sidecar is bundle.json, [package.tsdoctor] is [package.bundle], and the bundler's Tsdoctor* names are Bundle*"
kind: breaking
shows: behavioural
applies:
  "@effected/plugin": ">=0.4.0"
  "@effected/bundler": ">=0.2.0"
  "@effected/cli": ">=0.29.0"
  "@effected/mcp": ">=0.16.0"
detect: ["tsdoctor\\.json|TSDOCTOR_MANIFEST_FILENAME|\\[package\\.tsdoctor\\]|Tsdoctor(Config|OpenGraphConfig|OpenGraphImage|RegistryRef|EmitError|SourceError|Sources|MetaOptions)|loadTsdoctorSources|composeTsdoctorManifest", "tsdoctor-(source-invalid|emit-failed|workspace-discovery-failed)"]
changesets: ["bundle-sidecar-renames", "tool-bundle-table-engine", "tool-bundle-table-cli", "tool-bundle-table-mcp", "plugin-env-action"]
closes: ["spencerbeggs/effected#1301"]
---

The bundler's documentation manifest is renamed from `tsdoctor.json` to `bundle.json` everywhere it appears, and its config table and API follow. There are no aliases.

1. **Rename the source files.** `git mv` each checked-in `tsdoctor.json`, at a package root or the workspace root, to `bundle.json`. A file left under the old name is no longer read: the build warns `bundle-manifest-retired-source` and builds without it, so the site loses its name, tagline or Open Graph settings with only a warning.
2. **Rename the table.** `[package.tsdoctor]` in `effected.toml` becomes `[package.bundle]`, with the same keys. The old table fails the build, naming the new one.
3. **Repoint readers of the emitted file.** The meta pass writes `meta/bundle.json` and copies it to each `[package.build.meta] localPaths` directory. A build deletes a leftover `tsdoctor.json` there, so a docs site or script that reads the old name finds nothing.
4. **Update code that imports the bundler's manifest names.** `TSDOCTOR_MANIFEST_FILENAME` is `BUNDLE_MANIFEST_FILENAME`. The `Tsdoctor*` config parts, errors (their `_tag`s too), `loadTsdoctorSources`, `TsdoctorMetaOptions` and `composeTsdoctorManifest` take `Bundle*` names, and the `Bundler.build` option `tsdoctor` is `bundle`. Match on the new issue codes `bundle-manifest-source-invalid`, `bundle-manifest-emit-failed` and `bundle-manifest-workspace-discovery-failed`.
5. **A reader that only decodes the manifest** can depend on `@effected/manifest`, whose only peer is `effect`, instead of the bundler. See the `@effected/manifest` adopt entry.

The compiler finds step 4 only. Verify steps 1 to 3 by running `effected package build` and reading `dist/prod/issues.json`: no `bundle-manifest-retired-source` warning, and `meta/bundle.json` present in each group. Read the installed `.d.ts` for the exact names.
