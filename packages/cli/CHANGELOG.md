# @effected/cli

## 0.11.0

### Breaking Changes

- On the `0.x` line breaking changes ship as `minor`; the changes below can need action on upgrade.

#### New peers and dependencies

- `@effected/env`, `@effected/walker` and `@effected/glob` are new **required** peers. Declare them beside `@effected/cli`: as regular dependencies in a bin or tool, as peers in a library.
- `@effected/github-commands` is a new regular dependency; nothing to declare unless you import it yourself.
- `ink`, `react` and `@types/react` are **optional** peers, needed only for the new `@effected/cli/ui` entrypoint. The package root and `./testing` never load them.

#### `CliColor` follows Node's colour precedence

- `CliColor.enabled` now decides through `@effected/env`, using Node's `getColorDepth` rules:

- `FORCE_COLOR` is honoured and beats `NO_COLOR`; it forces colour even without a terminal, and `FORCE_COLOR=0` forces it off.

- `NODE_DISABLE_COLORS` and `TERM=dumb` turn colour off, as a non-empty `NO_COLOR` already did.

- On Windows (`OS=Windows_NT`), a terminal gets truecolor, as Node gives on Windows 10 build 14931 and later.

- Elsewhere, a terminal Node's table does not recognise (no `TERM`, `COLORTERM` or known `TERM_PROGRAM`) gets no colour, as in Node.

- A harness that checks for escape-free output without a terminal should pin `FORCE_COLOR=0`, since a `FORCE_COLOR` inherited from CI now colours the output.

#### The default failure report is a document

- Without a `render` option, `CliRuntime.reportFailures` and `CliRuntime.main` no longer print `String(error)`. They print `CliFailure.toDoc(cause)`, rendered for the audience:

- a status line (`✗ Error: boom`, or `[FAIL] Error: boom` when no environment services are provided);

- for a defect, a cleaned stack of file links, with `node_modules` and runtime frames hidden and counted (`env.stackFrames: "all"` keeps every frame);

- a schema failure as a tree.

- The report is still written through the logger, and exit codes are unchanged. Tests asserting the exact line `Error: boom` need updating.

- `FailureDetails` gains two required members, `defaultLines` and `lines({ status? })`: the report the kit would write, with the run's colour, links and `displayPath`. A hand-built `FailureDetails` literal (typically in a test of your `render`) must supply them.

- `CliRuntime.defaultRender(error, details, { status? })` is now exported and returns plain lines.

#### Log text is sanitised

- `CliLogger` now removes escape sequences and control characters from what a program logs: a line break stays one and a tab becomes a space. A custom `render` receives the string parts already sanitised. This changes bytes in plain output, agent output included, for any log message that carried a tab or an escape. Under GitHub Actions, a line the runner would read as a workflow command is also neutralized.

#### `CliRuntime.main` builds the platform under the logger

- The platform layer is now built under `CliLogger`, so log lines it writes while building go to stderr rather than stdout. Lines returned by a consumer `render` are neutralized under GitHub Actions and stripped of escapes for an agent or CI audience.

* The kit now builds on and peers stable `effect` `^4.0.0`, in place of an exact release-candidate pin. Move `effect` and every `@effect/*` package to the same `4.x` version in one install: Effect releases them together at one version. A package from this release cannot share an install with an `effect` release candidate. The peer is a caret range, so later `4.x` releases of Effect satisfy the kit without a kit release.
* Kit exports are unchanged. A consumer moving to stable `effect` meets these changes in its own code:
  - `Array`, `Chunk`, `Effect` and `Record` `partition`, their `separate` helpers and `Option.partitionMap` return `[successes, failures]`. Where both sides share a type, the reversed destructuring still compiles, so search for every call.
  - `Schema.brand` takes one identifier and is type-only: the identifier is not stored on the AST and does not survive `SchemaRepresentation`. Compose distinct brands by applying `brand` more than once.
  - `TestSchema`'s round-trip assertion is `verifyRoundTrip`, with Effect forms `succeedEffect`, `failEffect` and `verifyRoundTripEffect`.
  - Effect marks some APIs `@stability unstable`: those may change in a minor Effect release. Untagged APIs follow semver.

