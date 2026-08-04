# `ActionOutputs` and machine-readable output contracts

## `ActionOutputs`: the full member surface

`ActionOutputs` is a `Context.Service` requiring `ActionEnvironment | FileSystem.FileSystem` to build. Its shape, `ActionOutputsShape`:

| Member | Signature | Target |
| --- | --- | --- |
| `set` | `(name, value) => Effect<void, ActionOutputError>` | `GITHUB_OUTPUT` |
| `setJson` | `<A, I>(name, value: A, schema: Schema.Codec<A, I>) => Effect<void, ActionOutputError>` | `GITHUB_OUTPUT`, JSON-encoded through `schema` |
| `summary` | `(content) => Effect<void, ActionOutputError>` | `GITHUB_STEP_SUMMARY` |
| `exportVariable` | `(name, value) => Effect<void, ActionOutputError>` | `GITHUB_ENV` |
| `addPath` | `(path) => Effect<void, ActionOutputError>` | `GITHUB_PATH` |
| `setFailed` | `(message) => Effect<void>` | stdout, `::error::` workflow command |
| `setSecret` | `(value) => Effect<void>` | stdout, `::add-mask::` workflow command |

`ActionOutputError` carries a closed `reason`: `unavailable` (the runner-file
variable itself is unset — usually means the code isn't running on a
runner), `writeFailed`, `invalidName`, or `encodeFailed` (a `setJson` value
didn't satisfy its schema).

### Where the runner files come from

`ActionOutputs`' internal write path resolves the destination path by
asking `ActionEnvironment` for the runner-file **variable name** —
`"GITHUB_OUTPUT"`, `"GITHUB_ENV"`, `"GITHUB_PATH"`, `"GITHUB_STEP_SUMMARY"`.
`ActionEnvironment` is the one reader of `process.env` in the package,
snapshotted once into an immutable map when its layer builds; a lookup
fails typed (`reason: "unavailable"`) rather than resolving to `undefined`
when a variable is unset — exactly what happens when this code runs off a
real runner.

### Runner-file delimiters are derived, never random

Every block write wraps the value in a heredoc-shaped block whose
delimiter is derived: start from a base delimiter and extend it until it's
absent from the value being written. GitHub's own toolkit picks a random
UUID and accepts a small chance of collision; deriving the delimiter this
way makes a collision **impossible** rather than improbable, needs no
`Crypto` in `R`, and is deterministic under test. A value containing an
un-derived, fixed delimiter would terminate its own block early and
corrupt every entry written after it in the same file — a
value-controlled injection into the runner's own file. The same discipline
applies to the output **name**: a name containing `\r` or `\n` is refused
(`reason: "invalidName"`) before anything is written, rather than
corrupting the block structure.

### `exportVariable` targets subsequent steps, not this one

A variable exported mid-run through `exportVariable` is not observed by an
already-seeded `ActionEnvironment` reader in the same process — that's
GitHub's own model (`exportVariable` affects steps that run *after* the
current one), not a defect in this package. Do not write a test asserting
a same-process readback of an exported variable; assert against the
written `GITHUB_ENV` file content instead.

```ts
import { ActionOutputs } from "@effected/github-actions";
import { Effect, Schema } from "effect";

const Result = Schema.Struct({ count: Schema.Number, tag: Schema.String });

const program = Effect.gen(function* () {
  const outputs = yield* ActionOutputs;
  yield* outputs.set("version", "1.2.3");
  yield* outputs.setJson("result", { count: 2, tag: "ok" }, Result);
  yield* outputs.exportVariable("CACHE_HIT", "true");
  yield* outputs.summary("## Done\n");
});
```

## Machine-readable output contracts

A `setJson` output consumed by anything other than the same workflow's next
step — a downstream job, a bot, an LLM reading workflow output — is a
public API. Nothing in `@effected/github-actions` enforces contract
stability for you; this is the pattern to apply on top of
`ActionOutputs.setJson`.

### Schema as the single source of truth

`ActionOutputs.setJson`'s signature —
`<A, I>(name, value: A, schema: Schema.Codec<A, I>) => Effect<void, ActionOutputError>`
— means the schema is not optional decoration, it *is* the encoder. Define
the contract once as a `Schema.Class` (or `Schema.Struct`), export it from
the action's own module, and pass the *same* schema to `setJson` and to
whatever generates the committed JSON Schema below. Two schemas describing
"the same" output drift independently; one schema used for both never can.

