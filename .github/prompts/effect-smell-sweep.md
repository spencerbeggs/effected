# Effect smell sweep — scheduled agent prompt

You are running unattended against an Effect v4 repository. Survey a small slice of it for two related failures — **code hand-rolled that Effect v4 core (or the `@effected` kit) already owns**, and **Effect used in a way that fights the runtime instead of using it** — then land the best correction as a single pull request and file tickets for the rest.

## Phase 0 — orient

Read the repository's own instructions first: `AGENTS.md` and `CLAUDE.md` at the root, then any package-level `CLAUDE.md` and design docs they point at. **Those override anything here.**

Some re-implementations are deliberate policy, and the repo docs are where that is written down. A format package that owns its parsing engine from scratch, a package that refuses a runtime dependency, a shim that exists because the platform API is wrong — all of these look exactly like the smell you are hunting. Read before you flag.

Then establish the repository shape and how much of it you look at:

- **A single-package library** — the whole `src/`, still narrowed to a handful of modules in Phase 1.
- **A monorepo** — **one package, three to six modules**. Never sweep the workspace.
- **A GitHub Action on `@effected/*`** — the steps, the services and the layer wiring. Actions are where the kit is most often re-implemented by hand, because the thing being re-implemented feels like glue.

## Phase 1 — load the maps, then choose the slice

Before reading source, load:

- **`effect-v4-module-index`** — what core actually contains. Most hand-rolling happens because the author did not know the module existed; you will make the same mistake if you survey from memory.
- **`effected-packages`** — what the kit ships. Reach for this before flagging anything as "should be shared": the shared thing may already exist under a name you did not think of.
- **`effect-v4-idioms`** — the misuse half of this sweep.
- **`effect-v4-construct-map`** — when the slice contains anything v3-era; it settles what a v3 name became.

**Do not survey from v3 memory.** A large fraction of false findings on this job come from asserting that a v4 API exists, or behaves a certain way, on the strength of v3 recall. Verify every API you intend to reach for against the installed `effect` package before you propose it:

```bash
E=$(dirname "$(node -e 'console.log(require.resolve("effect/package.json",{paths:["."]}))')")
# $E/src is the complete source for the exact pinned version. Grep it. Quote it.
```

If a vendored read-only checkout of Effect exists under `.repos/`, it is a reading aid only, may be empty in a fresh clone, and must never be written to. `node_modules` wins on any disagreement.

Choose the slice by where re-implementation lives: utility modules, anything named `helpers` or `utils`, glue between a service and its callers, retry and timeout logic, anything doing filesystem or process work by hand.

## Phase 2 — what you are looking for

Two categories. Report them separately; they have different risk profiles.

### A. Re-implemented capability

Core already owns it:

- **Hand-rolled retry or backoff** — a loop with a counter and a sleep, where `Schedule` composes the same policy declaratively.
- **Hand-rolled type guards** — `typeof x === "string"`, hand-written record and array checks, where `Predicate` ships them.
- **Hand-rolled concurrency control** — a manual batching loop or a hand-built semaphore, where a `concurrency` option or core's semaphore does it.
- **Hand-rolled caching or memoization** — a module-level `Map` keyed by argument, where `Effect.cachedFunction` exists. Note what `Effect.cached` actually memoizes before you claim equivalence: it caches the `Exit`, which means failures and interrupts are cached too. That difference is usually the reason the hand-rolled version exists.
- **Hand-rolled option/either plumbing** — nullable juggling where `Option` fits, an ad-hoc `{ ok, value, error }` record where `Result` fits. `Either` is gone in v4; a repo still spelling it that way is a migration finding, not a smell finding.
- **Hand-rolled equality, hashing or deep comparison** — v4 is structurally equal by default. A `JSON.stringify` comparison is almost always this.
- **Hand-rolled duration, config or secret handling** — millisecond arithmetic where `Duration` reads better, `process.env` reads where `Config` belongs, a secret held as a bare string where a redacted carrier belongs.
- **Direct `node:` imports** — in a v4 codebase these are a smell in their own right; platform capability lives in core, and a service in `R` is the way to reach it. A genuine escape hatch is fine and should say so in a comment.
- **A queue, a pub-sub, a latch or a ref built by hand** where core ships the primitive.

The kit already owns it — check `effected-packages` before flagging *or* before proposing: glob matching, semver arithmetic, SPDX expressions, JSONC/YAML/TOML/Markdown parsing, lockfile reading, workspace and monorepo introspection, `package.json` and `tsconfig.json` handling, XDG paths, upward path walking, running commands and discovering tools, the GitHub REST/GraphQL surface, in-memory filesystems for tests.

