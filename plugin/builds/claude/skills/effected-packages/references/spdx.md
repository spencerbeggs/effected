# @effected/spdx

SPDX license identifiers, exceptions and license expressions as Effect Schema classes — validate an id, parse a full expression (`(MIT OR Apache-2.0+) AND GPL-2.0-only WITH Classpath-exception-2.0`) into a tagged-union AST, and re-serialize it canonically. Pure tier: `dependencies: {}`, peers only on `effect`, no IO. **The SPDX datasets are vendored as devDep-generated TypeScript** under `src/internal/` — 695 active + 26 deprecated license ids and 66 exceptions committed as data literals — so the license list is compiled in, never fetched, and the package never touches the network or the filesystem. `@effected/package-json` delegates its core SPDX validity check to `isValidExpression` here rather than reimplementing it; that delegation is why this is a separate package.

## Import

```ts
import { InvalidSpdxExpressionError, License, LicenseException, SpdxExpression, isValidExpression } from "@effected/spdx";
```

Single entrypoint; no subpaths.

## Feature surface

| Reach for | When |
| --- | --- |
| `isValidExpression(str)` | a boolean yes/no on a whole expression, from anywhere — no Effect, no runtime |
| `SpdxExpression.parse` / `.parseResult` | you need the AST: which licenses, which operators, which exception |
| `SpdxExpression.FromString` | embed an expression field in another schema and get the AST decoded for free |
| `SpdxExpression.Schema` | the raw AST union schema, for decoding an already-built POJO |
| `License.parse` / `.parseResult` | validate one identifier (or a `LicenseRef-`/`DocumentRef-` reference) |
| `License.isKnownId` / `.isDeprecatedId` / `.isLicenseRef` | cheap predicates when you do not want an instance |
| `License.catalog` / `LicenseException.catalog` | enumerate or look up every cataloged id, in-memory |
| `LicenseException.parse` / `.parseResult` | validate an exception id on its own |
| `expr.toString()` | canonical, fully-parenthesized re-serialization |

## Core API

- **`License`** — `Schema.Class` over `id` (string) and `deprecated` (boolean). The validating constructors are **`parse` (Effect) and `parseResult` (Result), never `make`** — `Schema.Class` reserves `make`, so `License.make({...})` skips validation entirely. `parseResult(id)` → `Result<License, InvalidSpdxExpressionError>` is the primitive; `parse` is `Effect.fn("License.parse")` derived from it, so the two cannot drift. An id is accepted when it is a catalog member (active **or** deprecated — deprecated ids are valid-but-flagged, never rejected) or a well-formed `LicenseRef-`/`DocumentRef-` reference. `License.of(id, deprecated = false)` builds from parts without validating. Statics `isKnownId`, `isDeprecatedId`, `isLicenseRef` are plain sync predicates; `License.catalog` is a `ReadonlyMap<string, License>` built once at module load — references are not catalog members, so a `LicenseRef-Foo` is valid but absent from it.
- **`LicenseException`** — the same shape for exception ids (`Classpath-exception-2.0`): `catalog`, `isKnownId`, `isDeprecatedId`, `parse`/`parseResult`, `of`, `toString`. No `isLicenseRef` — the reference grammar is a license-side thing only.
- **`SpdxExpression`** — two things under one name: the **type** is the AST union `LicenseNode | LicenseRefNode | WithExceptionNode | AndNode | OrNode`, and the **value** is an `as const` facade object (deliberately not a static class — a class cannot merge with a same-named type alias). Its members: `Schema` (the recursive `Schema.suspend` union), `FromString` (a `Schema.Codec<SpdxExpression, string>` whose decode runs the hardened parser and whose encode emits the canonical string), `parse` (Effect) and `parseResult` (Result, the primitive both other entry points derive from). Every failure — malformed syntax, an unknown id, an uncataloged exception — arrives as the single typed `InvalidSpdxExpressionError`, **never as a defect**.
- **AST nodes** — `LicenseNode` (`id`, `plus`), `LicenseRefNode` (`ref`, optional `documentRef`), `WithExceptionNode` (`license`, `exception`), `AndNode` / `OrNode` (`left`, `right`). All `Schema.TaggedClass`, all with an overriding `toString()` that emits the canonical fully-parenthesized form for their subtree.
- **`InvalidSpdxExpressionError`** — one `Schema.TaggedError` carrying the offending `input`, for every failure in the package.

## Usage

```ts
import { SpdxExpression } from "@effected/spdx";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const expr = yield* SpdxExpression.parse("(MIT OR Apache-2.0+)");
  return [expr._tag, expr.toString()] as const; // ["Or", "(MIT OR Apache-2.0+)"]
});
```

From a synchronous call site, reach for the `Result` twin or the predicate rather than `Effect.runSync`:

```ts
import { License, isValidExpression } from "@effected/spdx";
import { Result } from "effect";

isValidExpression("MIT AND"); // false
const parsed = License.parseResult("GPL-2.0"); // deprecated id: succeeds, deprecated: true
if (Result.isSuccess(parsed)) console.log(parsed.success.deprecated);
```

## Gotchas

- **`make` does not validate.** `License.make({ id: "not-a-license", deprecated: false })` succeeds. Use `parse` / `parseResult`.
- **Deprecated ids are valid.** `parseResult` succeeds and sets `deprecated: true`; a caller that wants to reject them checks the flag (or `isDeprecatedId`) itself.
- **`WITH` binds to a simple expression, and a reference is one.** `WithExceptionNode.license` is a union of `LicenseNode` **and** `LicenseRefNode` — `LicenseRef-Foo WITH Bison-exception-2.2` is grammatical per the SPDX ABNF. The exception must still be cataloged, and only a cataloged id may carry `+` (`LicenseRef-Foo+` is rejected).
- **The depth cap guards string parsing only.** `MAX_NESTING_DEPTH` (256) bounds `parse` / `parseResult` / `FromString`; decoding an already-built POJO straight through `SpdxExpression.Schema` is **not** depth-capped.
- **Never import `spdx-license-ids`, `spdx-exceptions` or `spdx-expression-parse` from a consumer expecting this package to have them.** They are devDependencies here — the generator's inputs and the differential-oracle test's oracle — and nothing under `src/**` imports them at runtime.
