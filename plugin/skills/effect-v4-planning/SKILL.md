---
name: effect-v4-planning
description: Use when about to design, build, add, extend, or modify a feature, module, service, or schema in Effect v4 — before writing implementation code. Triggers on "design/add/build a feature", "new service/schema/module", "change/refactor existing Effect code", and any moment you are reaching for Effect code without an explicit design first.
---

# Effect v4 feature planning

The orchestration skill. Every other `effect-v4-*` skill teaches *how to write*
one thing well; this one runs *before* them and decides *what to write*. It walks
four design pillars, then makes you emit a compact **design summary** and get
buy-in **before** any implementation code exists.

Why this skill exists: strong, skill-equipped agents still dive straight to code,
rationalize the decisions afterward, and **silently drop whole pillars**
(observability is the usual casualty). The mechanism that stops that is not
willpower; it is the required-slot summary below. You cannot leave the
Observability row blank.

## The recipe (do these in order — do not skip to code)

1. **Locate the work on two axes, then check it can live where you're putting it.**
   Answer all three before anything else:
   - **Mode** — *greenfield* (new code) or *brownfield* (modifying existing code)?
   - **Altitude** — *pure-tier* (parser / engine / schema library, no runtime
     dependencies — semver/jsonc/yaml kind) or *service-tier* (real services,
     layers, I/O, lifecycle)?
   - **Placement — does the target package's tier *admit* this capability?**
     IO or a service in a pure-tier package is a **stop**, and so is an import
     of a sibling that already peers on the target, which closes a cycle. The
     tier tags in the [effected-packages](../effected-packages/SKILL.md) index
     decide what a package admits.
2. **Walk the four pillars** (below), routing into the detailed skill each owns.
   Brownfield: read the existing code through each pillar as an *audit lens*.
3. **Emit the design summary** — the required-slot block. Greenfield fills the
   design template; brownfield fills the gap table.
4. **Get buy-in, then build.** Present the summary and wait for the user before
   writing implementation code. The summary is cheap to correct; code is not.
   Two carve-outs, below: a **delegated subagent** has no user to wait on, and a
   **small pure-tier bugfix** collapses the summary to one line. Neither waives step 3.

> Step 3 is not optional and not a formality. If you find yourself writing
> `Schema.Struct`, `Context.Service`, or a `Layer` and no summary has been
> emitted this turn, you skipped the recipe — stop and emit it.

When placement is not obvious (a capability that does IO near a pure package, or
one that would import a sibling), load
[pillar-rulings.md](references/pillar-rulings.md) before you choose the package:
its worked case shows a misplaced function closing a peer cycle, which no
type-check reports until the install.

## The four pillars

Each pillar: the decisions to make and the skill that owns the mechanics.
Consult the linked skill; do not re-derive it here. **Before you fill a pillar's
summary row and are unsure of its ruling, load
[pillar-rulings.md](references/pillar-rulings.md)**: it holds the schema
decisions, the error-attribute table, the input-vs-wiring ruling, the inventory
gate's full procedure and the service-tier observability rulings. A row filled
from instinct is the drift this skill exists to stop.

### Pillar 0 — Pure core, effectful edge (runs before all four)

Not a fifth pillar — a cut you make **first**. Every feature that touches IO also
contains something that does not: a parse, a merge, a reconciliation, a decision
about what to write. Put the algorithm in a **pure surface** (a `Schema.Class`
with statics, or a module of functions) and reduce the service to a thin IO shell
that reads, calls the pure thing, and writes.

> Ask literally, before designing any service: **"is any of this pure, and can it
> be tested without a layer?"** Whatever answers yes does not belong inside the
> service.

An algorithm sealed in a `Layer.effect` closure can only be tested through real
files, so its edge cases go untested. State the cut in the summary's
Services/Layers row: "pure `X` + `Y` service as IO shell", or "no pure core —
all of this is IO" if you genuinely looked and found none.

### Pillar 1 — Data types & errors → `effect-v4-schema`, `effect-v4-idioms`, `hardening-a-parser-port`

- **Schemas:** Struct by default, Class for behaviour, equality or a nominal type;
  optionality chosen per field; derive (`pick`/`omit`, `.fields`) rather than
  rebuild; brand where two same-shaped types must not mix; codecs at the edges.
- **Errors:** name every fallible operation's error and pin its **kind**
  (typed or defect; one aggregate or several), **shape** (what a caller needs to
  recover) and **audience** (end user, calling code, operator).
- **Input vs. wiring:** malformed runtime input is always a typed error; a bad
  option passed to `static layer(opts)` is a programming mistake, so prefer a
  defect at construction.

### Pillar 2 — Services & Layers → `effect-v4-services-layers`

**Contract inventory — the gate that runs before any service is modeled.** For
every capability the feature needs, check core *and* the kit before you design a
service, seam or vocabulary:

