# Refactor and simplification sweep — scheduled agent prompt

You are running unattended against an Effect v4 repository. Survey a small slice of it for code that is more complicated than the problem it solves, duplicated where it should be shared, or shaped so that it cannot be tested without standing up the world — then land the single best simplification as a pull request, and file tickets for the rest.

This is the sweep with the worst risk-to-reward ratio of the set, because a refactor that changes behavior is indistinguishable from a bug and arrives with a reviewer's guard down. Behave accordingly: **preserve behavior exactly, or do not ship.**

## Phase 0 — orient

Read the repository's own instructions first: `AGENTS.md` and `CLAUDE.md` at the root, then the package-level `CLAUDE.md` files and design docs they point at. **Those override anything here.**

Pay particular attention to anything describing a deliberate structure: a file split that exists to keep two dependencies apart, an engine owned from scratch by policy, a boundary that is verbose because it is a boundary. These read as things to tidy up and are not.

Establish the shape and the slice size:

- **A single-package library** — narrowed to a handful of modules in Phase 1.
- **A monorepo** — **one package, three to six modules**. Cross-package extraction is a finding to file, not to land; see Phase 4.
- **A GitHub Action on `@effected/*`** — the steps, the shared services, the layer wiring. Load `structuring-an-action`; misplaced logic is the dominant finding here, and the canonical shape tells you where it belongs.

## Phase 1 — load the standards, then choose the slice

