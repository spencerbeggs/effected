# CLAUDE.md — @effected/github

Typed GitHub REST and GraphQL over octokit's core request surface, with GitHub
App authentication and resource services.

**Design doc:** `@../../.claude/design/effected/packages/github.md`
Program frame: `.claude/plans/2026-07-25-github-split-master.md` (Phase 2).

## Tier and dependencies

**Integrated** — it owns the octokit runtime so nothing downstream has to.

| Dependency | Why |
| --- | --- |
| `@octokit/core` | the `Octokit` class: `request` (route-keyed, typed) and `graphql` |
| `@octokit/plugin-paginate-rest` | `composePaginateRest.iterator` + the `PaginatingEndpoints` type |
| `@octokit/types` | the generated `Endpoints` map. **Ships no JavaScript** — types only |
| `universal-github-app-jwt` | signs the App JWT. Zero dependencies |
| `@effected/semver` (`workspace:^`) | `GitTag.latestSemver` |

**`@octokit/rest` and `@octokit/auth-app` are deliberately absent.** The rest
wrapper only adds `plugin-request-log` (which we would immediately silence) and
a 1.4 MB second spelling of endpoint types; `auth-app` re-exports
`createOAuthUserAuth`, making ~492 KB of OAuth machinery reachable from a
package that only ever mints installation tokens. Do not reintroduce either.

## The route is the key

`client.request("GET /repos/{owner}/{repo}", { owner, repo })` types both the
parameters and the returned `data` from the route literal alone. There is no
`operation: string`, no callback, no type parameter to invent, and **no cast** —
the surface this replaced cost four consumer repos sixteen cast sites.

- `Rest.Params<R>` intersects a **three-field** `RequestExtras` (`headers`,
  `mediaType`, `baseUrl`), not octokit's `RequestParameters` — that one carries
  an index signature and would accept every typo.
- A route outside the generated map goes through `requestDecoded(route, params,
  schema)`. The schema is **mandatory**: the escape hatch is from the route
  table, never from typing. Two real cases: release-asset upload (not in the
  map) and the attestation reads (pinned api-version, different contract).
- **A hand-written route owns its query parameters in the template.** Outside
  the map nothing tells octokit that `name` is a query parameter, so
  `assets{?name}` must spell it or octokit drops it silently and GitHub answers
  400 `Invalid name for request` (live, 2026-07-26). The two spellings on
  `uploadAsset` (`{?name}` / `{?name,label}`) exist because an absent `label`
  in one template expands to a dangling `&`.

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
  fixture double and `GitHubCommit.changedFiles` (whose route octokit does not
  list as paginating) all build a `PageSource` and hand it to the same walk.
- **One retry policy**, in the client. Resources never retry.
- Pure classes — `TokenPermissions`, `CheckRunOutput`, `CommentMarker`,
  `BotIdentity`, `RepoRef`, `RetryPolicy` — reach nothing but `effect` and are
  testable with no layer. `BotIdentity.signoff` renders the DCO trailer,
  because a commit made through the Git Data API bypasses `git commit -s` and
  a hand-built trailer fails late as a red DCO check.
- **Never spell a rebase as `GitBranch.upsert(branch, targetHead)` followed by
  `GitCommit.commitFiles`.** In between, the branch *is* the base, an open PR
  from it has an empty diff, and GitHub auto-closes it — a consumer lost its
  release PR to that ~3-second window while the run went green. Build the
  commit first (`get` the target's `treeSha` → `createTree` → `createCommit`
  with the target as parent) and `upsert` **once**, to the finished sha.

## Tree-shakability is tested, not promised

`__test__/reachability.test.ts` walks the runtime import graph and asserts that
`GitHubClient` does **not** reach `universal-github-app-jwt` while `GitHubApp`
does (the control). That is why `GitHubApp.clientLayer` lives on `GitHubApp`
rather than as `GitHubClient.layerFromApp`: statics on one class share a module.
**Never add an import from `GitHubClient.ts` to `GitHubApp.ts`** — the test will
say so, but the point is the invariant.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. Run root-relative
with `--coverage.enabled=false` for subset runs.

Tests drive the **real** client through octokit's documented `fetch` option
(`__test__/fixtures.ts`), not a double of our own service — so classification,
header capture, retry and Link-following pagination are all exercised. Two
harness facts worth knowing before writing a new test:

- A hand-built `Response` has `url === ""`, and octokit's paginator does
  `new URL(response.url)` for any payload carrying `total_count`. The harness
  defines the property; without it you get `TypeError: Invalid URL` classified
  as `kind: "transport"`.
- octokit percent-encodes path parameters, so `heads/main` goes out as
  `heads%2Fmain`. Assert against `script.calls[i].path` (decoded), not `url`.

`GitHubApp` tests generate a real RSA key with `node:crypto` and sign for real.

## Errors

One `GitHubError` for every REST resource, with `kind` for routing and
`operation` for identification; `GitHubGraphQLError` for GraphQL (it carries
`errors`); `GitHubAppError` for authentication; `TokenPermissionError` from the
pure comparator. Classification happens **once**, in `GitHubError.fromOctokit` —
nothing else in the package inspects a status code.

`kind: "alreadyExists"` is what makes `GitBranch.upsert` and `GitTag.upsert`
implementable without a second existence check. Prefer the upsert over catching
it yourself.