### Features

- `@effected/cli` grows from a failure-reporting boundary into the presentation layer of an `effect/cli` program. It decides the **audience** (a person, an agent or a CI job), what the terminal can do, the theme, how a document and a failure are drawn for that audience, and when a run may prompt. It still adds no parser and no command model: `effect/cli` owns those.

#### The one wiring

```ts
import { CliAudience, CliRuntime } from "@effected/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command } from "effect/cli";

const root = Command.make("tool").pipe(
  Command.withSharedFlags(CliAudience.flags()),
  Command.withSubcommands([init, verify]),
);

NodeRuntime.runMain(
  CliRuntime.main(CliAudience.run(root, { version: "1.0.0" }), {
    platform: NodeServices.layer,
    env: { audienceEnvVar: "TOOL_AUDIENCE", log: { envVar: "TOOL_LOG_LEVEL" } },
  }),
);
```

- `CliRuntime.main`'s new `env` option builds the `@effected/env` services, the theme, editor links and interactivity once, inside failure reporting. It also accepts `formatter`, `displayPath`, `stackFrames`, `editorLinks` and `stderrIsTerminal`.

#### Audience and interactivity

- `CliAudience.flags()` adds `--audience`, `--human`, `--agent` and `--ci` as shared root flags; a repeated or conflicting flag exits `64`. `--audience` lists its choices once in help. `CliAudience.run` resolves the audience before core parses, so parse-time fallback prompts see it. A root without the flags is a compile error.
- `CliEnv.layer` builds the environment outside `main`; `CliEnv.layerTest({ tty, term, audience, columns, color })` fixes it in a test.
- `CliInteractive` says whether a run may prompt. It defaults to `false`, so a forgotten wiring never prompts. A pipe, an agent, CI and `TERM=dumb` are not interactive.
- `CliPrompt.fallback` makes a core `Prompt` the fallback for a missing flag or argument, only when interactive, with an `otherwise` value. `Cancelled` (exit `130`) and `NotInteractive` (exit `64`) report themselves in one fixed line. Non-interactive runs never attach to the terminal, so piped stdin stays readable.

#### Theme

- `CliTheme` paints by token: `success`, `failure`, `warning`, `info`, `error`, `muted`, `accent`, `emphasis`. `Token.hex`, `Token.named` and `Token.style` build styles; `NamedColor` uses chalk and Ink spelling (`redBright`, `blackBright`, `gray`), and a name outside it paints nothing.
- `Status.core` is the shared status vocabulary (`success`, `skip`, `pending`, `info`, `warning`, `failure`), and `Status.extend` adds your own with typed names and severity folding. `Glyphs` switches to ASCII under `TERM=dumb`.
- `CliMessage.success`, `info`, `warning`, `failure` and `status` write one themed outcome line that no log level silences.

#### Documents and renderers

- `Doc` is a plain-data document model: headings, paragraphs, lists, tables, counts and counts tables, trees, collapsibles, code and diff blocks, strong and emphasis text, and links.
- `Doc.print` picks the renderer by audience: ANSI for a person, plain for an agent, a GitHub Actions log under Actions, and plain for other CI. `Render.plain`, `Render.ansi`, `Render.markdown` (for a step summary or a file) and `Render.githubLog` are pure functions of a document and a `RenderContext`, built with `Render.context` or `Render.contextOf`.
- A table with no header text and no rows draws nothing in every renderer, or only its overflow line when a cap hid rows, so an empty `Doc.countsTable([])` is safe to print.
- `CliLinks` turns file targets into OSC 8 links for people only: `vscode://file/…` when a `.vscode/` directory sits at the workspace or git root, `file://` otherwise.
- `CliFailure.toDoc` draws a failure as a document, and the `CliDoc` protocol lets your own error class supply its document.
- `Fmt` adds width-aware `truncate`, `width`, `duration`, `percent`, `plural` and `sanitize`. `GithubAnnotation` writes `::error file=…,line=…::` annotation lines.

