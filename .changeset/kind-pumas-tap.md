---
"@effected/app": patch
---

## Documentation

Skill improvements in the effected plugin, drawn from dogfood findings on real ports and adoptions.

### effect-v4-testing

- Documented the inverse of the banned `runPromise` shape: a plain `it()` that *returns* an Effect never runs and reports green having evaluated zero assertions. Only the laundering form looks wrong, which is why this one survives review. Added to the skill's rules and to `references/false-greens.md` with the account of how a vacuous test came to be cited as proof to a downstream consumer.

### designing-an-action

- Added six entries to the legacy-toolkit symbol map: `getSha` → `GitBranch.sha`, `commitFiles`, `getOrCreate` → `upsert` + `setAutoMerge`, `client.repo` → `yield* Repo`, the four legacy error types → one `GitHubError` routed on `kind`, and the three legacy layers → `GitHubApp.layer`.
- Called out `commitFiles` as a reshape rather than a rename — a single options object whose `changes` are `FileContent`/`FileDeletion` class instances — since a mechanical sweep of the table produces code that looks right and is wrong.
- Documented why the `getOrCreate` split is deliberate: the two calls have different error channels, which is what lets an auto-merge failure not fail PR creation.
- Added a "porting an existing action" section to the walking skeleton, which previously assumed greenfield. Stub only the files importing the legacy package, move their tests to `it.todo`, and keep the suite green at every intermediate commit. Draws the distinction between a failing stub, which is a bug, and a failing test *of* a stub, which is expected.

### testing-actions

- Added the doubles-before-runner migration ordering, with the reason stated: converting the runner installs a `TestClock` at the epoch across every test at once, so a live `Effect.sleep` in `src` stops advancing and hangs to the timeout naming nothing. The existing passing suite is the characterization gate for the port, and a gate rewritten alongside what it gates is not a gate.

### effected-packages

- Added `references/markdown.md`, covering the authoring surface that three independent readers have concluded did not exist: the 28 constructible node classes, `Markdown.stringify`, the frontmatter reason/`hasFrontmatterBlock` pair, and `codeBlockStyle`.
- Corrected the reference-file inventory, which listed `schemastore` and `markdown` as missing when the first already existed, and the Actions suite's skill count.

### effect-v4-house-style

- Generalized the `GitBranch.upsert` documentation pattern into a house rule for any API whose misuse is silent: spell out the wrong call sequence literally, state what it cost, and name the consumer that hit it. The test for whether an API qualifies is whether the wrong call would go green.

### actions-state-and-secrets

- Documented that a `Schema.Redacted` field persisted as JSON round-trips to the literal string `<redacted>`, with the probed distinction that `Schema.RedactedFromValue` encodes the real value and takes `disallowEncode` to fail loudly instead.
