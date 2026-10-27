---
type: Decision
title: RunOnce trusts a done marker only from an owner it observed, and breaks a lock through per-contender tickets and a rename-based compare-and-delete
description: "@effected/commands' RunOnce runs work once across concurrent processes with a file lock and a done marker: a marker counts only when its nonce belongs to an owner this caller saw in a read of the lock; the lock is read before the marker; a lock is removed by renaming it to a private tomb and judging the tomb; breakers exclude each other with uniquely named tickets that are never renamed or put back; a live owner is taken over only past staleMs + waitTimeoutMs; there is no heartbeat; and a driver removes only a file it created. One generator holds every rule, and a bounded model checker verifies it."
status: draft
tags: [architecture, testing]
sources:
  - id: machine
    resource: ../../packages/commands/src/internal/runOnceMachine.ts
    title: "The protocol as one generator: decide, observeLock, compareAndDelete, takeBreaker, breakLock, sweepTombs, release"
  - id: run-once
    resource: ../../packages/commands/src/RunOnce.ts
    title: "RunOnceOptions (staleMs, waitTimeoutMs, trustSequentialMs, a host-local dir), the residual risks, and the sync and Effect drivers"
  - id: node-sync
    resource: ../../packages/commands/src/node-sync.ts
    title: "nodeRunOnceFileSystem: an O_EXCL create whose failed write never removes the file by path"
  - id: model
    resource: ../../packages/commands/__test__/runOnceModel.ts
    title: "A bounded stateless model checker: inode-modelled files, non-atomic writes, a preemption bound, crashes"
  - id: model-test
    resource: ../../packages/commands/__test__/RunOnce.model.test.ts
    title: "The in-suite scenarios a, c, e and the g0 breaker-race regressions"
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T13:22:20Z
integrity:
  generated:
    body: 4d93bc41588b1fc4
---

# `RunOnce` trusts only observed owners and breaks locks through tickets and tombs

## Context

Consumers run the same expensive preparation (a prebuild, a code
generation step) from several processes at once: Vitest workers, parallel
`globalSetup`s, a sidecar and its host. They want it done once, with every
other caller either waiting for the result or running it themselves, never
hanging. A file has no compare-and-swap, a process can crash at any
instruction, pids are recycled, and a lock directory may be shared across
hosts. A "skip if a done marker exists" rule fails the commonest case: a
sequential re-run after a source edit skips work it should do.

`RunOnce` ships three drivers over one protocol: `runSync` over a
caller-supplied host, `commandSync` for an argv command, and the `Effect`
`run` over core's `FileSystem`, `Clock`, `Random` and the kit-declared
`ProcessLiveness` (core declares no liveness contract).[^run-once]

## Decision

**One protocol, written once.** Every rule lives in
`internal/runOnceMachine.ts`, a pure generator that yields IO requests
(`ReadText`, `CreateExclusive`, `Rename`, `ListDirectory`, `AgeMs`, `Sleep`,
`Backoff`, `Run` and the rest). The drivers only answer them, so the sync
and `Effect` forms cannot drift; a rule never goes in a driver.[^machine]

**Trust is nonce-observed.** Each owner writes a lock record
`{ pid, host, nonce, startedAt }` and, on success, a done marker
`{ nonce, at }`. A caller trusts a done marker only when its nonce is one
this caller saw holding the lock, in *any* read of it: a poll, the re-read
under a breaker, or the tomb a compare-and-delete judged. A previous,
sequential run's marker is never trusted unless the caller opts in with
`trustSequentialMs`, and then only while the marker is younger than that.
A failed run, and a run made without the lock, write no marker.

**The lock is read before the done marker.** An owner writes its marker
and only then releases. So a lock seen absent means any marker its owner
wrote is already on disk for the read that follows. After creating its
own lock, a caller reads the marker once more, so an owner observed
earlier that finished in between is trusted and the work does not run
twice.

**When a lock may be broken.** A same-host owner is probed every poll with
signal 0. An owner probed dead is taken over at once. An owner that cannot
be probed (another host, or no readable record) is taken over past
`staleMs`. An owner probed *alive* is taken over only past
`staleMs + waitTimeoutMs`: that is the recycled-pid rule, so a dead
owner whose pid now names another process cannot hold the lock forever.
Past `waitTimeoutMs` nothing more is waited on, and the caller runs
unserialized (`RanUnserialized`) rather than hanging.

**No heartbeat.** A lock's age is its creation age; nothing refreshes it
while the work runs, and the sync form runs the work on the calling
thread. So across hosts `staleMs` must exceed the longest the work can
take, and on one host `staleMs + waitTimeoutMs` must; otherwise a slow
owner is taken over and the work runs twice. Ages come from file mtimes,
which on a network filesystem are the server's and may be served late.

