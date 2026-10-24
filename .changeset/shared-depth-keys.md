---
"@effected/github-actions": minor
---

## Breaking Changes

* `ActionLoggerShape` has a new required member `heading(name, effect)`, which writes the `▸ name` header without changing group depth. Custom implementations must add it; `makeTest`, `layerTest` and `layerSilent` already provide it.
* `OidcTokenIssuer.layer` now requires `ActionOutputs` as well: its requirements widen to `ActionEnvironment | HttpClient | ActionOutputs`.
* Every live-issued OIDC token (`token` and `claims`) now emits one `::add-mask::` at issuance. Test doubles mask nothing.

## Features

* `ActionLogger.group` depth is keyed by `WorkflowCommand.groupDepthKey`, shared with `@effected/cli` so rendering inside a group is aware of its depth.
