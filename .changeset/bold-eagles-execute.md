---
"@effected/github-actions": minor
---

## Features

First release. The GitHub Actions runtime — the services an action needs to
talk to the runner it is executing inside. The one package in the kit with
`@effect/platform-node` as a required peer, because a GitHub Action always
runs as a Node process on a GitHub-provided runner.

### `Action.run` — the default runtime

```ts
import { Action, ActionCache } from "@effected/github-actions";

// The default runtime covers inputs, outputs, state, logging and HTTP.
// Cache/Artifact/BlobStore are opt-in — they are the only modules that reach
// Azure, so pulling one in costs exactly one line:
Action.run(program, { layer: ActionCache.layer });
```

`ActionRuntime.layer` installs an input-aware `ConfigProvider`, so a bare
`Config.string("dry-run")` resolves correctly instead of silently taking a
default. `ActionInput` owns the `INPUT_` name mangling and the absence
contract: a missing input and an input set to `""` are both treated as
missing data.

### Inputs, outputs, state, logging

`ActionInput`, `ActionOutputs`, `ActionState`, `ActionLogger` (mapping
`Effect.log*` onto workflow commands and structured annotations),
`ActionEnvironment` (`GitHubContext` / `RunnerContext`), and `WorkflowCommand`
for the raw runner protocol.

### Cache, artifacts and the blob store

`ActionCache`, `Artifact`, `BlobStore` / `GitHubCacheBlobStore`, and
`CacheKey.hashFiles` implement the Actions cache and artifact protocols
directly over HTTP — no `@actions/*` dependency. `Secret` is the only place a
secret ever becomes a plain string (declassification and masking are the same
call).

### Auth, OIDC and process control

`GitHubToken` bridges an installation token from `@effected/github` into the
runner; `OidcTokenIssuer` reads the runner's OIDC claims; `ToolInstaller`
downloads and stages a tool atomically into the tool cache; `DetachedProcess`
manages a spawned child that must outlive the current step.
