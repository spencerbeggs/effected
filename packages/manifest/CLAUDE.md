# @effected/manifest

The `bundle.json` bundle manifest as a pure schema: `BundleManifest` (spec 1) and its parts (`RegistryRef`, `OpenGraphImage`, `OpenGraphConfig`, `SbomRef`, `ProjectIdentity`), the `decodeBundleManifest` / `encodeBundleManifest` boundaries, `BundleManifestError`, `MANIFEST_SPEC`, `BUNDLE_MANIFEST_FILENAME`, the registry-family helpers, and `ManifestSource`, the authoring-file shape a writer decodes. `@effected/bundler` writes the file; doc-site readers such as `@tsdoctor/bundle` decode it.

**Tier: pure.** `effect` is the only peer, there is no dependency of any kind, no `node:` import, no IO and no service, `"sideEffects": false`. Never add one: the point of the package is that a reader running inside an RSPress or VitePress build can take it without installing the build toolchain. `__test__/entrypoints.test.ts` pins the export list, the import set and the manifest.

**Design doc:** `@./okf/modules/manifest.md`. Load when: changing a field, the decode tolerance rules, or the spec version. The package split itself: `@./okf/decisions/manifest-package.md`.

## Rules that are load-bearing

- **`bundle.json` is a wire format with readers outside this repository.** Fields grow additively; an additive field is a minor spec revision and keeps `spec: 1`. Removing or retyping a field is a spec bump and a breaking release of this package.
- **Readers must tolerate a newer writer.** Unknown top-level fields are ignored on decode, and `registries[].type` and `sbom.format` stay plain strings, never literal unions: an unknown value degrades to link-only rendering, it does not reject the manifest. `isKnownRegistryType` is how a reader branches.
- **An Open Graph image has exactly one of `path` or `url`** — the schema's filter, not a reader convention.
- **Absence is never `BundleManifestError`.** A missing sidecar is the normal case; the error is for a present file that fails to parse or decode. Its `path` key is set only when a path was given, never as explicit `undefined`.
- **`@effected/bundler` re-exports every name from its root, as the same value.** `packages/bundler/__test__/meta/manifest-reexport.test.ts` pins the identity; a new export here is a new re-export line in the bundler's `src/index.ts`.

```bash
pnpm exec vitest run --project @effected/manifest --coverage.enabled=false
pnpm build --filter @effected/manifest
```
