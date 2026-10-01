# The live view: `CliUi.live`, `DocView` and `UiProvider`

Loaded from `effect-v4-cli`. Covers drawing progress that updates in place while work runs: folding a stream of events into state, how runs start and end, logging without tearing the frame, ending the view without losing its tail, drawing the `Doc` IR inside Ink, and giving an Ink tree the kit did not mount the same theme. All of it lives behind `@effected/cli/ui` and its optional peers `ink` and `react`.

## The shape

`CliUi.live(options)` → `Effect<LiveHandle<S>, never, Scope | CliTheme>`. It folds `events` into state in a fiber of the caller's scope and draws **runs**: a run begins at an `isStart` event and ends at an `isTerminal` one, whose frame is committed to the terminal (the view never clears it). Between runs nothing is drawn; the next run mounts afresh below. It is a view, not a screen: it mounts no input, so Ctrl-C stays the platform's SIGINT and closes the scope. `live` returns its handle **at once, before Ink loads** — Ink is loaded when a run first mounts, or when an owned run prints its final frame — so a host outside Effect can take the handle with `Effect.runSync`, and a `close` before any run mounted loads nothing.

```tsx
import { Doc, Status } from "@effected/cli"
import { CliUi, DocView } from "@effected/cli/ui"
import { Console, Effect, PubSub } from "effect"

type Event =
  | { readonly _tag: "RunStarted"; readonly files: number }
  | { readonly _tag: "FileDone"; readonly ok: boolean }
  | { readonly _tag: "RunEnded" }

interface State { readonly done: number; readonly failed: number }

const program = Effect.scoped(
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<Event>()
    const events = yield* PubSub.subscribe(pubsub) // subscribe before anything publishes

    const view = yield* CliUi.live<Event, State>({
      events,
      initial: { done: 0, failed: 0 },
      reduce: (state, event) =>
        event._tag === "RunStarted" ? { done: 0, failed: 0 }
        : event._tag === "FileDone" ? { done: state.done + 1, failed: state.failed + (event.ok ? 0 : 1) }
        : state,
      render: (state) => (
        <DocView
          doc={Doc.counts({
            layout: "inline",
            counters: [
              Doc.counter(Status.core, "success", { key: "ok", label: "passed", n: state.done - state.failed }),
              Doc.counter(Status.core, "failure", { key: "bad", label: "failed", n: state.failed }),
            ],
          })}
        />
      ),
      isStart: (event) => event._tag === "RunStarted",
      isTerminal: (event) => event._tag === "RunEnded",
    })

    yield* Effect.gen(function* () {
      yield* PubSub.publish(pubsub, { _tag: "RunStarted", files: 1 })
      yield* Console.log("checking a.ts") // lands above the frame
      yield* PubSub.publish(pubsub, { _tag: "FileDone", ok: true })
      yield* PubSub.publish(pubsub, { _tag: "RunEnded" })
    }).pipe(Effect.provideService(Console.Console, view.logConsole))

    yield* view.close // folds what is still queued, then ends the run
  }),
)
```

## `LiveOptions`

| Option | Meaning |
| --- | --- |
| `events` | a `PubSub.Subscription<E>` (the surest) or a `Stream<E>` |
| `initial`, `reduce(state, event)` | the fold; the kit never resets state, so a reducer that wants a fresh run resets it |
| `render(state, frame)` | the drawing, inside the kit's providers (`useTheme`, `useGlyphs`, `Styled`, `useTerminalSize` work). `frame` is `floor(now / tickMillis)`, so a spinner keeps turning |
| `isStart`, `isTerminal` | what begins and ends a run |
| `begins(event, before, after)` | optional: begin a run on something other than a start, for a program that joins a stream mid-run |
| `mode` | `"owned"` (default) or `"hosted"` (drawn inside a host such as a test reporter); they differ only when not interactive |
| `tickMillis` | redraw interval while a run is drawn, `80` by default; must be positive and finite |
| `drainPerformance` | clear React's development-build user-timing entries after each render; `"auto"` unless `NODE_ENV` is `production` |

`LiveHandle<S>` is `state`, `logConsole`, `done` (completes when the events have ended and the last frame is committed; dies with what the view died of) and `close`.

## Subscribe first, then end without losing the tail

- **Pass the `PubSub.Subscription` itself, made before the first publish.** The view takes from it directly, so nothing published after the subscribe is missed. A stream is subscribed only on its first pull: `live` makes that pull before returning, so `Stream.fromPubSub` is subscribed in time, but a stream that forks its upstream (`Stream.merge`, `buffer`, a concurrent `flatMap`) subscribes later and loses what was published before.
- **End with `handle.close`** — it folds every message still queued in a subscription, ends the run as the events ending would, then waits for `done`. It is idempotent, and it dies as `done` dies (a `reduce` that threw, a stream that died), so a host that only calls `close` still sees the defect.
- **`PubSub.end(pubsub, last)` is lossless too**: the view folds the buffer, then `last` once. Make `last` an `isTerminal` event to commit the run with it.
- **`PubSub.shutdown` drops what the view has not taken**, and closing the caller's scope stops the fold at once: both lose a tail. Close first, then release the scope: `handle.close.pipe(Effect.ensuring(Scope.close(scope, Exit.void)))`.

## Logging while drawn: `logConsole`

A line written to the terminal while a run is drawn tears the frame. `handle.logConsole` is a `Console` whose every method writes **above** the frame while a run is mounted (split to stdout and stderr as Node's console splits them), and straight to the stream otherwise. **`Console.Console` is the seam**: `CliLogger`, `CliLog` and `Effect.log*` all write through the fiber's `Console`, so providing `logConsole` around the work routes every log line correctly with no reference to the view. Output that bypasses Effect's `Console` (a library's own `process.stderr` writes) still tears the frame.

## Not interactive: `owned` vs `hosted`

When `CliInteractive` is false (a pipe, a non-human audience, `TERM=dumb`), nothing is mounted. `owned` prints each run's final frame **once**, as a string at stdout's width, escape-free at colour `none` and for an agent; `hosted` prints nothing, its host having its own output. In that printed frame `useTerminalSize().rows` is `Infinity`, so a render must never allocate per row.

## Height, failures and the run's tick

- The frame is clipped to `rows - 1` (its content keeps its height and is clipped, never squeezed); the kit imposes no width.
- A render that throws **degrades** the run: it unmounts, logs one warning, and keeps folding; the last good frame stays. A throwing `reduce` unmounts and `done` dies.
- Each run's tick is a `Schedule.spaced(tickMillis)` in the run's own scope, so under `it.effect` a test moves it with `TestClock`.

## Drawing documents and hosting trees

- **`DocView`** draws the `Doc` IR as Ink rows (`<DocView doc={document} />`, or one block), through the same renderer as the static output, so a live view and a static report show a document byte for byte alike. Without a `ctx` prop it builds a context from the tree's theme and terminal size; under GitHub Actions it neutralizes workflow commands.
- **`UiProvider`** gives an Ink tree the kit did **not** mount (your own `render`, `renderToString`) the context `useTheme`, `useGlyphs`, `Styled` and `useTerminalSize` read. Take its value from `CliUi.context` (`Effect<UiContextValue, never, CliTheme>`): `<UiProvider value={value}>…</UiProvider>`. Pass `size` in the value when laying out at a width other than the process's stdout.
