---
status: current
module: effected
category: architecture
created: 2026-08-17
updated: 2026-08-17
last-synced: 2026-08-17
completeness: 92
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../package-setup.md
  - ../migration-playbook.md
  - github.md
  - github-resources.md
---

# @effected/github-references design

## Overview

`@effected/github-references` is GitHub's issue-reference grammar as pure functions: the nine closing keywords, the two dialects [`@effected/github`](github.md) shipped in 0.6.0, and a third **closing-list** dialect (`Closes #247, #248 and #251`) added here. Strings in, values out — no service, no layer, no client.

It exists because the grammar and the GitHub *client* have opposite dependency costs. effected#194 shipped the grammar inside `@effected/github` (`src/IssueReferences.ts`), with extraction reserved as the cheap 0.x move if a consumer balked at the octokit install weight. savvy-web/systems#507 recorded that balk: `@savvy-web/silk-effects` has zero octokit and is the foundation dependency of three downstream packages, so adopting the grammar would have dragged `@octokit/core`, `plugin-paginate-rest`, `blakejs`, `tweetnacl` and `universal-github-app-jwt` into every install of all four — for roughly forty lines of pure regex. effected#399 is the extraction ask, driven by a live dogfood loop with savvy-web/systems.

The package was **built 2026-08-17 and is pending its first release** — the extraction and the new dialect landed together, and the adoption that drove them ran against the workspace rather than against a published version.

