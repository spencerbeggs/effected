# CLAUDE.md — @effected/jsonl

Append-only, schema-validated JSONL journals exposed as a definable Effect
service: a pure synchronous core usable from a hook script with no runtime,
under one `Journal` service whose scoped layer watches the file for external
appends and cross-observes another instance over the same path.

**Design doc:** `@./okf/modules/jsonl.md` — load
before changing behavior; it is the contract this package implements and the
entry point to two children:

- `@./okf/interfaces/jsonl-journal.md` — Load when:
  changing the append primitive, atomicity, the publish stage, shutdown
  refusal/drain, or the cooperative-writer process model.
- `@./okf/interfaces/jsonl-slice.md` — Load when: working
  on `Slice`, `query`/`changes`/`projection`, or the read economy.

## Tier: boundary

`effect` is the only peer. **Zero runtime dependencies, zero `@effected/*`
edges.** `FileSystem` is required in `R`; `Path` is not — paths are opaque
strings handed straight to `FileSystem`, and this package never joins,
resolves or splits one. `@effect/platform-node` is a devDependency, for the
integration suite only. Core `PlatformError` passes through every write and
read path **untranslated** rather than being wrapped.

## Module map (one concept per module)

- **`Line`** — the pure, synchronous line layer: `byteLength`, `split(text,
  base = 0)` (byte-exact offsets shifted by `base`, CRLF-aware, no phantom
  trailing empty line), `parseResult` (one line's JSON, never throws). Knows
  JSON, not envelopes. `isBlank` is an internal export.
- **`LineSlice`** — a `Schema.Struct` of one candidate line's text plus its
  **UTF-8 byte** offsets (`offset`, `end`, `length`, `terminated`). Plain
  records, not class instances: `split` makes one per line of every read, and a
  `Schema.Class` instance costs ~40x a plain object. `LinePosition` (`offset`,
  `end`) is all an **envelope** keeps of its line; errors keep the full slice
  because there the text is the evidence.
- **`internal/utf8.ts`** — the UTF-8 byte-length primitive; not exported.
- **`Envelope`** — the envelope layer, in two decode stages: the frame
  (`at`/`event`/`scope`, `data` left raw; internal `frameResult`) and the
  registered payload schema (internal `completeResult`), which runs only for
  frames a slice has selected. Public: `decodeResult`, `decodeAllResult(events,
  text, base)`, `lastValid(events, text, base)`, `encodeResult` — all
  synchronous, `Result`/`Option`-based; lift with `Effect.fromResult`.
  **`Envelope.lastValid` is the binding definition of "the journal's current
  state"**: a torn *scalar* tail (`42` cut mid-write leaves `4`) parses as
  valid, different JSON, and only the envelope contract catches it.
- **`JsonlEvent`** — `JsonlEvent.make(tag, { data, terminal?, reopen? })` plus
  the `Registry`/`Tag`/`Data` type helpers. `DataSchema` bounds a payload to
  `Schema.Codec<unknown, unknown, never, never>`, so a schema needing a service
  fails at **registration**.
- **`Slice`** — the one filter shape every read takes: `events?`, `scopes?`,
  `from?` (inclusive), `to?` (exclusive), `cursor?`, and `onInvalid?: "skip" |
  "fail"` (default skip) for undecodable lines, honoured by `query` and
  `changes` alike. `matchesFrame` (internal) takes the structural frame fields,
  so an envelope or a raw frame both match without being rebuilt.
- **`JsonlError`** — the eight-tag error taxonomy (below) plus `DecodeError`.
- **`Journal`** — a static class: `Journal.Service<Self>()(id, { events,
  config })`, where `config` is a `JournalConfig` or an `Effect` producing one.
  The class carries a static **`layer` value** (one journal however often it is
  provided) and `make(config)` for runtime-only paths. Per-operation error types
  `AppendError` / `QueryError` / `ChangesError` live in `internal/engine.ts` and
  are re-exported. `latest` is a read-only `Effect`; `latestChanges` streams it.
- **`internal/engine.ts`** — the registry-erased engine (`makeEngine(id,
  events, config)` → `{ journal, hub }`): write path, publish baton, hub,
  watcher, shutdown. Typed once at the service boundary with one cast. The hub
  is exposed to tests only. Decoded lines travel as `Item = Result<Envelope,
  Rejected>`, so a live subscriber with `onInvalid: "fail"` sees bad lines too.
  Resync **re-seeds** (BOM, identity, resume at the end of the last complete
  line, then `latest` from the new tail — in that order, so a line landing
  between the two reads is still ingested) — the same `seed` construction
  uses. Outside a resync `consumed` never decreases.
- **`internal/merge.ts`** — `appendPatch`'s **shallow** merge, ported from
  `@effected/config-file`'s recipe minus the recursion. Same prototype-pollution
  discipline: `Object.defineProperty` only, `__proto__`/`constructor`/
  `prototype` filtered from both sides. `canMerge` is **asymmetric**: the patch
  is a partial literal even when the base is a decoded `Schema.Class` instance.
- **`internal/tail.ts`** — the bounded reads. Backward: `readTailUntil` steps
  from the end one window at a time (each window covers only bytes no earlier
  one did), so `latest` costs the size of the answer. Forward: `readLinePages`
  reads a region in 64 KiB pages, emitting each page's complete lines and
  carrying the unterminated fragment — `query`, the replay half of `changes`,
  and the watcher's gap read all go through it, so **no read allocates a
  region**. Every tail window is clamped to `MAX_WINDOW` (1 MiB) in the one
  private `readWindow` primitive; only a single line longer than a bound may
  exceed it.

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
`Envelope.lastValid` above.

## The error taxonomy (eight tags)

`MalformedLine`, `UnknownEvent`, `InvalidData`, `UnserializableData`,
`TerminalViolation`, `JournalClosed`, `JournalNotFound`, `JournalResync`. Every
tag names a distinct recovery; causes are carried **structurally** —
`error.issue` keeps its shape, `UnserializableData.cause` is `Schema.Defect()`.
`InvalidData`/`UnknownEvent` carry `line` only when there is one (absent on the
encode path). `PlatformError` is deliberately **not** a member: IO failures pass
through untranslated, and a missing file is recognised by `stat` failing with
reason `NotFound` (`Effect.catchReason`), never by a racy `exists` first.
Operations expose only the tags they can raise (`AppendError`, `QueryError`,
`ChangesError`); an unregistered tag passed to `append` is a defect.

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

- **Filter with `--project @effected/jsonl` from the repo root, or use the
  vitest-agent MCP `run_tests` tool.** From inside the package vitest does not
  load the root config: `--project` fails with `No projects matched the
  filter` and a positional filter finds no test files.
- **Prefer the MCP's structured `run_tests` result; from a shell, no single
  signal is evidence.** The exit code can be lost (piped through `tail`, or a
  hang past its timeout crashing the reporter) and the `Tests:` line can read
  `0/0 passed` for a filter that matched nothing — require a non-zero count AND
  a clean exit. A subset run skips the suite's coverage thresholds (`Coverage
  thresholds skipped: partial run`). Never grep for `✗`/`FAIL`: the format
  varies by reporter, so a killed mutant reads as a survivor.
- **A stale `issues.json` looks identical to a fresh one on `warnings`/
  `errors`.** The tell is the `suppressed` count: this package's prod build
  suppresses exactly 8 `ae-forgotten-export` entries (one `_base` symbol per
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
