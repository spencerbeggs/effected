---
name: effect-v4-planning
description: Use when about to design, build, add, extend, or modify a feature, module, service, or schema in Effect v4 — before writing implementation code. Triggers on "design/add/build a feature", "new service/schema/module", "change/refactor existing Effect code", and any moment you are reaching for Effect code without an explicit design first.
---

# Effect v4 feature planning

The orchestration skill. Every other `effect-v4-*` skill teaches *how to write*
one thing well; this one runs *before* them and decides *what to write*. It walks
four design pillars, then makes you emit a compact **design summary** and get
buy-in **before** any implementation code exists.

Why this skill exists: strong, skill-equipped agents — ones that already know the
`X_base` idiom, the layer-memoization discipline, `Clock` for testability — still
dive straight to code, rationalize the decisions afterward, and **silently drop
whole pillars** (observability is the usual casualty). The mechanism that stops
that is not willpower; it is the required-slot summary below. You cannot leave the
Observability row blank.

## The recipe (do these in order — do not skip to code)

1. **Locate the work on two axes.** Answer both before anything else:
   - **Mode** — *greenfield* (new code) or *brownfield* (modifying existing code)?
   - **Altitude** — *pure-tier* (parser / engine / schema library, no runtime
     dependencies — semver/jsonc/yaml kind) or *service-tier* (real services,
     layers, I/O, lifecycle)?
2. **Walk the four pillars** (below), routing into the detailed skill each owns.
   Brownfield: read the existing code through each pillar as an *audit lens*.
3. **Emit the design summary** — the required-slot block. Greenfield fills the
   design template; brownfield fills the gap table.
4. **Get buy-in, then build.** Present the summary and wait for the user before
   writing implementation code. The summary is cheap to correct; code is not.

> Step 3 is not optional and not a formality. If you find yourself writing
> `Schema.Struct`, `Context.Service`, or a `Layer` and no summary has been
> emitted this turn, you skipped the recipe — stop and emit it.

## The four pillars

Each pillar: the decisions to make, the idiomatic ruling, and the skill that owns
the mechanics. Consult the linked skill; do not re-derive it here.

### Pillar 1 — Data types & errors → `effect-v4-schema`, `effect-v4-idioms`, `hardening-a-parser-port`

**Schemas.** Struct-vs-Class (Struct is the default; Class for behavior,
equality, or a nominal domain type); optionality (`optionalKey` vs `optional` vs
`NullOr` — pick deliberately per field); derive-over-rebuild (`Struct.pick/omit`,
spread `.fields`) instead of parallel schemas; brand/`Opaque` at boundaries where
two same-shaped types must not mix (`UserId` vs `AccountId`); transformations as
reusable codecs at the edges (`decodeTo`, `transformOrFail`), domain model stays
clean; validate late (shape first, business-rule `.check(...)` after).

**Errors — name every fallible operation's error, and pin three attributes:**

| Attribute | The decision |
| ----------- | -------------- |
| **Kind** | One aggregate error vs. several granular tagged errors? Recoverable typed error vs. a genuine defect? (Malformed *input* is always a typed error, never a defect — the `hardening-a-parser-port` invariant.) |
| **Shape** | `Schema.TaggedErrorClass` with which structured fields? What does a caller need to *recover* — a `retryAfter`, a source position, a field path? |
| **Audience** | Who consumes it? *End user* (a human-readable `message`), *calling code* (a stable `_tag` + structured fields to branch on), or *operator* (surfaced via a log/span). Most errors serve two of these; state which. |

**Input vs. wiring — the ruling.** Malformed *runtime input* is always a
recoverable typed error (the hardening invariant). A *developer wiring/config*
error — bad options passed to `static layer(opts)`, an invalid limit, a
nonsensical duration — is a programming mistake: **strongly prefer a defect
surfaced at construction** (`Effect.die` / a thrown validation) so the runtime
error channel stays exactly the domain errors a caller branches on. Override only
for a compelling reason — e.g. the config genuinely arrives from an untrusted or
external source at runtime, or a caller must recover from a bad config — in which
case make it typed and say why in the summary.

The baseline failure this fixes: agents produce a good error by instinct but never
*decide* its audience, so the shape drifts. Make it a decision, not an accident.

### Pillar 2 — Services & Layers → `effect-v4-services-layers`

