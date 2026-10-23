---
"@effected/npm": minor
---

## Breaking Changes

### Credentials

- `basicCredentialFromPair`, which threw, is removed. Use `basicCredentialFromPairResult(username, password)`, which returns `Result<BasicCredential, BasicCredentialError>`.
- `RegistryReadError.kind` gains `"credential"`. An exhaustive switch over `kind` needs a new arm.

### `PublishOutcome.auth` is required

`PublishOutcome.auth` (`PublishAuthPath`) reports which authentication path npm used for a publish, and is required. Every `PublishOutcome` literal in a test double must include it.

### Publish behaviour (no compile error)

- `publishTarball` always passes `--loglevel=silly`, overriding any loglevel in an npmrc or the environment; only a `--loglevel` in the executor's `extraArgs` takes precedence. npm reports the auth path only at that level, which is how `PublishOutcome.auth` is read. `PublishError.output` is filtered back to the default levels.
- `tokenAuth: true` now also blanks `NPM_ID_TOKEN` and drops `--provenance`, so a token publish no longer attempts provenance.

## Features

- `WorkloadCredential` and `PublishCredential` (token, basic or workload). `setupAuth` now accepts a `PublishCredential` and writes a workload credential under `_authToken`; `NpmRegistry` refuses a workload credential for reads with kind `"credential"`.
- `PackagePublish.recording` is a test double that records each `setupAuth` call's registry, npmrc path, credential kind and workload audience.