1. Core: the *Routing by task* table and module tables in
   [effect-v4-module-index](../effect-v4-module-index/SKILL.md), then the
   signature in `$EFFECT_SRC` (the `@stability unstable` namespaces included).
2. Kit: `grep -ri "<intent words>" "{{skill_dir effected-packages}}/references/constructs/"`,
   then the package's reference in
   [effected-packages](../effected-packages/SKILL.md).

If core declares the contract, **require it in `R`**; never re-declare it or wrap
it in a parallel vocabulary. Write the result in the summary's **Inventory** row:
what each check found, or the query that found nothing.

Then: the dependency closure, the v4 `Context.Service<Self, Shape>()("id")` form,
the **Live/Test layer split designed now**, the composition posture, and
build-once memoization (bind a parameterized `static layer(opts)` to a `const`).
**Pure-tier default: no service at all.**

### Pillar 3 — Observability → `effect-v4-observability`

**This is the pillar agents silently drop. It is a required row in the summary —
fill it even if the answer is "none."**

- **Pure-tier:** named `Effect.fn` spans on public fallible boundaries, uniform
  across a service's fallible methods, no metrics. Often one line.
- **Service-tier:** never inject a logger; structured `Effect.log*` values at
  boundaries only; OTel at the app edge only; PubSub only when the feature is
  genuinely event-driven (default **no**).

### Pillar 4 — Testability → `effect-v4-testing`

Design *for* the test now: dependencies are injectable layers, functions return
Effects (never pre-run), `it.effect` is the runner with property tests over the
pillar-1 schemas, and anything that reads time reads `Clock` so the test drives
`TestClock`.

## The design summary (REQUIRED — emit before coding)

### Greenfield

```text
## Design: <feature>
- Altitude: pure-tier | service-tier
- Inventory: <capability → core module / kit construct reused, or "none: <query run>">
- Data types: <schemas + Struct/Class/brand/codec choices>
- Errors: <ErrorName → kind / shape / audience>   (one row per error)
- Services/Layers: <service(s) + Live/Test split, OR "none — plain module">
- Observability: <spans / logging / OTel / PubSub posture — never blank>
- Testing: <runner, mock layers, property targets, TestClock?>
- Open risks: <anything unresolved, or "none">
```

**A pure, total module may answer "none" on every service row — and that is a
COMPLETE design, not an evaded one.** For a module that is pure and total (no IO,
no fallible operations, no services), "no error channel, no services, no
observability" is a legitimate complete answer. The gate exists to force the
QUESTION, not to force machinery — manufacturing an error type or a decorative
span to avoid writing "none" is the same failure as leaving the row blank.

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

- The Inventory row names a core or kit check for every capability, and nothing
  the design builds is already in either.
- Every fallible operation has a named typed error with a stated audience.
- Pillar 0 was run: the pure part is named and lives outside the service, or you
  can say why there isn't one. No algorithm is sealed in a `Layer.effect` closure.
- No service takes a `logger` parameter.
- Observability row matches altitude and is not blank.
- Every service dependency has a Test layer, and time is read via `Clock`.
- No `Effect.runSync`/`runPromise` in the API surface or in a fixture.
- Brownfield: every gap has a recommended disposition.

## Two carve-outs from step 4 (buy-in)

The summary in step 3 is **never** waived. What bends is *who* you wait for, and
how heavy the summary has to be.

- **You are a delegated subagent:** emit the summary, treat the parent's
  instructions as the buy-in, and proceed. A decision that **contradicts** the
  instructions is a stop; one that **exceeds** them without contradicting them is
  proceed-and-flag; evidence of a **concurrent writer** in your files is a stop.
- **A small pure-tier bugfix** collapses the summary to one line, naming the test
  that now fails, when all four hold: pure-tier, behaviour-preserving apart from
  the bug, no public API change, no new error case.

Before you proceed as a subagent, or take the one-line fix path, load
[carve-outs.md](references/carve-outs.md): it says how to tell a contradiction
from a consequence you must flag, the three signatures of another writer in your
files (one of them looks like a harness quirk), and the one-line template.
Proceeding past a collision multiplies the reconcile cost with every edit.

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

## Additional resources

- [references/pillar-rulings.md](references/pillar-rulings.md) — the placement check with its peer-cycle case, pillar 0's cost of a sealed algorithm, the schema decisions, the error-attribute table and input-vs-wiring ruling, the contract-inventory gate and style consult, the service-tier observability rulings and the testability rules. Load when: choosing which package a capability goes in, filling a summary row you are unsure of, deciding whether a bad option is a typed error or a defect, or running the inventory for a new service.
- [references/carve-outs.md](references/carve-outs.md) — the subagent carve-out with its stop, proceed-and-flag and concurrent-writer cases, and the small-bugfix fast path with its four conditions and template. Load when: you are running as a delegated subagent, an edit you did not make appears in your files, or you are fixing a bug in a pure-tier engine.
