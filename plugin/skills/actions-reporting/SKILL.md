---
name: actions-reporting
description: Use when reporting what a GitHub Action or GitHub API caller did — pretty workflow-command logs (log groups, buffered step output, notice, warning and error annotations), a job summary, a GitHub check run, a sticky pull-request comment, or a living markdown document of check state. Covers ActionLogger (group, withBuffer with its onSuccess flush/discard option, notice, annotated) and the Effect log-level → workflow-command mapping in @effected/github-actions, WorkflowCommand as the low-level `::name key=value::message` protocol, ActionOutputs.summary, the document suite (GitHubMarkdown's GFM writer with tableFor over a row schema, ManagedDocument's marker-delimited regions, the CheckDocument reconciler over the CheckState vocabulary), and @effected/github's CheckRun (create/update/complete/withCheckRun, CheckRunOutput's 65535-byte truncation, Annotation) and PullRequestComment (upsert/find/create/delete with a CommentMarker). States plainly that ReportBuilder and ErrorAccumulator have no kit successor — report shaping is consumer policy and fan-out-and-accumulate is Effect.partition. Trigger phrases — check run, job summary, sticky comment, CommentMarker, log group, notice annotation, workflow command, findings table, managed document, check state.
---

# Actions reporting

One surface — `Effect.log*` or a value your program already has — and four
sinks: the runner log (workflow commands), the job summary, a GitHub check
run, a sticky pull-request comment. The first two live in
`@effected/github-actions` (`ActionLogger`, `WorkflowCommand`,
`ActionOutputs`); the last two live in `@effected/github` (`CheckRun`,
`PullRequestComment`). This skill is the merge of what used to be a logging
skill and a checks/summaries/comments skill — read it as one surface, not two.

For the general `Effect.log*` / span rules every package follows, see
`effect-v4-observability`; for `Context.Service`/`Layer` mechanics, see
`effect-v4-services-layers`; for the rest of the runtime (`Action.run`,
`ActionServices`, `ActionRunOptions.layer`), see `actions-runtime`; for
reading inputs and the rest of `ActionOutputs` (`set`, `setJson`,
`exportVariable`, `addPath`), see `actions-inputs-outputs`; for `Redacted`
and masking mechanics, `actions-state-and-secrets`; for the REST/GraphQL
client itself, `github-api`; for test doubles, `testing-actions`.

## The log sink

### One `Logger` renders every `Effect.log*`

`ActionLogger.logger`, installed via `ActionLogger.layerLogger`
(`packages/github-actions/src/ActionLogger.ts:309-315`), maps every log entry
onto a workflow command by level:

| Effect log level | Rendered as |
| --- | --- |
| `Error`, `Fatal` | `::error::` (with any source annotation) |
| `Warn` | `::warning::` (with any source annotation) |
| `Info` | plain text — no command, no annotation |
| `Debug`, `Trace` | `::debug::` |

(`renderEntry`, `ActionLogger.ts:83-96`; restated in the logger's own TSDoc at
`ActionLogger.ts:270-279`.) `Info` is deliberately plain text: prefixing it
would turn every informational line into an annotation in the workflow
summary (`ActionLogger.ts:79-81`).

**There is no ANSI/colour API, and none exists to invent.**
`WorkflowCommand.render` (`WorkflowCommand.ts:85-96`) emits nothing but the
`::name key=value::message` text — GitHub's own log viewer colours the
commands, not this package.

### `ActionLogger`'s four members

```ts
import { ActionLogger } from "@effected/github-actions";
import { Effect } from "effect";

const program = Effect.gen(function* () {
 const logger = yield* ActionLogger;
 yield* logger.group("install", logger.withBuffer("pnpm", Effect.logInfo("resolving")));
});
```

(`ActionLogger.ts:285-289`.)

- **`group(name, effect)`** — opens `::group::name`, runs `effect`, always
  closes with `::endgroup::` via `acquireUseRelease`
  (`ActionLogger.ts:218-227`). On a failing cause it flushes whatever
  buffer is currently active *before* the group closes, so a failed step's
  transcript lands inside the collapsed section it belongs to rather than
  after it (`ActionLogger.ts:222-225`).
