---
"@effected/manifest": minor
---

## Features

### Initial release

`@effected/manifest` is the documentation-bundle manifest as a pure Effect schema, written to a platform-neutral `bundle.json`. `effect` is its only peer, so a documentation site decodes the manifest without installing the build toolchain.

* `BundleManifest` (spec 1) and its parts `RegistryRef`, `OpenGraphImage`, `OpenGraphConfig`, `SbomRef` and `ProjectIdentity`
* `decodeBundleManifest` and `encodeBundleManifest`, failing `BundleManifestError` on a manifest that is present but invalid
* `MANIFEST_SPEC`, `BUNDLE_MANIFEST_FILENAME` (`"bundle.json"`), `KNOWN_REGISTRY_TYPES` and `isKnownRegistryType`
* `ManifestSource` and `decodeManifestSource`, the shape of the `bundle.json` an author checks in

```ts
import { decodeBundleManifest, isKnownRegistryType } from "@effected/manifest";
import { Effect } from "effect";

// `parsed` is the file's JSON, already parsed: this package does no IO
const readManifest = (parsed: unknown) =>
  Effect.gen(function* () {
    const manifest = yield* decodeBundleManifest(parsed, "meta/bundle.json");
    for (const registry of manifest.registries ?? []) {
      // an unknown registry type decodes, and renders as a plain link
      yield* Effect.log(registry.name, isKnownRegistryType(registry.type) ? "install" : "link only");
    }
    return manifest;
  });
```

A reader ignores unknown top-level fields and accepts unknown registry types and SBOM formats, so an older reader still reads a newer bundle.