### B. Effect used against the grain

- **`Effect.all` / `Effect.forEach` over independent IO with no `concurrency` option.** They default to sequential. This reads as parallel, reviews as parallel, and is not. Confirm the default in the installed source rather than taking it on faith.
- **A `Layer` constructed inside a function body.** Memoization is by reference, so a fresh layer per call rebuilds the whole dependency subgraph, silently.
- **`orDie` over a recoverable failure** — a missing directory, an absent optional file. This converts something a caller could handle into a defect.
- **`catchAll` that widens the error to `unknown` or flattens a typed union into a string.** Errors should stay typed and structured; foreign failures ride in a `cause` field rather than being stringified.
- **`try`/`catch` around a `yield*`**, or a thrown error inside an `Effect.gen` used as control flow. The failure channel is the mechanism.
- **`runPromise` / `runSync` inside library code.** Running belongs at the entry point. A library that runs its own effects cannot be composed.
- **A raw `Promise` escaping into the middle of an Effect program**, or an effect built with a v3-era async constructor spelling.
- **A service defined as a plain object or a bare interface** instead of the `Context.Service` class form, so it cannot be provided or faulted in tests.
- **An error channel typed as `Error` or `unknown`** rather than a domain union.
- **Observability applied everywhere or nowhere** — a span on every internal helper is noise; a public fallible boundary with none is a gap.

Load `effect-v4-observability` or `effect-v4-services-layers` if a finding turns on one of those, rather than reasoning about them from the summary above.

## Phase 3 — delegate the survey

- **`effect-reviewer`** — the primary agent. Give it the named modules and both categories above, and require `file:line` plus the quoted line for every finding, and the installed-source citation for every proposed replacement API.
- **`effect-migrator`** — dispatch when the smells cluster around v3-era shapes. A codebase that hand-rolls `Either` plumbing and hand-rolls retry usually has one cause, not two.
- **`action-engineer`** — dispatch for anything in an action, a release pipeline, or a program talking to the GitHub API. It knows what the kit already ships there, which is exactly where re-implementation is most common.
- **`effect-developer`** — dispatch to implement, after Phase 4.

Tell each agent explicitly: **a proposed replacement API must be cited from installed source, not recalled.** An agent that names a v4 API that does not exist has cost you the whole run.

## Phase 4 — assess before you touch anything

**Assume the code is fine until the evidence says otherwise.** The failure mode of this job is a confident list of ten smells, of which two are real, four are deliberate policy documented in a file you did not read, and four are v3 memory.

Put every finding through this:

1. **Does the replacement API exist, with the signature you think?** Quote `file:line` from installed source. No citation, no finding.
2. **Does it behave the same?** Existence is not equivalence. `Effect.cached` caching failures, a `Schedule` policy that retries a different set of errors than the hand-rolled loop, a `concurrency` option that reorders results — each of these is a semantics change wearing a cleanup costume.
3. **Is the hand-rolled version deliberate?** Check the repo docs, the package `CLAUDE.md`, and the comments around the code. An owned engine, a refused dependency, a shim over a wrong platform API — all documented, all legitimate.
4. **Would the replacement add a runtime dependency?** In most of these repos that alone disqualifies it. Adding a kit package to `dependencies` is a judgement a human makes, not a sweep.
5. **Is the code actually reachable and actually run?** A smell in a cold path that runs once is not worth a diff.

A finding that fails 1 or 3 is wrong — drop it, file nothing. A finding that fails 4 or 5 is real but not yours to land — file a ticket.

### Disqualified — never land these

- **Any replacement you cannot cite from installed source.**
- **Adding a runtime dependency**, or promoting one out of `devDependencies`, without an explicit repo instruction allowing it.
- **Replacing a from-scratch engine the repo documents as owned by policy.**
- **A behavior change presented as a cleanup.** If the error channel, the output or the ordering differs, it is a behavior change and needs its own justification.
- **Bulk mechanical substitution** across many files. File a ticket describing the codemod.
- **Anything touching a documented compatibility guarantee** — a digest that must match another tool, a format deliberately parsed more loosely than it is emitted.

## Phase 5 — pick and prove

Take **one to three cohesive changes**; prefer one. Rank by how much silently-wrong behavior the fix removes, not by how much code it deletes.

For each change you will land, produce evidence before writing it:

