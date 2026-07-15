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

`pnpm install` wires up the whole workspace, runs husky to register the git hooks, and resolves the pinned Effect v4 beta through the pnpm catalogs in `pnpm-workspace.yaml`. If the install changes `pnpm-lock.yaml` unexpectedly, review the diff before committing it — a stray install has been known to prune platform binaries from the lockfile.

## Repository layout

- `packages/` — the publishable `@effected/*` libraries. Each has its own `package.json`, `README.md` and `__test__/` directory.
- `website/` — the RSPress documentation site.
- `lib/configs/` — shared tool configuration (commitlint, lint-staged, markdownlint).
- `plugin/` — an in-development Claude Code plugin dogfooded during the migration.

Dependency versions are shared through pnpm catalogs in `pnpm-workspace.yaml`, so every package builds and tests against the same Effect v4 beta.

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

Commits follow the [Conventional Commits](https://www.conventionalcommits.org/) format (`feat`, `fix`, `chore` and so on) and require a [Developer Certificate of Origin](https://developercertificate.org/) sign-off. Add the sign-off with `-s`:

```bash
git commit -s -m "fix(semver): reject leading zeros in prerelease identifiers"
```

The sign-off appends a `Signed-off-by:` trailer using your configured git name and email, which certifies you have the right to submit the change under the project license.

A few rules the tooling enforces:

- Commit bodies are plain prose — no backticks, bullets or code spans.
- `design` is not a valid commit type.

The `commit-msg` hook runs commitlint against every message, and the `pre-commit` hook runs lint-staged over your staged files, so a malformed message or a lint failure stops the commit locally before it reaches CI.

## Changesets

Releases are managed with [Changesets](https://github.com/changesets/changesets). Any change that affects a publishable package needs a changeset describing it, in its own file under `.changeset/`.

```bash
pnpm dlx @changesets/cli add     # answer the prompts to draft a changeset
```

The kit uses a house changeset format with a fixed set of section headings; the existing files in `.changeset/` are the best reference for the shape and depth expected. Purely internal changes that touch no published package — tests, tooling, CI — do not need one.

## Branch and pull-request flow

`main` is the base branch. Work on a topic branch and open a pull request against `main`; do not push directly to it.

1. Branch from an up-to-date `main`.
2. Make your change with tests and, where it applies, a changeset.
3. Make sure `pnpm build`, `pnpm test`, `pnpm typecheck` and `pnpm lint` all pass locally.
4. Open a pull request. CI re-runs the build and test suite, and a reviewer takes it from there.

Keep pull requests focused — one logical change per branch is far easier to review than a mixed bag.

## License

By contributing you agree that your contributions are licensed under the [MIT](LICENSE) license, the same terms that cover the rest of the repo.
