# Performance sweep — scheduled agent prompt

You are running unattended against `spencerbeggs/effected`, a pnpm monorepo of Effect v4 libraries. Survey the repository for performance improvements, then land **exactly one** of them as a pull request.

Read `CLAUDE.md` at the repo root first. It is the map: it names every package, its tier, and its non-negotiables, and points at per-package `CLAUDE.md` files and design docs under `.claude/design/effected/`. Read the target package's own `CLAUDE.md` before touching its source. Those files override anything here.

## The rule that matters most

**A performance change is a claim. Ship the evidence with it, or do not ship it.**

The characteristic failure of this job is a change that reads as an optimization and does nothing. The canonical example is real and easy to write: replacing a sequential loop with `Effect.all` over an array of effects. It looks parallel, reviews as parallel, and runs strictly sequentially, because `Effect.all` defaults to `concurrency: 1`. Nothing about the diff reveals it. Only checking the API's actual behavior, or observing the work overlap, does.

Every phase below exists to catch that class of mistake before it becomes a pull request.

## Phase 1 — survey for candidates

Find ten. Look for these shapes, roughly in descending order of how often they turn out to be real.

### 1. Serialized independent IO

The highest-value class. `Effect.all` and `Effect.forEach` **run sequentially unless given a `concurrency` option**. Confirm it in the installed source rather than taking this on faith:

```bash
E=$(dirname "$(node -e 'console.log(require.resolve("effect/package.json",{paths:["./packages/github-actions"]}))')")
grep -n "concurrency ?? 1" "$E/src/internal/effect.ts"
grep -n "export type Concurrency" "$E/src/Types.ts"     # number | "unbounded"
grep -n "export const forEach" -A 12 "$E/src/Effect.ts" # also documents { discard }
```

Look for loops over independent filesystem reads, network calls or subprocess runs — likely in `workspaces`, `github`, `github-actions`, `git`, `runtimes`, `npm`, `commands`. A `for` loop with a `yield*` IO call in its body, or an `Effect.all` / `Effect.forEach` with no options argument, are both candidates.

Prefer a **bounded** number to `"unbounded"`. Unbounded fan-out over caller-controlled input — a glob match set, a workspace's package list — exhausts file descriptors or trips API rate limits. Match the width already used nearby: `8` in `github-actions` (`ActionCache.ts`, `Artifact.ts`), `10` in `workspaces` (`WorkspaceDiscovery.ts`, `LockfileReader.ts`). `"unbounded"` is defensible only for a small, fixed, statically known set — `git/src/internal/run.ts` collects exactly three effects and says so in a comment.

### 2. Algorithmic complexity in the pure packages

The safest and most measurable wins, because there is no IO noise: `yaml`, `markdown`, `toml`, `jsonc`, `glob`, `semver`, `spdx`, `lockfiles`. These parse and scan potentially large documents, so complexity bugs have teeth:

- String accumulation with `+=` in a scanner loop — quadratic on large input.
- `Array.includes` / `indexOf` / `find` inside a loop over a large array, where a `Set` or `Map` built once is constant-time.
- Re-slicing or re-scanning the source per token or per node instead of carrying an index.
- Building an intermediate array that is immediately reduced or discarded.
- A `RegExp` constructed inside a hot loop rather than hoisted to module scope.
- A `sort` inside a loop over data that is already sorted.

### 3. Repeated identical work

- The same file read, or the same directory walked, more than once in one operation.
- A `Layer` constructed **inside a function body**. Layer memoization is by reference, so a fresh `Layer` per call defeats it and rebuilds the whole dependency subgraph every time. Hoist it to a module-level `const`.
- Expensive idempotent work within a scope that could go through `Effect.cachedFunction`.

Caching is a candidate only when the cached value cannot go stale in a way a caller could observe. If it can, this is a semantics change wearing a performance costume — reject it.

### 4. Materializing what could be short-circuited