```ts
import { CliExit, CliMessage, Doc } from "@effected/cli";
import { Effect } from "effect";

const report = Effect.gen(function* () {
  yield* CliMessage.info("syncing 2 repositories");
  yield* Doc.print([
    Doc.table(
      [{ header: "Repository" }, { header: "Files", align: "right" }],
      [
        ["acme/widgets", "12"],
        ["acme/gadgets", "3"],
      ],
    ),
  ]);
  yield* CliMessage.warning("acme/gadgets has no default branch");
  yield* CliExit.set(1);
});
```

#### Output safety

- An agent audience never receives an escape sequence of any kind, even from an explicit `format: "ansi"` or a live view's own colours.
- Under GitHub Actions, every kit path that writes text it did not author neutralizes workflow commands: `Doc.print`, `Render.*` through a context, `CliMessage`, the failure report (a consumer `render` included), `CliLogger`, `CliLog`, and every frame of a live view. In `CliLog`'s NDJSON, a `##[` inside a record is written as the JSON escape `##[`, which decodes to the same text.

#### Logging

- `CliLog.layer` is opt-in diagnostics that owns the logger set: a level variable (`envVar`) or fixed `level`, `format: "auto" | "json" | "pretty"`, an optional file sink, `CliLog.component` prefixes and `extraLoggers`. With `format: "auto"` the audience decides: NDJSON for an agent or CI, plain text for a person. `plainLogger: false` keeps diagnostics only. Use it instead of `CliLogger.layer`, never beside it; `CliRuntime.main` builds it from `env.log`.

#### Interactive screens: `@effected/cli/ui`

- `CliUi.run` runs an Ink screen as a scoped Effect; `CliUi.prompt` asks from a handler with an `otherwise` value, and `CliUi.fallback` asks for a missing flag.
- Widgets: `Select`, `MultiSelect`, `Confirm` with `Toggle` rows, `TextInput`, `Tabs`, `Viewport` and `KeyHelp`. Your own screens use `KeyTable` and `useKeys` for keys, and `Styled`, `useTheme`, `useGlyphs` and `useTerminalSize` for the theme.
- Raw mode, the cursor and bracketed paste are restored on every exit, including a crash or an interrupt.
- `CliUi.live` folds a `Stream` or a `PubSub` subscription of events into state and draws each run in place while it goes. Log lines go above the frame through `handle.logConsole`, and `handle.close` folds everything still queued. When nobody is watching (a pipe, an agent, CI, `TERM=dumb`), each run's final frame prints once instead.
- `DocView` draws a `Doc` inside Ink exactly as `Doc.print` would, and `UiProvider` with `CliUi.context` gives an Ink tree you mount yourself the same theme.

```tsx
import { CliUi, Select } from "@effected/cli/ui";

const pickProfile = Select.screen({
  message: "Profile",
  choices: [
    { label: "library", value: "library" },
    { label: "application", value: "application" },
  ],
});

const profile = CliUi.prompt(pickProfile, { otherwise: "library" });
```

#### Testing

- `@effected/cli/testing` adds `TestTerminal`, which drives core prompts with keys in a test.
- `@effected/cli/ui/testing` adds `CliUiTest`: `render` mounts a screen on in-memory streams (`press`, `type`, `chunk`, `frame`, `result`), `view` mounts a display-only element, `session` drives a whole command's screens, and `live` runs a live view on the production render path with a `TestClock` tick. `CliUiTest.serializer` is a Vitest snapshot serializer for styled frames. [#905][#905]

### Documentation

- Every exported construct's TSDoc was reviewed against the current API. Summaries open with what the construct does, error channels and requirements are stated, examples use real imports and compile, and links resolve. Comments that described options, errors or defaults the code does not have were corrected. [#910][#910]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.13.1 | 0.14.0 |
| @effected/env | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/glob | dependency | updated | 0.9.0 | 0.10.0 |
| @effected/walker | dependency | updated | 0.14.1 | 0.15.0 |
| @effected/github-commands | dependency | added | — | 0.1.0 |
| @effected/env | peerDependency | added | — | 0.1.0 |
| @effected/glob | peerDependency | added | — | 0.9.0 |
| @effected/walker | peerDependency | added | — | 0.14.1 |
| @types/react | peerDependency | added | — | ^19.2.0 |
| ink | peerDependency | added | — | ^7.1.1 |
| react | peerDependency | added | — | ^19.2.0 |

