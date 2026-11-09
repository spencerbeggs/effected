---
type: Decision
title: "The bundle manifest is its own pure package, @effected/manifest, emitted as a platform-neutral bundle.json"
description: "The bundle manifest schema ships from the pure @effected/manifest package, which @effected/bundler depends on and re-exports, and the bundler emits it as bundle.json rather than tsdoctor.json. A bundler subpath, a writer-side copy, a generic sidecar hook and a tsdoctor.json alias were all rejected."
status: draft
tags:
  - architecture
  - bundle
  - deps
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-11-08T00:00:00Z
  - id: issue-1225
    resource: https://github.com/spencerbeggs/effected/issues/1225
    title: "bundler: move @tsdoctor/manifest's schema into the kit"
  - id: issue-1301
    resource: https://github.com/spencerbeggs/effected/issues/1301
    title: "bundler: the tsdoctor.json manifest schema ships only inside @effected/bundler, so a reader installs the build toolchain"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-08T22:56:47Z
integrity:
  generated:
    body: 3bb1de592ece5a5c
---

# The bundle manifest is its own pure package, @effected/manifest, emitted as a platform-neutral bundle.json

## Context

`@effected/bundler` writes a sidecar manifest beside each package's API
model, and doc-site readers outside the kit decode it. The schema came into
the kit so that the bundler would not depend on its own consumer,
`@tsdoctor/manifest`.[^issue-1225] It first shipped from the bundler's root,
under the file name `tsdoctor.json`. A reader that only decodes the file then
had to install the build toolchain: tsdown, rolldown, `rolldown-plugin-dts`,
`@tsdown/exe`, API Extractor and jiti, plus peers on `typescript`, `satori`
and `@resvg/resvg-js`. A reader that runs inside an RSPress or VitePress site
build cannot take that, so tsdoctor kept its own copy and the one wire format
had two sources.[^issue-1301]

## Decision

The schema, its encode and decode boundaries, its error, its constants and
the `ManifestSource` authoring shape live in
[`@effected/manifest`](../modules/manifest.md), a pure package whose only
peer is `effect`. `@effected/bundler` depends on it with `workspace:^`,
imports it in `meta/`, and re-exports every name from its root as the same
value.

The file is `bundle.json` (`BUNDLE_MANIFEST_FILENAME`), both as the emitted
sidecar and as the source files an author checks in. A documentation bundle is
not tsdoctor's alone, so its manifest carries no platform's name, and tsdoctor
adopts the new name. The package name `manifest` and the file name are the
owner's ruling.[^owner]

The bundler's surface for the file is keyed on the file, not on tsdoctor, and
none of the old names are kept: the `effected.toml` table is
`[package.bundle]`, with `BundleConfig` and its `BundleOpenGraphConfig`,
`BundleOpenGraphImage` and `BundleRegistryRef` parts; the errors are
`BundleManifestEmitError` and `BundleManifestSourceError`; the source loader is
`loadBundleManifestSources`; and the meta pass's issue codes are
`bundle-manifest-source-invalid`, `bundle-manifest-emit-failed` and
`bundle-manifest-workspace-discovery-failed`. `Manifest*` names were rejected
because `ManifestConfig` and `[package.build.manifest]` already name the
emitted `package.json` transform.[^owner]

## Alternatives rejected

- **A subpath of `@effected/bundler`.** A subpath does not change what
  installs: the reader would still pull the bundler's whole dependency closure
  and its `typescript` peer.[^issue-1225]
- **A subpath of another existing package.** No existing package owns the
  documentation-bundle manifest, and a subpath would tie this format's
  releases to an unrelated package.[^issue-1225]
- **A writer-side copy in the bundler, with tsdoctor keeping its own.** That
  leaves two sources of one spec, which is exactly the problem this decision
  fixes.[^issue-1301]
- **A generic sidecar hook in the bundler that tsdoctor fills in.** It is the
  cleanest design in principle, but every package wanting a sidecar would then
  take a tsdoctor build dependency.[^issue-1225]
- **Keeping `tsdoctor.json`, or writing both names.** No alias is kept, in
  the schema package or in the bundler: no `TSDOCTOR_MANIFEST_FILENAME`
  export, and no second file. The rename is a deliberate breaking change.[^owner]
  A build does delete a leftover `tsdoctor.json` from the meta dir and from
  every `localPaths` copy, so an old reader never finds a stale identity
  beside the current one.

## Consequences

- A spec bump of the manifest is a release of this package. Because fields
  grow additively, that should be rare.[^issue-1225]
- Readers that look for `tsdoctor.json` find nothing until they move to
  `bundle.json`, and authors rename their checked-in source files.
- tsdoctor can repoint its readers at this package and deprecate
  `@tsdoctor/manifest`.

[^owner]: The owner ruled on 2026-11-08 that the package is `@effected/manifest`,
    that the emitted and source files are the platform-neutral `bundle.json`
    with no `tsdoctor.json` alias, and that the tsdoctor-named bundler surface
    takes the Bundle names.
[^issue-1225]: Issue 1225, `bundler: move @tsdoctor/manifest's schema into the kit`.
[^issue-1301]: Issue 1301, `bundler: the tsdoctor.json manifest schema ships
    only inside @effected/bundler, so a reader installs the build toolchain`.
