# @effected/jsonl

Append-only, schema-validated JSONL journals as a definable Effect service: an event registry plus an envelope contract (`at`/`event`/`scope`/`data`), a pure synchronous core for runtime-free readers, and one `Journal` service whose scoped layer watches the file so cooperating writers cross-observe each other's appends. Boundary tier: `FileSystem` required in `R` (`Path` deliberately not — paths are opaque strings), zero external runtime dependencies, zero `@effected/*` edges.

## Import

```ts
import { Journal, JsonlEvent, Line, Envelope } from "@effected/jsonl";
```

**Platform**: `Journal.layer` does real IO — provide `FileSystem` once at the edge (`NodeFileSystem.layer` or the Bun equivalent). `Line` and `Envelope` are the pure core: synchronous, `Result`-based, no service to provide, usable from a hook script with no Effect runtime at all.

## Core API

- **`JsonlEvent.make(tag, { data, terminal?, reopen? })`** — defines one event: a string tag, the payload schema (`data` bounded to `Schema.Codec<unknown, unknown, never, never>` — no services in either direction, so a schema needing one fails at registration), and two lifecycle flags. `terminal: true` marks the event quiescent — once it is the tail, further appends fail `TerminalViolation` unless the appending event is `reopen: true`. A `const` array of definitions is the registry (`JsonlEvent.Registry`); the derived envelope union comes from it, never a hand-written `Schema.Union`.
- **`Journal.Service<Self>()(id, { events })`** — a per-registry `Context.Service` class factory (mirrors `ConfigFile.Service<Self, A>()(id)`). Extend it for identity: `class MailJournal extends Journal.Service<MailJournal>()("app/MailJournal", { events }) {}`. Its static `.layer(config: { path, directory?, capacity?, shutdownPublishTimeout? })` builds a scoped `Layer<Self, PlatformError, FileSystem.FileSystem>` — a *missing* journal constructs cleanly, but one that exists and cannot be read fails typed rather than as an uncatchable defect. **Bind the layer to a `const` and provide that const** — calling `.layer(...)` twice mints two independent journals (two semaphores, two hubs, two `latest` refs) over the same file, unserialized against each other; layers memoize by reference, not by config equality.
- **`JournalShape`** (the service surface) — `append(event, data, { scope? })` (validates, encodes, one atomic `writeAll` of the complete line, serialized by a one-permit semaphore; `at` is stamped from the Effect `Clock`, never caller-supplied); `appendPatch(event, patch, { scope? })` (read the last valid envelope, **shallow**-merge `patch` over its `data` under the same write lock, validate, append — the `journal-append.sh` inherit-and-patch idiom as a typed API); `latest: SubscriptionRef<Option<Envelope>>` (the current last valid envelope); `quiescent: Effect<boolean>` (derived from `latest`, never tracked separately); `query(slice?)` (historical, finite `Stream`); `changes(slice?)` (live `Stream`, replay-from-`cursor` plus tail as one seam, ends on a terminal event or scope close); `projection(initial, fold, slice?)` (a running fold, scoped to its own slice); `create` / `remove` (explicit file lifecycle — a missing journal is legal; nothing materializes it implicitly).
- **`Slice<R, T>` / `CursoredSlice<R, T>`** — the one filter shape every read surface takes: `events?` (narrows the stream's element type to those tag variants), `scopes?`, `from?` (**inclusive**), `to?` (**exclusive** — half-open, so adjacent time windows tile without double-delivering an envelope on the seam), plus `cursor?` (a `CursoredSlice`) to resume from a logical byte offset. All fields combine with AND; an omitted field does not filter, an empty `events: []` or `scopes: []` matches nothing.
- **The eight-tag error taxonomy** (`JsonlError`) — every tag names a distinct recovery, causes carried structurally (never stringified), `PlatformError` passes through untranslated rather than joining the union.

| Tag | Recovery |
| --- | --- |
| `MalformedLine` | Not valid JSON. Check `line.terminated`: `false` means an unterminated fragment — only completion of the same interrupted write can make it valid, not a later append (which starts after the partial bytes); if the writer never returns, it is a permanent malformed tail. `true` means a permanent hole. |
| `UnknownEvent` | A tag this registry doesn't define — treat as hostile/foreign-writer input, skip forward, do not crash the reader. |
| `InvalidData` | JSON but not an envelope, or an envelope whose `data` failed its registered schema. `error` carries the full `SchemaError` issue tree. |
| `UnserializableData` | Payload validated but `JSON.stringify` threw (a `bigint` or reference cycle) — the caller must change the payload *shape*, not the value. |
| `TerminalViolation` | Append attempted after a terminal tag, by an event not marked `reopen`. |
| `JournalClosed` | Append refused because the layer's scope is closing/closed — a lifecycle fact, not a recoverable state. |
| `JournalNotFound` | Operation against a journal that doesn't exist yet — call `create` first. |
| `JournalResync` | The file was truncated or replaced beneath a reader (`reason` distinguishes them; recovery is the same either way) — discard cursor-derived state and re-read. |

- **The pure core** (`Line`, `LineSlice`, `Envelope`, `EnvelopeFrame`) — no `FileSystem`, no `Effect` in the primitive signatures. `Line.split`/`parseResult`/`parseAll`/`lastValid` know JSON, not envelopes. `Envelope.lastValidResult(events, text)` — not `Line.lastValid` — is the binding definition of "the journal's current state": a torn *scalar* tail (`42` cut mid-write leaves `4`) parses as valid, different JSON, and only the envelope contract (every envelope is an object) catches it. `Envelope.decodeResult`/`encodeResult` are the sync primitives; `Envelope.decode`/`encode` are one-line `Effect.fromResult` lifts of the same code, so the two forms cannot drift.

## Usage

Define a registry, build the journal layer once, append and read the current state:

```ts
import { Journal, JsonlEvent } from "@effected/jsonl";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Schema, SubscriptionRef } from "effect";

const MailReceived = JsonlEvent.make("mail-received", { data: Schema.Struct({ round: Schema.Number }) });
const Unlinked = JsonlEvent.make("unlinked", { data: Schema.Void, terminal: true });
const events = [MailReceived, Unlinked] as const;

class MailJournal extends Journal.Service<MailJournal>()("dogfood/MailJournal", { events }) {}

// Bind ONCE — a second call mints an unserialized second journal over the same file.
const MailJournalLive = MailJournal.layer({ path: ".claude/dogfood/silk.jsonl" });

const program = Effect.gen(function* () {
  const journal = yield* MailJournal;
  yield* journal.create;
  yield* journal.append("mail-received", { round: 7 }, { scope: "silk-runtime-action" });
  // `latest` IS the ref, not an effect that yields one: read it with the
  // standalone accessor.
  return yield* SubscriptionRef.get(journal.latest); // Option<Envelope>

}).pipe(Effect.scoped, Effect.provide(MailJournalLive), Effect.provide(NodeFileSystem.layer));
```

Slice-filtered subscription — a consumer sharing the file with a noisy neighbour pays nothing for the neighbour's payloads, because filtering runs on the envelope frame strictly before the registered payload schema decodes `data`:

```ts
import { Stream } from "effect";

const changes = journal.changes({ events: ["mail-received"], scopes: ["mailbox-a"] });

// Lossless — an auditor or projection where a missed envelope is a bug.
yield* Stream.runForEach(changes, (envelope) => Effect.log(envelope.data));

// Latest-wins — a status display where only the current state matters.
const queue = yield* Stream.toQueue(changes, { capacity: 16, strategy: "sliding" });

// Batch-draining — amortize work across a burst with a bounded queue plus takeAll.
const batched = yield* Stream.toQueue(changes, { capacity: 64, strategy: "suspend" });
```

The pure-core, runtime-free read path — the whole point of acceptance criterion 2: a `PreToolUse` hook script reads the current state with no Effect runtime, just a bounded tail read and `Envelope.lastValidResult`:

```ts
import { Envelope } from "@effected/jsonl";
import { Option } from "effect";

declare const tailText: string; // e.g. the last few KB of the file, read with node:fs

const state = Envelope.lastValidResult(events, tailText);
if (Option.isSome(state)) {
  state.value.data;       // the decoded payload of the last valid envelope
  state.value.line.end;   // its byte offset, for a resumable cursor
}
```

## Testing machinery

No exported test layer — `Journal.layer` requires a real `FileSystem.FileSystem`, so unit tests double it directly rather than through a package-provided fake. The package's own `__test__/helpers/memfs.ts` is the pattern to copy: a tiny `FileSystem.layerNoop` implementation covering only `exists`/`stat`/`remove`/`open`/`watch`, with a deterministic `poke(path)` to drive watch events explicitly instead of racing a real filesystem, `closeGate`/`openGate`/`gateWasEntered` to assert write-ordering without wall-clock timing, and `replace`/`mkdir` to model inode-identity changes and pre-existing-directory activation. Real-filesystem behavior (`O_APPEND` atomicity under concurrency, actual `fs.watch`) is deliberately NOT simulated — that lives in `__test__/integration/` against real temp directories (`makeTempDirectoryScoped`) with `@effect/platform-node`, the only suite with a real platform layer. The flagship integration test is two `Journal` layers over one file cross-observing each other's appends through the watcher.

There is no `WatchBackend` service seam in `R` — the design considered one (a `FileSystem.WatchBackend`-style registration point pluggable per backend) but the shipped `Journal` engine calls `fs.watch` directly; that idea is flagged in `Journal.ts` as a future ruling, not something a consumer can substitute today.

**A consumer testing under `TestClock` must advance the clock for graceful shutdown to complete.** Scope close bounds its wait on the outstanding publish chain with `Effect.timeout` (`shutdownPublishTimeout`, default five seconds); under a virtual clock that timeout never elapses on its own, so a test exercising shutdown must `TestClock.adjust` past the bound or the finalizer hangs for the real wall-clock duration.

## Gotchas

- `Journal.Service<Self>()(id, { events }).layer(...)` returns the layer from a function call — bind it to a `const` before providing, exactly like `ConfigFile.layer`/`Store.layerSqlite`.
- `appendPatch`'s merge is **shallow only** — a nested object in the patch replaces the one beneath it rather than merging into it. Deep merge is explicitly out of scope; it is a design amendment, not a local choice, if a real need appears.
- `data` is required on the wire even for a payload-less event: `Schema.Void` still emits `"data":null` (`JSON.stringify` drops `undefined`-valued keys, and JSON has no `undefined` — `null` is its spelling of absence).
- "Last valid line" always means the last valid **envelope**, never merely the last valid JSON — `Line.lastValid` stops at JSON validity, which a torn scalar tail can satisfy with corrupted data; use `Envelope.lastValidResult` (or `Journal`'s `latest`) for the real contract.
- A missing journal file is a legal, quiet state: `Journal.layer` construction never fails on one, and the watcher activates once the file appears. `append`/`query`/`latest` fail typed `JournalNotFound` rather than materializing the file implicitly — call `create` first.
- Truncation or replacement underneath a reader is surfaced as `JournalResync`, never silently repaired by re-reading from zero — that would paper over a real operational fault (a rotating log shipper, a `>` where `>>` was meant).
