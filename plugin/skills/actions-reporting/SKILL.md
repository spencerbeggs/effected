---
name: actions-reporting
description: Use when reporting what a GitHub Action or GitHub API caller did — pretty workflow-command logs (log groups, buffered step output, notice, warning and error annotations), a job summary, a GitHub check run, or a sticky pull-request comment. Covers ActionLogger (group, withBuffer, notice, annotated) and the Effect log-level → workflow-command mapping in @effected/github-actions, WorkflowCommand as the low-level `::name key=value::message` protocol, ActionOutputs.summary, and @effected/github's CheckRun (create/update/complete/withCheckRun, CheckRunOutput's 65535-byte truncation, Annotation) and PullRequestComment (upsert/find/create/delete with a CommentMarker). States plainly that GithubMarkdown, ReportBuilder and ErrorAccumulator have no kit successor — report shaping is consumer policy and fan-out-and-accumulate is Effect.partition. Trigger phrases — check run, job summary, sticky comment, CommentMarker, log group, notice annotation, workflow command.
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
(`packages/github-actions/src/ActionLogger.ts:271-277`), maps every log entry
onto a workflow command by level:

| Effect log level | Rendered as |
| --- | --- |
| `Error`, `Fatal` | `::error::` (with any source annotation) |
| `Warn` | `::warning::` (with any source annotation) |
| `Info` | plain text — no command, no annotation |
| `Debug`, `Trace` | `::debug::` |

(`renderEntry`, `ActionLogger.ts:83-96`; restated in the logger's own TSDoc at
`ActionLogger.ts:264-266`.) `Info` is deliberately plain text: prefixing it
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

(`ActionLogger.ts:244-251`.)

- **`group(name, effect)`** — opens `::group::name`, runs `effect`, always
  closes with `::endgroup::` via `acquireUseRelease`
  (`ActionLogger.ts:184-193`). On a failing cause it flushes whatever
  buffer is currently active *before* the group closes, so a failed step's
  transcript lands inside the collapsed section it belongs to rather than
  after it (`ActionLogger.ts:188-191`).
- **`withBuffer(label, effect)`** — the quiet-green / verbose-red mechanism.
  `Warn` and `Error` entries still go out live, rendered the same way as the
  installed logger; everything `Info` and below is held and flushed on
  **every** exit path, including a defect or interruption, via
  `Effect.onExit` (`ActionLogger.ts:145-155, 195-222`). Buffering is skipped
  entirely — the effect just runs — when the runner has step debugging on
  (`ActionEnvironment.isDebug`, which reads `RUNNER_DEBUG === "1"`,
  `ActionEnvironment.ts:163`) or the ambient minimum log level is already
  `Debug` or lower (`ActionLogger.ts:197-201`): someone who asked for verbose
  output gets it live, not replayed at the end.
- **`notice(message, properties?)`** — emits `::notice::`
  (`ActionLogger.ts:157-163, 224-225`). A dedicated member, not a log level,
  because Effect has no level between `Info` and `Warn` to map a notice onto.
- **`annotated(properties, effect)`** — attaches source annotations
  (`title`, `file`, `startLine`, `endLine`, `startColumn`, `endColumn`) to
  every `Effect.log*` inside `effect`, via `Effect.annotateLogs`
  (`ActionLogger.ts:165-175, 227-228`). The readable field names are this
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
(`ActionLogger.ts:280-311`). `ActionLogger.layerTest(overrides?)` builds the
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

## What does NOT exist

`GithubMarkdown`, `ReportBuilder` and `ErrorAccumulator` have **no kit
successor** — this is a recorded decision, not a gap:

- **`GithubMarkdown`** was a string builder with no Actions coupling; it
  belongs to whichever consumer wants it
  (`.claude/design/effected/packages/github-actions.md`, line 440). If a
  consumer wants markdown **construction** rather than a one-off string, the
  kit's answer is `@effected/markdown` — see `effected-packages`.
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
