# @effected/jsonl

Append-only, schema-validated JSONL journals as a definable Effect service: an event registry plus an envelope contract (`at`/`event`/`scope`/`data`), a pure synchronous core for runtime-free readers, and one `Journal` service whose scoped layer watches the file so cooperating writers cross-observe each other's appends. Boundary tier: `FileSystem` required in `R` (`Path` deliberately not — paths are opaque strings), zero external runtime dependencies, zero `@effected/*` edges.

## Import

```ts
import { Envelope, Journal, JsonlEvent, Line } from "@effected/jsonl";
```

**Platform**: a journal layer does real IO — provide `FileSystem` once at the edge (`NodeFileSystem.layer` or the Bun equivalent). `Line` and `Envelope` are the pure core: synchronous, `Result`-based, no service to provide, usable from a hook script with no Effect runtime at all.

## Core API

- **`JsonlEvent.make(tag, { data, terminal?, reopen? })`** — defines one event: a string tag, the payload schema (`data` bounded to `Schema.Codec<unknown, unknown, never, never>` — no services in either direction, so a schema needing one fails at registration), and two lifecycle flags. `terminal: true` marks the event quiescent — once it is the tail, further appends fail `TerminalViolation` unless the appending event is `reopen: true`. A `const` array of definitions is the registry; the envelope union is derived from it.
- **`Journal.Service<Self>()(id, { events, config })`** — a per-registry service class. `config` is `{ path, directory?, capacity?, shutdownPublishTimeout? }`, or an `Effect` producing one (resolve a path from `Config` or another service when the layer builds). The class carries a static **`layer` value** — provide it as often as you like, it is one journal — and **`make(config)`** for a path known only at run time: `Layer.effect(Class, Class.make(config))`, bound once, since every build is an independent journal. A *missing* journal constructs cleanly; one that exists and cannot be read fails with `PlatformError`.
- **`JournalShape`** (the service surface):
  - `append(event, data, { scope? })` — validates, encodes, one `writeAll` of the complete line to an `O_APPEND` handle; `at` is stamped from the Effect `Clock`, never caller-supplied.
  - `appendPatch(event, patch, { scope? })` — **shallow**-merge `patch` over the current state's `data`, validate, append; read and write under one lock.
  - `latest: Effect<Option<Envelope>>` — the last valid envelope; `latestChanges: Stream<Option<Envelope>>` — the current value, then every change.
  - `quiescent: Effect<boolean>` — the tail is a terminal event.
  - `query(slice?)` — historical, finite, **paged** `Stream`: memory is a page plus the longest line, and stopping early stops the reading.
  - `changes(slice?)` — live `Stream`; with a `cursor`, replay and tail are one seam (no gap, no duplicate). Ends on a terminal event or scope close; fails `JournalResync` if the file is truncated or replaced.
  - `projection(initial, fold, slice?)` — `changes` folded with `Stream.scan`.
  - `create` / `remove` — explicit file lifecycle; nothing materializes the file implicitly.
