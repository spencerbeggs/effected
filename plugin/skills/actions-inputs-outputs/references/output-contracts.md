# Machine-readable output contracts

A `setJson` output consumed by anything other than the same workflow's next
step — a downstream job, a bot, an LLM reading workflow output — is a public
API. Nothing in `@effected/github-actions` enforces contract stability for
you (no package in this repo ships one of these yet); this is the pattern to
apply on top of `ActionOutputs.setJson`, verified against what
`effect@4.0.0-beta.101` actually exports.

## Schema as the single source of truth

`ActionOutputs.setJson`'s signature is
`<A, I>(name, value: A, schema: Schema.Codec<A, I>) => Effect<void, ActionOutputError>`
(`packages/github-actions/src/ActionOutputs.ts:74-78`, `:117-121`) — the
schema is not optional decoration, it is the encoder. Define the contract
once as a `Schema.Class` (or `Schema.Struct`), export it from the action's
own module, and pass the *same* schema to `setJson` and to whatever
generates the committed JSON Schema below. Two schemas describing "the same"
output drift independently; one schema used for both never can.

```ts
import { Schema } from "effect";

export class ScanResult extends Schema.Class<ScanResult>("ScanResult")({
 findingsCount: Schema.Number.annotate({ description: "Total findings across all severities." }),
 severity: Schema.Literals(["none", "low", "medium", "high", "critical"]),
 reportUrl: Schema.String.annotate({ description: "Fully-qualified URL to the human-readable report." }),
}) {}
```

`Schema.annotate` is a real instance method on every schema
(`.repos/effect/packages/effect/src/Schema.ts:185`, `:538-539`) — it returns
the same schema with metadata attached, so annotating does not change `A`
or `I`.

## Pure projections, not the internal model

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

## Generating the committed JSON Schema

`Schema.toJsonSchemaDocument(schema, options?)` returns a JSON Schema
document at draft 2020-12
(`.repos/effect/packages/effect/src/Schema.ts:13444-13455`):

```ts
export function toJsonSchemaDocument(
 schema: Constraint,
 options?: ToJsonSchemaOptions,
): JsonSchema.Document<"draft-2020-12">;
```

`Document<D>` is `{ dialect: D; schema: JsonSchema; definitions: Definitions }`
(`.repos/effect/packages/effect/src/JsonSchema.ts:131-135`) — `schema` is
the root schema *without* its `$defs`; nested definitions live separately in
`definitions` and are referenced via `#/$defs/<name>`
(`JsonSchema.ts:103-107`).

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
survive into the emitted document (`Schema.ts:13390-13422`):

```ts
const doc = Schema.toJsonSchemaDocument(ScanResult, {
 includeAnnotationKey: (key) => key === "description" || key.startsWith("x-"),
});
```

Use `description` for the field-level prose a human or an LLM reads to
understand what a value means (as on `findingsCount` and `reportUrl` above).
Reserve an `x-`-prefixed custom annotation key for a machine-only hint that
would clutter the human-facing description — e.g. `x-enum-severity-order` on
the `severity` field, if a consumer needs to know the literals are ordered
rather than just enumerated. `toJsonSchemaDocument`'s own doc comment warns
generation is best-effort: some Effect schema semantics have no exact JSON
Schema equivalent, so treat the emitted document as an external contract
artifact to review, not a value to trust blindly (`Schema.ts:13434-13439`).

## The drift test

Commit the generated JSON Schema file next to the action's source, and add a
test that regenerates it in memory and asserts byte-for-byte agreement with
the committed file:

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

A failing drift test means one of two things happened, and the fix differs:
the schema changed on purpose (regenerate and commit the new file, bump
`schemaVersion` if the change is breaking), or the schema changed by
accident (a field renamed in a refactor without updating the contract —
revert the schema change instead). The test cannot tell these apart; a human
reviewing the diff can.

Never hand-edit the committed schema file. If it disagrees with what the
generator produces, the generator (or the schema's annotations) is the thing
to change.
