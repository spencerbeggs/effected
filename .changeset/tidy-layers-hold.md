---
"@effected/workspaces": minor
---

## Features

### `@effected/workspaces/testing`

A new subpath of repo-shape checks for a monorepo's own test suite. It catches the drift unit tests miss: a platform-free package starting to read `process`, a low-level package growing an edge up into an application, or a bin that resolves inside the workspace but is missing once installed from its tarball. The main entry never re-exports it, and every check refuses to pass vacuously.

- `SourceBoundary.scan({ root, rules, allow?, allowRules? })` lexes every module in a source tree and reports reads of the global `process`, forbidden imports, stdout writes and console writes. A `process` in a comment, string or regex is never a read. The rules are `"process"`, `"node:process"`, `"stdout-write"` (`stdout.write`, or `stdout.end` with a final chunk), `"console"`, `"console-stdout"` (spares the stderr-writing methods, for a stdio server) and `{ forbidImports: [...] }`.
- `allow` exempts a file from every rule. `allowRules` waives a single rule per file, and each waived offence lands in `scan.waived` instead of disappearing, so a stale waiver fails an assertion. `SourceBoundary.verifyFixtures()` proves the scanner still flags and spares what its shipped fixtures say.
- `LayerPolicy.load(path)` and `WorkspaceLayering.checkWorkspace(policy)` hold the discovered package graph to a committed `layers.json`: top-down `layers`, `tooling`, `unconstrained` globs, the dependency `fields` that count, and `requiredEdges` that must exist. Decoding is strict, so an unknown key such as a `requiredEdge` typo fails `LayerPolicyError` naming it.
- `PackedInstall.run(options)` packs a carrier and the workspace packages it needs. It installs the carrier into a fresh project outside the workspace under each requested package manager that is available (npm, pnpm, Yarn, Bun), then checks every expected bin is linked and executable. `PackedInstall.scrubEnv` gives the bins the same scrubbed environment the installs ran under. POSIX-only.

```ts
import { SourceBoundary } from "@effected/workspaces/testing";

const scan = yield* SourceBoundary.scan({
	root: SRC,
	rules: ["process", "stdout-write", { forbidImports: ["node:*", "@effect/platform*"] }],
	// main.ts hands process.stdout to a transport, but must never write to it itself.
	allowRules: { process: ["main.ts"] },
});
assert.deepStrictEqual(scan.violations, []);
```
