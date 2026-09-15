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

`ActionOutputError` is a **union type alias, not a class** — one exported
`Schema.TaggedError` class per failure, discriminated by `_tag`:

| Class | Fires when | Carries |
| --- | --- | --- |
| `RunnerFileUnavailableError` | the runner-file variable itself is unset — usually means the code isn't running on a runner | `file` |
| `RunnerFileWriteError` | the file exists but could not be appended to | `file` |
| `InvalidOutputNameError` | the name would corrupt the block structure (`""`, or containing `\r`/`\n`) | `name`, `file?` |
| `OutputEncodeError` | a `setJson` value didn't satisfy its schema | `name` |
| `DetachedOutputError` | any member was called under `ActionOutputs.layerDetached` | `file`, `name?` |

**Match on `error._tag`, never `error.reason`** — the old
one-class-with-a-`reason`-field shape is gone, and a `reason` read on one of
these no longer type-checks. The required fields differ per arm on purpose:
the runner file is required only on the arms that name one, so a value short
a field is a compile error rather than a message reading `"undefined"`. The
practical gain is recovery granularity — `Effect.catchTag("OutputEncodeError",
…)` now recovers from exactly that failure and leaves a write failure
propagating, where the single class made every catch all-or-nothing.
`ActionOutputError` itself is unchanged as a signature: every member still
returns `Effect<void, ActionOutputError>`.

### Where the runner files come from

`ActionOutputs`' internal write path resolves the destination path by
asking `ActionEnvironment` for the runner-file **variable name** —
`"GITHUB_OUTPUT"`, `"GITHUB_ENV"`, `"GITHUB_PATH"`, `"GITHUB_STEP_SUMMARY"`.
`ActionEnvironment` is the one reader of `process.env` in the package,
snapshotted once into an immutable map when its layer builds; a lookup
fails typed (`RunnerFileUnavailableError`) rather than resolving to
`undefined` when a variable is unset — exactly what happens when this code
runs off a real runner.

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
applies to the output **name**: an empty name, or one containing `\r` or
`\n`, is refused (`InvalidOutputNameError`) before anything is written,
rather than corrupting the block structure. `addPath` and `summary` write no
name, so neither can raise it.

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

The committed document is produced by the `schemastore` command
(`@effected/schemastore-cli`) over `@effected/schemastore`, never by
hand-assembling `Schema.toJsonSchemaDocument`'s output and never by a
generator script of your own. The library owns the whole generate → lint →
validate → gate → write loop — core's draft 2020-12 generation lowered to
Draft-07 (the dialect every editor integration reads), the `#/definitions` →
`#/$defs` `$ref` rewrite that lowering makes necessary, the structural lint,
a content-comparing write through a deterministic serializer — and the
command adds the ajv strict-mode gate, the drift policy, the frozen-label
checks and the exit codes. An action repository writes three things: the
schema's **hosted identity** next to the schema, a `schemastore.config.ts`,
and two scripts.

**Two packages, two roles.** `@effected/schemastore` is a regular
`dependency` — the action's own code reads the identity from it at runtime
to write `$schema`. `@effected/schemastore-cli` is a `devDependency` — it
builds and checks the documents, and it is where `ajv` lives, so the
action's bundle never carries an engine (silk-release-action measured this:
ajv absent from the prod install and from `dist/`).

```ts
// src/schema/scan-result.ts — the identity lives beside the schema it names
import { HostedSchema } from "@effected/schemastore";
import { Schema } from "effect";

export const SCAN_RESULT_SCHEMA_VERSION = "1.0";

export const ScanResultIdentity = HostedSchema.github({
  repo: "your-org/scan-action",
  path: "schemas",
  name: "scan-action.output",
  versions: [SCAN_RESULT_SCHEMA_VERSION],
});

export class ScanResult extends Schema.Class<ScanResult>("ScanResult")({
  // Every payload names the document it was written against.
  $schema: Schema.Literal(ScanResultIdentity.$id),
  findingsCount: Schema.Number.annotate({ description: "Total findings across all severities." }),
  severity: Schema.Literals(["none", "low", "medium", "high", "critical"]),
  reportUrl: Schema.String.annotate({ description: "Fully-qualified URL to the human-readable report." }),
}) {}
```

