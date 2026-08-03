# @effected/jsonl

[![npm](https://img.shields.io/npm/v/@effected%2Fjsonl?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/jsonl)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Append-only, schema-validated JSONL journals as a definable Effect service. The subject is not the format — one JSON value per line is a two-sentence specification and needs no library — but the file as a live object: a journal that only ever grows, whose current state is its last valid line, whose tail may be torn mid-append, and which several processes read while one writes. Every line is an envelope (`at`, `event`, an optional `scope`, and a `data` payload validated by the schema you registered for that event), so a journal stays greppable, `jq`-able and diffable in a pull request while the reads that matter stay typed.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/jsonl

The naive way to consume a JSONL journal is to read the file and hand the whole thing to whatever asked — a model, a dashboard, a hook — which makes the cost of answering a question about the last line grow with the age of the file. Every read surface here takes the same filter instead: `query`, `changes` and `projection` all accept a `Slice` of events, scopes and a half-open time range, filtering runs on envelope fields, and no operation ever materializes the file in memory. Asking for the current state of one mailbox costs the tail of the journal; sharing a journal with a noisy neighbour costs nothing for the neighbour's lines.

The other half is that the read path works without an Effect runtime at all. `Line` and `Envelope` are synchronous and `Result`-returning, so a `PreToolUse` hook or a shell-adjacent script can walk back to the last valid envelope with no layer graph to build — and the service itself is held to the same bounded-tail discipline it asks of them.

## Install

```bash
npm install @effected/jsonl effect
```

```bash
pnpm add @effected/jsonl effect
```

Requires Node.js >=24.11.0. `effect` v4 is the only peer dependency, and the only dependency of any kind.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

`FileSystem` comes from `effect` core, not from a platform package, so a consumer provides it once at the edge (`NodeFileSystem.layer` from `@effect/platform-node` on Node). `Path` is deliberately not required — every path is an opaque string handed straight to `FileSystem`, and this package never joins, resolves or splits one.

## Quick start

Declare the events a journal may contain, mint a service class for that registry, and bind its layer once. `at` is stamped by the service from the Effect `Clock` — never by the caller — so two writers cannot disagree about ordering and `TestClock` controls it exactly:

```ts
import { Journal, JsonlEvent } from "@effected/jsonl";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Option, Schema, Stream, SubscriptionRef } from "effect";

const Snapshot = JsonlEvent.make("snapshot", {
  data: Schema.Struct({ round: Schema.Number, phase: Schema.String }),
});
const MailReceived = JsonlEvent.make("mail-received", {
  data: Schema.Struct({ from: Schema.String, subject: Schema.String }),
});
const Unlinked = JsonlEvent.make("unlinked", { data: Schema.Void, terminal: true });

const events = [Snapshot, MailReceived, Unlinked] as const;

class MailJournal extends Journal.Service<MailJournal>()("dogfood/MailJournal", { events }) {}

// Bind the layer ONCE, at module scope, and provide this const everywhere.
// Calling `.layer()` twice mints two independent journals over one file — two
// locks, two watchers, two sets of subscribers — whose appends are no longer
// serialized against each other.
export const MailJournalLive = MailJournal.layer({ path: ".claude/dogfood/mailbox.jsonl" });

const program = Effect.gen(function* () {
  const journal = yield* MailJournal;

  // File lifecycle is explicit: an append never creates the journal for you.
  yield* journal.create;

  yield* journal.append("snapshot", { round: 7, phase: "waiting" });
  yield* journal.append("mail-received", { from: "silk", subject: "round 7" }, { scope: "silk-runtime-action" });

  const latest = yield* SubscriptionRef.get(journal.latest);
  console.log(Option.isSome(latest) ? latest.value.event : "(empty journal)");
  // mail-received

  // One slice vocabulary on every read surface. With a `cursor`, the replayed
  // history and the live tail are one stream, filtered the same way.
  return yield* Stream.runCollect(
    journal.changes({ events: ["mail-received"], scopes: ["silk-runtime-action"], cursor: 0 }).pipe(Stream.take(1)),
  );
});

Effect.runPromise(program.pipe(Effect.provide(MailJournalLive), Effect.provide(NodeFileSystem.layer)));
```

`events: ["mail-received"]` narrows the stream's element type to that variant, so a projection over a slice is exhaustively checkable rather than a cast. An event marked `terminal` makes the journal quiescent once it reaches the tail: further appends fail typed unless the event is marked `reopen`, and every `changes` stream ends rather than hanging — including one whose slice excludes the terminal event, and including a subscriber that attaches after the fact.

## Reading a journal with no runtime

A hook script wants one answer — what is the current state — and should not build an Effect runtime or read the history to get it. The pure core takes a string, so the cheap read is a bounded tail window plus a walk back to the last valid envelope. Reading the whole file into `lastValidResult` would be the honest-looking demonstration of exactly the cost this package exists to avoid:

```ts
import { Envelope } from "@effected/jsonl";
import { Option } from "effect";
import { closeSync, openSync, readSync, statSync } from "node:fs";
// The same registry the writer declared, exported from your own module.
import { events } from "./events.js";

const readTail = (path: string, window: number): string => {
  const size = statSync(path).size;
  const start = Math.max(0, size - window);
  const bytes = new Uint8Array(size - start);
  const fd = openSync(path, "r");
  try {
    readSync(fd, bytes, 0, bytes.length, start);
  } finally {
    closeSync(fd);
  }
  const text = new TextDecoder().decode(bytes);
  // A window that does not start at 0 opens mid-line — drop that fragment.
  return start === 0 ? text : text.slice(text.indexOf("\n") + 1);
};

const current = Envelope.lastValidResult(events, readTail(".claude/dogfood/mailbox.jsonl", 8_192));
// Option.some(envelope) once a valid envelope is in the window.
// Option.none() means the last line is longer than the window, not that the
// journal is empty: widen the window and read again.
if (Option.isSome(current)) {
  current.value.event; // the tag
  current.value.line.end; // its logical byte offset, for a resumable cursor
}
```

"Last valid" always means the last valid **envelope**, never merely the last valid JSON. That distinction is what catches a torn tail: an envelope is always an object and every strict prefix of an object text is invalid JSON, whereas a torn scalar (`42` cut mid-write leaves `4`) parses cleanly as a different value that no walk-back can detect.

## Writers, watchers and what is actually guaranteed

The service watches the journal file for the life of its layer scope and tracks the byte offset of everything it has decoded, so an append by another process — a second service in a sibling repo, a shell script, a human with `>>` — arrives at your subscribers through the same stream as a local one. Nothing about the mechanism is a lock, and the guarantees are worth stating exactly:

- **The cooperative-writer contract is a discipline, not an enforced guarantee.** Every writer sharing a journal issues one `writeAll` of a complete, `\n`-terminated line to a handle opened `{ flag: "a" }` (`O_APPEND`). There are no advisory locks and no coordination protocol; a lock would only be honoured by writers who had already agreed to cooperate.
- **Atomicity is an OS property of `O_APPEND` at reasonable line sizes, not an API guarantee.** `writeAll` is a loop that can issue more than one syscall, so a short write can still split a line. The larger a line, the more opportunity there is to split it — keeping payloads bounded is part of the contract rather than an optimization.
- **A torn tail is tolerated; truncation or replacement is not repaired.** The unterminated fragment is walked over and the offset holds until the line completes. If the file shrinks or is replaced underneath a reader, that is a broken contract, and it surfaces as a typed `JournalResync` rather than a silent resync from zero.
- **The delivered-before-end guarantee is scoped to consuming subscribers.** Every append that completed is delivered before a stream ends, provided the subscriber keeps taking. A subscriber that stops taking cannot observe completion by definition, and shutdown will not wait on it past its bound (`shutdownPublishTimeout`, five seconds by default). That bound is `Clock`-based, so a test under `TestClock` must advance the clock or the finalizer looks like a hang.
- **Filter-before-decode is structural on the disk paths.** For `query` and the replayed half of `changes`, a non-matching line's payload schema is never invoked at all. Live envelopes arrive already decoded, because the appender decoded its own payload in order to return it — so a filtered-out live envelope was decoded once, by its writer, and not again by each subscriber.
- **A missing journal is a legal state.** Building a layer over a path that does not exist yet is legal and produces a working service that starts watching once the file appears. `create` and `remove` stay explicit, and `append`, `query` and `latest` fail typed until the file exists — a typo in a path never materializes a second, empty journal that looks like a working system with no history.

## Errors

Eight tagged errors, one recovery each, routed with `Effect.catchTag`. Causes — a `SchemaError`, a `JSON.stringify` throw — are carried structurally rather than stringified. Core's `PlatformError` is deliberately not a member: IO failures pass through untranslated.

| Tag | Means | Recovery |
| --- | --- | --- |
| `MalformedLine` | A line is not parseable JSON, or is not an object. Most often a tail caught mid-write. | Read the last valid envelope instead; a torn tail resolves itself once the writer finishes the line. |
| `UnknownEvent` | The line's `event` tag is not in this registry — commonly a file written by another version of the same application. | Register the event, or route the line to a migration path. Never a defect: an old file is hostile input in the technical sense. |
| `InvalidData` | The payload did not satisfy the schema registered for its event. Carries the structured issue tree. | Report the issue; do not run on data you could not validate. |
| `UnserializableData` | `JSON.stringify` threw on a payload that satisfied its schema — a `BigInt`, a circular structure. | Fix the value at the call site. Nothing was written. |
| `TerminalViolation` | An append landed on a journal whose tail is a `terminal` event. | Append an event declared `reopen`, or accept that the journal is over. |
| `JournalClosed` | An append arrived after the layer's scope began closing. | A lifecycle fact, not a data one: build a new layer, or stop appending. |
| `JournalNotFound` | The journal file does not exist. | Call `create`. An append will not do it for you. |
| `JournalResync` | The file was truncated or replaced under a live reader. Carries `reason`, `expected` and `actual`. | Discard every cursor-derived state and re-read from zero, and surface the breach — something violated the append-only contract. |

## Features

- `Journal` — the service factory. `Journal.Service<Self>()(id, { events })` mints a per-registry service class whose `.layer({ path })` is a scoped layer over `FileSystem`, with `append`, `appendPatch`, `latest`, `quiescent`, `query`, `changes`, `projection`, `create` and `remove` all typed by that registry.
- `JsonlEvent` — `JsonlEvent.make(tag, { data, terminal?, reopen? })` and the registry type helpers. A payload schema may not require services in either direction, which is what keeps the sync core possible: a service-requiring schema fails at registration rather than at some later call site.
- `Envelope` / `EnvelopeFrame` — the two-stage decode. The frame (`at`, `event`, `scope?`, and `data` left unknown) is what every filter reads; the registered payload schema runs only for the lines a slice already selected.
- `Slice` / `CursoredSlice` — the one filter shape every read surface takes: `events`, `scopes`, an inclusive `from`, an exclusive `to`, and a `cursor` for resuming. Adjacent windows tile without double-delivery, and persisting an envelope's `line.end` resumes exactly the unprocessed remainder.
- `Line` / `ParsedLine` / `LineSlice` — the pure line layer: split with byte-exact offsets, parse one line without throwing, and walk back to the last line that parses. Offsets are UTF-8 byte offsets, logical post-BOM, because they persist across process restarts as cursors.
- `appendPatch` — inherit-and-patch for snapshot journals: read the last valid envelope, shallow-merge a patch over its `data`, validate the result and append it. The whole read-merge-validate-append sequence is serialized, so two patches to different fields cannot silently revert each other.
- A watcher that observes cooperative external writers, so two services over one file see each other's appends with no polling loop written by the consumer — and a subscriber cannot tell a local append from an external one.

## License

[MIT](LICENSE)