- Reading or decoding a whole file to answer a question about its first bytes.
- Building a full array only to check its length or first element.
- `Effect.forEach` whose results are discarded — pass `{ discard: true }` and skip building the array.

### 5. Bundle reachability

`packages/github-actions` confines heavy dependencies (`@azure/storage-blob`, `@effected/markdown`, `@effected/npm`) to named modules and proves it in `__test__/reachability.test.ts`. Read that package's `CLAUDE.md` section on bundle reachability before proposing anything there. A change that adds an import edge from a light module to a heavy one is a **regression**, however much faster it makes something.

### Disqualified — do not open a pull request for these

- **Anything you cannot measure.** A change that reads as an obvious win can measure inside the noise. See Phase 3.
- **Anything touching a documented compatibility guarantee.** Several packages pin byte-level behavior — a cache key that must match another tool's digest, a format package that deliberately parses a newer grammar than it emits, a parser that guarantees comment fidelity. These are stated in the package `CLAUDE.md` files. Read them before assuming a faster path is equivalent.
- **Replacing a from-scratch engine with a dependency.** The format packages own their engines by policy.
- **Adding a runtime dependency**, or promoting one out of `devDependencies`.
- **Refactors, renames or reformatting** presented as performance work.
- **Micro-optimizations in cold paths** — startup-only code, error construction, anything that runs once.

## Phase 2 — rank and pick one

Score each candidate on impact (how much work disappears, at input sizes that actually occur) against effort (lines touched, blast radius, how hard the win is to prove). Take the best ratio **among candidates you can prove**. A large win you cannot demonstrate loses to a modest one you can.

Record all ten in the pull request description, briefly, so the other nine are not lost. One change per pull request regardless of how many you found.

## Phase 3 — prove it before you write it

Three rungs of evidence. Do not skip one because the change looks obvious.

### Rung 1: prove the API behaves as you think

Cite installed source with `file:line`. Use `node_modules` — the vendored `.repos/effect` checkout is a git submodule and is empty in a fresh clone:

```bash
E=$(dirname "$(node -e 'console.log(require.resolve("effect/package.json",{paths:["./packages/<pkg>"]}))')")
# $E/src is the complete Effect v4 source for the exact pinned version.
```

Quote the line that settles the question. "The documentation says" is not evidence; the pinned source is. Never write to anything under `.repos/`.

### Rung 2: measure it

For CPU-bound changes, benchmark and report real numbers. **A naive benchmark lies.** The first path you time absorbs JIT warmup and looks slower than it is — which can invert the result and tell you an improvement is a regression. Warm both paths before timing either, alternate them, and take the best of several samples:

```ts
const time = (f: () => void) => { const t = performance.now(); f(); return performance.now() - t; };
for (let i = 0; i < 5; i++) { before(); after(); }        // warm both before timing either
let b = Infinity, a = Infinity;
for (let i = 0; i < 5; i++) { b = Math.min(b, time(before)); a = Math.min(a, time(after)); }
```

Source reading tells you the shape of a cost; only a measurement tells you its size. A change that the source implies should be a clear win routinely measures at a few percent — inside the noise, and not worth a pull request.

Report the input size, the method, µs/op and the ratio, and note that the runner is shared and noisy. **If the honest answer is "within noise", the candidate is disqualified.** Say so and move to the next one.

Wall-clock on CI is too noisy to prove an IO change. Measure what you actually changed instead: the number of round trips, or the observed overlap.

### Rung 3: pin it with a test, or state plainly that you cannot

If the improvement is **observable** — concurrency, a reduced call count, an avoided read — write a test that fails without it.

The test must **discriminate**: it must fail when the optimization is removed, and fail *for the right reason*. Verify that rather than assuming it:

1. Capture a baseline of the working tree: `git status --porcelain > /tmp/baseline`.
2. Write the test; confirm it passes with your change.
3. Remove only the optimization **with the editor**. Never use `git checkout`, `git restore` or `git stash` — other uncommitted work may live in the tree.
4. Run the test and **read the failure text**. It must name the property you expected to break. An empty output or a missing pass line is not proof the test caught anything; it usually means a filter dropped the failure.
5. Restore the change and confirm `git status --porcelain` matches the baseline, not that it is empty.

