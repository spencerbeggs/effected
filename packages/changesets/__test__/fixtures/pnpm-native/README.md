# pnpm-native oracle fixtures

Each directory is a small pnpm workspace, hand-authored, whose
`expected.json` records what **pnpm 12.20.0** itself answers. They are the
oracle for the pnpm-native release planner, under the same rule as the
Changesets fixtures one level up: the answer is pnpm's, never written by hand.

## How they are recorded

pnpm has no JSON plan. `pnpm change status` prints text only, and
`pnpm version -r --dry-run` prints the text plan whatever `--json` says.
`pnpm version -r --json` gives `[{name, currentVersion, newVersion}]`, but only
on an applied run. So `scripts/record-pnpm-oracle.ts` applies each case to a
throwaway copy:

1. copy the case to a temporary directory outside this repository, with a
   private `HOME` and every `npm_*` / `pnpm_*` variable removed;
2. run `pnpm change status` on the copy (the per-project causes and bumps);
3. run `pnpm version -r --json` on the same copy (the versions, the ledger);
4. write `expected.json`, `status.txt` and `ledger.after.yaml` beside the input.

A case may carry a `prelude.json` of steps (`run` a pnpm command, `write` or
`remove` a file) that the recorder applies in the copy before step 2, so a
pre-state a real workflow produces is produced by pnpm and not typed by hand.
`lane-counter-reset-major` starts at `2.0.0` on lane `alpha`, cuts
`2.1.0-alpha.0` (minor intent) and `2.1.0-alpha.1` (patch intent) with
`pnpm version -r`, then adds the major intent. `lane-graduation` starts at
`2.0.0` on lane `alpha`, cuts `3.0.0-alpha.0` from a major intent with
`pnpm version -r`, then runs `pnpm lane main --filter @p/a` (which removes the
lane); the ledger entry and the intent file left on disk are pnpm's own. The
recorded `status` and `version` then run on that state.

The registry is `http://127.0.0.1:9/` throughout, so no case can reach a real
one. Re-record with `node scripts/record-pnpm-oracle.ts [case ...]` from the
package directory. The recorder resolves the repository's pinned pnpm by path
(a bare `pnpm` outside the repository is the global one, which may differ).

Recorded 2026-11-12 with pnpm 12.20.0, matching the vendored source at
`.repos/pnpm` (v12.20.0). Temporary paths in recorded messages and in
`status.txt` are replaced by `<workspace>`.

## `expected.json`

| Key | Meaning |
| --- | --- |
| `pnpmVersion` | The pnpm that answered. |
| `case` | The directory name. |
| `outcome` | `applied` when `pnpm version -r --json` succeeded (possibly with no releases), `rejected` when it failed. |
| `releases` | The applied run's JSON in pnpm's order, each `{name, currentVersion, newVersion, bump, causes}`. `bump` and `causes` come from `pnpm change status` (`bump` is the intent-derived bump, which can be `major` while the version moves to a prerelease or does not move at all); `causes` is a subset of `intent`, `dependencies`, `fixed`, `epic`, in pnpm's order. Empty when rejected. |
| `ledgerFile` | `ledger.after.yaml`, pnpm's `.changeset/ledger.yaml` after the run, or `null` when rejected. The prelude's own ledger is never committed; only the final one. |
| `statusFile` | `status.txt`, the raw `pnpm change status` text (or its error). |
| `statusUnparsed` | Release-plan lines the recorder could not parse; empty in every case. |
| `errors` | One `{stage, exitCode, code, message}` per failing command (`stage` is `status` or `version`); `code` is the `ERR_PNPM_*` code. Empty when applied. |

## Cases

| Case | pnpm's answer |
| --- | --- |
| `ticket-probe` | `@p/a` on lane `alpha` with a `./packages/b` directory key in the same intent: `1.0.0` + minor -> `1.1.0-alpha.0`; `b` `0.1.0` -> `0.1.1`. |
| `lane-counter-reset-major` | `2.1.0-alpha.1` (built by the prelude) + major -> `3.0.0-alpha.0`: the counter resets when the stable target changes. |
| `lane-graduation` | `3.0.0-alpha.0` back on `main` -> `3.0.0` (cause `intent`), driven by the half-consumed intent that the prelude leaves behind: its id is in the ledger under the prerelease key and its file is still present. |
| `lane-graduation-no-intent` | The same package with neither intent nor ledger: pnpm plans nothing (`[]`, "No pending changes."). |
| `epic-band-ceiling` | Member at `199.4.0` + major is rejected: `ERR_PNPM_VERSIONING_EPIC_OUT_OF_BAND`. |
| `epic-rebase` | Lead `1.0.0` + major -> `2.0.0`; member `150.2.0` -> `200.0.0`, cause `epic`, bump `major`. |
| `max-bump-exceeded` | `maxBump: minor` with a major intent: `ERR_PNPM_VERSIONING_MAX_BUMP_EXCEEDED`. |
| `ignore-real-bump` | An ignored package with a patch intent: `ERR_PNPM_VERSIONING_UNRELEASABLE_PACKAGE`. |
| `fixed-lockstep` | `1.2.0` + minor in a group with a `1.0.0` member: both -> `1.3.0`; causes `fixed,intent` and `fixed`. |
| `dependents-ripple` | A major on `@p/a` takes a private dependent through `workspace:^`: `@p/b` `1.0.0` -> `1.0.1`, cause `dependencies`. |
| `first-release` | A public package and no reachable registry: it debuts at its manifest version, `1.0.0` -> `1.0.0`, though status still says `minor`. The ledger records the intent as consumed against `@p/a@1.0.0`. |
| `lane-prerelease-caret-dependent` | A minor on a lane package with a `workspace:^` dependent: `@p/a` `1.0.0` -> `1.1.0-alpha.0`, and the dependent ripples, `@p/b` `1.0.0` -> `1.0.1`, cause `dependencies`. A prerelease does not satisfy the materialised `^1.0.0`. |

## Where pnpm differs from what the plan expected

- **Graduation needs the intent.** A package returned to `main` with no pending
  intent and no ledger entry releases nothing. Graduation is the pending intent
  becoming applicable on `main` once its only ledger entry is a prerelease one
  (`lane-graduation`). "No new intent" holds; "no intent at all" does not.
- **A minor on 1.x does not ripple through `workspace:^`** (the first
  `dependents-ripple` draft used a minor and recorded no dependent), so that
  case uses a major.
- **Rejections surface in both commands.** `pnpm change status` and
  `pnpm version -r` fail with the same code and message.
- **Private packages skip the registry check; public ones do not.** A public
  package is the only way to reach first-release semantics, so `first-release`
  is the one public case.
- **What `first-release` proves, and what it does not.** In the pnpm 12.20.0
  CLI that recorded it, a registry that could not be reached left the package
  unpublished, so it debuted. The vendored source does not read that way: the
  probe propagates a send error (`.send().await.into_diagnostic()?`,
  `crates/cli/src/cli_args/changelog.rs:308-310`), and only a 404 is "not
  published". So the case pins "no reachable registry, so it debuts" for the
  binary that ran. The exact-version rule (a package counts as published when
  the registry has its manifest version, `package.versions.contains_key`,
  changelog.rs:322) rests on the source alone; no case reaches a registry.
- **A lane prerelease leaves `workspace:^`.** `1.1.0-alpha.0` does not satisfy
  `^1.0.0`, the range `workspace:^` materialises to, so the dependent ripples
  (`lane-prerelease-caret-dependent`). That settles the prerelease rule from
  pnpm itself, not from npm's range semantics.
