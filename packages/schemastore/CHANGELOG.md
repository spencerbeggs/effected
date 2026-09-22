# @effected/schemastore

## 0.15.0

### Features

- Upgrades core Effect to `rc-117` [#812][#812]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.8.0 | 0.9.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#812]: https://github.com/spencerbeggs/effected/pull/812

## 0.14.0

### Breaking Changes

#### The whole kit tracks Effect `4.0.0-rc.116`

- Every package's `effect` peer moves from `4.0.0-rc.115` to `4.0.0-rc.116`. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it. No `@effected` API changes shape on this advance; the kit itself needed one edit (`Stream.scan` now takes a lazy initial state, met once in `@effected/jsonl`'s `Journal.projection`). A consumer that upgrades meets the rc.116 renames on its own code:

- `SchemaTransformation.make` is `makeTransformation`, and `Transformation#compose` is the dual standalone `SchemaTransformation.composeTransformation`.

- `SchemaGetter.Getter` is a tagged union exposing only `pipe`: `new SchemaGetter.Getter`, `onSome` and `onNone` are gone in favour of `SchemaGetter.map` / `compose` / `run` and `transformEffect` / `transformOptionalEffect`.

- `Stream.scan` and `Stream.scanEffect` take `() => initial`; `Stream.partition` returns `[passes, fails]`; `Stream.mapBoth` takes `onElement` / `onError`.

- `Effect.orElseSucceed` passes the error to its fallback and `Effect.isEffect` narrows to `Effect<unknown, unknown, unknown>`.

- `ByteSize.Input` string literals are checked at compile time; parse external strings with `ByteSize.fromString`.

- Arbitrary shrinking changed, so property-test replay tokens recorded at rc.115 no longer reproduce.

### Documentation

#### The Claude Code and Copilot plugins teach the rc.116 surface

- The `effect-v4-schema` transformation reference composes transformations with `SchemaTransformation.composeTransformation` and describes the `Getter` surface rc.116 left behind; the source-lookup and testing skills report rc.116 as the kit's pin and the two-copy lockfile shape the bridge now produces (`rc.115` for the toolchain, `rc.116` for the kit); the session-start briefing reports rc.116.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.7.1 | 0.8.0 |
| @effect/platform-node | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| effect | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| effect | peerDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |

### Maintenance

#### The rc.115 `packageExtensions` bridge is retired

- The toolchain (`@savvy-web/tsdown-plugins`, `rolldown-pnpm-config`, `@vitest-agent/*`) has republished declaring `effect` and its `@effected/*` inputs as regular dependencies, so the workspace no longer needs the `packageExtensions` block that pinned them by hand. Its ten keys named versions no longer installed and the lockfile diff on removal was the checksum line alone. Nothing published changes; this is the workspace's own install shape. [#792][#792]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#792]: https://github.com/spencerbeggs/effected/pull/792

## 0.13.1

### Bug Fixes

- Fixes closure issues in all packages.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.7.0 | 0.7.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.13.0

### Maintenance

- Released in lockstep with `@effected/schemastore-cli@0.13.0` (fixed version group).

## 0.12.0

### Breaking Changes

- `StoreDocument.fromSchema` now generates every object with `onExcessProperty: "error"` by default, emitting `additionalProperties: false` throughout. Previously it followed core's open default. A published document that was generated open now reads as a contract change on the next build; pass `jsonSchema: { onExcessProperty: "ignore" }` on that target to keep the prior shape.

- `defineConfig`'s input is now decoded with `Schema.Struct`: an unknown key is rejected by name instead of silently ignored (a typo like `versons` now fails), every issue on an entry is reported at once, and rejection messages read as `defineConfig: schema "<name>" Expected string at ["baseUrl"]` rather than the previous phrasing.