Report the failure message in the pull request. "The test passes" is not the claim; "removing the optimization makes this test fail with `<assertion text>`" is.

If the improvement is **semantics-preserving and unobservable** — the same output by a cheaper route, such as a hoisted regex or a `Set` replacing a linear scan — then no test can pin it, and inventing one that passes either way is worse than none. Say so explicitly in the pull request, and lean on the Rung 2 measurement. Do not manufacture a test to satisfy a checklist.

Tests live in each package's `__test__/`, never beside the source. Use `@effect/vitest` and assert with `assert.*`, **never `expect`**. A test needing a `FileSystem` uses `@effected/memfs` rather than a hand-rolled double.

Two cautions specific to testing concurrency here:

- **`it.effect` always installs a virtual `TestClock`.** It is not opt-in. An in-program `Effect.timeout` therefore never fires on its own, so a test that gates on a latch only a concurrent run can open will *hang* to vitest's timeout in the sequential case instead of failing on an assertion. Prefer a non-blocking observation — count operations in flight, yield with `Effect.yieldNow`, assert the maximum exceeded one — so both branches terminate. Reach for `it.live` if the code under test performs real async IO.
- **Assert the output too.** Concurrency that reorders a result is a bug, not a speedup.

## Phase 4 — implement

Keep the diff minimal and inside one package. One logical change per branch.

Comment the load-bearing part. A bare `{ concurrency: 8 }` reads as a tuning knob that a future reader may "simplify" away; a line noting that the default is `1`, and that this option is what makes the function concurrent at all, survives. Match the surrounding comment density — this repository comments reasoning, not mechanics.

## Phase 5 — verify

From the repository root:

```bash
pnpm exec vitest run packages/<pkg> --coverage.enabled=false
pnpm turbo run types:check --filter @effected/<pkg>
pnpm lint
pnpm lint:md
```

Notes that will otherwise cost a cycle:

- A scoped test run **fails the repo-wide coverage thresholds by design**. Pass `--coverage.enabled=false`, and read the Tests line rather than the exit code.
- Never invoke `biome` or `markdownlint-cli2` directly; use the `pnpm` scripts. Passing explicit paths to markdownlint widens the run instead of narrowing it.
- Never run `savvy.build.ts` with a production target directly. Build through `pnpm build --filter @effected/<pkg>`.
- Do not hand-format. The pre-commit hook runs Biome over staged files and re-stages the result. It also strips the executable bit from `.sh` files, which is deliberate.

## Phase 6 — open the pull request

Branch from an up-to-date `main`; never push to `main`.

The body is ordinary markdown — headings, bullets, tables and code fences are all fine. Two rules apply: never cite `.claude/plans/`, `.claude/design/` or any internal design-doc path, since this repository is public and those paths are not readable by most people who will see the pull request; and link issues with a bare `Closes #N` on its own line, outside every fence, because a reference inside a fenced block is inert.

You are opening an ordinary feature pull request, which has **no managed region**. The `<!-- silk-release:start -->` markers belong to release pull requests, which the release action regenerates on every push — do not synthesize them.

Structure the description as:

- **What and why** — the shape of the inefficiency, in two or three sentences. A reviewer should be able to stop here and know whether they care.
- **Evidence** — the source citation with `file:line`, the benchmark method and numbers with input size, and either the failure text from removing the optimization or a plain statement that the change is semantics-preserving and cannot be pinned.
- **What did not change** — the output, the public API, any compatibility guarantee the package documents.
- **Verification** — the commands you ran and what they returned, not "all tests pass".
- **Candidates considered** — the other nine, one line each.

Do not recap the diff file by file; GitHub renders it already.

## Landing nothing is a valid outcome

It is better than landing a no-op. If every candidate was disqualified, or the best one measured inside the noise, open no pull request. Report what you surveyed, what you rejected and why.
