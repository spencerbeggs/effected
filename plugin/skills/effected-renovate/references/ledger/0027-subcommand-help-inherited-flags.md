---
id: "0027"
title: Subcommand help lists inherited flags in their own section
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.0"
  "@effected/cli": ">=0.25.0"
detect: ["HelpDoc", "defaultFormatter", "\"--help\""]
---

Subcommand help lists flags inherited from ancestor commands under `INHERITED FLAGS`, between `FLAGS` and `GLOBAL FLAGS`, instead of under `FLAGS`. That includes `@effected/cli`'s `CliAudience.flags()` (`--agent`, `--human`, `--ci`, `--audience`) on every subcommand below the command declaring them; the declaring command still lists them under its own `FLAGS`. Core's formatter renders this; the kit adds nothing.

What to change:

- **Help snapshots** of a subcommand change: regenerate them, and read the diff rather than accepting it blind.
- **A custom formatter** must read ancestor flags from `HelpDoc.inheritedFlags`, not `HelpDoc.flags`. Check the shape against the installed `effect/dist/cli/HelpDoc.d.ts`.
- `CliOutput.defaultFormatter` now takes `"full"`, `"summary"` and `"none"` modes for inherited and global flags, if you want shorter subcommand help.

How it shows itself: only tests find it, usually as a snapshot diff.
