# @effected/github-references

GitHub's issue-reference grammar as pure functions: the nine closing keywords and three dialects, strings in and values out — no service, no layer, no client. Extracted from `@effected/github` on 2026-08-17 and pending its first release. 3 `src/` files, 2 test files, 27 tests.

**Tier: pure.** Peer-depends on `effect` only; zero runtime dependencies, no IO, `"sideEffects": false`. Never add a dependency here — the package exists precisely so a consumer with no octokit can speak the grammar instead of re-deriving it.

**Design doc:** `@../../.claude/design/effected/packages/github-references.md` — load when changing a dialect, adding a keyword set, or ruling on a disagreement with a downstream hand-rolled copy.

## The three dialects

- **Inline-in-prose** — `harvestIssueReferences` (`src/IssueReferences.ts`) scans running text (`fixes #12 and closes #13`), whitespace mandatory, **no colon**, and each hit carries offsets.
- **Bare-line** — `parseBareLineReference` (`src/IssueReferences.ts`) takes the whole trimmed line as the reference (`Closes: #12`), colon **optional**, no offsets: the line *is* the reference, so an offset would restate a constant.
- **Closing-list** — `parseClosingList` / `parseReferenceList` (`src/ClosingList.ts`) read one whole line naming several issues (`Closes #247, #248 and #251`), separated by `,`, by `and`, or by the Oxford `, and`.

**One regex for all of them is the tempting simplification and it fails invisibly.** Accepting the colon inline harvests references GitHub will *not* link, so a pipeline reports an issue as closing that merging leaves open. The dialects differ because their producers differ — prose is written by humans for GitHub's scanner, a generated region is written by tooling for humans. Apply that rule if a fourth dialect appears.

## Rules that are load-bearing

- **`#` is mandatory in every dialect.** `closes: 123` is rejected; GitHub does not link it, and the downstream copy that accepted it reported links GitHub never made.
- **The closing set is the canonical nine.** `REFERENCE_KEYWORDS` (`ref`, `refs`, `references`) is a **separate, non-closing** set: `parseReferenceList` reports it with `closing: false`, `parseClosingList` returns `Option.none()` for it. Never fold the two sets together, and never accept fewer than the nine — a narrower set silently under-links.
- `parseClosingList` is the closing-only **view** of `parseReferenceList`'s engine, not a second parser. Keep it that way.
- **Every keyword table derives from the keyword constants** rather than spelling them again, so a keyword added to either set cannot drift from the grammar that reads it; `closing` is membership in `CLOSING_KEYWORDS`, widened once so no call site casts.
- **The list dialect is whole-line.** Whitespace is `[ \t]` only, so an embedded newline cannot smuggle a second line past a parser whose contract is one line, and trailing prose **rejects** the line instead of yielding a partial reading of something the parser did not understand.
- **Duplicates are preserved.** Whether `#12, #12` means one issue or two is the caller's business; collapsing them destroys evidence a caller may be linting for.
- **The unsafe-integer asymmetry is deliberate.** Digits past `Number.MAX_SAFE_INTEGER` make the prose harvest **skip that one match** but reject the **whole line** in the list dialect: surrounding prose makes no claim about the skipped number, while a list line is a single claim about a set of issues that a partial result misrepresents. Never "fix" the two sides into agreement.
- **ReDoS posture: the list dialect is a single left-to-right character scan, and the module contains no regular expressions at all.** Linearity holds by construction, not by review, so there is no backtracking engine for a scanner — CodeQL included — to flag. That is why **no input is truncated**: truncation is a silent semantic change (a long line's tail stops existing) adopted downstream to defend a mega-regex this package does not have. Do not add a length cap.

## Out of scope, on purpose

Cross-repo (`owner/repo#N`) and full-URL (`https://github.com/owner/repo/issues/N`) references; issue-*state* classification, because state is not grammar; anything that queries GitHub, which is `@effected/github`'s tier. An inline **list-aware** harvester — `Closes #123, Fixes #456` on one line, which neither shipped family reads — is filed as effected#402, with per-line text-level helpers (#403) and a keyword-family projection (#404). All three are additive; none licenses widening the compat re-export below.

## The @effected/github compat re-export

`@effected/github` takes this package as a regular `workspace:^` dependency **for one reason**: it re-exports exactly the six moved names — `CLOSING_KEYWORDS`, `ClosingKeyword`, `IssueReference`, `harvestIssueReferences`, `BareLineReference`, `parseBareLineReference` — from its entrypoint so consumers that adopted the grammar in its old home keep compiling. Riders:

- The re-export is **droppable at a later `github` bump**, and `github`'s `__test__/IssueReferencesCompat.test.ts` is what stops it lapsing silently before then.
- The closing-list surfaces are deliberately **not** re-exported from `github`. New consumers import this package; widening the compat surface would make it permanent by accident.

## Testing and building

Tests live in `__test__/` (2 files, 27 tests), use `@effect/vitest` and assert with `assert.*` — never `expect`. The moved suite came across **unchanged**, which is the check that the move was a move; do not rewrite it. The closing-list suite carries the design doc's drift rulings as executable cases, plus a hostility case pinning the linear-time posture.

```bash
pnpm vitest run --project @effected/github-references   # this package's tests
pnpm build --filter @effected/github-references         # dev + prod, from the repo root
```

Never run `node savvy.build.ts --target prod` directly. `package.json` stays `"private": true`.
