---
name: effect-v4-schema
description: Use when designing, reading, reviewing, or debugging any Effect v4 Schema — the Class-vs-Struct decision, fields and optionality, checks/refine/makeFilter, tagged unions, transformations and codecs (decodeTo, the FromString static), make-vs-new construction, brand/Opaque scalars, custom Equal/Hash, and derived tooling (toArbitrary, toJsonSchemaDocument). Also covers primitives, records, recursive schemas, custom declare types, serialization (JSON/XML/FormData), and error formatting. Verified against effect@4.0.0-beta.94; for v3→v4 renames see effect-v4-construct-map.
---

# Effect v4 Schema

The single skill for Effect v4 `Schema`. It carries three layers:

1. **The house rules** — the [Do this, not this](#do-this-not-this) table below,
   our opinionated defaults distilled from the `@effected` migrations.
2. **[references/house-style.md](./references/house-style.md)** — the worked
   examples and the reasoning behind each rule (the traps that only surface at
   test/property-test time).
3. **[`references/`](./references/)** — **Effect's own canonical Schema guide**
   (`effect-smol`, `packages/effect/SCHEMA.md`) split by topic, for the exhaustive
   detail on any construct.

Do not load all references at once — each is a standalone topic (some >1000
lines).

## Do this, not this

Each row is a hard house default; reasoning and worked code in
[house-style.md](./references/house-style.md).

| Do | Not |
| --- | --- |
| `Schema.Class` / `TaggedClass` / `TaggedErrorClass` for any reusable model, union member, or error | a bare `Schema.Struct` for a domain type — `Struct` is for throwaway inline shapes |
| `X.make({...})` as the default constructor | `new X({...})` outside a measured hot path (both validate identically) |
| reach for `{ disableChecks: true }` only to accept *trusted* data that would fail a `.check(...)` | reach for it as a **speed** switch — despite a docstring promising to "skip validation", it gates only the check phase: type errors still throw, the structural re-parse still runs, and a depth-20 build measured 2671 ms with it vs 2711 ms without |
| build a recursive `Schema.Class` AST via an internal `Object.assign(Object.create(Proto), props)` path, validating once at the boundary | construct a recursive `Schema.Class` tree node-by-node — each level re-validates its whole subtree, so cost **doubles per level** (depth 20 = 2.7 s, probed beta.97); the bypass is faithful because `Data.Class`'s constructor *is* `Object.assign(this, props)` |
| dodge the class factory's reserved static names when designing domain statics — every `Schema.Class`/`TaggedClass`/`TaggedErrorClass` base already declares `identifier`, `fields`, `ast`, `pipe`, `rebuild`, `make`, `makeOption`, `makeEffect`, `annotate`, `annotateKey`, `check`, `extend`, `mapFields` (vendored `Schema.ts` `makeClass`) | a domain static reusing one of those names — an incompatible signature is a TS2417 compile error (*static side incorrectly extends base*); the lockfiles port had to rename an approved `LockfileIntegrity.check(lockfile, manifests)` design to `compare` on exactly this |
| conditional-spread an absent optional field | pass an explicit `undefined` for a `Schema.optionalKey` — a *present* `undefined` throws |
| `Schema.optionalKey` for object fields | `Schema.optional` unless the *value* itself must carry `undefined` |
| `.check(is*)` to constrain, `refine` to narrow, `check(makeFilter(...))` for cross-field | the removed `positive`/`negative` or the v3 `filter`/`greaterThan` names |
| tagged unions of `TaggedClass` members (`_tag` branching) | untagged unions for domain variants |
| `Schema.Literals(["a", "b", "c"])` for any multi-literal union (reason fields, enums) | the v3 variadic `Schema.Literal("a", "b", "c")` — v4 `Literal` takes ONE argument; tsgo rejects the variadic call (TS2554), but the **runtime silently keeps only the first literal**, so a suite run before typecheck green-lights a schema that rejects every other member |
| `Source.pipe(decodeTo(Target, SchemaTransformation.transform({...})))` | a top-level `Schema.transform` / `transformOrFail` — **not callable** in beta.94 |
| a `FromString` `Schema.Codec<Self, string>` static (string = the encoded form of the same schema) | a second parser divorced from the schema |
| `cause: Schema.Defect()` on an error class | `cause: Schema.Defect` — the bare (uncalled) form throws at construction |
| `Schema.decodeUnknownEffect` / `encodeUnknownEffect` in Effect flows | `*Sync` outside a genuine sync boundary |
| annotate recursive `Schema.suspend` refs `Schema.Codec<T>` (services default `never`) | `Schema.Schema<T>` as the suspend annotation — it compiles at the declaration but leaves `DecodingServices` `unknown`, so every decode entrypoint rejects the schema (`unknown is not assignable to never`, probed beta.94); a schema nobody decodes directly hides the trap until a consumer tries |
| derive variants via `mapFields(Struct.pick/omit/map(...))` | duplicate a schema to re-encode the same data |
| attach brand statics with `Object.assign`; export the type as `string & Brand.Brand<"N">` | try to merge a `namespace` into the brand `const` (impossible) |
| override BOTH `[Equal.symbol]` AND `[Hash.symbol]` when equality ignores fields | override `[Equal.symbol]` alone — the hash fast-path silently defeats it |
| `Schema.toJsonSchemaDocument(S)` | `Schema.toJsonSchema(S)` — that export does not exist |

## Verify against the installed beta, not the references

The `references/` track **upstream `effect-smol` main**, which runs AHEAD of the
pinned `effect@4.0.0-beta.94` in this repo. Treat them as authoritative on *shape
and intent*, not on exact export names. Before relying on any specific API, probe
it from a package on the v4 catalog:

```bash
node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.TheApiYouWant)"
```

If it prints `undefined`, the name moved or has not landed in beta.94 yet — check
`node_modules/effect/dist/Schema.d.ts` or the `effect-v4-construct-map` rename
tables. The "Do this, not this" rules above already fold in the beta.94 gotchas
the upstream prose does not flag.

## Reference map

Load the one section you need. Each file carries a provenance banner (upstream
source + the beta-skew warning).

| Reference | Load when |
| --- | --- |
| [01-overview](./references/01-overview.md) | Orienting on the design philosophy — codecs, the Type/Encoded split, the `~`-prefixed internal type members. |
| [02-elementary-schemas](./references/02-elementary-schemas.md) | Primitives, literals, strings & string formats, numbers/integers/bigints, dates, template literals. |
| [03-composite-schemas](./references/03-composite-schemas.md) | Structs, tuples, arrays, records, unions, recursive schemas. The biggest section — the day-to-day modeling vocabulary. |
| [04-custom-types](./references/04-custom-types.md) | Declaring a schema for a type Schema doesn't know — `Schema.declare` (non-parametric) and `declareConstructor` (parametric). |
| [05-validation](./references/05-validation.md) | Filters as first-class, checks/refinements/branding, structural & effectful filters, multiple-issue reporting, aborting, filter groups & factories. |
| [06-constructors](./references/06-constructors.md) | `make` in composed/branded/refined schemas, default values (incl. effectful defaults). |
| [07-transformations](./references/07-transformations.md) | `decodeTo`/`encodeTo`, the transformation type, composing, passthrough helpers, optional-key management, omit-on-encode. |
| [08-flipping-schemas](./references/08-flipping-schemas.md) | `Schema.flip` — swapping Type and Encoded, and what it does to constructors. |
| [09-classes-and-opaque-types](./references/09-classes-and-opaque-types.md) | Opaque structs, schema-as-a-class, the `Schema.Class` family (methods, statics, extension). |
| [10-serialization](./references/10-serialization.md) | JSON, string-encoding, FormData, URLSearchParams, canonical codecs, the XML encoder. |
| [11-generation-and-tooling](./references/11-generation-and-tooling.md) | Deriving JSON Schema, Arbitrary, Equivalence, Optic; type-safe JSON patches via Differ. |
| [12-schema-representation](./references/12-schema-representation.md) | The introspectable representation data model, its limitations, JSON round-tripping, rebuilding runtime schemas, code generation. |
| [13-error-handling-and-formatting](./references/13-error-handling-and-formatting.md) | `SchemaError`/`SchemaIssue`, formatters, Standard-Schema-v1 issue output. |
| [14-middlewares](./references/14-middlewares.md) | Decode/encode middlewares and fallbacks. |
| [15-advanced-topics](./references/15-advanced-topics.md) | The internal model, type hierarchy, typed annotations, generics & separate requirement type params. |
| [16-integrations](./references/16-integrations.md) | Framework integrations (TanStack Form, Elysia). |

## Related skills

- **`effect-v4-construct-map`** — the flat v3→v4 rename tables. Reach for it when a
  v3 Schema name doesn't resolve in beta.94.
- **`effect-api-extractor-bases`** — the anonymous-base / `ae-forgotten-export`
  discipline for `Schema.Class` and `Context.Service`.
- **`effect-v4-services-layers`** — the sibling for `Context.Service` and Layers.
- **`effect-v4-planning`** — design a schema/service before writing it.
