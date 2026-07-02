# Contributing

> **Template placeholder** — Replace this file with contribution guidelines
> specific to your project when you clone this template.

## Writing a Good CONTRIBUTING.md

A CONTRIBUTING.md file sets expectations for contributors and reduces friction
in the review process. Below are best practices for writing one.

### What to Include

**Prerequisites and setup** — List required tools (Node.js version, package
manager, etc.) and the steps to get a working development environment. Keep it
copy-pasteable:

```text
git clone <repo-url>
cd <project>
pnpm install
pnpm run build
pnpm run test
```

**Project structure** — A brief overview of the directory layout so
contributors know where to find things. A simple tree diagram works well.

**Development workflow** — Explain how to run the project locally, run tests,
lint, and type-check. List the key scripts from `package.json` in a table.

**Branching and commit conventions** — Describe your branch naming scheme and
commit message format. If you use conventional commits, link to the spec and
show an example. If DCO signoff is required, explain how to add it.

**How to submit changes** — Walk through the fork-branch-PR workflow step by
step. Mention any CI checks that must pass before review.

**Code style** — Point to your linter/formatter config rather than restating
rules. If there are conventions the tooling does not enforce (naming, file
organization, import ordering), document those here.

**Testing expectations** — State whether new code needs tests, what coverage
threshold applies, and how to run the test suite. Mention any special test
categories (unit, integration, e2e) and their naming conventions.

**Issue and PR etiquette** — Explain how to file a good bug report, how to
propose a feature, and what reviewers look for in a PR. Link to issue templates
if you have them.

**Changesets** — If you use changesets for versioning, explain when a changeset
is needed and how to create one.

**License** — State the project license and clarify that contributions are
made under the same terms.

### Tips

- Keep it concise. A wall of text discourages reading.
- Use headings and lists so contributors can scan for what they need.
- Link to external docs (conventional commits spec, DCO explanation) rather
  than reproducing them inline.
- Update CONTRIBUTING.md when workflows change. Stale docs are worse than no
  docs.
- Consider adding a "First-time contributors" section pointing to good starter
  issues.
