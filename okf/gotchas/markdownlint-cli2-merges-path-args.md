---
type: Gotcha
title: Explicit markdownlint-cli2 path arguments do not narrow the scan
description: Passing a specific file to markdownlint-cli2 merges it with the config's repo-wide globs instead of narrowing the scan, so "lint just my file" lints the whole repository.
status: stable
resource: ../../lib/configs/.markdownlint-cli2.jsonc
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 1ae9754c88a621c9
---

# Explicit markdownlint-cli2 path arguments do not narrow the scan

## What a reader sees

Running `markdownlint-cli2 path/to/one-file.md` looks like an ordinary CLI
invocation naming exactly the file to lint — the same shape as most linters,
where a path argument scopes the run to that path.

## What they wrongly conclude

That the run checks only `path/to/one-file.md`, and that its output — and
its runtime — reflects a single-file lint.

## What is actually true

`markdownlint-cli2` **merges** explicit path arguments with the config's
`globs` field rather than narrowing to them.[^config] This repository's
config sets `globs: ["**/*.{md,mdx}"]`, so any invocation that passes a
specific path still lints every Markdown and MDX file in the repository —
the explicit path adds to the scan rather than restricting it. The config
also deliberately omits a `fix` key: when present, a config-level `fix` key
overrides the CLI's own `--fix` flag, so this repository lets the flag on
the command line decide instead.

## The check

Never invoke `markdownlint-cli2` directly for a scoped lint. Use
`pnpm lint:md` to check and `pnpm lint:md:fix` to fix — both already run
against the full repository, which is the only scope this configuration
actually supports; there is no narrower invocation to reach for.

[^config]: `lib/configs/.markdownlint-cli2.jsonc` — `globs: ["**/*.{md,mdx}"]`
    and the absence of a `fix` key.
