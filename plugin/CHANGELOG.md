# @effected/ai-plugin

## 0.29.0

### Documentation

- The `effect-v4-cli`, `effected-packages`, `building-schemastore-schemas` and `effect-v4-testing` skills now cover the new `@effected/cli` surface: `CliUi.map`, `CliUi.lazyView` and `LiveOptions.final`, masked `TextInput`, the span-trail modes, the `CliUiTest` transcripts and serializer, and the new `@effected/schemastore-cli` failure report
- The `effect-v4-cli` skill now covers six adoption traps: where `CliUiTest.session` goes relative to `CliEnv.layerTest`, `Select` drawing `detail` only for the highlighted choice, the session's 80-column default and row truncation, `CliUi.prompt` keeping `NotInteractive` without `otherwise`, `Doc.print` writing one `Console.log`, and top-level `Doc` blocks printing with no blank line
- The `effect-reviewer`, `effect-developer` and `action-engineer` agents are updated to match [#933][#933]

* The `effected-packages` references for `app`, `store` and `config-file` cover `App.layerDirs`, the keyed `layerAs` and `layerSqliteAs` layers, `location`, Migrator ledger adoption and mirroring, and the wider-key caveat on `ConfigFile.layer`.
* The `effect-v4-services-layers` skill states the verified memoisation rule (a layer builds once per provided graph and a nested `Effect.provide` reuses the enclosing build, while sequential or sibling provides build again) and the key-pin edge case where a key parameter accepts wider service shapes.
* The `effect-reviewer` and `effect-developer` agents check a project's database wiring: one shared layer binding per database, `App.layerDirs` at a CLI edge, a distinct `layerAs` filename, per-connection pragmas in `client` / `onConnect` rather than migrations, and retrying only a warm-up open on `SQLITE_BUSY`.
* The `effect-v4-testing` memfs reference reflects the `FileSystem` requirement on the app database layers. [#933][#933]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#933]: https://github.com/spencerbeggs/effected/pull/933

## 0.28.0

### Features

#### One plugin for Claude Code and GitHub Copilot

- The effected plugin is now built from a single source for both hosts, so the Claude Code and Copilot plugins carry the same skills, agents and session briefing at the same version. The Copilot plugin moves onto the shared version line with this release.

- The Copilot plugin now carries every skill reference the Claude Code plugin does, including the installer integrity options that had fallen out of its `actions-cache-and-artifacts` reference

- Copilot agents list only tools Copilot provides: `read`, `edit`, `search`, `todo`, `execute` and `web`

- Four skills whose combined trigger text exceeded Copilot's 1024-character limit now ship a shorter Copilot description that fits within it

- The Copilot session briefing finds the project root from the session's working directory, since Copilot exposes no project-root variable

### Bug Fixes

- The `effect-v4-testing` and `effected-packages` skills now parse correctly: unquoted `when_to_use` text containing a colon followed by a space, or a `#`, had been invalid or cut short [#929][#929]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#929]: https://github.com/spencerbeggs/effected/pull/929