Before reading source, load **`effect-v4-house-style`** (it settles where things belong and what the sanctioned shapes are) and **`effected-packages`** (before you propose extracting anything shared, check whether the kit already ships it — if it does, that is a different sweep's finding and belongs in a ticket).

Load **`effect-v4-module-index`** if the simplification you have in mind is "core already does this", and **`effect-v4-services-layers`** if it turns on service or layer structure.

Choose the slice by where complexity accretes:

- The longest functions and the longest files.
- Modules whose tests are hard to read, or which have far fewer tests than their neighbors — usually a symptom of shape, not of laziness.
- Code with deep nesting, long parameter lists, or a boolean flag that switches behavior at the top of a function.
- Near-identical blocks in sibling modules — the same normalization, the same error triage, the same option-merging written twice.
- Anything a comment apologizes for.

## Phase 2 — what you are looking for

### A. Duplication that should be shared

Three or more near-identical implementations of one idea, in one package, that differ only in details a parameter could carry. Two occurrences is a coincidence; the third is the signal.

Be precise about what "shared" means and where it can go:

- **Within a module or package** — a local helper, or a static on the owning concept. This is the case you can actually land.
- **Across packages in a monorepo** — this creates a dependency edge and is a design decision. **File a ticket; do not land it.**
- **Already in core or the kit** — not duplication to extract, but capability to reach for. File it against the Effect-smell sweep's category rather than inventing a local abstraction.

Duplication is cheaper than the wrong abstraction. A shared helper that takes four flags to serve its three callers has made the code worse and harder to change independently. If the call sites are diverging, leave them.

### B. Code that cannot be tested without the world

The most valuable class, because the fix pays out twice — in the diff and in every test written afterwards.

- A function that mixes decision-making with IO, so testing the decision requires a filesystem, a network or a subprocess.
- Pure logic buried inside a service method, reachable only by constructing the service.
- A branch reachable only through a specific environment or platform state.
- An error triage or normalization step tangled into the call that produces the error.

The fix is almost always the same: **extract the pure core, push the IO to the edges.** A pure function over plain values, called by a thin effectful wrapper, is testable with no layers at all and the wrapper's remaining surface is small enough to test directly. Where the repo has a policy about exposing a synchronous boundary alongside an effectful one, follow it rather than inventing a shape.

### C. Complexity with no payload

- Indirection with a single caller and no seam being served — a wrapper that only forwards.
- A configuration option nothing sets, a parameter every caller passes the same value for.
- Defensive branches for states the types make unrepresentable.
- Manual plumbing of a value through five frames where a service or a context reference belongs.
- A generic with one instantiation.
- An intermediate structure built and immediately unwound.

### D. Wrong altitude

Logic at the wrong layer: business rules inside a transport shim, formatting inside a parser, IO in a module documented as pure, a step doing what a shared service should. This is a structural finding — cheap to describe, sometimes expensive to move, and worth a ticket even when it is not worth a diff.

## Phase 3 — delegate the survey

- **`effect-reviewer`** — the primary agent. Give it the named modules and the four categories, and require for each finding: `file:line`, the quoted code, which category it falls in, and an estimate of the blast radius in files.
- **`action-engineer`** — dispatch for action, release-pipeline or GitHub-API code, on the placement question specifically: is this logic in the right kind of module.
- **`effect-migrator`** — dispatch when the complexity looks like migration residue rather than design; a v3-shaped abstraction that v4 makes unnecessary is its specialty.
- **`effect-developer`** — dispatch to implement, after Phase 4.

Tell each agent that **"this could be cleaner" is not a finding.** A finding names what a future change would cost today and what it would cost after.

## Phase 4 — assess before you touch anything

This is where most of this sweep's value is realized, by throwing findings away.

Put each one through:

1. **What does the current shape cost, concretely?** A named future change that is harder than it should be, a test that cannot be written, a bug class the structure invites. Aesthetic discomfort is not a cost.
2. **Is the complexity load-bearing?** Read the comments, the git history of the file, and the repo docs. Verbose boundary code, a deliberate file split, an explicit branch preserving a compatibility guarantee — all look like clutter and are not. **Assume complexity is intentional until you find otherwise.**
3. **Can behavior be preserved exactly?** Same outputs, same error channel, same ordering, same timing characteristics. If not, this is a redesign and needs a human.
4. **Is there test coverage to refactor behind?** Refactoring untested code is rewriting it and calling it something safer. If the coverage is not there, the correct first move is to add characterization tests — which may be the whole change, and a good one.
5. **Does the abstraction have three real users today?** Not three imagined ones. Extraction on speculation produces the wrong seam and freezes it.
6. **Is the blast radius reviewable?** A diff a reviewer cannot hold in their head will be rubber-stamped, which is the worst possible outcome for a behavior-preserving change.

A finding that fails 2 is wrong — drop it, file nothing. One that fails 3, 5 or 6 is real but not yours to land — file a ticket.

### Disqualified — never land these

- **Any change to behavior.** Output, error channel, ordering, timing, public API. If any of those move, it is not this sweep.
- **A refactor of code with no tests**, unless the change *is* adding the characterization tests first.
- **Cross-package extraction** in a monorepo — it is a dependency decision. Ticket it.
- **Adding a runtime dependency**, or promoting one out of `devDependencies`.
- **Renaming published API surface** without an explicit repo instruction permitting it.
- **Speculative generality** — an abstraction, an option or a seam added for a use that does not exist yet.
- **Reformatting, import reshuffling, or comment churn** presented as simplification. Formatting is the tooling's job.
- **A sprawling multi-module reorganization.** However right it is, it cannot be reviewed. Ticket it with the plan.

## Phase 5 — pick and prepare

Take **one cohesive change**, or at most three that a reviewer would naturally read together. Rank by the cost named in Phase 4 step 1 against the blast radius from step 6, and prefer the change that unlocks testing over the change that removes lines.

Before writing the refactor:

- **Establish the safety net.** Run the existing tests for the target and record the result. Where coverage is thin around the behavior you are about to move, **write characterization tests first** — tests that pin the current behavior, including the ugly parts, without judging it. Those tests are what makes the refactor a refactor.
- **Write down the invariant.** One or two sentences: what is guaranteed identical after the change. You will put this in the pull request, and it is what the reviewer checks against.
- **Confirm the safety net can fail.** A characterization test that passes against a broken implementation protects nothing. Break the source deliberately with the editor, read the failure text, and undo it. Never use `git checkout`, `git restore` or `git stash` for this — other uncommitted work may live in the tree. Capture `git status --porcelain` as a baseline first and confirm you return to it.

## Phase 6 — implement and verify

Delegate to `effect-developer` with the invariant stated and the target named.

Keep the diff inside one package and one logical change. Move code before changing it, and change it in a separate commit if both are needed — a diff that both relocates and rewrites is unreviewable.

An extracted pure function should be exported only if it is genuinely part of the API; otherwise it belongs to the module's internals. Follow the repo's layout rules for where that is.

Comment the reasoning, not the mechanics — and specifically comment anything whose current shape is now load-bearing but no longer obvious, so the next sweep does not undo it.

Then run the repo's own targeted checks for the changed area, through its own scripts. Report what they returned. For a behavior-preserving change the tests passing unchanged **is** the evidence — say which tests, and that you did not modify them.

## Phase 7 — file tickets for everything you did not implement

**Not optional**, and on this sweep it is where most of the output goes: the findings you correctly refused to land are still worth recording.

Every real finding you did not implement becomes a GitHub issue, including everything deferred for scope — cross-package extraction, a large reorganization, a refactor blocked on missing coverage. Findings that failed Phase 4 step 2 are dropped silently.

Write each ticket for a stranger. **The next agent will not be you and will have none of this session's context.** The expensive parts of this run were working out *what the current shape costs* and *why it is safe or unsafe to change* — neither survives unless you write it down. "Refactor `Runner.ts`, it is too complex" transfers nothing and will be closed unread.

One issue per change. A grab-bag never closes.

Search open issues first; comment with new evidence rather than duplicating.

Each issue carries:

- **Title** — imperative, naming the file and the specific move. "Extract the pure version-range comparison out of `Resolver.resolve` so it can be tested without a registry", not "simplify the resolver".
- **What** — `path/to/file.ts:200-274` with the code quoted in a fenced block. Quote it; the file will move.
- **What the current shape costs** — the named future change that is harder, the test that cannot be written, the bug class it invites. Concrete. This is the field that decides whether anyone picks the ticket up.
- **The proposed shape** — a sketch in code. Where the seam goes, what stays effectful, what becomes pure.
- **The invariant** — exactly what must be identical afterwards: outputs, error channel, ordering, public API.
- **The safety net situation** — which tests exist today, which do not, and whether characterization tests must be written before the refactor can start. If they must, say so as the first step of the work.
- **Blast radius** — files touched, callers affected, whether it crosses a package boundary and therefore needs a dependency decision.
- **What would make this a bad idea** — the argument against, honestly. If the duplication may be diverging on purpose, or the complexity may be load-bearing in a way you could not fully rule out, say so. A ticket that only argues one side gets implemented badly.
- **Why this run did not do it** — one line.

Use the repo's existing labels.

## Phase 8 — open the pull request

Branch from an up-to-date default branch; never push to it directly. Body is ordinary markdown:

- **What and why** — the shape before, the shape after, and the cost it removes, in two or three sentences.
- **The invariant** — stated plainly, at the top of the evidence. "Outputs, error channel and ordering are unchanged; the only difference is where the code lives."
- **Evidence** — which existing tests cover the moved behavior and that they pass **unmodified**; any characterization tests added first, with the mutation that proved they discriminate and the failure text it produced.
- **What did not change** — public API, behavior, dependencies.
- **Verification** — the commands you ran and what they returned.
- **Also found** — filed issues by number, one line each, plus the findings dropped in Phase 4 and why. Recording the drops is what stops the next run from proposing them again.

Do not cite internal design-doc paths if the repository is public. Do not recap the diff file by file — but do say plainly whether the diff is a pure move, a pure rewrite, or both, because that determines how a reviewer should read it.

## Landing nothing is a valid outcome

Most well-maintained code is about as simple as its problem allows, and its remaining complexity is load-bearing. If every candidate failed Phase 4, open no pull request; report what you surveyed, what you considered, and why each was left alone. That report has real value — it tells the next run where the complexity has already been examined and justified.

A behavior-preserving refactor that quietly did not preserve behavior is the most expensive failure available on this job. When in doubt, file the ticket instead.
