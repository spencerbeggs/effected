# @effected/package-json

## 0.14.0

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
| @effected/jsonc | dependency | updated | 0.8.1 | 0.9.0 |
| @effected/npm | dependency | updated | 0.12.1 | 0.13.0 |
| @effected/semver | dependency | updated | 0.5.1 | 0.6.0 |
| @effected/spdx | dependency | updated | 0.5.0 | 0.6.0 |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.13.0

### Features

#### `Funding` model

- A new `Funding` class models npm's `funding` field. `Funding.FromField`&#10;always decodes to an array, whichever encoding the manifest used, so a
  caller crediting maintainers never branches on arity; `url` is required.

```ts
import { Funding } from "@effected/package-json";
import { Schema } from "effect";

const entries = await Schema.decodeUnknownPromise(Funding.FromField)("https://example.com/sponsor");
entries[0]?.url; // "https://example.com/sponsor"
```

#### `Repository.directoryUrl`

- `Repository` gains `directoryUrl` — a monorepo member's own subdirectory URL
  on GitHub/GitLab/Bitbucket. Falls back to `browseUrl` when there is no&#10;`directory`, and returns `Option.none()` for an unrecognized host or a `..`&#10;escape.

#### `licenseExpressionOf`

- A new `licenseExpressionOf(license: SpdxLicense) => Option<SpdxExpression>`&#10;turns a branded manifest license into a parsed `@effected/spdx` expression,
  returning `Option.none()` for npm's `UNLICENSED` and `SEE LICENSE IN <file>`&#10;spellings.

### Bug Fixes

- `Repository` and `Bugs` replayed their remembered object wire unconditionally
  on encode, so an instance edited in place after decoding re-encoded as the
  stale original and the edit was silently discarded. Both now carry
  faithfulness guards matching `Person`'s.

