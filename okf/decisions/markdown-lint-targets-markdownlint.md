---
type: Decision
title: The kit's markdown lint reads markdownlint's own configuration model, not markdownlint-cli2's, and stays in @effected/markdown-lint for now
description: "@effected/markdown-lint's rule set, config model and ./config reader target markdownlint's configuration object and .markdownlint.{jsonc,json,yaml,yml} files; .markdownlint-cli2.* files, customRules, overrides, globs and formatters are the consuming tool's concern. A separate @effected/markdownlint package and consumer-side config reading were rejected; folding into @effected/markdown/lint is deferred."
status: draft
tags:
  - architecture
  - compat
sources:
  - id: owner-ruling
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-23T00:00:00Z
    title: "Owner rulings on the markdownlint rule set: approach A, no cli2 compatibility, the fold deferred"
  - id: okfit-435
    resource: https://github.com/spencerbeggs/okfit/issues/435
    title: "Epic: markdown linting through okfit, on a shared analysis layer"
  - id: config-file-tests
    resource: ../../packages/markdown-lint/__test__/config-file.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-11-24T05:55:52Z
integrity:
  generated:
    body: df2ca7006b61e53c
---

# The kit's markdown lint reads markdownlint's own configuration model, not markdownlint-cli2's, and stays in @effected/markdown-lint for now

## Context

okfit wants to lint markdown style itself and stop running
markdownlint-cli2[^okfit-435]. That needs three things from the kit: the
built-in markdownlint rules written over kit trees, markdownlint's
configuration resolved as markdownlint resolves it (rule settings,
enable and disable, severity, inline comments), and a reader for the
configuration files a repository already has. A consumer should hand the
kit a markdown file and the project's configuration and get the findings
markdownlint would give.

Two configuration formats exist. markdownlint's own is one object (rule
and tag keys, `default`, `extends`), stored in `.markdownlint.jsonc`,
`.json`, `.yaml` or `.yml`. markdownlint-cli2 wraps it in its own options
files (`.markdownlint-cli2.jsonc`, `.yaml`, `.cjs`, `.mjs`), which add
globs, ignores, `customRules`, per-glob `overrides`, output formatters and
a `config` key holding markdownlint's object.

## Decision

- **The target is markdownlint's configuration model.** `LintConfig`,
  `InlineDirectives` and the host options `config` and `noInlineConfig`
  model markdownlint's object and inline comments, and the `./config`
  reader reads only `.markdownlint.jsonc`, `.json`, `.yaml` and `.yml`, with
  their `extends` chains[^owner-ruling].
- **Discovery follows markdownlint-cli2's walk**, because that is how a
  repository's configuration is found today: the nearest directory with a
  supported file decides, a farther one is replaced rather than merged, and
  `extends` composes within that file's own chain[^config-file-tests]. The
  files the walk reads are markdownlint's, never cli2's.
- **Everything lives in `@effected/markdown-lint`, split by subpath.** The
  root stays free of IO and gains the configuration model, `./rules` holds
  the rule set, and `./config` holds the reader that requires `FileSystem`
  and `Path`: one package spanning two tiers, as `config-file` and `jsonl`
  already do.

## Alternatives rejected

- **Reading `.markdownlint-cli2.*` files.** It would pull a runner's
  concerns into the kit (globs, ignores, module-specifier `customRules`,
  formatters) and executing `.cjs` and `.mjs` configs, which a library
  reading files through `FileSystem` cannot do. The cost is a one-time move
  per repository, which is cheaper than modelling a second format forever.
- **A separate `@effected/markdownlint` package for the rules and the
  config.** Cleaner tiers, but a 56th package beside a confusingly similar
  name, and the rule shape in `@effected/markdown-lint` is already
  markdownlint-shaped.
- **Leaving configuration reading to each consumer.** The smallest kit
  change, but every consumer would rewrite discovery and `extends` and they
  would drift apart.

## Consequences

- Each repository moves its cli2 rule block into a `.markdownlint.jsonc`
  once. Until it does, a directory holding only cli2 or JavaScript configs
  is skipped and reported in `ResolvedLintConfig.skipped`, and a file named
  directly or by `extends` that the reader cannot load fails `unsupported`.
- cli2's `overrides`, `customRules`, globs, ignores and formatters are the
  consuming tool's concern. A consumer passes its own `LintRule`s to the
  host and merges its own per-glob overrides onto the resolved
  configuration.
- **Folding the package into `@effected/markdown/lint` is deferred, not
  rejected.** It is the likely final form once document-set analysis lands
  in `@effected/markdown`. It is not done now because fifty rules chasing
  markdownlint fidelity would version the parser on every rule fix. The
  root, `./rules` and `./rules/all` keep nothing `@effected/markdown` could
  not host, so their move stays mechanical. `./config` is the exception: it
  needs `@effected/jsonc`, `@effected/yaml`, `FileSystem` and `Path`, which
  would take a pure package to the boundary tier, so it stays outside any
  fold or moves to its own subpath there. The [placement
  decision](markdown-lint-package.md) records why the lint shape left the
  parser in the first place.

[^owner-ruling]: Conversation with the repository owner, 2026-11-23: approach A (one package, split by subpath), no markdownlint-cli2 compatibility, and the fold into `@effected/markdown/lint` deferred.
[^okfit-435]: <https://github.com/spencerbeggs/okfit/issues/435>
[^config-file-tests]: `packages/markdown-lint/__test__/config-file.test.ts`.
