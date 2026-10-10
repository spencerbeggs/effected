---
type: Interface
title: "@effected/github resource services"
description: One context service per GitHub noun, turning typed endpoints into domain operations.
status: stable
kind: api
resource: ../../packages/github/src
tags: [bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-10-10T01:56:46Z
  body_sha256: d9cf42a873837a69ef7465fe8346128fb81ba780b0c8698438ae290d2735e5d9
---

# @effected/github resource services

The resource services are the package's domain half: one context service per
GitHub noun a consumer needs typed — repositories, git objects, issues and
pull requests, releases, check runs, and the configuration surfaces a fleet
writes — each turning a set of endpoints into an operation stated once. The
module names in `packages/github/src/` are the authority on which nouns
exist; an endpoint earns a resource method when a consumer needs it typed,
and everything else stays reachable through the typed request surface.

Every resource is a context service whose layer requires only the client and
whose methods each require [the repo coordinate](../modules/github.md#the-repo-coordinate),
so a scoped repository override is real rather than decorative. Every member
is an effect or a stream, every service ships a die-loudly test double, and
no resource retries — [the client owns that](github-errors-and-retry.md#one-retry-policy-driven-by-githubs-own-headers).
The mechanics they stand on — the route-keyed request, the escape hatch, and
the pagination engine — belong to [the REST client](github-rest-client.md);
package-wide framing is in [the `github` module](../modules/github.md).

## Upserts exist so consumers stop writing TOCTOU dances

Without a structured "already exists" discriminant, a consumer distinguishes
"someone else created it" from a real failure with a check-then-create-then-fetch
preamble — up to four round trips for one intent — or by string-matching the
message. `GitBranch.upsert` and `GitTag.upsert` are the answer: create, and
on an already-exists failure force-update. One round trip in the common
case, two in the raced one, and the recovery still resets rather than
inheriting a branch a concurrent creator rooted elsewhere. Prefer the upsert
over catching the discriminant yourself.

Absence is not an error: an existence check degrades a not-found to `false`,
and the option-returning read variants degrade it to none.

## Say-once is a different idempotence from say-again

`GitHubIssue.commentOnce` posts a marked comment once, and never edits it:
find the marker, or create it. The guarantee is idempotence across
sequential invocations — a re-run workflow, the motivating case — not mutual
exclusion across concurrent ones. It is the counterpart to
`PullRequestComment.upsert`, not a variant of it: an upsert edits in place,
which is right for a status comment that must converge on the current truth,
while a one-time announcement — "this shipped in release X" on the issue it
closed — must never be rewritten, since an edit either restates a fact that
was true when it was said, or re-notifies everyone watching.

The marker is the existence check, appended to the body in exactly the
spelling `upsert` uses, so a comment either member writes stays findable by
the other. `isCrossReferencedBy` is the obvious wrong guess: an issue
reached through `linkedIssues` is cross-referenced by construction, from the
moment the pull request named it, so the check is `true` before anything has
been said — only the marker answers "have I commented yet?". The lookup
paginates, for the same reason every list read on this package does: a
first-page-only check on a busy issue finds no marker and announces again.

The remaining race is named rather than implied away: GitHub offers no
conditional create, so two runs that both miss the marker both post. The
window is a page read wide and the failure is one duplicate comment,
documented on the member rather than papered over — a caller who needs
mutual exclusion must serialize externally. The result value is a
`CommentOnceResult` carrying `wrote` and the comment either way, so a caller
can report "already announced" without a second read.

## The hazard that costs production data

Never spell a rebase as an upsert to the target head followed by a commit.
Each call is correct and each is documented; the hazard is in their
sequence. Resetting a release branch to its base makes an open pull request
from that branch have an empty diff, and GitHub auto-closes a pull request
in that state — see
[branch reset closes an open pull request](../gotchas/branch-reset-closes-pull-request.md).

The correct spelling is one operation with no observable intermediate state:
read the target commit for its tree, create a tree on it, create a commit
with the target as parent, then upsert once to the finished sha. The branch
never rests on the bare target head, so no pull request is ever momentarily
empty. No API changed to fix this: the members needed to compose it
correctly already existed. What was missing was the warning, so both
members' documentation carries it.

## Projections that replace consumer code

- **A commit read returning its tree sha.** Consumers reach for a commit
  purely to get a tree for the Git Data API; the projection drops a whole
  client requirement out of the consumer's function signature.
- **Repository settings as a faithful projection plus narrow accessors.**
  Consumers hit the same endpoint for different subsets — the full settings
  block, the default branch, the node id — so both the full projection and
  narrow accessors exist. All of it lives on `GitHubRepository`, which
  already owns the route.
- **Semver-aware tag selection.** Returning tag strings forces a consumer
  into an effect per parse and per comparison to find its latest release.
  Here parsing and comparison are the sync primitives `@effected/semver`
  already exports, so the whole selection is one pass over the page stream
  with no effect round trips. The tag-name-to-version convention is
  documented and pluggable — the default strips a leading `v` and takes the
  substring after the last `@` — with an override for anything else, and
  prereleases excluded unless asked for.
- **Associated pull requests, named for what they answer.** A method a
  consumer cannot find gets a cast instead, which is a discoverability
  failure as much as a typing one.

## Shapes corrected against the domain rather than against fixtures

- **A file list answers with typed entries, not paths** — path and status,
  plus line counts and any pre-rename path, the same projection the
  commit-diff read returns, because GitHub answers both endpoints with the
  same wire shape.
- **Head and base shas are required fields.** GitHub always reports both.
  Whether a pull request has merged is likewise a fact GitHub always
  reports, so it is a real option rather than an optional key, and the
  projection constructs that option rather than decoding one.
- **A commit summary carries its parents**, required — empty for a root
  commit, two or more for a merge — so "which commit did this come from"
  never needs a raw route.
- **A content read keeps all three of its guards**: reject a directory
  listing, reject a non-file type, and reject any encoding other than
  base64, because an over-size file comes back with a different encoding
  and decoding it as base64 yields silent garbage.
- **A sticky-comment marker is a pure class**, not a hardcoded vendor
  string and not a layer parameter, so it carries no branding and is
  testable without a client.
- **Auto-merge is an explicit method**, not an option that fired a mutation
  from a tap after create or update, which is how a failure could surface
  from a call that had already succeeded.
- **A poll-to-completion loop has no sentinel error.** The loop repeats with
  a predicate over the success value and a genuine timeout fails as an
  ordinary rejected error, rather than encoding "not done yet" as an error
  value.

## The configuration-write half

Secrets, variables, rulesets, deployment environments, security features and
CodeQL default setup write a repository's configuration, repeatedly, across
a fleet — a different kind of surface from the read-and-report services.

- **A repository-scoped write must never be able to reach an organization's
  object.** `GET /repos/{owner}/{repo}/rulesets` returns rulesets inherited
  from the organization alongside the repository's own, indistinguishable
  without `source_type`. `upsert` filters on `source_type` before matching:
  when a listing mixes scopes, the scope discriminant is not an optional
  field of the projection, it is the projection's reason for existing.
- **A truncated list read is worse than a failed one, because it looks
  complete.** Secrets, variables, rulesets, environments and the workflow
  listing all paginate: a cleanup policy deleting undeclared resources
  seeing a subset, or a ruleset upsert's existence check missing an existing
  ruleset past page one and creating a duplicate instead of updating, are
  both wrong decisions rather than missing data.
- **A normaliser must also accept the form its own parameter type
  declares.** `GitHubRepository.updateSettings` wraps a bare `"enabled"` in
  `security_and_analysis` into the `{ status }` form GitHub requires, and
  drops merge keys whose owning strategy is being disabled — but it must
  also pass the already-typed `{ status: "enabled" }` form through
  untouched, since `RepositoryPatch` is GitHub's own parameter type and a
  normaliser that only recognized the bare form silently discarded that
  block while the request still returned 200.
- **A write reports what it sent, not what it was asked for.**
  `GitHubRepository.applySettings` returns `AppliedSettings` — the REST and
  GraphQL keys that actually went out, in the caller's own names — which
  diverge from the input exactly when preparation drops a field GitHub
  would reject.
- **Secret writes carry the sealed box, and it is not optional.** GitHub's
  secrets API accepts only libsodium sealed-box ciphertext.
  `packages/github/src/internal/crypto.ts` carries the algorithm's own trap:
  both the concatenation order and the 24-byte nonce length are fixed by
  libsodium, and getting either wrong produces a box GitHub accepts and
  cannot decrypt.
- **A workflow listing belongs on the service that already owns the route
  family.** `WorkflowDispatch.list` reports GitHub's state string without
  interpreting it — whether a disabled workflow counts is a server-side
  rule this package cannot test — and a repository with no workflows
  answers with an empty array, so absence stays distinguishable from being
  unable to ask.
- **Cancelling a finished run is not a failure.** `WorkflowDispatch.cancelRun`
  answers `"cancelled"` on GitHub's 202 (the run stops shortly after, not
  necessarily before the call returns) and `"alreadyCompleted"` on the 409
  GitHub sends for a run that already finished, mapped by status alone;
  every other failure stays a `GitHubError`.

## The check-run bracket concludes on every exit

A bracket built from a success tap and an error tap fires on success and on
a typed failure only. An interrupted run and a defect both leave the check
run in progress forever, and GitHub never reaps such a run, so it blocks
branch protection until a human deletes it by hand.

The bracket is therefore an exit-aware finalizer, running uninterruptibly,
which is what lets the concluding request survive the very interrupt that
triggered it. The defaults: success on success, failure on a typed failure
or a defect, and cancelled on an interrupt only. Only the success path keeps
the error channel, because failing to record a success is a real failure
the caller should see, whereas on the other paths the completing call is
ignored — neither an interrupt nor an existing failure should be replaced by
whatever went wrong while reporting it.

The callback receives a conclude handle as a second parameter rather than
returning an outcome the bracket maps, so a findings-derived verdict — a
strict-warnings input escalating a neutral conclusion — can be recorded
without entangling the verdict with the callback's own return value, and
without needing a separate mechanism for the failure and interrupt paths
that have no return value at all. The handle stores the verdict in a ref and
the finalizer writes it exactly once, on whichever path the callback leaves
by — the last verdict wins, and the handle's error channel is `never`.

Outside the bracket, the run's surface is additive over the original
`create(name, headSha)`, which still starts an in-progress run:

- `create`'s options queue a run instead (a queued run carries no
  `started_at`) and set `external_id` and `details_url`; an empty external id
  is not sent, because no lookup can match it.
- `update(id, output?, options?)` takes the output as optional: omitted, no
  `output` key is sent and the run keeps the output it has, so a queued run
  moves to in progress with only `status` and `details_url`. Its options move
  the status between queued and in progress and set `details_url`;
  completing stays on `complete`, which records the conclusion. `update(id)`
  with neither still sends one PATCH carrying only the coordinates: every
  call is exactly one request, never a silent skip.
- `complete(id, conclusion, output?, options?)` takes a `detailsUrl` option,
  sent as `details_url` only when given, so a finished run can link to the
  workflow run behind it without losing the `completed_at` stamp or the
  output byte cap.
- Every member that answers a run (`create`, `get`, `findByExternalId`)
  **decodes** the response into `CheckRunRef` rather than constructing it, so
  a response missing a field fails with a typed `decode` error naming the
  operation instead of dying.
- `findByExternalId(headSha, name, externalId)` lists every run of the
  commit filtered by name — `filter: "all"`, since GitHub's default returns
  only the newest run per name and would hide an older match — paginates,
  matches `external_id` locally and answers the newest by id. An empty
  external id is none without a request.
- Times (`started_at`, `completed_at`) come from `Clock`, so `TestClock`
  drives them.

## Byte budgeting is a pure method

GitHub caps a check-run summary at a byte count, not a character count, and
rejects the request when it is exceeded. Emoji and box-drawing characters
cost several bytes each, so a character-count check passes while the
request fails. That logic lives as a pure method on the output value class,
testable with no client at all. Stripping one trailing replacement
character after slicing the byte buffer is not enough — a split four-byte
code point can produce more than one — so the trim runs until the tail is
clean; a property test asserts the result is valid UTF-8 within budget for
arbitrary input. The arithmetic runs on `TextEncoder`/`TextDecoder`, never
the Node `Buffer` global, so it runs on a Worker without `nodejs_compat`; a
structural test fails on any `Buffer` named under `src/`, and file contents
decode through core `Base64` for the same reason.

## The permission comparator is not a service

It is a pure ordinal comparator over a record the caller already holds,
with zero octokit and zero requirements: a pure class with a comparison
method and two assertion effects. Wrapped in a service, a comparator would
need a whole-behaviour test double reimplementing the entire ranking; as a
pure class it needs none. There is no "warn on over-permission" member: the
comparison returns the extras and the caller decides what to log.

## Attestation and artifact metadata

Attestation upload and listing are the REST half of a three-way split —
signing and SBOM assembly are `@effected/sbom`'s, and the mint-sign-build-attest
pipeline is consumer composition. Two behaviours are deliberate: the pinned
API version, which is why this surface uses the decoding request with an
owned schema rather than a generated response type, and two distinct
statuses both meaning "no attestations", degraded to an empty list.

Artifact metadata's endpoint is org-scoped rather than repository-scoped,
and the organization is nonetheless resolved from the repo coordinate's
owner like every other resource, rather than taken as a positional
argument — the scoped override covers the cross-org case exactly as it
covers the cross-repository one.

## One internal projection stays internal

The raw wire shape a file list decodes from is exported from its own
module — shared between the two endpoints that answer with it — but
deliberately not from the entry point, because it is octokit's vocabulary
rather than this package's. The typed entry is the public type; the raw
shape is how it gets built.
