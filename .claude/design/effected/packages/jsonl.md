---
status: current
module: effected
category: architecture
created: 2026-08-03
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - ../effect-standards.md
  - ../formatter-convention.md
  - ../package-inventory.md
  - jsonl-journal.md
  - jsonl-reads.md
  - config-file.md
  - store.md
---

# @effected/jsonl design

## Overview

`@effected/jsonl` is append-only, schema-validated JSONL journals exposed as a definable Effect service.

The subject is not the JSONL *format* — one JSON value per line is a two-sentence specification and nobody needs a library for it. The subject is the **file as a live object**: a journal that only ever grows, whose current state is its last valid line, that several processes read while one writes, whose tail may be torn mid-append, and that readers want a small filtered slice of rather than the whole of. That bundle of semantics is what consumers keep reimplementing in shell scripts, and it is what this package owns.

This document covers the envelope contract and the package's positioning. The two subsystems built on it have their own docs:

- **[The journal service](jsonl-journal.md)** — the append path, the write critical section and publish ordering, lifecycle and shutdown, and the cooperative-writer process model with its watcher.
- **[The read surfaces](jsonl-reads.md)** — the `Slice` vocabulary shared by every read, the consumption model, and the read economy that motivates the whole design.

## Motivation: the token economy as an API contract

The pressure comes from AI applications. A JSONL journal is the natural state format for an agent-adjacent system — human-readable, `jq`-able, greppable, append-only, diffable in git — and the naive way to consume one is to read the file and hand it to a model. That is exactly wrong: the whole history enters the context window to answer a question about the last line, and the cost grows with the age of the file rather than with the size of the question.

The design goal that follows is stated as an API property rather than an optimization: **every read surface takes a filter, and filtering happens on envelope fields.** A consumer that wants "the current state of mailbox A" pays for the tail of the file, not its history; a consumer sharing a journal with a noisy neighbour pays nothing for the neighbour's lines. That is why the [`Slice` vocabulary](jsonl-reads.md) is the *same* vocabulary on every read surface rather than a convenience on one of them — and [what it does and does not cover](jsonl-reads.md#the-read-economy) is stated precisely there, because the honest version of the claim is narrower than the slogan.

## Kit positioning

