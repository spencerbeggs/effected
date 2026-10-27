---
type: Module
title: "@effected/engine"
description: The platform-free primitives a carrier-pattern tool's own engine package shares across its front ends — distribution stamping, remediation shape, launch-context resolution, a one-permit lane for process-global work with scoped restores, and transport-neutral crash guards.
status: stable
kind: package
resource: ../../packages/engine
layer: pure
tags: [architecture, bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T14:19:29Z
integrity:
  generated:
    body: 7dfbf3ad0968e579
---

# @effected/engine

`@effected/engine` is where the primitives every front end of a
carrier-pattern tool shares live, once, fixed. A consumer such as okfit or
vitest-agent ships its own `engine` package that composes its `core` and
its vocabulary into shared programs; this kit package sits *below* that
consumer engine, not beside it — the consumer's engine is the thing that
**stamps `distribution` into envelopes**, and stamping requires reading
`CurrentDistribution`, so the primitive that carries it has to live
somewhere a consumer's engine can depend on without also depending on a
front end.

That is the whole reason this package exists rather than living inside
`@effected/cli` or a future `@effected/mcp`: **a consumer's engine may not
import `@effected/cli`**, whose own rule is that only applications depend
on it (see [`cli.md`](cli.md)). If `Distribution` lived in `cli`, every
consumer engine that wanted to stamp its own distribution would have to
take a `cli` dependency it structurally cannot carry. Putting `Distribution`,
`Remediation` and `LaunchContext` in a package whose only kit dependents
are the two front ends, `@effected/mcp` and `@effected/cli`, breaks that
knot. See
[D1](../decisions/engine-holds-cross-front-end-primitives.md) for the full
reasoning and the rejected alternatives.

## Public surface

One module per concept, static classes with a private constructor where a
concept groups more than one operation — never an `as const` namespace
object, which loses TSDoc on its members in the built `.d.ts`.

| Export | Kind | Contract |
| --- | --- | --- |
| `Distribution` | `Schema.Struct` and type | `{ name: string; version: string }` — the carrier package a bin was installed through. |
| `DistributionField` | schema | `Schema.NullOr(Distribution)`, for envelopes. `null` means installed directly, not "not yet known." |
| `CurrentDistribution` | `Context.Reference<Option<Distribution>>` | `defaultValue: () => Option.none()`. A front end's `main` provides it once. A `Reference`, not a `Service`, so reading it adds nothing to `R`. |
| `distributionSuffix(d)` | free function | `(d: Option<Distribution>) => string`, giving `" via <name> <version>"` or `""`. A free function, not `Distribution.suffix` — a `Schema.Struct` value carries no statics to hang it from. |
| `withDistribution(d)` | free function | `(d: Distribution \| null \| undefined) => <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, R>`. Provides `CurrentDistribution` to `self`: `Option.some` of a carrier, `Option.none()` for `null` or `undefined`. The one-line form of what a front end's `main` does once; data-last. |
| `withDistributionVersion(d)` | free function | `(d: Option<Distribution>) => (formatVersion: (name, version) => string) => (name, version) => string`. Decorates a `--version` formatter shaped like `effect/cli`'s `CliOutput.Formatter["formatVersion"]`, appending `distributionSuffix(d)`. It **wraps** whatever formatter is in effect (a coloured default, a custom one) rather than replacing it; the suffix is computed once, when applied. `CliRuntime.main`'s `distribution` option is built on it. |
| `Remediation` | `Schema.Struct` and type | `{ hint: string; suggestedTool?: string; suggestedArgs?: Record<string, unknown> }`. The shape okfit and Silk both already use, plus vitest-agent's `suggestedArgs`; vitest-agent's `humanHint` maps onto `hint`. |
| `LaunchContext.usable(value)` | static function | `(value: string \| undefined) => Option<string>`: the value trimmed, or `None` for `undefined`, an empty or whitespace-only string, or a string still carrying a literal `${VAR}`. The one guard every resolver applies; `??` would accept an empty string or a placeholder. |
| `LaunchContext.resolve(input)` | static function | `({ argv?, env, keys }) => Option<string>`: the first usable `argv` value, then the first usable env value in `keys` order. For any launch-supplied location (a host's plugin data directory, an app override) with the caller's own fallback after it. `argv` must be parsed positionals, never raw `process.argv`: every non-empty value is a candidate. |
| `LaunchContext.projectDir(input)` | static function | `({ argv?, env, keys, cwd }): string`: `resolve` with `cwd` as the fallback. Values are trimmed. Pure — `env` and `cwd` are passed in, never read from `process`. |
| `LaunchContext.isUnsubstituted(value)` | static function | `(value: string): boolean`. Detects a literal `${VAR}` that a host such as Claude Code left unsubstituted: a `${` with any `}` after it, found with two linear scans. |
| `type ResolveInput`, `type ProjectDirInput` | interfaces | The parameter shapes `LaunchContext.resolve` and `LaunchContext.projectDir` take; `ProjectDirInput` extends `ResolveInput` with `cwd`. |
| `Exclusive.make` | `Effect<Exclusive>` | A new one-permit lane. Bind it once (module level or layer-built); every call shares it. |
| `lane.run(body, { timeout })` | instance method | `Effect<A, E \| ExclusiveTimeout, Exclude<R, Scope>>`. Runs `body` holding the permit, under the ordering contract below. `timeout` is required. |
| `Exclusive.promise({ try, catch, abandon? })` | static function | `Effect<A, E>`. A promise whose interruption aborts `signal` and then **waits** for it to settle, where `Effect.promise` and `Effect.tryPromise` abandon it. A rejection or a synchronous throw from `try` fails through `catch`; a `catch` that throws dies with what it threw. `abandon: true` aborts and resumes at once, for a promise that ignores its signal. |
| `ExclusiveTimeout` | tagged error | `{ timeout, message }`, `timeout` the formatted duration. By the time a caller sees it, the body's finalizers have run and the permit is released. |
| `ExclusiveRunOptions`, `ExclusivePromiseOptions<A, E>` | interfaces | The option shapes of `run` and `promise`. |
| `ProcessScope.chdir(host, directory)` | static function | `Effect<void, ProcessScopeError, Scope>`. Enters `directory` and returns to the previous working directory when the scope closes. When the previous one cannot be read (deleted, so `cwd()` throws), the change still happens and nothing is restored; a restore that throws is ignored for the same reason. |
| `ProcessScope.env(env, patch)` | static function | `Effect<void, never, Scope>`. Applies `patch` to an env record and restores every patched key on close. An `undefined` value deletes the key, and a key absent before is deleted again on restore: nothing ever assigns `undefined`, which Node's `process.env` would store as the string `"undefined"`. |
| `ProcessCwdHost`, `ProcessScopeError` | interface, tagged error | `ProcessCwdHost` is `{ cwd(), chdir(directory) }`, which Node's `process` satisfies. `ProcessScopeError` is `reason: "ChdirFailed"`, `path`, `message`, `cause`; nothing was changed, so nothing is restored. |
| `ProcessGuard.parseInjectCrash(value)` (`./guard`) | static function | `(value: string \| undefined) => ProcessGuardInjection \| undefined`: the shared `<at>:<kind>` grammar for a launcher's test-only crash-injection variable; anything else, or no value, is `undefined`. Import-free like the rest of `./guard`. |
| `ProcessGuard.run(options)` (`./guard`) | static function | `(options: ProcessGuardOptions) => Promise<void>`. Installs `uncaughtException`/`unhandledRejection` listeners on a structural `ProcessGuardHost` (`on`, `emit`, `stderr`, `exit`; Node's `process` satisfies it, pinned by a compile-time test), then awaits `options.load(guard)`. Launches nothing: `load` starts the server on any transport and calls `guard.markConnected()` once serving and `guard.useFormat(fn)` to upgrade the dependency-free formatter. `ProcessGuardPolicy`, a `startup failed` exit 1 on a rejected `load`, and `injectCrash: ProcessGuardInjection` (`at: "load" \| "connected"`, the `"connected"` report raised a tick after `markConnected`) are exactly `McpGuard`'s, which is now this guard plus an MCP launch. |

### `Exclusive`: the ordering contract

`Exclusive` exists for work that mutates process-global state (the working
directory, the environment, a patched stream) inside a server that takes
concurrent requests, such as an MCP tool that runs a test runner in-process.
Its contract holds on every exit path:

1. Waiting for the permit is interruptible: a request cancelled while
   queued leaves the queue and never runs.
2. Once the permit is held, the caller's interruption is masked until the
   body ends. A transport that maps a client cancel to an interrupt (an MCP
   server does) only drops the response; the next request still waits for
   the real work to finish.
3. The required timeout interrupts the body, and only the body.
4. The body runs in its own `Scope`: its finalizers (a `ProcessScope`
   restore, a temp-directory removal) run, then the permit is released, then
   the caller sees the result, an `ExclusiveTimeout`, or its own deferred
   interruption.

`run` is built on core's `Effect.timeoutOrElse` over
`Effect.interruptible(Effect.scoped(body))`, inside
`Effect.uninterruptible` under `Semaphore.withPermit`. It relies on core's
race returning only after the loser has been interrupted and has exited: a
timed-out body's finalizers have run, and a body that won has stopped the
timer, before the permit is released. A hand-rolled timer forked with
`Effect.forkChild` would be scoped to the *caller's* fiber, not the helper's,
so the helper would have to interrupt it explicitly before returning;
building on `timeoutOrElse` removes that obligation.

A body that ignores interruption (a bare `Effect.promise`, an
uninterruptible region) delays both the timeout and the release until it
settles. That is deliberate: releasing the permit while process state is
still changing is the bug the lane exists to prevent. Run promise work
through `Exclusive.promise`, and give a promise that never observes its
signal `abandon: true`, which still closes the body's scope and runs its
finalizers before the release but no longer proves the promise stopped.

**Not reentrant.** A `run` on the same lane from inside a body waits for the
permit its own caller holds; it gets it only when the outer timeout
interrupts the body, so the outer `run` fails with `ExclusiveTimeout`. Call
the inner work directly.

### Why there is no temp-directory helper

A scoped temporary directory is IO, and this package does none. Use core's
`FileSystem.makeTempDirectory` in an `Effect.acquireRelease` whose release
ignores a failed removal (`remove(..., { recursive: true }).pipe(Effect.ignore)`).
Core's `makeTempDirectoryScoped` is not the answer: its release is
`orDie`, so a body that already removed the directory turns a success into
a defect. `ProcessScope`'s TSDoc carries the same recipe.

### Why the guard lives here, on its own subpath

The crash guard was born as `McpGuard.run` in `@effected/mcp/guard`, but
its guard half (listeners, policy, startup failure, `injectCrash`, the
formatter) has nothing to do with MCP, and okfit's LSP front end
(`vscode-languageserver` over stdio) hand-rolled a copy because
`McpGuard.run` also launches through `McpStdio`. The guard therefore
belongs where every front end can reach it without a front-end dependency:
here. It is a subpath, `./guard`, with **no runtime import at all**, so a
`main.ts` imports it statically and its listeners exist before `effect` or
the server graph evaluates — the main entry imports `effect`, so it could
not serve that role. The connected signal is a plain `markConnected()`
callback rather than an Effect or a `start()` return value: an LSP calls it
from its own listening path, and `McpGuard` passes it to
`McpStdio.launch`'s `onReady`, which fires after `load` resolved — a
`start()`-shaped contract could not express that later moment. `engine`
stays pure: the host is structural and `setTimeout` is the only global
touched.

## Not exported, and why

- **Version constants** (an `ENGINE_VERSION` and the like). The bundler
  substitutes `__PACKAGE_VERSION__` in the *consuming* package at build
  time, so a helper shipped from this kit package would report this kit's
  own version, not the consumer's — the one value this primitive must
  never produce. The rule that an engine stamps its own version is taught
  as doctrine, with the build-time constant as a skill recipe, not
  packaged.
- **The platform layer.** Building a platform layer is a decision that
  belongs to the front end's `main`, not to a pure package with no IO at
  all.
- **`Now`.** An injectable clock has exactly one adopter today and stays a
  recipe rather than becoming kit surface it would have to carry forever.

## Tier and dependency rules

[Pure tier](../glossary/library-tier.md): `effect` is the only peer and
the only dependency of any kind, no `process`, no `node:` import, no
platform package. `ProcessScope` and `ProcessGuard` take the process state
they touch as structural hosts or plain records, so the purity holds by
construction.

Two kit packages depend on `@effected/engine`: `@effected/mcp`
(see [`mcp.md`](mcp.md)) as a peer, and `@effected/cli`
(see [`cli.md`](cli.md)) as a regular dependency, for `CliRuntime.main`'s
`distribution` option ([decision](../decisions/cli-engine-edge.md)). No
other package may add an edge to it without a new Decision.

## Consumers

[`consumers/okfit`](../consumers/okfit.md) is the register entry that first
named this gap: its own `engine` package is exactly the shape a kit
`Distribution` primitive sits under, and its `Remediation`/`ToolFailure`
copies are one of the near-identical duplicates this package (together with
the phase-2 `@effected/mcp`) exists to collapse.
[`consumers/vitest-agent`](../consumers/vitest-agent.md) is the second: its
`process.exit` handlers and `spawnSync` e2e are `@effected/cli` concerns
(see [D3](../decisions/cli-logger-defaults-all-to-stderr.md) and
[D9](../decisions/cli-testing-uses-core-child-process.md)), but its two
independent ports of `registerToolkit` are the `Remediation`-shaped
duplication this package's `CurrentDistribution` and `Remediation` exports
target directly.

## Testing

- Schema round-trips for `Distribution` and `Remediation`.
- `CurrentDistribution`'s default read with nothing provided, and an
  override.
- `distributionSuffix`'s full truth table (`None`, `Some` with and without
  a version worth naming).
- `LaunchContext.projectDir`: an empty-string env value, a
  `${CLAUDE_PROJECT_DIR}` literal, argv precedence over env, falling
  through to `cwd`.
- A property test asserting `projectDir` never returns an empty string
  when `cwd` is not empty.
- `Exclusive`: serialization, queued cancellation, the masked caller, the
  timeout interrupting only the body with finalizers (asynchronous ones
  included) before release, no live child left in the caller's fiber,
  `promise`'s wait-then-settle against an `Effect.promise` control,
  `abandon`, and non-reentrancy surfacing as `ExclusiveTimeout`.
- `ProcessScope`: restore on success, failure and interruption, a
  directory that cannot be entered, a deleted previous directory, a
  throwing restore, and `env` deleting again the keys that were absent.
- `ProcessGuard` against a host double: listeners before `load`, both
  policies across `markConnected` (including from a non-Effect callback
  after `load` resolved), `startup failed`, formatter fallback, and every
  `injectCrash` phase and kind; the `"connected"` report is asserted absent
  on the `markConnected` tick. `entrypoints.test.ts` pins `./guard`'s
  source and built graphs to zero packages.

## See also

- [D1: `@effected/engine` exists and holds `Distribution`, `Remediation` and `LaunchContext`](../decisions/engine-holds-cross-front-end-primitives.md)
- [`@effected/cli` depends on `@effected/engine` for `distribution`](../decisions/cli-engine-edge.md)
- [`@effected/cli`](cli.md)
- [`@effected/mcp`](mcp.md)