```ts
// lib/scripts/schemastore.config.ts — `src/` is action source only, so the
// config lives under lib/scripts/ and the scripts pass its path explicitly
import { defineConfig } from "@effected/schemastore";
import { ScanResult, ScanResultIdentity } from "../../src/schema/scan-result.js";

export default defineConfig({
  // Relative paths resolve against this file's directory, not the repo root.
  outputDir: "../../schemas",
  schemas: {
    [ScanResultIdentity.name]: { schema: ScanResult, hosted: ScanResultIdentity, published: false },
  },
});
```

```json
{
  "scripts": {
    "schema:build": "schemastore build lib/scripts/schemastore.config.ts",
    "schema:check": "schemastore check lib/scripts/schemastore.config.ts"
  }
}
```

Four things in that shape are load-bearing:

- **The identity is declared once and read twice.** `ScanResultIdentity.$id`
  is what the payload asserts as `$schema`; the config hands the same value
  to `defineConfig` as `hosted`, so `$id`, the write path
  (`schemas/1.0/scan-action.output-1.0.json`) and every URL derive from it.
  Nothing is spelled by hand, so nothing can disagree — the test that used
  to pin `SCHEMA_URL === target.$id` has nothing left to pin.
- **The config composes no layers.** It declares schemas; the command
  provides `SchemaFile`, the engine and the platform. A layer in a config
  file is a sign the pre-CLI generator-script pattern is being rebuilt.
- **`schema:check` is the CI gate.** It is the same walk as `build` with no
  writes, and it fails (exit `1`) whenever a build would write anything —
  wire it into `ci:test` ahead of the test run. Stale document: run
  `schema:build`, review the diff, commit. Never hand-edit the committed
  file.
- **Objects are closed.** The library emits `additionalProperties: false`
  by default (a published document is a contract; it does not follow core's
  open default). The action's decoders can keep tolerating excess keys — the
  published document is deliberately the stricter of the two. `jsonSchema:
  { onExcessProperty: "ignore" }` on one entry reopens that one document.

The gate is policy, not mechanism: warning findings (`UnresolvedRef`,
`UnknownKeyword`, `DepthExceeded`, every engine finding) block; advisory ones
report. Findings are values in the command's report (`--format=json`) and the
step summary (`GITHUB_STEP_SUMMARY`), never logs you have to parse.

### Versioning the contract

A structured output that payloads reference by `$schema` is a **versioned**
document: its URL has to keep resolving after the shape moves on. The
identity's `versions` list is the whole mechanism. `current` (default: the
newest label) is the one generated; every other label is **frozen** — the
command verifies the file exists and still declares the `$id` the identity
derives for it, and never regenerates it. Bumping is one edit:

```ts
export const SCAN_RESULT_SCHEMA_VERSION = "1.1";

export const ScanResultIdentity = HostedSchema.github({
  repo: "your-org/scan-action",
  path: "schemas",
  name: "scan-action.output",
  versions: ["1.0", SCAN_RESULT_SCHEMA_VERSION], // 1.0 stays on disk, frozen
});
```

Version labels are one to three components (`1`, `1.2`, `1.2.0`, optionally
with a prerelease), ordered by SemVer precedence with missing components read
as `0`, each round-tripping verbatim into its file name. A first-run config
declares a single label; append the next only once the first has shipped and
its file exists on disk, or the build fails typed before writing anything
(`FrozenVersionMissingError`). A `repo`, `branch` or `path` change is a
re-publish event for every frozen label: the frozen files still carry the
old host in `$id`, and the command refuses them (`FrozenVersionIdMismatchError`)
rather than advertising documents that self-identify elsewhere.

**`published` is the lifecycle switch, and the command holds the write.**
Leave it at the default `false` until a consumer pins the document — an
unpublished schema regenerates in place through any change, contract
included. Flip it to `true` the day the document is depended on: from then a
`contract` change at the current label (`DocumentDiff` counts `default`,
`examples`, `readOnly` and `writeOnly` as contract — consumers act on them)
is **drift**, and under the config's `onDrift: "error"` default the command
refuses every write and names the label to bump to (`nextVersion`, from
`SchemaVersioning.next`). `--on-drift=warn` writes and shouts;
`--force` (`--drift=allow`) is the escape hatch and the sanctioned repair
path for a committed file whose text no longer parses.

An unversioned document at a fixed path — an input schema, or a
documentation-facing output nobody pins — omits `versions` and replaces its
predecessor in place; the moment a consumer starts pinning it, give it a
label.

### Annotations for LLM and workflow consumers

