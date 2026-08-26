---
status: current
module: effected
category: architecture
created: 2026-08-21
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 90
related:
  - architecture.md
  - releases.md
  - package-setup.md
  - packages/pnpm-plugin-effect.md
---

# Catalog sync automation

## Overview

The kit publishes its own version surface — the `effected` / `effected:peers` catalogs described in [pnpm-plugin-effect.md](packages/pnpm-plugin-effect.md#the-effected-catalog-the-kits-own-version-surface) — and this is the machinery that keeps that surface current without a human remembering to. A pull request to `main` — or to `changeset-release/main`, which is what puts the sync in the release path rather than only in hygiene — resolves every catalogued package's **next release** version from the workspace, rewrites the catalog literal, writes one changeset and commits to `main`. The Effect catalogs are not in scope: those advance through the user-run `pnpm:up` / `pnpm:export` flow, which the automation never touches.

## The pieces

- `lib/scripts/catalog-sync.ts` — the `catalog:sync` and `catalog:check` entry points, wired as root `package.json` scripts and covered by `__test__/catalog-sync.test.ts`.
- `.github/workflows/catalog-sync.yml` — the job itself: triggered by pull requests, it reads and repairs the catalog on `main` and reports a `Catalog Sync` check run.
- `packages/pnpm-plugin-effect/turbo.json` — the build-input override that makes turbo see the version sources the plugin's build actually reads.
- `packages/pnpm-plugin-effect/savvy.build.ts` — the catalog literal the CLI rewrites. Membership is checked in two independent places: the gate in `lib/scripts/catalog-sync.ts`, and `packages/pnpm-plugin-effect/__test__/catalog.test.ts` (see [Membership is not the CLI's question](#membership-is-not-the-clis-question)).
- `.github/workflows/release.yml` — carries `catalog:check` as the release's [`on-build` gate](#the-release-gate).

## The CLI is the only writer

`rolldown-pnpm-config upgrade --yes` resolves each `source: "workspace"` entry against the local workspace and rewrites the literal in place. **Builds never write.** An earlier revision of the seam rewrote the config from the build's freeze path, which made every developer's `build:dev` and every CI build mutate the repo; the writer is a script a human or a workflow invokes deliberately, and nothing else.

## Membership is not the CLI's question

`rolldown-pnpm-config upgrade` walks the catalog **literal**. It answers one question — *are the versions of the packages the catalog already names current* — and it is correct about that. It never asks whether every publishable package is named at all, because a package absent from the literal is not something a walk of the literal can see.

So for a newly added package, `--check` reports **"Catalogs are in sync"** on a tree whose catalog is incomplete. That is not a bug in the CLI; it is a successful-looking answer to a question that was never evaluated, which is this document's recurring failure class in a new place.

It has happened. `@effected/schema-org` reached a release branch absent from the catalog while `catalog:check` stayed green. The only thing that caught it was `catalog.test.ts`, which computed membership **separately** — so the tool that could see the gap was not the tool the gate ran, and the two disagreed without either being wrong.

**The fix is to make the gate ask the question.** `lib/scripts/catalog-sync.ts` computes membership itself — `catalogMembers`, `publishablePackages`, `missingFromCatalog` — reading the literal as source text the same way the CLI does, and fails on a gap.

`catalog.test.ts` keeps its own derivation rather than importing that one, and the redundancy is deliberate. The two live in different TypeScript projects: the root config cannot see a package's files, and the package's `rootDir` cannot see the root's, so sharing a function means widening a tsconfig. Two independent checks of one rule is worth more than the coupling that would remove one of them — the original defect was never that the two disagreed, it was that only one of them was asking.

Two behaviours follow, and both are deliberate:

- **`check` fails on a membership gap even when the CLI is green.** Its exit code becomes non-zero and it prints which packages are missing and how to add them.
- **`sync` refuses before it runs.** A sync that upgraded versions while a package was missing entirely would write a changeset and commit, reporting success for a catalog that is still incomplete.

**The sync cannot close the gap itself, and should not try.** Adding an entry means choosing a range, a peer range and a strategy for a package whose next release version is a judgement — for a first release it is not derivable from a workspace at all. The script therefore reports the gap with the exact instruction, and a human writes the entry inline at the `PnpmConfigPlugin(...)` call site. Publishability is `publishConfig.access === "public"`, never `private === false`: every source manifest here is private, so a check written against `private` reports an empty set and passes every comparison it appears in.

## Ripple bumps are not the CLI's question either

The upgrade CLI resolves a `source: "workspace"` entry from the package manifest plus the **pending changesets**. A package that changesets bumps only as a **dependency ripple** carries no changeset naming it, so the CLI leaves it where it is — and the catalog goes stale the moment the release branch bumps it.

This is the version half of the same failure the [membership section](#membership-is-not-the-clis-question) describes, and it bit for real: at the `release: 7 packages` commit, the catalog named `@effected/sbom` `^0.4.3` and `@effected/workspaces` `^0.18.2` against packages the release had already moved to `0.4.4` and `0.18.3`. Both were ripples off `package-json` and `spdx`. It is reliably wrong on the one branch where the catalog matters most.

It was also self-concealing in the way this document keeps describing: the catalog-sync **workflow** checks out `ref: main`, so it reported *pass* on the very release PR whose branch was drifted. Both answers were right about different trees.

**`changeset status --output` already computes the true plan, ripples included**, so the sync asks it rather than reimplementing changesets' dependency resolution. `check` fails on ripple drift even when the CLI is green; `sync` rewrites the affected entries' `range` and floors the `peer` patch per `lock-minor`. An unreadable plan is not fatal — the CLI's own resolution still covers every directly-bumped package, so the behaviour degrades to what it was rather than failing a sync that is otherwise correct.

The alternative was re-syncing after `changeset version` in the release workflow, which is where the ripple versions first become concrete. It was rejected because that workflow lives in another repository, and because a sync run there writes a changeset that re-versions the release already in flight — the circularity recorded in effected#542.

## Two output modes, two audiences

`catalog:sync` runs the CLI with `--json`. That document is used for **reporting** which entries moved. Whether the catalog moved at all is decided by diffing `savvy.build.ts` around the invocation, because the file is the artifact that matters and a diff of it cannot disagree with itself. The split is deliberate: a change in the CLI's JSON shape degrades the log line rather than the verdict.

`catalog:check` deliberately stays on the CLI's **text** output. It is the gate, and its stdout is what a human reads in the run log behind a red check — that should be the drift list, not a JSON blob. Nothing parses it: the [release gate](#the-release-gate) keys on the exit code alone.

## Catalog entries hold next-release versions

The catalog resolves what each package's **next published version will be**, not what is on the registry now, so a pending `patch` changeset moves that package's entry up a patch with no manifest edit anywhere. Two consequences:

- `.changeset/**` is a real version source. The plugin's `turbo.json` restates the root `inputs` list plus `$TURBO_ROOT$/packages/*/package.json` and `$TURBO_ROOT$/.changeset/**` on **both** `build:dev` and `build:prod`, because the plugin's build reads versions from outside its own directory and turbo's defaults do not describe that.
- The `lock-minor` strategy floors peer patches, so a first sync normalizes a peer like `^0.11.1` down to `^0.11.0`. **That diff is correct, not drift** — do not "repair" it back.

### The publish ordering the catalog imposes

**Consumers take their `@effected/*` ranges from the published catalog, not from a manifest here** — which makes the sync a *release step*, not merely hygiene. Publishing a wave without running `catalog:sync` leaves the catalog naming the previous versions, so a downstream that unlinks its local overrides resolves a registry copy **without the new API**, on ranges that look satisfied. It is green the whole way and wrong at the end, which is this document's recurring failure class in its most expensive form: the consumer discovers it as a missing export in CI, one repo away from anything that could explain it.

The correct order is therefore **changesets → `catalog:sync` → release**. Stated as an ordering rather than a checklist item because the middle step is the one with no local symptom: skipping it breaks nothing in this repo, and nothing in this repo will ever tell you.

**The chain does not end at the registry — it ends in the consumer's resolved tree, and the last link is theirs.** A consumer's `@effected/*` ranges come from the catalog; the catalog ships *inside* `@effected/pnpm-plugin-effect`; and that plugin is typically a pnpm **config dependency pinned by hash** in the consumer's own `pnpm-workspace.yaml`. So a consumer can be holding a stale catalog long after a correct one publishes:

| check | answer |
| --- | --- |
| the packages published at the new versions | TRUE |
| the published plugin's catalog names them | TRUE |
| the consumer's tree resolves them | **FALSE** |

Both green checks are observations of the *artifact*; only the third is about the tree that actually installs. A downstream that drops its local `file:` overrides after a verified-correct release can reinstall straight back onto the previous versions, with none of the new API, because its `configDependencies` pin still names the previous plugin build. The fix is to bump that pin — version **and** integrity — and reinstall.

Two consequences worth holding. **A release mail cannot warn about this**, because the stale object lives in the consumer's repository, not in anything the upstream publishes or can see. And **the terminal verification is the resolved tree**, not the registry — `require('./node_modules/@effected/<pkg>/package.json').version` after installing, or grepping an adopted symbol out of the installed `.d.ts`. Treating "the published catalog names `^X`" as the last check is one step short.

**CI enforces that ordering — do not re-derive it as a manual step.** The workflow triggers on PRs to `main` *and to `changeset-release/main`*, so opening the release PR is itself the trigger: the job syncs, writes `.changeset/catalog-sync.md`, and the release PR picks up the resulting plugin bump before anything publishes. The catalog cannot publish out of step with the packages it names.

That guarantee is easy to miss, and missing it is expensive in the other direction: a maintainer who believes the sync is theirs to remember will offer a downstream a promise CI already keeps better, and will treat a release as blocked on a command nobody needs to run. Two properties of the job make it look manual when it is not — it checks out `ref: main` and commits to `main` rather than to the PR head, so a feature branch's pending changesets reach the catalog only once merged and its PR shows no catalog diff; and its check run reports **failure** when it found drift and repaired it, which reads as a broken sync rather than a working one.

## Workflow mechanics worth not re-deriving

- **Change detection is `git status --porcelain`, never `git diff --quiet`.** `catalog:sync` writes both the rewrite and `.changeset/catalog-sync.md`, and that changeset is untracked on a first run. `git diff` cannot see an untracked file, so it would report no change on exactly the run that had one to propose — a green check that did nothing, which is the failure class this design exists to eliminate.
- **The commit is made through `createCommitOnBranch`**, not `git commit` plus `git push`, so GitHub signs it and the bot's commits land verified. It goes straight onto `main`, guarded by `expectedHeadOid` so a concurrent push makes the mutation fail cleanly instead of clobbering. A manual `workflow_dispatch` with `open-pr` takes the branch-plus-auto-merging-PR route instead; because the mutation cannot force-push, that path resets the branch pointer to the base tip first, and moving a ref creates no commit, so nothing unsigned enters history.
- **The changeset has a fixed name.** Repeated runs overwrite one file rather than accumulating a pile of identical patch bumps.
- **Biome runs scoped to the rewritten file only**, so an unfixable lint diagnostic elsewhere in the repo cannot abort the job.
- **The verification run disables coverage.** This repo's vitest config enforces global thresholds a single-package subset run cannot meet, and the job would abort on them rather than on a real failure.

## The reported check run

The job's outcome is published as a **`Catalog Sync` check run**, written once, in a single `if: always()` step that already holds the conclusion. Every decision in that step is load-bearing.

- **One write, never create-early-then-complete-late.** A run opened as `in_progress` and closed by a later step stays `in_progress` **forever** whenever the job is cancelled or dies before reaching that step — and a hung check is indistinguishable from a slow one, with nothing timing it out. A run that is only ever written once cannot hang.
- **The head SHA, never `github.sha`.** On a `pull_request` event `github.sha` is the ephemeral merge commit; a check run posted there does not appear in the PR's own status list and no branch-protection rule keyed on the check can see it, so the gate silently never applies. The step uses `github.event.pull_request.head.sha` and falls back to `github.sha` for `workflow_dispatch`. This is the same merge-ref blindness that makes head-scoped check *queries* lie.
- **The conclusion is `catalog:check`'s exit code, and that step runs BEFORE the sync.** This is the fix for the defect that prompted the work: the job ran only `catalog:sync`, which repairs drift and then exits 0, so it reported success on a branch whose catalog was wrong. A check run placed after the mutation is worthless for the same reason — by then the catalog is in sync by construction. The gate is the read-only `catalog:check`, run first, with `continue-on-error: true` so its exit code survives as a signal while the remediation below still runs.
- **Read `steps.catalog-check.outcome`, never `.conclusion`.** `continue-on-error` rewrites `conclusion` to `success`; `outcome` is the step's real result. Reading the wrong one reports green on exactly the drift runs the gate exists to catch.
- **A repaired catalog still reports `failure`.** The check answers "was the catalog correct at this ref", not "did the automation cope". A run that silently fixes drift teaches nobody that the drift happened, and the summary says the repair landed and names the commit, so the failure is informative rather than obstructive. It goes green on a re-run once the sync commit is in the branch.
- **`catalog:check` reporting drift while `catalog:sync` rewrites nothing is its own failure**, distinctly worded: the two halves disagree, so one is broken, and neither answer may be treated as a clean catalog.
- **The run link lives in the summary, not `details_url`.** GitHub silently ignores `details_url` on a check run created with the Actions `GITHUB_TOKEN` and substitutes the check run's own URL, so passing it yields a check with no route back to the log explaining it. Verified on a live run rather than taken from the docs.

The step also exits non-zero on a failing conclusion, so the outcome is visible whether a consumer keys on the reported check run or on the job's own status. Writing the run needs `checks: write`, taken on `GITHUB_TOKEN` rather than the App token so the App's grants do not have to change. The commit URL reaches it as a **step output** (`steps.commit.outputs.commit-url`) rather than only as stdout, because the conclusion depends on whether a commit actually happened and stdout is not readable from a later step.

**Fork PRs skip the job rather than failing it.** A `pull_request` from a fork gets no secrets, so the App-token step cannot mint a token and the job dies at step 1 with an opaque credential error, having never looked at the catalog. Skipping is also the safer semantic: the remediation path commits straight to `main`, which a fork PR must never be able to reach for. This is the only workflow in the repo that runs on `pull_request` **and** depends on `secrets`, which is why the guard is local rather than shared.

## The release gate

`catalog:check` is also wired as a release gate: `.github/workflows/release.yml` passes `on-build: pnpm catalog:check` to the reusable org workflow, so a drifted catalog fails the release's validation phase. The contract there is **exit-code only** — the gate's non-zero exit is the whole signal and stderr is not inspected — which is why `catalog:check` may keep its human-readable text output without the gate trying to parse it.

Two independent defences therefore cover the same drift: this gate blocks a release that would publish a stale catalog, and the pull-request sync above repairs `main` before the release PR gets there. Neither makes the other redundant — the gate cannot fix anything, and the sync does not block anything.
