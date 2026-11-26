# The pillar rulings in full

The `SKILL.md` names each pillar's decisions in a line or two. This reference
holds the rulings behind them, the reasoning, and the cases that decide the
close calls. Read the pillar you are filling a summary row for.

## Placement: does the target package's tier admit the capability?

Confirm it before designing, not after. IO or a service dropped into a
pure-tier package (semver/jsonc/yaml/glob kind) is a **stop**, not a detail to
sort out later. And check the dependency direction against the peer graph: a
capability that must import a sibling which already peers on the target closes
a cycle.

The worked case: a `compileAndExpand` that walks the filesystem, proposed for
pure-tier `@effected/glob`, is wrong twice. `@effected/walker` peers on
`glob`, so `glob` importing `walker` closes a `glob → walker → glob` cycle, and
the function does filesystem IO in a pure package. It belongs in `walker`. The
tier tags in the `effected-packages` index are the authority on which package
admits what.

## Pillar 0 — Pure core, effectful edge

Every feature that touches IO also contains something that does not: a parse, a
merge, a reconciliation, a decision about what to write. Split them. Put the
algorithm in a **pure surface** — a `Schema.Class` with statics, or a plain
module of functions — and reduce the service to a thin IO shell that reads,
calls the pure thing, and writes.

The cost of skipping the cut: a reconciliation algorithm written *inside* a
`Layer.effect` closure takes a desired state and an observed state and computes
a diff, and needs nothing from the filesystem. Sealed in the layer, the only way
to exercise it is to write real files, provide a platform layer, run the effect,
and read the files back. Every edge case costs a fixture directory, so the edge
cases do not get tested. Lifted out, it is a pure function with a table-driven
unit test and no layer at all, and the service shrinks to read → reconcile →
write.

Consequences the other pillars inherit:

- **Pillar 2:** if the pure part is genuinely pure, the service is small enough
  that "no service at all" is often the honest answer for it.
- **Pillar 4:** a pure core is testable by construction. A test that needs a
  temp directory to check an algorithm is a design smell, not a fixture problem.
- A pure helper left on a service *shape* also breaks `Layer.mock`'s partiality
  (`effect-v4-services-layers`). Pure things belong on pure surfaces for testing
  reasons and for wiring reasons; they are the same reason.

## Pillar 1 — Data types and errors

**Schemas.** Struct-vs-Class (Struct is the default; Class for behavior,
equality, or a nominal domain type); optionality (`optionalKey` vs `optional` vs
`NullOr` — pick deliberately per field); derive-over-rebuild (`Struct.pick/omit`,
spread `.fields`) instead of parallel schemas; brand/`Opaque` at boundaries where
two same-shaped types must not mix (`UserId` vs `AccountId`); transformations as
reusable codecs at the edges (`decodeTo`, with a fallible
`SchemaGetter.transformEffect(...)` where the conversion can fail — there is no
top-level `Schema.transformEffect` in v4), domain model stays clean; validate
late (shape first, business-rule `.check(...)` after).

**Errors — name every fallible operation's error, and pin three attributes:**

| Attribute | The decision |
| ----------- | -------------- |
| **Kind** | One aggregate error vs. several granular tagged errors? Recoverable typed error vs. a genuine defect? (Malformed *input* is always a typed error, never a defect — the `hardening-a-parser-port` invariant.) |
| **Shape** | `Schema.TaggedError` with which structured fields? What does a caller need to *recover* — a `retryAfter`, a source position, a field path? |
| **Audience** | Who consumes it? *End user* (a human-readable `message`), *calling code* (a stable `_tag` + structured fields to branch on), or *operator* (surfaced via a log/span). Most errors serve two of these; state which. |

**Input vs. wiring — the ruling.** Malformed *runtime input* is always a
recoverable typed error. A *developer wiring/config* error — bad options passed
to `static layer(opts)`, an invalid limit, a nonsensical duration — is a
programming mistake: **strongly prefer a defect surfaced at construction**
(`Effect.die` / a thrown validation) so the runtime error channel stays exactly
the domain errors a caller branches on. Override only for a compelling reason —
e.g. the config genuinely arrives from an untrusted or external source at
runtime, or a caller must recover from a bad config — in which case make it
typed and say why in the summary.

