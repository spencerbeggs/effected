---
id: "0009"
title: "@effected/npm: NpmRegistryShape requires manifest, so a hand-written implementation must add it"
kind: breaking
shows: typed
applies:
  "@effected/npm": ">=0.31.0"
detect: ["NpmRegistryShape", "Layer\\.succeed\\(NpmRegistry", "NpmRegistry\\.of\\("]
closes: ["spencerbeggs/effected#1170"]
---

`NpmRegistryShape` has a required `manifest` member. It takes a name, a version and an optional target, and answers an `Option` of `VersionManifest`, failing with `RegistryReadError`.

- **A hand-written implementation or a `Layer.succeed(NpmRegistry, …)` double**: add the member. A double that nothing calls `manifest` on can answer `Option.none()`.
- **`NpmRegistryShape` used only as a parameter or field type**: nothing to do. That hit reads the service and implements nothing.
- **`NpmRegistry.layer`, `layerSeeded` and `makeSeeded`** already carry it. A seeded version takes optional `dependencies`, `peerDependencies`, `optionalDependencies`, `peerDependenciesMeta` and `engines` fields for `manifest` to answer.
- **`makeTest` and `layerTest`** die on an unstubbed member, as they do for the others. Stub `manifest` where the code under test reads it.

The compiler finds every implementation. Check the signature against the installed `.d.ts`.
