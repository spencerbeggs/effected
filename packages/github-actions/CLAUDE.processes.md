# Secrets and child processes — @effected/github-actions

Child context file for declassification, the pid guard and the child-environment
builder. The rules live in the parent; this file is why they are shaped that way.

**Parent:** [CLAUDE.md](./CLAUDE.md)
**Design depth:** `@../../.claude/design/effected/packages/github-actions-runtime.md`

---

## The four sanctioned `node:` imports

Core cannot reach any of them: `node:crypto` for SHA-256 and HMAC (core `Crypto`
is RNG-only, with **no digest**), `node:process.kill` for reaping a bare pid,
`node:child_process` for the fd-level detached spawn, and `node:zlib` /
`node:stream` inside the cache and artifact codecs. Everything else goes through
a core contract — `ToolInstaller` downloads over `HttpClient` and extracts over
`ChildProcessSpawner` in `R`, `CacheKey` reads over `FileSystem`. The only other
raw-Node surface is the SigV4 primitives.

## `Secret.ts` is the only place a secret becomes a string

`Redacted.value` appears nowhere else in `src/`, and **a structural test asserts
it** (`__test__/Secret.test.ts`). Masking is the floor and declassification
implies it: every member registers the value with the log filter before any
plaintext is returned (`Secret.mask` registers and stops there), so plaintext
cannot be obtained without the runner's log filter already knowing about it.

This has caught two real leaks — see the design doc. When you hit the third,
**add a member to `Secret` rather than an exception**: `forSigning` exists
because SigV4 needs raw bytes for an HMAC, and it took one line.

**Masking assumes the runner parses stdout — a detached worker inverts it.** A
worker's stdout is a log file no runner parses, so a mask emitted there is inert
AND writes the plaintext verbatim into the log (a consumer shipped exactly that
for one round). The worker composes `ActionOutputs.layerDetached` (2026-08-02):
`setSecret` a documented no-op, the runner-file members failing typed
(`reason: "detached"`), `setFailed` a plain log line. The parent masks **before**
the spawn, via `Secret.forChildEnv` under the real layer.

The scan **strips comments first**. TSDoc that mentions `Redacted.value` while
explaining that a module does not call it is otherwise reported as a call — the
same phantom-edge problem the bundle-reachability walkers hit with `@example`
imports.

## A guard only a well-typed caller can trip is not a guard

`DetachedProcess.reap` takes a plain `number`, deliberately. The value arrives as
text from another process, so the type system stopped applying the moment it
crossed that boundary. `process.kill(0)` signals the caller's whole process group
and `process.kill(-1)` everything the user owns — on a runner, an unguarded reap
of a state value that decoded to `0` takes down the job running it. The test
asserts `process.kill` recorded **zero calls**, with a control proving a positive
pid does reach it.

`ProcessId` (the schema) is the *other* defense: it refuses the bad value on the
way out of `ActionState`. It decodes to **core's** brand — the subprocess
vocabulary is core's, and this package only supplies the validating constructor
core's `Brand.nominal` is not.

## Child PATH prepends go through `ChildEnv`

`ChildEnv` (2026-08-02) is the pure value-builder for core's spawn options —
zero imports, `WorkflowCommand`'s posture, an exact-empty-edge-set assertion in
the reachability suite. `prependPath(dirs, { base, platform })` answers
`{ env, extendEnv: true }` as **one value** (a bare `env` silently replaces the
child's whole environment), writing through the inherited `PATH` key's own
casing (Windows spells it `Path`, and emitting `PATH` beside it leaves the winner
to a Node-internal case-insensitive dedupe), with the platform's delimiter and no
empty trailing entry for an absent inherited value. `needsShell(platform)` is the
CVE-2024-27980 win32 rule for `.cmd` shims. Two compositions: a spawner call
spreads the whole pair; `DetachedProcess.spawn` merges over the parent itself and
takes `.env` alone. `base` and `platform` are **required** — this module reads
nothing ambient, per the `ActionEnvironment` invariant.

---

**Related context:** [CLAUDE.runtime.md](./CLAUDE.runtime.md) for the
environment these read through; [CLAUDE.reporting.md](./CLAUDE.reporting.md) for
the token bridge's credential lifetime.

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the package overview.*
