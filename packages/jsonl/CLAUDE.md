# CLAUDE.md — @effected/jsonl

Append-only, schema-validated JSONL journals exposed as a definable Effect
service: a pure synchronous core usable from a hook script with no runtime,
under one `Journal` service whose scoped layer watches the file for external
appends and cross-observes another instance over the same path.

**Design doc:** `@../../.claude/design/effected/packages/jsonl.md` — load
before changing behavior; it is the contract this package implements and the
entry point to two children:

- `@../../.claude/design/effected/packages/jsonl-journal.md` — Load when:
  changing the append primitive, atomicity, the publish stage, shutdown
  refusal/drain, or the cooperative-writer process model.
- `@../../.claude/design/effected/packages/jsonl-reads.md` — Load when: working
  on `Slice`, `query`/`changes`/`projection`, or the read economy.

**Plan:** `@../../.claude/plans/2026-08-03-jsonl-package.md`.

## Tier: boundary

`effect` is the only peer. **Zero runtime dependencies, zero `@effected/*`
edges.** `FileSystem` is required in `R`; `Path` is not — paths are opaque
strings handed straight to `FileSystem`, and this package never joins,
resolves or splits one. `@effect/platform-node` is a devDependency, for the
integration suite only. Core `PlatformError` passes through every write and
read path **untranslated** rather than being wrapped.

## Module map (one concept per module)

- **`Line`** — the pure, synchronous line layer: `split` (byte-exact offsets,
  CRLF-aware, no phantom trailing empty line), `parseResult` (one line's JSON,
  never throws), `parseAll`, `consumedOffset` and `lastValid` (walk back to the
  last line that parses as JSON). Knows JSON, not envelopes — a malformed
  *envelope* and a malformed *line* stay distinguishable failures one layer up.
- **`LineSlice`** — one candidate line's text plus its **UTF-8 byte** offsets
  (`offset`, `end`, `length`, `terminated`). Every cursor this package hands
  out is in this unit, never `String.length`, because these values persist
  across process restarts as `FileSystem.stream`'s `offset` option.
- **`internal/utf8.ts`** — the UTF-8 byte-length primitive `LineSlice`/`Line`
  build on; not exported.
- **`Envelope`** / **`EnvelopeFrame`** — the envelope layer, in two decode
  stages: `EnvelopeFrame` (a `Schema.Struct`, `data` left as `Schema.Unknown`)
  is stage one and is what every filter reads; stage two
  (`completeResult`, internal) runs the registry's payload schema only for
  frames a `Slice` has already selected. `Envelope.decodeResult` /
  `encodeResult` / `lastValidResult` are the sync primitives; `Envelope.decode`
  / `encode` are one-line `Effect.fromResult` lifts of the same code, so the
  two forms cannot drift. **`Envelope.lastValidResult` — not `Line.lastValid`
  — is the binding definition of "the journal's current state"**: a torn
  *scalar* tail (`42` cut mid-write leaves `4`) parses as valid, different
  JSON, and only the envelope contract (every envelope is an object) catches
  it.
- **`JsonlEvent`** — `JsonlEvent.make(tag, { data, terminal?, reopen? })` and
  the `JsonlEvent.Registry`/`Tag`/`Data`/`TerminalTags`/`ReopenTags` type-level
  helpers a registry's array literal carries. `DataSchema` bounds a payload to
  `Schema.Codec<unknown, unknown, never, never>` — no services in either
  direction — so a schema needing a service fails at **registration**, not at
  some later call site, and the pure core's synchronous codecs stay possible.
- **`Slice`** / `CursoredSlice` — the one filter shape every read surface
  takes: `events?`, `scopes?`, `from?` (inclusive), `to?` (exclusive, so
  adjacent windows tile without double-delivery), plus `cursor?` for resuming.
  `matchesFrame` (`@internal`) takes the **frame**, never a decoded envelope —
  that is the type-level enforcement of filter-before-decode.
- **`JsonlError`** — the eight-tag error taxonomy (below).
- **`Journal`** — the one service, generic over a registry:
  `Journal.Service<Self>()(id, { events })` produces a per-registry class whose
  `.layer(config)` builds a scoped
  `Layer<Self, PlatformError, FileSystem.FileSystem>` — a **missing** journal
  constructs cleanly (decision 10), an **unreadable** one fails typed.
  Exposes `append`, `appendPatch`, `latest` (`SubscriptionRef` of
  `Option<Envelope>`), `quiescent`, `query`, `changes`, `projection`, `create`,
  `remove`. **Bind `.layer(...)`'s result to a const and provide that const** —
  calling it twice mints two independent journals (two semaphores, two hubs,
  two `latest` refs) over the same file, unserialized against each other.
  `JournalShape.hub` is **published but unsupported**: an `@internal` tag is
  decorative on an interface member (API Extractor honours release tags on
  top-level declarations only), so it ships in the `.d.ts` deliberately as the
  seam the read surfaces are built on — not as consumer API.
