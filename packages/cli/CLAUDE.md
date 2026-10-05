# @effected/cli

The boundary layer of an `effect/cli` program: `CliLogger`,
`CliRuntime` (including `CliRuntime.main`), `CliExit`, `CliColor`,
`SchemaIssueRenderer`, `ConfigIssueRenderer` — plus a `./testing` subpath
exporting `CliTest`, for spawning a built bin hermetically in tests. Every
export but `CliTest` is presentation, and `CliTest` is test tooling behind
its own entrypoint so it never enters a CLI's runtime import graph.

It also owns how a program's output is written for whoever is reading it: the
document IR (`Doc`, plain frozen nodes), the pure renderers over a
`RenderContext` (`Render.plain`, `ansi`, `markdown`, `githubLog`, and
`Render.context(stream)` to build one from the services), `Doc.print`,
`GithubAnnotation`, editor-aware `CliLinks`, and `CliFailure`, which is how the
default failure report is drawn. An agent is never written an escape of any
kind. Every string that enters a document is sanitised: escape sequences and
control characters are removed, a tab becomes a space, and line breaks are kept
as breaks. A status vocabulary's glyphs are sanitised too, at one source
(`Status.glyph`, which a theme's `status`, `CliMessage`, `CliLog.status` and
`Doc` all draw through), so a glyph built from data cannot inject an escape
on a trusted line; a theme's glyph set (separators, ellipsis) is configuration.
`okf/modules/cli.md` has the rows.

**Design doc:** `@./okf/modules/cli.md` — Load when:
changing the public surface, the logger's stream routing, the failure-reporting
combinator or the renderers. It carries the reasoning this file only
states. The consumer record behind it is
`@./okf/consumers/reposets.md` — Load when: weighing a
new request against what the first consumer actually reported.

## The rule that defines scope

**Not a CLI framework.** `effect/cli` owns parsing, flags, the command
tree and help. If a change here starts to look like parsing, it belongs upstream
or nowhere. Presentation and interactive UI are in scope —
`@./okf/decisions/cli-grows-presentation-layer.md` — Load when: deciding
whether a capability belongs in this package.

Tier: **boundary** for the root. No platform package, required or optional. The
moment `@effect/platform-node` appears here the package stops being usable from
Bun and Deno for no benefit. `./ui` is integrated, but only for a consumer who
installs its optional peers — `@./okf/decisions/ui-tier-is-integrated-on-opt-in.md`
— Load when: adding a dependency or a peer to this package.

**Nothing in the kit may depend on this but an application or a companion.**
The one kit package that does is `schemastore-cli`, a companion that carries no
tier and imports only the boundary root, so nothing inherits a tier from `./ui`.
Same posture as `app`: the two are siblings, not layers — `app` is the control
plane, `cli` the presentation boundary, and neither imports the other.

## The `./ui`, `./ui/testing` and `./ui/testing/serializer` subpaths

`./ui` holds the interactive screens: `CliUi` (`run`, `prompt`, `fallback`,
`lazy`, `map`, `live`, `lazyView`, `context`), `DocView`, `UiProvider`, the widgets (`Select`, `TextInput`, `MultiSelect`, `Confirm`,
`Toggle`, `Tabs`, `Viewport`), the key layer (`UiKey`, `KeyTable`, `useKeys`,
`KeyHelp`) and the theme bridge (`Styled`, `inkProps`, `useTheme`,
`useGlyphs`, `useTerminalSize`). `./ui/testing` holds `CliUiTest`: `render`
for one screen, `view` for a display-only element (no `result`), `session`
for a program that runs several (with a `transcript` and `written` of the terminal, and
`renderPath: "production"` to observe `clear`), `live` for a live view, and `chunk` on every handle to send keys in
one read. `./ui/testing/serializer` (`src/ui-testing-serializer.ts`)
default-exports `CliUiTest.serializer` for Vitest's `snapshotSerializers`; the root
`vitest.config.ts` registers it that way for this package's own project (#909), so a
snapshot test here uses `expect` for the snapshot alone. `okf/modules/cli.md` has the rows.

