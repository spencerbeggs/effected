---
"@effected/claude-code-plugin": patch
"@effected/copilot-plugin": patch
---

## Documentation

- The workspaces reference no longer teaches that `WorkspaceSnapshots.at(ref)` never replays config-dependency hooks: every replaying `ConfigDependencyHooks` layer now loads the pnpmfile of the version each `configDependencies` entry declares (from `.pnpm-config` or the pnpm store, failing closed), `at(ref)` replays the ref's own declarations through the same hooks reference as the worktree side, and the hermetic `layerFrom` seam plus `Workspaces.layerWithGitAndHooks` are named.
- `PeerCheck` guidance now states that all three `peerDependencyRules` axes are applied, with `ignoreMissing` / `allowAny` as `@pnpm/matcher` peer-name patterns rather than `parent>peer` keys, and that `peerRulesNotApplied` fires only when the option key is omitted.