- **Envelopes** carry `at`, `event`, `scope?`, `data` and **`position: { offset, end }`** — UTF-8 byte offsets. `position.end` is the resume cursor. The raw line text is not kept on an envelope; errors carry the full `LineSlice`.
- **`Slice<R, T>`** — the one filter shape every read surface takes: `events?` (narrows the stream's element type to those variants), `scopes?`, `from?` (**inclusive**), `to?` (**exclusive**, so adjacent windows tile), `cursor?` (resume from a byte offset; a cursor inside a line skips that line), and **`onInvalid?: "skip" | "fail"`** (default `"skip"`) for lines that cannot be decoded. A line whose frame does not match the slice is never decoded further and cannot fail it; one that cannot be framed counts against every slice.
- **Error types per operation** — `AppendError`, `QueryError`, `ChangesError`, so an exhaustive `catchTags` never handles an impossible tag. `DecodeError` (`MalformedLine | InvalidData | UnknownEvent`) reaches a read only with `onInvalid: "fail"`. An unregistered tag passed to `append` is a defect, not an error — the typed surface rules it out.

| Tag | Recovery |
| --- | --- |
| `MalformedLine` | Not valid JSON. `line.terminated === false` is a torn tail a writer may still complete; `true` is a permanent hole. |
| `UnknownEvent` | A tag this registry doesn't define — foreign or other-version input; skip forward. |
| `InvalidData` | JSON but not an envelope, or a payload its schema rejects. `error` carries the full `SchemaError`; `line` is absent when the failure came from encoding an append. |
| `UnserializableData` | Payload validated but `JSON.stringify` threw (a `bigint` or a cycle) — change the payload's *shape*. |
| `TerminalViolation` | Append after a terminal tag by an event not marked `reopen`. |
| `JournalClosed` | Append refused because the layer's scope is closing. |
| `JournalNotFound` | The journal file does not exist — call `create` first. |
| `JournalResync` | The file was truncated or replaced beneath a reader. Discard cursor-derived state and re-read; the journal itself re-adopts the file as it now is. |

- **The pure core** — `Line.split(text, base?)` (byte-exact offsets, CRLF-aware, shifted by `base` when the text starts mid-file), `Line.parseResult`, `Line.byteLength`; `Envelope.decodeResult`, `decodeAllResult(events, text, base?)`, `lastValid(events, text, base?)`, `encodeResult`. **`Envelope.lastValid` is the definition of "the journal's current state"**: validity is judged at the envelope, so a torn *scalar* tail (`42` cut to `4`) — valid JSON, wrong value — is stepped over. Lift any of them with `Effect.fromResult` where a program wants an `Effect`.

## Usage

```ts
import { Journal, JsonlEvent } from "@effected/jsonl";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Schema } from "effect";

const MailReceived = JsonlEvent.make("mail-received", { data: Schema.Struct({ round: Schema.Number }) });
const Unlinked = JsonlEvent.make("unlinked", { data: Schema.Void, terminal: true });
const events = [MailReceived, Unlinked] as const;

class MailJournal extends Journal.Service<MailJournal>()("app/MailJournal", {
  events,
  config: { path: ".claude/dogfood/silk.jsonl" },
}) {}

const program = Effect.gen(function* () {
  const journal = yield* MailJournal;
  yield* journal.create;
  yield* journal.append("mail-received", { round: 7 }, { scope: "silk-runtime-action" });
  return yield* journal.latest; // Option<Envelope>
}).pipe(Effect.provide(MailJournal.layer), Effect.provide(NodeFileSystem.layer));
```

A slice-filtered subscription — a consumer sharing the file with a noisy neighbour pays nothing for the neighbour's payloads, because filtering runs on the envelope frame before the payload schema decodes `data`:

```ts
import { Stream } from "effect";

const changes = journal.changes({ events: ["mail-received"], scopes: ["mailbox-a"] });

// Lossless — a missed envelope is a bug.
yield* Stream.runForEach(changes, (envelope) => Effect.log(envelope.data));

// Latest-wins — only the current state matters.
const queue = yield* Stream.toQueue(changes, { capacity: 16, strategy: "sliding" });
```

Resuming across restarts — persist `position.end`, pass it back as `cursor`:

```ts
const rest = journal.query({ cursor: savedCursor, events: ["mail-received"] });
```

The runtime-free read path — a hook script reads the current state with no Effect runtime, from the whole file or a tail of it that starts at a line boundary:

```ts
import { Envelope } from "@effected/jsonl";
import { Option } from "effect";

declare const tailText: string; // e.g. the last few KB of the file, from its first full line
declare const tailStart: number; // the byte offset tailText starts at

const state = Envelope.lastValid(events, tailText, tailStart);
if (Option.isSome(state)) {
  state.value.data;         // the decoded payload of the last valid envelope
  state.value.position.end; // a resumable cursor
}
```

## Testing machinery

No exported test layer — a journal requires a real `FileSystem`, so tests provide `@effected/memfs`. The package's own `__test__/helpers/memfs.ts` is the pattern to copy: an `@effected/memfs` handle whose storage, inodes and `O_APPEND` are memfs's own, with faults layered on for the seams a journal test needs — the real `watch` replaced by a manual registry (`poke(path)` drives watch events deterministically), write and read gates to assert ordering without wall-clock timing, `replace` to model a new inode, and `readRequests()` to assert read sizes. Fault handlers (`failTimes`, per-method interception) model `NotFound`, `PermissionDenied` and a file vanishing mid-operation. Real-filesystem behavior (`O_APPEND` under concurrency, an actual `fs.watch`) belongs in an integration suite against real temp directories.

**Under `TestClock`, advance the clock for graceful shutdown to complete.** Scope close bounds its wait on outstanding publishes with `shutdownPublishTimeout` (default five seconds); a virtual clock never elapses it on its own.

## Gotchas

- `appendPatch`'s merge is **shallow only** — a nested object in the patch replaces the one beneath it.
- `data` is required on the wire even for a payload-less event: `Schema.Void` emits `"data":null`.
- "Current state" means the last valid **envelope**, never merely the last valid JSON — use `Envelope.lastValid` or the journal's `latest`.
- A missing journal file is a legal, quiet state: construction never fails on one, and the watcher activates once the file appears. `append` and `query` fail `JournalNotFound` rather than materializing it.
- A line counts once its `\n` lands: `query` and `changes` leave an unterminated tail out (it may be a writer mid-append) and deliver it when it completes.
- `query` **skips** undecodable lines by default. Pass `onInvalid: "fail"` when a hole in the history must stop the read.
- Truncation or replacement underneath a reader is surfaced as `JournalResync`, never silently repaired.
