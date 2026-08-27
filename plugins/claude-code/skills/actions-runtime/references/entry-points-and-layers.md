# Entry points and layer composition

The full contract behind `Action.run`, the `ActionServices` union it runs
against, how `ActionRuntime.layer` builds that union, and the shape every
`pre`/`main`/`post` script follows.

## `Action.run`

```ts
import { Action, ActionCache } from "@effected/github-actions";

await Action.run(program, { layer: ActionCache.layer });
```

`Action.run<E, R = never>(program: Effect.Effect<void, E, ActionServices | R>, options: ActionRunOptions<R> = {})`
composes the runtime, runs `program` to `Effect.exit`, and:

- **Never rejects.** The returned `Promise<void>` always resolves. A
  rejecting entry point would produce a failed step *and* an unhandled
  rejection, and only the first is legible in a workflow log.
- **Sets `process.exitCode = 1` on any failure** — typed or a defect — which
  is the one piece `ActionOutputs.setFailed` deliberately leaves alone, so an
  action that reports a failure and then recovers is not doomed by a side
  effect it cannot undo.
- **Does not wrap `program` in a log buffer.** A buffer wrapped around the
  whole program risks an unhandled defect inside it swallowing the entire
  transcript — the run fails and prints nothing. `ActionLogger.withBuffer` is
  opt-in and flushes on every exit path including a defect, precisely to
  avoid that failure mode; see `actions-reporting`.
- **Renders one `::error::` line and a last-resort catch around the whole
  runtime.** See `references/failure-rendering.md` for the full rendering
  contract — this is the one canonical place it's documented.

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

Spelled out rather than inferred, on purpose: a program written against
`ActionServices` is a program `Action.run` can run, and the compiler says so
before the runner does. `NodeServices` carries
`ChildProcessSpawner | Crypto | FileSystem | Path | Stdio | Terminal` — so
any of those six resolve for free inside `ActionServices`, with no separate
`@effect/platform-node` mention at the call site.

**Not in the union:** `ActionCache`, `Artifact`, `GitHubCacheBlobStore` — see
"`ActionCache`, `Artifact` and `BlobStore`: one line, not a default" below.

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

It is a class field holding one layer value, not a `static layer()`
function — a layer-returning function mints a fresh reference per call, and
layers memoize by reference, so a factory here would rebuild the environment
snapshot at every composition site (`effect-v4-services-layers`'s
memoization section is the general form of this rule). A test pins it:
`ActionRuntime.layer === ActionRuntime.layer`.

### The `provideMerge` chain is load-bearing, not stylistic

Each layer in the chain requires the one below it:

| Layer | Requires (its own `R`) |
| --- | --- |
| `ActionEnvironment.layer` | `FileSystem` |
| `ActionOutputs.layer` | `ActionEnvironment \| FileSystem` |
| `ActionState.layer` | `ActionEnvironment \| FileSystem \| ActionOutputs` |
| `ActionLogger.layer` | `ActionEnvironment` |

`ActionState` needs `ActionOutputs` because it masks a value with
`setSecret` before it persists it; `ActionOutputs` needs `ActionEnvironment`
for the same reason `ActionEnvironment.payload`/`.repo` resolve `FileSystem`
once at construction rather than per call. `Layer.provideMerge`, not a flat
`Layer.mergeAll`, is what feeds each dependency down the chain and keeps its
output visible to what needs it — merged as siblings, `ActionState` and
`ActionOutputs` would never see each other and the layer would not build.

**The webhook event payload is `ActionEnvironment.payload`** —
`Effect<unknown, ActionEnvironmentError>`, reading the file
`GITHUB_EVENT_PATH` names and parsing its JSON, with an unreadable file or
invalid JSON failing typed (`reason: "malformed"`, naming the variable). Its
`R` is `never` because the layer resolved `FileSystem` at construction.
Decode the `unknown` through your own `Schema` for the event a program
handles; do not hand-roll `JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH))`
anywhere in a program — a routing gap here has produced duplicate readers of
the same file before.

`ActionEnvironment`'s own snapshot is built from two shapes internally —
`RunnerContext` (the runner-published variables it reads at construction)
and `GitHubContext` (the decoded webhook context those variables imply) —
with a fiber-local `withEnv` override for tests that need to run a program
against a specific, non-ambient environment without mutating
`process.env`. A program rarely constructs either shape directly; see
`testing-actions` for the override pattern in practice.

### The config provider the runtime installs — and the one it still does not

Two different providers, two different fates; conflating them re-ships a bug
in one direction or the other.