Agents produce a good error by instinct but never *decide* its audience, so the
shape drifts. Make it a decision, not an accident.

## Pillar 2 — Services and layers

**Contract inventory — the gate that runs before any service is modeled.**
Before designing any service, seam, or vocabulary, grep core's source
(**including the `@stability unstable` namespace modules**, which import exactly
like any other core module and are not partitioned into a separate directory;
resolve the root via `effect-v4-source-lookup`) for an existing contract. If
core declares it, **require it in `R`** — do not re-declare it, re-implement it,
or wrap it in a parallel vocabulary; the app provides the platform layer at the
edge. A whole package wrapping subprocesses can pass several reviews before a
source check finds `effect/process` already declares its entire surface; it is
then deleted. When a question survives the source read — semantics, not
existence — settle it with a probe per `effect-v4-source-lookup`.

**Inventory core *and* the `@effected` kit, not core alone.** The likelier
duplication is often not a core primitive but a *kit package that already owns
the concept*: a `stopAt` ceiling for an upward root search is already
`Walker.ascend`'s, with correct inclusive semantics. Run both checks, one per
capability the feature needs:

1. Core: the *Routing by task* table and module tables in
   `effect-v4-module-index`, then the signature in `$EFFECT_SRC`.
2. Kit: the construct-index grep, then the package's reference in
   `effected-packages`.

The same grep doubles as a **style consult**: core's source is the paradigm
reference, not just the API authority. Read how core writes the analogous module
— one concept per module, `Context.Service` contracts with a `make` that derives
the surface from one primitive, branded scalars, `dual` combinators, compiling
doc examples — and match those paradigms in the design. Divergence is allowed
but is a recorded decision with a reason, never a habit.

**The service design itself.** What is the dependency closure? Model services
with the v4 `Context.Service<Self, Shape>()("id")` form. **Design the Live/Test
layer split now** — it is pillar 4's raw material, not an afterthought.
Composition posture (`mergeAll` vs `provide` vs `provideMerge`),
provide-once-at-the-boundary, and build-once memoization (a parameterized
`static layer(opts)` mints fresh state per call — bind it to a `const`).
**Pure-tier default: no service at all** — a module of functions is usually
right; do not manufacture a `Context.Service` for stateless pure code.

## Pillar 3 — Observability

- **Pure-tier:** defer to the house rule — named `Effect.fn` spans on public
  fallible boundaries, *uniform* across a service's fallible methods, no metrics,
  telemetry-agnostic. Often the whole answer is one line.
- **Service-tier:** four rulings —
  - **Inject a logger? No.** Do not parameterize a service with a logger.
    Logging flows through the fiber via the `Effect.log*` family; `Logger` is
    configured once at the app edge. A `logger` constructor parameter is the
    anti-pattern.
  - **Log format:** structured values (`Effect.logInfo("msg", { key })`), never
    concatenated strings, and only at boundaries.
  - **OTel:** at the app edge only (core's `Otlp` layers from
    `effect/observability`, or the optional `@effect/opentelemetry` SDK bridge,
    in one top-level layer). The service stays agnostic; libraries never import
    an exporter.
  - **PubSub / events:** only when the feature is genuinely event-driven or
    fan-out. Default is **no**. If yes, it is a `PubSub`/`Queue` design decision:
    choose between them from their rows in `effect-v4-module-index` (a `PubSub`
    delivers every message to every subscriber; a `Queue` gives each value to
    one consumer).

## Pillar 4 — Testability

- Dependencies are **injectable layers** (pillar 2's Test split) so collaborators
  are mockable at the suite boundary via `layer(...)`.
- Functions **return Effects** — never pre-run them; an `Effect.runSync`/
  `runPromise` in the API surface or a fixture is unmockable and untestable.
- `it.effect` is the default runner; property-test over the pillar-1 schemas.
- **Time / schedules / retries → `TestClock`.** If the feature reads the clock,
  it must read it via `Clock`, and the test drives `TestClock.adjust`. A feature
  that can only be tested against the wall clock is a design bug.
