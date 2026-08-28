# @effected/claude-code-plugin

## 0.14.0

### Breaking Changes

#### The plugin source moved to `plugins/claude-code/`

- `plugin/` is now `plugins/claude-code/`, making room for a sibling Copilot plugin under `plugins/copilot/`. Skills, agents, hooks, scripts and tests moved verbatim; the plugin is still named `effected`, and its manifest is still at `.claude-plugin/plugin.json` within the plugin directory.

- Installed from the `spencerbeggs` marketplace, nothing changes — the marketplace entry already points at the new subdirectory. Anyone loading the plugin from a local checkout must update the path:

```bash
claude --plugin-dir plugins/claude-code
```

### Features

#### The plugin is now versioned and released on its own

- The Claude Code plugin no longer borrows `@effected/app`'s version. It is tracked by its own private workspace package, `@effected/claude-code-plugin`, which never publishes to npm — it exists so a changeset naming it bumps both `plugins/claude-code/package.json` and the plugin manifest `plugins/claude-code/.claude-plugin/plugin.json` in lockstep, then cuts a git tag and a GitHub release for the plugin.

- To version the plugin, write a changeset for `@effected/claude-code-plugin`. Changesets for `@effected/app` no longer move it.

### Bug Fixes

- The construct-index generator resolved the repository root relative to its own location and pointed one directory too shallow after the move, so `generate` and `check` both failed before reading a single package. Its repo-root and default annotation/output paths now account for the deeper nesting.
- The generated construct index carried a do-not-edit banner naming the old `plugin/scripts/` path, as did the skill that teaches grepping it. Both now name `plugins/claude-code/`, and the index has been regenerated.

### Documentation

- `plugins/CLAUDE.md` records how the two plugins are developed, versioned, tagged and distributed, and the design doc covers both. [#555][#555]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#555]: https://github.com/spencerbeggs/effected/pull/555
