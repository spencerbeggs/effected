# Redaction, retry vocabulary and the scripted test double

Load when: redacting a secret from argv or captured output, classifying a
command failure as transient/retryable, or reaching for the shipped
scripted `ChildProcessSpawner` double instead of hand-rolling one.

## `Redaction` — the kit-wide policy home

```ts
import { Redaction } from "@effected/commands";

const args = Redaction.applyArgs(rawArgs, [npmToken]);           // by VALUE — exact match, wherever it appears
const scrubbed = Redaction.scrubArgs(args);                      // heuristic backstop, runs in ADDITION
```

`apply`/`applyArgs` redact **by value**: the caller already holds its secret
as `Redacted.Redacted<string>`, and every occurrence is removed — whichever
flag carried it, and inside a larger string such as a credential embedded
in a URL. Matching is longest-value-first — redacting a short secret before
a longer one that contains it would leak a fragment.

`scrubArgs`'s flag heuristic — the exported `SECRET_FLAGS` set (matching
common secret-carrying flag names and key suffixes) plus a caller-supplied
extra set — is the **backstop**, for a secret the caller forgot to declare;
it runs in addition to value-based redaction, never instead of it. `Run`
applies both to argv and to captured stdout/stderr before either reaches
an error; span annotations carry only stable identifiers (command name,
argument count) — never argv values or captured output.

## `Retry` — vocabulary, not a runner

```ts
Run.text(command).pipe(Effect.retry(Retry.transient()));
```

`Retry.isTransient` classifies a `CommandFailedError` as a transport
hiccup, matched against the exported `TRANSIENT_PATTERNS` list (connection
reset, timed out, DNS failure, generic fetch failure, …) in stderr, stdout
and an absorbed platform error's message. Two classifications are structural, not textual,
and matter more than the pattern list: a missing executable (`kind:
"spawn"` with `.notFound`) is **never** transient — retrying cannot install
a tool — and a timeout is **not** transient by default, or a command that
hangs deterministically burns its whole ceiling on every attempt.

`Retry.transient(options?)` returns ready-made `{ while, schedule, times }`
for core's `Effect.retry` — jittered exponential backoff, three attempts by
default. This is **vocabulary only**: a caller needing to repair state
between attempts (reset a working tree, say) composes `Effect.retryOrElse`
or `Effect.tapError` itself.

## `ScriptedSpawner` — the shipped scripted double

The package exports `ScriptedSpawner`, `SpawnScript`, `SpawnRecord` and
`ScriptResult` — a scripted `ChildProcessSpawner` implementation for tests
that need a specific sequence of commands to return specific output without
a real subprocess. `testing-actions` describes the ordering trap around
composing it with `NodeServices.layer` in a merge; this is the actual
shipped class that recipe is built around — reach for it by name instead of
hand-rolling a spawner stub per suite.
