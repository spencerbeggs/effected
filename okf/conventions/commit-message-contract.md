---
type: Convention
title: Every commit follows the conventional-commit and DCO contract
description: Commits require a conventional type, a DCO signoff, and bodies restricted to dash bullets with no headers, numbered lists, code fences, links, or more than two inline-code spans.
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
sources:
  - id: claude-md
    resource: ../../CLAUDE.md
  - id: lint-staged-config
    resource: ../../lib/configs/lint-staged.config.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: a50d619628bdabd2
---

# Every commit follows the conventional-commit and DCO contract

Every commit requires a conventional commit type (`feat`, `fix`, `chore`,
and the rest of the standard set) and a DCO signoff line
(`Signed-off-by: Name <email>`).[^claude-md] `design:` is not a valid
commit type in this repository — do not invent it as a shorthand for
design-doc or knowledge-bundle work.

Commit bodies allow dash bullets, which is the preferred shape for
multi-point bodies, but the `silk/body-no-markdown` rule forbids markdown
headers, numbered lists, code fences, and links inside a commit body, and
caps inline-code spans at two per body. A commit message is not the place
for a small design document; keep the body to a few bullets or one or two
short paragraphs, and put anything requiring headers, fences, or more than
two inline-code references into the pull request description instead,
where markdown is fully supported.

The preset enforcing this contract is `@savvy-web/silk`'s commitlint
configuration, applied through `lib/configs/lint-staged.config.ts`'s
`Preset.silk()` at pre-commit.[^lint-staged-config]

[^claude-md]: `CLAUDE.md` — "Commits": the conventional-format-plus-DCO
    rule and the `silk/body-no-markdown` restrictions.
[^lint-staged-config]: `lib/configs/lint-staged.config.ts` — `Preset.silk()`,
    which wires the commitlint preset enforcing this contract at commit
    time.
