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

The committed document is produced by `@effected/schemastore`, never by
hand-assembling `Schema.toJsonSchemaDocument`'s output. The package owns the
whole generate → lint → validate → gate → write loop: core's draft 2020-12
generation lowered to Draft-07 (the dialect SchemaStore and every editor
integration read), the `#/definitions` → `#/$defs` `$ref` rewrite that
lowering makes necessary, the structural lint, a real ajv strict-mode gate,
and a content-comparing write through a deterministic serializer. An action
repository writes the *target manifest* and the log wording, nothing else.

```ts
// lib/scripts/generate-schema.ts
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { SchemaFile, SchemaPipeline, SchemaTarget, SchemaValidator } from "@effected/schemastore";
import { Effect, Layer } from "effect";
import { SCAN_RESULT_SCHEMA_URL, ScanResult } from "../../src/schema/scan-result.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

// Exported so the drift test checks exactly the wiring the generator writes.
export const targets: ReadonlyArray<SchemaTarget> = [
  SchemaTarget.make({
    schema: ScanResult, // the SAME value setJson encodes through
    $id: SCAN_RESULT_SCHEMA_URL,
    path: resolve(REPO_ROOT, "docs/schema/scan-result.schema.json"),
  }),
];

export const AppLayer = Layer.mergeAll(SchemaFile.layer, SchemaValidator.layer).pipe(
  Layer.provide(NodeServices.layer),
);

const generate = Effect.gen(function* () {
  for (const result of yield* SchemaPipeline.run(targets)) {
    for (const finding of result.findings) {
      yield* Effect.logInfo(`${result.$id}: ${finding.label} at "${finding.path}" — ${finding.message}`);
    }
    yield* Effect.log(
      result.outcome === "written" ? `Written (${result.change}): ${result.path}` : `Unchanged: ${result.path}`,
    );
  }
});

const invokedDirectly =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  await Effect.runPromise(generate.pipe(Effect.provide(AppLayer)));
}
```

Three things in that script are load-bearing:

- **The `$id` is exported next to the schema**, in `src/schema/scan-result.ts`,
  and the emitted payload carries it as `$schema`, so a consumer reading the
  output can fetch the document that validates it.
- **`targets` and `AppLayer` are exported** so the drift test provides the
  same layer and walks the same targets. A drift test that rebuilds either
  one can pass while the generator emits something else.
- **The script lives in `lib/scripts/`**, the cache-invalidating location, and
  guards its run behind an `invokedDirectly` check so a test can import
  `targets` without generating. Wire it as `"schema:generate": "tsx lib/scripts/generate-schema.ts"`,
  and the drift test below as `"schema:check": "vitest run __test__/unit/generate-schema.test.ts"` —
  the test file lives under `__test__/unit/` per canon B1.
