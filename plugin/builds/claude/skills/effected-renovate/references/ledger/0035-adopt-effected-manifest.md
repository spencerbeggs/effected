---
id: "0035"
title: "@effected/manifest decodes bundle.json with effect as its only peer"
kind: adopt
shows: none
applies:
  "@effected/bundler": ">=0.2.0"
  "@effected/plugin": ">=0.4.0"
detect: ["BundleManifest|decodeBundleManifest|@tsdoctor/manifest"]
changesets: ["bundle-manifest-ships", "bundle-sidecar-renames"]
closes: ["spencerbeggs/effected#1301"]
---

Offer this to the user; never apply it unasked. It fits a documentation site, a site plugin or a script that reads the bundler's `bundle.json` and should not install the build toolchain to do so.

`@effected/manifest` holds the manifest schema the bundler writes: `BundleManifest` (spec 1) and its parts, `decodeBundleManifest` and `encodeBundleManifest` failing `BundleManifestError`, `MANIFEST_SPEC`, `BUNDLE_MANIFEST_FILENAME`, `KNOWN_REGISTRY_TYPES` with `isKnownRegistryType`, and the authoring shape `ManifestSource` with `decodeManifestSource`. It does no IO: decode JSON the caller has read and parsed.

- Replace a manifest import from `@effected/bundler`, or a hand-kept copy of the schema such as `@tsdoctor/manifest`, with `@effected/manifest`. The bundler still re-exports every name as the same value, so a package that also builds can keep importing from it.
- A reader ignores unknown top-level fields and accepts unknown registry types and SBOM formats. A missing file is the caller's absent case, not an error.

Read the installed `.d.ts` for the exact shapes.
