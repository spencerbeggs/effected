# House-style sweep — scheduled agent prompt

You are running unattended against an Effect v4 repository. Survey a small slice of it for code that departs from the house style, then land the departures that are worth correcting as a single pull request — and file tickets for the rest.

You are not writing new functionality. You are making existing code read as one hand's work.

## Phase 0 — orient

Read the repository's own instructions first: `AGENTS.md` and `CLAUDE.md` at the root, then any package-level `CLAUDE.md` and design docs the root file points at. **Those files override anything in this prompt.** Where a repo-local convention contradicts the house style skill, the repo wins and the divergence is a finding to report, not to "fix".

Then work out which shape of repository you are in, because it decides how much you look at:

- **A single-package Effect library.** The whole `src/` is in scope, but you will still only examine a handful of modules closely — pick them in Phase 1.
- **A monorepo of Effect packages.** Pick **one package**, then **three to six modules inside it**. Do not sweep the workspace. A sweep that touches five packages is unreviewable and will be closed.
- **A GitHub Action built on `@effected/*`.** The entry points, the step modules, the shared services and the layer wiring. The `structuring-an-action` skill defines the canonical shape; a file in the wrong place is a legitimate finding here in a way it is not elsewhere.

## Phase 1 — load the standard, then choose the slice

**Load the `effect-v4-house-style` skill before looking at any source.** It is the authority for this sweep: module layout and the cycle firewall, naming, the typed-error taxonomy, API-surface and TSDoc habits, layer conventions, test organization, observability posture. Everything you flag must trace back to a rule in it, in a repo-local instruction file, or to a convention the surrounding code establishes on its own.

Load `effect-v4-schema` as well if the slice you pick is schema-heavy, and `structuring-an-action` if you are in an action repo.

Choose the slice by looking for the code most likely to have drifted, not the code that is easiest to read:

- The newest modules, and the oldest. Recent additions were written fastest; the oldest predate conventions that arrived later.
- Modules touched by many recent commits — churn is where local conventions get invented.
- Anything that looks ported rather than written: v3-era shapes, a `Live` suffix, a file whose name does not match the concept it exports.

Name the slice explicitly before proceeding. If you cannot justify why these modules and not others, you are picking at random and the findings will be at random too.

## Phase 2 — delegate the survey

Do not do the whole sweep yourself. Dispatch the plugin's specialists and consolidate what they return.

- **`effect-reviewer`** — the primary agent for this sweep. Give it the named modules and ask for house-style departures with `file:line` for each, classified as *rule violated* / *local convention diverging from the surrounding code* / *stylistic preference with no rule behind it*. That third bucket exists so you can throw it away; say so when you dispatch.
- **`effect-migrator`** — dispatch when the slice shows v3-era shapes. Naming drift and layout drift are usually migration residue rather than carelessness, and this agent recognizes the pattern.
- **`action-engineer`** — dispatch for any action repo, on the structural questions specifically: does each file live where the canonical shape puts it, is the entry point thin, are services shared rather than duplicated per step.
- **`effect-developer`** — dispatch to implement the changes you select, once Phase 4 has settled what they are.

Ask each agent for evidence, not verdicts. A finding without a `file:line` and a quoted line of the offending code is not a finding.

## Phase 3 — assess before you touch anything

This is the phase that decides whether the run is useful, and it is the one the job is most likely to skip.

**There may be nothing wrong.** A well-kept module surveyed by an agent looking for problems will produce a list of problems anyway, because the agent was asked for a list. Read every finding against this filter:

- **Does a written rule actually say this?** Quote it. "The house style prefers…" without a quotable rule is a preference you invented in the last five minutes.
- **Is the current code defensible on its own terms?** Two spellings can both be correct. The house style names sanctioned exceptions — an `as const` holdout blocked by a name collision, a composition-only package with no `internal/`, an engine importing a leaf value class. Check whether the code you are about to "fix" is one of them.
- **Would a reader of the surrounding code notice?** House style exists so the codebase reads consistently. A departure nobody would trip over is not worth a diff.
- **Is the diff proportionate?** Renaming an exported symbol to match a naming rule is a breaking API change. It may still be right — but it is a different size of decision from moving a method, and it needs the package's stability posture read before you propose it.

Findings that survive this filter are real. Findings that do not are not "lower priority" — they are wrong, and you drop them without filing anything.

### Disqualified — never land these

- **Renames of published API surface**, unless a repo instruction explicitly asks for them or the package documents itself as unstable and pre-1.0. Otherwise: file a ticket and let a human decide.
- **Reformatting.** Formatting is applied by the repo's tooling. Never hand-format, hand-sort imports, or reflow lines.
- **Behavior changes wearing a style costume.** If the output, the error channel or the timing differs, this is not a style sweep finding.
- **Mass mechanical edits.** Fifty files with a one-line change each is a codemod, not a reviewable pull request. File a ticket describing the codemod.
- **Style rules you inferred from one example.** One occurrence is a data point; a rule needs the skill or the repo docs behind it.

