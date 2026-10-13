---
type: Consumer
title: silk-router-action
description: "The smallest action consumer: decides a workflow run's release phase from the event payload and pending changesets, and is the cleanest evidence of the kit's floor cost."
repository: savvy-web/silk-router-action
status: stable
tags: [ci, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-13T05:33:04Z
sources:
  - id: repo
    resource: "https://github.com/savvy-web/silk-router-action"
integrity:
  generated:
    body: d3150a6f9995eca0
---

# silk-router-action

`savvy-web/silk-router-action` decides which release phase a workflow run
is in — reading the event payload, finding the pull request associated with
a commit, and counting pending changesets — then routes downstream jobs
accordingly.

Its `package.json` dependencies confirm it is the smallest action consumer:
[`@effected/github`](../modules/github.md) and
[`@effected/github-actions`](../modules/github-actions.md), nothing else.
That makes it the cleanest evidence of what the kit's floor costs a small
action. This register was last verified against the local checkout at
`/Users/spencer/workspaces/savvy-web/silk-router-action` on 2026-09-02.

## What it exercises

**The minimum viable wiring.** This action's app-layer file is one
[`@effected/github`](../modules/github.md) client layer and a merge. The
client's config-driven constructor reads through the ambient config
provider that the kit's [action-runtime layer](../interfaces/actions-runtime.md)
installs, so the token resolves from the runner's own input derivation and
stays redacted end to end. The predecessor mutated an `INPUT_TOKEN`
environment variable into `GITHUB_TOKEN` before the runtime started, and
passed a bare string.

**`Layer.orDie` as a choice rather than a workaround.** It survives in the
wiring, but the error it discards is now core's typed config error: no
token configured is a misconfiguration a running action cannot recover
from. Previously it existed to suppress a construction-time client error
whose type was the wrong shape for the condition — the same `orDie`, for an
honest reason.

**Payload reading with an empty requirement channel.** The kit's
[action-environment payload accessor](../interfaces/actions-runtime.md)
resolves the platform at layer construction, so a caller's requirement
channel stays clean. This action previously captured a filesystem service
in a layer body and re-provided it per call to achieve that, with a
comment apologizing for the arrangement.

**One pull-request query, named for its question.** The
[`@effected/github`](../modules/github.md) associated-pull-request lookup
replaced an untyped octokit callback carrying the only `noExplicitAny`
suppression the consumer survey found.

**Core sufficed for the poll.** The release-detection retry is
`Effect.retry` with `Schedule.spaced`, not a kit construct. A hand-rolled
self-recursive retry was expected to need the kit's
[detached-process readiness poll](../interfaces/actions-runtime.md); once
the effect being retried was no longer a cached, re-issued value, core's
own combinators covered it. Worth remembering before designing a kit
member to replace a hand-roll: some hand-rolls exist only because of a
defect elsewhere.

## Where the kit's edge sits

- **Phase routing policy** — which event shape means which phase, and the
  attempt and delay constants. The kit supplies mechanism, not schedule
  values.
- **Changeset parsing** reads through core's `FileSystem`, which is the
  shape the kit asks for even where it owns no construct for changesets
  themselves.
- **The app's own domain schemas, errors and summary content.**

## Open questions

1. **Changeset parsing is independently implemented in three
   repositories** — here, in [silk-release-action](silk-release-action.md),
   and in the internal `systems` repository's changesets engine. No kit
   package owns it, deliberately: changesets are policy. This repository is
   the cheapest evidence that the deferral has a recurring cost, and
   nothing schedules revisiting it.
