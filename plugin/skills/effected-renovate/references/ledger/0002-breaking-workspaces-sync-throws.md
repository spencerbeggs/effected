---
id: "0002"
title: "@effected/workspaces: getWorkspacePackagesSync throws where it returned no packages"
kind: breaking
shows: behavioural
applies:
  "@effected/workspaces": ">=0.46.0"
detect: ["getWorkspacePackagesSync"]
changesets: ["workspaces-sync-throws"]
closes: ["spencerbeggs/effected#1292"]
---

The sync facade used to return an empty or fallback list when discovery failed, so a broken workspace read as one with no packages. It now throws the Effect surface's typed errors. The signature is unchanged, so the compiler finds nothing; a test or a run does.

- `WorkspaceDiscoveryError` with reason `read`, when `pnpm-workspace.yaml` exists but cannot be read, or the root `package.json` pattern source cannot be read.
- `WorkspaceDiscoveryError` with reason `invalidYaml` or `invalidJson`, when either fails to parse.
- `WorkspacePatternError` with reason `uncompilable`, when the patterns do not compile as one `GlobSet`.

At each call the search matched, decide what a broken workspace should do there:

- **A command or hook that should fail loudly** needs no change: let it throw, or catch it at the top and report the error's message.
- **A caller that relied on the empty answer**, such as a best-effort lookup that falls back to the root package, wraps the call in `try`/`catch` and keeps its fallback in the `catch`. Narrow on the two error classes, so an unrelated throw is not swallowed.
- **A test that mocks the facade** (`vi.fn(() => [])`) is unaffected. A test that fed it a malformed `pnpm-workspace.yaml` or `package.json` and asserted an empty list now sees a throw; assert the error instead.

Read the installed `.d.ts` for the error classes and their `reason` values. Verify by running the call against a fixture with an unparseable `pnpm-workspace.yaml` and confirming the outcome your caller chose.
