---
name: actions-runtime
description: Use when writing or reviewing a GitHub Action's pre/main/post entry point on @effected/github-actions — wiring Action.run, ActionRuntime.layer, the ActionServices union, an extra ActionRunOptions.layer, or deciding whether ActionCache/Artifact/GitHubCacheBlobStore belong in the runtime. Trigger phrases include Action.run, ActionRuntime, ActionServices, ActionRunOptions.layer, describeCause, GitHubToken.clientLayer, action entry point, pre/main/post script.
---

# Actions runtime

`Action.run` is the one entry point an action's `pre`, `main` and `post`
scripts call — each its own Node process, since GitHub runs the three phases
as separate processes with nothing surviving between them except what
`GITHUB_STATE` carries (`packages/github-actions/CLAUDE.md`). This skill is
the wiring around that call: what `ActionServices` is, why `ActionRuntime.layer`
is a bound constant, and the one constraint (`ActionRunOptions.layer`'s `E`)
that still costs a caller a line.

For the general Effect v4 service/layer rules this package follows —
`Context.Service`, `provideMerge` vs `mergeAll`, memoization by reference —
see `effect-v4-services-layers`; this skill carries only the
`github-actions`-specific instance of each.

**Program-level config and input reads go through `ActionInput` — the
blessed typed surface.** And since the 2026-07-25 ruling, the runtime also
defends the bare path: `ActionRuntime.layer` installs
`ActionInput.layerDefault`, so under `Action.run` a bare `Config.string(name)`
resolves a flat name through the runner's `INPUT_` derivation first and the
ambient lookup unchanged second — the false-green class (every bare read
falling back to its `withDefault`) is dead at the root, not merely documented.
The accessors stay preferred because they carry the parsing and the typed
`ConfigError`s; the provider only stops a side-step from silently missing.
A suite that **bypasses the runtime** and stubs its own `ConfigProvider`
still resolves plain names only — see `actions-inputs-outputs` for the
mangling rule and `testing-actions` for that trap.

## `Action.run`

```ts
import { Action, ActionCache } from "@effected/github-actions";

await Action.run(program, { layer: ActionCache.layer });
```

`Action.run<E, R = never>(program: Effect.Effect<void, E, ActionServices | R>, options: ActionRunOptions<R> = {})`
(`packages/github-actions/src/Action.ts:191-201`). It composes the runtime,
runs `program` to `Effect.exit`, and:

- **Never rejects.** The returned `Promise<void>` always resolves. A rejecting
  entry point would produce a failed step *and* an unhandled rejection, and
  only the first is legible in a workflow log (`Action.ts:150-160`).
- **Sets `process.exitCode = 1` on any failure** — typed or a defect — which
  is the one piece `ActionOutputs.setFailed` deliberately leaves alone, so an
  action that reports a failure and then recovers is not doomed by a side
  effect it cannot undo (`Action.ts:145-148`, confirmed by
  `ActionOutputs.ts` never touching `exitCode`).
- **Does not wrap `program` in a log buffer.** The predecessor did, and an
  unhandled defect inside the buffer swallowed the whole transcript — the run
  failed and printed nothing (`Action.ts:152-156`). `ActionLogger.withBuffer`
  is opt-in and flushes on every exit path including a defect.
- **Renders one `::error::` line** — `Action failed: [Tag]: message` via
  `describeCause` — and puts the full `Cause.pretty` render behind `::debug::`,
  which the runner shows only when step debugging is on
  (`Action.ts:161-168,206-219`). The predecessor spliced a JS stack into the
  *visible* error, which in a bundled action points at one line of
  `dist/main.js`.
- **Has a last-resort catch** around `Effect.runPromise` itself: if rendering
  the failure fails, `process.exitCode = 1` still gets set (`Action.ts:223-228`).
  A green step for a crashed action is the worst outcome available here.

`Action.test.ts` (`packages/github-actions/__test__/Action.test.ts:87-343`) is
the executable spec for all of this — read it before changing any of the above.

### `describeCause` / `describeError`

```ts
export const describeCause = (cause: Cause.Cause<unknown>): string
```

(`Action.ts:116-127`, exported standalone and as `Action.describeCause`). One
`[Tag]: message` line for a typed failure or a `Cause.pretty` fallback for an
interruption; a defect is prefixed `[defect]` so the two are told apart at a
glance (`Action.ts:121-126`). Reuse it — do not re-derive a failure-rendering
convention per consumer; the audience is a human scanning a workflow log for
the first red line, not a stack trace.

## `ActionServices`: the exact union

```ts
export type ActionServices =
  | ActionEnvironment
  | ActionLogger
  | ActionOutputs
  | ActionState
  | NodeServices.NodeServices
  | HttpClient.HttpClient;
```

(`Action.ts:22-28`). Spelled out rather than inferred, on purpose: a program
written against `ActionServices` is a program `Action.run` can run, and the
compiler says so before the runner does (`Action.ts:15-18`). `NodeServices`
carries `ChildProcessSpawner | Crypto | FileSystem | Path | Stdio | Terminal`
— so any of those six resolve for free inside `ActionServices`, with no
separate `@effect/platform-node` mention at the call site.

Not in the union: `ActionCache`, `Artifact`, `GitHubCacheBlobStore` — see
"one line, not a default" below.

## `ActionRuntime.layer`: a bound constant, never a factory

```ts
static readonly layer: Layer.Layer<ActionServices> = Layer.mergeAll(
  ActionLogger.layer,
  ActionLogger.layerLogger,
  ActionState.layer,
  ActionInput.layerDefault,
).pipe(
  Layer.provideMerge(ActionOutputs.layer),
  Layer.provideMerge(ActionEnvironment.layer),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
);
```

(`Action.ts:59-84`). It is a class field holding one layer value, not a
`static layer()` function — a layer-returning function mints a fresh
reference per call, and layers memoize by reference, so a factory here would
rebuild the environment snapshot at every composition site
(`effect-v4-services-layers`'s memoization section is the general form of
this; `Action.ts:54-58` states the package-specific reason). The test that
pins it: `ActionRuntime.layer === ActionRuntime.layer`
(`Action.test.ts:337-342`).

### The `provideMerge` chain is load-bearing, not stylistic

Each layer in the chain requires the one below it, confirmed against the
service modules themselves:

| Layer | Requires (its own `R`) |
| --- | --- |
| `ActionEnvironment.layer` | `FileSystem` (`ActionEnvironment.ts:298`) |
| `ActionOutputs.layer` | `ActionEnvironment \| FileSystem` (`ActionOutputs.ts:152`) |
| `ActionState.layer` | `ActionEnvironment \| FileSystem \| ActionOutputs` (`ActionState.ts:139`) |
| `ActionLogger.layer` | `ActionEnvironment` (`ActionLogger.ts:258`) |

`ActionState` needs `ActionOutputs` because it masks a value with
`setSecret` before it persists it; `ActionOutputs` needs `ActionEnvironment`
for the same reason `ActionEnvironment.payload`/`.repo` resolve `FileSystem`
once at construction rather than per call.

**The webhook event payload is `ActionEnvironment.payload`** —
`Effect<unknown, ActionEnvironmentError>`, reading the file
`GITHUB_EVENT_PATH` names and parsing its JSON, with an unreadable file or
invalid JSON failing typed (`reason: "malformed"`, naming the variable;
`ActionEnvironment.ts:106-112,217-238`). Its `R` is `never` — the layer
resolved `FileSystem` at construction. Decode the `unknown` through your own
`Schema` for the event you handle; do not hand-roll
`JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH))` — two consumers
did, for lack of a routing row. `Layer.provideMerge`, not a flat
`Layer.mergeAll`, is what feeds each dependency down the chain and keeps its
output visible to what needs it — merged as siblings, `ActionState` and
`ActionOutputs` would never see each other and the layer would not build
(`Action.ts:75-78`).

### The config provider the runtime installs — and the one it still does not

Two different providers, two different fates; conflating them re-ships a bug
in one direction or the other.

**Installed (ruled 2026-07-25): `ActionInput.layerDefault`.** A live action
shipped a false green — every bare `Config` read fell back to its
`withDefault`, because the runner publishes `INPUT_<MANGLED>` and a
plain-named lookup finds nothing. The installed provider
(`ActionInput.providerOver` over the ambient lookup) resolves a **flat,
single-segment** name by trying its `INPUT_` derivation first, then the name
unchanged; nested and numeric paths pass through untouched. The pinned
consequences (`Action.test.ts:194-263`): an input **shadows** an env var of
the same bare name in any casing of the read; an unsupplied input (`""`)
does not shadow; a caller-supplied `ConfigProvider` in the `layer` option
wins (the extra layer's context merges last, `Action.ts:201`); and
`ActionInput.*` accessors are untouched — their `INPUT_` names re-mangle to
`INPUT_INPUT_…`, never match, and fall through to the ambient lookup they
always used.

**Still NOT installed: `ActionInput.layer()`**, the record-backed test
double. The original probe result stands — it mangles *every* config path
(join with `_`, uppercase), silently changing the resolution of any `Config`
a consumer wrote that is not an input. It stays exported for what it was
built for: resolving inputs from an explicit record in a test, without
mutating `process.env`. The installed provider exists precisely because the
ambient default resolves `INPUT_MY-GREETING` and treats `""` as absent on
its own — the end-to-end omitted-input test (`Action.test.ts:176-192`) is
still what fails if core's empty-string semantics ever move.

The ambient half of `layerDefault` is the provider explicitly installed when
the layer builds — how a test injects a deterministic environment beneath
`ActionRuntime.layer` (`Action.test.ts:324-335`) — and otherwise a **fresh**
`ConfigProvider.fromEnv()`, because v4 caches the reference's default once
per process and a stale snapshot would resurrect the missed-input class.

## The headline: `ActionRunOptions.layer` may require anything the runtime provides

```ts
export interface ActionRunOptions<R> {
  readonly layer?: Layer.Layer<R, never, ActionServices> | undefined;
}
```

(`Action.ts:92-101`). The third type parameter is `ActionServices`, not
`never`. That single type argument is the whole of Case 3 in the fluency
audit (`.claude/design/effected/consumers/fluency-audit.md`), and it is worth
carrying the before/after honestly rather than the summary.

**Before** (the predecessor's option was `Layer<R, never, never>` —
self-contained, no exceptions):

```ts
const actionStateLayer = ActionStateLive.pipe(Layer.provide(NodeServices.layer));
const githubClient = GitHubToken.client().pipe(Layer.provide(actionStateLayer), Layer.orDie);
// …
// 2.0: PackagePublishLive.setupAuth masks the registry token via
// ActionOutputs.setSecret, so the layer now requires ActionOutputs.
// Action.run's `layer` option must be self-contained, so provide a
// NodeServices-backed ActionOutputsLive here rather than leaking the
// requirement up to MainLive.
const actionOutputsLive = ActionOutputsLive.pipe(Layer.provide(NodeServices.layer));
const packagePublishLive = PackagePublishLive.pipe(
  Layer.provide(Layer.mergeAll(CommandRunnerLive, npmRegistryLive, actionOutputsLive)),
);
```

Two separate `NodeServices`-backed sub-provides, one of them existing **only**
so a publish helper could reach `setSecret`, plus a five-line comment
explaining why the requirement could not be allowed to travel upward.

**After:**

```ts
const githubClient = GitHubToken.clientLayer().pipe(Layer.orDie);
const npm = Layer.mergeAll(
  NpmRegistry.layer,
  PackagePublish.layer.pipe(Layer.provide(Workspaces.localExecLayer())),
);

await Action.run(main, {
  layer: Layer.mergeAll(githubClient, npm, Repo.layerFromConfig().pipe(Layer.orDie)),
});
```

Both `NodeServices` sub-provides are **deleted, not relocated** — a consumer
never mentions the platform at all. `Action.run` provides `ActionRuntime.layer`
once, at the boundary (`Layer.provide(extra, ActionRuntime.layer)`,
`Action.ts:201`), and every requirement the extra layer names against
`ActionServices` — the platform, the HTTP client, every runner service — is
already satisfied there. This is not a relaxation that happened to help; it
is the type argument that decides how wide a consumer's `R` channel is
allowed to be (`effect-v4-services-layers`'s composition-operators section is
the general form).

`Action.test.ts:279-322` is the regression test on this exact shape — a
layer requiring both `FileSystem` (the platform) and `ActionOutputs` (to
mask), handed to `Action.run` with **no sub-provide**, asserting that
`::add-mask::s3cret` reaches the runner. Its discriminating mutant is
type-level: narrowing `ActionRunOptions`'s third parameter back to `never`
fails compilation, not an assertion — the right shape for a regression whose
original was a type constraint.

## The `E = never` constraint that survives

`ActionRunOptions.layer` fixes `E` at `never` — the extra layer's *own*
construction cannot fail. Two layers in this package legitimately can:

- `GitHubToken.clientLayer(options?)` — `Layer<GitHubClient, ActionStateError | GitHubTokenError, ActionState>`
  (`GitHubToken.ts:288-301`).
- `Repo.layerFromConfig(options?)` — `Layer<Repo, Config.ConfigError | InvalidRepoRefError>`
  (`packages/github/src/Repo.ts:107-113`).

Both need `Layer.orDie` (or explicit handling) before they can be passed to
`Action.run`'s `layer` option, exactly as in the After snippet above. That
`Layer.orDie` **used to be there for the wrong reason** — a wire-failure error
type was the wrong shape for "no token configured" — and it is now a
deliberate choice: **a missing token or misconfigured repo is fatal at boot.**
A consumer that would rather report an expiry than crash the process has the
typed error to catch instead: `GitHubToken.read`'s `GitHubTokenError { reason:
"expired" }` (`GitHubToken.ts:14-27,248-262`) exists for exactly that case,
and reading it does not require going through `clientLayer` at all.

## `ActionCache`, `Artifact` and `BlobStore`: one line, not a default

`ActionRuntime.layer` deliberately excludes `ActionCache`, `Artifact` and
`GitHubCacheBlobStore` — the only three modules that import
`@azure/storage-blob`. Folding them in would put a blob-storage client in the
bundle of every action that merely sets an output (`Action.ts:38-43`). Their
requirements are already satisfied by the runtime — `ActionCache.layer`'s `R`
is `ActionEnvironment | HttpClient | FileSystem | Path | ChildProcessSpawner`
(`ActionCache.ts:369-377`), and every one of those five is either in
`ActionServices` directly or inside `NodeServices` — so taking one costs
exactly the line at the top of this skill:

```ts
await Action.run(program, { layer: ActionCache.layer });
```

For the protocol these three modules speak, the transport seam
(`FileBlobTransfer`/`DataBlobTransfer`), and the Azure-confinement rule that
keeps a shared `internal/` helper from leaking the dependency, see
`actions-cache-and-artifacts` (authored alongside this skill) — this skill
stops at "it's one line," that one covers the rest.

## The `pre` / `main` / `post` entry shapes

There is no `Action.pre` / `Action.main` / `Action.post` — one `Action.run`
call per script, because GitHub runs the three phases as **three separate
processes** with nothing surviving between them except `GITHUB_STATE`
(`packages/github-actions/CLAUDE.md`, `GitHubToken.ts:140-142`). The shape
that follows from that:

- **`pre.ts`** provisions what later phases need and persists it —
  `GitHubToken.provision(options)` mints a token, masks it, and saves it
  (`GitHubToken.ts:206-237`) — then calls `Action.run(preProgram, { layer })`.
- **`main.ts`** reads what `pre` persisted — `GitHubToken.clientLayer()` builds
  a `GitHubClient` from the saved token, failing typed if it has expired
  rather than surfacing an unexplained `401` (`GitHubToken.ts:239-262,288-301`)
  — and calls `Action.run(mainProgram, { layer })` with its own extra layer.
- **`post.ts`** tears down — `GitHubToken.dispose()` revokes the persisted
  token if there is one, as a no-op (not a failure) when `pre` never got as
  far as provisioning (`GitHubToken.ts:303-329`) — and calls
  `Action.run(postProgram, { layer })`.

Each script is an independent `Action.run` call against its own program and
its own extra layer; nothing about `ActionRuntime.layer` or `Action.run`
threads state between them; `ActionState`/`GITHUB_STATE` is the only channel
that does. For what each phase's `ActionState` reads and writes, and for
inputs/outputs/secrets generally, see `actions-inputs-outputs`,
`actions-state-and-secrets` and `actions-reporting` (authored alongside this
skill) — this skill stops at the entry-point shape.

For the App-token bridge itself — provisioning, scope verification, the
one-hour contract, revocation on failure — see `github-app-tokens`. For
testing an action built on this runtime — `layerTest` doubles, the two-latch
interleaving rule, `unhandledErrors` — see `testing-actions`.