Field-level prose that a human or an LLM reads to understand a value goes in
`description`, annotated at the **definition site** of the schema (a
usage-site annotation on a hoisted schema reaches nothing, even before
lowering).
Since effect rc.112 the Draft-07 lowering **carries unknown and custom
keywords through as opaque values**, so an *undeclared* custom `x-` key on
an output contract **is published** — do not rely on the lowering filtering
it out. (It dropped every keyword outside a fixed copy-list before rc.112;
if you learned the old behavior, unlearn it — the failure mode is shipping a
key you assumed could not escape.) Whether an undeclared key can reach the
document at all is decided upstream of the lowering, by whatever admits it:
`@effected/schemastore`'s `StoreDocument.fromSchema` refuses one outright
with `UndeclaredAnnotationKeyError` rather than emitting it. Prefer the
declared families (the vscode five, `x-taplo`, `x-tombi-`, `x-intellij-`,
`x-ai-`) — `x-ai-*` **is** declared: recommend `x-ai-hint` (a string) at the
definition site for an instruction to a machine reader that doesn't belong
in `description` itself.

The key must be one ajv can register: after the prefix it may use only
`[A-Za-z0-9_$:-]`, because ajv holds a keyword name to
`/^[a-z_$][a-z0-9_$:-]*$/i`. A dot, a space, a slash, an `@`, a `+` or any
non-ASCII character makes the engine gate reject the whole document as a
finding, so `x-ai-model.name` is out and `x-ai-hint:v2` is fine.

Its value must be JSON — `CanonicalJson` fails typed (`NonJsonValueError`) on
anything else, same as every other emitted value — and must not contain an
`$id`, or a repeated `$anchor`, at **any depth** rather than merely as its own
top-level key: ajv's reference collection walks unknown keywords looking for
them, so a colliding one buried anywhere inside an `x-ai-hint` payload fails
the compile, and an empty-string `$id` resolves to the root id and collides
too. `x-ai-*` is oriented at **self-hosted publication**: no upstream tool
sanctions it, so a document carrying it that is submitted to schemastore.org
needs the corresponding entry added to that repo's own validation config
first.

Generation is best-effort: some Effect schema semantics have no exact JSON
Schema equivalent, so review the emitted document as an external contract
artifact rather than trusting it blindly.

### The drift test

There is none to write. `schema:check` *is* the drift test — the same walk
as `build` with no writes, exit `1` on anything a build would write, a gate
failure, or drift on a published document — and it runs the command's own
loader, engine and policy, so it cannot pass against wiring the build never
uses (the failure a hand-rolled vitest drift test over an exported `targets`
array was always one refactor away from). Put it in `ci:test`:

```json
{
  "scripts": {
    "ci:test": "schemastore check lib/scripts/schemastore.config.ts && vitest run --coverage"
  }
}
```

What a unit test *can* still pin is the one thing the command cannot see —
that the config wired each schema to the right identity:

```ts
import { assert, describe, it } from "@effect/vitest";
import { StoreDocument } from "@effected/schemastore";
import { Result } from "effect";
import config from "../../lib/scripts/schemastore.config.js";
import { ScanResultIdentity } from "../../src/schema/scan-result.js";

describe("schemastore config", () => {
  it("derives each target from the identity the action writes as $schema", () => {
    const [target] = config.schemas;
    assert.isDefined(target);
    assert.strictEqual(target.target.$id, ScanResultIdentity.$id);
    assert.strictEqual(target.target.path, `../../schemas/${ScanResultIdentity.fileName}`);
  });

  it("emits every object closed", () => {
    // What the command writes for an entry with no jsonSchema is exactly
    // fromSchemaResult with no jsonSchema — the documented reproduction contract.
    const [target] = config.schemas;
    assert.isDefined(target);
    const document = Result.getOrThrow(StoreDocument.fromSchemaResult(target.target.schema, { $id: target.target.$id }));
    assert.strictEqual(document.root.additionalProperties, false);
  });
});
```

The comparison the command makes is by **parsed content, not bytes**: a
formatter that owns the committed JSON can reflow it freely. A failing
`schema:check` means one of two things, and the fix differs: the schema
changed on purpose (run `schema:build`, review, commit; bump the label if the
command reports drift on a published document), or the schema changed by
accident (a field renamed in a refactor — revert it). The command cannot tell
these apart; a human reviewing the diff can.
