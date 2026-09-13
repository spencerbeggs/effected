# Runbook

* [Add a kit package](add-a-kit-package.md) - The end-to-end cycle for adding a new @effected library — design as an okf Module concept first, then scaffold, build, test, document and advance the package roster.
* [Add a workspace package](add-a-workspace-package.md) - The ordered scaffold procedure for a new packages/X library, with the stub-entrypoint-before-install step that keeps a half-scaffolded package from breaking every pnpm run in the repo.
* [Advance the effect pin](advance-the-effect-pin.md) - Move the whole kit onto a new Effect v4 prerelease, in one coordinated commit sequence.
* [Close a catalog membership gap](close-a-catalog-membership-gap.md) - When catalog:check fails naming a package missing from the effected catalog, add its entry by hand at the PnpmConfigPlugin(...) call site — the tool refuses to guess a first-release range. A ripple-version gap needs no hand edit at all; the next catalog:sync closes it on its own.
* [Design a GitHub Action repository on the kit](design-an-action-on-the-kit.md) - The ordered sequence in which a new action's design decisions are actually forced, from kit-capability recon through documentation refresh.
* [Enable fork pull-request review on a repository](enable-fork-pull-request-review.md) - Add a required-reviewer environment and a pull_request_target trigger so a repository driven by the Silk dispatcher runs full validation on fork pull requests only after a maintainer reads the diff.
* [Link a consumer to an unreleased kit build](link-a-consumer-to-an-unreleased-kit.md) - Point an external consumer's manifest at an unpublished @effected build safely, so the consumer resolves one effect instance and no sibling overrides are needed.
* [Regenerate the GitHub Action template repository](regenerate-the-action-template.md) - Bring savvy-web/github-action-template back into conformance with the canonical action shape in one coherent commit, rather than incremental patches that leave the old and new shapes coexisting.
* [Regenerate the runtimes bundled offline defaults](regenerate-runtimes-bundled-defaults.md) - Refresh the three offline version snapshots @effected/runtimes falls back to, from the live release feeds.
* [Regenerate the vendored SPDX datasets](regenerate-spdx-data.md) - The hand-run procedure for refreshing @effected/spdx's license-id, exception and metadata literals after an upstream SPDX release.
* [Regenerate the vendored schema.org vocabulary table](regenerate-schema-org-vocabulary.md) - The hand-run procedure for refreshing @effected/schema-org's interned vocabulary literals after a schema.org release.
* [Release a plugin](release-a-plugin.md) - Cut a version for the Claude Code or Copilot plugin through its private tracking package's changeset, ending in a git tag and GitHub release with no npm publish.
* [Sync the vendored repos](sync-vendored-repos.md) - Materialize the .repos/ submodules' sparse checkouts on a fresh clone, worktree, or CI runner.