**Boundary tier** per the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy). **`FileSystem` is required in `R`, and `Path` deliberately is not**: the package takes journal paths as given and never joins, resolves or normalizes one, so requiring `Path` would charge every consumer for a service it does not use. The [one sanctioned piece of path arithmetic](jsonl-journal.md#the-watcher-and-activation) — deriving an activation-watch directory from the journal path — is separator-agnostic string work on a comparison-and-watch-target only, and buys no `Path` requirement.

It owns no IO backend and never imports `node:*`. Zero external runtime dependencies and zero `@effected/*` edges: the envelope is Effect Schema over `JSON.parse`, which core already provides.

### It is not a format package

`jsonc`, `yaml` and `toml` are pure-tier parse/edit/format packages whose subject is *text* and whose obligation is [fidelity](../formatter-convention.md#decision-5--the-fidelity-obligation) — a round trip must preserve every byte of meaning the author wrote. None of that applies here. JSONL's grammar is "a JSON value, a newline"; there are no comments to preserve, no styles to round-trip, no edit model. The interesting content is ordering, tail semantics, watchers and concurrent writers — properties of a *file*, not of a grammar. Built as a fourth format package, its formatter would have nothing to do.

The closest kin in the kit is [`config-file`](config-file.md): a pure core under one opinionated service, where the opinion — there codec × resolver × strategy, here the envelope — is what makes the package worth having.

### Why not core's eventlog

`effect/unstable/eventlog` is a replication-oriented event-sourcing system: MessagePack-encoded entries, encryption, SQL-backed journals, remote sync and session auth. Those are the right goals for a distributed event log and the wrong goals for a file a human greps, a hook reads with `jq`, and git diffs in a pull request. A binary, encrypted, SQL-backed journal fails the first requirement this package has.

What is borrowed is the **shape of an event definition**: a tag plus a payload schema, defined once and collected into a group, is prior art worth matching so a reader who knows core's `Event` recognizes `JsonlEvent`. The mechanism is ours; the vocabulary is theirs.

## The envelope contract

The one opinion the package imposes: **every line is an envelope**, and the payload lives under `data`.

```json
{"at":"2026-08-03T17:04:11.912Z","event":"mail-received","scope":"silk-runtime-action","data":{"round":7}}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `at` | yes | UTC timestamp, **assigned by the service at append time** from the Effect `Clock`, so `TestClock` controls it in tests. A caller-supplied timestamp makes ordering a lie the moment two writers disagree about the clock. |
| `event` | yes | The string tag: the discriminant of the derived envelope union and the primary filter key. |
| `scope` | no | A partition key with **no further semantics** — which mailbox, which loop, which run. Cheap to filter on because it sits on the envelope. |
| `data` | yes | The payload, validated by the schema registered for `event`. Never absent; a payload-less event encodes as `null`. |

Consumers declare their events (`JsonlEvent.make`, with the `terminal` and `reopen` markings), and the package derives the union from the registry, so the discriminated union a consumer reads is exactly the set it declared with no hand-written union to drift. An **unrecognized `event` tag on read is a typed error, never a defect**, per the [input-hardening standard](../effect-standards.md#input-hardening-standards): a file written by an older or newer version of the same application is hostile input in the technical sense.

### A payload schema may not require services

Payload schemas are **bounded to a codec whose decoding and encoding service slots are `never`**. A consumer cannot register a payload schema whose decode needs something from context.

This is a **contract, not an implementation detail**, and it is what makes the pure synchronous core reachable at all: the sync `Result`-returning codecs demand `never` in both slots, because a sync function has nowhere to get a service from. Admitting a service-requiring payload would mean a runtime-free reader — a `PreToolUse` hook reading one line — could no longer work, and the failure would land on the *consumer's* call site rather than on the library at registration. Forbidding it structurally moves the error to `JsonlEvent.make`, where it is legible.

The bound is spelled explicitly rather than reached for via `Schema.Top`, whose service parameters are `unknown` and therefore do not satisfy the sync codecs — the constraint would silently fail to bind. The type and encoded parameters are `unknown` rather than `any`: they are covariant, so every concrete payload schema satisfies them while a service-requiring schema is still rejected on the last two, and it costs no `noExplicitAny` suppression.

### The derived union is a type; the read path is a frame

"Derived discriminated union" needs to be precise about *where*: **the derivation is at the type level, and the runtime read path is a two-stage decode.**

A `Schema.Union` **value** over full envelopes cannot be the read path. To discriminate, a union decoder tries members — which decodes `data` **eagerly**, for every line, including lines a slice is about to discard. That inverts the filter-before-decode guarantee while the types still look right. So:

1. **The envelope *frame* decodes first**, with `data` left as an undecoded `unknown`. The frame is what slice filtering reads, and filtering on `event`, `scope` and `at` never touches the payload.
2. **The registered payload schema applies on demand**, looked up by the frame's tag, and only to the lines a slice selected.

A union value is still right where eager decoding is correct and cheap — notably encoding, which has one known event and no filtering to preserve.

### No depth guard ships, and the frame is why

A parser fed untrusted input would normally get a depth guard. This one ships none, deliberately:

- **The frame is depth-independent by construction.** Passing the payload through untraversed makes the per-line frame decode O(1) in payload depth, pinned by a pathologically deep test.
- **Parse depth is not a hazard on the reference engine.** V8's `JSON.parse` is iterative, so a deeply nested line does not blow the stack on the way in.

Two qualifications keep that from being an overclaim. A consumer's **recursive** payload schema makes payload-decode depth input-driven — that risk lives in the consumer's schema and is deliberately not second-guessed, since refusing to register one would dictate the consumer's data model. And the residual hazard of deep payloads is failure **rendering**, not decoding: mutating the frame to a traversing schema overflowed the stack inside Effect's *issue formatter*, not the decoder.

Where depth independence stops is a property in its own right: **the frame is depth-independent, stage two is not.** A hostile deep payload aimed at a *known* tag pays full decode cost **on selection** — which is the intended trade, because you pay only for the lines you selected and a filter excluding the hostile tag excludes its cost entirely.

### `data` is required; `scope` is optional

JSON has no `undefined`, and `JSON.stringify` **silently drops** keys whose value is `undefined` — which emits a frame missing its required `data` key and therefore unroundtrippable. So the two optional-looking fields are not symmetric: `scope` may genuinely be absent from a line, while `data` is always present with `null` as its empty spelling.

The boundary of that rule, verified: a payload whose **encoded** form is `undefined` for any reason other than a void schema still does not round-trip — it encodes to `null` and then fails payload decode. Use a void schema for payload-less events, and a nullable schema where absence must be representable *within* the payload.

### The envelope is what makes a torn tail detectable

An envelope is always a JSON **object**, and every strict prefix of an object text is invalid JSON — so a half-written envelope always fails to parse and the walk-back always finds it. A journal of bare scalars has no such property: `42` torn mid-write is `4`, a perfectly valid line with a silently wrong value. That is a second, independent argument for the envelope being mandatory rather than a convention, and it produces a rule the service is held to throughout: **"the last valid line" always means the last valid *envelope*, never merely the last valid JSON.**

It is also why a generic "any line schema" reader stays **internal**. Exposing it would make the envelope optional, and an optional envelope is not a contract — `scope`, `at` and the tag union are precisely what the read vocabulary is built on.

## Module layout

Module-per-concept per the [module layout standard](../effect-standards.md#module-layout-module-per-concept); no barrels, no namespace objects. See `src/`:

- **The pure core**, synchronous and `Result`-based per the [sync primitive policy](../sync-primitive-policy.md): `Line.ts` and `LineSlice.ts` (split text into candidate lines, parse one, walk back to the last valid one, and keep byte-offset bookkeeping), plus `Envelope.ts` and `JsonlEvent.ts` (event definitions, the registry, the frame schema, the derived union type and the sync decode/encode primitives, each `Effect` form defined in terms of its sync twin so the two cannot diverge).
- **The service**: `Journal.ts` — see [the journal doc](jsonl-journal.md).
- **The errors**: `JsonlError.ts` — one taxonomy whose tags each name a distinct recovery a caller would actually make, with core `PlatformError` **passed through rather than wrapped**. Two distinctions are load-bearing and easy to get wrong: shutdown refusal is a **lifecycle** condition (the service is going away; the recovery is a new layer) while a terminal-event refusal is a **journal-state** condition (the recovery is an event declared `reopen`), and a truncation-or-replacement breach is its own tag because its recovery — discard all cursor-derived state and re-read from zero — matches nothing else. Reusing the not-found tag for that breach would tell the consumer to **create** a journal and destroy the evidence.

Every offset the package emits is a **UTF-8 byte offset**, never a UTF-16 index, because these values are cursors into a file: they feed the offset read and get persisted across process restarts. A `String.length`-derived offset is correct only for ASCII journals and is the single most likely bug in the line module.

**The grouped-statics form is forced.** `Envelope` and `JsonlEvent` land as a merged `interface` plus `const`, not as static classes — each name is shared with a same-file generic interface, and merging a class into one of those is a compile error. The accepted cost is that an object literal's member types are inferred in the built `.d.ts` and lose their TSDoc, and that a bare `{@link}` to either name is ambiguous and needs the variable selector form. Do not "tidy" either into a static class; it will not compile.

## The service is a factory, not a generic key

`Journal` **cannot be a `Context.Service` generic over the registry**: `Context.Service` binds a concrete shape at declaration, and the resulting key cannot be parameterized at retrieval. There is no form in which `yield* Journal` returns something typed by a registry supplied at the use site.

The kit already solved this in [`config-file`](config-file.md): a **per-registry service-class factory** plus a layer-returning function. Each registry gets its own uniquely-keyed service class, so several journals coexist in one layer graph and each one's operations are typed by *its* registry. The registry rides on the class-definition site and is inferred, so `Self` is the only explicit type parameter.

```ts
class MailJournal extends Journal.Service<MailJournal>()("dogfood/MailJournal", { events: MailEvents }) {}

// Bind the layer ONCE, at module scope, and provide this const everywhere.
export const layer = MailJournal.layer({ path });
```

Two consequences are recorded rather than discovered:

- **The const-binding hazard is inherited with the pattern, and the obligation is the consumer's.** Layers memoize *by reference*, so calling the layer function at each provide site mints **two independent journal instances over one file**, each with its own semaphore, watcher and hub: the appends are no longer serialized against each other, which is the in-process version of the bug the cooperative-writer rules exist to prevent. The library's side is a TSDoc warning and a test; the consumer's side is the one-line rule above, and it belongs in the first README example.
- **This is the sanctioned exception to "avoid layer-producing functions"**, on the same grounds config-file's is: the layer is genuinely parameterized, by a registry the library cannot know. It is not licence to add a second one elsewhere in the package.

Core's `eventlog` solves the same problem the other way — a non-generic service plus a generic *client* factory — and stays on the record as the **escape hatch** if the factory typing ever proves unworkable. It is rejected as the primary shape because the registry has to type the service's own operations, not a wrapper's, and splitting them would put the typed surface one indirection away from the thing consumers hold.

## Known limitation: terminal semantics are journal-wide

Terminal and quiescent state is a property of **the journal**, not of a scope: the terminal check reads the unsliced tail, so one scope's terminal event freezes every other scope's appends. Paired with the absence of a **sliced** current-state surface — per-scope current state is either a projection fold or a take-last over history, at the cost this package exists to avoid — that means a set of independent per-scope loops **cannot** collapse into one journal today.

The honest split this identifies: the `Slice` vocabulary is load-bearing for subscription, query and projection, and is **not** load-bearing for current-state or lifecycle. The future shape is known — a sliced current-state surface plus per-scope terminal semantics — and is deliberately deferred until a real consumer needs it rather than designed speculatively. A single-journal collapse would also lose per-loop file deletion, `.gitignore` granularity and per-loop mtime as a change signal, which are worth weighing independently.

## Observability

Per the [observability standard](../effect-standards.md#observability-standards): named `Effect.fn` spans on the public fallible boundaries only — append, query open, watcher resync — and nothing else. A span per decoded line would cost more than the decode. The library stays telemetry-agnostic; applications compose OpenTelemetry at the edge.

## Testing

`@effect/vitest`, `assert.*` and never `expect`, with tests in `__test__/` and integration under `__test__/integration/` per the [testing standard](../effect-standards.md#testing-standards).

- **Property tests** over line splitting and corrupt tails. The generators must emit torn final lines, embedded newlines inside string payloads, and lines that are valid JSON but not valid envelopes, because those are the three shapes a real journal produces.
- **`TestClock` drives `at` stamping**, so timestamp assertions are exact rather than approximate.
- **Two type-level guarantees are tested as types, not behaviour**: a payload schema requiring services is a *compile* error at registration, and a slice's event list narrows the element type. A runtime-only test would pass while either was broken.
- **Integration tests run the watcher against real temporary directories** and are the only tests that provide a platform layer. Watcher behaviour that does not need a real filesystem is driven through the [`FileSystem` double's `watch`](jsonl-journal.md#the-watcher-and-activation) instead, so those assertions are deterministic and timer-free.
- Several concurrency and ordering tests here are **structurally incapable of testing what they appear to test** unless arranged carefully; the specific traps are recorded with the mechanisms they guard, in [the journal doc](jsonl-journal.md#what-the-concurrency-tests-must-actually-arrange).

The platform findings recorded across these three documents were established against the vendored core and the node backend; when the catalog advances, the `FileSystem`, `watch` and `writeAll` findings are the ones to re-check.

## Non-goals

- Rotation, compaction and retention. Append-only history is the point of the format, and a package that rotates has quietly become a log shipper.
- Any binary or encrypted encoding — human-readable and `jq`-able is a requirement, not a default.
- A general event-sourcing framework; core's `eventlog` occupies that space.
- Locking, leases or any coordination protocol between writers beyond the documented one-write-per-line discipline.
- Querying by anything other than envelope fields. A payload-content query would force a payload decode per line and dismantle the filtering guarantee the package is built on.
