---
name: actions-state-and-secrets
description: Use when persisting values across a GitHub Action's pre/main/post phase boundary, handling a Redacted secret anywhere in @effected/github-actions, deciding whether a value belongs in ActionState or ActionOutputs, framing a blob with metadata for a cache or object store, reaping a detached child process, or rendering an Action's top-level failure.
when_to_use: ActionState, Redacted secret, BlobEnvelope, Secret.forChildEnv, Secret.forRunnerFile, Secret.forSigning, Secret.adopt, DryRun, DetachedProcess, GITHUB_STATE, ChildEnv PATH prepend
---

# Actions state and secrets

Everything in `@effected/github-actions` that crosses a phase boundary, or that must not leak. Each phase (`pre`/`main`/`post`) is a **separate process**; GitHub's own mechanism for carrying a value between them is a write-only file (`GITHUB_STATE`) whose entries the runner republishes to the next phase as `STATE_<key>` environment variables. That asymmetry — write through a file, read through the environment — is why `ActionState` is a service rather than a pair of helper functions.

For general Effect v4 service/layer shape, typed errors, `Cause`, and `Scope`, see `effect-v4-services-layers`, `effect-v4-idioms`, `effect-v4-schema`. This skill carries only the Actions-specific instance of those rules.

## What you have

| Construct | Import | Reach for it when |
| --- | --- | --- |
| `ActionState.save` / `.get` / `.getOptional` | `import { ActionState } from "@effected/github-actions"` | round-tripping an ordinary, non-secret value across `pre`/`main`/`post` |
| `ActionState.saveSecret` | same | persisting a value that came from a `Redacted` across the phase boundary |
| `Secret.forChildEnv` / `.forRunnerFile` / `.forSigning` / `.adopt` | `import { Secret } from "@effected/github-actions"` | the one module that turns a `Redacted` into a plaintext string, masking first |
| `DryRun.guard` | `import { DryRun } from "@effected/github-actions"` | running a mutation for real, or logging and returning a fallback in a rehearsal |
| `DetachedProcess.reap` | `import { DetachedProcess } from "@effected/github-actions"` | signalling a child process by a pid read back out of `GITHUB_STATE` |
| `ChildEnv.prependPath` | `import { ChildEnv } from "@effected/github-actions"` | safely extending a spawned child's `PATH` across platforms |
| `BlobEnvelope` | `import { BlobEnvelope } from "@effected/github-actions"` | framing bytes with caller-owned metadata before they reach a cache or blob store — full treatment in `actions-cache-and-artifacts`' `references/blob-stores.md` |

## Standards

- **Choose `ActionState` vs `ActionOutputs` mechanically, not stylistically.** `ActionState` crosses `pre → main → post` of the *same* action and never persists past the run; `ActionOutputs` crosses one step to a *later* step (possibly a different action) via `with:` outputs. A provisioned token or a detached child's pid is state; a value the workflow author wired into `steps.<id>.outputs.<name>` is an output.
- **Design every state field's encoded form as plain JSON.** Use `Schema.OptionFromNullOr`, never `Schema.Option`, for an optional field — the latter's encoded form is an `Option` instance, not a JSON primitive, and the failure lands one phase later than the mistake.
- **Call `saveSecret` for anything that came from a `Redacted`, ever; call plain `save` for everything else.** Only `saveSecret` masks before persisting. `GITHUB_STATE` is plaintext by GitHub's protocol, so the mask coupled to the write is the only defense a persisted secret gets.
- **Let `Secret.ts` be the only place a `Redacted` becomes a string.** When a genuine third need for a raw secret shows up, add a member to `Secret` rather than granting an exception elsewhere — masking and declassifying are the same call by design.
- **Give `DryRun.guard` a real fallback, always.** The fallback is required, not optional, so a rehearsal's return value is a design decision, not an afterthought.
- **Validate a pid on the way *out* of `ActionState`, and again in `DetachedProcess.reap`.** A pid that crosses a text-file boundary has already lost whatever type safety it had; guard it at both ends rather than trusting the second guard alone.
- **Audit every ported error channel for whether it can actually fire.** A channel wrapped around a body that can never throw is worse than no channel — delete the reason from the signature, or write a test that fires it.

## Footguns

- An `Option` field encoded with `Schema.Option` instead of `Schema.OptionFromNullOr` reports success in `main` and fails to decode in `post` — the mistake and its failure land in different phases. See `references/cross-phase-state.md`.
- `DetachedProcess.reap` takes a plain `number`: an absent state key, a truncated file, or a bad parse all decode to `0`, and `process.kill(0, …)` signals the caller's entire process group. See `references/detached-processes.md`.
- `env` passed to a spawn call without `extendEnv: true` replaces the child's whole environment, including the `PATH` a caller meant to extend. See `references/detached-processes.md`.
- `BlobEnvelope`'s wire format, five-reason error union, and why a legacy raw blob decodes as a clean miss rather than garbage live in `actions-cache-and-artifacts`, not here — don't re-derive the frame shape from this skill's description alone.

## Additional resources

- [references/cross-phase-state.md](references/cross-phase-state.md) — `ActionState`'s full shape and round-trip mechanics, the `ActionState`-vs-`ActionOutputs` decision table in full, `DryRun`'s safe-default contract, and the failure-channel discipline that decides demote-vs-die before a `Cause` ever reaches `Action.run`. Load when: designing a state bundle, choosing between state and outputs, or auditing an error channel.
- [references/secrets.md](references/secrets.md) — `Secret`'s four members in full, the v4 fact that keeps the seam small (`HttpClientRequest.bearerToken` accepting a `Redacted` directly), the structural scan that proves only `Secret.ts` unwraps one, and `@effected/commands`' `Redaction` for value-based scrubbing. Load when: adding a new place a secret needs to leave `Redacted`, or reviewing a suspected leak.
- [references/detached-processes.md](references/detached-processes.md) — `DetachedProcess.reap`'s bare-pid guard and its test discipline, `ProcessId`'s validating constructor, and `ChildEnv`'s three PATH-prepending traps (`extendEnv`, Windows casing, `.cmd` shim shells). Load when: spawning or reaping a detached child process, or prepending to a child's `PATH`.