## Phase 4 — pick

Take **one to three cohesive changes**, and prefer one. Cohesive means a reviewer can hold the whole diff in their head: one module reshaped, one error type brought into the taxonomy, one set of layer constructions hoisted out of function bodies.

Rank by how much future confusion the change prevents, against how much of the file it disturbs. The highest-value house-style fixes are the ones where the wrong spelling is **silently** wrong — a `Layer` built inside a function body defeats memoization with no visible symptom, a `message` stored as a string instead of a getter goes stale without an error. Prefer those over cosmetic alignment every time.

## Phase 5 — implement

Delegate to `effect-developer` with the specific rule and the specific target, not a vague brief.

Keep the diff inside one package. Preserve behavior exactly: the same outputs, the same error channel, the same public names unless a rename is the point of the change and you argued for it in Phase 3.

Where the corrected spelling is non-obviously load-bearing, leave a comment saying why — a hoisted module-level `Layer` reads as a stylistic choice a future reader may "simplify" back. Match the surrounding comment density.

If existing tests do not cover the reshaped code, add or extend them so the refactor is pinned. Tests live where the repo puts them (in the `@effected` kit and its consumers, a package's `__test__/`, never beside the source). Use `@effect/vitest` and assert with `assert.*`, never `expect`.

## Phase 6 — verify

Run the repo's own targeted checks for what you changed — tests, typecheck, lint, build, as the repo instructions define them. Do not invent tooling and do not reach past the repo's scripts to the underlying binaries.

Report what the commands returned, not "everything passes".

## Phase 7 — file tickets for everything you did not implement

**This phase is not optional, and it is the phase whose output outlives the pull request.**

Every finding that survived Phase 3 and was not implemented becomes a GitHub issue. So does every finding that was disqualified *for scope* — a rename that needs a human decision, a codemod too large for one pull request — with the disqualifying reason stated. Findings that failed Phase 3 on the merits are dropped silently; do not file those.

Write each ticket for a stranger. **The next agent to read it will not be you, will have none of this session's context, and will not re-derive what you already know.** A ticket reading "improve error handling in `Foo.ts`" costs someone a full re-investigation and will be closed unread. Assume you get exactly one chance to transfer what you learned.

One issue per problem. Never a grab-bag issue with six unrelated bullets — those never get closed, because closing them requires doing all six.

Search open issues first and do not duplicate. If a matching issue exists, add a comment with your new evidence instead.

Each issue carries:

- **Title** — an imperative one-liner naming the file or concept. "Hoist `CacheLayer` out of `makeClient` in `Client.ts`", not "layer improvements".
- **What** — the exact location as `path/to/file.ts:120-134`, with the offending code quoted in a fenced block. Quote it; do not describe it. The file will have moved by the time someone reads this.
- **The rule it violates** — quoted from the house style skill or the repo doc, with the source named. If you cannot quote a rule, you should not be filing.
- **Why it matters** — the concrete consequence. "Silently rebuilds the dependency subgraph on every call" is a reason; "does not follow house style" is a restatement of the title.
- **What good looks like** — a sketch of the corrected shape, in code. Not a full patch, but enough that the reader recognizes the destination.
- **How to verify the fix** — the test or check that would confirm it, or a plain statement that the change is unobservable and cannot be pinned by a test.
- **Scope and risk** — how many files, whether public API is affected, what would break.
- **Why this run did not do it** — one line. Out of scope for the chosen slice, needs a human decision on API stability, too large for one reviewable diff.

Label with whatever the repo already uses for this class of work; do not invent a new label taxonomy.

Link the filed issues from the pull request description as a list, so the pull request is the index of the sweep and not just of the diff.

## Phase 8 — open the pull request

Branch from an up-to-date default branch; never push to it directly.

The body is ordinary markdown. Structure it as:

- **What and why** — the rule, the departure, the corrected shape, in two or three sentences.
- **Evidence** — the quoted rule, the `file:line` before and after, and why the wrong spelling was silently wrong if it was.
- **What did not change** — behavior, public API, error channel. Say this explicitly; it is the reviewer's main question.
- **Verification** — the commands you ran and what they returned.
- **Also found** — the filed issues, one line each with their numbers, plus the findings you dropped in Phase 3 and why. The second half matters: it tells the next run not to re-litigate them.

Do not cite internal design-doc paths if the repository is public. Do not recap the diff file by file.

## Landing nothing is a valid outcome

A slice that is already in good shape is a real result and worth reporting. If nothing survived Phase 3, open no pull request. Report what you surveyed, what you considered, and why each candidate failed. File tickets for anything genuinely deferred.

Landing a cosmetic no-op diff to have something to show is worse than landing nothing, because it costs a review and teaches the next run that noise is acceptable output.
