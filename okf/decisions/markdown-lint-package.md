---
type: Decision
title: The markdownlint-compatible lint shape is its own pure package; @effected/markdown gains only the callback visitor
description: "A rule is defined once over kit trees in @effected/markdown-lint, a pure sibling of @effected/markdown that matches markdownlint's custom-rule contract structurally and imports no markdownlint; @effected/markdown adds only MarkdownVisitor.traverse."
status: stable
tags:
  - architecture
  - compat
sources:
  - id: issue-1030
    resource: https://github.com/spencerbeggs/effected/issues/1030
    title: "markdown: a markdownlint-compatible lint shape so a rule is defined once over kit trees"
  - id: markdownlint-types
    resource: https://github.com/DavidAnson/markdownlint/blob/v0.42.0/lib/markdownlint.d.mts
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-07T03:13:10Z
integrity:
  generated:
    body: 577060f9e892c1b2
  verified:
    by: human:spencer
    at: 2026-11-08T18:25:54Z
    content: d3629d49793e87d2
verified:
  - by: human:spencer
    at: 2026-11-08T18:25:54Z
---

# The markdownlint-compatible lint shape is its own pure package; @effected/markdown gains only the callback visitor

## Context

savvy-web/systems implements each of its five changeset lint rules twice:
over kit nodes for its programmatic linter, and over markdownlint's
micromark tokens so the same rules run inside markdownlint-cli2. #1030 asked
for one rule definition against `@effected/markdown` nodes, with
markdownlint-style metadata, reporting through an `onError`-equivalent
derived from kit positions, and run by two hosts — a programmatic linter
and a markdownlint custom rule — plus a pure synchronous visitor, since
markdownlint calls a rule synchronously[^issue-1030].

## Decision

- **`@effected/markdown` gains only `MarkdownVisitor.traverse`** — enter/exit
  callbacks with `SKIP`/`EXIT`, ancestors and a type-narrowing selector,
  over the same generator engine as `walk` and `visit`. It stays pure and
  dependency-free, and nothing lint-shaped enters it.
- **Everything else is a new pure package, `@effected/markdown-lint`**:
  `LintRule`, `LintContext`, `LintDiagnostic`, `PositionMapping`, the
  `MarkdownLint` host and the `MarkdownlintAdapter`. It depends on
  `@effected/markdown` (`workspace:^`) and peers on `effect`; nothing else.
- **The compatibility target is markdownlint's custom-rule contract**, the
  one markdownlint-cli2 and the VS Code extension both load. The adapter
  matches it **structurally**: local types are a subset of markdownlint's
  `Rule`, `RuleParams`, `RuleOnError`, `RuleOnErrorInfo` and
  `RuleOnErrorFixInfo`, mutable where markdownlint's are, so the adapted
  object is assignable to markdownlint's `Rule`[^markdownlint-types]. The
  support window is the markdownlint-cli2 0.24 line (markdownlint 0.42) this
  repository lints its own markdown with, verified by running the adapter
  inside it; the contract has been stable across markdownlint's recent
  releases (systems' golden came from markdownlint 0.41.1).
- **Line numbers count the whole source.** The adapter translates to
  markdownlint's content-relative numbering, with `frontMatter: true`
  inside the front matter, at the boundary and nowhere else.
- **A parse refusal is a finding, not a throw**, in both hosts, so they
  agree on the one input the kit refuses.

## Alternatives rejected

- **The lint shape inside `@effected/markdown`, or on a `./lint` subpath.**
  The format package would own a second product (a lint framework and a
  foreign tool's contract) beside its parse/edit/format surface, and every
  change to markdownlint's contract would version the parser. A sibling
  package keeps the parser's release cadence its own and puts the
  markdownlint coupling where only lint consumers pay for it.
- **Importing `markdownlint` for its types (a dependency or a peer).** A
  dependency would pin the consumer's markdownlint and drag it into every
  programmatic-only consumer; even a type-only peer makes the package's
  `.d.ts` unresolvable without it. The structural subset costs a few local
  types and a pointer to `lib/markdownlint.d.mts`.
- **The adapter consuming markdownlint's micromark tokens.** That is the
  duplication #1030 exists to remove: the rule would still have two
  readings of the document. The adapter asks markdownlint for no parser
  (`parser: "none"`) and parses with the kit.
- **Naming the visitor `visitSync`.** The [sync-primitive
  policy](../conventions/sync-primitive-policy.md) reserves `*Sync` for
  blocking-IO facades returning nullables; `traverse` names the
  callback-driven walk instead, beside `walk` and `visit`.
- **`MarkdownLint.lint` failing on a parse refusal (a `Result`).** It would
  be the one host with a failure channel the other cannot have; the
  refusal is reported per rule in both instead, and `lint` stays total.

## Consequences

- systems can delete its micromark rule copies and run one definition per
  rule under both of its hosts; the golden corpus in
  `packages/markdown-lint/__test__/fixtures/changesets/` holds a port to
  byte-identical output.
- Where systems' two engines disagreed (CSH005), one definition has to pick
  one; the example port follows the markdownlint engine.
- A rule cannot read markdownlint's per-rule configuration yet;
  `LintContext` has no `config`.

[^issue-1030]: <https://github.com/spencerbeggs/effected/issues/1030>
[^markdownlint-types]: markdownlint's `lib/markdownlint.d.mts`.