- **`withBuffer(label, effect, options?)`** — the quiet-green / verbose-red
  mechanism. `Warn` and `Error` entries still go out live, rendered the same
  way as the installed logger; everything `Info` and below is held and
  flushed on **every** exit path, including a defect or interruption, via
  `Effect.onExit` (`ActionLogger.ts:185-189, 229-260`).
  `WithBufferOptions.onSuccess: "flush" | "discard"` (default `"flush"`)
  decides only what a **success** is worth in the log: `"discard"` drops the
  transcript on a clean exit — one line per green step — while a failure, a
  defect or an interruption still flushes under either setting
  (`ActionLogger.ts:145-157, 254-258`). Buffering is skipped
  entirely — the effect just runs, overriding `onSuccess: "discard"` too —
  when the runner has step debugging on
  (`ActionEnvironment.isDebug`, which reads `RUNNER_DEBUG === "1"`) or the
  ambient minimum log level is already
  `Debug` or lower (`ActionLogger.ts:231-235`): someone who asked for verbose
  output gets it live, not replayed at the end. **`isDebug` alone does not
  lower that ambient minimum** — a program that wants `Effect.logDebug` calls
  to actually fire (not just render differently once they do) still has to
  wire `isDebug` into `References.MinimumLogLevel` itself; see
  `actions-runtime`'s `isDebug` → `MinimumLogLevel` bridge for the boilerplate.
- **`notice(message, properties?)`** — emits `::notice::`
  (`ActionLogger.ts:190-197, 262-263`). A dedicated member, not a log level,
  because Effect has no level between `Info` and `Warn` to map a notice onto.