**Breakers exclude each other with per-contender tickets.** To break a
lock, a contender creates its own ticket, `<key>.lock.break.<nonce>`, named
by a nonce it owns and holding its owner record (plus, for diagnosis, the
nonce it means to break). It then lists the directory. A ticket that is
abandoned (older than `staleMs`, or a dead holder's on this host) is
removed by its unique name. Since a unique name only ever holds that one
ticket, the removal is not a check-then-act on someone else's live file.
If any other live ticket remains, the contender removes its own and backs
off. Exclusion follows from the order: a contender proceeds only when its
listing saw no other ticket, so any rival created its ticket after that
listing, and the rival's own later listing sees this one. **Nothing about a
breaker is ever renamed or put back**: an earlier design with a single
shared breaker file and a put-back let a third caller take the breaker in
the instant it was gone, while its holder still trusted it. The lock
directory must therefore be host-local: a network filesystem's directory
cache can serve a listing that misses a rival's ticket.

**Lock removal is compare-and-delete through a rename.** Under its ticket,
the breaker re-reads the lock and proceeds only if it is still the lock it
judged: the same owner nonce, or still unreadable and still stale. It then
renames the lock to a private tomb and judges *the tomb*, its record and
its age, never the live path, so nothing that arrives at the path after the
rename can be mistaken for what was judged. An accepted tomb is deleted. A
rejected one has its exact record put back with an exclusive create, so its
owner still owns it, nonce and all. An unparseable tomb is never put back (a
creator caught between its create and its write retries), and neither is a
tomb that vanished. Release is the same compare-and-delete, accepting only
the releaser's own nonce, retried five times over about 400 ms when the
rename fails outright (Windows `EPERM`/`EBUSY` from a scanner). A tomb's
name carries the time of its rename, because a rename keeps the mtime, and
tombs left by a crash are swept once that time is older than `staleMs`.

**The put-back residual.** Breakers exclude one another, so a holder's
judged lock can change under it only when the holder itself stalls past
`staleMs` (its ticket is then aged out) or when an alive-probed owner aged
past `staleMs + waitTimeoutMs` releases at that very moment. Even then, the
race also needs a third caller to create a lock in the instant between the
rename and the put-back. That window is accepted and documented, together
with a breaker suspended past `staleMs` (a laptop asleep mid-break).

**A driver removes only a file it created.** When an exclusive create
succeeds and writing the record then fails, the file is left in place and
the caller runs unserialized. Removing it by path could delete a rival's
live lock: a breaker may have swept the half-written file into its tomb, and
the rival may have created its lock at the path since. The garbled file
reads as a lock with no record and is taken over once older than
`staleMs`.[^node-sync] A non-EEXIST create failure likewise removes
nothing. A creator whose lock reads back empty (a breaker swept it up
between its open and its write) repairs it with its own record.

**The protocol is model-checked.** `__test__/runOnceModel.ts` is a bounded,
stateless model checker. It binds paths to inodes, so a write follows its
file through a rename. Creates and writes are non-atomic, it explores
crashes, and it enumerates schedules under a preemption bound. It reports
overlapping runs, displaced locks, a run despite an observed marker, and hot
loops, counting a safety violation even in a schedule later pruned for
length.[^model] The suite runs scenarios a, c and e and the g0
breaker-race regressions; a change to the machine must also pass the
review's full bounds offline.[^model-test] A rule the model cannot reach (it
treats a finished process as dead) gets a scripted test in
`RunOnce.sync.test.ts`.

## Alternatives rejected

- **Trust any done marker.** Rejected: a sequential re-run after a source
  edit would skip work it must do. `trustSequentialMs` keeps it available
  as an explicit, bounded opt-in.
- **Age-only staleness, with no liveness probe.** Rejected: a dead owner's
  lock would block every caller for `staleMs`, and a live owner's would be
  broken mid-work as soon as it aged.
- **A single shared breaker file, removed and put back.** Rejected after
  the model checker found the third-caller race described above.
- **Delete the lock by path after re-reading it.** Rejected: between the
  read and the delete the lock can change hands, and a file has no CAS. The
  rename moves the evidence somewhere only the breaker reads.
- **A heartbeat.** Not built: the sync form's work occupies the calling
  thread. The cost is stated as a configuration rule on `staleMs`.

## Consequences

`RunOnce` serializes on a best-effort basis and never hangs: past
`waitTimeoutMs`, or when the lock cannot be created at all, the work runs
unserialized. Its residual risks are all stated on `RunOnce`'s TSDoc, and
each needs work or a stall that outlives an age limit the caller sets. The
`Effect` driver is uninterruptible while it holds the lock, and restores
interruptibility only around a poll's `Sleep` and the work itself, so an
interrupt never leaves a lock half-released. The signal-0 probe is the one
place `@effected/commands` looks at another process, and it lives in
`./node-sync` (`nodeProcessLiveness`), not on the main entry; see
[the supervision limitation](../limitations/commands-no-process-supervision.md).

[^machine]: `../../packages/commands/src/internal/runOnceMachine.ts`
[^run-once]: `../../packages/commands/src/RunOnce.ts`
[^node-sync]: `../../packages/commands/src/node-sync.ts`, `nodeRunOnceFileSystem`
[^model]: `../../packages/commands/__test__/runOnceModel.ts`
[^model-test]: `../../packages/commands/__test__/RunOnce.model.test.ts`
