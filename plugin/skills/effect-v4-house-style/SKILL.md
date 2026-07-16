---
name: effect-v4-house-style
description: The house style for Effect v4 library code — module layout, naming, typed-error taxonomy, API-surface and TSDoc habits, layer conventions, test organization, and observability posture. Use when writing or reviewing any Effect v4 module and deciding how to lay out files, name things, shape errors, document exports, wire layers, or organize tests — or when asked why this codebase "looks the way it does". Distilled from the @effected kit with the DX-north-star package (semver), a parser engine (toml), a boundary package (config-file) and the app plane (app) as the evidence base. Cross-cutting rules only; Schema depth lives in effect-v4-schema, hardening in hardening-a-parser-port.
---

# Effect v4 house style

The rules that make the code read as one hand's work. Each rule is stated
once here (or linked to the skill that owns it); when writing new code, match
these before inventing a local convention.

## Module layout

- **One PascalCase file per public concept; the file name IS the API name.**
  `SemVer.ts` exports `SemVer`. No generic suffixes (`SemVerParserLive.ts`),
  no one-class error files — an error class rides in the file of the concept
  that raises it.
- **`src/index.ts` is the ONLY re-exporting module.** Flat named re-exports,
  types marked explicitly (per-line `export type { X }` or inline
  `export { type X, Y }` — both occur in the kit), no `export *`. Every other module
  imports explicitly from the defining module. A barrel anywhere else — or a
  namespace object collecting cross-module implementations — is forbidden:
  a namespace object that gathers implementations pulling different engines
  kills tree-shaking silently (measured in this kit: 506 bytes vs 129.4 kB).
- **Grouped statics are the sanctioned exception**: same-module variants of
  one concept may ship as `export const X = { a, b } as const` (e.g.
  `MergeStrategy = { firstMatch, layeredMerge }`). The line is *same module,
  one concept* — never cross-module, never one-per-engine.
- **`src/internal/` holds the engine; `index.ts` never exports from it.**
  Composition-only packages own no `internal/` at all — "no engine, only
  composition" is a legitimate shape.
- **The cycle firewall**: the internal engine throws/returns raw untyped
  carriers (`{ code, message, offset, length }` records, plain `Error`
  subclasses); the facade catches, triages with ordered `isX` guards, and
  materializes the public Schema classes. The dependency edge runs facade →
  engine only. Sanctioned exception: the engine may import leaf value
  classes with no outward edges (a `TomlNode` that imports only `effect`).
- **File splits can be load-bearing for bundles, not just readability**: two
  sibling modules that must not drag each other's dependencies (config vs
  SQLite) simply never import each other — document that the split is
  deliberate.

## Naming

- **No floating functions.** Instance methods are canonical; cross-cutting
  operations are `Function.dual` statics on the owning class that mirror the
  instance method's exact name (`SemVer.gt` wraps `self.gt(that)`).
- **Service shape interfaces are `<Concept>Shape`** (`VersionCacheShape`,
  `ConfigFileShape<A>`). **Options records are `<Concept>Options`**, all
  fields `readonly`, non-obvious defaults documented per field.
- **Errors are `<Concept><FailureNoun>Error`** — never `Exception`, never
  `Failure`. Structured code fields get a parallel `<Concept><Stage>ErrorCode`
  literal-union schema.
- **Per-operation failure unions are type-only aliases named
  `<Operation>Error`** (`ConfigLoadError = A | B | C`), each with TSDoc
  stating exactly what is excluded and why. A type-only union costs nothing
  and is not a namespace object.
- **String codecs are class statics named `FromString`**, explicitly typed
  `Schema.Codec<Self, string>` (the annotation breaks circular inference).
- Static-namespace facades: a `class X { private constructor() {} }` for
  schema/parse facades, a plain `{ ... } as const` object for layer-factory
  facades. Either is acceptable; do not invent a third shape.

## Typed error taxonomy

- **Never a free-form `reason: string` field.** The token appears in TSDoc
  `@remarks` only as the v3 anti-pattern being fixed. A `reason` field typed
  as a `Schema.Literals` union (glob, lockfiles, tsconfig-json do this) is
  fine — the rule bans free-form strings, not the field name; new code should
  still prefer the `<Concept><Stage>ErrorCode` naming below. Structured
  diagnostics carry a positional core:
  `code` (literal union), `message`, `offset`/`length`, `line`/`character` —
  the same shape across every format package, deliberately.
- **Foreign failures ride in `cause: Schema.Defect()`**, never stringified —
  the original `Error` instance survives to the consumer. Schema issues ride
  in `issue: Schema.Defect()` (v4 exposes no `Schema` for `Issue`; say so in
  the remarks). Normalize `SchemaError` to a domain error at the boundary
  with `Effect.catchTag("SchemaError", ...)`.
- **`message` is always a getter derived from structured fields at read
  time** — never a stored, preformatted string.
- **Failure vs defect, the house line**: malformed *input* fails through the
  typed error channel, always (see `hardening-a-parser-port`); bad *wiring*
  (an invalid namespace at layer construction, a NaN depth cap) dies as a
  defect, deliberately, and gets a regression test asserting it dies. A
  recoverable environmental failure (missing directory) must surface typed
  even when the underlying platform API would defect — never `orDie` it away.
- **Caller-supplied callbacks**: decide absorb-vs-defect by one rule — does
  the callback's RESULT participate in the operation's outcome? A migration
  `up` or a `validate` (yes) stays a defect on throw — a contract violation;
  a fire-and-forget event hook (no — `Effect<void>`, discarded) is absorbed
  and `logDebug`'d. Wrap callback invocation in `Effect.suspend` so a throw
  during construction dies the same way as one during execution.
