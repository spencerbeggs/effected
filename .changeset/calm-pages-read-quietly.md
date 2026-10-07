---
"@effected/jsonl": minor
---

## Breaking Changes

The journal API is redesigned before its first consumers arrive. Every item below needs a change at the call site.

### Service definition

`Journal.Service<Self>()(id, { events, config })` defines a journal. `config` is a plain record or an Effect that yields one. `layer` is now a static value rather than a `layer(config)` function, and `make(config)` builds the service directly.

```ts
const events = [JsonlEvent.make("created", { data: Schema.Struct({ id: Schema.String }) })] as const;

class Audit extends Journal.Service<Audit>()("app/Audit", {
  events,
  config: { path: "audit.jsonl" },
}) {}

// before: Effect.provide(Audit.layer({ path: "audit.jsonl" }))
// after:  Effect.provide(Audit.layer)
```

### Reads and subscriptions

- `latest` is a read-only `Effect<Option<Envelope>>`, not a `SubscriptionRef`. Use the new `latestChanges` stream to follow it.
- `hub` is no longer part of the service shape.
- Envelopes carry `position: { offset, end }` instead of `line`.
- `Slice` absorbs `CursoredSlice` and gains `onInvalid: "skip" | "fail"`. The default is `skip`; `query` used to fail on any bad line.
- `LineSlice` is a `Schema.Struct`, so its values are plain records.

### Errors

- `AppendError`, `QueryError` and `ChangesError` replace `JournalWriteError` and `JournalReadError`, and `DecodeError` joins them.
- Appending an unregistered tag is now a defect, not a typed failure.
- `InvalidData` and `UnknownEvent` raised on the encode path no longer carry a `line`.
- `UnserializableData.cause` is `Schema.Defect()`.

### Trimmed exports

- `Line` keeps `byteLength`, `split(text, base)` and `parseResult`. `lastValid`, `consumedOffset`, `parseAll` and `ParsedLine` are removed.
- `Envelope.lastValidResult` becomes `Envelope.lastValid(events, text, base)`, and `decodeAllResult` takes a `base`. `Envelope.decode`, `encode`, `decodeSelectedResult`, `frameResult` and `EnvelopeFrame` are no longer public.
- `JsonlEventTypeId`, `JsonlEvent.TerminalTags` and `JsonlEvent.ReopenTags` are removed.

## Features

- `query` and the replay half of `changes` read the journal in bounded 64 KiB pages instead of allocating the whole region at once (closes #233). Tail reads are clamped to 1 MiB.
- Appends, creates and removes are traced with `<id>.append`, `<id>.create` and `<id>.remove` spans.

## Bug Fixes

- The watcher's gap read pages as well, so no read allocates a whole region.
- A resync re-seeds the journal from the file as it now stands instead of replaying it.
- A missing file is detected by a `stat` NotFound rather than an exists-then-stat pair.
- Reads leave an unterminated tail out until its `\n` lands. A line torn mid-append no longer fails a read, and a journal built over one picks the line up when it completes.
- A local append finishing while the watcher's `stat` is in flight no longer reports a false truncation; a re-seed resumes from the file as it is, so it cannot republish an append.
- An external append landing between our write and our `fstat` no longer corrupts the returned position, skips the foreign line, or publishes our own line twice.
