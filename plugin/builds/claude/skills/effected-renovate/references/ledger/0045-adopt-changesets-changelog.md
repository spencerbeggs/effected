---
id: "0045"
title: "Changelog renders and inserts CHANGELOG blocks, and ChangelogFunctions replaces @changesets/types' contract"
kind: adopt
shows: none
applies:
  "@effected/changesets": ">=0.3.0"
detect: ["@changesets/types", "@changesets/changelog-git", "ChangelogFunctions", "GetReleaseLine", "GetDependencyReleaseLine", "ModCompWithPackage"]
changesets: ["changesets-release-application"]
---

Offer this to the user; never apply it unasked. It fits a changelog module typed against `@changesets/types`, and code that leaves CHANGELOG rendering to `@changesets/apply-release-plan`.

- `ChangelogFunctions`, `GetReleaseLine`, `GetDependencyReleaseLine`, `NewChangesetWithCommit`, `ModCompWithPackage`, `ComprehensiveRelease`, `PackageJSON` and `VersionType` come from `@effected/changesets` under the same names. They are structurally identical to `@changesets/types`, so a module typed against them still loads under `@changesets/cli`. Switch the import path and drop the `@changesets/types` dependency. The data shapes (`NewChangesetWithCommit`, `ModCompWithPackage`, `PackageJSON`, `ComprehensiveRelease`, `VersionType`) are also Effect schemas under the same names, so a module can decode what it is handed instead of trusting it; `PackageJSON` keeps a manifest's unknown keys.
- `Changelog.entry(plan, release, functions, { packages, config, commits?, changelogOptions? })` is an `Effect` of the block text, `Option.none()` for a `none` entry. You load the module and pass its functions; the package never resolves a module id. You also supply `commits`, keyed by the changeset's `file`, if your lines credit commits. Each updated dependency's `packageJson` is its whole manifest, as `@changesets/cli` passes it, so a module reading keys beyond the name, version and dependencies keeps working.
- `Changelog.insert(existing, block, packageName)` puts the block into the file's text. Pass `""` for a file that does not exist yet.
- A function that throws or rejects fails `ChangelogError`.

Check the installed `.d.ts` for the exact shapes. Verify by rendering every release of a plan and diffing the files against those `changeset version` writes, with the formatter off on both sides.
