---
type: Module
title: "@effected/jsonl"
description: Append-only, schema-validated JSONL journals exposed as a definable Effect service — the file as a live object, not a text format.
status: stable
kind: package
resource: ../../packages/jsonl
layer: L1
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-10-07T19:15:53Z
  body_sha256: 10c6b1dea29d2c89685d24d0726711b0df542a36e3969f72f33857ec1c2e8743
---

# `@effected/jsonl`

`@effected/jsonl` is append-only, schema-validated JSONL journals exposed as
a definable Effect service: a pure synchronous core usable from a hook
script with no runtime, under one `Journal` service whose scoped layer
watches the file for external appends and cross-observes another instance
over the same path.

## Motivation: the token economy as an API contract

The subject is not the JSONL format — one JSON value per line is a
two-sentence specification. The subject is the file as a live object: a
journal that only ever grows, whose current state is its last valid line,
that several processes read while one writes, whose tail may be torn
mid-append, and that readers want a small filtered slice of rather than the
whole of.

The pressure is AI applications. A JSONL journal is the natural state
format for an agent-adjacent system — human-readable, `jq`-able, greppable,
append-only, diffable in git — and the naive way to consume one is to read
the file and hand it to a model. That is exactly wrong: the whole history
enters the context window to answer a question about the last line, and the
cost grows with the age of the file rather than with the size of the
question. The design goal that follows is stated as an API property rather
than an optimization: **every read surface takes a filter, and filtering
happens on envelope fields.** A consumer that wants "the current state of
mailbox A" pays for the tail of the file, not its history; a consumer
sharing a journal with a noisy neighbour pays nothing for the neighbour's
lines. That is why the [`Slice` vocabulary](../interfaces/jsonl-slice.md) is
the *same* vocabulary on every read surface rather than a convenience on
one of them.

## Kit positioning

