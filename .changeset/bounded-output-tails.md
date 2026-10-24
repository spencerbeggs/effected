---
"@effected/workspaces": minor
---

## Breaking Changes

`PackedInstallError.message` for `PackFailed` and `InstallFailed` on a non-zero exit is no longer a single line: it ends with `; output tail:` followed by the last 8 non-blank lines (at most 600 characters, prefixed with `…` when cut) of stdout and stderr. The `output` field is unchanged. Code that matched or displayed the message as one line should read `output` instead.

## Bug Fixes

* `LayerPolicyError` shape-mismatch messages and hooks-source `CatalogAssemblyError` messages now include the nested cause chain.
* Lazy memoised readers (`LockfileReader`, `WorkspaceCatalogs`, `WorkspaceDiscovery`, `WorkspaceSnapshots.at`, pnpmfile resolution) cache only successes and let concurrent callers share one in-flight run.
