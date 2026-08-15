---
"@effected/workspaces": minor
---

## Breaking Changes

`DetectedPackageManager` gains a required `evidence` field — the `PackageManagerEvidence` literal naming which detection rung decided the manager (`"pnpm-workspace.yaml"`, `"package.json#packageManager"`, etc.), mirroring the vocabulary `PackageManagerDetectionError.checked` already reported on the failure path. A hand-constructed `DetectedPackageManager` (a test double, a fixture) must now supply it:

```ts
import { DetectedPackageManager } from "@effected/workspaces";
import { Option } from "effect";

DetectedPackageManager.make({
	name: "pnpm",
	version: Option.none(),
	runtime: "node",
	evidence: "pnpm-workspace.yaml",
});
```

## Bug Fixes

* `ConfigDependencyHooks`' dynamic import of the pnpm plugin now carries an inline `webpackIgnore` comment, so a webpack-family bundler no longer emits an unsilenceable Critical-dependency warning for a consumer that composes `layerSubprocess` — the target module stays droppable by tree-shaking regardless.
