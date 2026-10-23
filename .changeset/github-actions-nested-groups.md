---
"@effected/github-actions": minor
---

## Breaking Changes

### Nested log groups

The runner does not nest `::group::` commands. `ActionLogger.group` now writes the group command only at the outermost level; a nested group writes a single `▸ <name>` header line instead of a second `::group::`/`::endgroup::` pair. The log shape changes for any action that nests groups.

## Features

- `ActionsRegistryCredential.workload` mints the npm workload credential, masks both values and returns it.
- `OidcTokenIssuer.recording` is a test double that records the audiences it was asked for.
