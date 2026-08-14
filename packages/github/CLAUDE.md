# CLAUDE.md — @effected/github

Typed GitHub REST and GraphQL over octokit's core request surface, with App
auth, the resource services and the configuration-write half.

**Design doc:** `@../../.claude/design/effected/packages/github.md` — read it
first. The depth lives in five children, each loaded on demand:

- `@../../.claude/design/effected/packages/github-rest.md` — Load when: adding
  or changing a REST call, the route table, the client shape or pagination.
- `@../../.claude/design/effected/packages/github-errors.md` — Load when:
  touching the error taxonomy, error classification or the retry policy.
- `@../../.claude/design/effected/packages/github-auth.md` — Load when: working
  on GitHub App auth, the token lifecycle, signoff or the Actions-runtime seam.
- `@../../.claude/design/effected/packages/github-resources.md` — Load when:
  changing a resource service, an upsert, a projection or the check-run bracket.
- `@../../.claude/design/effected/packages/github-graphql.md` — Load when:
  adding a typed GraphQL document or changing response decoding.

**Child context files:**

- `@./CLAUDE.resources.md` — Load when: touching a resource service, a list
  read or a write that normalises. Holds the configuration-write six, the
  ruleset-scope rule and the rebase-ordering landmine.
- `@./CLAUDE.testing.md` — Load when: writing or debugging a test. Holds the
  harness traps and the fixture client's contract.

Program frame: `.claude/plans/2026-07-25-github-split-master.md` (Phase 2).

## Tier and dependencies

**Integrated** — it owns the octokit runtime so nothing downstream has to.

| Dependency | Why |
| --- | --- |
| `@octokit/core` | the `Octokit` class: `request` (route-keyed, typed) and `graphql` |
| `@octokit/plugin-paginate-rest` | `composePaginateRest.iterator` + the `PaginatingEndpoints` type |
| `@octokit/types` | the generated `Endpoints` map. **Ships no JavaScript** — types only |
| `universal-github-app-jwt` | signs the App JWT. Zero dependencies |
| `tweetnacl` + `blakejs` | the libsodium **sealed box** GitHub's secrets API requires (added with `RepositorySecret`, 2026-08-13) |
| `@effected/semver` (`workspace:^`) | `GitTag.latestSemver` |

**The crypto pair is not a free-hand choice, and `node:crypto` is not an
alternative** — Node ships neither X25519 `crypto_box` nor blake2b. The
**first non-octokit runtime dependencies** here; the tier does not move, but
**treat a third addition as a fresh decision**. Import `blakejs` as a **default
import**: Node's `cjs-module-lexer` detects `blake2b` and not its nine
siblings, so a named import works for one function and throws at runtime for
its neighbour after a clean build (`__test__/crypto.test.ts` pins the set).

**`@octokit/rest` and `@octokit/auth-app` are deliberately absent.** The rest
wrapper adds only a request-log plugin we would silence and a 1.4 MB second
spelling of endpoint types; `auth-app` re-exports `createOAuthUserAuth`, making
~492 KB of OAuth machinery reachable from a package that only mints
installation tokens. Do not reintroduce either.

## The route is the key

`client.request("GET /repos/{owner}/{repo}", { owner, repo })` types both the
parameters and the returned `data` from the route literal alone. No
`operation: string`, no callback, no type parameter, and **no cast** — the
surface this replaced cost four consumer repos sixteen cast sites.

- `Rest.Params<R>` intersects a **three-field** `RequestExtras` (`headers`,
  `mediaType`, `baseUrl`), not octokit's `RequestParameters` — that one carries
  an index signature and would accept every typo.
- A route outside the generated map goes through `requestDecoded(route, params,
  schema)`. The schema is **mandatory**: the escape hatch is from the route
  table, never from typing. Two real cases: release-asset upload and the
  attestation reads (pinned api-version).
- **A hand-written route owns its query parameters in the template.** Outside
  the map nothing tells octokit that `name` is a query parameter, so
  `assets{?name}` must spell it or octokit drops it silently and GitHub answers
  400 `Invalid name for request` (live, 2026-07-26). `uploadAsset` carries two
  spellings (`{?name}` / `{?name,label}`) because an absent `label` would
  expand to a dangling `&`.

## Conventions that are load-bearing here

- **`Repo` is resolved per call, not at layer construction.** Every resource
  method carries `Repo` in its `R`. That is what makes `Repo.provide(other)`
  work for the multi-repository case; capturing it at construction would make a
  scoped override silently do nothing. The **client** is still resolved once.
- **Layer statics wrap the factory in an arrow** — `Layer.effect(this,
  Effect.map(GitHubClient, (client) => make(client)))`. Passing `make` directly
  throws `Cannot access 'make' before initialization` at import time while
  typechecking clean.
- **One pagination engine**, `src/internal/paginate.ts`. The live client, the
  fixture double and `GitHubCommit.changedFiles` (a route octokit does not list
  as paginating) all build a `PageSource` for the same walk.
- **One retry policy**, in the client. Resources never retry.
- Pure classes — `TokenPermissions`, `CheckRunOutput`, `CommentMarker`,
  `BotIdentity`, `RepoRef`, `RetryPolicy` — reach nothing but `effect` and need
  no layer. `BotIdentity.signoff` renders the DCO trailer, because a commit
  through the Git Data API bypasses `git commit -s` and a hand-built trailer
  fails late as a red DCO check.
- **Resource-service rules, including the rebase-ordering landmine that cost a
  consumer its release PR, are in `@./CLAUDE.resources.md`.**

## Tree-shakability is tested, not promised

`__test__/reachability.test.ts` walks the runtime import graph and asserts that
`GitHubClient` does **not** reach `universal-github-app-jwt` while `GitHubApp`
does (the control). That is why `GitHubApp.clientLayer` lives on `GitHubApp`
rather than as `GitHubClient.layerFromApp`: statics on one class share a module.
**Never add an import from `GitHubClient.ts` to `GitHubApp.ts`** — the test says
so, but the invariant is the point. The same suite asserts every module in
`src/` is re-exported from `src/index.ts`.

The crypto pair rides the same mechanism, and on the signer's pattern: a
positive control asserts `RepositorySecret` **does** reach `tweetnacl` and
`blakejs`, and the negative asserts no other resource service does — so a
consumer who never writes a secret cannot start paying for the crypto without
the suite saying which module leaked it.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. Run root-relative
with `--coverage.enabled=false` for subset runs. Tests drive the **real** client
through octokit's documented `fetch` option (`__test__/fixtures.ts`), not a
double of our own service, so classification, header capture, retry and
Link-following pagination are all genuinely exercised.

The harness traps and the fixture client's contract — an unstubbed route
**dies**, a recorded `GitHubError` *is* the failure, `requested` records every
call's params — are in `@./CLAUDE.testing.md`; all three changed 2026-08-13.

## Errors

One `GitHubError` for every REST resource, with `kind` for routing and
`operation` for identification; `GitHubGraphQLError` for GraphQL (it carries
`errors`); `GitHubAppError` for authentication; `TokenPermissionError` from the
pure comparator. Classification happens **once**, in `GitHubError.fromOctokit` —
nothing else in the package inspects a status code. What `kind:
"alreadyExists"` buys an upsert is in `@./CLAUDE.resources.md`.
