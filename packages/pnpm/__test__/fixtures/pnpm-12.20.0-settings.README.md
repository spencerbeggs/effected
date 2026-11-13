# pnpm 12.20.0 settings inventory

`pnpm-12.20.0-settings.json` lists every setting pnpm 12.20.0 reads from a
settings source, extracted from the pnpm source vendored at `.repos/pnpm`,
pinned to tag `v12.20.0`. The coverage tests in `__test__/settings/` hold the
`@effected/pnpm/settings` catalog to it: same names, same locations, same
documentation anchors.

## Regenerating

From `packages/pnpm`:

```sh
node scripts/extract-pnpm-settings.mts          # rewrite the fixture
node scripts/extract-pnpm-settings.mts --check  # exit 1 if the fixture is stale
```

Re-run after re-pinning `.repos/pnpm`, then reconcile the catalog with
whatever the coverage tests report.

## What counts as a setting

The union of three sources, all under `pnpm/` at the tag:

| Source | What it contributes |
| --- | --- |
| `crates/config/src/workspace_yaml/settings.rs`, `struct WorkspaceSettings` | Every key pnpm 12 reads from `pnpm-workspace.yaml` and the global `config.yaml`. Field names are serde's `rename_all = "camelCase"` spelling, honouring `#[serde(rename = …)]` (`_auth`) and skipping `#[serde(skip)]` (`key_issues`, `includes`). A field read with `deserialize_double_option` is marked `triState` (absent, `null`, or a value). |
| `crates/config/src/workspace_yaml/machine.rs`, `struct MachineSettings` | The machine-only keys (`ci`, `stateDir`, `globalDir`, `tools`, …) a project file may not set. |
| `docs/settings/*.md` (and the `_*.mdx` partials they import) | Every `### ` heading is a documented setting. A dotted heading (`lockfile.format`) documents part of its parent; `[no-]color` documents `color`; headings starting `--` are command-line flags and are skipped. |

Excluded, and listed separately:

- `inert`: `UNTYPED_WORKSPACE_SETTING_KEYS` in `crates/config/src/known_settings.rs`
  — the five build settings pnpm 12 recognises but never applies
  (`onlyBuiltDependencies`, `onlyBuiltDependenciesFile`,
  `neverBuiltDependencies`, `ignoredBuiltDependencies`, `executionEnv`;
  `pnpm approve-builds` migrates them to `allowBuilds`). Three of them are
  `WorkspaceSettings` fields only so `pnpm config get` can show them.
- `otherVersions`: `SETTINGS_OF_OTHER_PNPM_VERSIONS` in the same file
  (`confirmModulesPurge`, a pnpm 11 setting pnpm 12 does not read).
- `include`, the top-level key that delegates settings to other files
  (`crates/workspace/src/include.rs`), is document structure rather than a
  setting, and is not a `WorkspaceSettings` field.

## Locations

Each setting's `locations` are derived per source, not copied from docs:

- `workspace` — a `WorkspaceSettings` field, minus the keys in
  `PROJECT_MANIFEST_SKIPPED_KEYS` (`crates/config/src/refused_keys.rs`) and
  `_auth`, whose doc comment in `settings.rs` says it is honoured only from the
  global `config.yaml`.
- `global` — a `MachineSettings` field, or a `WorkspaceSettings` field that the
  four `clear_workspace_*_fields` functions in
  `crates/config/src/workspace_yaml/workspace_scope.rs` do not reset (pnpm 12
  parses the global file as `WorkspaceSettings` and then calls
  `clear_workspace_only_fields`).
- `npmrc` — `registry` plus the keys `apply_network_key` matches in
  `crates/config/src/npmrc_auth/ini.rs`, mapped from kebab-case to camelCase.
  The TLS and credential keys (`ca`, `cafile`, `cert`, `key`, `_authToken`, …)
  are not settings of the catalog: they belong to the npmrc grammar
  `@effected/npm` owns.
- `env` — a field `crates/config/src/env_overlay.rs` or
  `crates/config/src/env_overlay/resolution.rs` reads from a
  `PNPM_CONFIG_*` variable, through a `*_field!` macro or a direct
  assignment.

`npmPath` is documented (`docs/settings/cli.md`) but is no field of either
struct and no part of the config crate reads it, so its `locations` are empty.

## Env formats

`envFormat` records how `env_overlay.rs` parses a setting's variable, from the
macro or assignment that reads it: `json` (`json_field!`, `tri_array_field!`:
`serde_json`, a value that does not parse is ignored), `text`
(`string_field!`, `string_field_allow_empty!`, `tri_string_field!` and the
direct string assignments), `jsonOrText` (`enum_field!`:
`parse_json_or_string`), `flag` (`verifyDepsBeforeRun`, whose unrecognized
value reads as `true`) and `subkeys` (`nodePackageMap`, `macosBackup`, read
through `get_or_insert_default` from one variable per key). The extractor fails
on an unknown macro or a setting read two ways. The `json` boolean reading was
confirmed against the pnpm 12 binary: `PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE`
set to `yes`, `TRUE` or `"true"` reads as unset, `true` as `true`.

## Anchors

`anchor` is `settings/<page id>#<heading id>`, the page id from the docs page's
front matter and the heading id slugged the way Docusaurus does (lowercased,
punctuation dropped, a repeat on one page suffixed `-1`, `-2`, …). For a
setting documented only by dotted sub-headings, it is the first sub-heading's
id. One known disagreement: `docs/settings/node-modules.md` links
`nodePackageMap.type` as `#nodepackagemaptype-1`, while first-come slugging
gives that id to the later `nodePackageMapType` heading. Undocumented settings
have an empty anchor.

`docsDefault` and `docsType` are the `* Default:` and `* Type:` bullets of the
heading, verbatim, when it has them.