What is the dependency closure? Model services with the v4 `Context.Service<Self,
Shape>()("id")` form. **Design the Live/Test layer split now** — it is pillar 4's
raw material, not an afterthought. Composition posture (`mergeAll` vs `provide` vs
`provideMerge`), provide-once-at-the-boundary, and build-once memoization (a
parameterized `static layer(opts)` mints fresh state per call — bind it to a
`const`). **Pure-tier default: no service at all** — a module of functions is
usually right; do not manufacture a `Context.Service` for stateless pure code.

### Pillar 3 — Observability → `effect-v4-observability` (and `effect-resource` for PubSub)

**This is the pillar agents silently drop. It is a required row in the summary —
fill it even if the answer is "none."**

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
  - **OTel:** at the app edge only (`@effect/opentelemetry` in one top-level
    layer). The service stays agnostic; libraries never import it.
  - **PubSub / events:** only when the feature is genuinely event-driven or
    fan-out. Default is **no**. If yes, it is a `PubSub`/`Queue` design decision —
    see `effect-resource`.

### Pillar 4 — Testability → `effect-v4-testing`

Design *for* the test now, so it is not retrofitted:

- Dependencies are **injectable layers** (pillar 2's Test split) so collaborators
  are mockable at the suite boundary via `layer(...)`.
- Functions **return Effects** — never pre-run them; an `Effect.runSync`/
  `runPromise` in the API surface or a fixture is unmockable and untestable.
- `it.effect` is the default runner; property-test over the pillar-1 schemas.
- **Time / schedules / retries → `TestClock`.** If the feature reads the clock,
  it must read it via `Clock`, and the test drives `TestClock.adjust`. A feature
  that can only be tested against the wall clock is a design bug.

## The design summary (REQUIRED — emit before coding)

### Greenfield

```text
## Design: <feature>
- Altitude: pure-tier | service-tier
- Data types: <schemas + Struct/Class/brand/codec choices>
- Errors: <ErrorName → kind / shape / audience>   (one row per error)
- Services/Layers: <service(s) + Live/Test split, OR "none — plain module">
- Observability: <spans / logging / OTel / PubSub posture — never blank>
- Testing: <runner, mock layers, property targets, TestClock?>
- Open risks: <anything unresolved, or "none">
```

### Brownfield

Read the existing code through each pillar, then emit a gap table. For each gap,
pre-fill a **recommended disposition** with a one-line reason so the user confirms
or overrides in a single pass — do not silently refactor, and do not ask
gap-by-gap:

```text
## Audit: <what you're changing>
- Altitude: pure-tier | service-tier   Mode: brownfield

| Pillar | Current | Best-practice target | Recommended disposition |
|--------|---------|----------------------|-------------------------|
| ...    | ...     | ...                  | refactor now / incremental / defer — <why> |
```

Dispositions: **refactor now** (bring fully in line as part of this change),
**improve incrementally** (fix only the surface you are already touching),
**defer** (working code, out of scope — note it, move on). Options 2 and 3 keep
the change focused; do not scope-creep a refactor the user did not ask for.

## Self-check before you present

- Every fallible operation has a named typed error with a stated audience.
- No service takes a `logger` parameter.
- Observability row matches altitude and is not blank.
- Every service dependency has a Test layer, and time is read via `Clock`.
- No `Effect.runSync`/`runPromise` in the API surface or in a fixture.
- Brownfield: every gap has a recommended disposition.

## Migration / port context

When porting a v3 `*-effect` package to `@effected/*`, this skill **defers to the
migration playbook and `effect-v4-construct-map`** for the port-specific
concerns — migration order, the compliance gate, and v3→v4 name lookups. It
contributes only the forward-design lenses the playbook does not walk
pillar-by-pillar: the error-audience decision, the observability posture, and the
testability design. Run the pillars over the *target* v4 shape, not the v3 source.

## Red flags — you skipped the recipe

- You wrote `Schema.Struct` / `Context.Service` / `Layer.*` and no summary exists
  this turn.
- The Observability row is blank, or you never considered spans/logging.
- You added a `logger` constructor parameter "so it's testable."
- You "explained the design decisions" *after* showing the code instead of
  *before*.
- Brownfield: you started editing existing code before auditing it against the
  pillars.

**Any of these: stop, run the recipe, emit the summary, get buy-in.**
