# @effected/spdx

## 0.2.0

### Bug Fixes

* Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report. [#322][#322]

### Refactoring

* Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
* Updated `SpdxExpression`'s internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

### Dependencies

* | Dependency | Type           | Action  | From           | To             |
  | :--------- | :------------- | :------ | :------------- | :------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.1.2

### Maintenance

* Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.1

### Dependencies

* | Dependency | Type           | Action  | From          | To             |                                                                       |
  | ---------- | -------------- | ------- | ------------- | -------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.1.0

### Features

* ### New package: SPDX license identifiers, exceptions and expressions as Effect schemas

  `@effected/spdx` models SPDX license identifiers, license exceptions and the full compound-license expression grammar as Effect Schema classes, backed by the official SPDX datasets vendored as devDependency-generated TypeScript so there is no runtime data dependency. It ships free-standing `License` and `LicenseException` catalogs, a from-scratch expression parser hardened with depth limits, codecs, and a typed error channel — a malformed expression fails as a typed error, never a defect.

  The parser is verified against `spdx-expression-parse` as an oracle for compatibility, and exposes a sync `isValidExpression` predicate alongside its Effect surface.

  ````ts
  import { SpdxExpression } from "@effected/spdx";
  import { Effect } from "effect";

  const parsed = Effect.runSync(SpdxExpression.parse("(MIT OR Apache-2.0) AND BSD-3-Clause"));
  ``` Thanks [@spencerbeggs](https://github.com/spencerbeggs)!
  ````
