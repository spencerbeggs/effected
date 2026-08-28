---
name: actions-runtime
description: >-
  Use when writing or reviewing a GitHub Action's pre/main/post entry point on
  @effected/github-actions — wiring Action.run, ActionRuntime.layer, the ActionServices union, an
  extra ActionRunOptions.layer, or deciding whether ActionCache, Artifact or GitHubCacheBlobStore
  belong in the runtime.
---

# Actions runtime

`Action.run` is the one entry point an action's `pre`, `main` and `post` scripts call — each its own Node process, since GitHub runs the three phases as separate processes with nothing surviving between them except what `GITHUB_STATE` carries. This skill is the wiring around that call: what `ActionServices` a program can rely on, how `ActionRuntime.layer` composes them, how an extra `ActionRunOptions.layer` widens a program's `R`, and how a failure gets rendered before the runner sees it.

For the general Effect v4 service/layer rules this package follows — `Context.Service`, `provideMerge` vs `mergeAll`, memoization by reference — see `effect-v4-services-layers`; this skill carries only the `github-actions`-specific instance of each.

## What you have

| Construct | Import | Reach for it when |
| --- | --- | --- |
| `Action.run` | `import { Action } from "@effected/github-actions"` | wiring a `pre`/`main`/`post` entry point — the only call an entry makes |
| `ActionServices` | same | typing a program's `R` so `Action.run` can run it without a widening error |
| `ActionRuntime.layer` | same | rarely referenced directly — `Action.run` composes it; read it to know what's already provided |
| `ActionRunOptions.layer` | `Action.run(program, { layer })` | a program needs one more service `ActionRuntime.layer` doesn't already carry |
| `describeCause` / `describeError` | `import { Action } from "@effected/github-actions"` (`Action.describeCause`) | rendering a `Cause` outside `Action.run`'s own top-level catch, in the same one-line convention |
| `ActionEnvironment.isDebug` | `import { ActionEnvironment } from "@effected/github-actions"` | wiring step-debug into `References.MinimumLogLevel` so `Effect.logDebug` calls actually fire |
| `GitHubToken.clientLayer` / `Repo.layerFromConfig` | `import { GitHubToken } from "@effected/github-actions"` / `import { Repo } from "@effected/github"` | building a client or repo context as an extra layer — both can fail to construct, see Standards |
| `ActionCache` / `Artifact` / `GitHubCacheBlobStore` | `import { ActionCache } from "@effected/github-actions"` | caching, artifacts or blob storage — one extra layer line, never a runtime default; see `actions-cache-and-artifacts` |

## Standards

- **Read program-level config and inputs through `ActionInput`, never a bare `Config.string`/`Config.boolean`.** `ActionRuntime.layer` installs `ActionInput.layerDefault`, which resolves a bare flat name through the runner's `INPUT_` derivation before falling back to the ambient lookup, so a side-stepped read no longer resolves to a wrong default under `Action.run` — but the accessors still own the parsing and the typed `ConfigError`s the provider cannot supply. See `actions-inputs-outputs` for the mangling rule and the trap that survives in a suite bypassing the runtime.
- **Provide `ActionRuntime.layer` once, at the boundary, and let an extra layer's real requirements travel up to it.** `ActionRunOptions<R>.layer` is typed `Layer.Layer<R, never, ActionServices>` — its third type parameter is `ActionServices`, not `never` — so a layer that needs `FileSystem` or `ActionOutputs` names that requirement and gets it from the runtime rather than building a private, self-contained sub-provide.
- **Wrap a layer that can fail to construct with `Layer.orDie` before handing it to `ActionRunOptions.layer`.** The option fixes `E` at `never`. `GitHubToken.clientLayer` and `Repo.layerFromConfig` are the two layers in this ecosystem that legitimately can fail to build — treat a missing token or misconfigured repo as fatal at boot, and catch the narrower typed error (`GitHubTokenError { reason: "expired" }`) instead when a program would rather report an expiry than crash.
- **Take `ActionCache`, `Artifact` or `GitHubCacheBlobStore` as an explicit one-line extra layer, never expect them from `ActionRuntime.layer`.** They are the only modules that import `@azure/storage-blob`; excluding them from the default runtime keeps that dependency out of the bundle of every action that merely sets an output. Their own `R` is already satisfied by the runtime, so opting in costs exactly `Action.run(program, { layer: ActionCache.layer })`.
- **Wire `isDebug` into `MinimumLogLevel` once, at the top of `program.ts`, not per step.** `ActionEnvironment.isDebug` only answers whether step debugging is on; core's `MinimumLogLevel` defaults to `"Info"` regardless, so a `Debug`-level log is filtered before `ActionLogger` ever gets a chance to render it.
- **Give every script its own `Action.run` call and its own extra layer.** There is no `Action.pre`/`Action.main`/`Action.post` — GitHub runs the three phases as three separate processes, and nothing about `ActionRuntime.layer` or `Action.run` threads state between them. `ActionState`/`GITHUB_STATE` is the only channel that does.
- **Decode the webhook payload through your own `Schema`.** `ActionEnvironment.payload` hands back `unknown` after reading and JSON-parsing `GITHUB_EVENT_PATH`; do not hand-roll a second read of that file anywhere in a program.

## Footguns

- Turning `ActionRuntime.layer` into a function instead of a bound constant rebuilds the environment snapshot at every composition site — layers memoize by reference, not by structure. See `references/entry-points-and-layers.md`.
- A rejecting entry point produces a failed step *and* an unhandled rejection, and only the first is legible in a workflow log — `Action.run` never rejects by design; do not wrap it in a `try`/`catch` that could swallow the resolved `Promise`. See `references/entry-points-and-layers.md`.
- `Effect.logDebug` calls stay invisible even with step debugging on until a program wires `isDebug` into `MinimumLogLevel` itself — `isDebug` alone changes nothing. See `references/logging-and-levels.md`.
- A `post` script that lets an unrendered defect escape `Action.run`'s top-level catch produces a green step for a crashed action, the worst outcome the last-resort catch exists to prevent. See `references/failure-rendering.md`.

## Additional resources

- [references/entry-points-and-layers.md](references/entry-points-and-layers.md) — the full `Action.run` contract, the `ActionServices` union, `ActionRuntime.layer`'s exact composition and `provideMerge` chain, the two config providers, `ActionRunOptions.layer`'s widening behavior, and the `pre`/`main`/`post` entry shapes. Load when: composing a runtime layer, debugging why a service isn't resolving, or writing a new entry script.
- [references/failure-rendering.md](references/failure-rendering.md) — the canonical home for `describeCause`/`describeError`: the one-line rendering convention, the `::error::`/`::debug::` depth split, and the last-resort catch around `Effect.runPromise`. Load when: a failure needs rendering anywhere outside `Action.run`'s own catch, or reviewing why a run reported green after a crash.
- [references/logging-and-levels.md](references/logging-and-levels.md) — the `isDebug` → `MinimumLogLevel` recipe in full, with the composition point that keeps it a run-wide setting instead of a per-step decision. Load when: `Effect.logDebug` calls aren't showing up even with `RUNNER_DEBUG` set.
