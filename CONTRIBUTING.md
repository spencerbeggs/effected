# Contributing to effected

Thanks for your interest in the `@effected/*` kit. This repo is a pnpm monorepo of Effect v4 libraries that build and release together. This guide covers setting up a local environment, the build and test pipeline, and the conventions a change has to satisfy before it can merge.

## Prerequisites

- **Node.js 24.11 or newer.** The `engines` field requires `>=24.11.0`; day-to-day development happens on Node 26.
- **pnpm 11.** The package manager version is pinned in `package.json`. The simplest way to match it is to let [corepack](https://nodejs.org/api/corepack.html) manage it for you.
- **git**, and a POSIX shell with `jq` available — the husky hooks shell out to `jq` to read `package.json`.

Enable corepack once and it will use the pinned pnpm on every command in this repo:

```bash
corepack enable
# corepack now shims pnpm to the version in package.json#packageManager
```

## Getting started

Clone the repo and install the workspace:

```bash
git clone https://github.com/spencerbeggs/effected.git
cd effected
pnpm install     # install every workspace package and its peers
```

`pnpm install` wires up the whole workspace, runs husky to register the git hooks, and resolves the pinned Effect v4 prerelease through the pnpm catalogs in `pnpm-workspace.yaml`. If the install changes `pnpm-lock.yaml` unexpectedly, review the diff before committing it — a stray install has been known to prune platform binaries from the lockfile.

## Working with AI agents

Contributions written with or by an AI coding agent are welcome, and the repo is set up for them. The conventions below — commit format, sign-off and signing, changesets, pull-request descriptions, Effect v4 idioms, the test layout — are all encoded in a set of agent plugins, so an agent that has them installed gets these things right on its own instead of learning them from a red CI run. Install them before you start; the rest of this guide is what they know.

`CLAUDE.md` at the root and in each package is the agent-facing context for this repo, and the `okf/` directory holds the durable project knowledge those files point into. Agents should read them; humans will find them useful too.

### Claude Code

The plugins live in three marketplaces. Register them once, at user scope:

```bash
claude plugin marketplace add spencerbeggs/bot        # effected, okfit, api-docs, plugin-bot, vitest-agent
claude plugin marketplace add savvy-web/systems       # silk
```

Then install the set this repo enables in `.claude/settings.json`:

```bash
claude plugin install effected@spencerbeggs       # Effect v4 skills, GitHub Actions suite, developer/reviewer agents
claude plugin install silk@savvy-web-systems      # commit, changeset, PR-body and lint conventions, savvy-mcp tools
claude plugin install vitest-agent@spencerbeggs   # test runner MCP and the TDD agent
claude plugin install okfit@spencerbeggs          # the okf/ knowledge bundle tooling
claude plugin install api-docs@spencerbeggs       # RSPress docs-site skills
claude plugin install plugin-bot@spencerbeggs     # only if you are working in plugin/
claude plugin install pluginfinity@spencerbeggs   # only if you are working in plugin/
claude plugin install superpowers@claude-plugins-official
```

Once the marketplaces are registered, the project's `.claude/settings.json` turns these on for every session in this checkout. Three skills are worth knowing by name: `/silk:commit-create` (load it *before* composing a commit message, not after the hook rejects one), `/silk:changeset` (writes a valid changeset from the branch diff), and `/silk:pr-body` (the pull-request description contract). The `effected` plugin's `effect-developer` and `effect-reviewer` agents write and review Effect v4 code against the vendored source rather than from memory, which matters: Effect v4 is a redesign and training-data knowledge of Effect is v3-shaped.

### GitHub Copilot

The `spencerbeggs/bot` repo is also a Copilot plugin marketplace. It carries the `effected` plugin (an experimental port of the Claude Code one) and `plugin-bot`:

```bash
copilot plugin marketplace add spencerbeggs/bot
copilot plugin install effected@spencerbeggs
```

The Copilot port is new and covers less than the Claude Code plugin — in particular none of the silk commit and changeset tooling exists there yet — so read the commit and changeset sections below with extra care if that is your agent.

### Hacking on the plugin itself

The plugin's source lives in `plugin/`, and `pluginfinity` builds it into committed Claude Code and Copilot plugins under `plugin/builds/`. After editing the source, rebuild with `pnpm build --filter @effected/ai-plugin`, then run your agent against this checkout's build rather than the published copy:

```bash
pnpm claude      # claude --plugin-dir plugin/builds/claude
pnpm copilot     # copilot --plugin-dir plugin/builds/copilot
```

Switch the marketplace copy off first, or both copies load. Override it in `.claude/settings.local.json`, which is git-ignored:

```json
{
  "enabledPlugins": {
    "api-docs@spencerbeggs": true,
    "okfit@spencerbeggs": true,
    "effected@spencerbeggs": false,
    "plugin-bot@spencerbeggs": true,
    "silk@savvy-web-systems": true,
    "superpowers@claude-plugins-official": true,
    "vitest-agent@spencerbeggs": true
  }
}
```

`plugin/CLAUDE.md` covers the plugin's own conventions and release flow.

## Repository layout

- `packages/` — the publishable `@effected/*` libraries. Each has its own `package.json`, `README.md` and `__test__/` directory.
- `website/` — the RSPress documentation site.
- `lib/configs/` — shared tool configuration (commitlint, lint-staged, markdownlint).
- `plugin/` — the `effected` agent plugin: one source built into a Claude Code plugin and a GitHub Copilot plugin under `plugin/builds/`. Both ship through the `spencerbeggs/bot` marketplaces; see [Working with AI agents](#working-with-ai-agents).

Dependency versions are shared through pnpm catalogs in `pnpm-workspace.yaml`, so every package builds and tests against the same Effect v4 prerelease.

## Dependency catalogs

`@effected/pnpm-plugin-effect` defines the catalogs the repo and its consumers use: the `effect` pair, which pins Effect itself, and the `effected` pair, which names every publishable kit package except `@effected/pnpm-plugin-effect` itself, for consumers to reference as `catalog:effected`.

Advancing the Effect pin is a two-step, human-run flow. `pnpm:up` rewrites the catalog ranges in `packages/pnpm-plugin-effect/savvy.build.ts`; `pnpm:export` writes the catalogs into the root `pnpm-workspace.yaml`. Neither touches `pnpm-lock.yaml` — the lockfile moves on your next install. Review the diff before committing:

```bash
pnpm pnpm:preview   # print the generated catalogs without writing anything
pnpm pnpm:up        # move every Effect package to its latest v4 release
pnpm pnpm:export    # write the catalogs into pnpm-workspace.yaml
```

The `effected` catalog is maintained for you. A workflow runs the sync on every push to `main` and opens an auto-merging pull request, so a release you cut is reflected in the catalog without anyone editing it. Two scripts exist if you need to do it locally:

```bash
pnpm catalog:check  # read-only: report where the catalog has drifted from the workspace
pnpm catalog:sync   # rewrite the catalog and write a changeset if anything moved
```

`catalog:sync` touches only `packages/pnpm-plugin-effect/savvy.build.ts` and one fixed-name changeset. Catalog entries hold each package's **next** release, so a pending changeset alone can move an entry — and because `lock-minor` floors peer patches, a first sync normalizing a peer range down by a patch is correct rather than drift.

## Build pipeline

[Turbo](https://turbo.build/) orchestrates the build graph across packages. Each package builds with [@savvy-web/bundler](https://github.com/savvy-web/bundler) and emits dual outputs: a development build under `dist/dev/` and a production build under `dist/prod/`.

```bash
pnpm build     # build dev + prod outputs for every package via Turbo
```

Build a single package by filtering:

```bash
pnpm build --filter @effected/semver     # build one package and its upstream deps
```

The production build depends on type-checking and the development build, so always build through `pnpm build`. Do not run the underlying `savvy.build.ts` script with a production target directly — it skips the development build, emits no type declarations, and can leave a truncated report that looks like a clean run.

## Testing

Tests run on [Vitest](https://vitest.dev/) with the `@vitest-agent/plugin` project discovery and coverage setup.

```bash
pnpm test              # run the full suite once
pnpm test:watch        # re-run on change
pnpm test:coverage     # run with v8 coverage
pnpm ci:test           # what CI runs (sets CI=true)
```

Tests live in each package's `__test__/` directory, never co-located in `src/`:

- Unit tests are `__test__/*.test.ts`.
- End-to-end tests are `__test__/e2e/*.e2e.test.ts`.
- Integration tests are `__test__/integration/*.int.test.ts`.

Effect code is tested with `@effect/vitest` and asserts through `assert.*`, not `expect`. New behavior needs tests, and a bug fix should come with a test that fails without it.

## Type-checking and linting

Every package type-checks with `tsc --noEmit`. Formatting and linting run through [Biome](https://biomejs.dev/); markdown is linted separately.

```bash
pnpm typecheck       # tsc --noEmit across every package via Turbo
pnpm lint            # check with Biome
pnpm lint:fix        # apply Biome's safe fixes
pnpm lint:md         # lint markdown
pnpm lint:md:fix     # fix markdown
```

Run `pnpm lint:md` rather than invoking `markdownlint-cli2` directly. The repo's config carries a repo-wide glob set, and passing explicit paths to the tool widens the run rather than narrowing it.

## Documentation site

The RSPress site in `website/` runs locally through Turbo:

```bash
pnpm dev         # serve the docs site with hot reload
pnpm preview     # preview a production build of the site
```

## Commit conventions

Commits follow the [Conventional Commits](https://www.conventionalcommits.org/) format (`feat`, `fix`, `chore` and so on), and every commit on a pull request needs **both** a DCO sign-off and a cryptographic signature. These are the two things contributions most often arrive without, and CI rejects the pull request for either.

### Sign-off and signed commits

The [Developer Certificate of Origin](https://developercertificate.org/) sign-off is a `Signed-off-by:` trailer carrying your configured git name and email; it certifies you have the right to submit the change under the project license. `-s` adds it:

```bash
git commit -s -m "fix(semver): reject leading zeros in prerelease identifiers"
```

The **DCO Check** on every pull request fails if any commit lacks the trailer, and the name and email must match the commit's author.

A **signed commit** is separate: a GPG or SSH signature GitHub can verify against a key on your account, so the commit shows as **Verified**. Register a signing key on GitHub ([SSH signing keys](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#ssh-commit-signature-verification) are the quickest to set up), then make git sign every commit in this checkout:

```bash
git config gpg.format ssh                          # skip this line if you use a GPG key
git config user.signingkey ~/.ssh/id_ed25519.pub   # or your GPG key id
git config commit.gpgsign true
```

With `commit.gpgsign` set you do not need `-S`; with it unset, pass `-S` explicitly. **If you are driving an AI agent, tell it to commit with `git commit -s -S`** (or set `commit.gpgsign` as above so `-s` alone is enough) — agents routinely produce well-formed conventional commits and forget both trailers.

A branch that already has commits missing one or both is repaired in place, then force-pushed to your fork:

```bash
git rebase --signoff origin/main                                          # add the DCO trailer to every commit
git rebase --exec 'git commit --amend --no-edit -S' origin/main           # sign every commit
git push --force-with-lease
```

The checks run against the commits as pushed to the branch, so fix them there rather than expecting the squash-merge to paper over them.

### What the preset enforces

The type must be one of `ai`, `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `release`, `revert`, `style`, `tdd` or `test`. Anything else is rejected — `design` in particular is not a valid type. A `tdd` commit additionally requires a structured scope of the form `goalId:state`, where the state is one of `spike`, `red`, `green` or `refactor` (`tdd(42:green)`).

Commit bodies are optional, and an absent body is fine when the subject already says the whole thing. When you do write one, **dash bullets are allowed and are the preferred shape**:

```text
fix(semver): reject leading zeros in prerelease identifiers

- Treat a leading zero in a numeric identifier as invalid per SemVer 2.0.0
- Keep alphanumeric identifiers untouched, where a leading zero is legal

Signed-off-by: Ada Lovelace <ada@example.com>
```

The `silk/body-no-markdown` rule rejects a specific set of markdown in the body: code fences, links, bold, horizontal rules, numbered lists, and more than two inline-code spans. One or two inline-code spans are fine. Body lines are capped at 300 characters, though anything approaching that is usually a sign the content belongs in the pull request instead.

Keep bodies short. This repository squash-merges, so a long commit body is discarded at merge; reasoning, benchmarks and investigation notes belong in the pull request description, the changeset, or a design doc, all of which outlive the commit.

If a commit closes tracked issues, put them on **one comma-separated line** above the sign-off — `Closes #12, #34` — rather than one trailer per line. Trailer lines are capped at 100 characters, as is the whole `type(scope): subject` header.

The `commit-msg` hook runs commitlint against every message, and the `pre-commit` hook runs lint-staged over your staged files, so a malformed message or a lint failure stops the commit locally before it reaches CI. Do not reach for `--no-verify`; if a hook blocks you, the message or the code is what needs fixing.

Note that lint-staged **reformats staged files for you** and re-stages the result — Biome over JavaScript and TypeScript, markdownlint over markdown. Do not hand-format to pre-empt it. It also strips the executable bit from `.sh` files, which is deliberate rather than a bug: every shell script here is invoked as `bash <script>`.

## Changesets

Releases are managed with [Changesets](https://github.com/changesets/changesets), and CI releases the packages the pending changesets name. Any change that affects a publishable package needs a changeset describing it, in its own file under `.changeset/`. Purely internal changes that touch no published package — tests, tooling, CI — do not need one.

The kit uses a house changeset format that the stock `changesets` prompt does not produce, so write the file yourself: pick a filename of three kebab-case words, declare the affected packages and their bump levels in YAML frontmatter, and put the body under one or more `##` category headings.

```markdown
---
"@effected/semver": patch
---

## Bug Fixes

Rejects a leading zero in a numeric prerelease identifier, which SemVer 2.0.0 disallows.

- Alphanumeric identifiers are unaffected, where a leading zero is legal
```

Bump levels follow the usual rule: `patch` for fixes, docs, internal refactoring and tests; `minor` for new exports and other non-breaking additions; `major` for removed exports, changed signatures and behavior breaks.

Every `##` heading must match one of thirteen categories exactly, and matching is case-sensitive: Breaking Changes, Features, Bug Fixes, Performance, Documentation, Refactoring, Tests, Build System, CI, Dependencies, Maintenance, Reverts, Other. Use `###` sub-headings under a category when a change has several distinct parts.

A few structural rules the validator enforces: no `#` heading and no skipped heading depths; nothing before the first `##` heading; no empty sections or empty list items; every code fence carries a language; and a `## Dependencies` section must contain a five-column table (Dependency, Type, Action, From, To) rather than prose or bullets.

Validate before you commit — the pre-commit hook checks changeset files too:

```bash
pnpm exec savvy changeset check     # validate every pending changeset
pnpm exec savvy changeset lint      # the same rules, file by file
```

Write for someone reading the release notes, not for the reviewer of the diff. What does a person upgrading this package need to know? Internal implementation detail that has no bearing on how the package is used does not belong here. The existing files in `.changeset/` are the reference for depth.

## Branch and pull-request flow

`main` is the base branch. Work on a topic branch and open a pull request against `main`; do not push directly to it.

1. Branch from an up-to-date `main`.
2. Make your change with tests and, where it applies, a changeset.
3. Make sure `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm lint:md` all pass locally.
4. Open a pull request. CI re-runs the build and test suite, and a reviewer takes it from there.

The **pull request title is validated as a conventional-commit subject**, the same format and 100-character limit as a commit subject — CI fails the PR if it does not parse. Pull requests are squash-merged, so the title is what lands in the history on `main`.

The description itself is ordinary markdown and is not held to the commit-message rules: headings, bullets, tables and code fences are all welcome. Use it for what the commit message cannot carry — what you ruled out, what surprised you, what you verified and how, and anything a reviewer needs to check by hand. Please do not paste a file-by-file recap of the diff; GitHub renders that already.

To link an issue, put a bare `Closes #123` on its own line, one per issue, outside any code fence — a reference inside a fenced block is inert and will not link.

Keep pull requests focused — one logical change per branch is far easier to review than a mixed bag.

## License

By contributing you agree that your contributions are licensed under the [MIT](LICENSE) license, the same terms that cover the rest of the repo.
