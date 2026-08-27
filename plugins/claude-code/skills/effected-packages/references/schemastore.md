# @effected/schemastore

Effect Schemas published as SchemaStore-shaped Draft-07 JSON Schema documents: document assembly over core's generation + lowering, the annotation carriers that survive that lowering, both catalog modes over full-SemVer version labels, structural and hygiene lints, real-engine validation, deterministic JSON text, content-comparing file IO, and the emit pipeline over all of it. **Integrated tier since 2026-08-04** — `ajv` is a direct runtime dependency (see [validation](#validation-ships-closed)). All IO lives in one module; everything else is pure.

## Import

```ts
import { SchemaPipeline, SchemaTarget, SchemaFile, SchemaValidator, StoreDocument } from "@effected/schemastore";
```

**Platform**: `SchemaFile.layer` does real IO over core `FileSystem`/`Path` required in `R` — provide `@effect/platform-node` (or the Bun equivalent) at the edge. Nothing else in the package needs a platform.

## Start here: the pipeline

**`SchemaPipeline` is the entry point.** Reach for the individual modules only when you need something it does not do — most consumers should not be hand-writing the generate → lint → validate → gate → write loop, and three consumers who did each wrote it differently.

- **`SchemaPipeline.run(targets, options?)`** — for each `SchemaTarget`: build the document, gather both gates' findings, gate, write. Answers `ReadonlyArray<PipelineResult>` (`$id`, `path`, `outcome`, `change`, `findings`). **Enforces**: fails `SchemaGateError` and stops at the first blocked target, so a gated document is never written and neither are the ones behind it.
- **`SchemaPipeline.check(targets, options?)`** — the same walk with **no writes**, answering `ReadonlyArray<PipelineCheckResult>` (`wouldWrite`, `blocked`, `change`, `findings`). **Reports**: total over the targets, never stops at a blocked gate, and `SchemaGateError` is *not* in its error union. This is the drift-check surface for CI — a repo with three broken documents learns all three in one run.
- **`runOne` / `checkOne`** — a single target, one result, no indexing into a one-element array.
- **`SchemaPipelineOptions`** — `blocking?` (which findings block; **default `severity === "warning"`**), `validator?` (through to `SchemaValidator.validate`), `write?` (through to `SchemaFile.write`/`check`).
- **`PipelineFinding`** — both gates normalized into one shape (`source`, `severity`, `check?`, `path`, `message`) so a single predicate judges both; engine findings are always `"warning"` because a document the engine rejects is not advisory. `finding.label` is the rendered name (`check ?? source`) — use it instead of writing that fallback.
- **`SchemaGateError`** — `$id` plus **every** blocking finding for that target, so a caller renders one report rather than discovering problems one run at a time.

**Gating is policy, not mechanism.** The default blocks `warning` and lets `advisory` through, which is right (`UnresolvedRef`, `UnknownKeyword` and `DepthExceeded` each describe a document broken for the editors it exists to serve, and `UnknownKeyword` is by construction the ajv-strict rejection set). Disagreeing costs a predicate, not a re-implementation.

**But know which gate actually blocks here.** A target carries a `Schema`, so pipeline documents come from `fromSchema`, and the Draft-07 lowering drops undeclared keywords before the lint runs — `UnknownKeyword` is effectively unreachable through this entry point and the **engine** gate is what stops a bad document. The lint's warning checks earn their keep on documents the pipeline did not build (`StoreDocument.draft07`, or one read off disk) and on depth.

**Findings are values; the package never logs.** Log wording is repo policy. What the package owns is the gating decision, because that is the one that silently changes what ships.

## Validation ships closed

`SchemaValidator.layer` is a **real ajv implementation** — provide it and validation works, with no adapter to write. This reversed an earlier contract-seam design in 2026-08-04's `0.2.0`: the package is build-time tooling and ajv strict mode *is* SchemaStore's gate, so the seam was ceremony every consumer re-implemented identically and worse.

- Meta-schema failures keep ajv's structured `instancePath` and `keyword`; a strict-mode rejection (ajv throws those at compile time) becomes one root-pathed finding.
- Declared `KeywordFamilies` keywords are registered before compiling, **so ajv cannot reject what `DocumentLint` deliberately allows** — one predicate governs both verdicts. A hand-rolled adapter that skips this rejects any document carrying `x-taplo` or `markdownDescription`.
- The service stays an interface: `noop` turns validation off, `makeTest`/`layerTest` are the doubles (unstubbed members die naming themselves), another engine can be substituted. `SchemaValidatorShape` / `SchemaValidatorOptions` / `SchemaValidatorError` / `ValidationFinding` are the surrounding types; the error channel is reserved for the engine failing as a *mechanism*, never for a document it rejects.

## File IO: compare content, not bytes

