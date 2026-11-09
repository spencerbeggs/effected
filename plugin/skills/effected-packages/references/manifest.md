# @effected/manifest

The documentation-bundle manifest as an Effect schema: the platform-neutral `bundle.json` sidecar that `@effected/bundler` writes into each package's `meta/` folder beside its API Extractor model, and the source files an author checks in at a package or workspace root. Pure tier: `effect` is the only peer, with no dependency, no `node:` import and no IO, so a docs site (an RSPress or VitePress build, a bundle reader) decodes the manifest without installing the build toolchain. `@effected/bundler` depends on it and re-exports every name from its root as the same value.

## Import

```ts
import {
  BUNDLE_MANIFEST_FILENAME,
  BundleManifest,
  BundleManifestError,
  MANIFEST_SPEC,
  decodeBundleManifest,
  encodeBundleManifest,
  isKnownRegistryType,
} from "@effected/manifest";
```

## Core API

- **`BundleManifest`**: the spec-1 manifest as a `Schema.Struct`. `spec: 1` is the only required field; `name`, `tagline`, `description`, `project` (`ProjectIdentity`), `openGraph` (`OpenGraphConfig` of `OpenGraphImage`s), `sbom` (`SbomRef`) and `registries` (`RegistryRef[]`) enrich.
- **`decodeBundleManifest(input, path?)`**: the reader's boundary over an already-parsed value. Fails `BundleManifestError`, which carries `path` only when one was given. Parse the file yourself: the package does no IO.
- **`encodeBundleManifest(manifest)`**: the writer's boundary. Encoding through the schema means a written file is one the decoder accepts.
- **`BUNDLE_MANIFEST_FILENAME`** (`"bundle.json"`) and **`MANIFEST_SPEC`** (`1`).
- **`KNOWN_REGISTRY_TYPES`** (`npm`, `jsr`) and **`isKnownRegistryType(type)`**: branch on this. An unknown registry type is not an error; render it as a plain link.
- **`ManifestSource`** / **`decodeManifestSource`**: the authoring shape, the manifest minus `spec` and `project`, which the writer supplies when it flattens the tiers. Only writers decode it.

## Rules

- A reader tolerates a newer writer: unknown top-level fields are ignored on decode, and `registries[].type` and `sbom.format` are plain strings.
- An Open Graph image has exactly one of `path` or `url`; the schema rejects both or neither.
- A missing manifest is the normal case, never `BundleManifestError`. Treat absence as `Option.none()`.
- Fields grow additively under `spec: 1`; a removed or retyped field would be a spec bump.
- The file is `bundle.json`. There is no `tsdoctor.json` alias, and the bundler deletes a leftover file of that name rather than writing one.

## Usage

```ts
import { decodeBundleManifest, isKnownRegistryType } from "@effected/manifest";
import { Effect } from "effect";

const registriesOf = (parsed: unknown) =>
  Effect.gen(function* () {
    const manifest = yield* decodeBundleManifest(parsed, "meta/bundle.json");
    return (manifest.registries ?? []).map((registry) => ({
      name: registry.name,
      url: registry.url,
      installable: isKnownRegistryType(registry.type),
    }));
  });
```
