# @effected/github-references

GitHub's issue-reference grammar as pure functions: the nine closing keywords and three dialects, strings in and values out — no service, no layer, no client. Extracted from `@effected/github` on 2026-08-17, plus follow-ups, pending its first release. 4 `src/` files, 3 test files, 58 tests.

**Tier: pure.** Peer-depends on `effect` only; zero runtime dependencies, no IO, `"sideEffects": false`. Never add a dependency here — the package exists so a consumer with no octokit can speak the grammar instead of re-deriving it.

**Design doc:** `@../../.claude/design/effected/packages/github-references.md` — load when changing a dialect, adding a keyword set, or ruling on a disagreement with a downstream hand-rolled copy.

## The three dialects

- **Inline-in-prose** — `harvestIssueReferences` (`src/IssueReferences.ts`) scans running text (`fixes #12 and closes #13`), whitespace mandatory, **no colon**, and each hit carries offsets.
- **Bare-line** — `parseBareLineReference` (`src/IssueReferences.ts`) takes the whole trimmed line as the reference (`Closes: #12`), colon **optional**, no offsets: the line *is* the reference, so an offset would restate a constant.
- **Closing-list** — `parseClosingList` / `parseReferenceList` (`src/ClosingList.ts`) read one whole line naming several issues (`Closes #247, #248 and #251`), separated by `,`, by `and`, or by the Oxford `, and`.

**One regex for all of them is the tempting simplification and it fails invisibly.** Accepting the colon inline harvests references GitHub will *not* link, so a pipeline reports an issue closing that merging leaves open. Dialects differ because producers differ — prose for GitHub's scanner, a generated region for humans. Apply that rule if a fourth dialect appears.

## Shipped 2026-08-17: four additive follow-ups

Downstream adoption drove four additive gaps, folded into the same unreleased minor — none changes a ruling above, none widens the re-export below:

- **`harvestReferenceLists(text)`** (`src/ClosingList.ts`) — the closing-list grammar worn inline (`Closes #123, Fixes #456` on one line), a gap neither shipped dialect covered; returns `HarvestedReferenceList` (`ReferenceList` plus `start`/`end`).
- **`parseBareLines`** (`src/IssueReferences.ts`), **`parseClosingLists`**, **`parseReferenceLists`** (`src/ClosingList.ts`) — apply the matching single-line parser across a whole text, one result per line, no line numbers by design.
- **`keywordFamily`** (new `src/KeywordFamily.ts`) — projects any keyword to `"close" | "fix" | "resolve" | "ref"`.
- **`collectReferenceLists(text)`** (`src/ClosingList.ts`) — per line, whole-line `parseReferenceList` first (colon-tolerant), else the line is harvested inline; replaces the trailer/prose interleave downstream hand-rolled (round-2 dogfood finding).

## Rules that are load-bearing

- **`#` is mandatory in every dialect.** `closes: 123` is rejected; GitHub won't link it, and the downstream copy that accepted it reported links GitHub never made.
- **The closing set is the canonical nine.** `REFERENCE_KEYWORDS` (`ref`, `refs`, `references`) is a **separate, non-closing** set: `parseReferenceList` reports it `closing: false`, `parseClosingList` returns `Option.none()`. Never merge the sets or drop below nine — under-linking is silent.
- `parseClosingList` is the closing-only **view** of `parseReferenceList`'s engine, not a second parser. Keep it that way.
- **Every keyword table derives from the keyword constants**, so a keyword added to either set can't drift from the grammar reading it; `closing` is membership in `CLOSING_KEYWORDS`, widened once so no call site casts.
- **The list dialect is whole-line.** Whitespace is `[ \t]` only, so an embedded newline cannot smuggle a second line in, and trailing prose **rejects** the line rather than yielding a partial reading.
- **Duplicates are preserved.** Whether `#12, #12` means one issue or two is the caller's business; collapsing them destroys evidence a caller may be linting for.
- **The unsafe-integer asymmetry is deliberate.** Past `Number.MAX_SAFE_INTEGER`, prose **skips that one match**; the list dialect **rejects the whole line** — a skipped number claims nothing, a list line claims a set. Never "fix" them into agreement.
- **ReDoS posture: one left-to-right scan, no regular expressions at all.** Linearity holds by construction, so no scanner — CodeQL included — can flag it. **No input is truncated**: truncation is the silent change a mega-regex would force. Do not add a length cap.
- **The inline harvester's two whitespace classes are deliberate — never unify them.** Keyword→first-item gap: any whitespace, newlines included. List continuation: `[ \t]` only, so a list can never cross a newline.
- **An unsafe item poisons the whole inline candidate**, not just that item — echoing the whole-line rejection, not the prose skip.
- **The inline `and` separator is lowercase-only.** `closes #1 AND #2` harvests only `#1`. Loosening it is a grammar change, not a local fix; treat a hit as a design conversation.
- **`keywordFamily` is a total `Record`, never `startsWith`.** A keyword added to either set without a family entry is a compile error, not a silent miscategorization.
- **`collectReferenceLists`'s whole-line-first preference is the once-per-posture guarantee.** A colon-less trailer line matches `parseReferenceList` and stops there; only a line it rejects reaches `harvestReferenceLists`. Never reorder the two probes — reversing them double-counts that line.

## Out of scope, on purpose

Cross-repo (`owner/repo#N`) and full-URL (`https://github.com/owner/repo/issues/N`) references; issue-*state* classification — state is not grammar; anything querying GitHub, which is `@effected/github`'s tier.

## The @effected/github compat re-export

`@effected/github` takes this package as a `workspace:^` dependency **for one reason**: it re-exports six moved names — `CLOSING_KEYWORDS`, `ClosingKeyword`, `IssueReference`, `harvestIssueReferences`, `BareLineReference`, `parseBareLineReference` — so old-home consumers keep compiling. Riders:

- The re-export is **droppable at a later `github` bump** — `github`'s `__test__/IssueReferencesCompat.test.ts` stops it lapsing silently before then.
- The closing-list surfaces are deliberately **not** re-exported from `github`. New consumers import this package; widening the surface would make it permanent by accident.

## Testing and building

Tests live in `__test__/` (3 files, 58 tests), use `@effect/vitest`, assert with `assert.*` — never `expect`. The moved suite came across **unchanged**, the check that the move was a move; do not rewrite it. The closing-list suite carries the design doc's drift rulings as executable cases, plus a hostility case pinning the linear-time posture. The 2026-08-17 cases (`KeywordFamily.test.ts` is new) pin the rules above: whitespace-class split, lowercase-only `and`, exhaustive twelve-keyword `keywordFamily` coverage, and `collectReferenceLists`'s once-per-posture preference.

```bash
pnpm vitest run --project @effected/github-references   # this package's tests
pnpm build --filter @effected/github-references         # dev + prod, from the repo root
```

Never run `node savvy.build.ts --target prod` directly. `package.json` stays `"private": true`.
