---
status: current
module: effected
category: architecture
created: 2026-08-03
updated: 2026-08-03
last-synced: 2026-08-03
completeness: 96
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../formatter-convention.md
  - ../package-inventory.md
  - ../releases.md
  - ../roadmap.md
  - config-file.md
  - store.md
  - jsonc.md
---

# @effected/jsonl design

## Overview

`@effected/jsonl` is append-only, schema-validated JSONL journals exposed as a definable Effect service. It was designed doc-first per the [migration playbook](../migration-playbook.md) and **built on that design over 2026-08-03**; this document was kept current through every phase and now describes the package **as built**. Where implementation corrected the design — and it did, repeatedly — the correction is recorded in place with its evidence rather than quietly overwritten, so the [decisions record](#decisions-record) reads as the argument that produced the package.

**It is unpublished.** It ships in a future coordinated wave, never solo, per [releases.md](../releases.md).

The subject is not the JSONL *format* — one JSON value per line is a two-sentence specification and nobody needs a library for it. The subject is the **file as a live object**: a journal that only ever grows, whose current state is its last valid line, that several processes read while one writes, whose tail may be torn mid-append, and whose readers want a small filtered slice of rather than the whole of. That bundle of semantics is what consumers keep reimplementing in bash, and it is what this package owns.

## Motivation: the token economy as an API contract

The pressure comes from AI applications. A JSONL journal is the natural state format for an agent-adjacent system — human-readable, `jq`-able, greppable, append-only, diffable in git — and the naive way to consume one is to read the file and hand it to a model. That is exactly wrong: the whole history enters the context window to answer a question about the last line, and the cost grows with the age of the file rather than with the size of the question.

The design goal that follows is stated as an API property rather than an optimization: **every read surface takes a filter, and filtering happens on envelope fields.** ([Precisely what the decode guarantee covers](#what-filter-before-decode-actually-guarantees): it is structural on the disk paths, and on the live path each process pays at most once per line.) The goal's third clause as first written — *and no operation ever materializes the whole file* — **does not hold as built**: it holds for `latest` and for any read carrying a cursor, and **not** for a cursor-less historical read. That is [recorded honestly where the read economy is described](#what-the-recipe-does-not-cover-the-historical-read-is-cursor-bounded-not-window-bounded) rather than left standing here. A consumer that wants "the current state of mailbox A" pays for the tail of the file, not its history; a consumer sharing a journal with a noisy neighbor pays nothing for the neighbor's lines. Token economy is the reason the [`Slice`](#slice-the-shared-read-vocabulary) vocabulary exists and the reason it is the *same* vocabulary on every read surface instead of a convenience on one of them.

## Grounding example: the silk dogfood mailbox journal

The acceptance scenario is the silk dogfood mailbox protocol (`plugins/silk/skills/dogfood/` in `savvy-web/systems`). Its state journal lives at `.claude/dogfood/<counterpart-id>.jsonl` and is appended to by `scripts/journal-append.sh` — roughly two hundred lines of bash and `jq`. That script is a complete, independently-arrived-at precedent for this package, and it exercises every semantic listed here:

- append-only snapshot lines, where the current state is the last valid line;
- a corrupt-tail walk-back, because a killed writer leaves a partial final line;
- enum validation before append, so an unknown state never enters the file;
- inherit-and-patch appends: read the last snapshot, merge a patch over it, append the merged result;
- corrections expressed as further appends rather than edits, so history is never rewritten;
- a terminal `unlinked` state after which the journal is quiescent;
- multiple concurrent reader processes — a `PreToolUse` hook and a background monitor — reading while a session writes.

A future dogfood MCP server (an external repo) is the intended proving consumer. **That server is out of scope for this workstream**; it is named here only so the design has a real consumer to be checked against, per the kit's rule that capability is pulled by consumers rather than pushed by libraries.

### Acceptance criteria

The design succeeds if all four hold. They were written as checks a reviewer can run against the built package, not aspirations, and they were run: **1–3 hold; 4 does not.** Verdicts and evidence follow the criteria.

1. **`journal-append.sh` reduces to an event registry plus `appendPatch` plus a few declarative checks.** If reproducing it needs bespoke code beyond declaring events and calling the service, the surface is wrong.
2. **The hook and monitor read path is expressible with the pure core alone** — synchronous, `Result`-returning, no Effect runtime built to answer "what is the last valid line". A `PreToolUse` hook that must construct a runtime to read one line will not adopt this. **Qualified:** *no runtime* is unconditional, but *cheap* holds only through [the bounded-tail-read recipe](#the-bounded-tail-read-is-the-sanctioned-cheap-read) — `lastValid` takes a string, and a consumer who obtains that string by reading the whole file has paid for the history this package promised to skip.
3. **Two instances observe each other's appends.** Two services (for example, two MCP servers in sibling repos) open the same file, and each sees the other's appends through its watcher with no polling loop written by the consumer.
4. **The dogfood system's per-counterpart file fan-out could collapse into one journal**, where each loop is a `scope` and each observer subscribes to its slice. This is the test that `scope` and `Slice` are load-bearing rather than decorative.

#### Results (2026-08-03)

**Criterion 1 — HOLDS**, verified by construction: **224 lines of bash + `jq` typechecked as ~145 lines of package API.** Two honest findings are recorded rather than smoothed over:

- **1a — an 8-line consumer residue of *cross-line* invariants** (the owner-mismatch warning, role fixity). The package has **no validate-against-previous hook**, and the [taxonomy](#module-layout-a-pure-core-plus-one-service) deliberately carries **no domain-invariant tag**. That residue is therefore **consumer code by design**, not a gap: a library that validated one line against its predecessor would be adjudicating a domain it cannot see.
- **1b — adoption is a *format migration*, not a drop-in.** The dogfood lines are **flat**, while the envelope nests payload under `data`; and the script's `at` is **second**-precision against the package's **milliseconds**. Anyone reading criterion 1 as "existing journals work unchanged" would be wrong.

**Criterion 2 — HOLDS**, verified by an **executed** hook sketch: `node:fs` plus the sync core, over a **torn-tail** journal, with **zero runtime construction**. Importing `Schema` / `Option` / `Result` as values is fine — the criterion bars *constructing a runtime*, not importing the library.

**Criterion 3 — HOLDS**: the flagship passed **5/5 fresh**, and **6/6 across separate OS processes** at P5.

**Criterion 4 — DOES NOT HOLD.** Recorded as a finding rather than ticked, per the plan's own rule:

- **4a — hard blocker.** Terminal and quiescent semantics are **journal-wide**: `isTerminalTail` reads the **unsliced** `latest`, so **one scope's terminal event freezes every other scope's appends** with `TerminalViolation`. Demonstrated, not inferred. In the dogfood protocol loops end **independently**, which makes the collapse unusable as-is.
- **4b — design gap.** `latest` has **no sliced counterpart**, so per-scope current state is either a projection fold — which the dogfood reference **explicitly rejects** — or `query` + take-last at **O(history)**, which is precisely the cost [this package exists to avoid](#motivation-the-token-economy-as-an-api-contract).

The honest split: **the `Slice` vocabulary is load-bearing for subscription, query and projection** (verified), and **is not load-bearing for current-state or lifecycle**. Criterion 4 was the test of that, and it found the boundary rather than confirming the claim.

A collapse would also carry losses worth naming, independent of the blockers: **per-loop file deletion**, **`.gitignore` granularity**, and **per-loop mtime as a change signal** all disappear when many loops share one file.

**Future shape**, recorded as a future design amendment to be driven by a **real consumer** and explicitly **not this branch**: `latest(slice)` as a per-scope `SubscriptionRef`, plus **per-scope terminal semantics**.

## Kit positioning

**Boundary tier** per the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy): **`FileSystem` is required in `R`** — and **`Path` deliberately is not**, correcting an earlier `FileSystem | Path` in this document that the package's own `CLAUDE.md` and README never carried. The package takes journal paths as given and does not join, resolve or normalize them, so requiring `Path` would charge every consumer for a service the package does not use. The [one sanctioned piece of path arithmetic](#the-activation-watch-target-is-configurable) — deriving the activation-watch directory from the journal path — is separator-agnostic string work on a comparison-and-watch-target only, and buys no `Path` requirement. The package owns no IO backend and never imports `node:*`. Zero external runtime dependencies and, as scoped, zero `@effected/*` edges — the envelope is Effect Schema over `JSON.parse`, which core already provides.

### It is not a format package

`jsonc`, `yaml` and `toml` are pure-tier parse/edit/format packages whose subject is *text* and whose obligation is [fidelity](../formatter-convention.md#decision-5--the-fidelity-obligation) — a round trip through them must preserve every byte of meaning the author wrote. None of that applies here. JSONL's grammar is "a JSON value, a newline"; there are no comments to preserve, no styles to round-trip, no edit model. The interesting content is ordering, tail semantics, watchers and concurrent writers — properties of a *file*, not of a grammar. Building this as a fourth format package would produce a package whose formatter had nothing to do.

The closest kin in the kit is [`config-file`](config-file.md): a pure core under one opinionated service, where the opinion (there, codec × resolver × strategy; here, the envelope) is the thing that makes the package worth having.

### Why not core's eventlog

`effect/unstable/eventlog` was evaluated against the vendored source at `4.0.0-beta.101` and deliberately **not** used. It is a replication-oriented event-sourcing system: MessagePack-encoded journal entries, encryption, SQL-backed journals, remote sync and session auth. Those are the right goals for a distributed event log and the wrong goals for a file a human greps, a hook reads with `jq`, and git diffs in a pull request. A binary, encrypted, SQL-backed journal fails the first requirement this package has.

What is borrowed is the **shape of an event definition**: a tag plus a payload schema, defined once and collected into a group, is prior art worth matching so a reader who knows core's `Event` recognizes `JsonlEvent`. The mechanism is ours; the vocabulary is theirs.

### Feasibility against v4 FileSystem

Verified against the vendored `packages/effect/src/FileSystem.ts` at `4.0.0-beta.101`, so the design does not rest on APIs that must be invented. Where behavior — as opposed to signature — is at stake, the citation is to the **node backend** as installed, `@effect/platform-node-shared` at `4.0.0-beta.102`; those are the `NodeFileSystem.ts` references below, and they are the reason two claims in the first draft of this document were wrong:

- `watch(path): Stream<WatchEvent, PlatformError>` — the external-append signal. Core also exposes a `WatchBackend` service beneath it (`FileSystem.ts:1406`); **as built, this package does not use it** — it calls `watch` through the `FileSystem` service, and the deterministic test seam is [the `FileSystem` double's `watch`](#the-deterministic-test-seam-is-the-filesystem-double-not-watchbackend).
- `open(path, { flag: "a" })` returning a scoped `File`, whose `writeAll(buffer)` is the append primitive. **It is a write *loop*, not a single syscall** — see [the append primitive](#the-append-primitive-and-what-atomicity-actually-means).
- `stream(path, { offset, chunkSize, bytesToRead })` — the offset tail read, so growth is consumed from the last decoded byte rather than from the top of the file. `bytesToRead` bounds the read as well, which is what a tail read of known size wants: `offset` plus `bytesToRead` reads exactly the region between the tracked offset and the current size.
- `stat` — the size probe that distinguishes growth from truncation.

#### The append primitive, and what atomicity actually means

Verified against the vendored source and the installed `@effect/platform-node-shared`, because the naive claim — "`writeAll` is one `write(2)`" — is **false**:

- `File.writeAll` **recurses on partial writes** (`NodeFileSystem.ts:356-386`). It is a loop that keeps writing until the buffer is exhausted, so it can issue more than one syscall for one line.
- `File.write` is the single syscall, but it **returns the number of bytes written and may short-write**, which would tear a line just as surely.

So **no v4 API guarantees one syscall per line**, and the design must not claim one. The corrected position:

- The append primitive is **`writeAll` on a file opened `{ flag: "a" }`**.
- Atomicity is an **OS property of `O_APPEND` writes to a regular file at reasonable line sizes** — not an API guarantee. Under `O_APPEND` the kernel makes the offset-seek and the write one operation, so concurrent appenders cannot overwrite each other. What remains is a **short `write(2)`** — a signal interrupting the call, a filesystem limit, `ENOSPC` — after which the loop's next iteration writes the remainder as a separate operation another writer can interleave with. There is **no fixed byte threshold** below which this is impossible; `PIPE_BUF` is a pipe concept and does not govern regular files.
- The **line-size caveat is part of the contract**: the larger a journal line, the more opportunity a short write has to split it, and a split line is a torn tail. Consumers whose payloads can grow without bound are told so rather than being left to discover it.
- **A failure from the loop is never silently ignored.** `writeAll` is `Effect<void, PlatformError>` (`FileSystem.ts:1136`) — it reports **no byte count**, so by construction it either wrote the whole buffer or failed; there is no partial-success value to inspect, and no code should be written that tries to. The failure it raises on a stalled write is a `WriteZero` `systemError` when an underlying write returns 0 bytes (`NodeFileSystem.ts:361-372`). **Any `PlatformError` out of an append must surface typed, and must be treated as a possibly-torn tail** that readers walk back over — never swallowed, and never assumed to mean nothing was written.

This is why the [cooperative-writer contract](#process-model-cooperative-writers-always-watching) states the discipline *and* the caveat, rather than promising an atomicity the platform does not sell.

**Evidence, from the opposite direction (as-built, P3):** the `WriteZero` case is not hypothetical — it was reached by *touching a new file with a zero-byte `writeAll`*, which trips the stalled-write guard exactly as a genuine stall would. So **`create` opens with `{ flag: "a" }`, which creates the file, and writes nothing at all.** Recorded because the empty write is the obvious way to write `create` and it fails in a way that looks like a platform bug rather than a self-inflicted one.

### Release posture

Like every kit package, it ships in a coordinated wave and never solo (see [releases.md](../releases.md)). It is a post-`0.1.0` addition in the same slot as `markdown` and `schemastore`: designed and built after the gate, published in whichever wave it is ready for.

## The envelope contract

The one opinion the package imposes: **every line is an envelope**, and the payload lives under `data`.

```json
{"at":"2026-08-03T17:04:11.912Z","event":"mail-received","scope":"silk-runtime-action","data":{"round":7}}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `at` | yes | UTC ISO-8601 timestamp, **assigned by the service at append time** from the Effect `Clock`, so `TestClock` controls it in tests. Encoded through **`Schema.DateTimeUtcFromString`** (`Schema.ts:12121`) — the ISO-string codec — never a hand-rolled string and never `Schema.DateTimeUtc`, which declares the `DateTime` directly and would not give the line a string encoding. |
| `event` | yes | The string tag. It is the discriminant of the derived envelope union and the primary filter key. |
| `scope` | no | A partition key with **no further semantics** — which mailbox, which loop, which run. Cheap to filter on because it sits on the envelope. |
| `data` | yes | The payload, validated by the schema registered for `event`. May be void-like for payload-less events, which **encode on the wire as `data: null`** — see the asymmetry below. **Bounded to `Schema.Codec<unknown, unknown, never, never>`** — see below. |

Consumers declare their events and the package derives the union:

```ts
const MailReceived = JsonlEvent.make("mail-received", { data: MailReceivedData });
const Unlinked = JsonlEvent.make("unlinked", { data: Schema.Void, terminal: true });
const Relinked = JsonlEvent.make("relinked", { data: RelinkData, reopen: true });
```

Two properties are load-bearing. The envelope schema is **derived from the registry**, so the discriminated union a consumer reads is exactly the set of events it declared — no hand-written union to drift (what "derived" means mechanically is [two-stage](#the-derived-union-is-a-type-the-read-path-is-a-frame)). And an unrecognized `event` tag on read is a **typed error, never a defect**, per the [input-hardening standard](../effect-standards.md#input-hardening-standards): a file written by an older or newer version of the same application is hostile input in the technical sense, and hostile input fails typed.

### A payload schema may not require services

**`data` schemas are bounded to `Schema.Codec<unknown, unknown, never, never>`** — the last two parameters, `DecodingServices` and `EncodingServices`, are pinned to `never`. A consumer cannot register a payload schema whose decode or encode needs something from context.

This is a **contract, not an implementation detail**, and it is what makes [acceptance criterion 2](#acceptance-criteria) reachable at all. The pure core's whole promise is `decodeResult` / `encodeResult`: synchronous, `Result`-returning, no runtime — and `Schema.decodeUnknownResult` / `encodeUnknownResult` **demand `never` in both service slots**, because a sync function has nowhere to get a service from. Admitting a service-requiring payload schema would mean the hook script could no longer read a line without building a runtime, and the failure would land on the *consumer* at their call site rather than on the library at registration. Forbidding it structurally moves the error to `JsonlEvent.make`, where it is legible.

The bound is stated explicitly rather than reached for via `Schema.Top`: `Schema.Top`'s service parameters are `unknown`, not `never`, so a registry typed over `Top` does not satisfy the sync codecs and the constraint silently fails to bind.

**The first two parameters are `unknown`, not `any`** (as-built, P2). The type and encoded parameters are covariant, so every concrete payload schema satisfies an `unknown` bound while a service-requiring schema is still rejected on the last two — `unknown` is strictly more precise than `any` here, and it costs no `noExplicitAny` suppression. `any` would have widened the bound without buying anything the constraint needs.

### The derived union is a type; the read path is a frame

"Derived discriminated union" is precise about *what* is derived and needs to be equally precise about *where*: **the derivation is at the type level, and the runtime read path is a two-stage decode.**

A `Schema.Union` **value** over the full envelopes cannot be the read path. To discriminate, a union decoder tries members — which decodes `data` **eagerly**, for every line, including the lines a `Slice` is about to discard. That is precisely the [filter-before-`data`-decode guarantee](#slice-the-shared-read-vocabulary) inverted, and it would make the package's headline property false while the types still looked right.

The working shape is two stages:

1. **The envelope *frame* decodes first** — `{ at, event, scope?, data: Schema.Unknown }`. `data` stays undecoded. The frame is what `Slice` filtering reads, and filtering on `event`, `scope` and `at` never touches the payload.
2. **The registered `data` schema applies on demand**, looked up by the frame's `event` tag, and **only to the lines a slice selected**.

So "derived union" means the derived **type** union — what a consumer's `changes` stream is typed as, what narrowing on `events: [...]` narrows — while the runtime path is frame-then-payload. A `Schema.Union` value may still be offered where eager decoding is correct and cheap, notably `encodeResult`, which has one known event and no filtering to preserve.

### No depth guard ships, and the frame is why

[`hardening-a-parser-port`](../effect-standards.md#input-hardening-standards) would normally put a depth guard on a parser fed untrusted input. This package ships none, deliberately, and the frame is the reason:

- **The frame is depth-independent by construction.** `data: Schema.Unknown` passes the payload through **without traversing it**, so the per-line frame decode is **O(1) in payload depth** — pinned as-built by a 200k-deep test.
- **Parse depth is not a hazard on the reference engine either**: V8's `JSON.parse` is iterative, not recursive, so a deeply nested line does not blow the stack on the way in.

Two qualifications keep that from being an overclaim:

- **A consumer's *recursive* payload schema (`Schema.suspend`) makes payload-decode depth input-driven.** That risk lives in the consumer's schema, not in this package, and is **deliberately not second-guessed** — a library that refused to register a recursive schema would be dictating the consumer's data model to avert a cost the consumer chose.
- **The residual hazard of deep payloads is failure *rendering*, not decoding.** Mutating the frame's `data` to a traversing schema overflowed the stack **inside effect's issue formatter**, not the decoder. So the thing to watch on pathological input is the cost of *reporting* a failure, which is worth knowing before someone concludes the decode path is the fragile one.

**Where the depth independence stops, stated as a property**: the **frame** is depth-independent; **stage two is not**. The registered payload schema does traverse, so a hostile deep payload aimed at a *known* tag pays full decode cost — **on selection**. That is the intended trade rather than a gap in it: **you pay only for the lines you selected**, and a filter that excludes the hostile tag excludes its cost entirely. Saying so explicitly stops the O(1) claim from being read as covering the whole read path.

**A void payload encodes as `data: null`, and the two optional-looking fields are not symmetric.** JSON has no `undefined`, and `JSON.stringify` **silently drops** keys whose value is `undefined` — which would emit a frame missing its required `data` key and therefore unroundtrippable (a real bug, caught and fixed in P2). So: `scope` is genuinely optional and may be absent from a line; `data` is **required and never absent**, with `null` as its empty spelling.

The boundary of that fix, verified: a payload schema whose **encoded** form is `undefined` for any reason *other* than `Schema.Void` still does **not** round-trip — it encodes to `null` and then fails payload decode with `InvalidData`. That is strictly better than the pre-fix behavior, which failed at *frame* decode with a missing required key, but it is not a round trip. The guidance that follows: use **`Schema.Void`** for payload-less events, and **`Schema.NullOr(...)`** where absence must be representable *within* the payload.

`at` being service-assigned rather than caller-supplied is the deliberate one. A caller-supplied timestamp makes ordering a lie the moment two writers disagree about the clock, and it hands every test the job of stubbing a field the library could have owned.

## Module layout: a pure core plus one service

Module-per-concept per the [module layout standard](../effect-standards.md#module-layout-module-per-concept); no barrels, no namespace objects, one public name per file.

**As-built note on the grouped-statics form.** `Envelope` and `JsonlEvent` land as a **merged `interface` + `const`**, not as static classes. That is the [`config-file` `MergeStrategy` precedent](config-file.md), and it is forced rather than chosen: each name is shared with a same-file generic interface, and merging a class into one of those is a TS2300/TS2428 compile error. The accepted cost is that an object literal's member types are inferred in the built `.d.ts` and lose their TSDoc; the accepted consequence is that a bare `{@link Envelope}` is ambiguous and must use the **`{@link (Name:variable)}` selector** form. Do not "tidy" either name into a static class — it will not compile.

The **pure core** is synchronous and `Result`-based per the [sync primitive policy](../formatter-convention.md#decision-6--the-sync-primitive-policy), because acceptance criterion 2 is a hook script with no runtime:

- **`Line`** — split text into candidate lines, parse one line (`parseResult`), walk back from the end to the last valid line (`lastValid`), and keep byte-offset bookkeeping. A malformed interior line is a **typed value in the result**, not a thrown error and not a silently dropped line; the caller decides whether a hole in the middle is tolerable. Interior blank lines are returned rather than hidden, with one accepted wrinkle: `String.trim()` classifies **NBSP (`U+00A0`) and BOM (`U+FEFF`) as whitespace**, so a line containing only those is skipped as blank rather than reported — known and accepted. One precision note on the offsets: an **unpaired surrogate** in a hand-built input string is not byte-round-trippable (it UTF-8-encodes to `U+FFFD`), but the offsets stay correct *against the file* because they describe what a UTF-8 write emits — and text read back from a real UTF-8 journal can never contain one, so only a caller passing a hand-built string can reach this.
- **`Envelope`** / **`JsonlEvent`** — event definitions, the registry, **the envelope frame schema and the derived union type** ([two stages, not one](#the-derived-union-is-a-type-the-read-path-is-a-frame)), the `terminal` and `reopen` markings, and `decodeResult`/`encodeResult` sync primitives alongside their `Effect` forms, each `Effect` form defined in terms of its sync twin so the two cannot diverge. The sync primitives are what pin the [no-services bound](#a-payload-schema-may-not-require-services) on payload schemas.

The **service** is one:

- **`Journal`** — the single service, per-registry by construction (see [the service factory](#the-service-is-a-factory-not-a-generic-key) below): the registry rides on the class-definition site, the layer takes a `JournalConfig` of `{ path, directory?, capacity?, shutdownPublishTimeout? }` (see [the activation-watch target](#the-activation-watch-target-is-configurable)), and the lifecycle is scoped. The layer is **`Layer<Self, PlatformError, FileSystem.FileSystem>`** — a *missing* journal constructs cleanly, an *unreadable* one [fails typed](#a-missing-journal-is-a-legal-state).
- **`JsonlError`** — one error taxonomy of **eight** tags: `MalformedLine`, `UnknownEvent`, `InvalidData`, `TerminalViolation`, `JournalNotFound`, `UnserializableData`, `JournalClosed`, `JournalResync`, with core `PlatformError` passed through rather than wrapped. Each tag names a distinct recovery a caller would actually make; `cause` is carried structurally, never stringified.
  - **`JournalClosed`** is [shutdown refusal](#journal-operations) — the closed flag rejecting an append after scope close. It is separate from `TerminalViolation` on the taxonomy's own rule, one recovery per tag: `TerminalViolation` is a **journal-state** condition (a terminal event is at the tail; the recovery is an event declared `reopen`), while `JournalClosed` is a **lifecycle** condition (the service is going away; the recovery is a new layer, or stopping). It carries **only the event tag whose append was refused** — no `cause`, because nothing threw, and no path, because the path is the service's, not the caller's.
  - **`UnserializableData`** covers the encode path: `JSON.stringify` can **throw** on a payload that satisfies its registered schema but is not JSON-serializable — a `BigInt`, a circular structure — which is reachable through a perfectly legal `data: Schema.Unknown` registration. The stringify is **guarded**, and the failure is typed, carrying the event tag and the thrown cause structurally. An encode throw is not a defect here: the payload came from the caller, and hostile-or-merely-wrong caller input [fails typed](../effect-standards.md#input-hardening-standards).
  - **`JournalResync`** is the [truncation-or-replacement](#process-model-cooperative-writers-always-watching) breach: `path`, `reason` (`"truncated" | "replaced"`), `expected` (the logical offset consumed to) and `actual` (the file's logical size now). **One tag despite two distinguishable causes**, because they share one recovery — discard all cursor-derived state, re-read from zero (rebuild projections, re-seed `latest`), and surface to a human that the cooperative-writer contract was broken. **`reason` is diagnostics, not a branching invitation.** Rejected reuses, worth recording because each is superficially plausible: `JournalNotFound` would instruct the consumer to **create** a journal and destroy the evidence of the breach; the decode tags fit nothing, since the visible bytes are well-formed and it is the **reader's position** that became meaningless; and `TerminalViolation`/`JournalClosed` are lifecycle facts about *our* journal, whereas here the **file moved out from under a healthy journal**.
  - **`InvalidData` carries its `SchemaError` via `Schema.declare`**, with one accepted consequence: it **cannot round-trip through its own schema**. That is irrelevant in-process, where the error is thrown and caught as a value, and would only matter if a `JsonlError` were ever serialized — over RPC, say. Known and accepted; noted so nobody discovers it as a surprise while wiring a transport.

A generic "any line schema" JSONL reader stays **internal**. Exposing it would make the envelope optional, and an optional envelope is not a contract — `scope`, `at` and the tag union are precisely what the read vocabulary is built on.

It is also what makes a torn tail **detectable at all**. An envelope is always a JSON *object*, and every strict prefix of an object text is invalid JSON, so a half-written envelope always fails to parse and the walk-back always finds it. A journal of bare scalars has no such property — `42` torn mid-write is `4`, a perfectly valid line with a silently wrong value — so a generic reader would hand back corruption that the envelope reader structurally cannot. That is a second, independent argument for the envelope being mandatory rather than a convention, and it produces a rule the service is held to from `Envelope` onward: **"the last valid line" always means the last valid *envelope*, never merely the last valid JSON.**

### The service is a factory, not a generic key

`Journal` **cannot be a `Context.Service` that is itself generic over the registry.** `Context.Service` binds a concrete `Shape` at *declaration* (`Context.ts:200-232`); the resulting Key carries that shape and cannot be parameterized at retrieval. There is no form in which `yield* Journal` returns something typed by a registry supplied at the use site.

The kit already solved this, in [`config-file`](config-file.md#service-api-and-per-schema-identity): a **per-registry service-class factory** plus a layer-returning function, exactly the `ConfigFile.Service<Self, A>()(id)` shape (`packages/config-file/src/ConfigFile.ts:271-274`). Each registry gets its own uniquely-keyed service class, so several journals coexist in one layer graph and each one's `append`, `changes` and `projection` are typed by *its* registry:

A type probe against the installed beta confirmed the shape: the class factory takes the registry **at the class-definition site** — `Service<Self>()(id, { events })`, so `Self` is the only explicit type parameter and the registry is inferred — and the whole thing costs exactly **two erased-engine casts** internally, which is the budget this pattern is worth and not more.

```ts
class MailJournal extends Journal.Service<MailJournal>()("dogfood/MailJournal", { events: MailEvents }) {}

// Bind the layer ONCE, at module scope, and provide this const everywhere.
export const layer = MailJournal.layer({ path });
```

Two consequences are recorded rather than discovered:

- **The const-binding hazard is inherited with the pattern**, and the obligation it creates is the **consumer's**. Layers are memoized *by reference* per the [services and layers standard](../effect-standards.md#services-and-layers-standards), and `MailJournal.layer(...)` is a layer-returning function, so **a consumer must call it once and export the resulting const** — as above — rather than calling it at each provide site. Calling it twice mints **two independent journal instances over one file**, each with its own semaphore, watcher and `PubSub`: the appends are no longer serialized against each other, which is exactly the in-process version of the bug the cooperative-writer rules exist to prevent. The library's side of this is a TSDoc warning on `layer` **and a test**, matching config-file; the consumer's side is the one-line rule stated here, and it belongs in the README's first example.
- **This is the sanctioned exception to "avoid layer-producing functions"**, on the same grounds config-file's is: the layer is genuinely parameterized, by a registry the library cannot know. It is not license to add a second one elsewhere in the package.

Core's own `eventlog` solves the same problem the other way — a non-generic service plus a *generic client factory* — and was considered. It is rejected here because the registry has to type the service's own operations (`append` narrows on the event tag, `changes` narrows on the slice), not just a client wrapped around it; splitting them would put the typed surface one indirection away from the thing consumers hold. It stays on the record as the **escape hatch** if the factory's typing proves unworkable in some corner the probe did not reach — it is a known-good fallback, not a live alternative.

## Slice: the shared read vocabulary

`Slice` is one filter shape used by **every** read surface:

```ts
interface Slice {
  readonly events?: ReadonlyArray<Tag>;
  readonly scopes?: ReadonlyArray<string>;
  readonly from?: DateTime.Utc;
  readonly to?: DateTime.Utc;
}
```

| Surface | Shape | Use |
| --- | --- | --- |
| `changes(slice?)` | live `Stream` | Subscribe to one writer's events and not another's: `changes({ events: ["mail-received"], scopes: ["mailbox-a"] })`. |
| `changes({ ...slice, cursor })` | replay then tail | Resume from a byte-offset cursor and continue live through the same filter — one seam, not two APIs. |
| `query(slice & { cursor? })` | finite `Stream` | Historical read with the same shape as the live one. |
| `projection(initial, fold, slice?)` | folded state | A per-scope state machine over a shared file: the fold only ever sees its own slice. |

Three properties make this more than a convenience. **Filtering happens on envelope fields, and on the disk paths the payload decode is structurally unreachable for non-matching lines** — stated precisely [below](#what-filter-before-decode-actually-guarantees). **Typed narrowing**: passing `events: ["mail-received"]` narrows the stream's element type to those envelope variants, so a projection over a slice is exhaustively checkable. And **one vocabulary means one thing to learn** — a consumer who can express a subscription can express a query and a projection without translating.

### Slice boundary conventions

Both range axes are **half-open**, and the reason is tiling:

- **`from` is inclusive, `to` is exclusive.** Adjacent windows therefore tile without double-delivery — `[t0, t1)` followed by `[t1, t2)` delivers each envelope exactly once. `at` collisions are not exotic here: at millisecond resolution they are common, and under `TestClock` several appends routinely share an identical `at`, so a closed upper bound would double-deliver constantly in exactly the tests meant to prove correctness.
- **`cursor` compares at-or-after against `line.offset`.** So a consumer that persists the last processed envelope's **`line.end`** resumes with exactly the unprocessed remainder — no replay of the line it already handled, no gap.

Both conventions exist so that the obvious consumer code — record where you stopped, resume from there — is also the correct code.

### What "filter before decode" actually guarantees

The headline property needs stating honestly, because the structural guarantee holds on some paths and not others, and the overclaimed version would be found false by the first person who read the hub's type.

- **On the disk paths — `query`, and the replay half of `changes`** — payload decode is **structurally unreachable** for a line the slice does not match. The frame decodes, the filter runs on envelope fields, and a non-matching line's payload schema is never invoked.
- **On the live path**, the hub carries **fully-decoded envelopes** — [decision 9](#decisions-record)'s field type, and deliberate. The **writer decodes its own line once**; a frame-carrying hub would instead push payload decode into *every* subscriber, which is strictly worse the moment there is more than one.

The property, stated so it is true on every path: **a consumer never pays for a neighbour's payload on any read it performs; a writer pays once for its own line; and each process pays at most once per line entering it through the live path.**

The [token-economy motivation](#motivation-the-token-economy-as-an-api-contract) is untouched by this correction — "the current state of mailbox A costs the tail, not the history" is a statement about a **read**, and reads are exactly where the structural guarantee holds.

### Consumption model

**`Stream` is the single canonical return type of every slice surface.** Queue-style consumption was considered as a default and rejected; it remains one line away through core interop, with the *consumer* choosing the buffering policy:

```ts
const queue = yield* Stream.toQueue(journal.changes(slice), { capacity: 64, strategy: "sliding" });
```

`Stream.toQueue(self, { capacity, strategy })` and `Stream.runIntoQueue(self, queue)` are both present in the vendored `Stream.ts` at `4.0.0-beta.101`, with `capacity: "unbounded" | number` and `strategy: "dropping" | "sliding" | "suspend"`.

A default `Queue` surface loses three things. It **forces one buffering policy on every consumer**, when the right policy is a property of the consumer and not of the journal — a dashboard wants latest-wins, an auditor wants lossless. It **loses stream composition and typed completion**: `toQueue` returns `Queue.Dequeue<A, E | Cause.Done>`, so quiescence arrives as a sentinel in the error channel rather than as the end of a stream, and every consumer has to match on it. And it **drops the typed-narrowing property**, since the combinators that make `events: [...]` narrow the element type are stream combinators. Returning `Stream` and documenting the one-line conversion gives Queue consumers everything they wanted without charging Stream consumers for it.

**The journal's internal `PubSub` is bounded with backpressure.** The journal itself never drops an envelope on behalf of a slow subscriber: slowness propagates to the producer side, where it is visible, rather than being resolved by a silent gap in somebody's subscription. A consumer that genuinely prefers dropping to waiting expresses that preference in its own `toQueue` strategy, which is exactly where the choice belongs. This is what makes "a subscription is either complete or explicitly lossy" a property the package can state. `PubSub.bounded` is the backpressured constructor, so that pin is one constructor choice.

#### Quiescence is a published `Take`, not a hub shutdown

Two properties this design leans on — quiescence arriving as **stream end**, and shutdown completing subscriber streams rather than tearing them — **do not fall out of a plain `PubSub`**, and the mechanism has to be named or an implementer will reach for the wrong one:

- `Stream.fromPubSub` has **no termination signal**. A stream over a raw hub runs until interrupted; there is no value a publisher can send that ends it.
- `PubSub.shutdown` **interrupts subscribers**. Using it to signal "the journal is done" produces exactly the tear the [graceful-shutdown rule](#journal-operations) forbids, and an interrupted subscriber is indistinguishable from a crashed one.

The mechanism is therefore:

```ts
const hub = yield* PubSub.bounded<Take.Take<Envelope, JsonlError>>(capacity);
```

Envelopes are published as `Take` chunks, **end-of-stream is published as an `Exit`** (`Take.ts:29`), and subscriber streams are built with **`Stream.fromPubSubTake`** (`Stream.ts:1362`), which interprets that Exit as the end of the stream. Quiescence and graceful shutdown then arrive at every subscriber as a normal, typed stream end — the property the [consumption model](#consumption-model) claims — and failures ride the same channel instead of needing a second one.

A derived requirement falls out and is pinned here: **subscribing to an already-quiescent journal must terminate, not hang.** A done-`Exit` published before a subscriber attached is invisible to that subscriber — a hub has no replay — so a late `changes` call over a terminated journal would otherwise wait forever for an event that has already happened.

**Resolved (P4): termination is *per-subscriber*, not a hub-wide replay.** Two mechanisms, both local to `changes`:

- **`changes` ends its own stream on seeing a terminal envelope**, via `takeUntil` on the **unfiltered** stream — unfiltered so that a slice which *excludes* the terminal event still ends rather than hanging forever on a journal that is over.
- **A quiescent check at subscribe** ends the stream immediately for a subscriber attaching after the fact.

**Rejected: replaying the terminal Exit.** It duplicates envelopes for live subscribers, and a *hub-wide* Exit is worse than that — it would **permanently end already-attached subscribers**, making `reopen` unrepresentable for them. A journal that can be reopened must not have its subscribers killed by the terminal event.

The finalizer's Exit still owns **shutdown**; these two mechanisms own **quiescence**. One pin: a subscriber whose slice **matches** the terminal event **receives it, then ends** — termination must not swallow the envelope that caused it.

The three consumer postures are therefore **recipes over core primitives, not API surface**:

| Posture | Recipe | When |
| --- | --- | --- |
| Lossless | `Stream.runForEach` directly on the slice stream | Auditors, projections, anything where a missed envelope is a bug. |
| Latest-wins | `Stream.toQueue(stream, { capacity: n, strategy: "sliding" })` | Status displays, where only the current state matters and history is noise. |
| Batch-draining | bounded `Stream.toQueue` plus `takeAll` | Consumers that amortize work across a burst rather than paying per envelope. |

## Journal operations

- **`append(event, data, { scope? })`** — validate against the event's schema, encode, then `writeAll` the complete line to a file opened `{ flag: "a" }`, under the atomicity terms and the short-write rule stated in [the append primitive](#the-append-primitive-and-what-atomicity-actually-means). In-process concurrency is serialized by a one-permit `Semaphore` (the same guard [`ConfigFile.update`](config-file.md#merge-and-hardening-properties) uses). Appending after a terminal event fails typed with `TerminalViolation` unless the appended event is declared `reopen`. Appending to a journal that does not exist fails typed with `JournalNotFound` — **an append never creates the file**.
- **`appendPatch(patch)`** — inherit-and-patch: read the last valid envelope, merge the patch over its `data`, validate the result, append. This is `journal-append.sh` as a typed API and the primary operation for snapshot-style journals, where each line is a complete state and most transitions change one field. **The whole read-merge-validate-append sequence is atomic under the append permit** — not merely the write. It is a read-modify-write, and with the read outside the lock the review demonstrated a **deterministic lost update**: two patches to *different* fields of one snapshot, the second silently reverting the first. That is inherit-and-patch's exact use case, so the narrower lock would have been wrong precisely where the operation is used most. The merge domain itself is [asymmetric by ruling](#the-merge-guard-is-asymmetric-and-why-config-files-is-not).
- **`latest`** — a `SubscriptionRef`-shaped observable of the current last valid envelope as an `Option`, plus a quiescent signal once a terminal event is the tail. Watching state is the common case; making it a ref rather than a fold is what keeps the common case one line. It is served by a [bounded tail read](#the-bounded-tail-read-is-the-sanctioned-cheap-read), never a whole-file read. **The quiescent signal is *derived* from `latest`** — is the tail event terminal — **and is not a second piece of state**: a separate ref could drift out of agreement with `latest`, and a derivation cannot. The [already-quiescent subscriber behavior](#quiescence-is-a-published-take-not-a-hub-shutdown) reads this derived signal.
- **`changes` / `query` / `projection`** — as above. Every element carries its byte-offset cursor so iteration is resumable across process restarts, and those cursors are **logical post-BOM** like every other offset the package emits — a cursor is only resumable if the reader that consumes it agrees with the reader that produced it. **The earlier claim here — "streaming-first: no operation ever holds the file in memory" — was false as built and is corrected rather than softened**: the memory bound is **per-path**, and only `latest` and the `lastValid`-backed reads are window-bounded. The **historical read** — `readFrom`, behind `query` and the replay half of `changes` — reads its requested region in **one allocation bounded by the file size** and **buffers matching envelopes before emitting**. It is bounded by the **cursor**, not by a window, so a cursor-less `query` over a large journal does hold that region in memory. A **paged `readFrom`** — per-window emission with an unterminated-tail carry across window boundaries — is **tracked follow-up work and does not ship**. See [the bounded tail read](#the-bounded-tail-read-is-the-sanctioned-cheap-read).
- **`create` / `remove`** — explicit file lifecycle, so "the journal does not exist yet" is a decision the consumer makes rather than a side effect of the first append. See [the missing-journal contract](#a-missing-journal-is-a-legal-state) for what the other operations do before `create` has been called.

**No sidecar index.** A linear scan is the honest v1: an index is a second source of truth that an external writer — which the [process model](#process-model-cooperative-writers-always-watching) explicitly permits — can invalidate without notice, and reconciling it correctly is a larger problem than the one the package is solving. If scan cost ever bites, the fix is a cursor the consumer persists, which the API already hands out.

**Graceful shutdown** is part of the scoped layer: on scope close new appends are refused with a typed error, in-flight appends flush, and subscriber streams complete rather than being torn. A journal that loses its last append at shutdown is worse than one that refuses it.

### The bounded tail read is the sanctioned cheap read

There is a real tension between `Line.lastValid(text)` — which takes *whole text* — and the [token-economy contract](#motivation-the-token-economy-as-an-api-contract), and it lands exactly on [acceptance criterion 2](#acceptance-criteria): a hook that reads the entire journal into memory to answer "what is the last line" has paid for the history it was promised it could skip. The pure core is not wrong to take a string — it is pure, and strings are what pure functions take — but **the recipe for getting that string must be part of the design, or every consumer will reach for "read the file".**

The sanctioned recipe, which is what the hook path and the README must show:

1. `stat` for the size, then read the **last N bytes** via the offset read.
2. **Decode from a newline boundary**: discard the first partial line in the window, *unless* the window starts at offset 0 — in which case it is a real first line, not a fragment.
3. Walk back from the end to the last valid envelope.
4. **If no valid envelope is in the window, widen it and retry.** A journal whose last line is longer than the initial window is not an error, it is a bigger window.

Every offset this recipe reports is **logical post-BOM**, like every other offset the package emits. `bomBytes` comes from the **start of the file**, read once — a tail window cannot tell you whether the file began with a BOM, so it must never be the source of that answer.

Two consequences bind the implementation:

- **The service's own `latest` and every `lastValid`-backed read use bounded tail reads, never a whole-file read.** This is a constraint on the service, not a suggestion to the consumer, and it carries the same widening rule.
- **Acceptance criterion 2 is qualified accordingly.** "The hook path needs no runtime" stays true; "the hook path is cheap" is true **only via this recipe**. The README may not claim the cheap read without showing it — a documented `readFileString` + `lastValid` example would be an honest-looking demonstration of the exact cost this package exists to avoid.

#### What the recipe does not cover: the historical read is cursor-bounded, not window-bounded

Stated plainly, because the design previously implied otherwise and the implication was false. **Only `latest` and the `lastValid`-backed reads are window-bounded.** The **historical read** — `readFrom`, which sits behind `query` and behind the replay half of `changes` — does **not** use the bounded-tail recipe:

- It reads its **requested region in one allocation**, bounded by the **file size**, not by any window.
- It **buffers matching envelopes before emitting**, so the stream it returns is fed from a materialized batch rather than produced incrementally.
- Its only bound is therefore the **cursor**: a consumer that resumes from a persisted `line.end` pays for the remainder, and a **cursor-less `query` over a large journal pays for the whole file** — in one string and one match buffer.

The consequence, said without softening: **"no operation ever holds the file in memory" is not a property this package has.** The token-economy contract holds for the surfaces it was measured on — `latest`, the hook path, and any read that carries a cursor — and a cursor-less historical read is the exception, not a rounding error in the claim.

**A paged `readFrom` is the fix and is tracked follow-up work, not shipped.** Its shape is known: emit per window rather than per call, and carry an **unterminated tail** across the window boundary so a line straddling two windows is decoded exactly once. It is written down here so the gap is a scheduled correction rather than a rediscovery.

### A leading BOM is stripped at the service boundary, not in the core

Decided here rather than discovered later: a journal written by a BOM-emitting tool would otherwise have its **first line permanently `MalformedLine`** — `split` hands `U+FEFF` to line 0 and `JSON.parse` throws on it, forever, for every reader.

- **The service's read boundary strips a single leading BOM**, and does so **explicitly at the byte level**. It does *not* get this by reading through `FileSystem.readFileString`, whose silent strip is a documented [`@effected/templates` finding](templates.md) (`readFileString` strips a leading BOM; templates decodes with `TextDecoder("utf-8", { ignoreBOM: true })` precisely to *keep* it). Journal reads are offset-based, so an implicit strip somewhere in the read path would silently desynchronize every offset the package hands out — the strip has to be a decision the code makes visibly, once, at the boundary.
- **The pure core does not strip.** `Line` stays byte- and string-honest: it reports what it was given. A core that quietly removed a leading code point would make its offsets disagree with the file, which is the one thing its offsets exist to do.
- **Offset convention, stated explicitly**: after a BOM is stripped, offsets are **relative to the post-BOM start** — the first line begins at offset 0, not offset 3. Consumers never see BOM-shifted offsets, and a cursor round-trips against the same reader that produced it.
- **Offsets are logical post-BOM on *every* path** — tail reads, full scans, and **the append cursor seeded at construction**. `bomBytes` is determined **once, from the start of the file**, and **never inferred from a window's position**: a bounded tail window does not begin at the file start, so nothing about it can tell you whether the file opened with a BOM. The review caught physical offsets leaking on the BOM-plus-large-file path and a physically-seeded consumed cursor; since the watcher builds its cursors on this convention, a single physical leak desynchronizes everything downstream of it.

Exactly one leading BOM is stripped. A `U+FEFF` anywhere else in the file is content, and content is not the read boundary's to edit.

Refusal and drain are **two mechanisms, not one**, and the earlier sketch conflated them. A `Latch` cannot refuse: `Latch.await` suspends until the latch opens and has **no failure channel** (`Latch.ts:52-90`), so a closed latch makes a late append *hang*, which is the opposite of the intended behavior. The split:

- **Refusal is an explicit closed flag**, checked *before* the append semaphore is taken, failing typed with **`JournalClosed`**. Checking before the permit matters — a late append must not queue behind a draining flush only to be refused after waiting.
- **Drain is the latch's half.** The finalizer awaits in-flight work (the latch, or an equivalent completion signal) before publishing the terminal Exit that completes subscriber streams, so the last accepted append is on disk and visible to subscribers before the streams end.

### The merge guard is asymmetric, and why config-file's is not

`appendPatch`'s merge guard is an **asymmetric `canMerge`**: both sides must be record-like, **and the patch must not bring a conflicting prototype** — it may be plain, null-prototype, or the base's own.

The asymmetry is forced by the primary use case rather than chosen for elegance. A caller's partial patch is a **plain object literal even when the base is a `Schema.Class` instance**, so [`config-file`'s *symmetric* guard](config-file.md) — both sides record-like **and sharing a prototype**, which is exactly right for merging two peer documents — would **reject the main case here**. Same hazard, different shape of operands; the pollution filtering is identical and only the prototype rule differs.

Outside that domain — cross-prototype, scalar, array or void bases — the patch **replaces** rather than merging, and a *partial* patch against such a base then fails typed as `InvalidData` **naming the missing keys**, which is the honest outcome: the caller asked to patch something that has no fields to inherit.

**Corrected rationale, on the record.** The earlier `isPlainRecord` guard was described as risking silent loss. That was wrong, and the correction matters more than the original claim: it made `appendPatch` **loudly unusable** with class payloads — `InvalidData` on *every* call — rather than silently lossy. The silent-loss scenario was probed **unreachable** by both the implementer and the reviewer independently. A design record that keeps a scary-but-false hazard is worse than one that records the real, duller failure.

### The publish stage sits outside the write critical section

The review found a **deadlock by construction** in the obvious implementation, and the fix is a design pin rather than a coding detail. The deadlock: the hub publish backpressures, so a *suspending* publish inside the append critical section, plus one stalled subscriber, wedges **every** writer — and then wedges scope close too, because the finalizer waits to drain the very permit the suspended publish is holding. A slow reader takes down the writer, which is the opposite of the intended failure mode.

Four pins resolve it:

1. **The write critical section covers the file write and the ref updates only.** A suspending hub publish never sits inside it.
2. **Publish order equals write order**, preserved by a dedicated **publish-ordering stage** whose slot is acquired *under* the write permit and executed *outside* it. Order is a property of acquisition, not of execution, which is what lets the publish leave the lock without becoming reorderable.
3. **The backpressure pin is unchanged.** An append completes only once the hub has accepted its envelope, so a slow subscriber's pressure still lands **visibly on appenders** rather than as a silent drop. This is the [consumption-model guarantee](#consumption-model) and moving the publish out of the lock must not weaken it — the append still waits, it just no longer waits *holding the write permit*.
4. **The terminal-Exit drain at shutdown is bounded**, with the limit stated honestly: a subscriber that **keeps consuming** observes stream end; a subscriber that **never consumes again** cannot observe completion through a channel it refuses to read, and — the point of bounding it — **does not hold scope close hostage**. The alternative is a shutdown that hangs on an abandoned reader.

Two shapes are rejected on the record. **Publish inside the permit** is the deadlock above. An **unbounded staging queue** between the write and the publish would decouple them cleanly and **silently break pin 3**: appends would complete before the hub accepted anything, so backpressure would stop propagating to appenders and a slow subscriber would become an invisible memory leak instead of a visible stall.

#### The append path reads inside the write permit, and publishes external bytes first (as-built)

Recorded explicitly so a later reader does not mistake it for a pin-1 violation and "fix" it back into a bug. **Pin 1 prohibits *suspending on a subscriber* inside the critical section, not reading the file inside it.** A bounded read cannot be wedged by a stalled consumer, so it is legal there — and it is necessary there, because a cooperating writer's bytes that landed since our last ingest must be reconciled *before* our own line goes on the end, or the journal's order and the hub's order disagree.

As built, the append path therefore:

1. **Performs a bounded read inside the write permit** to ingest a cooperating writer's **un-ingested bytes**. Legal under pin 1, on the reading-versus-suspending distinction above.
2. **Publishes that external batch *before* its own envelope, on one baton slot.** One slot, not two, is what makes the pair indivisible against another appender's slot; publishing external-then-own within it is what makes **hub order equal file order**, which is the property [criterion 3](#acceptance-criteria) is really testing when two instances cross-observe each other.

**The residual, named honestly — and it is worse than an ordering skew.** An external write that lands **between our `writeAll` and our `fstat`** is a **TOCTOU**, and a worst-case injection probe demonstrated **three** consequences, not one:

1. **Our own line's reported offset is wrong**, by exactly the length of the external write — every cursor derived from it is off by that much.
2. **The interleaved external line is silently dropped.** Setting `consumed` to our computed `end` skips straight past it, so those bytes are never ingested, never published and never folded into a projection. **A silent drop is precisely what this package's [cooperative-writer contract](#process-model-cooperative-writers-always-watching) claims not to do**, which is why it is stated here rather than left as "an ordering issue".
3. **Our own line is published twice.** The next gap decode re-covers the region our append already published, so a subscriber sees the same envelope a second time.

An earlier draft of this paragraph described only an ordering skew. That was an **understatement of a demonstrated result**, and it is corrected rather than qualified.

**The window is genuinely tiny** — between two syscalls, both under the write permit — so the probability framing stands: this is a rare interleaving, not a routine one. What does **not** stand is the earlier claim that "no lock-free scheme closes it", which conflated prevention with detection:

- **Prevention is impossible lock-free.** `O_APPEND` gives the writer **no way to learn where its bytes landed**, so nothing short of the advisory lock [the process model rejects](#process-model-cooperative-writers-always-watching) makes the write-and-locate pair atomic — and against a shell script with `>>` such a lock would not be honored anyway.
- **Detection is possible lock-free, and is declined on cost.** A **read-back verification** — comparing the bytes at `[offset, end)` against what was written — would catch every one of the three consequences above, at the price of **one extra read per append**. That is a real trade with a real number attached, and it is refused because the append path is the latency-sensitive one; it is written down so the option is a standing decision rather than an unexplored corner.

The honest form of the limit, then: **no lock-free scheme prevents it; detection by read-back is possible and is declined at that cost.** It is a stated limit of the cooperative contract, not an outstanding bug.

#### The ordering stage is a chained-deferred baton (as-built)

The mechanism that satisfies pin 2 without violating pin 1. Each append, **while holding the write permit**, links a fresh `Deferred` onto the chain — linking is **non-suspending and O(1)**, which is the entire reason it is legal inside the critical section. It then **releases the permit**, awaits its predecessor, publishes, and passes the baton on via **`ensuring`**, so an interruption mid-publish cannot strand its successors. That last property was verified adversarially rather than assumed.

**Rejected refinement, on the record:** a *second semaphore* acquired under the write permit. It looks equivalent and is not — when contended it would **suspend inside the critical section**, which is pin 1's exact prohibition and reintroduces the deadlock through a smaller door. As the reviewer put it, that distinction is the whole design: the ordering primitive must be one that can be *taken* without ever *waiting* while the write lock is held.

#### Pin 4's real property: completed appends precede the Exit

Pin 4 needs stating precisely, because the obvious phrasing is weaker than the guarantee: **every append that *completed* is delivered before the terminal Exit.** Per-append hub acceptance does **not** compose into that property, for a specific reason — **the Exit is not on the ordering chain**, so nothing about the individual publishes orders it against them.

As-built: the finalizer **captures the publish-chain tail under the write permit** — a consistent snapshot, since the baton is only ever mutated under that permit — and awaits it **within the same bounded interruptible region** before publishing `Exit.void`.

This was a **demonstrated regression of the initial baton fix**, not a theoretical hole: the terminal Exit overtook an already-written envelope. It was invisible to the obvious test and visible only to a subscription in an **outer scope that outlives the journal's** — which is the shape a real consumer has, and the reason the test had to be written that way rather than the convenient way.

#### The shutdown bound is configurable

`JournalConfig.shutdownPublishTimeout`, default **5s**. One consumer-facing note worth carrying into the README and TSDoc: the bound is **`Clock`-based**, so under a `TestClock` it fires **only if the clock is advanced**. That is Effect's timeout semantics rather than anything this package does, and it is the kind of thing that reads as a hang in a test that never advances time.

## Process model: cooperative writers, always watching

The decision: **instances of the same application cooperate under shared rules, and the service always watches the file.** Not single-writer-only, which the dogfood precedent already violates in practice; not multi-writer locking, which buys correctness against arbitrary writers at a cost this file format does not justify.

External appends are a fact of JSONL life — a shell script, a second MCP server, a human with `>>`. The service therefore runs `fs.watch` for the life of the layer scope and tracks the byte offset of everything it has decoded. Its own appends advance that offset directly. On external growth it reads from the offset, decodes the new lines and feeds them into the same `PubSub`, the same `latest` and the same projections, so **a subscriber cannot tell a local append from an external one** — which is exactly acceptance criterion 3.

Three edge behaviors are decided rather than left to discover:

- **A torn tail is tolerated — because the envelope makes it detectable.** A writer caught mid-write leaves a partial line; the walk-back skips it and the offset holds until the line completes, at which point it is decoded normally. **This works at the envelope layer, not the JSON layer**, and the distinction is load-bearing: every strict prefix of a JSON *object* text is invalid JSON, so a torn envelope never parses and is always caught — but a torn *scalar* can parse as a **different valid value** (`42` truncated mid-write reads as `4`), which no walk-back can detect because there is nothing invalid to walk back over. Since an envelope is always an object and a bare scalar is not an envelope, [the envelope contract](#the-envelope-contract) closes that hole outright. This was found by a property test disagreeing with its oracle on generated scalar payloads, and is pinned by a unit test for each half.
- **Truncation or replacement is a contract violation, surfaced not repaired.** If the file shrinks or is replaced, the cooperative contract has been broken; the service raises **`JournalResync`** rather than silently reconciling an inconsistency it cannot reason about. The recovery is uniform: discard cursor-derived state and re-read from zero.
- **No advisory locks.** The cooperative contract other writers must honor is: **one `writeAll` of a complete line, to a handle opened `O_APPEND`, keeping lines small enough that a short write is unlikely to split them** — the discipline and its caveat both, per [the append primitive](#the-append-primitive-and-what-atomicity-actually-means). It is a discipline, not an enforced guarantee; a lock would only be honored by writers who had already agreed to cooperate, and would buy nothing against the shell script with `>>`.

**How the breach is detected** — this upgrades the earlier size-only assumption, which catches only half of it:

- **Replacement is detected by inode identity.** `FileSystem.File.Info` exposes `dev` and `ino` as `Option`s; the pair is captured at watcher activation and compared on each poke. This catches a **same-size-or-larger** replacement, which a size check **structurally cannot** see — the common shape when a tool rewrites a file wholesale.
- **Truncation is `size < consumed`**, against the logical consumed offset.
- **The honest limit**: `ino` is an `Option`. On a platform that does not report it, **equal-or-larger replacement is undetectable** and only truncation is caught. That is documented as a limit rather than implied away — a consumer on such a platform should know the guarantee is weaker there.

Re-arming the watch after a replacement stands (node watchers follow the inode, so the old watch is dead), and the re-arm path is driven **deterministically through the [`FileSystem` test double's `watch`](#the-deterministic-test-seam-is-the-filesystem-double-not-watchbackend)** rather than by racing a real filesystem.

### A missing journal is a legal state

`FileSystem.watch` **stats the path first and fails if it does not exist** (`NodeFileSystem.ts:598-605`). That collides head-on with two other commitments — the layer watches for the life of its scope, and file creation is explicit — so the collision is resolved by decision rather than left to the implementation:

- **Layer construction never fails on a missing journal file.** Building a `Journal` over a path that does not exist yet is legal and produces a working service; a consumer must be able to wire its layer graph before deciding to create the file. **That is "missing", not "unreadable", and the distinction is in the layer's type**: construction **can** fail typed with `PlatformError` on a journal that is **present but unreadable** — an `EACCES` is a real fault about a real file and is **not swallowed** into a working-looking service over a journal nobody can read. The layer is therefore **`Layer<Self, PlatformError, FileSystem.FileSystem>`**. The review found a cast erasing that error channel, which made the layer look infallible while a permissions fault would surface later as something else entirely; the typed channel is the correction of record.
- **The watcher activates once the file exists**, and **the watch is armed *before* the catch-up read** — see [activation ordering](#the-watch-is-armed-before-the-catch-up-read). That the layer survives the gap and starts observing without a restart is decided. The obvious activation mechanism, a parent-directory watch, has been **probe-falsified** in its naive form and comes with hard constraints: see [the directory-watch finding](#a-parent-directory-watch-misreports-events-probe-falsified).
- **`create` and `remove` stay explicit.** Neither is implied by any other operation.
- **`append`, `query` and `latest` against a missing journal fail typed with `JournalNotFound`.** A first append never silently creates the file: a typo in a path would otherwise materialize a second, empty journal and look like a working system with no history.

### The watch is armed before the catch-up read

**Ordering is the whole of it.** The watch is armed **first**, and only then does the catch-up read run. The invariant, stated so it can be checked against any future refactor:

> **No window in which the file can grow while nothing is watching and nothing will re-read.**

The as-found bug was the other order — ingest, then arm — which leaves an unguarded sub-5ms window. A line written into that window is **invisible until some later filesystem event triggers a re-read**. Measured: an append racing the arm sat **undelivered for 1.5s** and arrived only when the *next* append's event happened to fire. In a quiet journal — a dogfood mailbox between rounds is exactly one — the next event may be minutes or hours away, so the real symptom is **unbounded staleness on a subscription that looks healthy**.

Two consequences of arming first, both benign and both deliberate:

- **A redundant ingest is a no-op**, short-circuited by the `logicalSize <= consumed` early return. Arming first means catch-up can now race an event-driven ingest; that race is resolved by doing nothing twice.
- **Concurrent ingests are serialized.** Overlapping ingests could otherwise double-publish, so the serialization is a correctness requirement rather than tidiness.

#### The ordering is achieved by scheduling, and pinned by a test (as-built)

Worth being honest about the mechanism: **the ordering is scheduling, not synchronization.** `fs.watch` exposes **no registration signal** to wait on — probed, and both plausible hooks fail: `Stream.toQueue` does not register eagerly, and `Stream.onStart` fires *before* acquisition. So the implementation **forks the watch consumer and yields** (a tuned `ARM_YIELDS` constant) before running the catch-up read, and the code says plainly that this is a **heuristic, not a proof**.

What makes a heuristic acceptable here is that **the invariant is guarded by a deterministic arming-window test**: a write landing between seed and arming must be delivered **with no second write** to shake it loose. A scheduler change that breaks the ordering therefore **fails CI loudly** rather than silently reopening the window. The heuristic is the mechanism; the test is the contract.

That test earns a place beside [the other discriminating-test lessons](#testing): **its first version passed against the very bug it was written for** — the write was placed before construction, so seeding covered it — and only mutation testing caught that. A test for a race that does not actually straddle the race is the same failure mode as a pollution test downstream of a schema boundary.

**The named upgrade, if the heuristic ever fails:** `FileSystem.WatchBackend.register(path, stat)` registers **synchronously**. The cost is that `WatchBackend` enters the layer's `R`, which is why it is **deferred until evidence demands it** rather than taken pre-emptively — but it is written down so the escalation is a decision rather than a rediscovery.

**Ingest runs under its own one-permit semaphore**, deliberately **separate from the write permit**. Sharing one would block appends behind a slow catch-up read of a large file, which is the wrong trade: catch-up is bulk work, appends are latency-sensitive, and the only thing that genuinely needs serializing is ingest against ingest.

**The polling fallback is rejected on evidence, and the plan's reserved decision point is consumed: no fallback ships.** Across every probe run, the file watch delivered within **~2–4ms** whenever it was armed before the write. The platform did its job; **the ordering was ours**. A poll would have masked a roughly ten-line ordering fix behind a timer, would have violated the no-timer posture permanently, and — the decisive part — **would not even close the window**, since only arming first does that. If some future platform is found to drop events *after* being armed, the `WatchBackend` seam is where that gets answered, not a timer.

### If the watcher flakes, suspect the filename drop first

Recorded now so a future debugging session starts from evidence rather than folklore. The node watch backend has three behaviors worth knowing:

- It **silently drops events whose filename is `null`** (`NodeFileSystem.ts:557-563`, `if (!path) return`) — a case the platform genuinely produces under load and on some filesystems.
- It maps only the `"change"` event to an `Update`.
- It **re-stats on `"rename"`** to decide what happened.

So if watcher behavior flakes in tests or in the field, **the dropped-`null`-filename event is hypothesis #1** — not "`fs.watch` is unreliable", which is the conclusion that leads straight to an unjustified polling timer. Confirm or eliminate that drop before any fallback is proposed.

**Both hypotheses were ruled out for the flagship failure.** The null-filename drop and the Create-as-Remove misreport are **directory-watch** properties; the flagship exercises the **file** watch, which proved reliable once armed. The cause was [activation ordering](#the-watch-is-armed-before-the-catch-up-read), not the platform. Both findings stand as real for the **activation edge** — they were simply not this, and reaching for them first would have sent the investigation to the wrong layer.

### The deterministic test seam is the FileSystem double, not WatchBackend

Correcting an attribution this document carried in several places. **The built package never uses core's `FileSystem.WatchBackend` service.** The engine calls `watch` through the **`FileSystem` service** directly, so the seam that makes watcher behavior deterministic in tests is **the `FileSystem` test double's `watch` method** — the memfs helper and its `beforeWatch` hook — not a substituted backend.

That is what covers the offset bookkeeping, the re-arm path and the resync path without racing a real filesystem or sleeping.

`FileSystem.WatchBackend` (`FileSystem.ts:1406`) remains a **real** core service and remains this design's **named upgrade** in [decision 23](#decisions-record), for its *synchronous registration* at the cost of `WatchBackend` entering the layer's `R`. It is **considered-and-deferred, not used** — and the distinction is worth keeping straight, because a reader who believes the package already depends on `WatchBackend` will misjudge both the layer's requirements and what the deferred upgrade would actually cost.

### A parent-directory watch misreports events (probe-falsified)

The mechanism [decision 10](#a-missing-journal-is-a-legal-state) most obviously suggests for activation — watch the parent directory until the journal appears — **was assumed, then falsified by a probe** against the installed `@effect/platform-node` on macOS. What the probe actually observed on a directory watch:

- A **file creation arrives as `Remove`**.
- An **append also arrives as `Remove`**.
- `path` on the event is a **bare relative basename**, which resolves against the process CWD rather than the watched directory.

The cause is upstream, at `NodeFileSystem.ts:557-570`: the callback's relative `filename` **shadows** the watched path, so the subsequent `stat` runs against CWD, misses, and the `onFailure` branch labels everything `Remove`. A **direct watch on an existing file is clean** — one `Update` per append — so steady state is sound and only the activation edge is affected. This is the same code region as the [null-filename drop](#if-the-watcher-flakes-suspect-the-filename-drop-first) above; the two findings are neighbors, not duplicates.

Activation therefore remains the watcher work's to implement, but under four **as-built constraints**:

1. **The activation watch never branches on `WatchEvent._tag`.** Any directory event whose path *basename* matches the journal filename is an **untyped poke** meaning "go re-stat the journal yourself". The tags are not trustworthy here, and treating them as trustworthy is what the probe falsified. Note this needs **no timer** — the no-polling posture survives the finding intact.
2. **`event.path` is never used to open or read anything**, on any watch. It can be a bare basename that resolves somewhere else entirely; the journal always uses its own configured path. **The trap this avoids has a signature**: reading `event.path` would fail against a nonexistent CWD-relative file and surface as a *phantom* `JournalNotFound` for a journal that exists and is fine.
3. **After a truncation/replacement resync, the file watch must be re-armed.** Node file watchers follow the **inode**, so a replaced file leaves the old watch attached to a file nobody is writing to any more — silently dead. Raising the typed resync error is necessary and **not sufficient**; the watch itself has to be re-established on the new file.
4. **The directory watch is activation-only and must *end* once the file exists**, handing observation off to the file watch. It is a bootstrap mechanism, not an observer: a **non-recursive directory watch does not reliably report a child file's content appends**, so a journal left under directory observation would go quiet between events and a subscriber would look healthy while going stale — **exactly the failure [decision 23](#decisions-record) exists to prevent**, reintroduced one layer up. The handoff is therefore part of the constraint, not an optimization of it: arm the file watch, then stop the directory watch.

**The activation-watch target is configurable** — see [below](#the-activation-watch-target-is-configurable).

The underlying behavior is a **genuine upstream defect** in `@effect/platform-node-shared` — directory watches misreport creation as `Remove` and hand back paths that cannot be resolved — and is recorded here as a **candidate upstream issue**. Filing is not authorized yet; this paragraph is the record so the finding is not lost if the workaround outlives the memory of why it exists.

#### The activation-watch target is configurable

The activation watch has to name a **directory**, and the layer takes a **file path** — so the config surface gained one field:

- **`JournalConfig.directory`, optional**, the directory watched while the journal does not exist yet. Once the journal exists the watch moves to the file and the value is never consulted again, per [constraint 4](#a-parent-directory-watch-misreports-events-probe-falsified).
- **Omitted, it is derived from `path`** by separator-agnostic string arithmetic — everything before the last `/` **or** `\`, with the root and no-separator cases handled explicitly. Both separators are checked because a Windows path contains no `/` at all, and matching only on `/` there makes the whole path its own basename and silently points the activation watch at the process CWD: a journal created after its layer was built would then never be observed.
- **This is the one sanctioned piece of path arithmetic in the package**, and its licence is narrow: **comparison and a single watch target only** — the same rule that governs matching a watch event's basename against the journal filename. Paths are otherwise opaque strings handed straight to `FileSystem`, which is why [`Path` is not in `R`](#kit-positioning).
- **Naming it explicitly is the escape hatch** for a path convention the derivation does not fit — a drive-relative Windows path, or any path whose parent is not a plain prefix of it. The field exists so that case is a configuration, not a defect.

The full config surface is therefore `{ path, directory?, capacity?, shutdownPublishTimeout? }`, with [the shutdown bound](#the-shutdown-bound-is-configurable) and the [bounded hub capacity](#consumption-model) the other two optionals.

## Decisions record

| # | Question | Decision |
| --- | --- | --- |
| 1 | Process model | Cooperative writers plus always-watch. Rejected: single-writer-only (the precedent breaks it), multi-writer locking (unjustified cost, unenforceable against non-participants). |
| 2 | Read model | A `latest` ref in the core with folds as opt-in projections, so snapshot-log and event-log semantics come out of one mechanism instead of two packages' worth of API. |
| 3 | Layering | Pure core plus **one** envelope service. Generic any-line JSONL stays internal; the envelope is the contract. |
| 4 | Scale | Streaming-first, no index. Cursors are the escape hatch. **As-built qualification**: "streaming-first" is a statement about the *surfaces*, not about memory on every path — the historical read is **cursor-bounded, not window-bounded**, so a cursor-less `query` materializes its region. See [decision 17](#decisions-record). |
| 5 | V1 scope | Includes corrupt-tail tolerance, inherit-and-patch append, and terminal events with quiescence. **Rotation and compaction are explicitly deferred** — append-only history is the point of the format, and a package that rotates has quietly become a log shipper. |
| 6 | Dogfood MCP server | A grounding example and acceptance target only. Not a deliverable of this workstream. |
| 7 | Should slice surfaces return `Queue` by default? | **No — `Stream` is the one canonical surface**, with `Stream.toQueue` one line away and the strategy chosen by the consumer. A default Queue forces one buffering policy, turns quiescence into a `Cause.Done` sentinel instead of stream end, and loses typed narrowing. Paired pin: the internal PubSub is bounded with backpressure, so the journal never drops for a slow subscriber. See [consumption model](#consumption-model). |
| 8 | How is the service typed by the registry, given that `Context.Service` binds its shape at declaration? | **A per-registry service-class factory plus a layer-returning function**, in the ratified [`ConfigFile.Service`](config-file.md#service-api-and-per-schema-identity) shape. Probe-confirmed form: `Journal.Service<Self>()(id, { events })` — the registry rides on the class-definition site and is inferred, so `Self` is the only explicit type parameter — with `Class.layer({ path })` returning the layer, at a cost of two erased-engine casts internally. This is the **sanctioned exception** to "avoid layer-producing functions", on config-file's grounds; it carries config-file's const-binding hazard, which gets a TSDoc warning, a test, and a stated consumer-side obligation to bind the layer once. Rejected: a generic `Context.Service` (impossible — a Key cannot be parameterized at retrieval); core `eventlog`'s non-generic-service-plus-generic-client split is the recorded **escape hatch**, not a live alternative (the registry has to type the service's own operations, not a wrapper's). See [the service factory](#the-service-is-a-factory-not-a-generic-key). |
| 9 | What carries quiescence and tear-free shutdown to subscribers? | **A `PubSub.bounded<Take.Take<Envelope, JsonlError>>` with end-of-stream published as an `Exit` and subscriber streams built via `Stream.fromPubSubTake`.** Rejected: a plain `Stream.fromPubSub` (no termination signal at all) and `PubSub.shutdown` as the done signal (it *interrupts* subscribers — a tear). Derived requirement: **subscribing to an already-quiescent journal terminates rather than hangs**. **Mechanism resolved in P4 — per-subscriber termination**: `changes` ends its own stream via `takeUntil` on the **unfiltered** stream (so a slice excluding the terminal event still ends), plus a quiescent check at subscribe. Rejected: **replaying the terminal Exit** — it duplicates envelopes for live subscribers, and a hub-wide Exit would permanently end already-attached subscribers, making `reopen` unrepresentable for them. The finalizer's Exit still owns shutdown; a subscriber whose slice matches the terminal event **receives it, then ends**. See [quiescence is a published Take](#quiescence-is-a-published-take-not-a-hub-shutdown). |
| 10 | What happens when the journal file does not exist? | **A missing journal is a legal state.** Layer construction never fails on it and the watcher activates once the file appears; `create`/`remove` stay explicit; `append`, `query` and `latest` fail typed with `JournalNotFound`; **a first append never silently creates the file**. Forced by `FileSystem.watch` stat-ing first and failing on a missing path, which the always-watch scoped layer would otherwise trip over. **"Missing" is not "unreadable"**: construction **can** fail typed with **`PlatformError`** on a present-but-unreadable journal — an `EACCES` is not swallowed — so the layer is **`Layer<Self, PlatformError, FileSystem.FileSystem>`**; the review found a cast erasing that channel, and the typed channel is the correction of record. **The activation mechanism stays open, but a naive parent-directory watch is probe-falsified** and **four** [as-built constraints](#a-parent-directory-watch-misreports-events-probe-falsified) bind whatever is built: no branching on `WatchEvent._tag`; never read `event.path`; re-arm the watch after a resync; and **the directory watch is activation-only and must end once the file exists**, handing off to the file watch — a non-recursive directory watch does not reliably report a child's content appends, so keeping it as the observer reintroduces exactly the staleness [decision 23](#decisions-record) prevents. Its target is **`JournalConfig.directory`**, optional, defaulting to `path`'s parent by [separator-agnostic arithmetic](#the-activation-watch-target-is-configurable) — the one sanctioned piece of path arithmetic in the package, comparison-and-single-watch-target only, handling both `/` and `\`. See [a missing journal is a legal state](#a-missing-journal-is-a-legal-state). |
| 11 | How does shutdown refuse late appends? | **An explicit closed flag checked before the append semaphore, failing typed with `JournalClosed`** (its own tag — a lifecycle condition, distinct from `TerminalViolation`'s journal-state one) — *not* a `Latch`, which cannot refuse: `Latch.await` suspends with no failure channel, so a closed latch would hang a late append instead of rejecting it. The latch (or equivalent) serves the **drain** half: await in-flight flush, then publish the terminal Exit that completes subscriber streams. See [journal operations](#journal-operations). |
| 12 | Is `writeAll` a single atomic write? | **No, and the design no longer claims it is.** `writeAll` recurses on partial writes and `File.write` may short-write, so no v4 API guarantees one syscall per line. The primitive stays `writeAll` on an `{ flag: "a" }` handle; atomicity is an **OS property of `O_APPEND` at reasonable line sizes** (no fixed threshold — the residual risk is a short `write(2)`), stated with its line-size caveat as part of the cooperative-writer contract. `writeAll` returns **no byte count** (`Effect<void, PlatformError>`), so there is no partial-success state to check; **any `PlatformError` from an append surfaces typed and is treated as a possibly-torn tail**, never swallowed. See [the append primitive](#the-append-primitive-and-what-atomicity-actually-means). |
| 13 | May a registered `data` schema require services to decode? | **No — payload schemas are bounded to `Schema.Codec<unknown, unknown, never, never>`.** Stated as a contract, because it is what makes the pure sync core possible: `Schema.decodeUnknownResult` / `encodeUnknownResult` demand `never` in both service slots, so a service-requiring payload would break acceptance criterion 2 at the *consumer's* call site instead of at registration. Rejected: bounding via `Schema.Top`, whose service parameters are `unknown` and therefore do not satisfy the sync codecs — the constraint would silently fail to bind; and `<any, any, …>` for the first two parameters, since they are covariant and `unknown` accepts every concrete payload schema while staying precise and needing no `noExplicitAny` suppression. See [a payload schema may not require services](#a-payload-schema-may-not-require-services). |
| 14 | What does "derived discriminated union" mean at runtime? | **The derivation is at the *type* level; the runtime read path is a two-stage decode.** An envelope **frame** (`{ at, event, scope?, data: Schema.Unknown }`) decodes first and is what `Slice` filtering reads; the registry-looked-up `data` schema applies **on demand, to selected lines only**. Rejected: a `Schema.Union` **value** over the full envelopes as the read path — discriminating through it decodes `data` eagerly for every line, which inverts the headline filter-before-decode guarantee while the types still look correct. A union value may still be offered where eager decoding is right, notably `encodeResult`. See [the derived union is a type](#the-derived-union-is-a-type-the-read-path-is-a-frame). |
| 15 | What does "the last valid line" mean? | **The last valid *envelope*, never merely the last valid JSON** — binding on the service from `Envelope` onward. Torn-tail detectability is an **envelope-layer** property: every strict prefix of a JSON object text is invalid, so a half-written envelope always fails to parse, while a torn *scalar* can parse as a different valid value (`42` → `4`) with nothing to walk back over. This is a second, independent reason the envelope is mandatory rather than a convention. Found by a property test disagreeing with its oracle on generated scalar payloads; pinned by a unit test for each half. See [the torn-tail rule](#process-model-cooperative-writers-always-watching). |
| 16 | What happens to a journal written with a BOM? | **The service's read boundary strips a single leading BOM, explicitly and at the byte level; the pure core never strips.** Without it the first line is permanently `MalformedLine` for every reader. Not obtained via `readFileString`'s silent strip (the [`@effected/templates`](templates.md) finding) — journal reads are offset-based, so an implicit strip anywhere in the read path desynchronizes every offset the package hands out. **Offset convention: after the strip, offsets are relative to the post-BOM start**, so the first line begins at 0 — **logical post-BOM on every path**, including the append cursor seeded at construction, with `bomBytes` read **once from the file start** and never inferred from a tail window's position. Exactly one leading BOM; a `U+FEFF` elsewhere is content. See [the BOM boundary](#a-leading-bom-is-stripped-at-the-service-boundary-not-in-the-core). |
| 17 | How is "the last line" read cheaply, given `lastValid` takes whole text? | **A bounded tail read is the sanctioned recipe, and the service is bound to it** — `stat`, read the last N bytes, decode from a newline boundary (discarding the first partial line unless the window starts at offset 0), walk back, and **widen the window and retry** if no valid envelope is in it. `latest` and every `lastValid`-backed service read use it. **Acceptance criterion 2 is qualified**: "no runtime" is unconditional, "cheap" holds only through this recipe, and the README may not demonstrate the read path without it. **As-built scope correction, stated without softening**: the recipe binds `latest` and the `lastValid`-backed reads **only**. The **historical read** — `readFrom`, behind `query` and the replay half of `changes` — reads its requested region in **one allocation bounded by the file size** and **buffers matches before emitting**; it is bounded by the **cursor**, not by a window, so a cursor-less `query` over a large journal does hold that region in memory. **"No operation ever holds the file in memory" is therefore false as built** and is retracted here rather than qualified away. A **paged `readFrom`** (per-window emission with an unterminated-tail carry) is **tracked follow-up work and does not ship**. See [the bounded tail read](#the-bounded-tail-read-is-the-sanctioned-cheap-read) and [what it does not cover](#what-the-recipe-does-not-cover-the-historical-read-is-cursor-bounded-not-window-bounded). |
| 18 | Does a depth guard ship? | **No, and the frame is why.** `data: Schema.Unknown` passes the payload through untraversed, so the frame decode is **O(1) in payload depth** (pinned by a 200k-deep test), and V8's `JSON.parse` is iterative so parse depth is not a hazard on the reference engine either. Two qualifications: a consumer's **recursive** payload schema (`Schema.suspend`) makes payload-decode depth input-driven — that is the consumer's risk and is deliberately not second-guessed; and the residual hazard of deep payloads is failure **rendering**, not decoding — a traversing `data` schema overflowed the stack inside effect's **issue formatter**, not the decoder. See [no depth guard ships](#no-depth-guard-ships-and-the-frame-is-why). |
| 19 | What happens when a schema-valid payload is not JSON-serializable? | **A guarded `JSON.stringify` failing typed with a sixth error tag, `UnserializableData`**, carrying the event tag and the thrown cause structurally. Reachable through a legal `data: Schema.Unknown` registration holding a `BigInt` or a circular structure. Rejected: **bounding the payload schema's *encoded* parameter to a JSON-value type** — it would catch this at registration, which is the principled spot, but is impractical on two counts: TypeScript's index-signature assignability rejects interface-typed encoded forms, which is *every* `Schema.Class` payload schema, and it would ban legitimate `Schema.Unknown` payloads outright. Runtime guard chosen over registration-time rejection. |
| 20 | Where does the hub publish happen relative to the append lock? | **Outside the write critical section**, which covers the file write and ref updates only. Publish order equals write order via a **publish-ordering stage acquired under the write permit and executed outside it**. The **backpressure pin is unchanged** — an append completes only once the hub accepts its envelope — and the terminal-Exit drain at shutdown is **bounded**: a subscriber that keeps consuming sees stream end, one that never consumes again cannot observe completion and does not hold scope close hostage. As-built the ordering stage is a **chained-deferred baton** (link a fresh `Deferred` under the write permit — non-suspending, O(1) — then release, await predecessor, publish, pass the baton via `ensuring`), and pin 4's real property is **"every append that completed is delivered before the terminal Exit"**, achieved by capturing the publish-chain tail under the write permit and awaiting it in the same bounded region before `Exit.void`. Rejected: **publish inside the permit**, which deadlocks by construction (a suspending publish plus one stalled subscriber wedges every writer, then wedges scope close, since the finalizer waits on the permit the publish holds); an **unbounded staging queue**, which decouples cleanly but **silently breaks the backpressure pin**, turning a slow subscriber from a visible stall into an invisible memory leak; and a **second semaphore taken under the write permit**, which suspends inside the critical section when contended — the same deadlock through a smaller door. The bound is `JournalConfig.shutdownPublishTimeout` (default 5s, `Clock`-based). **As-built addition, recorded so it is not later mistaken for a pin-1 violation**: the append path **does perform a bounded read inside the write permit**, to reconcile a cooperating writer's un-ingested bytes — legal because pin 1 prohibits **suspending on a subscriber**, not reading — and **publishes that external batch before its own envelope on one baton slot**, so hub order equals file order. **Residual, named honestly**: an external write landing **between our `writeAll` and our `fstat`** is a **TOCTOU** with **three probe-demonstrated consequences** — our own line's reported offset is wrong by the external write's length, **the interleaved external line is silently dropped** (`consumed = end` skips it), and **our own line is published twice** (the gap decode re-covers it). The window is tiny (two syscalls, both under the write permit), but the consequence is not an ordering skew and is not softened to one. **No lock-free scheme *prevents* it** — `O_APPEND` never tells a writer where its bytes landed, so only the advisory lock the process model rejects would — while **detection by read-back** (comparing the bytes at `[offset, end)` against what was written) **is** possible lock-free and is **declined at one extra read per append**. See [the publish stage](#the-publish-stage-sits-outside-the-write-critical-section) and [the append path's read](#the-append-path-reads-inside-the-write-permit-and-publishes-external-bytes-first-as-built). |
| 21 | What are `Slice`'s range and cursor boundaries? | **Half-open on both axes.** `from` **inclusive**, `to` **exclusive**, so adjacent windows tile without double-delivery — `at` collisions are common at millisecond resolution and routine under `TestClock`, where a closed upper bound would double-deliver in exactly the tests meant to prove correctness. `cursor` compares **at-or-after against `line.offset`**, so persisting the last processed envelope's **`line.end`** resumes precisely the unprocessed remainder. Both chosen so the obvious consumer code — record where you stopped, resume there — is also the correct code. See [Slice boundary conventions](#slice-boundary-conventions). |
| 22 | What names the truncation/replacement breach, and how is it detected? | **`JournalResync`**, the taxonomy's eighth tag: `path`, `reason` (`"truncated" \| "replaced"`), `expected` (logical offset consumed to), `actual` (logical size now). **One tag for two causes** — they share one recovery (discard cursor-derived state, re-read from zero, surface the contract breach to a human), so `reason` is diagnostics rather than a branching invitation. Rejected reuses: `JournalNotFound` (would tell the consumer to *create* a journal, destroying the breach evidence), the decode tags (the bytes are well-formed; the reader's **position** is what became meaningless), `TerminalViolation`/`JournalClosed` (lifecycle facts about *our* journal — here the **file** moved under a healthy one). **Detection**: replacement by **inode identity** — `(dev, ino)` from `File.Info`, captured at activation and compared per poke, which catches same-size-or-larger replacement that a size check structurally misses; truncation by `size < consumed`. **Honest limit**: `ino` is an `Option`, so where it is unreported only truncation is caught. Tested deterministically through the **`FileSystem` double's `watch`**, not `WatchBackend`. See [the process model](#process-model-cooperative-writers-always-watching). |
| 23 | Does the watcher arm before or after the catch-up read, and does a polling fallback ship? | **Arm first, then catch up** — invariant: *no window in which the file can grow while nothing is watching and nothing will re-read*. Ingest-then-arm leaves an unguarded sub-5ms window; a line written into it stayed **undelivered 1.5s** and surfaced only on the next append's event, which in a quiet journal is unbounded staleness on a healthy-looking subscription. Redundant ingest is a no-op (`logicalSize <= consumed`), and concurrent ingests are serialized so overlapping ingests cannot double-publish. **No polling fallback ships — rejected on evidence**: the file watch delivered in ~2–4ms every run when armed before the write, so the platform was fine and the ordering was ours; a poll would mask a ~10-line fix behind a timer, break the no-timer posture permanently, and still not close the window. The plan's reserved decision point is consumed. **As-built the ordering is scheduling, not synchronization** — `fs.watch` offers no registration signal (`Stream.toQueue` does not register eagerly; `Stream.onStart` fires before acquisition), so the watch consumer is forked and a tuned `ARM_YIELDS` yields before catch-up: a **heuristic pinned by a deterministic arming-window test**, so a scheduler change fails CI rather than silently reopening the window. Named upgrade if it ever fails: `WatchBackend.register(path, stat)`, which registers synchronously at the cost of `WatchBackend` entering the layer's `R` — deferred until evidence demands it. Ingest holds **its own one-permit semaphore**, separate from the write permit, so appends are not blocked behind a slow catch-up of a large file. See [activation ordering](#the-watch-is-armed-before-the-catch-up-read). |

## Observability

Per the [observability standard](../effect-standards.md#observability-standards): named `Effect.fn` spans on the public fallible boundaries only — `append`, query open, and watcher resync — and nothing else. A span per decoded line would cost more than the decode. The library stays telemetry-agnostic; applications compose `@effect/opentelemetry` at the edge.

## Testing

`@effect/vitest`, `assert.*` and never `expect`, with tests in `__test__/` and integration tests under `__test__/integration/` per the [testing standard](../effect-standards.md#testing-standards).

- **Property tests** over line splitting and corrupt tails (`it.effect.prop`) — the generators must emit torn final lines, embedded newlines inside string payloads, and lines that are valid JSON but not valid envelopes, because those are the three shapes a real journal produces.
- **`TestClock`** drives `at` stamping, so timestamp assertions are exact rather than approximate.
- **The arming-window test's first version passed against the very bug it was written for.** The write was placed *before* construction, where seeding covered it, so the test never straddled the race; **mutation testing** caught it. Same failure mode as a pollution test downstream of a schema boundary — and the reason the [arming heuristic](#the-ordering-is-achieved-by-scheduling-and-pinned-by-a-test-as-built) is acceptable is that its guarding test now genuinely straddles the window.
- **Two concurrency tests are structurally incapable of testing what they appear to test** — both are the same lesson, recorded because each one *looked* correct and passed:
  - **A hub with no subscribers accepts every publish immediately.** A stall or deadlock test therefore proves nothing unless it holds a **real subscription that is at capacity**; without one there is no backpressure to observe and the test is green by construction.
  - **The completed-appends-precede-the-Exit test needs *three* appends.** With two, `PubSub`'s FIFO ordering of blocked publishers drains the pending publish and the direct Exit in the right order **by accident**, and the mutant survives. A third makes the Exit register *between* baton-chained publishers, which is the only arrangement that can observe the violation.
- **A prototype-pollution test must sit *directly* on the merge primitive, never downstream of a schema boundary.** Placed downstream — after the merged value has been encoded and re-decoded — the test proves nothing: the hijacked object is transient, so the observable output is always clean **while the hazard is real**. The invariant is asserted on the merge itself, with a **prototype-integrity assertion** and a **throwing-setter fixture**. This was proven by a mutant that survived the downstream test and died against the direct one, and the lesson generalizes past this package: a security invariant tested through a normalizing boundary is testing the boundary, not the invariant.
- **Two type-level guarantees are tested as types, not behavior**: a payload schema that requires services is a *compile* error at registration ([the no-services bound](#a-payload-schema-may-not-require-services)), and a slice's `events: [...]` narrows the element type. Both are contracts that a runtime-only test would pass while the property was broken.
- **Integration tests** run the watcher against real temporary directories via `makeTempDirectoryScoped`, and are the only tests that provide a platform layer — the boundary discipline made visible. Watcher behavior that does *not* need a real filesystem — offset bookkeeping, the resync path, activation once a file appears — is driven through [the `FileSystem` test double's `watch`](#the-deterministic-test-seam-is-the-filesystem-double-not-watchbackend) (the memfs helper's `beforeWatch` hook) instead, so those assertions are deterministic and timer-free.
- **A subscriber attaching to an already-quiescent journal must see the stream end**, not hang. It is the [derived requirement](#quiescence-is-a-published-take-not-a-hub-shutdown) of the `Take`-based hub, and it is the test that catches an implementation that publishes the terminal Exit and forgets late subscribers.
- **The flagship test is two `Journal` layers over one file**, each observing the other's appends. It is criterion 3 written as a test, and it is the one that fails first if the offset bookkeeping or the watcher wiring is wrong.

## Non-goals (v1)

- Rotation, compaction and retention (decision 5).
- Any binary or encrypted encoding — human-readable and `jq`-able is a requirement, not a default.
- A general event-sourcing framework; core's `eventlog` occupies that space.
- Locking, leases or any coordination protocol between writers beyond the documented one-write-per-line discipline.
- Querying by anything other than envelope fields. A payload-content query would force a `data` decode per line and dismantle the filtering guarantee the package is built on.

## Status and sequencing

**Built and unpublished, as of 2026-08-03.** The package was implemented on `feat/package-jsonl` in the planned order — scaffold, the pure core (`Line`, then `Envelope`/`JsonlEvent`/`JsonlError`), the `Journal` service, the read surfaces, the watcher — each phase behind a blocking review gate. [Acceptance criteria 1–3 hold; criterion 4 does not](#results-2026-08-03), and the reasons are recorded there rather than resolved by restating the criterion.

Nothing in the kit depends on this package and it gates no wave. It ships in a **future coordinated wave, never solo**; until then it is `0.0.0` and unreleased.

Two things are deliberately left open, both waiting on a real consumer rather than on effort: the **`latest(slice)` plus per-scope terminal semantics** amendment that criterion 4 identified, and the **synchronous-registration upgrade** (`WatchBackend.register`) named in [decision 23](#decisions-record). Neither is a defect; both are decisions to be made when something needs them.

Every platform finding here is pinned to `effect@4.0.0-beta.101` with node-backend behavior verified against `@effect/platform-node-shared@4.0.0-beta.102`. When the catalog advances, the `FileSystem`, `watch` and `writeAll` findings are the ones to re-check.
