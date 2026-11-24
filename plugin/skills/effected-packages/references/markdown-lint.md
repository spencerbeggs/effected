# @effected/markdown-lint

Lint markdown with markdownlint's rules and configuration over `@effected/markdown` trees, and write your own rules once for two hosts: a pure programmatic linter, or markdownlint itself (and so markdownlint-cli2 and the VS Code extension) as a custom rule. Line numbers, ranges and fixes come from the kit's own positions, so both hosts report the same findings on the same lines. **It imports no markdownlint**: the adapter satisfies markdownlint's custom-rule contract structurally, so you bring your own and this package never pins it.

Boundary tier, by subpath: the root, `./rules` and `./rules/all` do no IO; `./config` reads files through core `FileSystem` and `Path`, required in `R`. Regular dependencies `@effected/markdown`, and `@effected/jsonc` and `@effected/yaml` (reached only from `./config`); the `effect` peer.

Reach for it to lint markdown in-process with markdownlint's rule set, or when a rule would otherwise be written twice, over kit nodes for your own linter and over markdownlint's micromark tokens for the editor. To read a parse's own facts (`frontmatterFence`, `unresolvedFootnoteReferences`) without any rule machinery, `@effected/markdown` alone suffices.

## Import

```ts
import { InlineDirectives, LintConfig, LintDiagnostic, LintFixInfo, LintRule, MarkdownLint, MarkdownlintAdapter, PositionMapping } from "@effected/markdown-lint";
import type { LintCheck, LintConfigRecord, LintContext, LintFrontmatter, LintReport, LintSeverity, MarkdownLintDocumentOptions, MarkdownLintOptions } from "@effected/markdown-lint";
import { MD001, MD022, MD041 } from "@effected/markdown-lint/rules";
import { rules, uncovered } from "@effected/markdown-lint/rules/all";
import { MarkdownlintConfigError, MarkdownlintConfigFile } from "@effected/markdown-lint/config";
import type { ResolvedLintConfig } from "@effected/markdown-lint/config";
```

The root never reaches a rule module or `./config`: import only the rules you run from `./rules`; `./rules/all` is the one module that pulls in every rule.

## Core API