[#905][#905]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#905]: https://github.com/spencerbeggs/effected/pull/905

[#910]: https://github.com/spencerbeggs/effected/pull/910

## 0.10.0

### Breaking Changes

- The kit now builds on and peers `effect` `4.0.0-rc.118`, pinned exactly. Consumers must move `effect` and every `@effect/*` package to `4.0.0-rc.118` in the same install. Effect removed the `effect/unstable/*` export paths in this release, so an `@effected` package built on rc.118 cannot share an install with `effect` rc.117.

- Moving the pin also closes a fresh-install failure on rc.117. `@effect/platform-node@4.0.0-rc.117` depends on `@effect/platform-node-shared` with a caret, so an install without a lockfile paired the rc.118 shared package with `effect` rc.117 and failed at startup with `ERR_MODULE_NOT_FOUND`.

- Consumers moving to this release: effect removed the `effect/unstable/*` export paths (imports become `effect/<module>`), moved `Arbitrary` to `effect`, split `effect/Encoding` into `effect/encoding/Base64`, `Base64Url` and `Hex`, and renamed the `Schema` range and string checks (`isLengthBetween` → `isBetweenLength`, `isStartsWith` → `isStartingWith`, and so on). Kit exports are otherwise unchanged; the kit's own imports moved onto the new paths. [#864][#864]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.12.0 | 0.13.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#864]: https://github.com/spencerbeggs/effected/pull/864

## 0.9.0

### Features

- `CliRuntime.main`'s new `helpOnUsageError` option reroutes a usage error's
  help document to stderr, beside the error itself, instead of core's
  default of printing it to stdout. `"stdout"` keeps core's behaviour (the
  default); `"stderr"` keeps stdout clean for a caller that parses it, such
  as a hook piping JSON through `jq` — an unknown flag, a bad value or an
  unknown subcommand then writes nothing to stdout. An explicit `--help` and
  a bare invocation of a command group still print to stdout: neither is an
  error.

- `ReportFailuresOptions.render` now receives a second argument,
  `FailureDetails`, carrying the whole `Cause` the program failed with and
  `isDefect` — whether the reported error is a defect (a `die`, a thrown
  exception, a bug) rather than a typed failure from the error channel. A
  renderer can use it to render a typed failure as one line and a defect as
  a full report, without guessing from the error's shape. A renderer that
  takes only `error` still fits. [#840][#840]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.12.0 | 0.12.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#840]: https://github.com/spencerbeggs/effected/pull/840

## 0.8.0

### Breaking Changes

- On the `0.x` line breaking changes ship as `minor`; the changes below need action on upgrade.

#### `CliLogger`'s default `stderrFrom` is now `"All"`

- Every log level now goes to stderr by default, closing #716. Previously `stderrFrom` defaulted to `"Error"`, so `Info`/`Warning` went to stdout as program output — fine for a tool whose output *is* its log lines, but wrong the moment stdout is a machine-readable document, since a `--format=json` command would interleave its warnings into the JSON stream.

- Write program output with `Console.log`, never `Effect.log`. Pass the old default explicitly if your CLI relies on it:

```ts
import { CliLogger } from "@effected/cli";

CliLogger.layer({ stderrFrom: "Error" }); // restores the previous default
```

#### `reportFailures` no longer double-renders a `UserError`, and `ShowHelp` exit codes changed

- `Command.runWith` already renders a `CliError.UserError` itself, through its `CliOutput` formatter, before re-failing with it — `CliRuntime.reportFailures` and `CliRuntime.main` now detect that (the mark `runWith` flips) and skip printing it a second time, exiting with the usage code (`64` by default) instead of the generic fallback.

- A `UserError` marked with an explicit exit code keeps it: `CliRuntime.reported(userError, 3)` exits `3`, not the usage code. Such an error is treated as already printed and is not rendered, so use a different error type if the program has not printed it.

- A bare `ShowHelp` — `--help`, or a root invocation with no parse errors — still exits `0` silently. A `ShowHelp` carrying parse errors now exits `usageExitCode` (default `64`, BSD `EX_USAGE`) instead of the previous fallback of `1`.

### Features

#### `CliRuntime.main` and `MainOptions`

- Assembles a whole program in the one order that reports every failure well: a fresh `CliExit` cell, then your platform layer (inside failure reporting, so a layer-build failure renders as one line instead of escaping to a stack trace), then failure reporting, then the logger outermost.

```ts
import { CliRuntime } from "@effected/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command } from "effect/unstable/cli";

NodeRuntime.runMain(CliRuntime.main(Command.run(root, { version }), { platform: NodeServices.layer }));
```

#### `CliExit` and findings exit codes

- A findings command — a linter that found problems, say — can now exit non-zero on a *successful* run, with finalizers intact on any runtime:

```ts
import { CliExit } from "@effected/cli";

yield* CliExit.set(2); // highest code set during the run wins; must be an integer 0..255
```

- `CliExit` is a `Context.Service`, not a reference, so forgetting to provide it is a type error. A program run under `CliRuntime.main` must not provide `CliExit.layer` itself — `main` already provides a fresh one.

#### `CliColor`

- The no-color.org colour decision, shared by every renderer:

```ts
import { CliColor } from "@effected/cli";

CliColor.enabled; // Effect<boolean, never, Stdio> — off when stdout isn't a terminal, or NO_COLOR is a non-empty value
CliColor.formatterLayer(); // wires effect/unstable/cli's CliOutput.Formatter to the same decision
```

#### `ReportFailuresOptions.usageExitCode`

- A new option controlling the exit code for a usage error (a `ShowHelp` carrying parse errors, or an already-rendered `UserError`), separate from the general failure fallback. Defaults to `64`.

#### `@effected/cli/testing`

- A new subpath, never reachable from the main entrypoint, for spawning a **built** CLI bin hermetically in tests: [#821][#821]

```ts
import { CliTest } from "@effected/cli/testing";

const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
const result = yield* CliTest.run("dist/bin.js", ["--help"], { sandbox, execPath: process.execPath });
// { exitCode, stdout, stderr } — a non-zero exit is data, never a failure
```

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#821]: https://github.com/spencerbeggs/effected/pull/821

## 0.7.0

### Features

- Upgrades core Effect to `rc-117` [#812][#812]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.11.1 | 0.12.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#812]: https://github.com/spencerbeggs/effected/pull/812

## 0.6.0

### Breaking Changes

#### The whole kit tracks Effect `4.0.0-rc.116`

- Every package's `effect` peer moves from `4.0.0-rc.115` to `4.0.0-rc.116`. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it. No `@effected` API changes shape on this advance; the kit itself needed one edit (`Stream.scan` now takes a lazy initial state, met once in `@effected/jsonl`'s `Journal.projection`). A consumer that upgrades meets the rc.116 renames on its own code:

- `SchemaTransformation.make` is `makeTransformation`, and `Transformation#compose` is the dual standalone `SchemaTransformation.composeTransformation`.

- `SchemaGetter.Getter` is a tagged union exposing only `pipe`: `new SchemaGetter.Getter`, `onSome` and `onNone` are gone in favour of `SchemaGetter.map` / `compose` / `run` and `transformEffect` / `transformOptionalEffect`.

- `Stream.scan` and `Stream.scanEffect` take `() => initial`; `Stream.partition` returns `[passes, fails]`; `Stream.mapBoth` takes `onElement` / `onError`.

- `Effect.orElseSucceed` passes the error to its fallback and `Effect.isEffect` narrows to `Effect<unknown, unknown, unknown>`.

- `ByteSize.Input` string literals are checked at compile time; parse external strings with `ByteSize.fromString`.

- Arbitrary shrinking changed, so property-test replay tokens recorded at rc.115 no longer reproduce.

### Documentation

#### The Claude Code and Copilot plugins teach the rc.116 surface

- The `effect-v4-schema` transformation reference composes transformations with `SchemaTransformation.composeTransformation` and describes the `Getter` surface rc.116 left behind; the source-lookup and testing skills report rc.116 as the kit's pin and the two-copy lockfile shape the bridge now produces (`rc.115` for the toolchain, `rc.116` for the kit); the session-start briefing reports rc.116.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.10.1 | 0.11.0 |
| @effect/platform-node | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| effect | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| effect | peerDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |

### Maintenance

#### The rc.115 `packageExtensions` bridge is retired

- The toolchain (`@savvy-web/tsdown-plugins`, `rolldown-pnpm-config`, `@vitest-agent/*`) has republished declaring `effect` and its `@effected/*` inputs as regular dependencies, so the workspace no longer needs the `packageExtensions` block that pinned them by hand. Its ten keys named versions no longer installed and the lockfile diff on removal was the checksum line alone. Nothing published changes; this is the workspace's own install shape. [#792][#792]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#792]: https://github.com/spencerbeggs/effected/pull/792

## 0.5.2

### Bug Fixes

- Fixes closure issues in all packages.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.10.0 | 0.10.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.5.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.9.0 | 0.10.0 |

## 0.5.0

### Features

- `CliRuntime.reported` now preserves the error's type: a new `<E extends Error>(error: E, exitCode?: number): E` overload returns the very instance a typed caller passed (the marks are added in place), so a program can `Effect.fail(CliRuntime.reported(typedError, code))` and keep `catchTags` narrowing downstream without an `as typeof error` cast. The `unknown -> Error` fallback is unchanged: a non-`Error` value is still wrapped in a plain marked `Error`, and the exit code still defaults to `1`. `schemastore-cli` drops its three casts and its local re-typing wrapper. [#726][#726]

### Thanks

Thanks to [@fuleinist](https://github.com/fuleinist) for their contributions!

[#726]: https://github.com/spencerbeggs/effected/pull/726

## 0.4.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.8.0 | 0.9.0 |

## 0.4.0

### Breaking Changes

#### The whole kit tracks Effect `4.0.0-rc.115`

- Every package's `effect` peer moves from `4.0.0-rc.112` to `4.0.0-rc.115`. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it. This advance is the first whose Effect changes are not source-compatible with the previous pin, so a consumer that upgrades meets the same renames the kit did:

- `SchemaTransformation.transformOrFail` and `SchemaGetter.transformOrFail` are `transformEffect`.

- The `Config` constructors are PascalCase (`Config.String`, `Config.Redacted`, `Config.Int`, `Config.Boolean`, …) and `Config.mapOrFail` is `Config.mapEffect`.

- `FileSystem.Size` and `FileSystem.SizeInput` are gone in favour of the `ByteSize` module: `File.Info.size` is a `ByteSize`, `File.seek` takes a `bigint`, `read`/`write` return a `number`.

- The fast-check bridge (`effect/testing/FastCheck`, `Schema.toArbitrary`, the `fastCheck` property-test option) is removed in favour of `effect/unstable/arbitrary/Arbitrary`; `it.effect.prop` takes `arbitrary: { runs, size, seed, … }`.

#### `@effected/schemastore` documents are open unless told otherwise

- `Schema.ToJsonSchemaOptions.additionalProperties` became `onExcessProperty: "ignore" | "error"` upstream, and its default now mirrors the decoder's: generated object schemas carry `additionalProperties: true` unless `jsonSchema: { onExcessProperty: "error" }` is passed. `StoreDocument.fromSchema` passes the option through unchanged, so a document that was closed by default at rc.112 is open by default now. Pass `onExcessProperty: "error"` to keep a closed document; a generator that silently disagreed with the decoder it is paired with would be the worse default.

#### `@effected/memfs` seeks before the start of a file fail

- `File.seek` gained a `PlatformError` channel upstream, and memfs now matches Node: a seek whose resulting position would be negative fails with `BadArgument` ("Cannot seek before the start of the file") and leaves the cursor unchanged, where it previously stored the negative position and failed on the next read. No memfs-declared type changes; the `File`/`File.Info` shape changes are Effect's own, reaching consumers through the peer.

### Documentation

#### A `Schema.Class` root is annotated on the `Struct` it wraps

- [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084), which the rc.112 notes carried as an open limitation, was closed upstream as by design: annotations passed as `Schema.Class`'s second argument sit on the class node, while the `$defs` entry is generated from the encoded fields `Struct`. Annotate that `Struct` — `Schema.Class<X>("X")(Schema.Struct({ … }).annotate({ title, description, "x-taplo": … }))` — and every key reaches the document. `@effected/schemastore`'s design doc and context files now state the rule instead of the limitation.

#### The Claude Code and Copilot plugins teach the rc.115 surface

- The `effect-v4-schema`, `effect-v4-testing` and `effect-v4-module-index` skills describe the native `Arbitrary` module in place of the fast-check bridge, including the migration traps met on this advance: the `size` clamp (default 10) that silently shrinks a property's string and array domains, the `-0` the generator's near-zero bias emits for an unbounded `Schema.Int` or any `Schema.Number`, which JSON and YAML cannot round-trip, and the absence of `oneof`/`constantFrom`/`array` combinators. `ByteSize` has a module-index row, the `Config` and CLI constructors are shown in their PascalCase spellings, and the session-start briefing reports rc.115 as the kit's pin. [#686][#686]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.7.1 | 0.8.0 |
| @effect/platform-node | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| @effect/tsgo | devDependency | updated | 0.41.0 | 0.45.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| effect | devDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| effect | peerDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#686]: https://github.com/spencerbeggs/effected/pull/686

## 0.3.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.6.0 | 0.7.0 |

## 0.3.0

### Breaking Changes

#### `@effected/schemastore` no longer ships `AnnotationCarriers`

- `AnnotationCarriers` and `CarrierDepthExceededError` are removed, and the module is deleted.

- Effect `4.0.0-rc.112` ("Make JSON Schema dialect conversions preserve custom keywords") changed the Draft-07 lowering to carry unknown and custom keywords through as opaque values, in place — including across the tuple coordinate moves (`prefixItems[i]` to `items[i]`, and a trailing `items` to `additionalItems`). The post-lowering re-graft those symbols performed is therefore redundant, and **emitted documents are unchanged**.

- If you imported either symbol, delete the call: annotate a schema node and the key now reaches the document on its own.

#### `StoreDocument` and `SchemaPipeline` error channels are wider

- `StoreDocument.fromSchema`, `StoreDocument.fromSchemaResult`, and `SchemaPipeline.run` / `check` / `runOne` / `checkOne` can now fail with `UndeclaredAnnotationKeyError`. Callers matching exhaustively on the error channel need one new branch.

### Features

#### `@effected/schemastore` refuses undeclared annotation keys instead of dropping them

- `StoreDocument.fromSchema` now fails with the new `@public` `UndeclaredAnnotationKeyError` — carrying the document's `$id` and every offending key — when a caller-supplied `includeAnnotationKey` admits a key outside the declared keyword families (the vscode set, `x-taplo`, `x-tombi-*`, `x-intellij-*`, `x-ai-*`).

- Previously such keys were admitted into the Draft 2020-12 document and silently discarded by the Draft-07 lowering, so the package's compatibility guarantee was really a side effect of a dependency's behavior. Since rc.112 no longer discards them, that guarantee is now enforced by the package itself — and enforced loudly, because a caller who asks for a key and silently does not get it has no way to notice.

- Declared families are still admitted unconditionally, regardless of the caller's predicate.

```ts
// Fails: UndeclaredAnnotationKeyError, keys: ["x-custom"]
yield* StoreDocument.fromSchema(schema, {
  $id: "https://example.com/schemas/tool.json",
  jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
});
```

#### The whole kit tracks Effect `4.0.0-rc.112`

- Every package's `effect` peer moves to the new pin. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it.

### Bug Fixes

- `@effected/schemastore`: the `#/definitions` to `#/$defs` `$ref` rewrite no longer descends into declared-family annotation values. A `$ref`-shaped string inside an `x-taplo` or `x-ai-*` payload is opaque advice addressed to a language server, and was being rewritten in transit.
- A known limitation, still open upstream as [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084): a `Schema.Class`'s class-level annotations — `title` and `description` as well as the declared families — never reach the emitted document, because core generates the definition from the class's encoded AST. A hoisted `Schema.Struct` keeps its annotations. Annotate a `Schema.Struct` root instead.

### Documentation

#### The Claude Code and Copilot plugins are Effect v4 only

- The v3-to-v4 migration material is retired: the `effect-migrator` agent and the `effect-v4-construct-map` skill are removed, along with the migration framing that ran through the remaining skills. The facts underneath it are kept, restated as statements of what v4 is rather than what changed.

- The SessionStart briefing now states plainly that an agent's recall of Effect is out of date by construction, and routes it to the specialist agents or the skills rather than to a guess. It also reports whether the repo vendors Effect source at `.repos/effect` and whether that pin matches the kit's — a stale vendored tree is worse than none, because it answers confidently and wrongly.

- Several skill claims were re-measured against rc.112 and corrected, including one whose stated mitigation pointed at the wrong signal: for a zero-collection vitest run it is the `Tests: 0/0 passed` line that lies, while the exit code is honest. [#623][#623]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.5.2 | 0.6.0 |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.2.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.4.2 | 0.5.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.1.0

### Features

- ### New package: `@effected/cli`
  The boundary layer of a command-line program built on `effect/unstable/cli` — how output reaches a human, how a failure is reported, and how a schema issue becomes a sentence. It is **not** a CLI framework: core owns parsing, flags, the command tree and help, and this package must never grow a second one.

  Everything here shares one property: a consumer only discovers the need by shipping bad output to a person. None of it fails a type-check, a test, or a review of the code in isolation.
  ```ts
  import { CliLogger, CliRuntime } from "@effected/cli";
  import { NodeRuntime } from "@effect/platform-node";
  import { Effect, Layer } from "effect";

  const MainLive = Layer.mergeAll(AppLive, CliLogger.layer());

  NodeRuntime.runMain(program.pipe(CliRuntime.reportFailures(), Effect.provide(MainLive)));
  ```
  **`CliLogger`** renders a log record as a plain line and routes `Error`/`Fatal` to stderr. Effect's default logger emits `[00:33:56.619] INFO (#2): message`, which is right for a service being scraped and wrong for a tool someone is watching. It reads the `Console` off the fiber rather than writing to `process.stdout`: `Logger.make` takes a synchronous callback and a `Sink` write is an `Effect`, so `Stdio` is unreachable from a logger — and the reference approach keeps the package platform-free while making the stream split assertable, which a `process.stdout` write is not. `References.LogToStderr` is honoured as a one-way override: it can force everything to stderr, never move an error onto stdout.

  **`CliRuntime.reportFailures`** fixes *where* a failure is reported. A platform `runMain` composes its reporting `tapCause` around the already-provided effect, so an unhandled failure prints through Effect's **default** logger — outside your layers, in the format `CliLogger` exists to replace, on **stdout**. This catches inside the program, renders through your logger, and re-fails carrying `Runtime.errorExitCode` and `Runtime.errorReported`, so the exit code is right and the runtime does not report it twice. No platform import. An error that already carries its own exit code keeps it; an interrupt is left alone.

  **`SchemaIssueRenderer`** and **`ConfigIssueRenderer`** flatten an issue tree to `unknown key at groups.g.cleanup.rulesetz`. Core ships the formatters this wraps, and they are effectively undiscoverable — they live on `SchemaIssue` rather than `SchemaError` or `Schema`, are named `makeFormatter*`, and `SchemaError.message` does not use them, so printing the error hints at nothing. One phrasing is overridden: core's `"Expected no excess property"` describes the schema's rule rather than the user's mistake. Lines are deduplicated, because a union otherwise repeats the same unknown-key line once per branch, burying the lines that say which shapes were allowed.

  `@effected/config-file` is an **optional** peer, consumed only by `ConfigIssueRenderer`, which is a module nothing else imports — so a consumer who does not install it never reaches for it at runtime. [#352][#352]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.3.1 | 0.4.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#352]: https://github.com/spencerbeggs/effected/pull/352
