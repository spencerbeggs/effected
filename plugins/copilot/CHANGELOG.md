# @effected/copilot-plugin

## 0.2.0

### Features

- Mirrors CLaude Code plugin setup with agents skills and hooks. [#558][#558]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#558]: https://github.com/spencerbeggs/effected/pull/558

## 0.1.0

### Features

#### An experimental Copilot plugin

- `plugins/copilot/` introduces a GitHub Copilot build of the "effected" plugin, alongside the established Claude Code one. It is an experiment: the intent is to find out whether Copilot is usable for `@effected` development, not to reach parity with the Claude Code plugin.

- Copilot and Claude Code describe skills and hooks in similar but incompatible formats, so the agent and skill content is maintained twice. Claude Code is the source of truth — a change lands in `plugins/claude-code/` first and is then copied and refactored into `plugins/copilot/`.

#### Versioning and distribution

- The plugin is tracked by a private workspace package, `@effected/copilot-plugin`, which never publishes to npm. A changeset naming it bumps both `plugins/copilot/package.json` and the plugin manifest `plugins/copilot/plugin.json`, then cuts a git tag and a GitHub release.

- It is distributed from its own Copilot marketplace in `spencerbeggs/bot`, separate from the Claude Code marketplace. That marketplace's ref is bumped by hand for these first versions rather than on release. [#555][#555]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#555]: https://github.com/spencerbeggs/effected/pull/555
