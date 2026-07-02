# CLAUDE.md

This file provides guidance to Claude Code when working with code in this
repository.

## Project Status

This is a **base template repository** for developing and publishing Node.js
modules to npm and GitHub Packages. It is not a working library — it contains
placeholder source code in `src/` that should be replaced when starting a new
project.

The design documentation system is available via Claude Code skills and agents
but no design docs exist yet in this template.

## Getting Started (After Cloning This Template)

When starting a new project from this template, follow this lifecycle:

1. **Rename the package** — Update `name` in `package.json` (e.g.,
   `@spencerbeggs/my-new-lib`), update `repository.url` and `homepage`, and
   update the `repo` field in `.changeset/config.json`
2. **Replace placeholder code** — Delete the example `Foo`/`Bar` code in
   `src/index.ts` and `src/index.test.ts`
3. **Initialize design documentation** — Run `/design-init` to create your
   first design document describing the library's architecture
4. **Follow the design-first workflow** — Design docs → `/plan-create` →
   implementation. This ensures Claude understands the full architecture before
   writing code
5. **Implement iteratively** — Use the plan to guide implementation, updating
   design docs as the architecture evolves

## Build Pipeline

This project uses
[@savvy-web/rslib-builder](https://github.com/savvy-web/rslib-builder) to
produce dual build outputs via [Rslib](https://rslib.rs/):

| Output | Directory | Purpose |
| ------ | --------- | ------- |
| Development | `dist/dev/` | Local development with source maps |
| Production | `dist/npm/` | Published to npm and GitHub Packages |

### How `private: true` Works

The source `package.json` is marked `"private": true` — **this is intentional
and correct**. During the build, rslib-builder reads the `publishConfig` field
and transforms the output `package.json`:

- Sets `"private": false` based on `publishConfig.access`
- Rewrites `exports` to point at compiled output
- Strips `devDependencies`, `scripts`, `publishConfig`, and `devEngines`

The `rslib.config.ts` `transform()` callback controls what gets removed. Never
manually set `"private": false` in the source `package.json`.

### Publish Targets

The `publishConfig.targets` array defines where packages are published:

- **GitHub Packages** — `https://npm.pkg.github.com/` (from `dist/npm/`)
- **npm registry** — `https://registry.npmjs.org/` (from `dist/npm/`)

Both targets publish with provenance attestation enabled.

### Turbo Orchestration

[Turbo](https://turbo.build/) manages build task dependencies and caching:

- `types:check` runs first (no dependencies)
- `build:dev` and `build:prod` both depend on `types:check`
- Cache excludes: `*.md`, `.changeset/**`, `.claude/**`, `.github/**`,
  `.husky/**`, `.vscode/**`
- Environment pass-through: `GITHUB_ACTIONS`, `CI`

## Savvy-Web Tool References

This template depends on several `@savvy-web/*` packages. These are in active
development — if behavior seems unexpected, explore both the GitHub docs and the
installed source.

| Package | Purpose | GitHub | Local Source |
| ------- | ------- | ------ | ------------ |
| rslib-builder | Build pipeline, dual output, package.json transform | [savvy-web/rslib-builder](https://github.com/savvy-web/rslib-builder) | `node_modules/@savvy-web/rslib-builder/` |
| commitlint | Conventional commit + DCO enforcement | [savvy-web/commitlint](https://github.com/savvy-web/commitlint) | `node_modules/@savvy-web/commitlint/` |
| changesets | Versioning, changelogs, release management | [savvy-web/changesets](https://github.com/savvy-web/changesets) | `node_modules/@savvy-web/changesets/` |
| lint-staged | Pre-commit file linting via Biome | [savvy-web/lint-staged](https://github.com/savvy-web/lint-staged) | `node_modules/@savvy-web/lint-staged/` |
| vitest | Vitest config factory with project support | [savvy-web/vitest](https://github.com/savvy-web/vitest) | `node_modules/@savvy-web/vitest/` |

TypeScript configuration extends from rslib-builder:
`@savvy-web/rslib-builder/tsconfig/ecma/lib.json`

## Commands

### Development

```bash
pnpm run lint              # Check code with Biome
pnpm run lint:fix          # Auto-fix lint issues
pnpm run lint:fix:unsafe   # Auto-fix including unsafe transforms
pnpm run lint:md           # Check markdown with markdownlint
pnpm run lint:md:fix       # Auto-fix markdown issues
pnpm run typecheck         # Type-check via Turbo (runs tsgo)
pnpm run test              # Run all tests
pnpm run test:watch        # Run tests in watch mode
pnpm run test:coverage     # Run tests with v8 coverage report
```

### Building

```bash
pnpm run build             # Build dev + prod outputs via Turbo
pnpm run build:dev         # Build development output only
pnpm run build:prod        # Build production/npm output only
pnpm run build:inspect     # Inspect production build config (verbose)
```

### Running a Specific Test

```bash
pnpm vitest run src/index.test.ts
```

## Code Quality and Hooks

### Biome

Unified linter and formatter replacing ESLint + Prettier. Configuration in
`biome.jsonc` extends `@savvy-web/silk/biome`.

### Commitlint

Enforces conventional commit format with DCO signoff. Configuration in
`lib/configs/commitlint.config.ts` uses the `CommitlintConfig.silk()` preset.

### Husky Git Hooks

| Hook | Action |
| ---- | ------ |
| `pre-commit` | Runs lint-staged (Biome on staged files) |
| `commit-msg` | Validates commit message format via commitlint |
| `pre-push` | Runs tests for affected packages using Turbo |
| `post-checkout` | Package manager setup |
| `post-merge` | Package manager setup |

### Lint-Staged

Configuration in `lib/configs/lint-staged.config.ts` uses the `Preset.silk()`
preset from `@savvy-web/lint-staged`.

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement)
- Use `node:` protocol for Node.js built-ins (e.g., `import fs from 'node:fs'`)
- Separate type imports: `import type { Foo } from './bar.js'`

### Commits

All commits require:

1. Conventional commit format (`feat`, `fix`, `chore`, etc.)
2. DCO signoff: `Signed-off-by: Name <email>`

### Publishing

Packages publish to both GitHub Packages and npm with provenance via the
[@savvy-web/changesets](https://github.com/savvy-web/changesets) release
workflow. The GitHub Action is at
[savvy-web/silk-release-action](https://github.com/savvy-web/silk-release-action).

## Testing

- **Framework**: [Vitest](https://vitest.dev/) with v8 coverage provider
- **Pool**: Uses `forks` (not threads) for broader compatibility
- **Config**: `vitest.config.ts` uses the `VitestConfig.create()` factory from
  `@savvy-web/vitest`, which supports project-based filtering via `--project`
- **CI**: `pnpm run ci:test` sets `CI=true` and enables coverage

### Test Directory

All tests live in `__test__/`, never co-located in `src/`. See
`__test__/CLAUDE.md` for the full directory structure and rules.

- Unit tests: `__test__/*.test.ts`
- E2e tests: `__test__/e2e/*.e2e.test.ts`
- Integration tests: `__test__/integration/*.int.test.ts`
- Shared mocks and helpers go in the `utils/` subdirectory for each category
- Static test data goes in the `fixtures/` subdirectory for each category
