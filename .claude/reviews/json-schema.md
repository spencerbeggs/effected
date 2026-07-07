# Review: json-schema-effect → @effected/json-schema

Reviewed: 2026-07-06. Source: `/Users/spencer/workspaces/spencerbeggs/json-schema-effect` (v0.3.0, Effect v3.21+, ~1,400 src lines, ~1,740 test lines).
Target standards: `.claude/design/effected/effect-standards.md`. Judged on design, not v3 idioms.

## What the package actually is

Three services plus supporting pieces:

- **JsonSchemaExporter** — turns an Effect Schema into a cleaned, SchemaStore-shaped JSON Schema document (`generate`/`generateMany`) and writes it to disk idempotently (`write`/`writeMany`, returns `Written`/`Unchanged`).
- **JsonSchemaValidator** — compiles the generated document with Ajv and runs Tombi/Taplo annotation *placement-convention* checks (`x-tombi-*` keyword rules, strict `additionalProperties` audit).
- **JsonSchemaScaffolder** — generates starter TOML/JSON config files from a generated document (placeholder values from `default`/`examples`/`const`/`enum`, description comments, enum hints, commented-out optionals, `x-tombi-table-keys-order` ordering).
- **Helpers/schemas** — `tombi()`/`taplo()` typed annotation builders, `JsonSchemaClass` (Schema.Class wrapper carrying `$id` + ready-made `SchemaEntry`), `Jsonifiable` (clean-`{}` replacement for `Schema.Unknown`), `WriteResult` tagged union.

## 1. What is done well

- **The pipeline abstraction is right.** `SchemaEntry` (what to export: name, schema, `$id`, extra annotations) → `JsonSchemaOutput` (named document) → validate → write/scaffold. Every real consumer uses exactly this flow; it composes cleanly and each stage is independently adoptable. Preserve this shape.
- **Idempotent writes with `Written`/`Unchanged`.** Content-compare before write (deep-equal on parsed JSON for schemas, string-equal for scaffolds) avoids CI diff noise and needless mtime churn. This is exactly what build-tooling consumers (silk-release-action, tsdown-plugins) want. Keep it.
- **The Tombi/Taplo domain knowledge is unique and valuable.** Typed `tombi()`/`taplo()` builders mapping options to `x-tombi-*`/`x-taplo` keys, plus the validator's `PLACEMENT_RULES` table (e.g. `x-tombi-toml-version` root-only, `x-tombi-array-values-order-by` only on object nodes inside array items, `x-taplo` ignored under `$ref`). Nothing in Effect core will ever do this. This is the package's moat.
- **The scaffolder is genuinely novel.** Schema → commented starter TOML with deferred `[table]`/`[[table]]` emission, `# allowed:` enum hints, `# key = value  # optional, default: …` commenting. No overlap with v4 core; worth keeping intact (the pure string-generation helpers are cleanly separated from the writing service already).
- **`JsonSchemaClass` is the right DX instinct.** A schema that carries its own `$id`, produces its own `schemaEntry`, and has `toJson`/`validate` statics — self-describing domain models, exactly the class-based DX the standards want. The v3 *implementation* is contorted (see below) but the concept maps beautifully onto v4 `Schema.Class`.
- **Restrained error model.** Three errors total, each with a discriminating payload (`operation: "generate" | "write"`, `reason: "unresolved-ref" | …`) and a computed `message` getter. No error proliferation — the opposite failure mode of most codebases.
- **Documentation discipline.** Thorough TSDoc with `@public`/`@internal`/`@privateRemarks`, honest caveats documented in-code (the `extend()` `$id` inheritance gotcha, the Taplo `$ref` limitation), a numbered docs/ guide series, and an accurate README with an "API at a Glance" table.
- **Good test coverage of the domain**, including a snapshot integration test of the full pipeline and fixtures for known-bad schemas.

## 2. What is confusing or awkward

