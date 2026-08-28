# Test improvement sweep — scheduled agent prompt

You are running unattended against an Effect v4 repository. Survey a small slice of its test suite, then land the improvements that actually make the suite harder to fool — and file tickets for the rest.

The goal is **a suite that fails when the code breaks**. Coverage percentage is a proxy for that and a bad one; a covered line asserted with nothing is worse than an uncovered line, because it reports safety that does not exist.

## Phase 0 — orient

Read the repository's own instructions first: `AGENTS.md` and `CLAUDE.md` at the root, then any package-level `CLAUDE.md` and testing docs they point at. **Those override anything here** — where tests live, which runner, which assertion style, what the coverage policy is.

Then establish the shape and the slice size:

- **A single-package library** — the suite is in scope, narrowed to a handful of modules in Phase 1.
- **A monorepo** — **one package, three to six modules** and their tests. Never sweep the workspace.
- **A GitHub Action on `@effected/*`** — the step modules, the service doubles, the lifecycle path through the action runtime. Load `testing-actions`; this domain has its own doubles convention and its own discriminating mutants.

## Phase 1 — load the standard, then choose the slice

**Load `effect-v4-testing` before reading any test.** It is the authority here, and more than half of it is about false greens — suites that pass while proving nothing. You cannot assess a suite you are surveying from general testing instinct.

Load `effected-packages` too if the slice touches the filesystem, so you reach for the kit's in-memory filesystem rather than inventing a double.

Choose the slice by where the suite is most likely to be lying, not where the coverage report is reddest:

- Modules with high coverage and few assertions — the classic false green.
- Tests written in plain Vitest inside an otherwise `@effect/vitest` suite.
- Tests with hand-rolled filesystem, clock, network or process doubles.
- Error paths: a module with a rich typed error union and tests that only exercise the happy path.
- Recently changed source whose tests did not change with it.
- Anything with a `skip`, a `todo`, a commented-out assertion, or a snapshot that was regenerated rather than reasoned about.

## Phase 2 — what you are looking for

Four kinds of finding. Keep them separate; they carry different value.

### A. Tests that cannot fail

The highest-value class, and the one a coverage report is blind to.

- A test that exercises code and asserts nothing, or asserts only that a call returned without throwing.
- An assertion on a value the code under test cannot produce differently — a shape check that passes for any output.
- A narrowing `if` with no `else`, so the assertions inside never run when the value takes the other branch and the test still passes.
- A snapshot accepted rather than read.
- A suite that exits zero having run **zero tests** — a filter that matched nothing looks exactly like a pass.

### B. Tests that should be `@effect/vitest` and are not

Plain Vitest running Effect code usually means the effect is being run by hand at the edge of the test, which loses the service graph, the typed error channel and the fiber semantics. Look for:

- `runPromise` or `runSync` inside a test body, with `async`/`await` plumbing around it.
- Assertions on a rejected promise instead of on the typed failure, so a defect and a domain error are indistinguishable.
- Services constructed by hand and passed as arguments, because there is no layer to provide.
- Error assertions matching on a message string rather than on the error tag or its structured fields.

The improvement is not a mechanical rewrite. It is: run the effect with the runner, provide the real layers with test doubles substituted, and assert on the typed failure through the failure channel rather than on an exception.

### C. Hand-rolled doubles that a real one would replace

A hand-rolled `FileSystem` stub encodes only what its author remembered, and a deny-by-default no-op double silently answers "no" to everything the author did not think about. Where the kit ships an in-memory filesystem, use it — and where the test needs a failure, inject it as a fault on the real implementation rather than writing a stub whose body is the fault.

The same reasoning covers a hand-rolled clock (the runner already installs a virtual one), a hand-rolled HTTP layer, and a hand-rolled subprocess shim.

### D. Missing drift protection

Tests that exist to catch a change nobody intended:

- **Reachability and bundle-shape tests** — an import edge from a light module to a heavy dependency, added innocently, is invisible in review.
- **Public API surface assertions** — an accidental export, a symbol quietly removed.
- **Round-trip and parity properties** — parse-then-print equals input, two entry points agreeing on the same corpus.
- **Fixture corpora** — a shared set of inputs with expected outputs, so a parser change shows up as a diff rather than a subtle behavior shift.
- **Property tests over a schema**, where a hand-picked example set is hiding whole classes of input.

