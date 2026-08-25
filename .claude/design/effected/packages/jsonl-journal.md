---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - jsonl.md
  - jsonl-reads.md
  - ../effect-standards.md
  - config-file.md
---

# @effected/jsonl — the journal service

## Overview

The journal service is the write half of [`@effected/jsonl`](jsonl.md): the operations, the write critical section and the ordering that hangs off it, lifecycle and shutdown, and the process model that lets several cooperating writers share one file. What it guarantees is the property every reader depends on — an appended line is complete, validated against its event's schema, ordered against every other writer's, and observable to them once it lands.

Everything that consumes those lines — the `Slice` vocabulary, `query`, `changes` and `projection` — is [the read half](jsonl-reads.md), and the [envelope contract](jsonl.md#the-envelope-contract) each line obeys belongs to the package doc, since both halves are built on it.

The service is one class per registry ([the factory](jsonl.md#the-service-is-a-factory-not-a-generic-key)); its layer takes a config of a path plus three optionals — the activation-watch directory, the hub capacity and the shutdown drain bound — and its lifecycle is scoped. The layer's error channel is `PlatformError`: **a missing journal constructs cleanly, an unreadable one fails typed.**

## Operations

See `src/Journal.ts`. The shapes worth knowing before reading it:

- **`append`** validates against the event's registered schema, encodes, then writes the complete line to a handle opened for append, under the terms in [the append primitive](#the-append-primitive-and-what-atomicity-actually-means). In-process concurrency is serialized by a one-permit semaphore. Appending after a terminal event fails typed unless the appended event is declared `reopen`, and **appending to a journal that does not exist fails typed — an append never creates the file.**
- **`appendPatch`** is inherit-and-patch: read the last valid envelope, merge the patch over its payload, validate the result, append. **The whole read-merge-validate-append sequence is atomic under the append permit**, not merely the write. It is a read-modify-write, and with the read outside the lock two patches to *different* fields of one snapshot produce a deterministic lost update — the second silently reverting the first. That is inherit-and-patch's exact use case, so the narrower lock would have been wrong precisely where the operation is used most.
- **`latest`** is a subscribable observable of the current last valid envelope, plus a quiescent signal once a terminal event is the tail. Watching state is the common case, and making it a ref rather than a fold is what keeps the common case one line. It is served by a [bounded tail read](jsonl-reads.md#the-bounded-tail-read-is-the-sanctioned-cheap-read), never a whole-file read. **The quiescent signal is *derived* from `latest`** rather than being a second piece of state, because a separate ref could drift out of agreement with it and a derivation cannot.
- **`create` / `remove`** are explicit file lifecycle, so "the journal does not exist yet" is a decision the consumer makes rather than a side effect of the first append.

**No sidecar index.** A linear scan is the honest answer: an index is a second source of truth that an external writer — which the [process model](#process-model-cooperative-writers-always-watching) explicitly permits — can invalidate without notice, and reconciling it correctly is a larger problem than the one the package is solving. If scan cost ever bites, the fix is a cursor the consumer persists, which the API already hands out.

### The merge guard is asymmetric, and config-file's is not

`appendPatch`'s merge guard requires both sides to be record-like **and** the patch not to bring a conflicting prototype — it may be plain, null-prototype, or the base's own.

The asymmetry is forced by the primary use case rather than chosen for elegance. A caller's partial patch is a **plain object literal even when the base is a schema-class instance**, so [`config-file`'s *symmetric* guard](config-file.md) — both sides record-like and sharing a prototype, which is exactly right for merging two peer documents — would reject the main case here. Same hazard, different shape of operands; the pollution filtering is identical and only the prototype rule differs.

Outside that domain — cross-prototype, scalar, array or void bases — the patch **replaces** rather than merges, and a *partial* patch against such a base then fails typed **naming the missing keys**, which is the honest outcome: the caller asked to patch something with no fields to inherit.

**What a symmetric guard would cost here is loudness, not loss** — probed rather than assumed. It rejects a class-payload patch outright, making `appendPatch` unusable against the payload shape it is most used with; it does not quietly drop fields. The asymmetry is bought to keep that case working, not to close a silent-loss hazard.

## The append primitive, and what atomicity actually means

The naive claim — "one `writeAll` is one `write(2)`" — is **false**, and the design must not rest on it:

- `File.writeAll` **recurses on partial writes**. It is a loop that keeps writing until the buffer is exhausted, so it can issue more than one syscall for one line.
- `File.write` is the single syscall, but it returns a byte count and **may short-write**, which would tear a line just as surely.

So **no API guarantees one syscall per line**. The corrected position:

- The primitive is `writeAll` on a handle opened for append. Atomicity is an **OS property of `O_APPEND` writes to a regular file at reasonable line sizes**, not an API guarantee: under `O_APPEND` the kernel makes the offset-seek and the write one operation, so concurrent appenders cannot overwrite each other.
- What remains is a **short write** — a signal interrupting the call, a filesystem limit, a full disk — after which the loop's next iteration writes the remainder as a separate operation another writer can interleave with. There is **no byte threshold** below which this is impossible; `PIPE_BUF` is a pipe concept and does not govern regular files.
- The **line-size caveat is part of the contract**: the larger a journal line, the more opportunity a short write has to split it, and a split line is a torn tail. Consumers whose payloads can grow without bound are told so rather than left to discover it.
- **A failure from the loop is never silently ignored.** `writeAll` reports no byte count, so by construction it either wrote the whole buffer or failed; there is no partial-success value to inspect and no code should try. **Any `PlatformError` out of an append surfaces typed and is treated as a possibly-torn tail** that readers walk back over.

Evidence from the opposite direction: the stalled-write guard is not hypothetical — it fires on a **zero-byte** `writeAll`, which is the obvious way to implement "touch the file". So `create` opens for append (which creates the file) and writes nothing at all. Recorded because that failure looks like a platform bug rather than a self-inflicted one.

## The publish stage sits outside the write critical section

The obvious implementation **deadlocks by construction**: the hub publish backpressures, so a *suspending* publish inside the append critical section plus one stalled subscriber wedges every writer — and then wedges scope close too, because the finalizer waits to drain the very permit the suspended publish holds. A slow reader takes down the writer, which is the opposite of the intended failure mode.

Four pins resolve it:

1. **The write critical section covers the file write and the ref updates only.** A suspending hub publish never sits inside it.
2. **Publish order equals write order**, preserved by a dedicated ordering stage whose slot is acquired *under* the write permit and executed *outside* it. Order is a property of acquisition, not of execution, which is what lets the publish leave the lock without becoming reorderable.
3. **Backpressure is unchanged.** An append completes only once the hub has accepted its envelope, so a slow subscriber's pressure lands **visibly on appenders** rather than as a silent drop. Moving the publish out of the lock must not weaken this — the append still waits, it just no longer waits *holding the write permit*.
4. **The terminal-drain at shutdown is bounded**, with the limit stated honestly: a subscriber that keeps consuming observes stream end, and one that never consumes again cannot observe completion through a channel it refuses to read — and, the point of bounding it, **does not hold scope close hostage**.

Two shapes are rejected on the record. **Publishing inside the permit** is the deadlock above. An **unbounded staging queue** between the write and the publish would decouple them cleanly and silently break pin 3: appends would complete before the hub accepted anything, so a slow subscriber would become an invisible memory leak instead of a visible stall.

### The ordering stage is a chained-deferred baton

The mechanism satisfying pin 2 without violating pin 1. Each append, **while holding the write permit**, links a fresh `Deferred` onto a chain — linking is non-suspending and O(1), which is the entire reason it is legal inside the critical section. It then releases the permit, awaits its predecessor, publishes, and passes the baton on via `ensuring`, so an interruption mid-publish cannot strand its successors.

**Rejected refinement, on the record:** a *second semaphore* acquired under the write permit. It looks equivalent and is not — when contended it suspends inside the critical section, which is pin 1's exact prohibition and reintroduces the deadlock through a smaller door. The ordering primitive must be one that can be *taken* without ever *waiting* while the write lock is held.

### The append path reads inside the write permit, and publishes external bytes first

Recorded explicitly so a later reader does not mistake it for a pin-1 violation and "fix" it back into a bug. **Pin 1 prohibits *suspending on a subscriber* inside the critical section, not reading the file inside it.** A bounded read cannot be wedged by a stalled consumer, so it is legal there — and it is necessary there, because a cooperating writer's bytes that landed since our last ingest must be reconciled *before* our own line goes on the end, or the journal's order and the hub's order disagree. Those external bytes are published **before** our own envelope, on **one** baton slot: one slot, not two, is what makes the pair indivisible against another appender's slot, and that is what makes hub order equal file order.

**The residual, named honestly — and it is worse than an ordering skew.** An external write landing **between our write and our size probe** is a TOCTOU with three demonstrated consequences: our own line's reported offset is wrong by the length of the external write, so every cursor derived from it is off by that much; **the interleaved external line is silently dropped**, because advancing the consumed offset to our computed end skips straight past it; and **our own line is published twice**, because the next gap decode re-covers the region our append already published. A silent drop is precisely what the cooperative-writer contract claims not to do, which is why it is stated here rather than filed as "an ordering issue".

The window is genuinely tiny — between two syscalls, both under the write permit — so this is a rare interleaving rather than a routine one. What does **not** stand is the tempting claim that no lock-free scheme closes it, which conflates prevention with detection:

- **Prevention is impossible lock-free.** `O_APPEND` gives the writer no way to learn where its bytes landed, so nothing short of the advisory lock [the process model rejects](#process-model-cooperative-writers-always-watching) makes the write-and-locate pair atomic — and against a shell script with `>>` such a lock would not be honored anyway.
- **Detection is possible lock-free, and is declined on cost.** A read-back verification comparing the written region against what was written would catch all three, at one extra read per append. That is a real trade with a real number attached, refused because the append path is the latency-sensitive one, and written down so the option is a standing decision rather than an unexplored corner.

### Completed appends precede the terminal signal

The obvious phrasing of pin 4 is weaker than the guarantee: **every append that *completed* is delivered before the terminal end-of-stream.** Per-append hub acceptance does not compose into that property, for a specific reason — the terminal signal is not on the ordering chain, so nothing about the individual publishes orders it against them.

So the finalizer **captures the publish-chain tail under the write permit** — a consistent snapshot, since the baton is only mutated under that permit — and awaits it within the same bounded interruptible region before publishing the end signal. The hole is demonstrable rather than theoretical: without that capture the terminal signal overtakes an already-written envelope. It is invisible to the obvious test and visible only to a subscription in an **outer scope that outlives the journal's** — which is the shape a real consumer has, and the reason the test is written that way rather than the convenient way.

## Shutdown: refusal and drain are two mechanisms

A `Latch` cannot refuse: awaiting one suspends with **no failure channel**, so a closed latch makes a late append *hang*, which is the opposite of the intended behaviour. The split:

- **Refusal is an explicit closed flag**, checked *before* the append semaphore is taken, failing typed. Checking before the permit matters — a late append must not queue behind a draining flush only to be refused after waiting.
- **Drain is the latch's half.** The finalizer awaits in-flight work before publishing the end signal that completes subscriber streams, so the last accepted append is on disk and visible to subscribers before the streams end. A journal that loses its last append at shutdown is worse than one that refuses it.

The drain bound is configurable and **`Clock`-based**, so under a `TestClock` it fires only if the clock is advanced. That is Effect's timeout semantics rather than anything this package does, and it is the kind of thing that reads as a hang in a test that never advances time.

## Process model: cooperative writers, always watching

The decision: **instances of the same application cooperate under shared rules, and the service always watches the file.** Not single-writer-only, which real precedents already violate; not multi-writer locking, which buys correctness against arbitrary writers at a cost this file format does not justify.

External appends are a fact of JSONL life — a shell script, a second server, a human with `>>`. So the service watches for the life of the layer scope and tracks the byte offset of everything it has decoded. Its own appends advance that offset directly; on external growth it reads from the offset, decodes the new lines and feeds them into the same hub, the same `latest` and the same projections, so **a subscriber cannot tell a local append from an external one**.

Three edge behaviours are decided rather than left to discover:

- **A torn tail is tolerated, because the envelope makes it detectable.** A writer caught mid-write leaves a partial line; the walk-back skips it and the offset holds until the line completes. This works at the **envelope** layer, not the JSON layer — see [why the envelope is mandatory](jsonl.md#the-envelope-is-what-makes-a-torn-tail-detectable).
- **Truncation or replacement is a contract violation, surfaced not repaired.** If the file shrinks or is replaced, the cooperative contract has been broken, so the service raises a typed resync error rather than silently reconciling an inconsistency it cannot reason about. The recovery is uniform: discard cursor-derived state and re-read from zero.
- **No advisory locks.** The contract other writers must honor is: one write of a complete line, to a handle opened for append, keeping lines small enough that a short write is unlikely to split them. It is a discipline, not an enforced guarantee; a lock would only be honored by writers who had already agreed to cooperate, and would buy nothing against the shell script with `>>`.

**How the breach is detected**, which upgrades the obvious size-only check that catches half of it:

- **Replacement is detected by inode identity** — the device and inode pair captured at watcher activation and compared on each poke. This catches a **same-size-or-larger** replacement, which a size check structurally cannot see, and that is the common shape when a tool rewrites a file wholesale.
- **Truncation is a size below the consumed offset**, against the logical consumed offset.
- **The honest limit**: the inode is optional in the platform's stat, so where it is unreported only truncation is caught. A consumer on such a platform should know the guarantee is weaker there.

## A leading BOM is stripped at the service boundary, not in the core

Decided here rather than discovered later: a journal written by a BOM-emitting tool would otherwise have its **first line permanently malformed**, for every reader, forever.

- **The service's read boundary strips a single leading BOM, explicitly and at the byte level.** It does *not* get this from `FileSystem.readFileString`, whose silent strip is a documented [templates finding](templates.md). Journal reads are offset-based, so an implicit strip anywhere in the read path would silently desynchronize every offset the package hands out; the strip has to be a decision the code makes visibly, once, at the boundary.
- **The pure core does not strip.** It stays byte-honest and reports what it was given, because a core that quietly removed a leading code point would make its offsets disagree with the file — the one thing its offsets exist to do.
- **Offsets are logical post-BOM on *every* path** — tail reads, full scans and the append cursor seeded at construction — so the first line begins at offset 0 and a cursor round-trips against the same reader that produced it. The BOM length is determined **once, from the start of the file**, and **never inferred from a window's position**: a bounded tail window does not begin at the file start, so nothing about it can tell you whether the file opened with a BOM. A single physical-offset leak desynchronizes everything downstream, because the watcher builds its cursors on this convention.

Exactly one leading BOM is stripped. A BOM code point anywhere else in the file is content, and content is not the read boundary's to edit.

## The watcher and activation

### A missing journal is a legal state

Core's `watch` **stats the path first and fails if it does not exist**, which collides head-on with two other commitments — the layer watches for the life of its scope, and file creation is explicit. Resolved by decision:

- **Layer construction never fails on a missing journal file.** A consumer must be able to wire its layer graph before deciding to create the file. That is "missing", not "unreadable", and the distinction is in the layer's type: construction **can** fail typed on a journal that is present but unreadable, because a permissions fault is a real fault about a real file and is not swallowed into a working-looking service over a journal nobody can read.
- **The watcher activates once the file exists**, and the **watch is armed before the catch-up read** (below).
- **`append`, `query` and `latest` against a missing journal fail typed.** A first append never silently creates the file: a typo in a path would otherwise materialize a second, empty journal and look like a working system with no history.

### The watch is armed before the catch-up read

**Ordering is the whole of it**, and the invariant is stated so it can be checked against any future refactor:

> No window in which the file can grow while nothing is watching and nothing will re-read.

The other order — ingest, then arm — leaves an unguarded sub-5ms window, and a line written into it is **invisible until some later filesystem event triggers a re-read**. Measured: an append racing the arm sat undelivered for 1.5s and arrived only when the *next* append's event fired. In a quiet journal the next event may be minutes away, so the real symptom is **unbounded staleness on a subscription that looks healthy**.

Two consequences of arming first are benign and deliberate: a redundant ingest is a no-op, short-circuited by an early return when nothing new is on disk, and concurrent ingests are serialized so overlapping ingests cannot double-publish.

**The ordering is achieved by scheduling, not synchronization**, and that is worth being honest about. The platform watch exposes **no registration signal** to wait on — both plausible hooks were probed and fail, since queue conversion does not register eagerly and the stream's start hook fires before acquisition. So the implementation forks the watch consumer and yields a tuned number of times before running the catch-up read, and the code says plainly that this is a heuristic. What makes a heuristic acceptable is that **the invariant is guarded by a deterministic arming-window test**: a write landing between seed and arming must be delivered with no second write to shake it loose, so a scheduler change fails CI loudly rather than silently reopening the window. **The named upgrade, if it ever fails**, is core's synchronous `WatchBackend` registration, at the cost of that service entering the layer's `R` — deferred until evidence demands it, but written down so the escalation is a decision rather than a rediscovery.

**Ingest runs under its own one-permit semaphore**, deliberately separate from the write permit. Sharing one would block appends behind a slow catch-up read of a large file, which is the wrong trade: catch-up is bulk work, appends are latency-sensitive, and the only thing that genuinely needs serializing is ingest against ingest.

**No polling fallback ships, and that is on evidence.** Across every probe the file watch delivered within a few milliseconds whenever it was armed before the write. The platform did its job; the ordering was ours. A poll would have masked a roughly ten-line ordering fix behind a timer, violated the no-timer posture permanently, and — decisively — would not even close the window, since only arming first does that. If some future platform is found to drop events *after* being armed, the `WatchBackend` seam is where that gets answered, not a timer.

### A parent-directory watch misreports events

The mechanism activation most obviously suggests — watch the parent directory until the journal appears — was **assumed, then falsified by a probe** against the installed node backend. On a directory watch, a file creation arrives as a removal, an append also arrives as a removal, and the event's path is a **bare relative basename** that resolves against the process working directory rather than the watched one. The cause is upstream: the callback's relative filename shadows the watched path, so the subsequent stat runs against the wrong directory, misses, and the failure branch labels everything a removal. A **direct watch on an existing file is clean**, so steady state is sound and only the activation edge is affected.

Four constraints therefore bind activation:

1. **Never branch on the event tag.** Any directory event whose path *basename* matches the journal filename is an **untyped poke** meaning "go re-stat the journal yourself". The tags are not trustworthy here. This needs no timer, so the no-polling posture survives the finding intact.
2. **Never use the event's path to open or read anything**, on any watch. The trap has a signature: reading it would fail against a nonexistent relative file and surface as a *phantom* not-found error for a journal that exists and is fine.
3. **Re-arm the file watch after a resync.** Node watchers follow the **inode**, so a replaced file leaves the old watch attached to a file nobody writes to any more — silently dead. Raising the typed resync error is necessary and not sufficient.
4. **The directory watch is activation-only and must end once the file exists**, handing observation to the file watch. A non-recursive directory watch does not reliably report a child file's content appends, so a journal left under directory observation goes quiet between events and a subscriber looks healthy while going stale — exactly the failure arming-first exists to prevent, reintroduced one layer up.

The underlying behaviour is a **genuine upstream defect** in the node platform package, recorded here as a candidate upstream issue so the finding is not lost if the workaround outlives the memory of why it exists.

**The activation-watch directory is configurable.** The watch has to name a directory and the layer takes a file path, so the config carries an optional directory. Omitted, it is derived from the path by separator-agnostic string arithmetic — everything before the last `/` **or** `\`, with the root and no-separator cases handled explicitly. Both separators are checked because a Windows path contains no `/` at all, and matching only on `/` there makes the whole path its own basename and silently points the activation watch at the process working directory. **This is the one sanctioned piece of path arithmetic in the package**, licensed for comparison and a single watch target only; naming the directory explicitly is the escape hatch for a path convention the derivation does not fit.

### The deterministic test seam is the FileSystem double

The package **does not use** core's `WatchBackend`: it calls `watch` through the `FileSystem` service, so the seam that makes watcher behaviour deterministic in tests is **the `FileSystem` test double's `watch`** and its before-watch hook. That is what covers offset bookkeeping, the re-arm path and the resync path without racing a real filesystem or sleeping.

`WatchBackend` remains a real core service and remains this design's **named upgrade** for synchronous registration — considered and deferred, not used. The distinction is worth keeping straight, because a reader who believes the package already depends on it will misjudge both the layer's requirements and what the deferred upgrade would cost.

### If the watcher flakes, suspect the filename drop first

Recorded so a future debugging session starts from evidence rather than folklore. The node watch backend **silently drops events whose filename is null** — a case the platform genuinely produces under load and on some filesystems — maps only a change event to an update, and re-stats on a rename to decide what happened.

So a dropped null-filename event is **hypothesis #1**, not "the platform watch is unreliable", which is the conclusion that leads straight to an unjustified polling timer. Both that drop and the create-as-remove misreport are **directory-watch** properties, and both were ruled out for the one real failure this package hit: the file watch proved reliable once armed, and the cause was activation ordering. They stand as real for the activation edge — they were simply not that, and reaching for them first sends the investigation to the wrong layer.

## What the concurrency tests must actually arrange

Three of this package's tests are structurally incapable of testing what they appear to test unless arranged deliberately. Each one *looked* correct and passed.

- **A hub with no subscribers accepts every publish immediately.** A stall or deadlock test therefore proves nothing unless it holds a **real subscription that is at capacity**; without one there is no backpressure to observe and the test is green by construction.
- **The completed-appends-precede-the-end test needs three appends.** With two, the hub's FIFO ordering of blocked publishers drains the pending publish and the direct end signal in the right order **by accident**, and the mutant survives. A third makes the end signal register *between* baton-chained publishers, which is the only arrangement that can observe the violation.
- **A prototype-pollution test must sit directly on the merge primitive, never downstream of a schema boundary.** Placed downstream — after the merged value has been encoded and re-decoded — the hijacked object is transient, so the observable output is always clean **while the hazard is real**. The invariant is asserted on the merge itself, with a prototype-integrity assertion and a throwing-setter fixture. The lesson generalizes past this package: a security invariant tested through a normalizing boundary is testing the boundary, not the invariant.

The arming-window test earns a place beside them: its write must land **after** construction, inside the window itself. Placed before construction the seeding read covers it, so the test passes against the very bug it exists for. A test for a race that does not straddle the race is the same failure mode as a pollution test downstream of a schema boundary.