- **Decorators widen, never flatten**: a wrapper over a codec/service is
  generic in the inner error and returns `Inner<E | NewError>` — the inner
  error type survives in the union.
- **A parse failure carries an ARRAY of diagnostics** even when only one is
  populated today — the array is the cross-package contract.

## API surface and TSDoc

- **Every exported symbol carries `@public`; everything in `internal/`
  carries `@internal`.** The inline class-factory + scoped `_base`
  suppression idiom that keeps API Extractor at zero warnings is owned by
  `effect-api-extractor-bases` — a package with no class factories carries
  no suppression at all.
- **`@remarks` record WHY, not what** — including naming the v3 anti-pattern
  the shape replaces ("v3 flattened it to `reason: String(e)`") and the
  looks-right-but-isn't traps. Signature restatement is noise.
- **`@example` blocks are runnable and minimal**: pure APIs end with
  `console.log` and a `// =>` comment showing the literal output; boundary
  APIs show the layer-composition shape instead.
- **The bind-to-a-const warning is boilerplate, verbatim, on every
  factory**: any schema-producing or layer-returning function's TSDoc repeats
  the house phrase — each call mints fresh derivation/memoization identity;
  bind the result to a `const` or the resource builds twice. Consistent
  wording beats novel prose.

## Services and layers

The mechanics live in `effect-v4-services-layers`; the house habits:

- **A service's layer(s) live in the same file as the service** (`static
  readonly layer` on the class). Naming: `layer`, `layerTest`, `layerConfig`,
  `layerSqlite` — never `Default`/`Live`.
- **`Layer.unwrap(Effect.gen(...))` is the idiom** for a layer that must read
  an ambient service before constructing its own value.
- **Composition vocabulary**: `Layer.mergeAll` for independent siblings,
  `Layer.provideMerge` to satisfy AND expose, `Layer.provide` to satisfy
  without exposing.
- **Require core contracts in `R`; never own a platform backend.** No
  `node:` imports in production `src/` — platform packages appear only as
  devDependencies for integration tests, and the consumer provides one
  platform layer at the edge.
- **Test layers provide their platform internally** (`Layer.provide`, not
  merge) so `R = never` by construction, not by cast — pin it with a test
  comment: "if this fixture ever needs a platform import, the layer stopped
  doing its job."
- **Ambient identity over parameters**: when two sibling layers must agree
  on an identity string (a namespace), the second reads it from the ambient
  service the first established — never a second string parameter that can
  drift. Pin the absence of the parameter with a regression test.

## Test organization

The false-green catalogue and `@effect/vitest` mechanics live in
`effect-v4-testing`; the house habits:

- Tests in `__test__/`, never co-located: `*.test.ts` units at the top,
  `integration/*.int.test.ts`, `e2e/*.e2e.test.ts`. `assert.*` exclusively —
  `expect` does not appear. `it.effect` is the default mode.
- **Shared setup is one top-level `layer(...)((it) => {...})` per group** —
  not `Effect.provide` repeated per test body. Sanctioned deviation: when
  fixtures genuinely differ per test (different files on disk per case), a
  `layerFor(...)` helper per test is correct — but say so.
- **Fakes, not mocks — and fakes deliberately missing methods.** A read-only
  fake filesystem implements exactly the operations the read path uses, so a
  test that unexpectedly writes fails loudly. Document each fake's
  restriction where it is defined.
- **Shared guard-case fixtures**: one exported case-matrix function
  (`filenameGuardCases`) consumed by every module with the same option, so a
  new rejected shape is added once and pins every guard.
- **Property tests state the invariant as a sentence** ("round-trips
  decode(encode(v))") over the class schema as the arbitrary; comments cite
  the review/bug that motivated an exact bound.
- **Corpus/compliance suites are loop-generated** (one `it.effect` per corpus
  file, name = relative path) and FIRST assert the corpus walk found the
  expected counts — a silently-empty walk is a false green.
- **A differential oracle is one pinned devDependency imported by exactly
  one test file**, with the tiebreak written down: the spec corpus wins on
  disagreement.
- Integration tests assert on real side effects at the joined path, never an
  echoed option value — and include the "naive composition" control proving
  the defect the package exists to prevent.

## Observability posture

Details in `effect-v4-observability`; the house numbers:

- **`Effect.fn("Concept.op")` on every fallible public boundary; nothing
  else.** Pure/total helpers are plain functions; never-failing service
  methods are plain arrows; internal helpers shared by public spans are NOT
  wrapped, with a comment stating the caller already opened the span.
- **Log density is near zero.** The one sanctioned `Effect.log*` shape in a
  library is `logDebug` recording a deliberately absorbed defect. No
  metrics in libraries — those belong to boundaries apps own. Libraries stay
  telemetry-agnostic; apps compose OTel at the edge.
- A consumer-facing event stream (a domain `PubSub`) is a FEATURE, not the
  observability channel — keep it separate from spans and say so in TSDoc.

## Related skills

`effect-v4-schema` (Schema depth: Class-vs-Struct, optionality, make-vs-new,
brands — plus its `references/house-style.md` for Schema-specific house
patterns), `effect-v4-services-layers` (memoization discipline),
`effect-v4-testing` (false greens), `effect-api-extractor-bases` (the `_base`
idiom), `hardening-a-parser-port` (input hardening), `effected-packages`
(what the kit ships).
