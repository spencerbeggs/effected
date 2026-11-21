---
"@effected/workspaces": minor
---

## Features

Adds `ConfigDependencyHooks.layerSubprocessWith(options?)` and the exported `ConfigDependencyHooksSubprocessOptions` type. The `pnpm` option selects the `command` and extra `env` (`Redacted` values allowed, never shown in errors) for the `pnpm install` spawn that fetches a config dependency this checkout has not installed. The env layers over the inherited environment for that spawn only. `ConfigDependencyHooks.layerSubprocess` is unchanged and equals `layerSubprocessWith()`.

The three subprocess composites, `Workspaces.layerWithGitAndConfigDependenciesSubprocess`, `Workspaces.layerWithConfigDependenciesSubprocess` and `WorkspaceCatalogs.layerWithConfigDependenciesSubprocess`, accept the same `pnpm` option.

```ts
import { ConfigDependencyHooks } from "@effected/workspaces";

const Hooks = ConfigDependencyHooks.layerSubprocessWith({
	pnpm: { command: "/opt/pnpm/bin/pnpm", env: { NPM_TOKEN: "token" } },
});
```

## Bug Fixes

The error reported when the verified fetch fails now names the command that actually ran.
