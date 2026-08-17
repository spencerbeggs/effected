# @effected/spdx

[![npm](https://img.shields.io/npm/v/@effected%2Fspdx?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/spdx)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

SPDX license identifiers, exceptions and license expressions as Effect Schema classes. `License.parse` validates a single identifier against the full SPDX License List; `SpdxExpression.parse` validates and parses a whole expression — `(MIT OR Apache-2.0)`, `GPL-2.0-only WITH Classpath-exception-2.0` — into a typed AST rather than a string you re-parse at every call site. Zero runtime dependencies: the SPDX datasets are vendored as generated TypeScript, not read from a CJS package at runtime.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 prerelease. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/spdx

Validating a `license` field usually means importing a small CJS parser at runtime and trusting it to keep working across module systems — a foreign dependency for a grammar that rarely changes. This package vendors the SPDX license and exception datasets as real, committed TypeScript instead: 695 active and 26 deprecated license identifiers, plus 66 exceptions, built once from static data with no parsing cost at load time. Validation only runs against actual user input, through `parse` / `parseResult`, never against the ~721 known-good catalog entries.

The grammar itself is hardened the same way: malformed input and an unknown identifier both fail through one typed `InvalidSpdxExpressionError`, never as a thrown exception, and the recursive-descent parser is depth-capped so a hostile or accidentally-nested expression cannot blow the stack. A differential test suite checks the engine against the canonical `spdx-expression-parse` package on all 695 known license ids — if the two ever disagree, the rule is to fix this engine, not the test.

## Install

```bash
npm install @effected/spdx effect
```

```bash
pnpm add @effected/spdx effect
```

Requires Node.js >=24.11.0. `effect` v4 is the only peer dependency, and the only dependency of any kind — no IO, no filesystem, no network.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

## Quick start

Validate a single license identifier:

```ts
import { License } from "@effected/spdx";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const mit = yield* License.parse("MIT");
  return [mit.id, mit.deprecated] as const;
});

console.log(Effect.runSync(program));
// => ["MIT", false]
```

Check a whole license expression synchronously, with no `Effect` runtime needed:

```ts
import { isValidExpression } from "@effected/spdx";

console.log(isValidExpression("(MIT OR Apache-2.0)"));
// => true
console.log(isValidExpression("MIT AND"));
// => false
```

## Features

- `License` — a validated SPDX license identifier (`Schema.Class`), with `parse` (Effect) and `parseResult` (sync `Result`) constructors, an `of(...)` convenience for known-good values, and the static predicates `isKnownId`, `isDeprecatedId` and `isLicenseRef`.
- `LicenseException` — the same pattern over the SPDX exception identifiers, with its own catalog and `parse` / `parseResult` / `of`.
- `SpdxExpression` — the recursive license-expression AST (`LicenseNode`, `LicenseRefNode`, `WithExceptionNode`, `AndNode`, `OrNode`), an Effect `parse`, the sync `isValidExpression` predicate, a `FromString` codec for embedding in your own schemas, and a canonical, fully-parenthesized `.toString()`.
- `InvalidSpdxExpressionError` — the package's single typed error; malformed grammar and an unknown identifier both fail through it, never as a defect.
- Deprecated license and exception identifiers parse successfully and carry `deprecated: true` rather than being rejected outright.

## License

[MIT](LICENSE)
