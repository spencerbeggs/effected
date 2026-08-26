# @effected/spdx

## 0.5.0

### Features

#### `License` catalog metadata

- `License` gains four derived getters, backed by a new generated vendored
  dataset:

- `referenceUrl` — the canonical SPDX web page (`Option`, `none` for a&#10;`LicenseRef`/`DocumentRef`)

- `name` — the license's full title, e.g. `"MIT License"` for `MIT`&#10;(`Option`, `none` for a `LicenseRef`/`DocumentRef`)

- `osiApproved` — whether the OSI has approved the license

- `fsfLibre` — whether the FSF lists the license as libre

- Schema fields are unchanged, so encoded shape and structural equality are
  untouched.

#### `SpdxExpression` license reads

- `primaryLicense` — the single license an expression can be said to be
  under, when there is one. Deliberately `Option.none()` for an `AND`&#10;expression — a conjunction has no single license, and picking one would
  silently drop a term that legally applies.
- `licensesOf` — every license an expression names, in written order,
  de-duplicated by identifier. [#539][#539]

```ts
import { SpdxExpression } from "@effected/spdx";

// "(MIT OR Apache-2.0)"  => Option.some(License("MIT"))
// "(MIT AND Apache-2.0)" => Option.none()
```

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#539]: https://github.com/spencerbeggs/effected/pull/539

## 0.4.0

### Features

- `SpdxExpression` now accepts `WITH` exceptions on a `LicenseRef`/`DocumentRef` reference, matching the SPDX ABNF's `simple-expression` production. `LicenseRef-Foo WITH Bison-exception-2.2` and `DocumentRef-tool-1.2:LicenseRef-Foo WITH Bison-exception-2.2` now parse instead of being rejected.
  ```ts
  import { SpdxExpression, WithExceptionNode, LicenseRefNode } from "@effected/spdx";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
    const expr = yield* SpdxExpression.parse("LicenseRef-Foo WITH Bison-exception-2.2");
    return expr instanceof WithExceptionNode && expr.license instanceof LicenseRefNode;
  });

  console.log(Effect.runSync(program));
  // => true
  ```
  `WithExceptionNode.license` is now typed as `LicenseNode | LicenseRefNode` to reflect the widened grammar. The exception must still be a cataloged SPDX exception id, and `LicenseRef-Foo+` (a `+` on a reference) is still rejected. [#400][#400]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#400]: https://github.com/spencerbeggs/effected/pull/400

## 0.3.0

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Minor Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.2.0

### Bug Fixes

- Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report. [#322][#322]

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
- Updated `SpdxExpression`'s internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.1.2

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.1

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.1.0

### Features

- ### New package: SPDX license identifiers, exceptions and expressions as Effect schemas
  `@effected/spdx` models SPDX license identifiers, license exceptions and the full compound-license expression grammar as Effect Schema classes, backed by the official SPDX datasets vendored as devDependency-generated TypeScript so there is no runtime data dependency. It ships free-standing `License` and `LicenseException` catalogs, a from-scratch expression parser hardened with depth limits, codecs, and a typed error channel — a malformed expression fails as a typed error, never a defect.

  The parser is verified against `spdx-expression-parse` as an oracle for compatibility, and exposes a sync `isValidExpression` predicate alongside its Effect surface.
  ````ts
  import { SpdxExpression } from "@effected/spdx";
  import { Effect } from "effect";

  const parsed = Effect.runSync(SpdxExpression.parse("(MIT OR Apache-2.0) AND BSD-3-Clause"));
  ``` Thanks [@spencerbeggs](https://github.com/spencerbeggs)!
  ````
