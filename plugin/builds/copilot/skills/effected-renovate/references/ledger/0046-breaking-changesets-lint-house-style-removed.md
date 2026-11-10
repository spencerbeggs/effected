---
id: "0046"
title: "@effected/changesets/lint drops the CSH001 to CSH005 style rules for style-neutral front-matter rules"
kind: breaking
shows: typed
applies:
  "@effected/changesets": ">=0.3.0"
detect: ["ChangesetLint\\.(rules|headingHierarchy|requiredSections|contentStructure|uncategorizedContent|dependencyTableFormat)", "ChangesetLint\\.lint\\("]
changesets: ["changesets-release-application"]
---

This applies to a repository that lints changesets with `@effected/changesets/lint`. CSH001 to CSH005 are savvy-web's changeset house style, and savvy-web owns them. The kit no longer ships them: `ChangesetLint.rules`, `ChangesetLint.headingHierarchy`, `requiredSections`, `contentStructure`, `uncategorizedContent` and `dependencyTableFormat` are gone, and a reference to any of them fails to compile.

- If you enforce that style, take the rules from savvy-web's silk, which provides them, and pass them to `MarkdownlintAdapter.rules` or `MarkdownLint.lint` as before.
- `ChangesetLint.defaults` holds the new style-neutral rules, which check only what the changesets tool itself refuses: `CF001` (front matter present, YAML, a mapping when not empty), `CF002` (every key a package name) and `CF003` (every value `major`, `minor`, `patch` or `none`). `ChangesetLint.knownPackages(names)` adds `CF004`, which checks that each named package is in the workspace. Run them beside the house rules: `MarkdownlintAdapter.rules([...ChangesetLint.defaults, ...houseRules])`.
- **`ChangesetLint.lint(text)` still compiles but checks only the defaults now**, so a call that relied on it for the style rules silently stops reporting them. Pass the house rules as `ChangesetLint.lint(text, { rules: houseRules })`, and `packages` for `CF004`.
- A markdownlint config that enabled the rules by name (`CSH001: true`, or `changeset-heading-hierarchy`) needs the house rules' names, plus `CF001` to `CF003` if you run the defaults.

Check the installed `.d.ts` for the exact shapes. Verify by linting a changeset that breaks a style rule and one with a broken front matter, and confirming each is reported.