**Installed: `ActionInput.layerDefault`.** A bare `Config` read that side-steps
`ActionInput`'s accessors risks falling back to its `withDefault`, because
the runner publishes `INPUT_<MANGLED>` and a plain-named lookup finds
nothing on its own. The installed provider (`ActionInput.providerOver` over
the ambient lookup) resolves a **flat, single-segment** name by trying its
`INPUT_` derivation first, then the name unchanged; nested and numeric paths
pass through untouched. Pinned consequences: an input **shadows** an env var
of the same bare name in any casing of the read; an unsupplied input (`""`)
does not shadow; a caller-supplied `ConfigProvider` in the `layer` option
wins (the extra layer's context merges last); and `ActionInput.*` accessors
are untouched — their `INPUT_` names re-mangle to `INPUT_INPUT_…`, never
match, and fall through to the ambient lookup they always used.

**Still not installed: `ActionInput.layer()`**, the record-backed test
double. It mangles *every* config path (join with `_`, uppercase), silently
changing the resolution of any `Config` a program wrote that is not an
input. It stays exported for what it was built for: resolving inputs from an
explicit record in a test, without mutating `process.env`.

The ambient half of `layerDefault` is the provider explicitly installed when
the layer builds, and otherwise a **fresh** `ConfigProvider.fromEnv()`,
because v4 caches the reference's default once per process and a stale
snapshot would resurrect the missed-input class this provider exists to
close.

## `ActionRunOptions.layer` may require anything the runtime provides

```ts
export interface ActionRunOptions<R> {
  readonly layer?: Layer.Layer<R, never, ActionServices> | undefined;
}
```

The third type parameter is `ActionServices`, not `never`. A layer that
needs both `FileSystem` (the platform) and `ActionOutputs` (to mask a value
before publishing it, say) does not need a private, self-contained
`NodeServices`-backed sub-provide of its own — its requirements travel up to
`Action.run`'s boundary and resolve against what `ActionRuntime.layer`
already provides:

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

A consumer never mentions the platform at all. `Action.run` provides
`ActionRuntime.layer` once, at the boundary, and every requirement the extra
layer names against `ActionServices` — the platform, the HTTP client, every
runner service — is already satisfied there. This is the type argument that
decides how wide a program's `R` channel is allowed to be
(`effect-v4-services-layers`'s composition-operators section is the general
form). A regression test pins exactly this shape: a layer requiring both
`FileSystem` and `ActionOutputs`, handed to `Action.run` with no
sub-provide, still lets a masked value reach the runner. Its discriminating
mutant is type-level: narrowing `ActionRunOptions`'s third parameter back to
`never` fails compilation, not an assertion.

### The `E = never` constraint that survives

`ActionRunOptions.layer` fixes `E` at `never` — the extra layer's *own*
construction cannot fail. Two layers in this package legitimately can:

- `GitHubToken.clientLayer(options?)` — `Layer<GitHubClient, ActionStateError | GitHubTokenError, ActionState>`.
- `Repo.layerFromConfig(options?)` — `Layer<Repo, Config.ConfigError | InvalidRepoRefError>`.

Both need `Layer.orDie` (or explicit handling) before they can be passed to
`Action.run`'s `layer` option, exactly as in the snippet above. **A missing
token or misconfigured repo is fatal at boot** — a deliberate choice, not an
oversight. A consumer that would rather report an expiry than crash the
process has the typed error to catch instead: `GitHubToken.read`'s
`GitHubTokenError { reason: "expired" }` exists for exactly that case, and
reading it does not require going through `clientLayer` at all.

## `ActionCache`, `Artifact` and `BlobStore`: one line, not a default

`ActionRuntime.layer` deliberately excludes `ActionCache`, `Artifact` and
`GitHubCacheBlobStore` — the only three modules that import
`@azure/storage-blob`. Folding them in would put a blob-storage client in the
bundle of every action that merely sets an output. Their requirements are
already satisfied by the runtime — `ActionCache.layer`'s `R` is
`ActionEnvironment | HttpClient | FileSystem | Path | ChildProcessSpawner`,
and every one of those five is either in `ActionServices` directly or inside
`NodeServices` — so taking one costs exactly one line:

```ts
await Action.run(program, { layer: ActionCache.layer });
```

For the protocol these three modules speak, the transport seam, and the
Azure-confinement rule that keeps a shared internal helper from leaking the
dependency, see `actions-cache-and-artifacts` — this reference stops at
"it's one line," that skill covers the rest.

## The `pre` / `main` / `post` entry shapes

There is no `Action.pre` / `Action.main` / `Action.post` — one `Action.run`
call per script, because GitHub runs the three phases as **three separate
processes** with nothing surviving between them except `GITHUB_STATE`:

- **`pre.ts`** provisions what later phases need and persists it —
  `GitHubToken.provision(options)` mints a token, masks it, and saves it —
  then calls `Action.run(preProgram, { layer })`.
- **`main.ts`** reads what `pre` persisted — `GitHubToken.clientLayer()`
  builds a `GitHubClient` from the saved token, failing typed if it has
  expired rather than surfacing an unexplained `401` — then calls
  `Action.run(mainProgram, { layer })` with its own extra layer.
- **`post.ts`** tears down — `GitHubToken.dispose()` revokes the persisted
  token if there is one, as a no-op (not a failure) when `pre` never got as
  far as provisioning — then calls `Action.run(postProgram, { layer })`.

Each script is an independent `Action.run` call against its own program and
its own extra layer; nothing about `ActionRuntime.layer` or `Action.run`
threads state between them — `ActionState`/`GITHUB_STATE` is the only
channel that does. For what each phase's `ActionState` reads and writes, and
for inputs/outputs/secrets generally, see `actions-inputs-outputs`,
`actions-state-and-secrets` and `actions-reporting`. For the App-token
bridge itself — provisioning, scope verification, the one-hour contract,
revocation on failure — see `github-app-tokens`. For testing an action built
on this runtime, see `testing-actions`.