The judgement that put the grammar in `github` was not wrong — [pure-but-GitHub-shaped belongs in the kit rather than in a consumer](github.md#bundle-reachability), because the grammar is a *vendor rule* and every hand-rolled copy is a re-derivation of it. What the balk established is that hosting it beside the client makes the rule unreachable for exactly the consumers most likely to re-derive it.

## Tier and dependencies

**Pure tier.** `effect` is the only peer; zero regular dependencies ([R1](../effect-standards.md#dependency-policy)), no services, no layers, no `R` anywhere, `sideEffects: false`. The whole package is regex and string work.

The dependency arrow points **at** this package: `@effected/github` takes it as a regular `workspace:^` dependency (see [compatibility](#the-github-compat-re-export)).

## Naming

`@effected/github-references`, directory `packages/github-references`. The issue's first suggestion, `github-refs`, is rejected on two counts: inside the GitHub domain "refs" is already git-refs vocabulary (`refs/heads/...`), so the short name names the wrong thing, and house style is unabbreviated.

## Ask 1: the move is a straight move

`IssueReferences.ts` moved **verbatim** — a 100% rename in the diff, module name kept, its test moving with it. No API was invented on the way, no signature "improved", nothing renamed. The six names that moved are the six `github` already exported:

`CLOSING_KEYWORDS`, `ClosingKeyword`, `IssueReference`, `harvestIssueReferences`, `BareLineReference`, `parseBareLineReference`.

Everything the module's header documents stays true here, including its exclusions: cross-repo (`owner/repo#N`) and full-URL (`https://github.com/owner/repo/issues/N`) references remain **out of scope**. The two-dialect rationale is unchanged, and it now lives here rather than in [github-resources.md](github-resources.md#the-closing-reference-grammar-moved-to-effectedgithub-references), which points at this doc since the move.

### The two moved dialects

- **Inline-in-prose** (`harvestIssueReferences`) scans running text — `"fixes #12 and closes #13"` — with mandatory whitespace and **no colon**, because that is the spelling GitHub's own scanner honours when it decides what a pull request closes. This is what a release pipeline harvests out of commit subjects and PR bodies.
- **Bare-line** (`parseBareLineReference`) takes the whole trimmed line as the reference — `"Closes: #12"` — with an **optional** colon, because a generated references region writes one reference per line and the colon reads better there.

**One regex for both is the tempting simplification and it is wrong in a way nobody would notice.** Accepting the colon inline would harvest references GitHub will *not* link, so a pipeline would report an issue as closing when merging the pull request leaves it open. The dialects differ because their producers differ — prose is written by humans for GitHub's scanner, the region is written by tooling for humans — and that is the rule applied when [the third dialect](#ask-2-the-closing-list-dialect) showed up.

Two smaller decisions ride along unchanged: an inline reference carries **offsets** and a bare-line one deliberately does not (the line *is* the reference, so an offset would be a constant restated), and in prose a digit run outside the safe-integer range is **skipped rather than parsed**, since rounding it silently yields a different, existing issue number — the behaviour the list dialect deliberately [contrasts with](#grammar).

Keeping the move mechanical is what makes it reviewable as a move: a straight move plus a new module is two diffs a reader can check independently, where a move-and-redesign is one diff nobody can.

### The github compat re-export

`@effected/github` **re-exports exactly the six moved names** from its entrypoint, so silk-release-action's existing imports keep working untouched — the extraction must not be a breaking change for the consumer that already adopted the grammar in its old home.

Two riders:

- The compat re-export is **droppable at a later `github` bump**, once consumers import from the new home. It is a migration affordance, not a permanent surface.
- The new closing-list surfaces are deliberately **not** re-exported from `github`. New consumers import the new package; widening the compat surface would make the re-export permanent by accident.

**The promise is a test, not a comment.** `github`'s `__test__/IssueReferencesCompat.test.ts` exercises the three value exports through the entrypoint and annotates values with the three type exports, so compiling *is* the assertion for the types. A future bump that drops the re-export deletes that suite deliberately, which is the point: the surface cannot lapse silently.

## Ask 2: the closing-list dialect

New module `src/ClosingList.ts` — the third dialect, `Closes #247, #248 and #251`, driven day-one by two savvy-web/systems call sites: a commitlint closes-trailer rule (closing keywords only) and a changesets harvester that categorizes `Closes` / `Fixes` / `Refs`.

Surface:

- `interface ClosingList { keyword: ClosingKeyword; issueNumbers: ReadonlyArray<number> }` with `parseClosingList(line): Option.Option<ClosingList>` — **closing keywords only**.
- `REFERENCE_KEYWORDS = ["ref", "refs", "references"]` / `ReferenceKeyword`, `interface ReferenceList { keyword: ClosingKeyword | ReferenceKeyword; closing: boolean; issueNumbers: ReadonlyArray<number> }` with `parseReferenceList(line): Option.Option<ReferenceList>` — the **superset**, also accepting the non-closing Refs category, because GitHub's linker links `Refs #N` without closing it. `closing` is the discriminator, and `parseClosingList` is the closing-only *view* of the same engine rather than a second parser.

Two functions and one grammar: the commitlint rule needs the strict closing view, the changesets harvester needs the categorized superset, and a consumer that fused them would either link nothing for `Refs` or claim `Refs` closes something.

### Grammar

A **whole-line dialect**, the bare-line posture rather than the prose one — after trimming, the *entire* line must be `<keyword>[:] <ref-list>`:

- Keyword is **case-insensitive**, and the result carries the **canonical lowercase** form.
- The colon is **optional**, as in bare-line.
- Whitespace is `[ \t]` only. Embedded newlines therefore cannot smuggle a second line into a single parse, matching bare-line's posture — a parser told "this is one line" must not silently accept two.
- List items are `#<digits>`, separated by `,`, by `and`, or by the Oxford `, and`. At least one item is required.
- **`#` is mandatory.**
- Trailing prose **rejects the line** — a whole-line dialect that ignored a tail would report a partial reading of a line it did not actually understand.
- **Duplicates are preserved.** Deduplication is the caller's business; a parser that silently collapses `#12, #12` has destroyed evidence the caller might be linting for.
- Any item whose digits exceed `Number.MAX_SAFE_INTEGER` **rejects the whole line**. This is the deliberate contrast with `harvestIssueReferences`, which *skips* an unsafe match in prose: in prose the surrounding text is not a claim about the skipped number, but in a list a partial result misrepresents the line as referencing fewer issues than it does.

As built, the head pattern is **derived from the two keyword constants** rather than spelled a second time, so a keyword added to either set cannot drift from the grammar that reads it — and `closing` is membership in `CLOSING_KEYWORDS`, tested once against a widened set so no call site casts.

## Drift settlements

Three downstream hand-rolled copies of this grammar disagreed with each other. The kit is the place that settles the disagreement, and each settlement is a ruling, not an average:

| Question | Settlement |
| --- | --- |
| Keyword set | **The canonical nine GitHub documents.** Narrower downstream variants converge upward; a consumer accepting fewer keywords than GitHub silently under-links. |
| Bare `closes: 123` | **Rejected — `#` is mandatory.** Downstream's acceptance was drift, not grammar: GitHub requires `#` for a same-repo closing reference, so accepting the bare number reports a link GitHub will not make. |
| The `Refs` category | **A separate, non-closing keyword set**, surfaced through `parseReferenceList` with `closing: false`. Folding it into the closing set was the other available answer and it is wrong for the same reason as the row above. |
| ReDoS posture | **Anchored keyword head, then an iterative tokenizer** over the list. No nested-quantifier mega-regex, so **no input truncation is needed** — contrast downstream's 10,000-character truncation, which is a silent semantic change (a long line's tail simply stops existing) adopted to defend a regex this package does not have. |

**One accepted behavior delta**, agreed downstream in advance: the kit's `[ \t]+` separator is tighter than their `\s+`. It is the same choice as the newline rule above — a whole-line dialect whose separator class contains newlines is not really a whole-line dialect.

## Known future surface

The package shipped as designed and the first downstream adoption — savvy-web/systems round 1 — reported **zero discrepancies** against the rulings above. What it did surface is three *additive* gaps, each filed rather than absorbed, because none of them changes a ruling and all three are shapes a second consumer should confirm:

| Ticket | Gap |
| --- | --- |
| [effected#402](https://github.com/spencerbeggs/effected/issues/402) | **An inline, list-aware harvester.** The two shipped families each cover half of GitHub's real inline grammar — `harvestIssueReferences` is inline but one `#N` per match and ignores the reference keywords, `parseReferenceList` does lists and `Refs` but whole-line only. `Closes #123, Fixes #456` on one line is a spelling GitHub links and neither reads; it was the adoption's one real breakage, worked around downstream by declaring trailers whole-line. |
| [effected#403](https://github.com/spencerbeggs/effected/issues/403) | **Text-level conveniences.** All three downstream call sites open with the same `split("\n")` + per-line parse + `Option`-collect loop. A per-dialect text-level form would erase it. |
| [effected#404](https://github.com/spencerbeggs/effected/issues/404) | **A keyword-family projection.** Categorizing the nine keywords into close/fix/resolve families is stringly at the consumer (`keyword.startsWith("fix")`), which a `keywordFamily` helper or a family field on the results would make total and typo-proof. |

All three are purely additive to the surface below; none is licence to widen the [`github` compat re-export](#the-github-compat-re-export).

## Out of scope, recorded

- **Cross-repo and full-URL references.** Inherited from the moved module's header; neither dialect's consumers emit them, and guessing their shape would freeze an API nobody has driven.
- **`LinkedIssueRef.isClosed`-style state classification.** Issue *state* is not grammar; a second consumer should drive it, and the first will likely want it from the client rather than from a parser.
- **A `@changesets/get-github-info` replacement.** That is API-tier work — it queries GitHub — so it belongs to [`@effected/github`](github.md) if anywhere, never to a pure grammar package.

## Testing

`@effect/vitest`, `assert.*` — never `expect`; tests in `__test__/`. The moved suite comes with the moved module unchanged, which is the check that the move was a move. The new dialect's suite carries the table above as executable rulings: keyword casing and canonicalization, optional colon, each separator form including the Oxford comma, single-item lists, mandatory `#` (the bare-number rejection cited to the drift row), trailing-prose rejection, duplicate preservation, the whole-line rejection on an unsafe digit run beside `harvestIssueReferences`'s skip-in-prose behavior for contrast, and tab-versus-newline separator handling. A hostility case pins the ReDoS posture — a pathological long line parses in linear time and is neither truncated nor hung on.
