---
name: actions-reporting
description: Use when reporting what a GitHub Action or GitHub API caller did — workflow-command logs, a job summary, a GitHub check run, a sticky pull-request comment, or a living markdown document of check state.
when_to_use: check run, job summary, sticky comment, CommentMarker, log group, notice annotation, workflow command, findings table, managed document, check state, ActionLogger, GitHubMarkdown, CheckDocument, PullRequestComment, ReportBuilder, ErrorAccumulator
---

# Actions reporting

One surface — `Effect.log*` or a value a program already has — and four sinks: the runner log (workflow commands), the job summary, a GitHub check run, a sticky pull-request comment. The first two live in `@effected/github-actions` (`ActionLogger`, `WorkflowCommand`, `ActionOutputs`); the last two live in `@effected/github` (`CheckRun`, `PullRequestComment`). A GFM writer, a marker-delimited document primitive, and a debounced check-state reconciler sit between "a value my program has" and the comment/description sinks.

For the general `Effect.log*`/span rules every package follows, see `effect-v4-observability`; for `Context.Service`/`Layer` mechanics, see `effect-v4-services-layers`; for the rest of the runtime, see `actions-runtime`; for inputs and the rest of `ActionOutputs`, see `actions-inputs-outputs`; for `Redacted` and masking mechanics, see `actions-state-and-secrets`; for the REST/GraphQL client itself, see `github-api`; for test doubles, see `testing-actions`.

## What you have

| Construct | Import | Reach for it when |
| --- | --- | --- |
| `ActionLogger.group` / `.withBuffer` / `.notice` / `.annotated` | `import { ActionLogger } from "@effected/github-actions"` | grouping log output, holding a quiet-green transcript, or attaching source annotations to `Effect.log*` |
| `WorkflowCommand` | same | rendering a command's exact wire text with no runner or service — mostly internal |
| `ActionOutputs.summary` / `.setSecret` | `import { ActionOutputs } from "@effected/github-actions"` | writing the job summary, or masking a value in the runner's log filter |
| `CheckRun.withCheckRun` / `.create` / `.update` / `.complete` | `import { CheckRun } from "@effected/github"` | creating, updating or reaching a terminal state on a GitHub check run |
| `PullRequestComment.upsert` / `CommentMarker` | `import { PullRequestComment, CommentMarker } from "@effected/github"` | posting or updating a sticky, marker-findable PR comment |
| `GitHubMarkdown.table` / `.tableFor` / `.heading` / … | `import { GitHubMarkdown } from "@effected/github-actions"` | rendering GFM fragments — a findings table, a heading, a code block |
| `ManagedDocument` | `import { ManagedDocument } from "@effected/github-actions"` | maintaining marker-delimited regions inside text a human also edits |
| `CheckDocument` / `CheckState` / `projectCheckState` | `import { CheckDocument, CheckState } from "@effected/github-actions"` | reconciling changing check state onto one living document, push-based |

## Standards

- **Design reporting on one stack.** `GitHubMarkdown`, `CheckState`, `CheckDocument` and `ManagedDocument` cover check runs, sticky comments and PR descriptions together — reach for a shim only when the installed kit genuinely lacks a piece, never a hand-rolled namespace object duplicating what the stack already covers.
- **Write the logging contract deliberately: a run-context opening block, a `Step: X — SKIPPED: <reason>` line for every skipped step (never silence), warnings reserved for acceptance signals rather than routine status, and a closing result block.** Enforce it with a test that asserts on the captured log stream — the log *is* the decision record a later reader trusts.
- **Reuse `ActionLogger.annotated` for source annotations rather than spelling a runner variable name by hand.** The readable field names (`startLine`, `endLine`, …) are this package's vocabulary; only `WorkflowCommand`'s private mapper turns them into GitHub's wire abbreviations.
- **Let `CheckRun.withCheckRun`'s bracket reach a terminal state; call `conclude` when the verdict isn't a plain pass/fail.** The bracket always concludes from the `Exit` unless `use` records a verdict — that's how `neutral`, `timed_out`, `action_required` and `skipped` become reachable without dropping to a raw `create`/`complete` pair.
- **Treat check-run output and comment payloads as budgeted, at design time.** `CheckRunOutput`'s 65535-byte cap is automatic on every `update`/`complete`, but a program that assembles a large findings table should design its own truncation rather than discover the cap at runtime.
- **Follow the five managed-section rules for any sticky comment or PR description**: write the running state before doing the work, never blank a section, sha-stamp staleness, keep sections independent, write monotonically. See `references/managed-sections.md`.
- **Reach for `Effect.partition` instead of a hand-rolled accumulator when fanning out over a collection.** It runs every effect and never fails, separating successes from failures in one call.

## Footguns

- `Info`-level logs are deliberately plain text with no workflow command — prefixing every informational line would turn it into an annotation in the workflow summary. There is no ANSI/colour API to reach for either; GitHub's log viewer colours the commands itself.
- `isDebug` alone does not lower the ambient minimum log level — a program that wants `Effect.logDebug` calls to actually fire still has to wire it into `MinimumLogLevel` itself. See `actions-runtime`'s logging reference.
- Passing a bare object literal where a `CheckRunOutput` is expected fails to compile with an error naming a missing `truncated` property — that's the instance method, not a data field; construct through `CheckRunOutput.make` instead. See `references/check-runs-and-comments.md`.
- `find`ing a marked PR comment must paginate — a single-page lookup silently misses a marker past the first page on a busy pull request and duplicates the comment on every `upsert`. See `references/check-runs-and-comments.md`.

## Additional resources

- [references/check-runs-and-comments.md](references/check-runs-and-comments.md) — the full `CheckRun` bracket contract (terminal-state guarantee, `conclude`'s four properties, the explicit-call alternatives), `CheckRunOutput`'s truncation and construction traps, and `PullRequestComment`'s full member table with the pagination fix. Load when: creating, updating or completing a check run, or reading/writing a sticky pull-request comment.
- [references/logging-contract.md](references/logging-contract.md) — the run-context block, skip-reason line convention, and the log-stream test pattern that enforces a logging contract as executable rather than aspirational. Load when: designing or reviewing an action's log output as a decision record.
- [references/managed-sections.md](references/managed-sections.md) — the five managed-section rules in full, `ManagedDocument`'s region-replacement contract and its structural error taxonomy, and the payload-budget design step for check output and comment bodies. Load when: building a sticky comment, a managed PR description, or any document a human and an action both write to.