- **`LintRule.make({ names, description, tags, information?, check })`** → `LintRule`. Metadata is validated to markdownlint's custom-rule validation (non-empty names and tags, no name twice ignoring case, no tag equal to a name, an absolute URL for `information`) and a violation **throws**. The first name is the rule's identity (`name` getter); the rest are aliases.
- **`LintCheck`** — `(context: LintContext, report: (diagnostic: LintDiagnostic) => void) => void`. Synchronous, because markdownlint calls a custom rule synchronously. A `throw` is a broken rule, not a finding.
- **`LintContext`** — `name`, `document` (`MarkdownDocument`), `root`, `source` (the whole text, frontmatter included), `lines`, `frontmatter: Option<LintFrontmatter>` (`node: Option<Frontmatter>`, `lineCount`, `lines`: markdownlint's own `frontMatterLines`), `mapping` (`PositionMapping`), **`config`** (the rule's settings from the configuration, without `enabled` and `severity`: markdownlint's `params.config`), and **`diagnostic(report: LintReport)`** → `LintDiagnostic`.
- **`LintReport`** — `at` (a node or an offset span), optional `detail`, `context`, `range` (`true` for `at`'s span, or another span), `fix` (a kit offset edit over `source`).
- **`LintDiagnostic`** — `ruleNames`, `lineNumber`, `column`, `severity` (`"error"` or `"warning"`, from the configuration), and `Option`s of `detail`, `context`, `range` (`[column, length]`), `fixInfo` (`LintFixInfo`, markdownlint's one-line fix) and `edit` (the kit `MarkdownEdit`).
- **`MarkdownLint.lint(source, rules, options?)`** → `ReadonlyArray<LintDiagnostic>`. Pure, synchronous and total. `MarkdownLintOptions`: `name` (default `"<input>"`), `dialect` (default `"gfm"`), `frontmatter` (default `true`), `config` (markdownlint's configuration object, default `{ default: true }`) and `noInlineConfig` (default `false`: inline `<!-- markdownlint-disable -->`, `enable`, `capture`/`restore`, `-file`, `-line`, `-next-line` and `configure-file` comments are honoured). Only rules enabled on some line run; a finding on a line where its rule is disabled is dropped. **`lintDocument(document, rules, options?)`** runs over an already-parsed `MarkdownDocument` with the same reading; pass `dialect: "commonmark"` if you parsed that way, since the document does not record its dialect. **`lintEffect`** is `lint` under a `MarkdownLint.lint` span.
- **`MarkdownLint.applyFixes(source, findings)`** → `string`. Applies findings' fixes as `markdownlint-cli2 --fix` does, in any order (it sorts them by rule name, then line, as markdownlint does): identical fixes once, overlapping ones skipped, a whole-line delete taking its line's other fixes, then every line break rewritten to the source's most common ending.
- **`MarkdownlintAdapter.rule(lintRule, options?)`** / **`rules(lintRules, options?)`** → markdownlint `Rule` objects with `parser: "none"`. Parses once per file however many adapted rules run, and renumbers to markdownlint's front matter convention; markdownlint then does config, inline comments, severity and `--fix` itself, and hands the rule its settings as `context.config`.
- **`LintConfig`** — static and pure: `effective(config, rules)` resolves a configuration object (`default`, rule names, aliases and tags as keys, case-insensitive, later keys winning) to per-rule `enabled`, `severity` and `settings` maps; `merge(base, over)` is markdownlint's shallow `extends` merge; `key(rule)` is the key a rule's state lives under. **`InlineDirectives.resolve(lines, config, rules, options?)`** gives the effective config after `configure-file` and each line's enabled map. `MarkdownLint` uses both; call them directly only to build another host.
- **`PositionMapping.of(source)`** / **`fromDocument(document)`** — the one place an offset becomes a markdownlint coordinate: `lineNumber`, `column`, `lineStart(lineNumber)` (a line's start offset), `lineText`, `nodeLineNumber`, `range(span, lineNumber?)` → `Option<LintRange>`, `fixInfo(edit, lineNumber)` → `Option<LintFixInfo>`.

## The rule set

`./rules` ports 24 of markdownlint 0.42's built-in rules, each carrying markdownlint's names, aliases, description, tags and settings (read from `context.config` under markdownlint's names and defaults), and each held finding for finding to markdownlint, fixes included, by a differential test over markdownlint's own fixture corpus: `MD001` `MD003` `MD004` `MD009` `MD010` `MD012` `MD013` `MD018` `MD019` `MD020` `MD021` `MD022` `MD023` `MD024` `MD025` `MD026` `MD031` `MD032` `MD033` `MD040` `MD041` `MD045` `MD047` `MD060`. Configure them by number or alias (`"heading-increment": false`) exactly as in a `.markdownlint.jsonc`.

**`uncovered` is how you say what was not checked.** It lists the first names of the built-in rules with no port, in markdownlint's order. A tool that lints with `rules` and reports clean has checked only the ported set; print `uncovered` (or the part of it the user's config enables) rather than implying markdownlint parity.

## Config files

`./config` needs `FileSystem` and `Path` in `R`, and every failure is a `MarkdownlintConfigError` (`reason`: `unreadable`, `parse`, `extends-missing`, `extends-cycle`, `extends-depth`, `too-large`, `unsupported`; the offending `path`; optional `detail`, `cause`).

- **`MarkdownlintConfigFile.read(path)`** → the configuration object, with the file's `extends` chain merged (paths relative to the extending file, or absolute; at most 16 links, 1 MiB per file).
- **`MarkdownlintConfigFile.resolve(filePath, { root })`** → `ResolvedLintConfig` (`config`, `files` it came from, `skipped` unsupported files). It walks from the file's directory up to `root` and the **nearest** directory holding `.markdownlint.jsonc`, `.json`, `.yaml` or `.yml` (first in that order) decides; a farther config is replaced, not merged, as markdownlint-cli2 does. No config found gives `{}`; a `filePath` outside `root` fails `unreadable`.

```ts
import { MarkdownLint } from "@effected/markdown-lint";
import { MarkdownlintConfigFile } from "@effected/markdown-lint/config";
import { rules, uncovered } from "@effected/markdown-lint/rules/all";
import { Effect, FileSystem } from "effect";

const lintFile = Effect.fn("lintFile")(function* (file: string, root: string) {
  const fs = yield* FileSystem.FileSystem;
  const { config } = yield* MarkdownlintConfigFile.resolve(file, { root });
  const source = yield* fs.readFileString(file);
  return { findings: MarkdownLint.lint(source, rules, { name: file, config }), notChecked: uncovered };
});
```

## Writing a rule

```ts
import { LintRule, MarkdownLint } from "@effected/markdown-lint";

export const NoH1 = LintRule.make({
  names: ["no-h1", "X001"],
  description: "No level-1 headings",
  tags: ["headings"],
  information: "https://example.com/rules/no-h1",
  check: (context, report) => {
    for (const heading of context.document.findAll("heading")) {
      if (heading.depth !== 1) continue;
      const start = heading.position.start.offset;
      report(context.diagnostic({ at: heading, detail: "Use ## for top-level sections", range: true, fix: { offset: start, length: 1, content: "##" } }));
    }
  },
});

MarkdownLint.lint(source, [NoH1], { config: { default: false, "no-h1": { severity: "warning" } } });
```

```js
// .markdownlint-cli2.mjs
import { MarkdownlintAdapter } from "@effected/markdown-lint";
import { NoH1 } from "./rules/no-h1.js";

export default { customRules: MarkdownlintAdapter.rules([NoH1]) };
```

`MarkdownVisitor.traverse` from `@effected/markdown` is the synchronous, skip-aware walk a check usually wants.

## Traps

- **Apply fixes with `MarkdownLint.applyFixes`, not `MarkdownEdit.applyAll`.** Fixes from several findings can meet (two headings each asking for the blank line between them); `applyAll` refuses the overlap, `applyFixes` resolves it as markdownlint does.
- **A fix does not always map to `fixInfo`.** Only an edit within one line, or one deleting exactly one whole line (`deleteCount: -1`), does; any other keeps only its kit `edit`, which markdownlint's `--fix` skips.
- **A `range` lies on the finding's own line**, cut to it and absent when nothing of the span is there, because markdownlint rejects any other range and fails the whole file.
- **A parse refusal is a finding, not a throw:** one per rule, always at severity `error` in the programmatic host, at the configured severity under the adapter.
- **Two rules sharing a name throw**, ignoring case, as a wiring error.
- **Findings are ordered differently across hosts.** `MarkdownLint.lint` keeps rule order then report order; markdownlint sorts by rule name then line.
- **No rule can read a comment's text, on either host.** Comment bodies after the front matter are masked before the parse, so `source`, `lines` and the tree's `html` nodes all hold `.` runs, as under markdownlint. A check on what a comment says belongs outside a `LintRule`.
- **Settings are coerced as markdownlint coerces them**, not type-checked: `"50"` is `50`, `0` is `false`, a number where a string goes is its text. Where markdownlint itself hangs or throws on a setting, the kit stays total instead: a blank-line count past the document's edge stops there (`lines_above: 1e999` hangs markdownlint), a repeat is capped at 1,000 (MD010 `spaces_per_tab`, MD022's inserted lines), an invalid `front_matter_title` reads as the default and a non-list `ignore_code_languages` as none. A fractional MD013 limit reports its finding with no `range`, and an MD022 fix that inserts nothing has no `fixInfo`.
- **`extends` is a file path only.** markdownlint also resolves a package specifier (`markdownlint/style/prettier`, `@org/markdownlint-config`) and a leading `~`; the reader treats each as a path relative to the extending file and fails `extends-missing`.
- **Under markdownlint a rule sees normalized text:** `\n` endings, HTML comment bodies replaced by `.` runs. So MD025 and MD041 under the adapter can read a comment markdownlint does not treat as one (`<!-- a --->`) as a comment; the programmatic host reads it as written.
- **The `./config` reader models markdownlint's config files, not markdownlint-cli2's.** No JavaScript config (`.markdownlint.cjs`/`.mjs`) and no `.markdownlint-cli2.*` is read: a directory holding only those lands in `skipped` and the walk continues past it (cli2 would stop there), and naming one directly fails `unsupported`. cli2's `overrides`, globs and `customRules` are not modelled. TOML content and `.markdownlint.toml` are not read.
- **A config whose parsed value is not an object fails `parse`** (markdownlint would read it as `{}`); an empty document reads as `{}`.
- **The line ending a fix inserts** (MD047, and `applyFixes`'s rewrite) is the source's most common one, or `\n` when it has none; markdownlint takes `os.EOL`, so on Windows a file with no line break differs.
- **Two or more leading byte order marks diverge** from markdownlint wherever a rule reads a heading level or range; one mark is dropped by both hosts.
- **A GFM short table row is padded in the tree** with zero-width cells, so a rule cannot count the cells an author wrote.
- **No math nodes in the tree:** the rules read `$$` blocks and inline `$` math from source lines, as markdownlint's math extension parses them, so a custom rule that must skip math has to do the same.

## Not included

The 31 built-in rules in `uncovered`, any markdownlint dependency, and markdownlint-cli2's options files and `overrides`. The rules and the adapter are differentially tested against markdownlint 0.42.2, the version markdownlint-cli2 0.24.2 runs.