- The **string** branches had the same class of bug, reached through the fields
  the shorthand has no syntax for. A repository decoded from `"effected/kit"`&#10;that gained a `type`, a `directory` or an unknown key re-encoded as the bare
  string, dropping the addition; `Bugs` did the same for an unknown key. Both now
  fall through to the object form unless the string can still carry the value,
  matching `Person` and `Funding`. The `directory` case is the live one, since
  this release also ships `Repository.directoryUrl` — making a bare-string
  repository into a monorepo member is exactly the edit that was being lost. [#539][#539]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/spdx | dependency | updated | 0.4.0 | 0.5.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#539]: https://github.com/spencerbeggs/effected/pull/539

## 0.12.0

### Features

- Adds `LenientManifest`, a shape-lenient discovery tier for package.json documents, below the existing `PackageManifest` in the tolerance ladder — for sniffing a fetched tarball's manifest or walking a `node_modules` tree, where the document is other people's data and one malformed field must not fail the whole read.

- Every field shares its name with the strict `Package` model but is typed as its plain permissive JSON shape (`name`/`version` are any string, dependency maps are plain records). A field present but not even that shape degrades to absence, is preserved verbatim under `rest`, and is reported as a `LenientFieldIssue` on `issues`. Leniency is per-field, not per-syntax — non-JSON text and non-object values still fail typed:

```ts
import { LenientManifest } from "@effected/package-json";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const sniffed = yield* LenientManifest.decode({ name: "JSONStream", version: "1.0", license: 42 });
	console.log(sniffed.name, sniffed.version); // "JSONStream" "1.0"
	console.log(sniffed.issues); // [{ field: "license", expected: "a string", value: 42 }]
	console.log(sniffed.rest?.license); // 42 — degraded, preserved verbatim
});
```

- `decodeResult`/`parseResult` are the synchronous `Result` primitives; `decode`/`parse` are their `Effect.fn`-spanned forms. An empty `issues` array does not imply the document would pass the strict tiers — re-decode the original input through `PackageManifest.decode` or `Package.decode` when validation is actually needed. [#517][#517]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.7.0 | 0.8.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#517]: https://github.com/spencerbeggs/effected/pull/517

## 0.11.0

### Features

- `resolveEntryPoint` — a new pure, IO-free function answering "which file is this manifest's `"."` entry point?" over a structural `EntryPointManifest` (`{ exports?, main? }`), so a manifest read straight from a tarball resolves with nothing else validated.

```ts
import { resolveEntryPoint } from "@effected/package-json";

resolveEntryPoint({ exports: { import: "./esm.js", require: "./cjs.js" } });
// Result.succeed("./esm.js")

resolveEntryPoint({ exports: { require: "./cjs.js" } }, { conditions: ["require"] });
// Result.succeed("./cjs.js")
```

- It honours all three legal `exports` spellings (string shorthand, subpath map, root conditions), and conditions are checked in caller-supplied order. When `exports` is present but nothing matches the requested conditions, resolution fails typed with `UnresolvedEntryPointError` rather than falling through to `main` — matching Node's own encapsulation rule. `main`, and then the legacy `index.js` default, only apply when `exports` is absent entirely. [#497][#497]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.11.1 | 0.12.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#497]: https://github.com/spencerbeggs/effected/pull/497

## 0.10.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.10.0 | 0.11.0 |

## 0.10.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/spdx | dependency | updated | 0.3.0 | 0.4.0 |

## 0.10.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.6.0 | 0.7.0 |
| @effected/npm | dependency | updated | 0.9.0 | 0.10.0 |
| @effected/semver | dependency | updated | 0.4.0 | 0.5.0 |
| @effected/spdx | dependency | updated | 0.2.0 | 0.3.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.9.0

### Breaking Changes

- `PackageJsonFileShape` gains three new members — `readManifest`, `writeManifest` and `modify` (see Features below). Any hand-built test double implementing `PackageJsonFileShape` structurally must add them.

### Features

- ### `PackageManifest` — a presence-lenient package.json model
  A new `PackageManifest` class decodes the shapes `Package` rightly rejects: `name` and `version` are optional, and `packageManager` accepts the range spelling (`pnpm@^11.20.0`) via the new `PackageManagerRange` class. Every field that *is* present still decodes through the same typed codecs as `Package` — this is the idiomatic private workspace root (`{ "private": true, "packageManager": "pnpm@11.2.0" }`), not a weaker validator.
  ```ts
  import { PackageManifest } from "@effected/package-json";

  const root = yield* PackageManifest.decode({ private: true, packageManager: "pnpm@^11.20.0" });
  root.isPrivate; // true
  root.packageManager?.isExact; // false — it's a range, not a pin
  ```
  ### `PackageJsonFormat.modify` / `modifyToString`
  A surgical, decode-free field editor over package.json text: applies one `PackageFieldEdit` (a `path` plus a `value`, or `value: undefined` to delete) and preserves every byte outside the edited span — key order, indentation, line endings, trailing newline — which is what keeps a one-field change reviewable in someone else's repository.
  ### `PackageJsonFile.readManifest` / `writeManifest` / `modify`
  The `PackageJsonFile` service grows three matching members: `readManifest`/`writeManifest` read and write through `PackageManifest` instead of the strict `Package`, and `modify` applies a list of `PackageFieldEdit`s to a file on disk in one read/edit/write pass, skipping the write entirely when the result is byte-identical to what was read.
  ````ts
  import { PackageJsonFile } from "@effected/package-json";

  const files = yield* PackageJsonFile;
  yield* files.modify("./package.json", [{ path: ["packageManager"], value: "pnpm@11.2.0" }]);
  ``` [#366](https://github.com/spencerbeggs/effected/pull/366) Thanks [@spencerbeggs](https://github.com/spencerbeggs)!
  ````

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/jsonc | dependency | added | — | 0.6.0 | [#366][#366] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#366]: https://github.com/spencerbeggs/effected/pull/366

## 0.8.0

### Bug Fixes

- Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report. [#322][#322]

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
- Updated `PackageManager`'s internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.8.3 | 0.9.0 |
| @effected/semver | dependency | updated | 0.3.2 | 0.4.0 |
| @effected/spdx | dependency | updated | 0.1.2 | 0.2.0 |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.7.3

### Documentation

- Corrected the README's list of `workspace:` range modifiers, where a find-and-replace had turned `workspace:~` into a second `workspace:^`. The three specifiers are `workspace:*`, `workspace:^` and `workspace:~`. [#268][#268]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.8.1 | 0.8.2 |
| @effected/semver | dependency | updated | 0.3.1 | 0.3.2 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/semver | dependency | updated | 0.3.1 | 0.3.2 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#268]: https://github.com/spencerbeggs/effected/pull/268

## 0.7.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.8.0 | 0.8.1 |
| @effected/semver | dependency | updated | 0.3.0 | 0.3.1 |
| @effected/spdx | dependency | updated | 0.1.1 | 0.1.2 |

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.7.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.7.0 | 0.8.0 |

## 0.7.0

### Bug Fixes

- ### `PackageManager.FromString` version parsing is now strict
  `PackageManager`'s `version` field is now `@effected/semver`'s `SemVer.PinnableVersionString` (an exact SemVer 2.0.0 version, no build metadata, no surrounding whitespace), and `integrity` is `@effected/npm`'s `CorepackIntegrityHash` — the same two schemas `@effected/npm`'s `PackageManagerPin` consumes, so the two no longer drift independently.

  This is a deliberate strictening of what `PackageManager.FromString` accepts. Previously-accepted malformed input now fails typed at decode instead of being silently parsed:
  - A leading-zero version component (`pnpm@01.2.3`)
  - A leading-zero or empty prerelease identifier (`1.2.3-01`, `1.2.3-a..b`)
  - A padded version substring (`pnpm@ 10.33.0`) — previously canonicalized by trimming, now a typed failure naming the version component

  This matches corepack's own `semver.valid` check (minus its trim). The generated `.d.ts` is unchanged — a `Schema.check` is erased from the built type — so nothing here is visible at compile time; a manifest that previously round-tripped one of the inputs above will now fail to decode. [#215][#215]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.6.0 | 0.7.0 |
| @effected/semver | dependency | updated | 0.2.1 | 0.3.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/effected/pull/215

## 0.6.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.5.0 | 0.6.0 |

## 0.6.0

### Features

- Added `Repository` and `Bugs` field classes, plus `homepage`, `maintainers`&#10;and `keywords` fields on `Package`. `Repository` round-trips both the
  shorthand string form and the object form byte-for-byte, the same wire
  fidelity discipline `Person` already carries.

### Bug Fixes

- Fixed `Person` silently dropping unknown keys on an object-form `author` /&#10;`contributors` / `maintainers` field. `Person` lacked a `rest` catch-all, so&#10;`{"name":"Dee","twitter":"@dee"}` re-encoded as `{"name":"Dee"}` on a
  read-then-write round trip; unknown keys are now preserved and flattened back
  on encode. An edited shorthand (e.g. `"Ann <ann@x.dev>"`) now re-emits as a
  shorthand rather than silently upgrading to the object form, unless the edit
  added keys the shorthand grammar cannot express — in which case the object
  form is used so no data is lost. [#180][#180]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.4.0 | 0.5.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180

## 0.5.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.3.1 | 0.4.0 |

## 0.5.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.3.0 | 0.3.1 |
| @effected/semver | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/spdx | dependency | updated | 0.1.0 | 0.1.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.5.0

### Features

- ### License validation moves to `@effected/spdx`
  `isValidSpdx` and the `License` schema now validate compound SPDX expressions through `@effected/spdx`'s `isValidExpression` instead of the foreign `spdx-expression-parse` runtime dependency, which has been dropped. The `UNLICENSED` and `SEE LICENSE IN` special cases are unchanged, and validation is now a kit-internal boundary — `@effected/package-json` delegates SPDX validity to a sibling package rather than a third-party parser.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/spdx | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.4.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.2.3 | 0.3.0 |

## 0.4.1

### Bug Fixes

- ### Internal @effected edges float patches instead of pinning exact versions
  The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

  Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged. [#134][#134]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.2.2 | 0.2.3 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/effected/pull/134

## 0.4.0

### Features

- ### Decode-free canonical sort and format: `PackageJsonFormat`
  ```ts
  import { PackageJsonFormat } from "@effected/package-json";

  PackageJsonFormat.sortValue({ version: "1.0.0", name: "p" });
  // => { name: "p", version: "1.0.0" }

  const formatted = PackageJsonFormat.formatToString('{"private": true}');
  ```
  Two new entry points offer the same canonical key ordering as the strict validating path, without decoding into a `Package`: `PackageJsonFormat.sortValue` is value→value, total, and returns its input's own type `T`; `PackageJsonFormat.formatToString` is string→string, returning a `Result<string, PackageJsonSyntaxError>` for hosts that hold raw file text. New `PackageFormatTextOptions` controls indentation, sorting, empty-map stripping and the trailing newline for the text path.

  They are statics on a `PackageJsonFormat` class rather than floating functions, and `formatToString` is the name `@effected/jsonc`, `@effected/yaml` and `@effected/toml` already use for the same bytes→bytes shape, so a consumer who has met one kit formatter has met all four.

  Because nothing is decoded, nothing is normalized: the value path only ever reorders keys — it never adds or removes one, which is what lets `sortValue`'s return type equal its input type. The existing strict `Package.decode` / `Package.toJsonString` path is unchanged.

### Bug Fixes

- ### Object-form `Person` values no longer drop unknown keys
  An object-form `author`, `contributors` or `maintainers` entry silently lost any key it didn't recognize: `{"name":"Dee","twitter":"@dee"}` re-encoded as `{"name":"Dee"}`. This is data loss on any manifest with a non-standard person key, and it is present in the released `0.3.1`.

  `Person` now carries a `rest` catch-all that preserves unrecognized keys verbatim, replaying them — including their original key order — on encode. Also fixed: a string-form author shorthand (`"Name <email>"`) was being rewritten to the object form on a round trip instead of being preserved as a string. [#125][#125]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.2.1 | 0.2.2 |
| @effected/semver | dependency | updated | 0.1.1 | 0.2.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#125]: https://github.com/spencerbeggs/effected/pull/125

## 0.3.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/semver | dependency | updated | 0.1.0 | 0.1.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.3.0

### Breaking Changes

- ### Canonical key order re-baselined to `sort-package-json@4.0.0`
  `PackageFormatOptions`'s default sort (`sort: true`, the default) now places top-level keys in `sort-package-json@4.0.0`'s exact order rather than the kit's prior hand-maintained subset. This **changes the emitted bytes** of any `package.json` formatted with the default options — notably `packageManager` now sorts before `engines` / `devEngines`, and `sideEffects` moves after `publisher`, before `type`. `scripts`, `engines` and `bin` are now alphabetized alongside the dependency maps (previously only the dependency maps were sorted). An absent `scripts` key no longer materializes as `"scripts": {}` on encode — it's stripped like the dependency maps.

  Anything that diffs or snapshots formatted `package.json` output — CI checks, golden fixtures — will see a one-time reformat on upgrade. Pass `sort: false` to opt out and preserve prior key ordering.

  Because every `@effected/*` package is pre-`1.0.0` (majors are locked until Effect v4 GA), this ships as a `minor` rather than a `major` — treat it as breaking for compatibility planning regardless of the semver label.

### Features

- ### `PackageIndent` — tab and preserve-source indentation
  `PackageFormatOptions.indent` widens from `number` to `PackageIndent` (`number | "tab" | "preserve"`). `"tab"` indents with real tabs; `"preserve"` reuses the indentation detected from the original source text.
  ```ts
  import type { PackageFormatOptions } from "@effected/package-json";

  const options: PackageFormatOptions = { indent: "preserve" };
  ```
  ### `sourceText` option
  A new `sourceText` option backs `indent: "preserve"`: pass the original file text and its indentation (tabs vs. N spaces, detected from the first indented line) is reused; falls back to two spaces when absent. `PackageJsonFile.write` supplies the existing file's text automatically when `indent: "preserve"` is set without an explicit `sourceText` — reading the file being overwritten before it re-serializes. [#91][#91]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/effected/pull/91

## 0.2.0

### Breaking Changes

- ### `Package.resolve` error channel widened
  `Package.resolve` now routes specifier classification through `@effected/npm`'s shared `DependencySpecifier` statics. Its error channel now includes `CatalogAssemblyError` alongside `DependencyResolutionError`, flowing from the widened `CatalogResolver` contract — a `CatalogResolver` whose catalog assembly failed now surfaces that failure typed instead of being swallowed into a resolution-error defect. Code that pattern-matches on `Package.resolve`'s error channel needs to add a case for `CatalogAssemblyError`:
  ```ts
  import { Package } from "@effected/package-json";
  import { Effect } from "effect";

  Package.resolve(pkg).pipe(
  	Effect.catchTags({
  		CatalogAssemblyError: (error) => Effect.logError(`catalog assembly failed: ${error.message}`),
  		DependencyResolutionError: (error) => Effect.logError(`resolution failed: ${error.message}`),
  	}),
  );
  ```

### Features

- ### Alias-form `workspace:` specifiers now resolve correctly
  `Package.resolve` now recognizes pnpm's alias form (`workspace:<name>@<range>`), resolving the **target** package's version rather than the dependency map key's, and projecting to the published `npm:<name>@<range>` alias — matching what pnpm actually publishes. Previously this form was not specially handled and could resolve to an incorrect specifier.
  ### Whitespace-only catalog names now select the default catalog
  A `catalog:` specifier whose name is only whitespace (e.g. `"catalog:  "`) now selects the default catalog, matching pnpm's own trimming behavior, instead of looking up a catalog literally named `"  "`.

### Bug Fixes

- The wire-codec encoder now lets typed fields win over a colliding key in `rest`, so a hand-built `Package` (or `.extend()`ed subclass) whose `rest` smuggles a known field name no longer shadows the typed member on the wire. [#83][#83]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.1.0 | 0.2.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#83]: https://github.com/spencerbeggs/effected/pull/83

## 0.1.0

### Features

- Initial release: package.json parsing, editing, validation and file IO as Effect schemas. `Package` is a `Schema.Class` over the manifest's known fields — `name` is a branded npm name, `version` is a real `SemVer` — with a `rest` catch-all that round-trips every unknown top-level key.
  ### The Package model
  Decode a manifest, edit it immutably, read the computed properties back. Mutation statics are dual, and serialization applies the canonical `sort-package-json` key order:
  ```ts
  import { Package } from "@effected/package-json";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
    const pkg = yield* Package.decode({ name: "@acme/widget", version: "1.0.0", private: true });
    const next = yield* Package.setVersion(pkg, "1.1.0");
    return [next.name, next.version.toString(), next.isScoped, next.isPrivate] as const;
  });

  console.log(Effect.runSync(program));
  // => ["@acme/widget", "1.1.0", true, true]
  ```
  ### File IO with typed failures
  `PackageJsonFile` is the only IO surface — one service, `read` and `write`, over core `FileSystem` / `Path`. `read` fails four distinct ways: `PackageJsonNotFoundError`, `PackageJsonReadError`, `PackageJsonParseError` and `PackageDecodeError`.
  ```ts
  import { PackageJsonFile } from "@effected/package-json";
  import { NodeFileSystem, NodePath } from "@effect/platform-node";
  import { Effect, Layer } from "effect";

  const bumpMinor = Effect.gen(function* () {
    const files = yield* PackageJsonFile;
    const pkg = yield* files.read("./package.json");
    const next = pkg.copyWith({ version: pkg.version.bump.minor() });
    yield* files.write("./package.json", next);
  });

  const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

  Effect.runPromise(bumpMinor.pipe(Effect.provide(PackageJsonFile.layer), Effect.provide(PlatformLive)));
  ```
  ### Validation and specifier resolution
  `PackageValidator` runs a replaceable rule set and aggregates every failure into one `PackageValidationError`. `Package.resolve` expands `catalog:` and `workspace:` specifiers through the `@effected/npm` resolver contracts as an explicit step `write` never performs for you. Leaf concepts (`PackageName`, `DependencySpecifier`, `Dependency`, `SpdxLicense`, `PackageManager`) are usable on their own. [#81][#81]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/npm | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/semver | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
