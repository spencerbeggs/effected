---
"@effected/github": minor
---

## Refactoring

The issue-reference grammar (`harvestIssueReferences`, `parseBareLineReference`, `CLOSING_KEYWORDS` and friends) moved to the new `@effected/github-references` package, which `@effected/github` now takes as a regular dependency. The six moved names remain re-exported from this package's entrypoint, so existing consumers keep working with no changes required:

```ts
// Still works, unchanged:
import { CLOSING_KEYWORDS, harvestIssueReferences, parseBareLineReference } from "@effected/github";
```

The new closing-list dialect (`parseClosingList`, `parseReferenceList`) added to `@effected/github-references` is deliberately **not** re-exported here — new consumers should import `@effected/github-references` directly, especially those that don't need octokit at all.

This compat re-export is droppable at a later bump; the underlying grammar now lives in `@effected/github-references`.
