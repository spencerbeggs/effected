# The contracts-first walking skeleton

Seven pieces, built in this order, every one of them an inert stub that **succeeds**. The skeleton runs end-to-end green from the day it exists — staying green while it is still all stubs is what proves the wiring is sound before any business logic makes staying green ambiguous. This list owns the *order* the seven pieces are built in; `structuring-an-action` owns the *shape* each one takes once it exists — load it for the canonical file layout and the standards each piece follows. The `github-action-template` repository is a concrete, buildable instance of both; read it alongside this list rather than inferring the shape from prose alone.

## 1. Domain schema

The config vocabulary the rest of the skeleton is built from: branded and refined value types, literal unions. Delegate validation to a suite package wherever one already owns the domain — an exact semver parse, for instance — rather than hand-rolling a regex that quietly diverges from the real grammar.

## 2. Inputs module

Every action input modeled as a typed config read, with defaults matching the action's own metadata file exactly, secrets held as a redacted type from the moment they're read, and normalization collected into one pass rather than scattered across call sites.

## 3. Outputs module

The output names as a single source-of-truth list, a typed result model, defaults, and exactly one emitter. Prove the emitter writes every name exactly once with a test that records each write and counts occurrences per name, then compares the recorded names against the frozen inventory — a test that only checks the final map of written values collapses a duplicate write into a single entry and proves presence, not correctness.

## 4. Cross-phase state

`Schema`-typed state records keyed by a single source-of-truth list of keys, with any process-id field using a validating branded type so a truncated or corrupted state value fails typed rather than silently becoming zero. See [design-checkpoints.md](design-checkpoints.md) for the JSON-round-trip rule every optional field in a state bundle must follow.

## 5. Step contracts

One module per pipeline step, each exporting: a result type, a tagged error with a closed reason union (plus a stored message and an optional cause), a declared requirement channel, and a stub that always succeeds with a documented placeholder value. Stubs never fail — a failing stub at this stage is a sign the skeleton discipline is being skipped, not a sign of a real bug being found early.

Derive each step's requirement channel from what a reference implementation's code path actually touches, never from a guess at what "should" be needed — see [porting.md](porting.md) for the full reasoning when a legacy implementation exists as an oracle. Declaring a channel too narrow becomes a breaking change to every caller the moment real work needs the missing service; declaring it too wide only costs what it honestly costs. Widen deliberately at contract time rather than narrowly and by accident.

## 6. Program, entries, layers

The real entry point wiring, the real layer composition, steps composed under whatever grouping mechanism the runtime's logging surface provides, and outputs emitted from folding over the (still-stub) step results. Build through the project's own sanctioned build command rather than a lower-level one that skips steps of the real pipeline, and smoke-run the result. See [design-checkpoints.md](design-checkpoints.md) for the logging contract, the layer-minimalism proof, the bundle-truth verification, and the dependency-honesty check this step is responsible for satisfying — all four are checked here, not discovered later.

## 7. Only then, fill

With all six pieces green and stubbed, fill each step's real logic in behavior-driven red/green/refactor cycles against the now-frozen contract, one step at a time. See [porting.md](porting.md) for treating a legacy implementation as the oracle this phase tests against, and for the doubles-before-runner-conversion ordering when this phase also migrates test infrastructure.

## Porting an existing action: stub the imports, not the action

The seven pieces above describe a **greenfield** build, where "all stubs, all green" is free because there is nothing yet to break. Applied literally to an action that already works, it says to stub out working code and live with a red suite for the length of the port — which is both demoralizing and unsafe, because a red suite destroys the one signal that matters mid-port: telling *not ported yet* apart from *ported and broken*.

Port against the same discipline, scoped differently:

- **Stub only the files that import the legacy package.** Everything else stays live and stays green. The skeleton is the seam, not the whole action.
- **Move the tests for stubbed behavior to `it.todo`**, each carrying a restore instruction: what it asserted, and why it cannot be restored verbatim. The `it.todo` count is then the remaining work, readable at any commit.
- **Keep the originals as a gitignored oracle** ([porting.md](porting.md)), and delete that scaffolding as part of the fill.

Green then means "everything not yet ported still works" at every intermediate commit, which is a claim worth having.

### A failing stub and a failing *test of* a stub are different things

Piece 5 says stubs never fail, and that a failing stub means the discipline is being skipped. That rule is about the stub, not about tests of it — and a test **of** a stub necessarily fails, because a placeholder return value cannot satisfy an assertion about real behavior.

| what is red | meaning |
| --- | --- |
| the stub itself fails | a bug in the skeleton — fix it now |
| a test asserting real behavior against a stub | expected; belongs in `it.todo`, not in the red count |

Conflating the two is what pushes a porting suite red for weeks. The second case is not a failure to be tolerated, it is a test that has not been re-enabled yet — and `it.todo` says exactly that, to the reporter and to the next reader.
