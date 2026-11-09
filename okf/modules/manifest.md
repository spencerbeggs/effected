---
type: Module
title: "@effected/manifest"
description: "The platform-neutral bundle.json manifest as a pure schema: BundleManifest spec 1, its encode and decode boundaries, BundleManifestError and the ManifestSource authoring shape, with effect as its only peer, so a doc-site reader decodes the manifest without installing the bundler."
status: draft
kind: package
resource: ../../packages/manifest
tags:
  - architecture
  - bundle
sources:
  - id: issue-1301
    resource: https://github.com/spencerbeggs/effected/issues/1301
    title: "bundler: the tsdoctor.json manifest schema ships only inside @effected/bundler, so a reader installs the build toolchain"
  - id: issue-1225
    resource: https://github.com/spencerbeggs/effected/issues/1225
    title: "bundler: move @tsdoctor/manifest's schema into the kit"
  - id: tsdoctor-manifest
    resource: npm:@tsdoctor/manifest
    title: "@tsdoctor/manifest 0.4.0, the package this schema came from"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-08T22:56:47Z
integrity:
  generated:
    body: 42c2f67256fd6b67
---

# @effected/manifest

`@effected/manifest` is the schema of `bundle.json`, the platform-neutral sidecar
manifest [`@effected/bundler`](bundler.md) writes into each package's `meta/`
beside its API Extractor model, and that [tsdoctor](../consumers/tsdoctor.md)'s
readers decode during bundle discovery (see
[the build artifacts](../interfaces/build-artifacts.md)). The schema came into
the kit from `@tsdoctor/manifest`[^tsdoctor-manifest] so that the bundler would
not depend on its own consumer,[^issue-1225] and it first shipped from the
bundler's root, under the file name `tsdoctor.json`. A reader such as `@tsdoctor/bundle`, which runs inside RSPress
and VitePress site builds, could then only get it by installing tsdown,
rolldown, API Extractor and a `typescript` peer.[^issue-1301] This package is
the split that #1225 planned: the wire format alone, with `effect` as its only
peer. The file is `bundle.json` because a documentation bundle is not one
platform's, and tsdoctor adopts the name. Why a package of its own rather
than a subpath, and why no `tsdoctor.json` alias:
[the manifest package](../decisions/manifest-package.md).

## Tier and dependencies

**Pure.** `effect` is the only peer (`catalog:effected:peers`). There is no
dependency of any kind, no `node:` import, no IO and no service, and
`"sideEffects": false`. Unlike [`@effected/source`](source.md) it does carry
the `effect` peer, because the shapes are Effect Schemas with encode and
decode boundaries, so a consumer takes it the way it takes any Effect
library. `@effected/bundler` is its one kit dependent, through a regular
`workspace:^` dependency.

## The surface

| Module | Exports | Concept |
| --- | --- | --- |
| `BundleManifest` | `BundleManifest`, `RegistryRef`, `OpenGraphImage`, `OpenGraphConfig`, `SbomRef`, `ProjectIdentity` | The spec-1 manifest and its parts, as `Schema.Struct`s with matching type aliases. `spec: 1` is the only required field. |
| `BundleManifest` | `decodeBundleManifest(input, path?)`, `encodeBundleManifest(manifest)` | The reader's and writer's boundaries. Both fail `BundleManifestError`. Encoding goes through the schema, so an emitted file is by construction one the decoder accepts. |
| `BundleManifest` | `BundleManifestError` | A `Schema.TaggedError` for a present manifest that fails to parse or decode, carrying `path` (set only when a path was given) and the cause. A missing manifest is never this error. |
| `BundleManifest` | `MANIFEST_SPEC`, `BUNDLE_MANIFEST_FILENAME` | `1` and `"bundle.json"`: the emitted sidecar's name and the authoring files' name alike. No `tsdoctor.json` constant is exported. |
| `BundleManifest` | `KNOWN_REGISTRY_TYPES`, `KnownRegistryType`, `isKnownRegistryType` | The registry protocol families a reader can do more than link to (`npm`, `jsr`), and the guard a reader branches on. |
| `ManifestSource` | `ManifestSource`, `decodeManifestSource` | The file an author checks in at a package or workspace root: the manifest minus `spec` and `project`, which the writer supplies when it flattens the tiers. Only a writer decodes it. |

`ManifestSource` stays here rather than in the bundler because
`@tsdoctor/manifest` shipped it too, and tsdoctor deprecates that package
only once this one carries every name it had.

## Rulings

- **Fields grow additively.** An additive field is a minor spec revision and
  keeps `spec: 1`. A removed or retyped field is a spec bump and a breaking
  release of this package. That spec bumps are kit releases is the accepted
  cost of moving the spec into the kit.[^issue-1225]
- **An old reader must read a new bundle.** Unknown top-level fields are
  ignored on decode, and `registries[].type` and `sbom.format` are plain
  strings, so an unknown value degrades to link-only rendering instead of
  rejecting the manifest.
- **An Open Graph image has exactly one of `path` or `url`.** The schema
  enforces this with a filter.
- **The bundler's root re-exports every name, as the same value.** No
  bundler consumer breaks, and a manifest decoded through one entry is the
  schema the other encodes.

## Testing

`__test__/BundleManifest.test.ts` carries the cases from `@tsdoctor/manifest`
(round trip, spec pin, path/url XOR, `ManifestSource` dropping `spec` and
`project`, path in the error) plus the reader-tolerance rules above: minimal
manifest, `spec: 2` rejected, unknown field ignored, unknown registry type
and SBOM format accepted, an image with neither source rejected, and the error
omitting `path` when none was given. `__test__/entrypoints.test.ts` pins the
export list, checks that `src/` imports only `effect` and itself, and checks
that the manifest peers `effect` alone. In the bundler,
`__test__/meta/manifest-reexport.test.ts` pins the re-export identity.

[^issue-1301]: Issue 1301, `bundler: the tsdoctor.json manifest schema ships
    only inside @effected/bundler, so a reader installs the build toolchain`.
[^issue-1225]: Issue 1225, `bundler: move @tsdoctor/manifest's schema into the kit`.
[^tsdoctor-manifest]: `@tsdoctor/manifest` 0.4.0, tsdoctor's
    `packages/manifest`, which tsdoctor deprecates once it repoints at this
    package.