- **Optional peers `ink` (^7.1.1) and `react` (^19.2.0).** The root never
  reaches them, and `./ui` imports them only when a screen mounts (`loadInk`),
  so importing `./ui` or running a non-interactive program loads neither,
  except that an owned live view without a `final` document loads them to
  print its final frame as a string. `CliUi.lazyView(load)` defers a live
  view's own module (and its React) to the first Ink draw, and a `final`
  document prints through the `Doc` renderers with no Ink at all; both are
  held by `ui/CliUi.live.reach.test.ts` (#908).
  `src/ui/**` may only `import type` from them: only `ui/internal/ink.ts`
  loads them as values (held by `boundary.test.ts`); a missing peer in an interactive run is a defect
  naming both, never a silent fallback.
- **The ui declarations name the root by its package name.** `src/ui/**`
  imports root types as `import type * as Cli from "@effected/cli"`, and
  `savvy.build.ts` keeps `@effected/cli` and `@effected/cli/ui` external
  (`dtsExternals`), so `ui.d.ts` imports the root instead of inlining a copy
  a consumer's root layers could not satisfy —
  `@./okf/decisions/ui-declarations-reference-the-root-by-name.md` — Load
  when: touching `savvy.build.ts`, an entrypoint, or a root type a ui
  signature names. API Extractor's per-module pass cannot read those
  entries, so `declarations.test.ts` stands in for it: the built exports
  match the source and the pinned reviewed lists, every export carries a
  release tag, nothing is left unexported, and a consumer compiled against
  `dist/dev` resolves `CliTheme` from the root. `tsdocLinks.test.ts` keeps
  `{@link}` targets resolvable. The two "could not harvest per-module source
  locations" build warnings are those entries and are accepted.
- **`CliUi.live` is a scoped live view over a `Stream`, not a screen.** It folds
  events into state in a fiber of the caller's scope and draws runs: a run begins
  at `isStart` (or where an optional `begins(event, before, after)` says, for a
  consumer that joins mid-run) and ends at `isTerminal`; an event outside a run
  that begins none is folded and not drawn, so post-run events never mount a
  second copy, where Ink's own unmount leaves its frame on the terminal; the next
  run mounts afresh below, and `clear()` is never called —
  `@./okf/decisions/live-view-runs-and-modes.md`, `live-never-clears.md` — Load
  when: changing how runs start, end or redraw. One controller fiber owns every
  transition (events, the run's `Schedule.spaced` tick in the run's scope, render
  failures, the stream ending or dying); a failed render degrades the run (unmount
  first, then one warning, the last good frame kept), never kills the view; a
  start during a degraded run ends it and mounts afresh. Clearing a run and
  closing its scope is one uninterruptible step (an interrupt between them
  orphans the mount permit).
  - **Modes** differ only when not interactive (`CliInteractive`: a pipe, a
    non-human audience, or `TERM=dumb`, which cannot move the cursor): `owned`
    prints each run's final frame once as a string at stdout's width, `hosted`
    prints nothing. Neither
    mounts input: Ctrl-C stays the platform's SIGINT and closes the scope.
  - **Subscription and the end:** `events` is a `PubSub.Subscription` (subscribe
    first: the surest) or a stream, whose first pull `live` makes before
    returning (`Stream.fromPubSub` is subscribed; a stream that forks its
    upstream is not). End a view with `handle.close`, which folds what is still
    queued, a subscription's included, and ends the run as the events ending
    would; then close the scope. `PubSub.end(pubsub, last)` is lossless too (the
    view folds the buffer and `last` once, though core repeats it to every take).
    `PubSub.shutdown` drops what the view has not taken, and a bare scope close
    stops the fold at once: both lose a tail. A subscription is taken from
    directly (never `Stream.fromSubscription`), yield-free from a take to the
    inbox, so `close` never drops a taken message.
  - **Height, not width:** the frame is clipped to `rows - 1` (its content keeps
    its height and is clipped, never squeezed); the root takes no width at all —
    `@./okf/decisions/live-height-clamp-not-width.md` — Load when: touching the
    clamp or a widget's width.
  - **Logging while drawn goes through `handle.logConsole`**, which writes every
    `Console` method through Ink's own writers so lines land above the frame, and
    straight to `UiStreams` otherwise; any other write tears the frame —
    `@./okf/decisions/live-logs-through-ink.md`.
  - **An agent and the Actions runner:** an agent gets the colourless theme
    (`CliTheme.forAudience`, the same public rule `Render.context` and `CliLog.status` use) in every tree the
    kit mounts; under GitHub Actions `DocView` neutralizes workflow commands and a
    printed frame is neutralized whole.
  - **`DocView`** draws the `Doc` IR through `Render.ansi`/`Render.plain` as
    `truncate-end` rows, byte for byte the static output; **`UiProvider`** gives a
    tree the kit did not mount the same context (value from `CliUi.context`).
  - **`CliUiTest.live`** drives a view on the production render path under
    `it.effect` (`advance` moves the `TestClock`); `transcript` models the
    terminal, `written` is every raw byte.
- **Ink hands every key of one stdin read over before React re-renders.** A
  key handler must step from current state (a functional update, a reducer
  or a ref), never render-closure state; test it with `chunk` —
  `@./okf/gotchas/ink-delivers-a-chunk-of-keys-before-rerender.md` — Load
  when: writing or reviewing a key handler or a widget.

## Load-bearing decisions

**`CliLogger` reads `Console.Console` off the fiber.** Not a style choice:
`Logger.make` takes a *synchronous* callback and a `Sink` write is an `Effect`,
so `Stdio` is unreachable from a logger. Writing to `process.stdout` would work
and is what the consumer did first — it drags a platform assumption into a
library and makes the stream split untestable, because asserting it means
stubbing a global inside a runner that writes to those same streams.
`Console.Console` is a `Context.Reference`, so it carries a default, never
appears in `R`, and a test swaps it.

**Compare levels ordinally, never by string equality.**
`LogLevel.isGreaterThanOrEqualTo(logLevel, stderrFrom)` is the test; `logLevel
=== "Error" || logLevel === "Fatal"` hard-codes two names and silently misses
any level above them, including one added upstream. `stderrFrom` defaults to
`"All"` and the threshold is the option (#716; breaking on the 0.x line).

**`LogToStderr` is honoured in one direction only.** It can force everything to
stderr; it must never move an error onto stdout. That is the one guarantee this
logger makes and a reference should not be able to revoke it.

**`CliRuntime` is a combinator, not a `runMain`.** The failure it fixes is
*where the report happens*: a platform `runMain` composes its reporting
`tapCause` around the already-provided effect, so the report runs outside your
layers and prints through the default logger on stdout. The fix has to happen
inside the effect. Wrapping `runMain` itself would drag a platform choice into
this package.

**`Runtime.errorReported` has inverted polarity relative to its name.** `false`
is what suppresses the runtime's own report; the marker means "should this be
reported". The intuitive `errorReported: true` — "I have reported it, stay
quiet" — produces exactly the double report it was meant to prevent. The test
for this is written so that flipping the source value **fails**, not so that it
merely records the current one.

**`getErrorExitCode` cannot be used alone to decide a code.** It answers `1`
both for an error marked `1` and for an unmarked one, so an `exitCode` option
would silently override a deliberate `1`. Test for the marker with
`Runtime.errorExitCode in error` to keep "the error chose" distinct from
"nothing chose".

**`reportFailures` never renders `ShowHelp`.** `Command.runWith` already
printed the help text or the parse errors before a `ShowHelp` reaches
`reportFailures`, so rendering it again produces nothing but a stray "Help
requested" line. A `ShowHelp` carrying parse errors is instead remapped to
`usageExitCode` (default `64`, BSD `EX_USAGE`); a bare `--help` or root
invocation — `errors` empty — keeps exit `0`.

**`CliRuntime.main` uses a private `ExitRequested` sentinel, not
`process.exitCode`.** Node's `runMain` skips `process.exit(0)` on success, so
a handler that only sets `process.exitCode` on an otherwise-successful fiber
relies on Node's own process-exit machinery to eventually notice that field —
well after Effect's finalizers had their chance to run, and not at all on a
non-Node runtime. `CliExit.set(code)` records a findings code instead; after
the program succeeds, `main` reads the cell and, if non-zero, fails with the
internal `ExitRequested(code)` sentinel — marked with `Runtime.errorReported:
false` so it routes through core's `defaultTeardown` like any other error,
with finalizers intact, on any runtime. `reportFailures` never renders it:
there is nothing to say, only an exit code a successful program already
chose. Nothing outside this package constructs or matches `ExitRequested`.

**`CliExit.layer` is `Layer.fresh`.** Every provide mints a new cell —
without `Layer.fresh`, layers memoize by reference across `Effect.provide`
calls, so a second provide anywhere in the program (a nested
`CliRuntime.main`, a test helper) would silently share the first run's cell
and inherit its code. **A program run under `CliRuntime.main` must NOT
provide `CliExit.layer` itself** — `main` already provides a fresh cell, and
a second provide creates a second, unrelated cell: `CliExit.set` calls made
against that shadow cell never reach the one `main` reads, and a findings run
silently exits `0`.

**The kit never defaults `env.stderrIsTerminal` from the host.** Core's `Stdio` reports only stdout (Effect-TS/effect#8639), so without the option a redirected stderr is painted because it mirrors stdout. Reading `process.stderr.isTTY` inside the root would break the no-`process` rule ([ui-binds-process-streams](../../okf/decisions/ui-binds-process-streams.md)), so the bin's entry passes it, the one place a bin reads its host. Once core has a stderr check, `CliEnv.layer` reads that instead.

**`FailureDetails.isCancelled` / `isNotInteractive` are flags, `isDefect` is not redefined.** A fallback prompt's quit is a defect and a `CliUi.run` quit a typed failure, so `isDefect` cannot say "not a bug"; the flags test the squashed error's class and hold on either channel. `isDefect` stays `!Cause.hasFails(cause)` and no exit code depends on either.

**`CliColor` delegates to `@effected/env`, which reads the environment through `ConfigProvider`, never `process`.**
`enabled` is `TerminalEnv.colorLevel("stdout") !== "none"`, so it follows Node's
`getColorDepth` precedence: `FORCE_COLOR` first (and it beats `NO_COLOR`), then a
non-empty `NO_COLOR`, `NODE_DISABLE_COLORS` and `TERM=dumb`, then the TTY gate
([decision](../../okf/decisions/force-color-honoured-node-precedence.md)). A test
swaps the environment with `Effect.provideService(ConfigProvider.ConfigProvider, ...)`
instead of mutating `process.env`, or fixes the answer with `TerminalEnv.layerTest`.

**The `./testing` split has a reachability test.** `entrypoints.test.ts`
walks the import graph from `src/index.ts` and asserts nothing reachable from
it imports `CliTest` or `testing.ts`, with a positive control proving the
walker actually resolves imports (`./testing` DOES reach `CliTest`) and a
second control proving it resolves the main entry too (`index.ts` reaches
`CliRuntime`). A CLI that only imports `@effected/cli` therefore never pulls
test-spawning machinery — `effect/process`'s `ChildProcessSpawner`
included — into its runtime bundle.

## The optional peer, and the rule that makes it honest

`@effected/config-file` is a `workspace:^` peer with
`peerDependenciesMeta.optional: true`, consumed only by `ConfigIssueRenderer` —
the same arrangement `@effected/markdown` has with `yaml`/`toml`/`jsonc`.

**`ConfigIssueRenderer` must stay a module no other module imports.** An
optional peer whose import is reachable from a shared module is not optional; it
is a crash for every consumer who took the manifest at its word. Shared
rendering lives in `src/internal/format.ts`, which both renderers import and
neither re-exports. The entrypoint re-exporting `ConfigIssueRenderer` is fine.

Verify this with a build, not by reading: every runtime `import` in
`dist/prod/npm/pkg/**/*.js` must be `effect` or a relative path. The `.d.ts`
carries a type-only import of `ConfigValidationError`, which is erased.

## Testing

The whole surface is testable without stubbing globals: provide a capturing
`Console`, run, and assert on what was written **and on which stream**.

The discriminating mutant for `CliLogger` is **route everything to stdout**. A
suite that still passes is asserting on content and not on stream, which is half
a test — `Warn` is the boundary that catches it.

**Drive levels with `References.MinimumLogLevel`, provided as a service.**
`Logger.withMinimumLogLevel` **does not exist on the v4 line** and is the
obvious first reach. `@effect/vitest`, `it.effect`, `assert.*` — never
`expect`.

**Testing an actual built bin — a real subprocess, not the program in-process
— uses `@effected/cli/testing`'s `CliTest`.** `CliTest.sandbox({ path })`
mints a scoped temp directory with a fresh `HOME` and
`XDG_{CONFIG,DATA,STATE,CACHE}_HOME`, `NO_COLOR: "1"`, and the `path` you
pass as `PATH` — the host environment is never inherited. `CliTest.run(bin,
args, { sandbox, execPath, cwd?, env?, stdin? })` spawns `execPath` with
`[bin, ...args]` over core's `ChildProcess`/`ChildProcessSpawner` and returns
`{ exitCode, stdout, stderr }` as data — a non-zero exit is never a failure.
**When `stdin` is omitted, or passed as `""`, the child receives an
already-ended empty input (`Stream.empty`), never an open pipe** — core's
default `"pipe"` stdio stays open until something writes to and ends it, so a
stdin-reading bin would otherwise hang the test.

```bash
pnpm vitest run packages/cli        # from the repo root
pnpm build --filter @effected/cli   # cold; never the raw savvy.build.ts
```
