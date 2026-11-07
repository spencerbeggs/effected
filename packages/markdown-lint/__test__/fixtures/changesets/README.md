# Changeset-rule golden corpus

`golden.json` holds every markdown input that savvy-web/systems' own changeset
rule tests lint, with the diagnostics both of systems' implementations produce
for it. It exists to hold this package's ports of the five rules
(`__test__/rules/`) to byte-identical output: one definition per rule, run by
both hosts, against two engines systems maintains separately.

## Provenance

- **Producing tool:** savvy-web/systems at commit
  `3cb3a9ffe7c104084d0469e7dd4f662e2005541e`, package
  `packages/silk-effects`, running against its installed `markdownlint@0.41.1`
  and the published `@effected/markdown@0.27.0` (both recorded in the file's
  `producedBy`), under `tsx` on Node 26.
- **Inputs:** not hand-authored. The capture runs systems' eleven rule test
  files (`__test__/changesets/rules__*.test.ts`,
  `markdownlint__rules__*.test.ts`, `api__linter.test.ts`) under a stub
  `vitest` and records every string handed to `parseKitMarkdown`,
  `parseKitMarkdownBody` or markdownlint's `lint`: 195 calls, 113 unique
  inputs. `sources` names the test or tests each input came from.
- **`programmatic`:** `ChangesetLinter.validateContent(markdown)`, systems'
  programmatic linter (its kit-node rules, frontmatter stripped, file-relative
  lines).
- **`markdownlint`:** markdownlint's `lint` result for systems' five
  markdownlint rules, `config: { default: false, CSH001 … CSH005: true }`,
  keeping `lineNumber`, `ruleNames`, `ruleDescription`, `errorDetail`,
  `errorContext`, `errorRange` and `fixInfo`. markdownlint's own `severity`
  and `ruleInformation` are host configuration and are not kept.

Licence: the inputs and diagnostic strings are systems' (MIT, Copyright (c)
2026 Savvy Web Systems), as are the rules ported in `__test__/rules/`.

## Regenerate

Only to re-baseline against a newer systems; the harness is in `capture/`:

```sh
cd <systems>/packages/silk-effects
SYSTEMS="$PWD" SYSTEMS_COMMIT="$(git rev-parse HEAD)" \
  node --import tsx/esm --import <effected>/packages/markdown-lint/__test__/fixtures/changesets/capture/register.mjs \
  <effected>/packages/markdown-lint/__test__/fixtures/changesets/capture/capture.mjs golden.json
```

Run against the commit above, it reproduces the committed `golden.json`
byte for byte.

## What it pins

- `golden.test.ts`: `MarkdownLint.lint` equals `markdownlint` exactly (in
  markdownlint's result order), and equals `programmatic` exactly — order,
  line, column, message — wherever systems' two engines agree.
- `markdownlint-host.test.ts`: the adapted rules, run by the real markdownlint
  that this repository's `markdownlint-cli2` installs, equal `markdownlint`
  exactly.

systems' engines disagree on exactly eleven inputs, all CSH005: its kit rule
reports Schema decode messages at the table, its markdownlint rule reports its
own messages at the row. The port follows the markdownlint engine; the test
pins the count at eleven so a new disagreement cannot hide in the exemption.
No input in the corpus carries a `context`, `range` or `fixInfo` — those
mappings are pinned by `position-mapping.test.ts` and the markdownlint host
test instead.