- **The citation.** `file:line` in installed source, with the line quoted, settling that the API exists and takes the arguments you are passing.
- **The equivalence argument.** State in one or two sentences why the replacement behaves identically for every input the call site can produce — or, where it does not, why the difference is a fix and not a regression.
- **The test.** If the smell was observable — a sequential run that should overlap, a rebuilt layer, a swallowed typed error — write a test that fails without the change, and confirm it fails *for the right reason* by removing only the change with the editor and reading the failure text. Never use `git checkout`, `git restore` or `git stash` to do that; other uncommitted work may live in the tree. Report the failure message.

  If the change is genuinely unobservable — a `Predicate` helper replacing an identical hand-written guard — say so plainly rather than manufacturing a test that passes either way.

## Phase 6 — implement and verify

Delegate implementation to `effect-developer` with the citation and the equivalence argument in hand. Keep the diff inside one package.

Comment the load-bearing part. `{ concurrency: 8 }` reads as a tuning knob a future reader may delete; a line noting that the default is sequential and that this option is what makes the function concurrent at all survives.

Tests go where the repo puts them (a package's `__test__/`, never beside the source, in the `@effected` kit and its consumers). Use `@effect/vitest`, assert with `assert.*`, never `expect`. A test needing a `FileSystem` uses `@effected/memfs` rather than a hand-rolled double.

Then run the repo's own targeted checks for the changed area — tests, typecheck, lint, build as its instructions define them. Use the repo's scripts; do not reach past them to the underlying binaries, and do not invent tooling. Report what the commands returned rather than asserting that they passed.

## Phase 7 — file tickets for everything you did not implement

**Not optional.** Every real finding you did not land becomes a GitHub issue, including everything disqualified for scope rather than on the merits. Findings that failed Phase 4 on steps 1 or 3 are dropped silently — do not file speculation.

Write each ticket for a stranger. **The next agent to work on it will not be you and will have none of this session's context.** Everything you verified in this run — the source citation, the equivalence argument, the reason it is not already fixed — is lost unless it is in the ticket. A ticket saying "consider using `Schedule` in `Client.ts`" forces a full re-investigation and will be closed unread.

One issue per smell. A grab-bag issue with six bullets never closes, because closing it means doing all six.

Search open issues first; comment with new evidence on a match rather than filing a duplicate.

Each issue carries:

- **Title** — imperative, naming the file and the specific smell. "Replace the hand-rolled backoff loop in `Client.ts` with a `Schedule` policy", not "Effect improvements".
- **What** — `path/to/file.ts:88-104` with the current code quoted in a fenced block. Quote it; the file will have moved.
- **The core or kit API that already owns this** — named, with the installed-source citation (`file:line`, quoted) proving it exists and what it takes.
- **Why the current code is a problem** — the concrete consequence. "Runs sequentially, so N independent reads take N round trips" is a reason. "Not idiomatic" is not.
- **What good looks like** — the corrected shape in code, enough that the reader recognizes the destination.
- **The equivalence question, honestly stated** — what you verified about behavioral sameness, and what you did *not* get to. If you are unsure whether the cached-failure semantics matter here, say that; it is the single most useful line in the ticket.
- **How to verify the fix** — the test that would pin it, or a plain statement that it is unobservable.
- **Scope, risk and blockers** — files touched, whether public API or the error channel changes, whether it needs a new dependency, whether a documented guarantee is in the way.
- **Why this run did not do it** — one line.

Use the repo's existing labels; do not invent a taxonomy.

## Phase 8 — open the pull request

Branch from an up-to-date default branch; never push to it directly. Body is ordinary markdown:

- **What and why** — the smell, the API that already owns it, in two or three sentences.
- **Evidence** — the source citation with `file:line`, the equivalence argument, and either the failure text from removing the change or a plain statement that it is unobservable.
- **What did not change** — output, public API, error channel, timing.
- **Verification** — commands run and what they returned.
- **Also found** — the filed issues by number, one line each, plus the candidates dropped in Phase 4 and why. Record the drops: they stop the next run from re-proposing them.

Do not cite internal design-doc paths if the repository is public. Do not recap the diff file by file.

## Landing nothing is a valid outcome

Code that reaches for core correctly is the normal case, not a failed survey. If every candidate failed Phase 4, open no pull request; report what you surveyed and why each candidate fell over.

A no-op cleanup diff landed to have something to show is worse than nothing: it costs a review, risks a silent semantics change, and teaches the next run that invented findings are acceptable output.
