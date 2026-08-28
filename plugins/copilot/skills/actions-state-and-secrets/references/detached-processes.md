# `DetachedProcess.reap` and `ChildEnv`

## The reap guard: a guard only a well-typed caller can trip is not a guard

`DetachedProcess.reap` takes a **plain `number`**, not the branded
`ProcessId`, and that's deliberate:

```ts
static readonly reap = Effect.fn("DetachedProcess.reap")(function* (pid: number, signal: NodeJS.Signals = "SIGTERM") {
  yield* Effect.annotateCurrentSpan({ pid });
  if (!Number.isInteger(pid) || pid <= 0) {
    return yield* Effect.fail(new InvalidPidError({ pid }));
  }
  return yield* Effect.suspend(() => {
    try {
      process.kill(pid, signal);
      return Effect.succeed(true);
    } catch (cause) {
      return isErrno(cause, "ESRCH") ? Effect.succeed(false) : Effect.fail(new DetachedSignalFailedError({ pid, cause }));
    }
  });
});
```

`DetachedProcessError` is a **union type alias**, not a class: one class
per failure (`DetachedLogUnavailableError`, `DetachedSpawnFailedError`,
`InvalidPidError`, `DetachedSignalFailedError`, `DetachedNotReadyError`).
Construct the member, never `new DetachedProcessError({ reason })`, and
discriminate on `_tag` rather than a `reason` field — which also means
`Effect.catchTag` recovers from **one** of these failures at a time, not
all five.

The value arrives as **text**, read back out of `GITHUB_STATE` by a `post`
phase that holds no `ChildProcess` handle to the child it started in
`main` — the type system stopped applying the moment the pid crossed that
process boundary, so a parameter typed `ProcessId` would only prove the
guard exists for callers careful enough not to need it.
`process.kill(0, …)` signals the caller's **entire process group**;
`process.kill(-1, …)` signals **every process the runner's user owns**. An
absent state key, a truncated file, or a failed numeric parse all decode
to `0` — the exact value most likely to arrive unguarded — so on a GitHub
runner, an unguarded reap of a bad pid takes down the job that's running
it, not just the child.

The test that proves the guard asserts on the **spy**, not the failure:

```ts
it.effect("refuses pid 0 WITHOUT signalling anything", () =>
  withKillSpy(
    () => true,
    (calls) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(DetachedProcess.reap(0));
        assert.instanceOf(error, InvalidPidError);
        assert.lengthOf(calls, 0, "process.kill must not have been called at all");
      }),
  ),
);
```

A test that only checked the effect failed would pass against an
implementation that signalled the whole group and *then* reported the
error — exactly the bug this guard exists to prevent. A sibling test
proves a **positive** pid *does* reach `process.kill`, so the zero-calls
assertion above isn't passing because the guard refuses everything — the
control matters as much as the assertion it's controlling for.

**`ProcessId` is the other half**, and it's core's brand, not this
package's own:

```ts
export const ProcessId = Schema.Number.pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      Number.isInteger(value) && value > 0 ? undefined : "Expected a positive integer process id",
    ),
  ),
  Schema.brand("ProcessId"),
);
```

It decodes to `ChildProcessSpawner.ProcessId` — the subprocess vocabulary
belongs to core, and this package doesn't get to re-declare it — but
core's own constructor applies **no runtime check**: producing a
`ProcessId` from a value the spawner just handed back succeeds
unconditionally, correctly, because there's nothing to validate about a
pid the OS just returned. That's exactly wrong for one that's been
through a text file. This package's own `ProcessId` schema is the missing
validating constructor, refusing the bad value **on the way out of
`ActionState`** — before it can ever reach `reap` — so the runtime guard in
`reap` is the second of two defenses, not the only one.

## `ChildEnv`: safely prepending directories to a child's `PATH`

`ChildEnv` is a pure, total, service-free class for the one recurring
need a `DetachedProcess.spawn` caller (or any spawn call adding a
directory to `PATH`) hits three ways at once:

- **`env` without `extendEnv: true` replaces the child's whole
  environment** — core's spawn options treat `env` as a replacement, not a
  merge, unless `extendEnv` says otherwise, so a bare `{ env }` costs the
  child everything, including the `PATH` being extended.
- **Windows spells it `Path`, and casing decides who wins** — the
  environment block is case-insensitive on `win32`, and Node's merge keeps
  the lexicographically first spelling, an undocumented internal detail
  nothing obliges it to keep. `ChildEnv.pathKeyOf(base)` finds the base's
  own casing (`Path`, `PATH`, or `PATH` when absent) and writes through it,
  rather than gambling on the dedupe.
- **`.cmd` shims need a shell** — the Node/Windows spawn hazard tracked as
  CVE-2024-27980: spawning a `.cmd`/`.bat` shim without a shell lets
  argument content reach `cmd.exe`'s own parsing rules, an injection risk
  a shelled spawn closes. `ChildEnv.needsShell(platform)` is that
  predicate, kept separate because it belongs on the spawn call, not in
  the environment.

`ChildEnv.prependPath(dirs, { base, platform })` answers a `PathPrependEnv`
— `{ env, extendEnv: true }` as **one value**, never `env` alone — with
the platform's delimiter (`;` on `win32`, `:` elsewhere) and no empty
trailing entry for an absent inherited `PATH`. `base` and `platform` are
**required**, not defaulted: this module reads nothing ambient, the same
invariant `ActionEnvironment` enforces for `process.env` generally. Two
compositions: spread the whole pair into a spawner call's options, or
merge `.env` alone over the parent's own block (`DetachedProcess.spawn`'s
shape).
