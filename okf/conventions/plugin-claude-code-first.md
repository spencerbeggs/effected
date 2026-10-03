---
type: Convention
title: Change the Claude Code plugin first, then port to Copilot
description: Author every skill, agent and hook change in plugins/claude-code/ and prove it there before copying and refactoring it into plugins/copilot/'s format, never the reverse.
status: deprecated
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
sources:
  - id: plugins-claude-md
    resource: https://github.com/spencerbeggs/effected/blob/41327b9656d86db47749ee161e198c716853d391/plugins/CLAUDE.md
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-03T04:19:44Z
  body_sha256: a785622a3cab8603648a6317886fa61b1dcc92ba553ec1fcbd26c497e40a31b4
---

# Change the Claude Code plugin first, then port to Copilot

**Deprecated.** pluginfinity now builds both hosts from one source; follow
[author the plugin once in plugin/](author-the-plugin-once.md) instead.
The rule below described the two hand-maintained trees it replaced.

Claude Code and Copilot have similar but divergent formats for
`SKILL.md` files and for hooks, so skill and agent content is maintained
in two versions. The team overwhelmingly uses Claude Code, so the
canonical flow is one-directional:

1. Make the change in `plugins/claude-code/` and prove it there (the bats
   suite, dogfooding).
2. Copy it into `plugins/copilot/` and refactor it into Copilot's format.

`plugins/claude-code/` is authoritative; `plugins/copilot/` is a port
that trails it. A change originating in the Copilot tree is a smell: it
means the two trees will diverge in content as well as in format, and
content divergence is the failure this ordering exists to prevent. The
`improve` skill (see
[the evidence-ladder convention](evidence-ladder.md)) and the plugin's
bats suite both target the Claude Code tree only — neither one is aware
of `plugins/copilot/` at all.

Never author content in `plugins/copilot/` and back-port it into
`plugins/claude-code/`.