- **The run is all-or-nothing.** `SchemaPipeline.run` is two-phase: every
  target is generated and gated before any file is touched, so a failure on
  the last target leaves the first ones unwritten. A pinned versioned target
  whose contract would change refuses the whole run itself (see "Versioning
  the contract" below) — the script does not need its own preflight for that.
  The guarantee is a preflight, not a transaction: phase 2 writes the held
  documents one at a time with no rollback, so a filesystem failure on a
  later write leaves the earlier targets already on disk.

The gate is policy, not mechanism: the default blocks `warning` findings
(`UnresolvedRef`, `UnknownKeyword`, `DepthExceeded`, and every engine
finding) and lets `advisory` through. Replace the predicate when you disagree,
never the loop:

```ts
SchemaPipeline.run(targets, { blocking: (finding) => finding.source === "validator" });
```

Findings come back as values and the package never logs, so the wording of
your build output stays yours. A blocking finding fails with `SchemaGateError`
carrying every finding that blocked, and nothing after it is written.

### Versioning the contract

A structured output that payloads reference by `$schema` is a **versioned**
document: its URL has to keep resolving after the shape moves on. Give the
target a `name` and a `version` — `name` becomes required the moment
`version` is present, enforced by an overload pair — and let
`SchemaVersioning.fileName` spell the file:

```ts
import { SchemaVersioning } from "@effected/schemastore";
import { Result } from "effect";

const CATALOG_NAME = "scan-action";
const SCHEMA_BASE_URL = "https://raw.githubusercontent.com/your-org/scan-action/main/schemas";
const SCHEMA_SEMVER = SchemaVersioning.parseResult("1.0.0").pipe(
  Result.getOrThrowWith((e) => new Error(`invalid schema version: ${e.message}`)),
);

SchemaTarget.make({
  schema: ScanResult,
  // The $id carries the same version as the path: SchemaTarget publishes
  // it unchanged, so a versioned file needs a versioned identity.
  $id: SchemaVersioning.schemaUrl(SCHEMA_BASE_URL, CATALOG_NAME, SCHEMA_SEMVER),
  name: CATALOG_NAME,
  version: SCHEMA_SEMVER,
  path: resolve(REPO_ROOT, "schemas", SCHEMA_SEMVER, SchemaVersioning.fileName(CATALOG_NAME, SCHEMA_SEMVER)),
});
```

Version labels are full three-component SemVer, ordered numerically
(`1.10.0` above `1.9.0`); a bare-major label is rejected because it cannot
round-trip out of a file name unambiguously. The directory carries the same
label as the file so a version's artifacts stay together while the file name
remains the one SchemaStore resolves.

**The pipeline refuses the write itself — do not hand-roll a preflight.**
Under the default `contractChanges: "block-versioned"`, a target carrying a
PINNED `version` (`SchemaVersioning.isPinned`: no prerelease) whose
document classifies as a `"contract"` change fails the whole run with
`SchemaContractChangeError` *before any target is written* — not just that
target, every target in the same call. The error's `message` and its
`targets` array already name what to do: each `ContractChangeTarget` carries
`$id`, `path`, the pinned `version`, and `nextVersion` —
`SchemaVersioning.next(version, "contract")`, the label to bump to.

```ts
import { SchemaContractChangeError, SchemaPipeline } from "@effected/schemastore";
import { Effect } from "effect";

const generate = SchemaPipeline.run(targets).pipe(
  Effect.catchTag("SchemaContractChangeError", (error: SchemaContractChangeError) =>
    Effect.logError(error.message).pipe(Effect.zipRight(Effect.fail(error))),
  ),
);
```

`DocumentDiff` classifies `default`, `examples`, `readOnly` and `writeOnly`
as contract changes — consumers act on them — so a change there costs a
bump rather than shipping a silent break. `"created"` is not a contract
change: a version's first write has no predecessor. An **unversioned**
target, or one whose `version` is a prerelease label, is not guarded at all:
it is rewritten in place, same as before.

`contractChanges: "allow"` is the escape hatch — classify and report only,
never refuse. It is also the sanctioned **repair path** for a published file
whose on-disk text no longer parses (`SchemaFile` classifies unparseable
text as `"contract"` so it stays regenerable, and the default refuses
exactly that classification): pass `"allow"` once to let the corrupted file
be rewritten, then drop back to the default.

An unversioned document at a fixed path — an input schema, or a
documentation-facing output nobody pins — skips the version and name and
replaces its predecessor in place. `change: "annotations"` is then a free
signal that nothing a consumer acts on moved. `change: "contract"` on such a
target still deserves a deliberate look — the pipeline reports it but does
not refuse the in-place write — and the moment a consumer starts pinning the
document, move it onto the versioned path above instead of replacing it.

### Annotations for LLM and workflow consumers

Field-level prose that a human or an LLM reads to understand a value goes in
`description`, annotated at the **definition site** of the schema (a
usage-site annotation on a hoisted schema carries nothing through lowering).
The Draft-07 lowering drops every keyword outside its fixed copy-list and
the declared keyword families (the vscode five, `x-taplo`, `x-tombi-`,
`x-intellij-`, `x-ai-`), so an *undeclared* custom `x-` key on an output
contract is silently dropped rather than published — but `x-ai-*` **is**
declared: recommend `x-ai-hint` (a string) at the definition site for an
instruction to a machine reader that doesn't belong in `description` itself.

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

Import the generator's own `targets` and `AppLayer` and run the same walk
with no writes. Assert **all three** signals: a document the gate would
never write also reports no pending write, so `wouldWrite: false` alone
proves nothing, and a `contractBlocked` target needs a different remedy
than a plain drift finding — "run `schema:generate`" is wrong advice for a
target the generator itself will refuse.

```ts
import { assert, describe, it } from "@effect/vitest";
import { DocumentDiff, SchemaPipeline } from "@effected/schemastore";
import { Effect } from "effect";
import { AppLayer, targets } from "../../lib/scripts/generate-schema.js";

describe("generated JSON Schema", () => {
  it("has a target for every document the action publishes", () => {
    // `check([])` trivially reports no drift; guard the degenerate case.
    assert.isAbove(targets.length, 0);
  });

  it.effect("matches its Effect Schema source and would pass the gate", () =>
    Effect.gen(function* () {
      for (const result of yield* SchemaPipeline.check(targets)) {
        assert.isFalse(result.blocked, `${result.path} would fail the gate: ${result.findings.map((f) => f.label).join(", ")}`);
        if (result.contractBlocked) {
          assert.fail(`${result.path} changed its contract and is pinned — bump its version, do not just re-run schema:generate`);
        }
        assert.isTrue(DocumentDiff.isClean(result.change), `${result.path} is out of date (${result.change}); run schema:generate and commit`);
        // `change` is content-classified; under `write.compare: "bytes"` a
        // `"none"` change can still be a pending write, so ask directly.
        assert.isFalse(result.wouldWrite, `${result.path} would be rewritten; run schema:generate and commit`);
      }
    }).pipe(Effect.provide(AppLayer)),
  );
});
```

The comparison is by **parsed content, not bytes**. A formatter that owns
the committed JSON can reflow it freely; a text comparison would report
drift forever in such a repository, and `outcome` / `wouldWrite` — never
`change` — are the authoritative answers to whether a file was or would be
touched.

A failing drift test means one of two things, and the fix differs: the
schema changed on purpose (regenerate and commit; bump the version if the
change was a contract change), or the schema changed by accident (a field
renamed in a refactor — revert it). The test cannot tell these apart; a
human reviewing the diff can. Never hand-edit the committed schema file.
