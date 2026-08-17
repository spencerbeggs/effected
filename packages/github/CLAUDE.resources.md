# Resource services — @effected/github

Child context file for the domain half: one service per GitHub noun, the
configuration-write six, the pure closing-reference grammar, and the landmines a
write can step on. The package-wide rules live in the parent; this file is what a
resource author needs on top of them.

**Parent:** [CLAUDE.md](./CLAUDE.md)
**Design depth:**
`@../../.claude/design/effected/packages/github-resources.md`

---

## Repository settings live on `GitHubRepository`

A settings resource was ported in and folded away the same day: the endpoint it
wanted was one `GitHubRepository` already owned, so **there is no settings
service.** Module-per-*concept* is what decided that, not size.

The fold cost a failure worth remembering. The ported module's name collided
with the `RepositorySettings` **type alias** the entry point already exported,
and **nothing said so** — `tsc`, the bundler and API Extractor all accept a
collision when a valid export of that name exists. Ten green tests, no
warnings, and a module no consumer could import.
`__test__/reachability.test.ts` now asserts **every module in `src/` is
re-exported from `src/index.ts`**; the per-module suites cannot catch it,
because nearly every test imports its module path directly.

## A normaliser must accept the form its own parameter type declares

`GitHubRepository.updateSettings` normalises for the shape a human writing
config produces: a bare `"enabled"` in `security_and_analysis` becomes
`{ status: "enabled" }`, and a merge key whose owning strategy is being
disabled is dropped rather than sent into a 422.

**It must also pass the already-typed form through untouched.**
`RepositoryPatch` is GitHub's own parameter type, so `{ status: "enabled" }` is
what the types instruct a caller to send — and the first version **silently
discarded that block** while the request still returned 200. The consumer who
wrote the normaliser could not hit it: their own schema emits only the bare
string, so the next caller, reading the types, hits it first. Pin both forms
producing identical output; do not "simplify" that branch away.

**Scope follows the API, never a consumer's call pattern.** `ownerType` calls
an account route and its first consumer calls it once outside their repository
loop — which is a property of their engine, not of the API. It stays
`Repo`-scoped like everything else.

## The configuration-write six

`RepositorySecret`, `RepositoryVariable`, `Ruleset`, `DeploymentEnvironment`,
`RepositorySecurity` and `CodeScanning` landed together (2026-08-13), ported
downstream from `@spencerbeggs/reposets` and folded in here. They write a
fleet's configuration repeatedly — a different kind of surface from the
read-and-report services — and the corrections that fold produced are rules:

- **When a listing mixes scopes, the scope discriminant is the projection's
  reason for existing.** `GET /repos/{owner}/{repo}/rulesets` returns rulesets
  **inherited from the organization** alongside the repository's own, and they
  are indistinguishable without `source_type`. Matching by name alone let a
  repository-scoped `upsert` `PUT` the *organization's* ruleset id — rewriting
  policy for every repository that organization owns, from a caller that never
  mentioned it. Filter on `source_type` before matching; never drop the field
  from a projection because it looks like metadata.
- **Every list read paginates; a truncated read is worse than a failed one.**
  All of these shipped fetching a single page. The harm is not missing data, it
  is a *wrong decision*: the ruleset existence check missed an existing ruleset
  past page one and **created a duplicate instead of updating**, and a cleanup
  policy would have deleted against a subset. The per-method
  pagination-forwarding test is what stops this regressing one method at a
  time.
- **A write reports what it sent, not what it was asked for.**
  `GitHubRepository.applySettings` returns `AppliedSettings` — the REST and
  GraphQL keys that actually went out, in the caller's own names. They diverge
  from the input exactly when preparation drops a field GitHub would reject,
  which is precisely what a person reading a dry run is checking.
- **Secret writes carry the sealed box, and it is not optional** — GitHub's
  secrets API accepts nothing else, so a secrets service without the crypto is
  unusable rather than inconvenient. `internal/crypto.ts` is imported by
  `RepositorySecret` and by nothing else, which is what keeps the crypto pair
  off every other consumer's graph. Both the concatenation order and the
  24-byte nonce length are fixed by libsodium: getting either wrong produces a
  box GitHub **accepts** and cannot decrypt.
- **`WorkflowDispatch.list` reports GitHub's state string without interpreting
  it.** Whether a disabled workflow "counts" is a server-side rule this package
  cannot test. A repository with no workflows answers with an empty array, so
  absence stays distinguishable from being unable to ask.

## Upserts, and the one ordering that destroys a PR

`kind: "alreadyExists"` is what makes `GitBranch.upsert` and `GitTag.upsert`
implementable without a second existence check. Prefer the upsert over catching
it yourself.

**Never spell a rebase as `upsert` then `commitFiles`.**

`GitBranch.upsert(branch, targetHead)` followed by `GitCommit.commitFiles`
leaves a window in which the branch *is* the base: an open PR from it has an
empty diff, and GitHub auto-closes it. A consumer lost its release PR to that
~3-second window while the run went green. Build the commit first (`get` the
target's `treeSha` → `createTree` → `createCommit` with the target as parent)
and `upsert` **once**, to the finished sha.

## Say-once is a different idempotence from say-again

`GitHubIssue.commentOnce` creates or skips and **never edits**; `upsert` edits in
place. Choose by what the comment *is*: a status comment must converge on the
current truth, a one-time announcement ("shipped in release X" on the issue it
closed) must never be rewritten — an edit either restates a fact that was true
when it was said, or re-notifies everyone watching.

- **The marker is the existence check**, appended in exactly `upsert`'s spelling
  so a comment either member writes stays findable by the other. Two spellings of
  one sentinel is a duplicate comment every run, invisible until it has happened
  a dozen times.
- **Not `isCrossReferencedBy`** — an issue reached through `linkedIssues` is
  cross-referenced from the moment the pull request named it, so that check is
  `true` before anything has been said. Only the marker answers "have I commented
  yet?".
- **The lookup paginates**, like every list read here: a first-page-only check on
  a busy issue announces again.
- **The remaining race is named, not designed away.** GitHub offers no
  conditional create, so two runs that both miss the marker both post; the cost is
  one duplicate comment. `CommentOnceResult` carries `wrote` **and** the comment
  either way, so "already announced" needs no second read.

## The closing-reference grammar is two dialects on purpose

`IssueReferences` is strings in, values out — no service, no layer, nothing but
`effect` on its graph — and it carries **two** dialects because their producers
differ:

- `harvestIssueReferences` scans running prose (`fixes #12 and closes #13`),
  whitespace mandatory and **no colon**, because that is the spelling GitHub's own
  scanner honours when it decides what a pull request closes.
- `parseBareLineReference` takes a whole trimmed line (`Closes: #12`), colon
  **optional**, because a generated references region writes one per line.

**One regex for both is the tempting simplification and it fails invisibly**:
accepting the colon inline harvests references GitHub will *not* link, so a
pipeline reports an issue as closing that merging leaves open. Apply that rule
if a third dialect appears. An inline reference carries offsets and a bare-line
one deliberately does not, and a digit run past the safe-integer range is
**skipped, never rounded** into a different, existing issue. Cross-repo and
full-URL spellings are out of scope until a consumer emits them.