- **`internal/merge.ts`** — `appendPatch`'s **shallow** merge, ported from
  `@effected/config-file`'s `internal/deepMerge.ts` recipe minus the
  recursion. Same prototype-pollution discipline: `Object.defineProperty`
  only, never assignment or `Object.assign`, `__proto__`/`constructor`/
  `prototype` filtered from both sides. `canMerge` is **asymmetric** (unlike
  config-file's symmetric version): the patch is a caller-supplied partial
  literal even when the base is a decoded `Schema.Class` instance, so a
  same-prototype requirement would reject the case that matters most.
- **`internal/tail.ts`** — bounded-window file reads (`readTail`,
  `readTailUntil`, `readRangeText`, `probeBomBytes`): the mechanism that keeps
  **`latest` and the `lastValid`-backed reads** costing the size of the answer,
  not the age of the journal. Never exported. **`query` and the replay half of
  `changes` are NOT window-bounded as built** — `Journal`'s `readFrom` reads its
  whole requested region (`cursor` to end of file) in one allocation and buffers
  the matches, so an unsliced `query()` over a large journal does hold it in
  memory. That is stated in the TSDoc rather than implied away; paging it is
  spencerbeggs/effected#233, not a claim the package currently makes.

## The envelope contract

Every line: `{"at":"...","event":"...","scope"?:"...","data":...}`. `at` is
**service-assigned** from the Effect `Clock` at append time — never
caller-supplied — so `TestClock` controls it exactly and two writers never
disagree about ordering. `scope` is a partition key with no further semantics.
`data` is required on the wire; a `Schema.Void` payload still emits
`"data":null` (`JSON.stringify` drops `undefined`-valued keys, and JSON has no
`undefined` — `null` is its spelling of absence), so the frame always decodes
a `data` key.

## The cooperative-writer contract

One `writeAll` of a complete, `\n`-terminated line per append, to a handle
opened `{ flag: "a" }` (`O_APPEND`). That single-write discipline **is** the
contract other writers must honor; there is no advisory lock. A torn tail (a
writer caught mid-write) is tolerated: the unterminated fragment is walked
over and the offset holds until the line completes. Truncation or replacement
underneath a reader is **not** repaired — it fails typed as `JournalResync`
(`reason: "truncated" | "replaced"`), because silently resyncing from zero
would paper over a real operational fault. **"Last valid line" always means
the last valid *envelope*, never merely the last valid JSON** — see
`Envelope.lastValidResult` above.

## The error taxonomy (eight tags)

`MalformedLine`, `UnknownEvent`, `InvalidData`, `UnserializableData`,
`TerminalViolation`, `JournalClosed`, `JournalNotFound`, `JournalResync`. Every
tag names a distinct recovery; causes (a `SchemaError`, a `JSON.stringify`
throw) are carried **structurally**, never stringified — `error.issue` and
`error.cause` keep their shape. `PlatformError` is deliberately **not** a
member: IO failures pass through untranslated. `JournalClosed` (scope closing,
a lifecycle fact) and `TerminalViolation` (a terminal tag reached, a
reversible state) are separate tags because their recoveries share nothing.
`JournalResync` is one tag with a `reason` field, not two tags, because
truncation and replacement share the same recovery.

## Testing

`@effect/vitest`, `assert.*` — **never** `expect`. Tests live in `__test__/`
(never co-located in `src/`); integration tests live under
`__test__/integration/` and are the only suite that provides a real platform
layer (`@effect/platform-node`, temp dirs via `makeTempDirectoryScoped`). The
flagship integration test is two `Journal` layers over one file
cross-observing each other's appends through the watcher.

```bash
pnpm vitest run packages/jsonl        # from the repo root
pnpm build --filter @effected/jsonl   # from the repo root
```

Four operational facts that cost real debugging time and are recorded here so
the next session does not rediscover them:

- **Run from the repo root, or through the vitest-agent MCP `run_tests`
  tool** — never `vitest` from inside `packages/jsonl`. Running from inside
  the package fails to load the root `vitest.setup.ts` and silently reports
  `0/0 passed` with exit code `0`: a green-looking failure.
- **Exit codes lie; only the `Tests:` summary line (or the MCP's structured
  `run_tests` result) is evidence.** A subset run fails the suite's *global*
  coverage thresholds by design (thresholds are computed over the file set
  actually exercised), which is not a regression to chase down; and a test
  that hangs past its timeout can crash the reporter process itself rather
  than reporting a clean failure — and never a grep for `✗`/`FAIL` in console
  output: the format varies by reporter, so a killed mutant reads as a
  survivor.
- **A stale `issues.json` looks identical to a fresh one on `warnings`/
  `errors`.** The tell is the `suppressed` count: this package's prod build
  suppresses exactly 10 `ae-forgotten-export` entries (one `_base` symbol per
  `Schema.Class`/`Schema.TaggedError` factory). A lower count on a build
  you did not just run cold is a stale artifact, not a clean one — force a
  rebuild (`rm -rf dist .turbo && pnpm build --filter @effected/jsonl --force`)
  before trusting it.
- **A consumer under `TestClock` must advance the clock for the shutdown
  drain to fire.** Scope close's finalizer bounds its wait on the publish
  chain with `Effect.timeout` (`shutdownPublishTimeout`, default five
  seconds); under a virtual clock that timeout never elapses on its own; a
  test exercising graceful shutdown must `TestClock.adjust` past the bound or
  the finalizer hangs for the real wall-clock duration instead.

## Build

`savvy.build.ts` carries the narrow `{ messageId: "ae-forgotten-export",
pattern: "_base" }` suppression for the synthesized `Schema.Class` /
`Schema.TaggedError` heritage types. **Never widen it** — an internal type
named on a public signature is a different symbol and stays un-masked.

Gate on `pnpm build --filter @effected/jsonl`, never the raw
`node savvy.build.ts` script, and read `dist/prod/issues.json` rather than
console output.