Prefer a drift test where the *cost of an unnoticed change is high and the change is invisible in a diff*. Not everything deserves one.

## Phase 3 — delegate the survey

- **`effect-reviewer`** — the primary agent for this sweep; it carries the testing skills. Give it the named modules and the four categories, and require for each finding: the test's `file:line`, the source behavior that is unprotected, and whether the gap is a *missing test*, a *non-failing test*, or a *wrong-tool test*.
- **`action-engineer`** — dispatch for action, release-pipeline or GitHub-API test code. It knows this domain's doubles convention and which mutants actually discriminate.
- **`effect-developer`** — dispatch to write the selected tests, after Phase 4.

Ask every agent for the **discriminating input** with each proposed test: the specific input that is wrong in exactly one way, and what the assertion would say when the code regresses. An agent that cannot name that has proposed a test that cannot fail.

## Phase 4 — assess before you write anything

**A well-tested module surveyed for gaps will produce a list of gaps, because that is what you asked for.** Put every finding through this filter:

1. **Name the regression it would catch.** In one sentence: what change to the source makes this new test fail? If the answer is vague, the test is decoration.
2. **Is the behavior already covered elsewhere?** A property test upstream, an integration test, a type-level constraint that makes the case unrepresentable. Duplicating coverage adds maintenance and catches nothing new.
3. **Is the uncovered code worth covering?** Trivial getters, exhaustive-switch default branches that are unreachable by construction, and pure re-export lines are not gaps. Chasing them inflates the number and teaches nobody anything.
4. **Would the test be stable?** A test gated on real time, real network, real process behavior or ordering that the runtime does not guarantee will flake, and a flaky test is worse than no test — it trains everyone to ignore red.
5. **Is a "missing" assertion actually a deliberate boundary?** Some things are asserted at a different level on purpose. Check the repo docs before adding a redundant layer.

### Traps specific to this runner — read before writing a single test

These have each cost a full cycle in this codebase:

- **The runner's default `it.effect` always installs a virtual clock; it is not opt-in.** An in-program timeout therefore never fires on its own, so a test that waits on something only a concurrent or async path can deliver **hangs to the framework timeout** instead of failing on an assertion. Prefer a non-blocking observation — count operations in flight, yield, assert the maximum exceeded one — so both branches terminate. Reach for the live variant when the code under test performs real async IO.
- **That virtual clock starts at the epoch**, so a clock read returns 1970 unless you advance it. A test asserting on "now" against a real timestamp will fail confusingly.
- **A layer helper memoizes the layer across the tests it wraps; providing the same layer inline does not.** Which one you use decides whether state carries between tests. Choose deliberately and say why in a comment when it matters.
- **The runner also intercepts console output, including the effect logging APIs**, so a test asserting on logs may be reading a buffer that accumulates across the file.
- **A scoped run can fail repo-wide coverage thresholds by design.** Read the tests line, not the exit code, and disable coverage when running a subset — unless the repo's own script already handles it.
- **Zero tests matched exits zero.** Always confirm the run reported the number of tests you expected.

### Disqualified — never land these

- **Tests written to move a coverage number** with no named regression behind them.
- **A test you have not proven can fail.** See Phase 5.
- **Lowering a threshold, skipping a test, or loosening an assertion** to make a suite green. If something is failing, that is a finding to report, not a thing to sand down.
- **Regenerating a snapshot** rather than reading what changed and why.
- **A rewrite of a large existing suite** in one pull request. File a ticket describing the migration.
- **New test infrastructure** — a bespoke harness, a new double framework — when the repo already has a convention. Extend the convention.

## Phase 5 — pick, and prove each test can fail

Take **one to three cohesive additions**; prefer one coherent group over three scattered ones.

Every new or strengthened test must be shown to discriminate. Do not assume it:

