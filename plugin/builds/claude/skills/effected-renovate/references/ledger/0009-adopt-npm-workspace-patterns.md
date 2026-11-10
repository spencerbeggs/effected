---
id: "0009"
title: "@effected/npm: NpmWorkspacePatterns.matcherResult reads a workspaces field by npm's own rules"
kind: adopt
shows: none
applies:
  "@effected/npm": ">=0.34.0"
detect: ["map-workspaces", "from[[:space:]]+[\"']minimatch[\"']"]
changesets: ["npm-workspace-patterns"]
closes: ["spencerbeggs/effected#1286"]
---

Offer this to the user; never apply it unasked. It replaces a hand-rolled copy of `@npmcli/map-workspaces`, or a `minimatch` loop that decides which directories an npm root's `workspaces` field declares.

`NpmWorkspacePatterns.matcherResult(field)` takes the field as found, of any shape, and returns a `Result` of a predicate over relative POSIX directories, or a typed `NpmWorkspacePatternsError` when the field passes a ceiling. It follows npm's rules, which are not `GlobSet`'s: the array or the array under `packages`; odd leading `!` runs negate; negations are ordered, so a later positive can cancel one; positives match without `dot`, and a backslash is a separator; anything under `node_modules` is ignored.

Only swap a call whose answer must agree with npm's. `@effected/workspaces` discovery keeps `GlobSet` semantics for npm roots, so the two can differ on the same field; a caller that already uses that discovery should keep it. Pin the current answers on the repository's real `workspaces` fields in a test before swapping. Read the installed `.d.ts` for the exact shapes.