```ts
import { Schema } from "effect";

export class ScanResult extends Schema.Class<ScanResult>("ScanResult")({
  findingsCount: Schema.Number.annotate({ description: "Total findings across all severities." }),
  severity: Schema.Literals(["none", "low", "medium", "high", "critical"]),
  reportUrl: Schema.String.annotate({ description: "Fully-qualified URL to the human-readable report." }),
}) {}
```

`Schema.annotate` is a real instance method on every schema — it returns
the same schema with metadata attached, so annotating does not change `A`
or `I`.

### Pure projections, not the internal model

Publish a value **built for the contract**, not the action's internal
working state. The internal model changes shape as the action's logic
changes; a projection function is the one place that absorbs that churn
without moving the published shape:

```ts
const toScanResult = (internal: InternalScanState): ScanResult =>
  ScanResult.make({
    findingsCount: internal.findings.length,
    severity: internal.highestSeverity,
    reportUrl: internal.report.url,
  });
```

Keep the projection a plain, total function — no `Effect`, nothing that can
fail — so a schema-shape change surfaces as a type error at the call site,
not a runtime failure discovered by a downstream consumer.

### Generating the committed JSON Schema

`Schema.toJsonSchemaDocument(schema, options?)` returns a JSON Schema
document at draft 2020-12:

```ts
export function toJsonSchemaDocument(
  schema: Constraint,
  options?: ToJsonSchemaOptions,
): JsonSchema.Document<"draft-2020-12">;
```

`Document<D>` is `{ dialect: D; schema: JsonSchema; definitions: Definitions }`
— `schema` is the root schema *without* its `$defs`; nested definitions
live separately in `definitions` and are referenced via
`#/$defs/<name>`.

Neither `$schema` nor a contract version number is part of that returned
shape — both are yours to add when you assemble the committed artifact:

```ts
import { Schema } from "effect";
import { ScanResult } from "./ScanResult.js";

const doc = Schema.toJsonSchemaDocument(ScanResult);

const artifact = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  schemaVersion: "1.0.0", // your own contract version, bumped on a breaking shape change
  ...doc.schema,
  ...(Object.keys(doc.definitions).length > 0 ? { $defs: doc.definitions } : {}),
};

// Write `artifact` as committed, formatted JSON — this is what consumers pin against.
```

`schemaVersion` is a contract you own, not an Effect or JSON Schema
convention — pick one field name and use it consistently across every
output contract the action publishes, so a consumer can dispatch on it
without inspecting the schema shape.

### Annotations for LLM and workflow consumers

`ToJsonSchemaOptions.includeAnnotationKey` filters which schema annotations
survive into the emitted document:

```ts
const doc = Schema.toJsonSchemaDocument(ScanResult, {
  includeAnnotationKey: (key) => key === "description" || key.startsWith("x-"),
});
```

Use `description` for the field-level prose a human or an LLM reads to
understand what a value means. Reserve an `x-`-prefixed custom annotation
key for a machine-only hint that would clutter the human-facing
description — e.g. `x-enum-severity-order` on a literal-union field, if a
consumer needs to know the literals are ordered rather than just
enumerated. Generation is best-effort: some Effect schema semantics have no
exact JSON Schema equivalent, so treat the emitted document as an external
contract artifact to review, not a value to trust blindly.

### The drift test

Commit the generated JSON Schema file next to the action's source, and add
a test that regenerates it in memory and asserts byte-for-byte agreement
with the committed file:

```ts
import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { readFileSync } from "node:fs";
import { ScanResult } from "../src/ScanResult.js";

describe("ScanResult output contract", () => {
  it("matches the committed JSON Schema", () => {
    const generated = Schema.toJsonSchemaDocument(ScanResult, {
      includeAnnotationKey: (key) => key === "description",
    });
    const committed: unknown = JSON.parse(readFileSync(new URL("../schemas/scan-result.schema.json", import.meta.url), "utf8"));
    assert.deepStrictEqual({ ...generated.schema, $defs: generated.definitions }, committed);
  });
});
```

A failing drift test means one of two things happened, and the fix
differs: the schema changed on purpose (regenerate and commit the new
file, bump `schemaVersion` if the change is breaking), or the schema
changed by accident (a field renamed in a refactor without updating the
contract — revert the schema change instead). The test cannot tell these
apart; a human reviewing the diff can.

Never hand-edit the committed schema file. If it disagrees with what the
generator produces, the generator — or the schema's annotations — is the
thing to change.
