---
type: Interface
title: "@effected/jsonl journal service"
description: The write half of @effected/jsonl — append, atomicity, publish ordering, shutdown, and the cooperative-writer process model with its watcher.
status: stable
kind: api
resource: ../../packages/jsonl/src/Journal.ts
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-10-07T19:56:54Z
  body_sha256: 3391c5e52241b4bd19869d968d8df8e2579d79c1f1c856a16b7658d53c8aba94
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:37.064Z
---

# `@effected/jsonl` journal service

The journal service is the write half of the [jsonl module](../modules/jsonl.md):
the operations, the write critical section and the ordering that hangs off
it, lifecycle and shutdown, and the process model that lets several
cooperating writers share one file. What it guarantees is the property
every reader depends on — an appended line is complete, validated against
its event's schema, ordered against every other writer's, and observable to
them once it lands.

The service is one class per registry, defined with
`Journal.Service<Self>()(id, { events, config })` (see the [factory
decision](../decisions/jsonl-service-is-a-factory.md) and the [module's
factory section](../modules/jsonl.md#the-service-is-a-factory-not-a-generic-key)).
The config is a path plus three optionals — the activation-watch directory,
the hub capacity (default 64), and the shutdown drain bound (default five
seconds) — given as a record or as an `Effect` producing one. The class's
static `layer` is a single value built from that config, and its static
`make(config)` builds a journal over a config known only at run time; both
have a scoped lifecycle. The layer's error channel is `PlatformError` plus
whatever the config effect can fail with: a missing journal constructs
cleanly, an unreadable one fails typed.

## Operations

- **`append`** validates against the event's registered schema, encodes,
  then writes the complete line to a handle opened for append, under the
  terms in [the append primitive](#the-append-primitive-and-what-atomicity-actually-means).
  In-process concurrency is serialized by a one-permit semaphore. Appending
  after a terminal event fails typed unless the appended event is declared
  `reopen`, and appending to a journal that does not exist fails typed — an
  append never creates the file. The returned envelope is the appender's own
  line decoded back from its encoded text, so it is exactly the envelope a
  reader of the file gets. Its error channel is `AppendError`:
  `JournalClosed`, `JournalNotFound`, `TerminalViolation`, `InvalidData`,
  `UnserializableData` or a passed-through `PlatformError`. Three failures
  are defects rather than members, because each is unreachable through the
  typed surface or a bug in the package: an unregistered tag, and a
  self-decode that fails as `MalformedLine` or `UnknownEvent`. A self-decode
  that fails as `InvalidData` stays typed — a payload schema whose encoded
  form does not decode is the caller's to know about.
- **`appendPatch`** is inherit-and-patch: read the last valid envelope,
  merge the patch over its payload, validate the result, append. The whole
  read-merge-validate-append sequence is atomic under the append permit,
  not merely the write — it is a read-modify-write, and with the read
  outside the lock, two patches to different fields of one snapshot produce
  a deterministic lost update, the second silently reverting the first.
  That is inherit-and-patch's exact use case, so a narrower lock would have
  been wrong precisely where the operation is used most. The merge guard is
  asymmetric — both sides must be record-like and the patch must not bring
  a conflicting prototype (plain, null-prototype or the base's own) — forced
  by the primary use case: a caller's partial patch is a plain object
  literal even when the base is a schema-class instance, so
  `@effected/config-file`'s symmetric guard (both sides record-like and
  sharing a prototype) would reject the main case here. Outside that
  domain — cross-prototype, scalar, array or void bases — the patch
  replaces rather than merges, and a partial patch against such a base
  fails typed naming the missing keys.
- **`latest`** is a read-only `Effect<Option<Envelope>>` of the current
  last valid envelope, and **`latestChanges`** is the same value as a
  stream — the current value, then every change. Watching state is the
  common case, and a stream of the state rather than a fold is what keeps
  the common case one line. Neither exposes anything writable: the backing
  cell is the engine's, and no public shape hands out a ref or the hub. It
  is seeded by a bounded tail read running `Envelope.lastValid` (see the
  [slice
  interface](jsonl-slice.md#the-bounded-tail-read-is-the-sanctioned-cheap-read)),
  never a whole-file read, and kept current by local appends and the
  watcher. **`quiescent`** — whether the tail is a terminal event — is
  derived from `latest` rather than being a second piece of state, because a
  separate cell could drift out of agreement with it and a derivation
  cannot.
- **`query`**, **`changes`** and **`projection`** are the read surfaces, in
  the [slice interface](jsonl-slice.md). `query` fails with `QueryError`
  (`JournalNotFound`, a `DecodeError` only when the slice asks with
  `onInvalid: "fail"`, or `PlatformError`); `changes` and `projection` fail
  with `ChangesError`, which adds `JournalResync`.
- **`create` / `remove`** are explicit file lifecycle, so "the journal does
  not exist yet" is a decision the consumer makes rather than a side effect
  of the first append. `create` always opens the path `O_APPEND` and writes
  nothing: it creates a missing file and leaves an existing one untouched,
  and never "touches" with a zero-byte write, which reports `WriteZero` on a
  file it just created. `remove` is forced, so removing an absent journal
  succeeds.

`append` (with `appendPatch`, which shares its write path), `create` and
`remove` each run in a span named from the service id — `${id}.append`,
`${id}.create`, `${id}.remove`; the read surfaces carry none.

No sidecar index ships. A linear scan is the honest answer: an index is a
second source of truth that an external writer — which the process model
explicitly permits — can invalidate without notice, and reconciling it
correctly is a larger problem than the one the package is solving. If scan
cost ever bites, the fix is a cursor the consumer persists, which the API
already hands out.

## The append primitive, and what atomicity actually means

The naive claim — "one `writeAll` is one `write(2)`" — is false. `File.writeAll`
recurses on partial writes, so it can issue more than one syscall for one
line; `File.write` is the single syscall, but it returns a byte count and
may short-write, which would tear a line just as surely. No API guarantees
one syscall per line.

The corrected position: the primitive is `writeAll` on a handle opened for
append. Atomicity is an OS property of `O_APPEND` writes to a regular file
at reasonable line sizes, not an API guarantee — under `O_APPEND` the
kernel makes the offset-seek and the write one operation, so concurrent
appenders cannot overwrite each other. What remains is a short write — a
signal interrupting the call, a filesystem limit, a full disk — after which
the loop's next iteration writes the remainder as a separate operation
another writer can interleave with. There is no byte threshold below which
this is impossible (`PIPE_BUF` is a pipe concept and does not govern
regular files). The line-size caveat is part of the contract: the larger a
journal line, the more opportunity a short write has to split it. A failure
from the loop is never silently ignored — `writeAll` reports no byte count,
so it either wrote the whole buffer or failed — and any `PlatformError` out
of an append surfaces typed and is treated as a possibly-torn tail that
readers walk back over.

Where the line landed is located, never assumed. `O_APPEND` lands at the
real end of the file and reports no position, so after the write the
appender `fstat`s its own handle. When the file grew by exactly the
appender's line since the consumed offset, no other writer can have touched
it and that position is exact — the common case reads nothing. Otherwise
other writers' bytes are in the file too, on either side of ours: an
un-ingested gap before it, or an append that landed between our write and
our `fstat`, which overstates the end. So the appender reads the region from
its consumed offset to that end and finds its own line in it by exact text.
Lines ahead of it are published first and lines after it after it, so the
hub carries the file's order however the bytes interleaved, and the
consumed offset advances past all of them.

## The publish stage sits outside the write critical section

The obvious implementation deadlocks by construction: a suspending hub
publish inside the append critical section, plus one stalled subscriber,
wedges every writer, and then wedges scope close too, because the
finalizer waits to drain the very permit the suspended publish holds. Four
pins resolve it:

1. The write critical section covers the file write, the gap read and the
   state updates only; a read under the permit is legal, but a suspending
   hub publish never sits inside it.
2. Publish order equals write order, preserved by a dedicated ordering
   stage whose slot is acquired *under* the write permit and executed
   *outside* it — order is a property of acquisition, not of execution.
3. Backpressure is unchanged: an append completes only once the hub has
   accepted its envelope, so a slow subscriber's pressure lands visibly on
   appenders rather than as a silent drop.
4. The terminal-drain at shutdown is bounded, with the limit stated
   honestly: a subscriber that keeps consuming observes stream end, one
   that never consumes again cannot observe completion through a channel it
   refuses to read, and — the point of bounding it — does not hold scope
   close hostage.

The ordering stage is a chained-`Deferred` baton: each append, while
holding the write permit, links a fresh `Deferred` onto a chain (linking is
non-suspending and O(1), the entire reason it is legal inside the critical
section), releases the permit, awaits its predecessor, publishes, and
passes the baton on via `ensuring`. A second semaphore acquired under the
write permit was considered and rejected: when contended it suspends inside
the critical section, reintroducing the deadlock through a smaller door.

**The write-and-locate pair is not atomic, and the locate step does not
pretend it is.** No lock-free writer can learn where an `O_APPEND` write
landed, and an advisory lock is rejected by the process model (a shell
script's `>>` would not honor it anyway). Trusting the `fstat` alone was the
earlier design, and it was wrong under one interleaving — an external write
between our write and our `fstat` — in three ways: our line's reported
offset was off by the external write's length, the external line was
skipped, and our line could be published twice. Searching the region for
our own line closes all three, at the cost of one bounded read only when
another writer's bytes are present. One ambiguity remains, and it is
content-level, not positional: a byte-identical line from another writer
(same timestamp, tag, scope and payload) is indistinguishable from ours, and
the search takes the last such line at or before the `fstat`-derived
position.

The finalizer captures the publish-chain tail under the write permit — a
consistent snapshot, since the baton is only mutated under that permit —
and awaits it within the same bounded interruptible region before
publishing the end signal, so every append that *completed* is delivered
before the terminal end-of-stream.

## Shutdown: refusal and drain are two mechanisms

A `Latch` cannot refuse — awaiting one suspends with no failure channel, so
a closed latch would make a late append hang, the opposite of the intended
behaviour. The split: refusal is an explicit closed flag, checked *before*
the append semaphore is taken, failing typed (checking before the permit
matters — a late append must not queue behind a draining flush only to be
refused after waiting); drain is the latch's half, and the finalizer awaits
in-flight work before publishing the end signal that completes subscriber
streams, so the last accepted append is on disk and visible to subscribers
before the streams end. The drain bound is configurable and `Clock`-based,
so under a `TestClock` it fires only if the clock is advanced — a consumer
must `TestClock.adjust` past the bound or the finalizer hangs for the real
wall-clock duration.

## Process model: cooperative writers, always watching

The decision: instances of the same application cooperate under shared
rules, and the service always watches the file. Not single-writer-only
(real precedents already violate that), and not multi-writer locking (which
buys correctness against arbitrary writers at a cost this file format does
not justify). External appends are a fact of JSONL life — a shell script, a
second server, a human with `>>` — so the service watches for the life of
the layer scope and tracks the byte offset of everything it has decoded.
Its own appends advance that offset directly; on external growth it reads
from the offset, decodes the new lines, and feeds them into the same hub,
the same `latest` and the same projections, so a subscriber cannot tell a
local append from an external one.

A torn tail is tolerated, because the envelope makes it detectable — a
writer caught mid-write leaves a partial line, the walk-back skips it, and
the offset holds until the line completes. Truncation or replacement is a
contract violation, surfaced not repaired: if the file shrinks or is
replaced, every live subscriber's stream ends with a typed `JournalResync`
rather than the service silently reconciling an inconsistency it cannot
reason about on the subscriber's behalf. The journal itself re-seeds: it
adopts the file as it now is — re-probing the BOM, recapturing the file's
identity, resuming ingest at the end of its last complete line (never past
a torn tail a writer may still finish), and then re-reading `latest` from
its tail, in that order so a line landing between the two reads is still
ingested — through the same seeding step
construction uses, so there is one definition of "caught up". It does not
reset `latest` to empty or re-ingest the new file from offset zero, so
nothing already in the new file is republished to anyone. The recovery for
a consumer is uniform: discard cursor-derived state and re-read — a fresh
`query` or `changes`, with `latest` already describing the new file. No
advisory locks: the contract other writers must honor is one write of a complete
line, to a handle opened for append, keeping lines small enough that a
short write is unlikely to split them — a discipline, not an enforced
guarantee.

Replacement is detected by inode identity (device and inode captured when
the journal seeds, compared on each poke), which catches a
same-size-or-larger replacement a size check structurally cannot see.
Truncation is a size below the consumed offset. The honest limit: the
inode is optional in the platform's stat, so where it is unreported only
truncation is caught.

## A leading BOM is stripped at the service boundary, not in the core

A journal written by a BOM-emitting tool would otherwise have its first
line permanently malformed for every reader, forever. The service's read
boundary strips a single leading BOM, explicitly and at the byte level — it
does not get this from `FileSystem.readFileString`, whose silent strip
would silently desynchronize every offset the package hands out, since
journal reads are offset-based. The pure core does not strip; it stays
byte-honest and reports what it was given. Offsets are logical post-BOM on
every path — tail reads, paged reads, the append cursor — with the BOM
probed from the first bytes of the file each time the journal seeds (at
construction and again on a resync re-seed), never inferred
from a window's position, since a bounded tail window does not begin at the
file start and cannot tell you whether the file opened with a BOM. Exactly
one leading BOM is stripped; a BOM code point anywhere else in the file is
content.

## The watcher and activation

A missing journal is a legal state: layer construction never fails on a
missing journal file, since a consumer must be able to wire its layer
graph before deciding to create the file — that is "missing", not
"unreadable," and construction *can* fail typed on a journal that is
present but unreadable, since a permissions fault is a real fault about a
real file. "Missing" is decided by one `stat` whose `NotFound` reason maps
to absence, not by an existence check followed by a separate `stat` that
the file could vanish between; construction likewise tolerates a file that
vanishes between that `stat` and the seed read, constructing as if it had
never existed. The same mapping is how `append` and `query` raise
`JournalNotFound`. The watcher activates once the file exists, and the watch is
armed *before* the catch-up read: the invariant is "no window in which the
file can grow while nothing is watching and nothing will re-read." The
other order (ingest, then arm) leaves an unguarded sub-5ms window in which
a written line is invisible until some later filesystem event triggers a
re-read — measured at 1.5s of undelivered staleness in one probe, arriving
only when the *next* append's event fired.

The ordering is achieved by scheduling, not synchronization, because the
platform watch exposes no registration signal to wait on: the
implementation forks the watch consumer and yields a tuned number of times
before running the catch-up read, and the invariant is guarded by a
deterministic arming-window test rather than trusted as timing folklore.
Ingest runs under its own one-permit semaphore, which serializes ingests
against each other — two overlapping runs would read the same consumed
offset and publish the same lines twice — so a poke arriving mid-ingest
waits there rather than on the write permit. The gap read itself is taken
under the write permit, because an append may have consumed the pending
bytes while the ingest waited; it reads forward in bounded pages, like
every region read in the package, and the publish happens after the permit
is released, under the same ordering baton as an append.

A parent-directory watch was assumed as the activation mechanism, then
falsified by a probe: on the installed node backend, a directory watch
reports both file creation and append as removal, and the event's path is a
bare relative basename that resolves against the process working directory
rather than the watched one — an upstream defect. Four constraints bind
activation as a result: never branch on the event tag (any directory event
whose path basename matches the journal filename is an untyped poke
meaning "go re-stat yourself"); never use the event's path to open or read
anything, on any watch; re-arm the file watch after a resync, since node
watchers follow the inode and a replaced file leaves the old watch attached
to nothing; and the directory watch is activation-only and must end once
the file exists, since a non-recursive directory watch does not reliably
report a child file's content appends.

The package does not use core's `WatchBackend`: it calls `watch` through
the `FileSystem` service, so the deterministic test seam is the
`watch` member of the test filesystem (an `@effected/memfs` volume with
`watch` faulted to a manually driven stream) and its before-watch hook — this is what
covers offset bookkeeping, the re-arm path and the resync path without
racing a real filesystem or sleeping. `WatchBackend` remains this design's
named upgrade for synchronous registration, considered and deferred rather
than used.

## What the concurrency tests must actually arrange

Three of this package's tests are structurally incapable of testing what
they appear to test unless arranged deliberately:

- **A hub with no subscribers accepts every publish immediately.** A stall
  or deadlock test therefore proves nothing unless it holds a real
  subscription that is at capacity; without one there is no backpressure to
  observe and the test is green by construction.
- **The completed-appends-precede-the-end test needs three appends.** With
  two, the hub's FIFO ordering of blocked publishers drains the pending
  publish and the direct end signal in the right order by accident, and the
  mutant survives. A third makes the end signal register *between*
  baton-chained publishers, the only arrangement that can observe the
  violation.
- **A prototype-pollution test must sit directly on the merge primitive,
  never downstream of a schema boundary.** Placed downstream, the hijacked
  object is transient, so the observable output is always clean while the
  hazard is real.

The arming-window test earns a place beside them: its write must land
*after* construction, inside the window itself; placed before construction,
the seeding read covers it and the test passes against the very bug it
exists for.
