# pnpm-module-template

A personal template repository by
[C. Spencer Beggs](https://spencerbeg.gs) for developing and publishing Node.js
modules to [npm](https://www.npmjs.com/) and
[GitHub Packages](https://github.com/features/packages).

You're welcome to clone or fork this template for your own use.

## What's Included

- **Build pipeline** — Dual-output builds (development + production) via
  [Rslib](https://rslib.rs/) with automatic `package.json` transformation for
  publishing
- **Code quality** — [Biome](https://biomejs.dev/) for linting and formatting,
  with git hooks for pre-commit checks and commit message validation
- **Testing** — [Vitest](https://vitest.dev/) with v8 coverage
- **Versioning** — [Changesets](https://github.com/changesets/changesets) for
  version management and changelog generation
- **CI/CD** — GitHub Actions for automated testing, building, and publishing
  with provenance attestation
- **TypeScript** — Strict mode, composite builds, ESM-first with `.js` import
  extensions

## Quick Start

1. Click **"Use this template"** on GitHub (or clone the repo directly)
2. Update `package.json` with your package name, repository URL, and homepage
3. Update the `repo` field in `.changeset/config.json`
4. Replace the placeholder code in `src/` with your own
5. Install dependencies:

   ```bash
   pnpm install
   ```

6. Start developing:

   ```bash
   pnpm run test:watch    # Run tests in watch mode
   pnpm run lint:fix      # Auto-fix lint issues
   pnpm run build         # Build dev + prod outputs
   ```

## Project Structure

```text
src/               Source code and tests
lib/configs/       Shared tool configurations (commitlint, lint-staged, markdownlint)
dist/dev/          Development build output
dist/npm/          Production build output (published to registries)
.github/workflows/ CI/CD workflows
.changeset/        Changeset configuration
```

## Publishing

Packages are published to both npm and GitHub Packages with provenance
attestation. The build pipeline automatically transforms `package.json` for
publishing — the source file stays `"private": true` and the builder handles the
rest.

See the [Changesets documentation](https://github.com/changesets/changesets) for
how versioning and releases work.

## Claude Code

This template includes configuration for
[Claude Code](https://docs.anthropic.com/en/docs/claude-code). See
[CLAUDE.md](CLAUDE.md) for details on the design-first development workflow.

## License

[MIT](LICENSE)