- **`annotated(properties, effect)`** — attaches source annotations
  (`title`, `file`, `startLine`, `endLine`, `startColumn`, `endColumn`) to
  every `Effect.log*` inside `effect`, via `Effect.annotateLogs`
  (`ActionLogger.ts:198-209, 265-266`). The readable field names are this
  package's vocabulary; `WorkflowCommand`'s private `annotation` mapper is the
  **only** place they become GitHub's abbreviated wire names (`line`, `col`)
  (`WorkflowCommand.ts:11-24, 133-143`). **`annotated` exists because a
  consumer spelled a runner variable name wrong and shipped it** — no caller
  in this package spells an annotation key by hand
  (`packages/github-actions/CLAUDE.md`, "No caller ever spells a runner
  variable name").

### Test defaults

`ActionLogger.layerSilent` is a bound constant merging a silent service
double with `Logger.layer([])` — **a recorded exception to the die-on-
unstubbed rule**, alongside `ActionEnvironment.makeTest`: a logger that dies
when a suite logs would make every double unusable
(`ActionLogger.ts:318-348`). `ActionLogger.layerTest(overrides?)` builds the
same double with per-member overrides. For the harness patterns these pair
with, see `testing-actions`.

### `WorkflowCommand`: the low-level protocol, touched directly only rarely

`WorkflowCommand` is **pure** — no IO, no service, just string rendering —
which is what makes the escaping testable with no runner and reusable outside
Actions (`WorkflowCommand.ts:54-61`). Members: `render`, `debug`, `notice`,
`warning`, `error`, `group`, `endGroup`, `addMask`
(`WorkflowCommand.ts:85-131`). The escaping order is load-bearing: `%` is
replaced **first**, or a later `\r`/`\n` substitution's own `%` would get
re-escaped (`WorkflowCommand.ts:29-38`). A legitimate reason to reach for it
directly: rendering a command's exact wire text in a unit test with no
runner and no service — which is exactly what `ActionOutputs.setFailed` and
`.setSecret` do internally (`ActionOutputs.ts:125-126`).

### Masking

`ActionOutputs.setSecret(value)` emits `::add-mask::`
(`ActionOutputs.ts:88, 126`), registering the value with the runner's own log
filter so it is redacted in every later line, including ones this package
never touches. `Redacted`, the declassification seam, and cross-phase
secret handling are `actions-state-and-secrets`' subject — this skill stops
at the one workflow command.

## The job-summary sink

`ActionOutputs.summary(content: string): Effect<void, ActionOutputError>`
appends `content` to `GITHUB_STEP_SUMMARY`
(`ActionOutputsShape.summary`, `ActionOutputs.ts:80`; implementation
`ActionOutputs.ts:122`). It shares `ActionOutputError`'s `unavailable` /
`writeFailed` reasons with every other runner-file write
(`ActionOutputs.ts:10-38`). The full `ActionOutputs` member table (`set`,
`setJson`, `exportVariable`, `addPath`, the derived heredoc delimiter) is
`actions-inputs-outputs`' subject; this skill only adds `summary` to the
reporting picture.

## The check-run sink (`@effected/github`)

`CheckRun.withCheckRun(name, headSha, use)` is the bracket form, and it
**always** reaches a terminal state: `use` gets `(id, conclude)`, and the
bracket concludes `success` / `failure` / `cancelled` from the `Exit` unless
`use` recorded a verdict through `conclude`, which wins on every exit path.
That is how the other four conclusions (`neutral`, `timed_out`,
`action_required`, `skipped`: `CheckConclusion`, `CheckRun.ts:7-15`) are
reachable — a findings-derived `neutral` is the motivating case.
`CheckRun.create` / `.update` / `.complete` / `.get` remain the explicit calls
for what the bracket does not fit: multiple updates across a long-running job,
or a run whose id must escape the bracket's scope. `CheckRunOutput`'s
`summary`/`text` fields are **automatically** truncated to GitHub's
65535-**byte** cap on every `update`/`complete` call, and its `annotations`
array to 50 entries — verified in source, not carried over as a remembered
number (`CheckRunOutput.LIMIT_BYTES`/`MAX_ANNOTATIONS`, `CheckRun.ts:58-61`;
applied by `wireOutput`, `CheckRun.ts:228-247`). Full detail, the conclusion
surface and the `PullRequestComment`
recipes: [references/check-runs-and-comments.md](references/check-runs-and-comments.md).

**Load when:** creating, updating or completing a check run, or reading/
writing a sticky pull-request comment.

## The PR-comment sink (`@effected/github`)

`PullRequestComment.upsert(issueNumber, marker, body)` is one call: update
the marker's comment if `find` locates it, otherwise create it
(`PullRequestComment.ts:149-167`). `CommentMarker` (`namespace`, `key`) is a
pure class — no hardcoded vendor string baked into the library — appended to
the body as an HTML comment so the same marker finds the same comment again
(`PullRequestComment.ts:19-34`). Signatures for `create` / `find` / `delete`,
the pagination fix, and the full `CommentMarker` contract: same reference
file as above.

## The document suite (`@effected/github-actions`, added 2026-07-26)

The layer between "a value my program has" and the comment/description sinks
above: a GFM writer, a marker-delimited document, and a debounced reconciler
that projects check state onto one.

### `GitHubMarkdown` — the GFM writer

A pure class of static members — no service, no IO
(`packages/github-actions/src/GitHubMarkdown.ts:196`): `table(headers, rows)`,
`tableFor(schema, options?)`, `heading(text, level = 2)`, `link(text, url)`,
`code(text)`, `codeBlock(content, language?)`, `list(items, { ordered? })`,
`details(summary, body)`, `raw(markdown)`. Fragments are escaped through a
real GFM serializer: `table` escapes pipes and pads short rows, `code` widens
its backtick delimiter, `codeBlock` lengthens its fence. `raw` is the
identity, existing only to *state* that a fragment is already rendered
(`GitHubMarkdown.ts:353-366`).

**`tableFor(schema)` defines a table's columns ONCE, by a row schema**
(`GitHubMarkdown.ts:259-291`): column order is field declaration order, each
header is the field's `title` annotation (fall back: the property name,
overridable per column), and each cell is the field value's **encoded**
string form — a branded field projects through its own codec, so a row can no
longer transpose columns. A field whose encoded side is not a string makes
that column's `format` — and therefore `columns` and `options` — **required
at the type level**. An absent optional field renders as an empty cell. The
returned `GitHubSchemaTable.render(rows)` maps through `table`, so escaping
is inherited and identical rows produce identical output.

### `ManagedDocument` — marker-delimited regions in text a human also edits

The one primitive behind both the sticky PR comment and a managed PR
description (`ManagedDocument.ts:142`): a sentinel HTML comment
(`<!-- namespace:key -->`) identifies the document, each region is delimited
by HTML-comment markers, everything outside a managed region survives
regeneration byte-for-byte, and regions are **replaced from current state,
never appended**. Pure string → string; the region engine is
`@effected/templates`' `SectionDocument`, reused with an HTML-comment
`MANAGED REGION` dialect. Construct with `ManagedDocument.parseResult(source)`
/ `.parse` — create-or-update in one call; absent, empty and sentinel-less
text are all a legal fresh document. Apply with
`.withRegionsResult(entries)` / `.withRegions`; read with `.sentinel`,
`.matches(text)`, `.region(key)`, `.regions`. `ManagedDocumentError.kind`
names four structural parse ambiguities (`unterminatedRegion`, `orphanedEnd`,
`overlappingRegions`, `duplicateRegion`) and two declaration refusals
(`markerInContent`, `duplicateDeclaration`) — each a case where a silent
choice would corrupt content a human wrote (`ManagedDocument.ts:27-63`).
`PullRequestComment`'s `CommentMarker` renders the **same** sentinel for the
same namespace and key, which is what stitches the two packages together.

