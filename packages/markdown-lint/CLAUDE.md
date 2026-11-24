# @effected/markdown-lint

A markdownlint-compatible lint rule shape over `@effected/markdown` trees: a `LintRule` defined once (markdownlint metadata plus a synchronous `check` over a `LintContext`), run by two hosts — `MarkdownLint`, a pure programmatic linter, and `MarkdownlintAdapter`, which turns a rule into a markdownlint custom rule. `PositionMapping` derives every `lineNumber`, `column`, `range` and `fixInfo` from kit offsets. `LintConfig` and `InlineDirectives` resolve markdownlint's configuration and inline comments; `./rules` ports 26 of markdownlint's built-in rules (`./rules/all` lists them and the `uncovered` rest); `./config` reads markdownlint config files from disk.

**Tier: boundary.** The root, `./rules` and `./rules/all` perform no IO; `./config` reads files through core `FileSystem` and `Path`, required in `R`. Three regular dependencies: `@effected/markdown` (`workspace:^`), and `@effected/jsonc` and `@effected/yaml` (`workspace:^`), which only `./config` imports; the `effect` peer; zero external runtime dependencies. `LineIndex` comes through `@effected/markdown`'s re-export; never add a direct `@effected/source` edge.

**Design docs:** `okf/modules/markdown-lint.md` — Load when: changing the surface, the mapping, the adapter's numbering, a rule port, the config reader, a recorded divergence or the test corpus. `okf/decisions/markdown-lint-package.md` — Load when: tempted to move the lint shape into `@effected/markdown`, import markdownlint, or read micromark tokens. `okf/decisions/markdown-lint-targets-markdownlint.md` — Load when: asked to read `.markdownlint-cli2.*` files, model cli2 `overrides` or `customRules`, or fold the package into `@effected/markdown/lint`.

## Rules that are load-bearing

- **Never import `markdownlint`, in `src/` or as a dependency or peer.** The adapter's local types (`MarkdownlintRule`, `MarkdownlintRuleParams`, `MarkdownlintOnError`, `MarkdownlintErrorInfo`, `MarkdownlintFixInfo`) are a structural subset of markdownlint's `lib/markdownlint.d.mts`. Keep them mutable where markdownlint's are (`names`, `tags`, `range` are `Array`s) or the adapted object stops being assignable to markdownlint's `Rule`.
- **Every position goes through `PositionMapping`.** Both hosts build contexts in `src/internal/host.ts`; never compute a line number anywhere else, or the hosts can disagree.
- **Diagnostic line numbers count the whole source.** Only `MarkdownlintAdapter`'s `forward` converts to markdownlint's numbering (content-relative, `frontMatter: true` inside the front matter).
- **`LintRule.make` validates to markdownlint's custom-rule validation.** A metadata rule markdownlint would refuse must throw at `make`.
- **Both hosts report a parse refusal as one finding per rule.** Neither throws on input.
- **The root never reaches a rule module, `./config`, `node:` or a format engine.** `rules-metadata.test.ts`'s root-purity gate walks the source import graph. Subpaths name root types through `import type * as Lint from "@effected/markdown-lint"` and import values relatively; `effected.toml`'s `dtsExternals` and its suppression scoped to the three subpath entries depend on that, and `subpaths.test.ts` pins the declarations.
- **A rule port matches markdownlint finding for finding.** Every rule test runs the differential harness (`__test__/helpers/differential.ts`) over the vendored corpus and asserts its exact divergence list; a divergence is fixed, or pinned there and recorded by name in the module concept, never silent. Port metadata must equal the installed markdownlint's (`rules-metadata.test.ts`).

## Tests

- `__test__/rules/` holds the five savvy-web/systems changeset rules (CSH001–CSH005, savvy-web's house style, which savvy-web owns) as test-only copies: an engine-fidelity corpus with two reference engines, never public API. No kit package provides them; `@effected/changesets/lint` ships only style-neutral front-matter rules.
- `__test__/fixtures/changesets/golden.json` is CAPTURED, not hand-written: regenerate only with `capture/` per its `README.md`, and never edit a diagnostic by hand.
- `__test__/fixtures/markdownlint/` is markdownlint's `test/*.md` corpus, copied from `.repos/markdownlint` by `scripts/capture-markdownlint-corpus.mjs`; never edit a fixture by hand.
- `hostile-inputs.test.ts` holds wall-clock ceilings and runs in the root `vitest.config.ts`'s `SLOW_TESTS` and `TIMING_TESTS` tier, never the fast tier.
- Only test code imports markdownlint, all of it through `__test__/helpers/markdownlint-oracle.ts`: the exact-pinned `markdownlint` devDependency, 0.42.2 like the vendored `.repos/markdownlint` and the copy the workspace root's markdownlint-cli2 resolves, through a variable specifier so no `src/` type resolves against its declarations.

```bash
pnpm vitest run packages/markdown-lint
pnpm build --filter @effected/markdown-lint
```
