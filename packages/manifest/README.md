# @effected/manifest

The `bundle.json` bundle manifest as an [Effect](https://effect.website) schema: the spec-1 shape, its encode and decode boundaries, and the authoring-file shape. It depends on `effect` alone, so a documentation site that only reads the manifest does not install a build toolchain.

`@effected/bundler` writes `bundle.json` into each package's `meta/` folder beside its API Extractor model. A reader decodes it with this package.

## Install

```bash
pnpm add @effected/manifest effect
```

## Read a manifest

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

`spec` is the only required field. A reader ignores unknown top-level fields and accepts unknown registry types and SBOM formats, so an older reader can still read a newer bundle. A manifest that is present but invalid fails with `BundleManifestError`. A missing manifest is not an error: the reader treats it as absent.

## Write a manifest

```ts
import { BUNDLE_MANIFEST_FILENAME, MANIFEST_SPEC, encodeBundleManifest } from "@effected/manifest";
import { Effect } from "effect";

// Returns the file name and its text; writing it to disk is the caller's IO.
const renderManifest = Effect.gen(function* () {
  const encoded = yield* encodeBundleManifest({ spec: MANIFEST_SPEC, name: "My Library" });
  return { file: BUNDLE_MANIFEST_FILENAME, text: `${JSON.stringify(encoded, null, 2)}\n` };
});
```

Encoding goes through the schema, so a written file is by construction one `decodeBundleManifest` accepts. `ManifestSource` and `decodeManifestSource` decode the file an author checks in (no `spec`, no `project`), which a writer flattens into the emitted manifest.

## License

MIT
