---
"@effected/github": minor
---

## Features

### `GitHubIssue.commentOnce`

Post a marked comment on an issue exactly once — create it, or skip if it's already there:

```ts
import { CommentMarker } from "@effected/github";

const marker = CommentMarker.make({ namespace: "my-action", key: "status" });
const result = yield* issues.commentOnce(42, marker, "Build succeeded.");
// result.wrote: true if this call created the comment, false if it already existed
// result.comment: the marked comment either way
```

This is create-or-skip, never edit — the counterpart to `PullRequestComment.upsert`, which edits in place. The marker is appended to the body exactly as `upsert` formats it, so either surface can find the other's comment; the existence check paginates the issue's comments looking for it. Closes effected#306.

### `IssueReferences`

A new pure module for GitHub's closing-keyword reference grammar — no service, no layer, just strings in and values out:

```ts
import { CLOSING_KEYWORDS, harvestIssueReferences, parseBareLineReference } from "@effected/github";

harvestIssueReferences("fixes #12 and closes #13");
// every inline closing reference in the text, in document order, each with its keyword and offsets

parseBareLineReference("Closes: #12");
// Option.some({ issueNumber: 12, keyword: "closes" }) — the bare-line dialect, colon optional
```

`harvestIssueReferences` covers the inline-in-prose dialect GitHub itself scans PR bodies for (mandatory whitespace, no colon); `parseBareLineReference` covers a generated references region's one-reference-per-line dialect (colon optional). `CLOSING_KEYWORDS` lists the nine documented keywords both dialects derive from. Closes effected#194.
