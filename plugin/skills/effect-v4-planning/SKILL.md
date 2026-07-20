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
api-extractor-bases idiom, the layer-memoization discipline, `Clock` for testability — still
dive straight to code, rationalize the decisions afterward, and **silently drop
whole pillars** (observability is the usual casualty). The mechanism that stops
that is not willpower; it is the required-slot summary below. You cannot leave the
Observability row blank.

## The recipe (do these in order — do not skip to code)

1. **Locate the work on two axes, then check it can live where you're putting it.**
   Answer all three before anything else:
   - **Mode** — *greenfield* (new code) or *brownfield* (modifying existing code)?
   - **Altitude** — *pure-tier* (parser / engine / schema library, no runtime
     dependencies — semver/jsonc/yaml kind) or *service-tier* (real services,
     layers, I/O, lifecycle)?
   - **Placement — does the target package's tier *admit* this capability?**
     Confirm it before designing, not after. IO or a service dropped into a
     pure-tier package (semver/jsonc/yaml/glob kind) is a **stop**, not a detail
     to sort out later. And check the dependency direction against the peer
     graph: a capability that must import a sibling which already peers on the
     target closes a cycle. Adding `compileAndExpand` to pure-tier `glob` was
     both — `walker` peers on `glob`, so it would have closed a `glob → walker →
     glob` cycle, *and* it does filesystem IO in a pure package; it belonged in
     `walker`. The repo's `CLAUDE.md` tier tags and the `effected-packages`
     index are the authority on which package admits what — this was caught by
     the tier tags, not by any skill, which is the gap this line closes.
2. **Walk the four pillars** (below), routing into the detailed skill each owns.
   Brownfield: read the existing code through each pillar as an *audit lens*.
3. **Emit the design summary** — the required-slot block. Greenfield fills the
   design template; brownfield fills the gap table.
4. **Get buy-in, then build.** Present the summary and wait for the user before
   writing implementation code. The summary is cheap to correct; code is not.
   Two carve-outs, both below: a **delegated subagent** has no user to wait on, and a
   **small pure-tier bugfix** collapses the summary to one line. Neither waives step 3.

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

**Contract inventory — the gate that runs before any service is modeled.**
Before designing any service, seam, or vocabulary, grep the vendored core
(`.repos/effect-smol/packages/effect/src`, **including `effect/unstable/*`**)
for an existing contract. If core declares it, **require it in `R`** — do not
re-declare it, re-implement it, or wrap it in a parallel vocabulary; the app
provides the platform layer at the edge. Evidence for why this is a hard gate:
the `@effected/commands` package survived four review gates before a source
check found `effect/unstable/process` already declared its entire surface —
it was deleted the same day it was built. State the inventory result in the
design summary ("core declares X → required in R" or "no core contract found
for X").

**Inventory core *and* the sibling `@effected` packages, not core alone.** In
this monorepo the likelier duplication is not a core primitive but a *sibling
kit package that already owns the concept*. Before designing a local primitive,
consult the `effected-packages` index and grep the relevant sibling's `src`:
`WorkspaceRoot.find`'s `stopAt` ceiling was about to be re-invented locally
until a read of `Walker.ascend` found the concept already there with correct
inclusive semantics. The core grep catches "Effect already provides this"; the
sibling-package check catches "another kit package already provides this" — run
both, and state which authority you inventoried against.

The same grep doubles as a **style consult**: the vendored source is the
paradigm reference, not just the API authority. Read how core writes the
analogous module — one concept per module, `Context.Service` contracts with a
`make` that derives the surface from one primitive, branded scalars, `dual`
combinators, compiling doc examples — and match those paradigms in the design.
Divergence is allowed but is a recorded decision with a reason, never a habit.

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

## Two carve-outs from step 4 (buy-in)

The summary in step 3 is **never** waived. What bends is step 4 — *who* you wait for,
and how heavy the summary has to be.

### You are a delegated subagent — emit the summary, then proceed

If you are running as a headless subagent, **you have no user to wait on.** A
delegating parent dispatched you with instructions and is not watching the channel;
"present the summary and wait for buy-in" would deadlock, and the usual failure is an
agent that resolves the deadlock by quietly skipping step 3 altogether — losing the
audit *and* the buy-in.

So: **emit the design summary, treat the parent's instructions as the buy-in, and
proceed.** The summary is not wasted — it goes in your report, where it is exactly
what lets the parent (and the reviewer on the PR) check the pillars were walked. What
you still owe splits by the *kind* of surprise the summary turns up:

- A decision that **contradicts** the instructions — a scope change, a design you were
  steered away from, a risk you cannot resolve — is a **stop**: do not proceed on your
  own authority; report back and ask.
- A decision that **exceeds** the instructions **without contradicting** them — the
  instructed thing, done correctly, carries a consequence nobody named — is **proceed
  AND flag**, not stop. Making an instructed `workspaceRoot` field *required* is the
  correct design and *also* breaks decode for previously serialized values: you were
  told to add the field, not to avoid the break, so proceeding is right — but the break
  MUST land prominently in your report, never silently. Do the correct thing and surface
  what it cost.

Put any genuinely unresolved item in the Open risks row rather than deciding it silently.

An interactive session has a real user: wait for them, as step 4 says.

### Small pure-tier bugfix — a one-line summary is the whole recipe

A bounded fix to an **existing pure-tier engine** (a perf fix, an off-by-one, a bad
span offset) does not need the brownfield gap table. It has no service, no layer, no
observability posture, and its testability is already settled by the existing suite;
the table's rows would all read "n/a — unchanged".

Qualifying is narrow. **All four** must hold: pure-tier; the fix is behaviour-
preserving except for the bug itself; **no public API change**; and no new error case.
Miss any one and you run the full brownfield audit — a bugfix that changes a signature
or adds an error *is* a design change wearing a bugfix's clothes.

When it qualifies, the summary collapses to one line, and you still emit it:

```text
## Fix: <bug> — pure-tier, no API change, no new error. Test: <the test that now fails>.
```

That last clause is the load-bearing one. The test that reproduces the bug *is* the
design review for a fix this size: if you cannot name it, you do not understand the
bug yet, and the fast path is not available to you.

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
