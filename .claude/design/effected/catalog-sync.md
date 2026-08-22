---
status: current
module: effected
category: architecture
created: 2026-08-21
updated: 2026-08-21
last-synced: 2026-08-21
completeness: 85
related:
  - architecture.md
  - releases.md
  - package-setup.md
  - packages/pnpm-plugin-effect.md
---

# Catalog sync automation

## Overview

The kit publishes its own version surface — the `effected` / `effected:peers` catalogs described in [pnpm-plugin-effect.md](packages/pnpm-plugin-effect.md#the-effected-catalog-the-kits-own-version-surface) — and this is the machinery that keeps that surface current without a human remembering to. A push to `main` resolves every catalogued package's **next release** version from the workspace, rewrites the catalog literal, writes one changeset and opens an auto-merging PR. The Effect catalogs are not in scope: those advance through the user-run `pnpm:up` / `pnpm:export` flow, which the automation never touches.

This design came out of a cross-repo programme with `savvy-web/systems` and `spencerbeggs/rolldown-pnpm-config`. The originating spec lived under `docs/superpowers/`, which is gitignored here, so this document — not that spec — is the durable record.

## The pieces

- `lib/scripts/catalog-sync.ts` — the `catalog:sync` and `catalog:check` entry points, wired as root `package.json` scripts and covered by `__test__/catalog-sync.test.ts`.
- `.github/workflows/catalog-sync.yml` — the push-to-`main` job, modeled on `update-runtime-defaults.yml`.
- `packages/pnpm-plugin-effect/turbo.json` — the build-input override that makes turbo see the version sources the plugin's build actually reads.
- `packages/pnpm-plugin-effect/savvy.build.ts` — the catalog literal the CLI rewrites; `packages/pnpm-plugin-effect/__test__/catalog.test.ts` pins its membership.

## The CLI is the only writer

`rolldown-pnpm-config upgrade --yes` resolves each `source: "workspace"` entry against the local workspace and rewrites the literal in place. **Builds never write.** An earlier revision of the seam rewrote the config from the build's freeze path, which made every developer's `build:dev` and every CI build mutate the repo; the writer is a script a human or a workflow invokes deliberately, and nothing else.

## Two output modes, two audiences

`catalog:sync` runs the CLI with `--json`. That document is used for **reporting** which entries moved. Whether the catalog moved at all is decided by diffing `savvy.build.ts` around the invocation, because the file is the artifact that matters and a diff of it cannot disagree with itself. The split is deliberate: a change in the CLI's JSON shape degrades the log line rather than the verdict.

`catalog:check` deliberately stays on the CLI's **text** output. It is the release gate, and its stdout becomes the message a human reads on a red check — that should be the drift list, not a JSON blob.

## Catalog entries hold next-release versions

The catalog resolves what each package's **next published version will be**, not what is on the registry now, so a pending changeset moves an entry with no manifest edit anywhere — an unreleased `patch` for `@effected/workspaces` moved it from `^0.17.0` to `^0.17.1` on its own. Two consequences:

- `.changeset/**` is a real version source. The plugin's `turbo.json` restates the root `inputs` list plus `$TURBO_ROOT$/packages/*/package.json` and `$TURBO_ROOT$/.changeset/**` on **both** `build:dev` and `build:prod`, because the plugin's build reads versions from outside its own directory and turbo's defaults do not describe that.
- The `lock-minor` strategy floors peer patches, so a first sync normalizes a peer like `^0.11.1` down to `^0.11.0`. **That diff is correct, not drift** — do not "repair" it back.

## Workflow mechanics worth not re-deriving

- **Change detection is `git status --porcelain`, never `git diff --quiet`.** `catalog:sync` writes both the rewrite and `.changeset/catalog-sync.md`, and that changeset is untracked on a first run. `git diff` cannot see an untracked file, so it would report no change on exactly the run that had one to propose — a green check that did nothing, which is the failure class this design exists to eliminate.
- **The commit is made through `createCommitOnBranch`**, not `git commit` plus `git push`, so GitHub signs it and the bot's commits land verified. The mutation cannot force-push, so the job resets the branch pointer to the base tip first; moving a ref creates no commit, so nothing unsigned enters history.
- **The changeset has a fixed name.** Repeated runs overwrite one file rather than accumulating a pile of identical patch bumps.
- **Biome runs scoped to the rewritten file only**, so an unfixable lint diagnostic elsewhere in the repo cannot abort the job.
- **The verification run disables coverage.** This repo's vitest config enforces global thresholds a single-package subset run cannot meet, and the job would abort on them rather than on a real failure.

## Not wired: the release gate

`catalog:check` exists and is tested, but **nothing runs it on release yet**. The intended wiring is an `on-build: pnpm catalog:check` input to the reusable release workflow, and effected calls `spencerbeggs/.github/.github/workflows/release.yml@main`, which has no `on-build` passthrough. The input has to be added in the two org workflow files first: adding it to this repo's `with:` block ahead of that fails workflow validation on **every** release run, not just the one that would have used it. Until then, drift is caught by the push-to-`main` sync rather than blocked at the gate.
