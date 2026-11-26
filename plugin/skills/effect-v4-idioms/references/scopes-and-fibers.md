# Scopes and fibers — the leaks and the lifetimes

The two scope traps that leak or die far from their cause, and how long a forked
fiber really lives.

## Clearing a reference and closing its scope is two steps, not one

An interrupt that lands between `Ref.set(current, Option.none())` and
`Scope.close(scope, Exit.void)` leaves the scope open and unreachable: its
finalizers never run, and whatever it held (a permit, a mounted view, a
forked tick) leaks. Make the pair one uninterruptible step:

```ts
Effect.uninterruptible(Effect.andThen(Ref.set(current, Option.none()), Scope.close(scope, Exit.void)))
```

A low `Scheduler.MaxOpsBeforeYield` in a test is how to prove the window
exists — the `effect-v4-testing` skill covers that test.

## `FileSystem.makeTempDirectoryScoped`'s release is `Effect.orDie`

The Node implementation releases with
`Effect.orDie(remove(directory, { recursive: true }))` (the
`makeTempDirectoryScoped` member of `@effect/platform-node-shared`'s
`NodeFileSystem`; `makeTempFileScoped` is the same), so when the work already
deleted or renamed the directory, the scope's close **dies** with the
`NotFound` — a defect no `Effect.catch` reaches, surfacing far from the code
that removed the directory. When the directory may be gone by release time,
acquire it yourself:

```ts
const dir = yield* Effect.acquireRelease(fs.makeTempDirectory(), (path) =>
  fs.remove(path, { recursive: true }).pipe(Effect.ignore),
)
```

## A child forked by a helper outlives the helper

`Effect.forkChild` attaches to the **caller's** fiber. A helper is not a fiber,
so a child it forks (a timeout timer, a heartbeat) keeps running after the
helper returns, until the calling fiber itself ends (`Effect.ts:9289`, the
`forkChild` doc: "attached to the parent fiber's scope"). A helper that forks
must `Fiber.interrupt` its children before it returns, or use
`Effect.forkScoped` under a scope it closes.

## Keep-alive is built in

A fiber suspended on `Deferred.await` keeps the process alive without
`runMain` — the core runtime has a reference-counted keep-alive timer.
`runMain` (from the platform packages) is still the recommendation for
SIGINT/SIGTERM handling, exit codes, and unhandled-error reporting, but it is
no longer what keeps the event loop from draining.