### `CheckDocument` + `CheckState` — the debounced reconciler

`CheckState` (`CheckState.ts:21-36`) is the kit's check vocabulary —
`running | pass | fail | warn | user_interaction_required | skipped |
timeout`, deliberately wider than GitHub's own conclusions (`running` is a
state, not the absence of a conclusion; GitHub's `cancelled` has no
counterpart on purpose). `projectCheckState` maps each onto the check-run
wire as a discriminated `CheckRunProjection` — `running → in_progress`;
everything else `completed` with `pass → success`, `fail → failure`,
`warn → neutral`, `user_interaction_required → action_required`,
`skipped → skipped`, `timeout → timed_out` (`CheckState.ts:63-99`). A
structural test pins these literals against `@effected/github`'s
`CheckConclusion`, so the pure module keeps octokit off its import graph.

`CheckDocument.layer({ namespace, key, initial?, render, sink, debounce? })`
(`CheckDocument.ts:191-204`) is **push, not pull** — nothing polls GitHub.
Consumers call `report(check, CheckReport.make({ state, title?, outcome?,
detail?, url? }))` as states change (never fails, never blocks; a later
report for the same key replaces the whole entry — resolution is not
terminal), and a background fiber projects the registry onto a
`ManagedDocument` through the pure `render` projection. The write leaves
through the narrow `CheckDocumentSink` (`(rendered) => Effect<unknown,
unknown>`) — `PullRequestComment.upsert`, a PR-body `PATCH` and a test's
recording `Ref` all fit it. The debounce is **trailing with a max-wait,
never leading** (defaults 500 ms quiet / 3 s max); a byte-identical render
issues no write; `flush` reconciles immediately and the layer's finalizer
runs it once more, so a scope closing mid-window cannot strand the final
state. `CheckDocumentError` routes `kind: "render" | "sink"`; a failed
background pass logs and retries on the next report — only `flush` surfaces
the typed error. `layer` mints fresh state per call — bind it to a `const`
if two parts of a program must share one registry.

## What does NOT exist

`ReportBuilder` and `ErrorAccumulator` have **no kit successor** — this is a
recorded decision, not a gap. (The predecessor's `GithubMarkdown` **was**
superseded on 2026-07-26: the `GitHubMarkdown` writer above reverses the
earlier no-successor ruling for markdown construction.)

- **`ReportBuilder`** was report *shaping*, which is consumer policy, not a
  library concern (`.claude/design/effected/consumers/silk-release-action.md`,
  line 95).
- **`ErrorAccumulator`** was fan-out-and-accumulate over a collection, used
  by two consumers with no named kit replacement
  (`.claude/design/effected/consumers/silk-release-action.md`, line 94;
  `silk-sync-action.md`, line 43). The kit answer is **`Effect.partition`**,
  which runs every effect and never fails, separating successes from
  failures instead of short-circuiting on the first one
  (`.repos/effect/packages/effect/src/Effect.ts:529-566`):

```ts
import { Effect } from "effect";

const [failures, successes] = yield* Effect.partition(reports, (report) => publish(report));
```

Two lines, no custom accumulator type, no consumer hand-rolling one again.

Also gone: the emoji vocabulary and decision-log doctrine of the predecessor
plugin. Those were house voice, not API — do not carry them into this kit.

## Pointers

| Skill | Covers |
| --- | --- |
| `actions-runtime` | `Action.run`, `ActionServices`, `ActionRuntime.layer`, `ActionRunOptions.layer` |
| `actions-inputs-outputs` | `ActionInput`, the rest of `ActionOutputs` (`set`/`setJson`/`exportVariable`/`addPath`) |
| `actions-state-and-secrets` | `ActionState`, `Redacted`/`Secret`, cross-phase persistence |
| `github-api` | The octokit-backed REST/GraphQL client itself (`GitHubClient`, `Rest`) |
| `testing-actions` | `layerTest` doubles and harness patterns across `@effected/github-actions` |
| `effect-v4-observability` | The general `Effect.log*` / span rules this package specializes |
| `effect-v4-services-layers` | `Context.Service`/`Layer` mechanics behind every service here |
| `effected-packages` | Package index, including `@effected/markdown` for report construction |
