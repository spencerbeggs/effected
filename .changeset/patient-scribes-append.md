---
"@effected/jsonl": minor
---

## Features

### Initial release

`@effected/jsonl` ships append-only, schema-validated JSONL journals as a definable Effect service. A journal is a live object, not just a file format: its current state is its last valid line, its tail may be torn mid-append, and several processes can read it while one writes. Every line is an envelope (`at`, `event`, an optional `scope`, and a `data` payload validated by the schema registered for that event), so a journal stays greppable and diffable while the reads that matter stay typed.

```ts
import { Journal, JsonlEvent } from "@effected/jsonl";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Schema } from "effect";

const Snapshot = JsonlEvent.make("snapshot", {
  data: Schema.Struct({ round: Schema.Number, phase: Schema.String })
});

class GameJournal extends Journal.Service<GameJournal>()("app/GameJournal", {
  events: [Snapshot] as const
}) {}

const GameJournalLive = GameJournal.layer({ path: "game.jsonl" });

const program = Effect.gen(function* () {
  const journal = yield* GameJournal;
  yield* journal.create;
  yield* journal.append("snapshot", { round: 1, phase: "waiting" });
});

Effect.runPromise(program.pipe(Effect.provide(GameJournalLive), Effect.provide(NodeFileSystem.layer)));
```

* **`Journal`** — `Journal.Service<Self>()(id, { events })` mints a per-registry service class whose `.layer({ path })` is a scoped layer over `FileSystem`, with `append`, `appendPatch`, `latest`, `quiescent`, `query`, `changes`, `projection`, `create` and `remove` all typed by that registry. `at` is stamped by the service from the Effect `Clock`, never by the caller, so two writers can never disagree about ordering.
* **`JsonlEvent`** — declares one event's tag, payload schema and optional `terminal`/`reopen` markers for a registry array.
* **`Envelope`** / **`EnvelopeFrame`** — a two-stage decode: the frame (`at`, `event`, `scope?`, `data` left unknown) is what every filter reads, and the registered payload schema runs only for lines a slice has already selected.
* **`Slice`** — the one filter shape every read surface (`query`, `changes`, `projection`) takes: `events`, `scopes`, an inclusive `from`, an exclusive `to`, and a `cursor` for resuming — no read surface ever materializes the whole file.
* **`Line`** / **`Envelope.lastValidResult`** — a pure, synchronous, `Result`-based core that walks back to the last valid envelope with no Effect runtime at all, so a hook script or shell-adjacent tool can read a journal's current state directly.
* A built-in watcher cross-observes external writers — a second service instance, a sibling process, or a shell script appending with `>>` — so a subscriber cannot tell a local append from an external one.

Eight tagged errors (`MalformedLine`, `UnknownEvent`, `InvalidData`, `UnserializableData`, `TerminalViolation`, `JournalClosed`, `JournalNotFound`, `JournalResync`) carry their causes structurally rather than stringified; core's `PlatformError` passes through IO failures untranslated rather than being wrapped.
