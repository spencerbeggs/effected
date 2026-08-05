# Porting off `@savvy-web/github-action-effects`

A symbol-keyed lookup for an action moving from the legacy `@savvy-web/github-action-effects` toolkit onto the `@effected` suite. Grep the legacy column for what the code you are porting says today; the kit column is what replaces it.

Companion to [`porting.md`](./porting.md), which owns the *process* — freezing a parity contract, the known-unknowns ledger, the legacy-as-oracle rule. This file owns the mechanical half: which symbol became which. A port that changes every import and no pipeline step is mostly this table plus a test-double migration.

The kit column is verified against the packages in this repo. The legacy column is reconstructed from a real port and is the less reliable half — if a legacy symbol is not here, it is not evidence the kit lacks a replacement. Check [`building-a-github-action`](../../building-a-github-action/SKILL.md) before concluding anything is missing.

## The map

| `@savvy-web/github-action-effects` | `@effected/*` | Notes |
| --- | --- | --- |
| `Step.groupStep(name, effect)` | `ActionLogger.group` + `ActionLogger.withStep` | `withStep` is the summary-line half: quiet on success bar one line, `❌ <name>` plus the transcript on failure. `withBuffer({ onSuccess: "discard" })` is *not* the equivalent — it leaves a green step with zero lines. |
| `GithubMarkdown` | `GitHubMarkdown` | Capital H. Same surface: `table`, `tableFor(schema)`, `heading`, `link`, `code`, `codeBlock`, `list`, `details`, `raw`. |
| `GitHubClientLive.fromEnv()` | `GitHubClient.layerFromConfig({ name: "token" })` | Fails with core's `Config.ConfigError` — an honest "no token configured" — where the legacy layer failed with a wire-failure type. **Keep the `Layer.orDie`**: `ActionRunOptions.layer` is `Layer.Layer<R, never, ActionServices>`, so a layer handed to `Action.run` must discharge its error channel and removing the wrapper does not compile. What goes away is the comment above it — the wrapper no longer needs five lines explaining that the error does not mean what it says. Same for `Repo.layerFromConfig()`. |
| `<Service>Test`, the `/testing` subpath | `Service.makeTest(overrides?)` / `Service.layerTest(overrides?)` | No `./testing` subpath exists; the doubles live on the service. Unstubbed members **die naming themselves**, with three documented exceptions (`ActionEnvironment`, `ActionLogger`, `DryRun`). |
| `MainLive` / `PreLive` / `PostLive` hand-composition | `ActionRuntime.layer`, or `Action.run(program, { layer })` | Bound constants, never factories — layers memoize by reference. An extra layer passed to `Action.run` may require anything the runtime provides. |
| `gh.rest("…", octokit => …)` | the named resource method | e.g. `PullRequest.listAssociatedWithCommit`. The route is the key: typed params, typed response, zero casts, pagination included. |
| `Config.string("x")` | `ActionInput.string("x")` | The accessor owns the `INPUT_` derivation. Never spell a runner variable; if a test truly must, derive it with `ActionInput.variable`. |
| `getSha(name)` | `GitBranch.sha(name)` | Plain rename. `GitBranch.shaOption` is the `Option`-returning form when absence is not an error. |
| `commitFiles(branch, message, [{ path, content }])` | `GitCommit.commitFiles({ branch, message, changes })` | **A reshape, not a rename — see below.** |
| `getOrCreate({ …, autoMerge })` | `PullRequest.upsert` **+** `PullRequest.setAutoMerge` | **Splits into two calls with different error channels — see below.** |
| `client.repo` | `yield* Repo` | Not a property access. `Repo` is a `Context.Service`, and it is in the `R` of every resource method (`Effect.Effect<A, GitHubError, Repo>`), so it is provided once at the boundary rather than threaded as a receiver. |
| `GitHubNotFoundError`, `GitHubRateLimitError`, `GitHubAuthError`, … | one `GitHubError` | Routing moves from the type to the **`kind`** field, so `catchTag`-per-error becomes one handler switching on `kind`. `setAutoMerge` is the exception that proves it: it fails with `GitHubGraphQLError`, because it is the one GraphQL mutation on the surface. |
| `GitHubClientLive` + `RepoLive` + the app-auth layer | `GitHubApp.layer` | Subsumes all three. `GitHubApp.layerWith(options)` when the defaults do not fit; `GitHubApp.layerTest(overrides?)` in tests. |

## Five that are not renames

Straight substitution through the table leaves these wrong, and each cost a real port something.

**`commitFiles` changed shape.** Legacy took three positional arguments with plain-object file entries; the kit takes a **single options object** whose `changes` are `FileContent` / `FileDeletion` **class instances**, not object literals:

```ts
// legacy
commitFiles(branch, message, [{ path: "a.json", content: text }]);

// kit
GitCommit.commitFiles({
  branch,
  message,
  changes: [new FileContent({ path: "a.json", content: text })],
});
```

An agent sweeping the table mechanically produces the positional call, or passes literals where instances are required. This is the one entry whose miss is a *silent miscompile* shape rather than a lookup failure — the deletion half (`FileDeletion`) has no legacy counterpart at all, so a port that only translates what it sees never discovers it.

**`getOrCreate({ autoMerge })` splits, and the split is the point.** `PullRequest.upsert` opens or updates; `PullRequest.setAutoMerge` is a separate explicit call. Keeping them separate is deliberate: the legacy surface fired auto-merge from an `Effect.tap` *after* the create succeeded, so a create that worked surfaced an auto-merge failure as if the create had failed. The two now have different error channels — `upsert` fails with `GitHubError`, `setAutoMerge` with `GitHubGraphQLError` — which is what lets a caller let an auto-merge failure not fail PR creation. Collapsing them back into one helper for "parity" reintroduces the bug.

**The per-step summary line.** `withStep` did not exist when the first port ran, and its shape was independently derived wrong three times — twice by agents, once by a human — because `group` + `withBuffer` looks like complete parity. If the code you are porting predates `withStep`, it may contain a hand-rolled approximation missing the success line; replace it with `withStep` rather than porting it.

**Test-environment injection.** A legacy suite injecting a deterministic environment with `ConfigProvider.fromEnv({ env })` must move to `ActionInput.provider(env)`. `fromEnv` uppercases the config path, so an input-name key never matches and every read falls through to its default — **green, in test code**, with the test's name claiming it proved the input was read. One port shipped this in its integration harness for several commits. See `ActionInput.provider`'s docstring for the full account.

**Optional inputs whose empty value means something.** `Config.withDefault` classifies an explicitly-empty input as missing and substitutes the default, so an input documented as "set it empty to disable this" cannot work that way. `Config.option` distinguishes the states, and its correctness depends on `action.yml` declaring a non-empty default. See `ActionInput.string`'s docstring.

## Sequence

The table is not the plan. `porting.md`'s process still applies in full — in particular the frozen parity contract, which on one port caught that the action had four inputs where three separate sources claimed five. What an import-only port can compress is the design exploration, not the verification:

1. Freeze the parity contract from `action.yml` (`porting.md`).
2. Preserve a copy of the legacy implementation as an oracle — it must stay readable for the whole port while being excluded from lint, typecheck and bundling. Never import it. (Copy it; do not reach for `git stash`, which this repo forbids for exactly the reason it sounds like the right tool here.)
3. Sweep the table over every import, and resolve anything it does not cover through the router.
4. Migrate the test doubles **before** converting the test harness (`porting.md`).
5. Fill in step by step against the oracle, mutating the edges before declaring green.
