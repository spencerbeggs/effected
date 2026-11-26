# Fiber-local state — `Context.Reference` and the `References` module

`FiberRef` and `FiberRefs` are removed (zero occurrences in core, and
`effect/FiberRef` does not resolve as a module). **`Differ` is not** — it
survives as a top-level module (`Differ.ts:29`,
`interface Differ<in out T, in out Patch>`) for patch-based value updates; it
simply no longer has a `FiberRef` to serve.

## The built-in references

Built-in fiber refs moved to the `References` module — read them by yielding
them: `yield* References.CurrentLogLevel`.

**There is no `References.CurrentConcurrency`** — the module's own header prose
says the references "cover concurrency, scheduling, logging, tracing"
(`References.ts:4`), but no concurrency reference is exported, and
a `yield*` against the remembered name gets `undefined`. Concurrency is an
*option* in v4 (`{ concurrency }` on `Effect.all` and friends), not an ambient
reference. The twelve that do exist:

- `CurrentLogAnnotations`
- `CurrentLogLevel`
- `CurrentLogSpans`
- `CurrentStackFrame`
- `MinimumLogLevel`
- `TracerEnabled`
- `TracerSpanAnnotations`
- `TracerSpanLinks`
- `TracerTimingEnabled`
- `UnhandledLogLevel`
- `CurrentLoggers`
- `LogToStderr`
