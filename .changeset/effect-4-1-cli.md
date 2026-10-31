---
"@effected/cli": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

### Inherited flags in subcommand help

Subcommand help now lists ancestor flags, including `CliAudience.flags()` (`--agent`, `--human`, `--ci`, `--audience`), under an `INHERITED FLAGS` section between `FLAGS` and `GLOBAL FLAGS` instead of under `FLAGS`. Snapshot tests of subcommand help change.
