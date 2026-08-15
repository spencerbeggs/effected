---
"@effected/github-actions": minor
---

## Breaking Changes

### The five heavy engines are now optional peers, not dependencies

`@azure/storage-blob`, `@effected/markdown`, `@effected/npm`, `@effected/sbom` and `@effected/templates` have moved out of `dependencies` and into `peerDependencies` with `peerDependenciesMeta.optional: true`. `@effected/github` and `@effected/glob` stay hard dependencies.

**If you only import the light modules — `ActionEnvironment`, `ActionInput`, `ActionLogger`, `ActionOutputs`, `ActionState`, `Secret`, `DetachedProcess`, `GitHubToken` — nothing changes for you.** A consumer of any of the following modules must now declare the matching peer explicitly, or installs will no longer pull it in transitively:

| Module | Requires |
| :--- | :--- |
| `ActionCache`, `Artifact`, `GitHubCacheBlobStore` | `@azure/storage-blob` |
| `GitHubMarkdown` | `@effected/markdown` |
| `PackageManagerInstaller` | `@effected/npm` |
| `ManagedDocument`, `CheckDocument` | `@effected/templates` |
| `ActionsProvenance`, `ActionsIdentityToken` | `@effected/sbom` |

```json
{
	"dependencies": {
		"@effected/github-actions": "^0.7.0",
		"@effected/markdown": "^0.5.0"
	}
}
```

A consumer who does not install the peer and imports the module it powers gets a module-not-found error naming the missing package at that import — never earlier, and never for a module they don't use.

## Features

### `Secret.forProcessEnv`

Declassifies one secret for the caller to bridge into `process.env` — the third-party-SDK case, under its own auditable name, for an SDK that reads only the ambient environment and cannot take a plaintext argument:

```ts
import { Secret } from "@effected/github-actions";

const plaintext = yield* Secret.forProcessEnv(theToken); // masks first, then returns plaintext
process.env.SDK_TOKEN = plaintext;
```

### `Secret.mask`

Registers a secret with the runner's log filter and returns nothing — the register-only shape for a credential input that must be redacted from logs whether or not it ends up used:

```ts
yield* Secret.mask(suppliedCredential);
```

### `DetachedProcess.httpProbe` and a test seam for detached workers

`DetachedProcess.httpProbe(url)` is a readiness probe for `DetachedProcess.awaitReady`: `true` on a 2xx `GET`, `false` on any transport error or non-2xx response (a refused connection is "not up yet", never a probe failure).

`DetachedProcess`'s operations are now also reachable as `DetachedProcessOps`, injectable via a new `DetachedProcess.makeTestOps` double — production code takes an optional `DetachedProcessOps` parameter defaulting to `DetachedProcess.ops`, and a test passes only the members it means to observe. Unstubbed members die naming themselves rather than silently succeeding.
