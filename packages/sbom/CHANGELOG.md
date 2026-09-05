# @effected/sbom

## 0.5.0

### Breaking Changes

#### `@effected/schemastore` no longer ships `AnnotationCarriers`

- `AnnotationCarriers` and `CarrierDepthExceededError` are removed, and the module is deleted.

- Effect `4.0.0-rc.112` ("Make JSON Schema dialect conversions preserve custom keywords") changed the Draft-07 lowering to carry unknown and custom keywords through as opaque values, in place — including across the tuple coordinate moves (`prefixItems[i]` to `items[i]`, and a trailing `items` to `additionalItems`). The post-lowering re-graft those symbols performed is therefore redundant, and **emitted documents are unchanged**.

- If you imported either symbol, delete the call: annotate a schema node and the key now reaches the document on its own.

#### `StoreDocument` and `SchemaPipeline` error channels are wider

- `StoreDocument.fromSchema`, `StoreDocument.fromSchemaResult`, and `SchemaPipeline.run` / `check` / `runOne` / `checkOne` can now fail with `UndeclaredAnnotationKeyError`. Callers matching exhaustively on the error channel need one new branch.

### Features

#### `@effected/schemastore` refuses undeclared annotation keys instead of dropping them

- `StoreDocument.fromSchema` now fails with the new `@public` `UndeclaredAnnotationKeyError` — carrying the document's `$id` and every offending key — when a caller-supplied `includeAnnotationKey` admits a key outside the declared keyword families (the vscode set, `x-taplo`, `x-tombi-*`, `x-intellij-*`, `x-ai-*`).

- Previously such keys were admitted into the Draft 2020-12 document and silently discarded by the Draft-07 lowering, so the package's compatibility guarantee was really a side effect of a dependency's behavior. Since rc.112 no longer discards them, that guarantee is now enforced by the package itself — and enforced loudly, because a caller who asks for a key and silently does not get it has no way to notice.

- Declared families are still admitted unconditionally, regardless of the caller's predicate.

```ts
// Fails: UndeclaredAnnotationKeyError, keys: ["x-custom"]
yield* StoreDocument.fromSchema(schema, {
  $id: "https://example.com/schemas/tool.json",
  jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
});
```

#### The whole kit tracks Effect `4.0.0-rc.112`

- Every package's `effect` peer moves to the new pin. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it.

### Bug Fixes

- `@effected/schemastore`: the `#/definitions` to `#/$defs` `$ref` rewrite no longer descends into declared-family annotation values. A `$ref`-shaped string inside an `x-taplo` or `x-ai-*` payload is opaque advice addressed to a language server, and was being rewritten in transit.
- A known limitation, still open upstream as [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084): a `Schema.Class`'s class-level annotations — `title` and `description` as well as the declared families — never reach the emitted document, because core generates the definition from the class's encoded AST. A hoisted `Schema.Struct` keeps its annotations. Annotate a `Schema.Struct` root instead.

### Documentation

#### The Claude Code and Copilot plugins are Effect v4 only

- The v3-to-v4 migration material is retired: the `effect-migrator` agent and the `effect-v4-construct-map` skill are removed, along with the migration framing that ran through the remaining skills. The facts underneath it are kept, restated as statements of what v4 is rather than what changed.

- The SessionStart briefing now states plainly that an agent's recall of Effect is out of date by construction, and routes it to the specialist agents or the skills rather than to a guess. It also reports whether the repo vendors Effect source at `.repos/effect` and whether that pin matches the kit's — a stale vendored tree is worse than none, because it answers confidently and wrongly.

- Several skill claims were re-measured against rc.112 and corrected, including one whose stated mitigation pointed at the wrong signal: for a zero-collection vitest run it is the `Tests: 0/0 passed` line that lies, while the exit code is honest. [#623][#623]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.13.0 | 0.14.0 |
| @effected/spdx | dependency | updated | 0.5.0 | 0.6.0 |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.4.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.12.0 | 0.13.0 |
| @effected/spdx | dependency | updated | 0.4.0 | 0.5.0 |

## 0.4.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.11.0 | 0.12.0 |

## 0.4.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.10.2 | 0.11.0 |

## 0.4.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.10.0 | 0.10.1 |
| @effected/spdx | dependency | updated | 0.3.0 | 0.4.0 |

## 0.4.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.9.0 | 0.10.0 |
| @effected/spdx | dependency | updated | 0.2.0 | 0.3.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.3.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.8.0 | 0.9.0 |

## 0.3.0

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.7.3 | 0.8.0 |
| @effected/spdx | dependency | updated | 0.1.2 | 0.2.0 |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.2.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.7.2 | 0.7.3 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/package-json | dependency | updated | 0.7.2 | 0.7.3 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 0.2.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.7.1 | 0.7.2 |
| @effected/spdx | dependency | updated | 0.1.1 | 0.1.2 |

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.6.1 | 0.7.0 |

## 0.2.0

### Features

- `Package`, `Person` and `Repository` are now re-exported from&#10;`@effected/sbom`'s entry point, sourced from `@effected/package-json`. A
  caller can name `SbomMetadataSource.fromPackage`'s parameter type without
  adding `@effected/package-json` as an undeclared dependency:
  ```ts
  import { Package, SbomMetadataSource } from "@effected/sbom";

  const supplier = (pkg: Package) => SbomMetadataSource.fromPackage(pkg);
  ```
  `SbomMetadataSource.fromPackage`'s remarks now name `@effected/package-json`&#10;as the source of the `Package` type it accepts. [#191][#191]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.6.0 | 0.6.1 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#191]: https://github.com/spencerbeggs/effected/pull/191

## 0.1.0

### Features

- First release. Software supply-chain artifacts as Effect schemas: a CycloneDX
  1\.6 SBOM, the NTIA minimum-elements report, in-toto statements and SLSA
  provenance, and Sigstore DSSE signing.
  ### Generate and write an SBOM
  `Sbom.generate` and `Sbom.toJson` are total, pure functions — no CycloneDX
  library and no thrown-error surface to guard against; `Sbom.write` is the
  package's only IO, over Effect's `FileSystem`. `SbomMetadataSource` derives
  CycloneDX component data straight from a `package.json` (`fromPackage`,&#10;`npmPurl`, `externalReferences`), reading a manifest as a type only so a
  consumer that just wants an SBOM never links `@effected/package-json`'s IO.
  ### Signing is a separate, optional capability
  `SigstoreSigner` is the **only** module that imports `@sigstore/*` — a
  consumer that only wants an SBOM never reaches Fulcio's HTTP stack, asserted
  structurally by the package's own reachability test. `IdentityToken` supplies
  the OIDC identity token the signer needs; `SigstoreBundle` is the resulting
  DSSE bundle as a plain structural value.
  ### Attestation formats
  `InTotoStatement` and `SlsaProvenance` (SLSA Provenance v1) round out the
  attestation predicate surface; `NtiaReport` derives the seven NTIA minimum
  elements from an SBOM. [#180][#180]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/package-json | dependency | updated | 0.5.2 | 0.6.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180