- **Kind-based folder sprawl with suppressed import cycles.** `errors/`, `helpers/`, `layers/`, `schemas/`, `services/` — and because service tags and their layers *want* to live together, every service/layer file carries `// biome-ignore lint/suspicious/noImportCycles: intentionally co-locates`. The code is literally fighting the layout to achieve module-per-concept. Eight ignore comments are the tax. The target layout dissolves all of them.
- **`Live`/`Test` static getters defeat layer memoization.** `static get Live() { return JsonSchemaExporterLiveImpl(); }` returns a *fresh* layer object on every property access. Layers memoize by reference, so `Layer.provide(X.Live, …)` in two places builds the service twice. The impl functions take no parameters — there is no reason for them to be functions. Standards: bind layers to constants.
- **"Test" layers are mislabeled.** `Exporter.Test` = Live + `NodeFileSystem.layer` — that is a *Node-wired Live layer*, not a test double (it does real disk IO). `Validator.Test` is literally `Live`. The naming promises in-memory determinism it doesn't deliver.
- **The optional peer is de facto required.** `JsonSchemaExporter.ts` value-imports `JsonSchemaExporterTest.js`, which value-imports `NodeFileSystem` from `@effect/platform-node` — eagerly, at module load, from the main entry. A consumer who skipped the "optional" peer crashes on `import { JsonSchemaExporter }`. The optionality is fiction as published.
- **The Ajv dependency is schizophrenic.** `ajv` is a regular `dependency`, yet the validator dynamically imports it with a "please install ajv" catch — a hard dep treated as optional at runtime, plus CJS/ESM `.default?.default` interop gymnastics. Pick one story.
- **`JsonSchemaClass` implementation is `any`-cast Object.defineProperty gymnastics** — four `biome-ignore noExplicitAny` in one file, getters capturing `this` at access time, and a documented footgun where `extend()`ed classes silently keep the base class's `$id`. v3 `Schema.Class` forced this; v4 statics on `Schema.Class` subclasses make it a plain class body.
- **`ErrorBase` export pollution.** `JsonSchemaErrorBase`/`JsonSchemaValidationErrorBase`/`ScaffoldErrorBase` are exported solely to satisfy API Extractor visibility on the `Data.TaggedError(...)` intermediate. Three public exports nobody should use, each needing a `@privateRemarks` apology. `Schema.TaggedErrorClass` removes the intermediate entirely.
- **Hand-rolled primitives.** `deepEqual` (Effect has `Equal`, or compare serialized strings as the scaffolder already does); `WriteResult` as a hand-written tagged union + two factory functions instead of a schema-backed union; `path.lastIndexOf("/")` for parent-dir derivation instead of the `Path` service (breaks on Windows); error `reason: String(error)` flattening causes to strings instead of preserving a `cause` field.
- **Exception-based control flow inside pure helpers.** `scaffold.ts` throws `UnsupportedTypeError`, the layer throws `InternalScaffoldError` from a recursive walker, and `Effect.try` catches and re-classifies both by `instanceof`. Works, but it's a shadow error channel running parallel to the typed one.
- **Errors aggregated as `ReadonlyArray<string>`.** `JsonSchemaValidationError.errors` is prose strings with paths baked in (`"#/properties/foo: …"`), and `validateMany` collapses all schemas' failures into one error whose `name` is a comma-joined list. Fine for CLI printing, hostile to programmatic handling.
- **No observability at all.** Zero `Effect.log`, zero spans, no `Effect.fn`. For a build-pipeline tool whose failures show up in CI, named spans on `generate`/`validate`/`write` are cheap and high-value.
- **Tests are plain vitest.** `it()` + `Effect.runPromise` + a per-file `run()` helper providing layers inside each test — the exact anti-pattern the standards call out. Also every "unit" test does real disk IO via NodeFileSystem.

## 3. v4 migration implications

**What v4 core supersedes:**

