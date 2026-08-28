# @effected/github-references

GitHub's issue-reference grammar as pure functions: the nine closing keywords, the three separate reference-keywords, and **three dialects** for reading them out of commit messages, PR bodies and generated trailer blocks. Strings in, values out — no service, no layer, no client. Pure tier: peers only on `effect`, zero runtime dependencies, no IO, `"sideEffects": false`. It exists because the grammar and the GitHub *client* have opposite dependency costs: it was extracted from `@effected/github` on 2026-08-17 during a dogfood loop with a consumer that had zero octokit and would otherwise have dragged the whole client in for forty lines of grammar; the extracted engine was verified across three rounds against the original with zero discrepancies. **Reach for this before hand-rolling a regex** — every hand-rolled copy is a re-derivation of a vendor rule, and the recorded ones got the dialects wrong.

## Import

```ts
import { CLOSING_KEYWORDS, REFERENCE_KEYWORDS, collectReferenceLists, harvestIssueReferences, parseClosingList } from "@effected/github-references";
```

Single entrypoint; no subpaths. `@effected/github` re-exports six of these names (`CLOSING_KEYWORDS`, `ClosingKeyword`, `IssueReference`, `harvestIssueReferences`, `BareLineReference`, `parseBareLineReference`) as a **droppable compat shim** for consumers that predate the move — this package is canonical, and the closing-list surface is deliberately not re-exported from `github`.

## The three dialects

Picking the wrong one is the failure mode this package exists to prevent, so route by producer:

| Dialect | Function | Shape | Colon | Offsets |
| --- | --- | --- | --- | --- |
| Inline-in-prose | `harvestIssueReferences`, `harvestReferenceLists` | `fixes #12 and closes #13` inside running text | **rejected** | yes |
| Bare-line | `parseBareLineReference` | the whole trimmed line is the reference: `Closes: #12` | optional | no |
| Closing-list | `parseReferenceList`, `parseClosingList` | one whole line naming several: `Closes #247, #248 and #251` | optional | no |

**One regex for all three is the tempting simplification and it fails invisibly.** Accepting the colon inline harvests references GitHub will *not* link, so a pipeline reports an issue closing that merging leaves open.

## Feature surface

| Reach for | When |
| --- | --- |
| `collectReferenceLists(text)` | **the default for a whole commit body or PR description** — the trailer/prose interleave, done right |
| `harvestIssueReferences(text)` | inline prose, one issue per hit, with offsets for highlighting or rewriting |
| `harvestReferenceLists(text)` | inline prose where one keyword names several issues; hits carry `start`/`end` |
| `parseBareLineReference(line)` / `parseBareLines(text)` | a generated region where each line *is* one reference |
| `parseReferenceList(line)` / `parseReferenceLists(text)` | a whole line naming several issues, closing **or** `Refs:` |
| `parseClosingList(line)` / `parseClosingLists(text)` | the same, filtered to closing keywords only |
| `keywordFamily(keyword)` | collapse twelve spellings to `"close" \| "fix" \| "resolve" \| "ref"` |
| `CLOSING_KEYWORDS` / `REFERENCE_KEYWORDS` | the canonical sets themselves |

## Core API

- **`CLOSING_KEYWORDS`** — the canonical nine, lowercase: `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, `resolved`. `ClosingKeyword` is the derived union. **`REFERENCE_KEYWORDS`** (`ref`, `refs`, `references`) is a **separate, non-closing** set with its own `ReferenceKeyword` type. Never merge them: a `Refs:` line links without closing, and treating it as closing over-reports.
- **`harvestIssueReferences(text)`** → `ReadonlyArray<IssueReference>` — every inline reference in document order. `IssueReference` is `{ issueNumber, keyword: ClosingKeyword, start, end }`. Closing keywords only; **no colon** accepted; whitespace between keyword and `#` is mandatory. Reads only the *first* issue of a multi-issue inline list — use `harvestReferenceLists` for that shape.
- **`harvestReferenceLists(text)`** → `ReadonlyArray<HarvestedReferenceList>` — the list grammar worn inline. `HarvestedReferenceList` extends `ReferenceList` with `start`/`end`. Both keyword sets, `closing` reported by set membership; word boundaries hold on both sides (`recloses #1` does not match); the keyword→first-item gap accepts **any** whitespace including newlines, while list continuation accepts `[ \t]` only, so a list can never cross a line. A list ends at its last valid item: `closes #1 and fixes #2` yields `closes: [1]` then `fixes: [2]`.
- **`parseReferenceList(line)`** → `Option<ReferenceList>` — the whole-line dialect, both keyword sets. `ReferenceList` is `{ keyword, closing: boolean, issueNumbers }`. Colon-tolerant; separators are `,`, ` and `, or the Oxford `, and`; whitespace is `[ \t]` only. Trailing prose **rejects the whole line** rather than yielding a partial reading. **`parseClosingList(line)`** → `Option<ClosingList>` is the closing-only *view* of the same engine (a `Refs:` line gives `Option.none()` here, `closing: false` there), not a second parser.
- **`parseBareLineReference(line)`** → `Option<BareLineReference>` — `{ issueNumber, keyword: ClosingKeyword }`, no offsets by design: the line *is* the reference, so an offset would restate a constant. Colon optional.
- **`parseBareLines`, `parseReferenceLists`, `parseClosingLists`** — apply the matching single-line parser across a whole text, one result per matching line, in document order. **No line numbers**, deliberately.
- **`collectReferenceLists(text)`** → `ReadonlyArray<ReferenceList>` — the composition consumers otherwise hand-roll. Per line: whole-line `parseReferenceList` first (colon-tolerant), and only a line it rejects is harvested inline. That ordering is the **once-per-posture guarantee** — reversing the two probes double-counts a colon-less trailer line. No offsets; use `harvestReferenceLists` directly if you need spans.
- **`keywordFamily(keyword)`** → `KeywordFamily` — a total `Record` lookup over all twelve keywords, never a `startsWith`, so a new keyword without a family entry is a compile error rather than a silent miscategorization.

## Usage

```ts
import { collectReferenceLists, keywordFamily } from "@effected/github-references";

const body = "Rework the parser.\n\nCloses #247, #248 and #251\nRefs: #12";
for (const list of collectReferenceLists(body)) {
  console.log(list.keyword, keywordFamily(list.keyword), list.closing, list.issueNumbers);
}
// closes close true [247, 248, 251]
// refs   ref   false [12]
```

## Gotchas

- **`#` is mandatory in every dialect.** `closes: 123` is rejected — GitHub will not link it, and the hand-rolled copy that accepted it reported links GitHub never made.
- **Duplicates are preserved.** Whether `#12, #12` means one issue or two is the caller's business; collapsing them destroys evidence a caller may be linting for.
- **The unsafe-integer asymmetry is deliberate.** Past `Number.MAX_SAFE_INTEGER`, inline prose **skips that one match**; a list candidate or a whole line is **rejected entirely** — a skipped number claims nothing, a list claims a set. Never "fix" them into agreement.
- **The inline `and` separator is lowercase-only.** `closes #1 AND #2` harvests only `#1`. Loosening it is a grammar change, not a local fix.
- **No regular expressions at all** in the list module: one left-to-right character scan, linear by construction, and **no input is truncated** — so do not add a length cap "for safety".
- **Out of scope on purpose:** cross-repo (`owner/repo#N`) and full-URL references, and issue-*state* classification — state is not grammar. Anything that queries GitHub is `@effected/github`'s tier.
