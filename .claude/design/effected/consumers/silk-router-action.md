---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 88
related:
  - README.md
  - ../packages/github.md
  - ../packages/github-actions.md
---

# silk-router-action

## Overview

`/Users/spencer/workspaces/savvy-web/silk-router-action` decides which release phase a workflow run is in — reading the event payload, finding the pull request associated with a commit, and counting pending changesets — then routes downstream jobs accordingly.

It is the smallest action consumer: `@effected/github` and `@effected/github-actions`, nothing else. That makes it the cleanest evidence of what the kit's floor costs a small action.

## What it exercises

**The minimum viable wiring.** `src/layers/app.ts` is one client layer and a merge. `GitHubClient.layerFromConfig({ name: "token" })` reads through the ambient `ConfigProvider` that `ActionRuntime.layer` installs, so the token resolves from the runner's own input derivation and stays `Redacted` end to end. The predecessor mutated `process.env.INPUT_TOKEN` into `GITHUB_TOKEN` before the runtime started, and passed a bare string.

**`Layer.orDie` as a choice rather than a workaround.** It survives in the wiring, but the error it discards is now core's `ConfigError`: no token configured is a misconfiguration a running action cannot recover from. Previously it existed to suppress a construction-time client error whose type was the wrong shape for the condition — the same `orDie`, for an honest reason.

**Payload reading with an empty requirement channel.** `ActionEnvironment.payload` resolves the platform at layer construction, so a caller's `R` stays clean. This action previously captured `FileSystem` in a layer body and re-provided it per call to achieve that, with a comment apologizing for the arrangement.

**One pull-request query, named for its question.** `PullRequest.listAssociatedWithCommit` replaced an untyped octokit callback carrying the only `noExplicitAny` suppression the consumer survey found.

**Core sufficed for the poll.** The release-detection retry is `Effect.retry` with `Schedule.spaced`, not a kit construct. A hand-rolled self-recursive retry was expected to need `DetachedProcess.awaitReady`; once the effect being retried was no longer a cached, re-issued value, core's own combinators covered it. Worth remembering before designing a kit member to replace a hand-roll: some hand-rolls exist only because of a defect elsewhere.

## Where the kit's edge sits

- **Phase routing policy** — which event shape means which phase, and the attempt and delay constants. The kit supplies mechanism, not schedule values.
- **Changeset parsing** (`src/steps/parse-changesets.ts`) — reads through core's `FileSystem`, which is the shape the kit asks for even where it owns no construct.
- **The app's own domain schemas, errors and summary content.**

## Open questions

1. **Changeset parsing is independently implemented in three repositories** — here, in silk-release-action and in savvy-web/systems' changesets engine. No kit package owns it, deliberately: changesets are policy. This repo is the cheapest evidence that the deferral has a recurring cost, and nothing schedules revisiting it.
