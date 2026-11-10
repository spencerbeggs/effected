# @effected/markdown-lint

A markdownlint-compatible lint rule shape over `@effected/markdown` trees: a `LintRule` defined once (markdownlint metadata plus a synchronous `check` over a `LintContext`), run by two hosts — `MarkdownLint`, a pure programmatic linter, and `MarkdownlintAdapter`, which turns a rule into a markdownlint custom rule. `PositionMapping` derives every `lineNumber`, `column`, `range` and `fixInfo` from kit offsets.

**Tier: pure.** One runtime dependency, `@effected/markdown` (`workspace:^`), and the `effect` peer. `LineIndex` comes through `@effected/markdown`'s re-export; never add a direct `@effected/source` edge.

**Design docs:** `okf/modules/markdown-lint.md` — Load when: changing the surface, the mapping, the adapter's numbering or the test corpus. `okf/decisions/markdown-lint-package.md` — Load when: tempted to move the lint shape into `@effected/markdown`, import markdownlint, or read micromark tokens.

## Rules that are load-bearing

- **Never import `markdownlint`, in `src/` or as a dependency or peer.** The adapter's local types (`MarkdownlintRule`, `MarkdownlintRuleParams`, `MarkdownlintOnError`, `MarkdownlintErrorInfo`, `MarkdownlintFixInfo`) are a structural subset of markdownlint's `lib/markdownlint.d.mts`. Keep them mutable where markdownlint's are (`names`, `tags`, `range` are `Array`s) or the adapted object stops being assignable to markdownlint's `Rule`.
- **Every position goes through `PositionMapping`.** Both hosts build contexts in `src/internal/host.ts`; never compute a line number anywhere else, or the hosts can disagree.
- **Diagnostic line numbers count the whole source.** Only `MarkdownlintAdapter`'s `forward` converts to markdownlint's numbering (content-relative, `frontMatter: true` inside the front matter).
- **`LintRule.make` validates to markdownlint's custom-rule validation.** A metadata rule markdownlint would refuse must throw at `make`.
- **Both hosts report a parse refusal as one finding per rule.** Neither throws on input.

## Tests

- `__test__/rules/` holds the five savvy-web/systems changeset rules (CSH001–CSH005, savvy-web's house style, which savvy-web owns) as test-only copies: an engine-fidelity corpus with two reference engines, never public API. No kit package provides them; `@effected/changesets/lint` ships only style-neutral front-matter rules.
- `__test__/fixtures/changesets/golden.json` is CAPTURED, not hand-written: regenerate only with `capture/` per its `README.md`, and never edit a diagnostic by hand.
- `__test__/markdownlint-host.test.ts` is the only file that imports markdownlint: the exact-pinned `markdownlint` devDependency (the same copy the workspace root's markdownlint-cli2 resolves), through a variable specifier so no `src/` type resolves against its declarations.

```bash
pnpm vitest run packages/markdown-lint
pnpm build --filter @effected/markdown-lint
```
