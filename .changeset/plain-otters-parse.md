---
"@effected/github-references": minor
---

## Features

First release. GitHub's issue-reference grammar as pure functions — strings in, values out, no service, no layer, no client. Extracted from `@effected/github` so a consumer with no octokit can speak the grammar without pulling in that install weight.

### Three dialects

- **Inline-in-prose** — `harvestIssueReferences` scans running text (`fixes #12 and closes #13`); whitespace mandatory, no colon, each hit carries offsets.
- **Bare-line** — `parseBareLineReference` takes a whole trimmed line as the reference (`Closes: #12`); colon optional, no offsets.
- **Closing-list** (new dialect) — `parseClosingList` / `parseReferenceList` read one whole line naming several issues at once, separated by `,`, `and`, or the Oxford `, and`:

```ts
import { parseClosingList, parseReferenceList } from "@effected/github-references";
import { Option } from "effect";

parseClosingList("Closes #247, #248 and #251");
// Option.some({ keyword: "closes", issueNumbers: [247, 248, 251] })

parseReferenceList("Refs: #12, #13");
// Option.some({ keyword: "refs", closing: false, issueNumbers: [12, 13] })
```

`REFERENCE_KEYWORDS` (`ref`, `refs`, `references`) is a separate, non-closing keyword set — GitHub does not act on these, but a references region writes them. `parseReferenceList` reports whether the matched keyword closes via its `closing` flag; `parseClosingList` is the closing-only view, returning `Option.none()` for a non-closing keyword.

Grammar rules: `#` is mandatory, whitespace inside the line is `[ \t]` only (no embedded newlines), duplicates are preserved, and an issue number past `Number.MAX_SAFE_INTEGER` rejects the whole line (unlike the prose harvest, which merely skips the one match).

Peers on `effect` only — zero runtime dependencies.