- **`SchemaFile.write(path, document, options?)`** → `WriteResult` (`outcome`, `change`). Compares **parsed content** by default, so a repo whose formatter also owns the emitted file does not churn — a byte comparison rewrote forever and made `"unchanged"` unreachable (effected#262). `SchemaWriteOptions.compare: "bytes"` opts back in when the emitted text is itself the artifact.
- **`SchemaFile.check(path, document, options?)`** → `CheckResult` (`wouldWrite`, `change`). Same comparison, no filesystem write. Both routes compute from one internal helper, so they cannot disagree.
- **`outcome` / `wouldWrite` are the authoritative "was the file touched" answers** — never infer it from `change`, which is `"none"` on a `compare: "bytes"` write.
- **`WriteOutcome`** = `"written" | "unchanged"`; **`WriteChange`** = `SchemaChange | "created"`.
- `read(path)` answers exact text. Failures are typed and apart: `SchemaFileNotFoundError`, `SchemaFileReadError` (a comparison read that fails for any other reason fails rather than silently overwriting), `SchemaFileWriteError`, and `CanonicalJsonError` propagating as itself. `SchemaFileShape` is the service surface.

## Change classification

**`DocumentDiff.classify(existing, next)`** → **`SchemaChange`** = `"none" | "annotations" | "contract"`. This is the versioning signal: `"annotations"` means only prose and editor affordances moved, so the document replaces its predecessor transparently and needs no new version; `"contract"` means an assertion moved and a document valid yesterday may be invalid today.

- Object key order is never a difference (a formatter may sort); array order is.
- Keyword-position aware like the lint — a property *named* `description` is data.
- **`default`, `examples`, `readOnly` and `writeOnly` classify as `"contract"`**, not documentation, though the spec's taxonomy calls them annotations: consumers act on them, and misreporting a contract change ships a silent break while the reverse only costs a bump.
- **`DocumentDiff.isClean(change)`** — the clean case as a predicate rather than a `"none"` literal. `"created"` is deliberately not clean.

## Assembly, lint, catalog, versioning

- **`StoreDocument`** — `fromSchema`/`fromSchemaResult` run core's 2020-12 generation, the Draft-07 lowering, the `#/definitions` → `#/$defs` `$ref` rewrite and the annotation re-graft. `toJson()` is the flat publication shape; `serializeResult` routes through `CanonicalJson`. **`draft07({ $id, root, defs? })`** fills `$schema` for hand-built values — `$schema` stays a real field because it declares the dialect. `StoreDocumentOptions`, `SchemaConversionError`, `DRAFT_07_META_SCHEMA` (keeps the trailing `#`, unlike core's constant).
- **`AnnotationCarriers`** — the post-lowering re-graft (`carryResult`/`carry`), because **the Draft-07 lowering drops every keyword outside its fixed copy-list**; `includeAnnotationKey` alone is not enough. `CarrierDepthExceededError` on depth. **Annotate at the definition site** — a usage-site annotation on a hoisted schema carries nothing.
- **`KeywordFamilies.isDeclared`** — the ONE registry of the declared non-standard families (the vscode five by name; the `x-taplo`, `x-tombi-`, `x-intellij-` prefixes), consumed by the lint, the carriers and the ajv layer so none can drift.
- **`DocumentLint.lint(document)`** → `DocumentLintFinding[]`, never an error. Checks: `UnresolvedRef`, `UnknownKeyword`, `DescriptionWithoutUrl` (advisory), `DepthExceeded`.
- **`CatalogEntry`** — the `catalog.json` entry, `assemble`, and the `fileMatch` hygiene lint (`CatalogLintFinding`: `GenericFileMatch`, `ComplexFileMatch`).
- **`SchemaVersioning` / `SchemaVersion`** — **full three-component SemVer** labels (`major.minor.patch` + optional prerelease, no build metadata), enforced by `@effected/semver` itself; `parseResult`/`parse`, `InvalidSchemaVersionError`, an `Order` that is **numeric not lexical** (`1.10.0` > `1.9.0`) with the label round-tripping verbatim, plus `fileName`/`schemaUrl`/`catalogUrls` (`CatalogUrls`) deriving both catalog modes. **File names follow SchemaStore's `<name>-<version>.json`**; only the label grammar diverges from the store's partial-label corpus (`agripparc-1.2.json`), so that a label can be split back out of a name or URL unambiguously.
- **`SchemaTarget.make`** — `{ schema, $id, path, name?, version? }`. **`name` is optional** (only catalog naming reads it) and **required when `version` is present**, enforced by an overload pair, so a versioned target without a name is a compile error.
- **`CanonicalJson`** — the deterministic serializer: insertion-order keys (assembly owns ordering, nothing is sorted), tab indent by default (`CanonicalJsonOptions.indent`), LF, single trailing newline. Fails typed where `JSON.stringify` silently drops or rewrites: `NonJsonValueError` (with a JSON pointer) and `JsonDepthExceededError` (also catches cycles). `CanonicalJsonError` is the union.

## Usage

```ts
import { SchemaFile, SchemaPipeline, SchemaTarget, SchemaValidator } from "@effected/schemastore";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";

const targets = [
  SchemaTarget.make({
    schema: Schema.Struct({ name: Schema.String }),
    $id: "https://example.com/config.schema.json",
    path: "schemas/config.schema.json",
  }),
];

const AppLayer = Layer.mergeAll(SchemaFile.layer, SchemaValidator.layer).pipe(
  Layer.provide(NodeServices.layer),
);

// Generate: enforces, writes.
const generate = Effect.gen(function* () {
  for (const result of yield* SchemaPipeline.run(targets)) {
    yield* Effect.log(
      result.outcome === "written" ? `Written (${result.change}): ${result.path}` : `Unchanged: ${result.path}`,
    );
  }
}).pipe(Effect.provide(AppLayer));

// CI drift: reports, writes nothing.
const drift = SchemaPipeline.check(targets).pipe(Effect.provide(AppLayer));
```

## Testing

`SchemaValidator.layerTest({ validate })` for a scripted engine and `SchemaValidator.noop` to switch validation off. `SchemaFile` needs no package-specific double: core's `FileSystem.layerNoop({ ... })` plus `Path.layer` covers it, and `layerNoop`'s members fail `NotFound` unless overridden — which is exactly a missing file. To prove `"unchanged"` means untouched, override `makeDirectory`/`writeFileString` with `Effect.die`.

## Scope fence

**Must not grow into a general JSON Schema package**: no schema construction, no `$ref` resolution beyond the document's own `$defs` pool, no dialect conversion — core's `JsonSchema` owns the generation pipeline. Depending on ajv does not widen this: ajv is the validation gate, not a construction surface. `@effected/json-schema` is off the roadmap entirely because core made it redundant.
