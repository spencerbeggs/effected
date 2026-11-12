---
id: "0013"
title: "@effected/workspaces: an npm root's workspaces field is read by npm's own rules, not as a GlobSet"
kind: behaviour
shows: behavioural
applies:
  "@effected/workspaces": ">=0.47.0"
detect: ["(getWorkspacePackagesSync|WorkspaceDiscovery|WorkspaceSnapshots)[^A-Za-z]"]
changesets: ["workspaces-npm-rules"]
closes: ["spencerbeggs/effected#1329"]
---

On a root that package-manager detection calls npm, workspace discovery, the sync facade and `WorkspaceSnapshots` now read `package.json#workspaces` the way npm does. They no longer read it as a `GlobSet`. pnpm, yarn and bun roots are unchanged. The member list only changes when the field uses one of these seven shapes:

- **An ordered negation.** A later positive cancels an earlier `!` pattern, so `["packages/*", "!packages/a", "packages/a"]` keeps `packages/a`. It used to be dropped.
- **A trailing `/`.** `packages/*/` now declares the directories under `packages`, where it used to declare none. `!packages/a/` now excludes `packages/a`, where it used to exclude nothing.
- **An even run of `!`.** `!!packages/a` is now a positive.
- **A backslash.** `packages\a` now declares `packages/a`.
- **A leading `./` or `/`.** npm strips it, so `./packages/*` now declares the directories under `packages`, where it used to declare none.
- **A trailing `/.`.** npm drops it, so `packages/*/.` now declares the directories under `packages`, where it used to declare none.
- **A path under `node_modules`.** npm never matches a directory inside `node_modules`, so `node_modules/local` now declares nothing.

A field past npm's matcher ceilings now fails, where it used to be read. The ceilings are 1,000 patterns, 32 wildcard patterns, 256 brace alternatives and 256 characters for a matched pattern. The failure is the same typed error an uncompilable pattern set already gave: `WorkspacePatternError` with kind `uncompilable`, or `CatalogAssemblyError` from `WorkspaceSnapshots.at`. Its new optional `cause` carries `NpmWorkspacePatternsError`.

Where the search matched a call into discovery, find the repositories it runs against. In this one, and in any test fixture it uses, check whether the root is npm's: it has a `workspaces` field and no `pnpm-workspace.yaml`, and no bun lockfile (`bun.lock` or `bun.lockb`) or `yarn.lock` whose manager the manifest declares. The declared manager is `devEngines.packageManager.name` when that is set, and `packageManager` only otherwise, so a `yarn.lock` beside a `devEngines` naming npm is still npm's root. Then check the field for the seven shapes above, and count it against the matcher ceilings. If it has none of the shapes and stays under every ceiling, nothing changes. If it passes a ceiling, discovery now fails with `WorkspacePatternError`: shorten the field, for example by merging patterns into one wildcard. If it has a shape, compare the member list before and after the upgrade. npm's answer is the one npm installs, so update a test that pinned the old answer. Read the installed `.d.ts` for `WorkspacePatternError`.