**Boundary tier.** `FileSystem` is required in `R`, and `Path` deliberately
is not: the package takes journal paths as given and never joins, resolves
or normalizes one, so requiring `Path` would charge every consumer for a
service it does not use. The one sanctioned piece of path arithmetic —
deriving an activation-watch directory from the journal path — is
separator-agnostic string work on a comparison-and-watch-target only, and
buys no `Path` requirement (see the [journal
interface](../interfaces/jsonl-journal.md#the-watcher-and-activation)).

It owns no IO backend and never imports `node:*`. Zero external runtime
dependencies and zero `@effected/*` edges: the envelope is Effect Schema
over `JSON.parse`, which core already provides.

It is not a format package: `jsonc`, `yaml` and `toml` are pure-tier
parse/edit/format packages whose subject is text and whose obligation is
the [fidelity obligation](../decisions/format-fidelity-obligation.md) — a
round trip must preserve every byte of meaning the author wrote. None of
that applies here. JSONL's grammar is "a JSON value, a newline"; there are
no comments to preserve, no styles to round-trip, no edit model. The
interesting content is ordering, tail semantics, watchers and concurrent
writers — properties of a file, not of a grammar. The closest kin in the
kit is `@effected/config-file`: a pure core under one opinionated service,
where the opinion — there codec × resolver × strategy, here the envelope —
is what makes the package worth having.

Core's `effect/eventlog` was declined as a foundation:
it is a replication-oriented event-sourcing system (MessagePack-encoded
entries, encryption, SQL-backed journals, remote sync, session auth) — the
right goals for a distributed event log and the wrong goals for a file a
human greps, a hook reads with `jq`, and git diffs in a pull request. What
is borrowed from it is the shape of an event definition: a tag plus a
payload schema, defined once and collected into a group.

## The envelope contract

The one opinion the package imposes: every line is an envelope, and the
payload lives under `data`.

```json
{"at":"2026-08-03T17:04:11.912Z","event":"mail-received","scope":"silk-runtime-action","data":{"round":7}}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `at` | yes | UTC timestamp, assigned by the service at append time from the Effect `Clock`, so `TestClock` controls it in tests. A caller-supplied timestamp would make ordering a lie the moment two writers disagree about the clock. |
| `event` | yes | The string tag: the discriminant of the derived envelope union and the primary filter key. |
| `scope` | no | A partition key with no further semantics — which mailbox, which loop, which run. Cheap to filter on because it sits on the envelope. |
| `data` | yes | The payload, validated by the schema registered for `event`. Never absent; a payload-less event encodes as `null`. |

Consumers declare their events (`JsonlEvent.make`, with `terminal` and
`reopen` markings — `packages/jsonl/src/JsonlEvent.ts`), and the package
derives the union from the registry, so the discriminated union a consumer
reads is exactly the set it declared with no hand-written union to drift.
An unrecognized `event` tag on read is a typed error, never a defect: a
file written by an older or newer version of the same application is
hostile input in the technical sense. The write side is the opposite case:
`append` only admits a registered tag at the type level, so an unregistered
tag reaching the encoder is a defect, not a typed failure.

A decoded envelope carries one field the line does not: `position`, a
`LinePosition` of `{ offset, end }` in UTF-8 bytes, where `end` is the resume
cursor. It keeps no copy of the line's text — the envelope already holds the
decoded payload, and a raw second copy would double what a buffered stream
holds. Errors are where the text is evidence, so the decode errors carry the
full `LineSlice` instead.

A payload schema may not require services: payload schemas are bounded to a
codec whose decoding and encoding service slots are `never`. This is a
contract, not an implementation detail — it is what makes the pure
synchronous core reachable at all, since the sync `Result`-returning codecs
demand `never` in both slots (a sync function has nowhere to get a service
from). Admitting a service-requiring payload would mean a runtime-free
reader — a `PreToolUse` hook reading one line — could no longer work, and
the failure would land on the consumer's call site rather than on the
library at registration; forbidding it structurally moves the error to
`JsonlEvent.make`, where it is legible.

"Derived discriminated union" needs to be precise about where: the
derivation is at the type level, and the runtime read path is a two-stage
decode. A `Schema.Union` value over full envelopes cannot be the read path,
because discriminating a union decodes `data` eagerly for every line —
inverting the filter-before-decode guarantee while the types still look
right. So the envelope frame decodes first, with `data` left as an
undecoded `unknown` — the frame is what slice filtering reads, and
filtering on `event`, `scope` and `at` never touches the payload — and the
registered payload schema applies on demand, looked up by the frame's tag,
only to the lines a slice selected.

No depth guard ships on the frame decode, deliberately: the frame is
depth-independent by construction (payload passes through untraversed,
pinned by a pathologically deep test), and V8's `JSON.parse` is iterative,
so a deeply nested line does not blow the stack on the way in. A consumer's
own recursive payload schema still makes stage-two decode depth
input-driven, and that risk is deliberately not second-guessed. Where depth
independence stops is a property in its own right: a hostile deep payload
aimed at a known tag pays full decode cost on selection, which is the
intended trade, since you pay only for the lines you selected.

`data` is required; `scope` is optional, and the two are not symmetric:
`JSON.stringify` silently drops keys whose value is `undefined`, so a
`data` field that somehow encoded to `undefined` would emit a frame missing
its required key and be unroundtrippable. Use a void schema for
payload-less events, and a nullable schema where absence must be
representable within the payload.

The envelope is what makes a torn tail detectable: an envelope is always a
JSON object, and every strict prefix of an object text is invalid JSON, so
a half-written envelope always fails to parse and the walk-back always
finds it. A journal of bare scalars has no such property — `42` torn
mid-write is `4`, a perfectly valid line with a silently wrong value. This
is why "the last valid line" always means the last valid *envelope*, never
merely the last valid JSON, throughout the package, and why a generic
"any line schema" reader stays internal: exposing it would make the
envelope optional, and an optional envelope is not a contract.

## Module layout

Module-per-concept, no barrels, no namespace objects. See `packages/jsonl/src/`:

- **The pure core**, synchronous and `Result`-based per the [sync-primitive
  policy](../conventions/sync-primitive-policy.md), with no `Effect` twins:
  a program that wants one lifts a `Result` with `Effect.fromResult`.
  - `Line.ts` knows JSON, not envelopes: `byteLength` (the UTF-8 measure
    every offset uses), `split(text, base)` (candidate lines with byte
    offsets shifted by where `text` starts in its file) and `parseResult`
    (one line's parsed value, or `MalformedLine`).
  - `LineSlice.ts` is the line record — a `Schema.Struct` of plain records
    rather than a class, because `split` produces one per line of every
    read and a class instance costs far more on that hot path; the schema
    exists so errors can carry the line structurally — plus `LinePosition`.
  - `Envelope.ts` holds `decodeResult`, `decodeAllResult(events, text,
    base)`, `encodeResult` and `lastValid(events, text, base)`. `lastValid`
    is *the* definition of a journal's current state: the service seeds
    `latest` by running it over bounded tail windows, so the runtime-free
    hook path and the service cannot disagree about what "current" means.
  - `JsonlEvent.ts` holds `JsonlEvent.make` and the registry types.
- **The service**: `Journal.ts` is the typed boundary — the static
  `Journal` class and its `Journal.Service` factory. Beneath it,
  `internal/engine.ts` is the registry-erased engine (tags as strings,
  payloads `unknown`) that `Journal` types once, with a single cast, and
  `internal/tail.ts` holds the bounded reads. See the [journal
  interface](../interfaces/jsonl-journal.md).
- **The errors**: `JsonlError.ts` — an eight-tag taxonomy (`MalformedLine`,
  `UnknownEvent`, `InvalidData`, `UnserializableData`, `TerminalViolation`,
  `JournalClosed`, `JournalNotFound`, `JournalResync`), each tag naming a
  distinct recovery a caller would actually make, with core `PlatformError`
  passed through rather than wrapped. Two distinctions are load-bearing:
  shutdown refusal (`JournalClosed`) is a lifecycle condition — the service
  is going away, the recovery is a new layer — while a terminal-event
  refusal (`TerminalViolation`) is a journal-state condition — the recovery
  is an event declared `reopen` — and a truncation-or-replacement breach
  (`JournalResync`) is its own tag because its recovery, discard all
  cursor-derived state and re-read, matches nothing else. Each operation
  declares only the tags it can raise: `AppendError`, `QueryError` and
  `ChangesError` are per-operation unions (see the [journal
  interface](../interfaces/jsonl-journal.md#operations)), and `DecodeError`
  (`MalformedLine | InvalidData | UnknownEvent`) is why one line could not
  become an envelope. `InvalidData` and `UnknownEvent` carry an optional
  `line`, absent when the failure came from encoding a payload for append,
  which has no line yet; `UnserializableData` carries the thrown value
  structurally as a `Schema.Defect()` `cause`.

Every offset the package emits is a UTF-8 byte offset, never a UTF-16
index, because these values are cursors into a file: they feed the offset
read and get persisted across process restarts. A `String.length`-derived
offset is correct only for ASCII journals and is the single most likely bug
in the line module.

`Envelope` and `JsonlEvent` land as a merged `interface` plus `const`, not
as static classes like `Journal` and `Line`, because each name is shared
with a same-file generic interface, and merging a class into one of those
is a compile error. The
accepted cost is that an object literal's member types are inferred in the
built `.d.ts` and lose their TSDoc, and a bare `{@link}` to either name is
ambiguous and needs the variable-selector form.

## The service is a factory, not a generic key

See [the factory decision](../decisions/jsonl-service-is-a-factory.md) for
the full rationale. In brief: `Journal` cannot be a `Context.Service`
generic over the registry, because `Context.Service` binds a concrete shape
at declaration and the resulting key cannot be parameterized at retrieval.
The answer is a per-registry service-class factory, with the journal's
config supplied at the definition site:

```ts
class MailJournal extends Journal.Service<MailJournal>()("dogfood/MailJournal", {
  events: MailEvents,
  config: { path: ".dogfood/mail.jsonl" },
}) {}

const program = Effect.gen(function* () {
  const mail = yield* MailJournal;
  yield* mail.append("mail-received", { round: 7 });
}).pipe(Effect.provide(MailJournal.layer));
```

`config` is a plain record or an `Effect` producing one, so a path can come
from `Config` or another service and resolve when the layer builds; the
effect's error and requirements flow into the layer's own channels.

The static `layer` is a value, not a function. Layers memoize by reference,
so a layer *function* called at each provide site would mint two
independent journals over one file — each with its own semaphore, watcher
and hub, appends no longer serialized against each other, the in-process
version of the bug the cooperative-writer rules exist to prevent. With one
`layer` value per class, providing it twice provides one journal twice;
that hazard is gone by construction rather than guarded by a rule.

The static `make(config)` serves the remaining case, a path known only at
run time. Every `make` builds an independent journal, so the consumer wraps
it once — `Layer.effect(MailJournal, MailJournal.make(config))` — and binds
that layer to one value; the bind-once discipline survives only on this
explicitly runtime path.

## Observability

Per the kit's observability standard, spans sit on the file-mutating
boundaries only, each named from the journal's service id: `${id}.append`
(with the event tag as an attribute, covering `appendPatch` too, which
shares the write path), `${id}.create` and `${id}.remove`. The read
surfaces and the watcher carry no span — neither `query`, `changes` nor
ingest and resync — and nothing runs per decoded line, since a span per
line would cost more than the decode itself. The library stays
telemetry-agnostic; applications compose OpenTelemetry at the edge.

## Testing

`@effect/vitest`, `assert.*`, never `expect`, tests in
`packages/jsonl/__test__/`, integration under `__test__/integration/`.

Property tests cover line splitting and corrupt tails; the generators must
emit torn final lines, embedded newlines inside string payloads, and lines
that are valid JSON but not valid envelopes, because those are the three
shapes a real journal produces. `TestClock` drives `at` stamping, so
timestamp assertions are exact rather than approximate. Two type-level
guarantees are tested as types, not behaviour: a payload schema requiring
services is a compile error at registration, and a slice's event list
narrows the element type — a runtime-only test would pass while either was
broken. Integration tests run the watcher against real temporary
directories and are the only tests that provide a platform layer (`@effect/platform-node`);
watcher behaviour that does not need a real filesystem runs over an
`@effected/memfs` volume whose `watch` is replaced, through a faults factory,
by a manually driven stream (with `open` wrapped for write and read gates),
so those assertions are deterministic and timer-free while storage, `stat`
identity and `O_APPEND` stay memfs's own. The engine's hub is reachable
from tests through `internal/engine.ts` and from nowhere else: no public
shape exposes it, so a test that needs to see backpressure or two
independent hubs builds the engine directly. Three concurrency and ordering tests are structurally
incapable of testing what they appear to test unless arranged carefully;
see [what the concurrency tests must
arrange](../interfaces/jsonl-journal.md#what-the-concurrency-tests-must-actually-arrange).

## Non-goals

- Rotation, compaction and retention. Append-only history is the point of
  the format, and a package that rotates has quietly become a log shipper.
- Any binary or encrypted encoding — human-readable and `jq`-able is a
  requirement, not a default.
- A general event-sourcing framework; core's `eventlog` occupies that
  space.
- Locking, leases or any coordination protocol between writers beyond the
  documented one-write-per-line discipline.
- Querying by anything other than envelope fields. A payload-content query
  would force a payload decode per line and dismantle the filtering
  guarantee the package is built on.

See the [journal interface](../interfaces/jsonl-journal.md), the [slice
interface](../interfaces/jsonl-slice.md) and the [journal-wide terminal
semantics limitation](../limitations/jsonl-terminal-semantics-journal-wide.md)
for the write half, the read half and the one known limitation,
respectively.