1. Capture a baseline of the working tree: `git status --porcelain > /tmp/baseline`.
2. Write the test; confirm it passes against the current source.
3. **Break the source deliberately, with the editor** — one edge, one clause, one branch. Never `git checkout`, `git restore` or `git stash`; other uncommitted work may live in the tree.
4. Run the test and **read the failure text**. It must name the property you expected to break. An empty output or a missing pass line is not proof the test caught anything — it usually means a filter dropped the failure, or the run matched nothing at all.
5. Undo the break and confirm `git status --porcelain` matches the baseline, not that it is empty.

Report the failure message in the pull request. The claim is not "the test passes"; it is "mutating *this* makes it fail with *this text*".

Mutate the edges, not the middle: an off-by-one in a bound, a flipped comparison, a dropped clause in a union, a removed branch. A mutation the test survives tells you the test is weaker than you thought — that is the point of doing it.

For a drift test, the mutation is the drift: add the import edge the reachability test forbids, remove the export the surface test asserts, and confirm red.

## Phase 6 — implement and verify

Delegate to `effect-developer` with the discriminating input and the expected failure text specified, not a vague brief.

Tests go where the repo puts them (a package's `__test__/`, never beside the source, in the `@effected` kit and its consumers). Use `@effect/vitest` and assert with `assert.*`, never `expect`. A test needing a `FileSystem` uses the kit's in-memory filesystem rather than a hand-rolled double, and injects misbehavior as a fault handler rather than as a stub body.

Assert on typed failures through the failure channel, not on thrown exceptions or message strings. Assert the output as well as the property you are testing — a concurrency fix that reorders results is a bug, not an improvement.

Then run the repo's own targeted checks for the changed area, through its own scripts. Report what they returned, including the test count.

## Phase 7 — file tickets for everything you did not implement

**Not optional.** Every real gap you did not close becomes a GitHub issue, including everything disqualified for scope — a whole-suite migration, a harness that needs designing, a flake that needs a human decision. Findings that failed Phase 4 on the merits are dropped silently.

Write each ticket for a stranger. **The next agent will not be you and will have none of this session's context.** The expensive part of this run was working out *what regression a test would catch and what input discriminates it* — that is exactly what gets lost. "Add more tests for `Parser.ts`" transfers nothing and will be closed unread.

One issue per gap. A grab-bag never closes.

Search open issues first; comment with new evidence rather than duplicating.

Each issue carries:

- **Title** — imperative and specific. "Add a failure-path test for the malformed-header branch in `Parser.ts`", not "improve parser tests".
- **The unprotected behavior** — `path/to/source.ts:140-158` with the code quoted, and the existing test file that *should* have covered it named.
- **The regression it would catch** — the concrete change to the source that would go unnoticed today. This is the load-bearing field; without it the ticket is a coverage complaint.
- **The discriminating input** — the specific input that is wrong in exactly one way, with the expected result. Give the actual value, not a description of one.
- **The shape of the test** — runner, which layers get provided, which double, whether it needs the live variant because of real async IO. A sketch in code is worth more than a paragraph.
- **Known traps for this particular test** — virtual clock, layer memoization, console interception, whatever you already worked out. Save the next reader the cycle you spent.
- **How to prove it discriminates** — the mutation to make, and what the failure should say.
- **Why this run did not do it** — one line.

Use the repo's existing labels.

## Phase 8 — open the pull request

Branch from an up-to-date default branch; never push to it directly. Body is ordinary markdown:

- **What and why** — the gap, and the regression the new tests catch, in two or three sentences.
- **Proof of discrimination** — for each test, the mutation you made and the failure text it produced. This is the section that matters.
- **What did not change** — production source, if it did not. Say so explicitly.
- **Verification** — the commands you ran, what they returned, and the test count.
- **Also found** — filed issues by number, one line each, plus the gaps dropped in Phase 4 and why.

Do not cite internal design-doc paths if the repository is public.

## Landing nothing is a valid outcome

A suite that already discriminates is a real result. If nothing survived Phase 4, open no pull request; report what you surveyed and what you deliberately did not add.

Padding a suite with tests that cannot fail is the worst outcome available on this job: it raises the number, lowers the signal, and makes the next honest gap harder to see.