- `JSONSchema.make` → `Schema.toJsonSchemaDocument` (v4's rewritten generator with dialect targets and proper `$defs` handling). The exporter's `inlineRootRef` and much of `cleanSchema` exist to fight v3 generator quirks: `$defs`-wrapped roots, `$id: "/schemas/unknown"` artifacts, empty `required` arrays, `undefined`-valued keys. **Each cleanup rule must be re-tested against v4 output; expect most to drop.** The integration snapshot test is the perfect harness for this — regenerate against v4 and diff.
- `Jsonifiable` is a workaround for v3 `Schema.Unknown`'s Ajv-hostile output, implemented against `SchemaAST.JSONSchemaAnnotationId` internals. Almost certainly superseded (or at minimum reimplemented against v4 annotation APIs). Treat as delete-candidate pending verification.
- `JsonSchemaClass`'s type-level contortions: v4 `Schema.Class` supports statics naturally, so the factory collapses to a small subclass pattern or a `$id` annotation convention plus a `toSchemaEntry` helper.
- `Data.TaggedError` + Base exports → `Schema.TaggedErrorClass` (per standards ladder); computed `message` getters carry over.

**What retains full value (the v4 package's reason to exist):**

1. SchemaStore-oriented post-processing: `$id` injection, custom annotation merging, `$schema`/`$id` key ordering, whatever cleanup rules survive.
2. The Ajv validation gate + Tombi/Taplo placement-convention checks — v4 generates schemas; it does not *audit* them for third-party tool compatibility.
3. `tombi()`/`taplo()` typed annotation builders.
4. The TOML/JSON scaffolder, entirely.
5. Idempotent `Written`/`Unchanged` file writing.

**Other v4 notes:** `FileSystem`/`Path` move into `effect` core, so the platform peer problem dissolves — services require `FileSystem` from core and consumers provide `@effect/platform-node`'s implementation at the edge. Semantics of `Effect.try`/`Layer.effect` usage all have direct v4 equivalents; nothing here is architecturally stranded.

## 4. Candidate module-per-concept layout

~~~text
src/
  index.ts                 # re-exports only
  JsonSchemaDocument.ts    # Schema.Class model replacing JsonSchemaOutput + SchemaEntry;
                           # statics: fromSchema(entry) / generate; owns JsonSchemaError
                           # (Schema.TaggedErrorClass); the exporter Context.Service +
                           # layer(s) live here (generate + idempotent write)
  JsonSchemaValidator.ts   # Context.Service + layer; owns JsonSchemaValidationError;
                           # ValidatorOptions schema
  Scaffold.ts              # Context.Service + layer for scaffold/writeScaffold; owns
                           # ScaffoldError; ScaffoldOptions schema; pure scaffoldJson/
                           # scaffoldToml become statics (Scaffold.toJson / Scaffold.toToml)
  Tombi.ts                 # Tombi annotation concept: typed builder as static
                           # (Tombi.annotations(options)) + the x-tombi-* PLACEMENT_RULES
                           # (consumed by JsonSchemaValidator)
  Taplo.ts                 # same for x-taplo
  WriteResult.ts           # Schema union (Written | Unchanged) — or fold into
                           # JsonSchemaDocument.ts if it stays exporter-internal
  internal/
    clean.ts               # surviving cleanSchema rules (post-v4 re-verification)
    write.ts               # shared idempotent writer (used by Document + Scaffold);
                           # uses Path service, not string slicing
    scaffold-json.ts       # scaffoldObject/resolveValue/placeholderForType
    scaffold-toml.ts       # emitTomlLines/formatTomlValue/orderKeys
~~~

Notes: `Jsonifiable.ts` only returns if v4 verification proves it's still needed. Layers become constants (`JsonSchemaValidator.layer`, `Scaffold.layer`), not getters. The Node-wired "Test" layers are deleted — tests provide `NodeFileSystem.layer` (or an in-memory FS) at the `layer(...)` boundary per testing standards. All operations wrapped in `Effect.fn("JsonSchemaDocument.generate")` etc.

## 5. Extraction, splits, and consumers

**Actual consumers today (verified by grep, differs from the assumed list):**

| Consumer | What it uses |
| --- | --- |
| savvy-web/silk-release-action (`lib/scripts/generate-schema.ts`) | Exporter (generate + write) and Validator — build-time schema generation for action input/output schemas |
| savvy-web/systems `packages/tsdown-plugins` (`src/report/schema-export.ts`) | Exporter.generate only (+ `JsonSchemaOutput`/`JsonSchemaError` types), build-time, internal |
| spencerbeggs/xdg-effect | **Facade re-export only** — `src/index.ts` re-exports the entire surface; no internal usage found in src |
| spencerbeggs/config-file-effect | **Does not consume it** (no source references found, despite the framing) |

Implications: the load-bearing surface is `generate` → `validate` → `write` plus the type names. Nobody currently calls the scaffolder or tombi/taplo helpers outside this repo's own tests — they are speculative-but-coherent surface. xdg-effect's blanket re-export facade should not survive the monorepo migration (consumers should import `@effected/json-schema` directly); this also means the re-exported `*Base` names disappearing is a non-event.

**Split candidates:**

- **Keep one package.** At ~600 lines of real logic with `sideEffects: false` and clean module boundaries, splitting `@effected/toml-scaffold` or `@effected/tombi` out now is premature. But the seam is clean and worth preserving: `Scaffold.ts` + `Tombi.ts` + `Taplo.ts` depend on the document model only through `JsonSchemaOutput`'s plain shape. If a TOML-tooling package is ever wanted, it lifts out along those three files.
- **The idempotent writer** (`internal/write.ts`) is a candidate for promotion to a shared `@effected` internal utility later — config-file-effect and xdg-effect plausibly want "write iff changed" too. Don't extract preemptively; note the seam.
- **Pure/boundary seam inside the package:** `generate`, `validate`, and scaffold-string-generation are pure CPU; only `write`/`writeScaffold` touch `FileSystem`. Design the v4 services so the pure operations don't require `FileSystem` (in v3, `Layer.effect` acquires `fs` up front, making even `generate` require the FS-provided layer — that's a real design flaw, not a v3 idiom: tsdown-plugins only generates but must provide `NodeFileSystem`).

## 6. Peer/dependency hygiene and tier

**Current state (v3):** peers = `effect`, `@effect/platform`, `@effect/platform-node` (optional); all mirrored in devDependencies; `ajv` as a regular dependency. The declared closure is formally complete for v3 (platform's own peers are covered). Two real defects:

1. The optional `@effect/platform-node` peer is eagerly imported from the main entry (via the `Test` static getter chain) — optionality is broken in practice.
2. `ajv` is simultaneously a hard dependency and runtime-optional (dynamic import with install-hint error). For v4: either keep it a regular dependency and import it statically, or make it an optional peer and keep the lazy load — not both.

**Tier verdict: Boundary, not Pure.** The package-inventory's "pure (verify)" does not hold: `write`/`writeMany`/`writeScaffold` are core to the package's value (silk-release-action writes to disk through it) and require `FileSystem`. However, in v4 this costs nothing in the peer closure: `FileSystem`/`Path` live in `effect` core, so the target peers are **`effect` only**, with `@effect/platform-node` appearing solely in devDependencies for tests and in consumers at the edge. `ajv` remains the only non-effect dependency. That is the cleanest possible Boundary profile — and if the pure/boundary seam from §5 is honored, everything except the two write methods works with zero platform provision.