- `SchemaValidator.layer` — the shipped ajv engine — and the `ajv` / `ajv-formats` dependencies have moved to `@effected/schemastore-cli` as `AjvValidator.layer`. This package now ships only the `SchemaValidator` contract and its doubles (`noop`, `makeTest`, `layerTest`), so an application that imports it at runtime (to read a `HostedSchema`, say) no longer installs or bundles an engine; its only runtime dependency is `@effected/semver`. The `schemastore` command composes the engine for you. A program that provided `SchemaValidator.layer` to `SchemaPipeline` itself provides `AjvValidator.layer` from `@effected/schemastore-cli` instead. [#746][#746]

### Features

#### HostedSchema

- New `HostedSchema` derives an application's `$schema` URL and `defineConfig`'s `$id` from one value, so the URL your code emits and the `$id` the CLI writes can never disagree.

```ts
import { HostedSchema } from "@effected/schemastore";

export const OutputSchema = HostedSchema.github({
  repo: "savvy-web/silk-release-action",
  path: "schemas",
  name: "silk-release-action.output",
  versions: ["5.2"],
});

OutputSchema.$id; // the current document's $id
OutputSchema.url; // its catalog URL
```

- Three constructors cover every hosting shape: `HostedSchema.github({ repo, branch?, path?, name, versions?, current?, layout? })`, `HostedSchema.schemastore({ name, versions?, current? })` for documents published to SchemaStore itself, and `HostedSchema.custom({ baseUrl, name, versions?, current?, layout? })` for any other `https://` directory. Each validates the identity and throws a descriptive `Error` when it does not resolve — an unversioned `current`, a duplicate version label, or a `name` that is not a simple file base name.

- `defineConfig`'s schema entries accept an optional `hosted` field carrying one of these values; when set, it owns `baseUrl`, `versions`, `current`, `layout` and `appendVersion` for that entry, and spelling those keys beside `hosted` is rejected.

- `appendVersion` (default `true`, on every constructor and as a hand-spelled entry field) decides whether a versioned file carries SchemaStore's `-<version>` suffix. With `false` the version directory names the file alone — `schemas/6.0/output.json` with `$id` to match — which reads better when the repository already names the tool; it requires the `"versioned"` layout, since under `"flat"` every version would share one file name. `SchemaVersioning.fileName` / `schemaUrl` / `catalogUrls` and `CatalogEntry.assemble` take the same option.

- `SCHEMASTORE_ID_BASE` and `SCHEMASTORE_CATALOG_BASE` now live in this module (still re-exported from the package root, so no import changes).

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#746]: https://github.com/spencerbeggs/effected/pull/746

## 0.11.0

### Breaking Changes

#### `defineConfig` schemas are now keyed, and every URL is derived

- `SchemastoreConfigInput.schemas` is now a record keyed by file base name instead of an array — the key IS the schema's `name`, and every derived path and URL (`$id`, the write path, the catalog `url`) comes from that name plus `outputDir`, `baseUrl` and `layout`. Nothing is spelled out by hand anymore, so a document's identity can never disagree with where it's written.

```ts
import { defineConfig } from "@effected/schemastore";

export default defineConfig({
  outputDir: "schemas",
  schemas: {
    "my-schema": {
      schema: MySchema,
      baseUrl: "schemastore",
      catalog: {
        description: "My schema",
        fileMatch: ["my-schema.json"],
      },
    },
  },
});
```

- `baseUrl: "schemastore"` expands to `json.schemastore.org` for `$id` and `www.schemastore.org` for the catalog `url`, and forces the flat layout. Any other `baseUrl` must be an `https://` URL, used as one base for both, defaulting to the `"versioned"` layout (`schemas/<version>/<name>-<version>.json`).

- Versioning moves from a separate `CatalogConfig`/`CatalogTarget` shape onto each schema entry: `versions` lists every label a schema advertises, and `current` (default: the newest) is the one generated now — every other label becomes a frozen file the CLI verifies but never regenerates. `CatalogConfig` and `CatalogTarget` are removed; a catalog entry is now declared per schema via `catalog: { description, fileMatch }` and assembled from the same derived identity.

- Top-level `drift`/`onDrift` defaults live on the config, with a per-entry `drift` override; both flow to the CLI's drift table unchanged in meaning.

- New exports support this: `SCHEMASTORE_ID_BASE`, `SCHEMASTORE_CATALOG_BASE`, `CatalogInput`, `SchemaEntryInput`, `FrozenVersion`, `ResolvedSchema`, and `SchemaLayout`. `SchemaVersioning.fileName`/`schemaUrl`/`catalogUrls` and `CatalogEntry.assemble` accept the new `layout` and `current` parameters (existing calls are unaffected — both default to the previous behavior).

- There is no migration shim: every repository consuming this package's previous config shape must rewrite its `schemastore.config.ts` to the keyed form above. [#740][#740]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#740]: https://github.com/spencerbeggs/effected/pull/740

## 0.10.0

### Features

- `StoreDocument.fromSchema` accepts a `rootAnnotations` option (also forwarded through `SchemaTarget`'s builders): annotations merged onto the emitted document's root after assembly, for a generator-side annotation loss the source schema cannot express.

```ts
StoreDocument.fromSchema(schema, {
	$id: "https://example.com/foo.json",
	rootAnnotations: { title: "Foo", description: "…" },
});
```

- Admitted keys are the standard JSON Schema annotation keywords (`title`, `description`, `$comment`, `default`, `examples`, `readOnly`, `writeOnly`, `contentMediaType`, `contentEncoding`) plus the declared keyword families — any other key fails the build with `UndeclaredAnnotationKeyError`, checked up front before anything is generated. When the assembled root is a bare local `$ref` (the shape a `Schema.Class` root produces), the annotations are merged onto the `$defs` entry it names instead, since Draft-07 validators ignore `$ref` siblings. When that entry is shared with other references (a recursive class, for instance), the root is instead rewritten to `{ ...annotations, allOf: [{ $ref }] }` so the document is annotated without every occurrence of the type inheriting its title.

- `CanonicalJson.equals(left, right)` is now exported: content equality under the serializer's own semantics (object key order ignored, array order preserved, total against cyclic or hostile-depth input). It is the same comparison `DocumentDiff`'s leaf checks and a catalog write-if-changed decision already make, exposed for a consumer that writes its own JSON artifact and wants to decide "unchanged" by the same rule.

### Bug Fixes

- `defineConfig` throws a clear "invalid catalog: expected an array of catalog entries" error when a config's `catalog` field is not an array, instead of failing later with an opaque `.map is not a function` — and its per-entry error label no longer stringifies a non-object entry as `"undefined"`. [#730][#730]

* `DocumentLint.checkRef` decodes local `$ref` pointers the way ajv does — split on `/`, then percent-decode and pointer-unescape each token — so a percent-encoded pointer (core emits `encodeURI(escapeToken(name))`, e.g. `#/$defs/My%20Foo~1BarEncoded` for the class identifier `My Foo/BarEncoded`) resolves against the literal `$defs` key instead of linting as `UnresolvedRef`. Pointer-escaped (`~1`/`~0`) names and subpath refs resolve exactly as before, and a `$ref` that is not a well-formed URI fragment (a raw space, non-ASCII, `#`) resolves as the engine resolves it; only malformed percent-encoding, which ajv also refuses, warns. A `#/definitions/...` pointer stays a warning.

### Other

- The duplicate pointer-segment escapers in `DocumentLint` and `CanonicalJson` are folded onto `JsonPointer.escapeToken` (identical semantics; lint/error `path` strings unchanged). [#734][#734]

### Thanks

Thanks to [@fuleinist](https://github.com/fuleinist) and [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#730]: https://github.com/spencerbeggs/effected/pull/730

[#734]: https://github.com/spencerbeggs/effected/pull/734

## 0.9.1

### Maintenance

- Version-only release to keep workspace versions consistent; no changes to this package.

## 0.9.0

### Breaking Changes

- `SchemaTarget.published` is a **required** field on the public `SchemaTarget` interface. Every target built through `SchemaTarget.make` already carries it, but code that constructs a `SchemaTarget` object literal (rather than via `make`) must now add `published: false` (or `true`) to typecheck.

- `SchemaVersioning.next(version, "contract")` now suggests a **minor** bump instead of a major one, preserving the label's component count (`1` → `2`, `1.2` → `1.3`, `1.2.0` → `1.3.0`). `DocumentDiff` cannot tell an added optional property from a removed required one, so the suggestion's job is to be strictly greater and conspicuous; bump major by hand when you know a change is breaking. Callers that asserted on the old major suggestion need to update their expectations. [#721][#721]

### Features

#### Widened version grammar

- `SchemaVersion` now accepts `major`, `major.minor` and `major.minor.patch` labels (optional prerelease; `+build` metadata is still rejected). Each label round-trips verbatim into its file name and URL, and missing components read as `0` for ordering, so `1`, `1.0` and `1.0.0` compare equal. `SchemaTarget.make` also accepts a plain string `version` and parses it, so a config file no longer needs `SchemaVersioning.parseResult` to build a versioned target.

#### `SchemaTarget.published`

- A new `published` flag on every target marks whether anyone depends on its label yet. `SchemaTarget.make` accepts it as an optional input and fills it in (default `false`). It is the lifecycle switch the drift policy reads; the pipeline's own `contractChanges: "block-versioned"` guard is unchanged.

#### `DriftPolicy`

- A pure classifier over a target's `published` flag and `WriteChange`: `classify({ published, change }, policy)` answers `"write"` or `"drift"` under `"semantic"` (a contract change is drift), `"strict"` (annotation changes too) or `"allow"` (nothing is held). `DriftPolicy.defaults` is `{ policy: "semantic", onDrift: "error" }`.

#### `defineConfig`

- The `schemastore.config.ts` contract for the new `@effected/schemastore-cli` companion. It validates the schema targets, decodes the `catalog` and `drift` blocks, derives each catalog entry's `versions` map from every versioned schema of its name through `CatalogEntry.assemble`, rejects two spellings of one version under one name, rejects an output `path` declared twice across schemas and catalog entries (compared after a lexical normalisation of `./`, `..` and trailing slashes; the CLI's loader re-checks on the resolved absolute paths), and brands the result so `isSchemastoreConfig` recognises a loaded module's default export.

#### `CatalogEntry.assemble` duplicate-version guard

- `CatalogEntry.assemble` now throws an `Error` naming both spellings when two `versions` labels compare equal under `SchemaVersioning.Order` (`1.2` and `1.2.0`): each would otherwise mint its own `versions` key and URL for one document. `defineConfig` already refused this; the library entry point now does too.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#721]: https://github.com/spencerbeggs/effected/pull/721

## 0.8.0

### Features

- `SchemaTarget` gained an optional `jsonSchema` field, forwarded through `SchemaPipeline.run` and `SchemaPipeline.check` to `StoreDocument.fromSchema`. It carries `Schema.ToJsonSchemaOptions` per target, so a document's generation contract is self-describing regardless of core's own default.

- This closes a regression: since `effect` 4.0.0-rc.113, `Schema.toJsonSchemaDocument` emits open objects by default. A previously published closed-object document could no longer be regenerated unchanged — every struct flipped `additionalProperties: false` to `true`, which the pipeline classified as a contract change and refused to rewrite a pinned version in place.

```ts
const target = SchemaTarget.make({
	schema: MySchema,
	$id: "https://example.com/schemas/my-schema.json",
	path: "schemas/my-schema.json",
	jsonSchema: { onExcessProperty: "error" },
});
```

- Passing `onExcessProperty: "error"` on the target reproduces the closed document deterministically. [#690][#690]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#690]: https://github.com/spencerbeggs/effected/pull/690

## 0.7.0

### Breaking Changes

#### The whole kit tracks Effect `4.0.0-rc.115`

- Every package's `effect` peer moves from `4.0.0-rc.112` to `4.0.0-rc.115`. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it. This advance is the first whose Effect changes are not source-compatible with the previous pin, so a consumer that upgrades meets the same renames the kit did:

- `SchemaTransformation.transformOrFail` and `SchemaGetter.transformOrFail` are `transformEffect`.

- The `Config` constructors are PascalCase (`Config.String`, `Config.Redacted`, `Config.Int`, `Config.Boolean`, …) and `Config.mapOrFail` is `Config.mapEffect`.

- `FileSystem.Size` and `FileSystem.SizeInput` are gone in favour of the `ByteSize` module: `File.Info.size` is a `ByteSize`, `File.seek` takes a `bigint`, `read`/`write` return a `number`.

- The fast-check bridge (`effect/testing/FastCheck`, `Schema.toArbitrary`, the `fastCheck` property-test option) is removed in favour of `effect/unstable/arbitrary/Arbitrary`; `it.effect.prop` takes `arbitrary: { runs, size, seed, … }`.

#### `@effected/schemastore` documents are open unless told otherwise

- `Schema.ToJsonSchemaOptions.additionalProperties` became `onExcessProperty: "ignore" | "error"` upstream, and its default now mirrors the decoder's: generated object schemas carry `additionalProperties: true` unless `jsonSchema: { onExcessProperty: "error" }` is passed. `StoreDocument.fromSchema` passes the option through unchanged, so a document that was closed by default at rc.112 is open by default now. Pass `onExcessProperty: "error"` to keep a closed document; a generator that silently disagreed with the decoder it is paired with would be the worse default.

#### `@effected/memfs` seeks before the start of a file fail

- `File.seek` gained a `PlatformError` channel upstream, and memfs now matches Node: a seek whose resulting position would be negative fails with `BadArgument` ("Cannot seek before the start of the file") and leaves the cursor unchanged, where it previously stored the negative position and failed on the next read. No memfs-declared type changes; the `File`/`File.Info` shape changes are Effect's own, reaching consumers through the peer.

### Documentation

#### A `Schema.Class` root is annotated on the `Struct` it wraps

- [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084), which the rc.112 notes carried as an open limitation, was closed upstream as by design: annotations passed as `Schema.Class`'s second argument sit on the class node, while the `$defs` entry is generated from the encoded fields `Struct`. Annotate that `Struct` — `Schema.Class<X>("X")(Schema.Struct({ … }).annotate({ title, description, "x-taplo": … }))` — and every key reaches the document. `@effected/schemastore`'s design doc and context files now state the rule instead of the limitation.

#### The Claude Code and Copilot plugins teach the rc.115 surface

- The `effect-v4-schema`, `effect-v4-testing` and `effect-v4-module-index` skills describe the native `Arbitrary` module in place of the fast-check bridge, including the migration traps met on this advance: the `size` clamp (default 10) that silently shrinks a property's string and array domains, the `-0` the generator's near-zero bias emits for an unbounded `Schema.Int` or any `Schema.Number`, which JSON and YAML cannot round-trip, and the absence of `oneof`/`constantFrom`/`array` combinators. `ByteSize` has a module-index row, the `Config` and CLI constructors are shown in their PascalCase spellings, and the session-start briefing reports rc.115 as the kit's pin. [#686][#686]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.6.0 | 0.7.0 |
| @effect/platform-node | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| @effect/tsgo | devDependency | updated | 0.41.0 | 0.45.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| effect | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| effect | peerDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#686]: https://github.com/spencerbeggs/effected/pull/686

## 0.6.1

### Bug Fixes

- `SchemaValidator.layer` now registers the standard `ajv-formats` vocabulary (`date-time`, `date`, `time`, `duration`, `uri`, `uri-reference`, `uri-template`, `url`, `email`, `hostname`, `ipv4`, `ipv6`, `regex`, `uuid`, `json-pointer`, `relative-json-pointer`, and more) on every per-call ajv instance. Previously ajv knew no formats, so under the package's default `strict: true` gate any document using `format` was rejected as an unknown format — a consumer could not express "this string is an ISO-8601 instant" and had to fall back to a `pattern` plus a runtime filter the document itself could not carry. Closes effected#657.
- `ajv-formats@^3.0.1` is now a direct dependency.
- An unknown format string is still a strict-mode rejection — registering the standard set is not a license for arbitrary format names.
- The plugin is applied with `keywords: false`, so its `formatMaximum` / `formatMinimum` (and exclusive) keywords are not registered — `DocumentLint` still answers those as unknown keywords, keeping the engine verdict and the lint verdict from drifting apart.
- No behavior change for documents that never use `format`; meta-schema (`validateSchema`) verdicts are unaffected. [#678][#678]

### Thanks

Thanks to [@fuleinist](https://github.com/fuleinist) for their contributions!

[#678]: https://github.com/spencerbeggs/effected/pull/678

## 0.6.0

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
| @effected/semver | dependency | updated | 0.5.1 | 0.6.0 |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.5.0

### Breaking Changes

- `run` and `runOne` gained `SchemaContractChangeError` in their error union; an exhaustive `catchTags` over that channel must handle it.
- A target carrying a pinned `version` whose contract changed is now refused by default where it was previously rewritten in place. Pass `contractChanges: "allow"` to restore the old behaviour.
- `PipelineCheckResult` gained the required field `contractBlocked`; code constructing that shape by hand must supply it. [#607][#607]

### Features

#### `SchemaPipeline.run` gates contract changes before writing

- `SchemaPipeline.run` is now two-phase: it builds, lints, validates and gates every target first, and writes only when every target passes. A gate failure on any target leaves every other target unwritten, where previously targets ahead of the failing one were already on disk.

- A new `contractChanges` option on `SchemaPipelineOptions` decides what happens when a document's validation contract changes:

- `"block-versioned"` (the default) — a target whose `version` is a pinned label (not a prerelease) is a published, URL-pinned document; a `"contract"` change fails with the new `SchemaContractChangeError` before any write. Unversioned and prerelease targets are rewritten in place as before.

- `"allow"` — classify and report only, never refuse. This is also the repair path for a published file whose text no longer parses, which `SchemaFile` classifies as a contract change.

- `SchemaContractChangeError` is total over the targets and carries one `ContractChangeTarget` per refused document (`$id`, `path`, `version`, `nextVersion`), so its message names the label to bump to. `PipelineCheckResult` gains `contractBlocked`, computed by the same predicate `run` uses, so a drift test can print the right remedy for a target the generator would refuse.

#### `SchemaVersioning.isPinned` and `SchemaVersioning.next`

- `isPinned(version)` answers whether a label is a non-prerelease, and is the one predicate shared by the pipeline's contract guard and the bump. `next(current, change)` answers the label a change warrants: a contract change bumps MAJOR (MINOR on the 0.x line), a prerelease is left alone, and every other change returns `current`.

#### The `x-ai-` machine-annotation family

- `KeywordFamilies` declares a house `x-ai-` prefix beside the upstream language-server families, so an `x-ai-hint` annotation on an Effect Schema field survives the Draft-07 lowering, passes the ajv strict-mode gate, and classifies as an annotation change in `DocumentDiff`. The family is a namespace, not a vocabulary: `x-ai-hint` (a string) is the one recommended key, values must be JSON, a value must not carry an `$id` at any depth, and key names must stay within ajv's keyword grammar.

### Bug Fixes

- A declared keyword whose name ajv cannot register now surfaces as a root-pathed validation finding instead of a `SchemaValidatorError`, so `SchemaPipeline.check` stays total over its targets.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.5.0 | 0.5.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#607]: https://github.com/spencerbeggs/effected/pull/607

## 0.4.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.4.0 | 0.5.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.3.0

### Bug Fixes

- `StoreDocument` assembly now correctly names an encoded-side `$defs` entry with an `Encoded` suffix (e.g. `PersonEncoded`) when the encoded AST has no identifier of its own, matching upstream's updated encoded-schema naming in `4.0.0-beta.107`. Consumers that pinned generated `$defs` keys by name should re-check them after upgrading. [#322][#322]

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.3.2 | 0.4.0 |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.2.1

### Documentation

- The README quick-start now composes one named layer and provides it once at the boundary, rather than stacking two `Effect.provide` calls at the call site. Both run correctly for this package — `SchemaFile` holds no state — but the stacked form is how a layer ends up built more than once, and the example is what consumers copy. The named const is also reusable, so a drift test and the generator providing the same value cannot disagree about what the layer contains. [#268][#268]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.3.1 | 0.3.2 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/semver | dependency | updated | 0.3.1 | 0.3.2 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#268]: https://github.com/spencerbeggs/effected/pull/268

## 0.2.0

### Breaking Changes

- ### `SchemaFile.write` now answers a result object
  `write` previously answered `"written" | "unchanged"`. It now answers `{ outcome, change }`, so it can report what the difference *meant* alongside what it did to the file.
  ```ts
  // Before
  const outcome = yield* files.write(path, document);
  if (outcome === "written") { /* … */ }

  // After
  const { outcome, change } = yield* files.write(path, document);
  if (outcome === "written") { /* … */ }
  if (change === "contract") { /* a new schema version is warranted */ }
  ```
  ### Version labels are now full three-component SemVer
  `SchemaVersion` required `major[.minor[.patch]][-prerelease]`; it now requires all three components, validated by `@effected/semver` itself. `1.2` and `1` are rejected — pass `1.2.0` and `1.0.0`.

  The file-name convention is unchanged and still SchemaStore's own `<name>-<version>.json`. Only the label grammar narrows, so that a version can be split back out of a file name or URL unambiguously — the operation a consumer of these artifacts actually performs. Build metadata (`+build`) remains rejected: SemVer precedence ignores it, so two labels differing only in build would compare equal and both claim to be the latest.

  Two hazards retire with the old grammar: `Order` no longer pads labels before parsing (the brand's check and the ordering parse are now the same call), and a `versions` map's ascending order now survives serialization, since no SemVer label is array-index-like the way a bare-major `"2"` was.
  ### `SchemaTarget.name` is now optional
  `name` is only read by catalog naming, so a target that merely emits a file no longer has to invent one that duplicates its path's basename. It remains **required when `version` is present**, since versioned naming is `name-<version>.json` — now enforced by an overload pair, so a versioned target without a name is a compile error rather than a runtime throw. An empty string still throws.

### Features

- ### Write-if-changed now compares content, not bytes
  `SchemaFile.write` compares the parsed document rather than the exact text, so a repo whose formatter also owns the emitted file no longer churns. Previously, a pre-commit hook that reflowed the JSON meant every run found the bytes different and rewrote the file — forever — making `"unchanged"` unreachable and failing CI drift checks on documents whose content never changed. No formatter exclusion is needed.

  Pass `compare: "bytes"` to opt back into byte-exactness when the emitted text is itself the artifact.
  ### `SchemaFile.check` — drift checking without writing
  The non-writing half of the pair: the same comparison `write` makes, against the filesystem, without touching it. This is what a CI drift job wants, since it must not regenerate.
  ```ts
  const { wouldWrite, change } = yield* files.check("schemas/config.schema.json", document);
  ```
  `change` classifies the content and is immune to a formatter having reflowed the file; `wouldWrite` honors `compare`, so it agrees with the writer under either mode. `outcome` and `wouldWrite` are always the authoritative answer to "was the file touched" — under `compare: "bytes"` a `change` of `"none"` still writes.
  ### `SchemaPipeline` — the emit loop, shipped
  Generate, lint, validate, gate, write — over a `SchemaTarget` manifest, as a plain function requiring `SchemaFile` and `SchemaValidator` rather than another service to wire.
  ```ts
  const results = yield* SchemaPipeline.run(targets);
  const drift = yield* SchemaPipeline.check(targets); // same walk, no writes
  ```
  `runOne` / `checkOne` take a single target. `run` enforces — it fails with `SchemaGateError` and stops, so a gated document is never written. `check` reports — it is total over the targets and carries `blocked` per target, so a repo with several broken documents learns about all of them in one run.

  Both gates' findings normalize into one `PipelineFinding` shape (with a `label` for rendering) so a single predicate judges them. Gating is policy, not mechanism: `blocking` defaults to `severity === "warning"` and is overridable, so disagreeing with the default costs a predicate rather than a re-implementation of the loop. Findings come back as values and are never logged. A blocking finding fails with `SchemaGateError` and stops the run, so a gated document is never written.
  ### `DocumentDiff` — is this change breaking, or just wording?
  Classifies two emitted documents as `"none"`, `"annotations"` or `"contract"`. A change confined to documentation keywords replaces its predecessor transparently for every consumer, while a change to any assertion keyword means a document valid yesterday may be invalid today — the signal for whether a new `SchemaVersioning` version is warranted.
  ```ts
  DocumentDiff.classify(before, after); // => "annotations"
  DocumentDiff.isClean(change); // the clean case, without spelling "none"
  ```
  Key order is never a difference (a formatter may sort); array order is. `default`, `examples`, `readOnly` and `writeOnly` count as contract rather than documentation, because consumers act on them.
  ### `SchemaValidator` ships closed over ajv
  `SchemaValidator.layer` is now a real implementation — provide it and validation works, with no adapter to write. ajv is a direct dependency: this package is build-time tooling, and ajv strict mode *is* SchemaStore's own gate, so keeping the engine behind a contract every consumer re-implemented identically bought nothing.

  Meta-schema failures keep ajv's structured `instancePath` and `keyword` instead of collapsing into one root-pathed finding, and the declared language-server keyword families are registered before compiling, so ajv no longer rejects what `DocumentLint` deliberately allows.

  The service stays an interface: `noop` switches validation off, `makeTest` / `layerTest` remain the doubles, and another engine can still be substituted.
  ### `StoreDocument.draft07`
  Builds a document from `{ $id, root, defs? }`, filling `$schema` with the meta-schema constant — so hand-built values no longer import `DRAFT_07_META_SCHEMA` just to repeat what the package already knows.

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | ajv | dependency | added | — | ^8.20.0 | [#263][#263] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Minor Changes

[#263]: https://github.com/spencerbeggs/effected/pull/263

## 0.1.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.3.0 | 0.3.1 |

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.1

### Documentation

- Added the package README, which ships in the published artifact.
- Corrected the package-documentation usage example so the lint advisory it
  describes actually fires against the shown output — the prior example's
  schema had no `description` at all, so the advisory it was meant to
  demonstrate never triggered. [#219][#219]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#219]: https://github.com/spencerbeggs/effected/pull/219

## 0.1.0

### Features

- ### Initial release
  `@effected/schemastore` builds, versions, validates and lints SchemaStore-shaped Draft-07 JSON Schema documents from Effect Schema sources.
  ```ts
  import { CatalogEntry, DocumentLint, StoreDocument } from "@effected/schemastore";
  import { Effect, Schema } from "effect";

  const Config = Schema.Struct({ name: Schema.String });

  const program = Effect.gen(function* () {
    const document = yield* StoreDocument.fromSchema(Config, {
      $id: "https://example.com/config.schema.json",
    });
    const findings = DocumentLint.lint(document);
    const text = yield* Effect.fromResult(document.serializeResult());
    return [findings.length, text.endsWith("\n")] as const;
  });
  ```
  It sits on top of core's own `Schema.toJsonSchemaDocument` + Draft-07 lowering and owns what core does not:
  - **`StoreDocument`** — assembles the SchemaStore publication shape (`$schema` + `$id` + root + `$defs`) and re-grafts the non-standard editor keyword families (the vscode five, plus `x-taplo`, `x-tombi-` and `x-intellij-` prefixes) that the Draft-07 lowering otherwise drops.
  - **`CatalogEntry`** — the `catalog.json` entry vocabulary, supporting both versioned and unversioned catalog modes, with fileMatch hygiene lints.
  - **`SchemaVersioning`** — a branded `SchemaVersion` with numeric (not lexical) ordering, so `1.10` sorts after `1.9`.
  - **`DocumentLint`** — a total structural lint (unresolved refs, unknown keywords, missing description URLs, excessive nesting) that never fails, only reports findings.
  - **`SchemaFile`** — write-if-changed file IO over `FileSystem`/`Path`, answering `"written" | "unchanged"` as a value.
  - **`SchemaValidator`** — a contract seam for real-engine validation (ajv or similar) that the consumer closes at the edge; this package ships no validation engine itself.
  - **`CanonicalJson`** — deterministic serialization (insertion-order keys, single trailing newline) with typed failures instead of `JSON.stringify`'s silent drops of `undefined`/`NaN`/non-plain values. [#215][#215]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.2.1 | 0.3.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/effected/pull/215
