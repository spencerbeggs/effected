---
"@effected/workspaces": minor
---

## Features

### `PeerCheck`

A new pure value class detects unsatisfied peer dependencies over a parsed `@effected/lockfiles` `Lockfile`, without shelling out to any package manager's own peer command:

```ts
import { PeerCheck } from "@effected/workspaces";
import { Lockfile } from "@effected/lockfiles";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const lockfile = yield* Lockfile.parse(text, { format: "pnpm" });
  const report = PeerCheck.run(lockfile);
  return report.supported ? report.required : [];
});
```

`PeerCheck.run(lockfile, options?)` returns `{ supported, unsatisfied, unresolvedImporters, unverified }` plus a `required` getter (the non-optional unsatisfied rows). It **fails closed**: an empty `unsatisfied` array is not by itself a clean bill of health.

* `supported` is `false` for yarn, which resolves peers virtually and does not record which instance satisfied which peer.
* `unresolvedImporters` names importers (typically the root, under npm and bun) whose dependencies could not be resolved to instances, so no verdict was reached for them.
* `unverified` lists why the report may be incomplete — `"unresolvedEdge"` when some instance records an edge the lockfile model could not name, and `"peerRulesNotApplied"` (see below).

A caller must check `supported`, `unresolvedImporters` and `unverified` alongside `unsatisfied` before treating a report as clean.

### `WorkspaceCatalogs.peerDependencyRules()`

Returns the workspace's effective `peerDependencyRules` — the merged pnpm suppression rules, obtained by replaying config-dependency pnpmfile hooks the same way pnpm itself would. Pass the result to `PeerCheck.run` to replicate pnpm's suppression:

```ts
const rules = yield* workspaceCatalogs.peerDependencyRules();
const report = PeerCheck.run(lockfile, { peerDependencyRules: rules });
```

**Presence of the `peerDependencyRules` option key is the assertion, not its contents.** Omitting the option means "nobody looked" and always yields `"peerRulesNotApplied"` in `unverified`; passing the new `NoPeerDependencyRules` export asserts "I looked, there are none" and yields a verified report. Only `allowedVersions` is applied — a supplied `PeerDependencyRules` whose `ignoreMissing` or `allowAny` is non-empty also yields `"peerRulesNotApplied"`, since those suppression axes are not implemented and degrading to fail-closed beats silently ignoring them.

Also exported: `UnsatisfiedPeer`, `PeerParent` and `UnverifiedReason`.
