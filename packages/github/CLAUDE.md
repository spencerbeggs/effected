# CLAUDE.md — @effected/github

Typed GitHub REST and GraphQL over octokit's core request surface, with App
auth, one resource service per GitHub noun, and the configuration-write half.
**Integrated tier** — it owns the octokit runtime so nothing downstream has to.

Durable knowledge lives in the bundle, not here. Start at
`okf/modules/github.md` and load the child a task needs:

- `okf/modules/github.md` — Load when: starting any work here. Tier and
  dependency table, why `@octokit/rest` / `@octokit/auth-app` are absent and
  the crypto pair is confined, the measured bundle-reachability invariant,
  module topology, the per-call `Repo` coordinate, Actions decoupling, the
  test harnesses and the fixture client's contract.
- `okf/interfaces/github-rest-client.md` — Load when: adding or changing a
  REST call, the route table, `requestDecoded`, `repositoryPatch`, resource
  id narrowing, or pagination.
- `okf/interfaces/github-errors-and-retry.md` — Load when: touching the
  error taxonomy, classification or the retry policy.
- `okf/interfaces/github-app-auth.md` — Load when: working on GitHub App
  auth, the token lifecycle, bot identity and signoff, or the
  Actions-runtime seam.
- `okf/interfaces/github-resources.md` — Load when: changing a resource
  service, an upsert, a projection, a normalising write, the
  configuration-write six or the check-run bracket.
- `okf/interfaces/github-graphql.md` — Load when: adding a typed GraphQL
  document or changing response decoding.
- `okf/gotchas/branch-reset-closes-pull-request.md` — Load when: composing
  `GitBranch.upsert` with `GitCommit.commitFiles`.
- `okf/gotchas/repaired-fixtures-go-green-on-impossible-state.md` — Load
  when: a source change moves a call to a new route and the fixture suites
  die with `no fixture for`.
- `okf/decisions/github-owns-octokit-runtime.md`,
  `okf/decisions/github-compat-re-export-droppable.md` — Load when: adding a
  dependency, or touching the six-name `@effected/github-references`
  re-export in `src/index.ts`.
- `okf/modules/github-references.md` — Load when: the task is the
  issue-reference grammar itself; it lives in `packages/github-references`.

## Operating rules

- `pnpm build --filter @effected/github`; never run `savvy.build.ts`
  directly. `savvy.build.ts` suppresses only the synthesized `_base` schema
  class warnings — never widen it.
- Tests: `@effect/vitest`, `it.effect`, `assert.*` — never `expect`; in
  `__test__/`, run root-relative with `--coverage.enabled=false` for a
  subset. Tests drive the real client through octokit's `fetch` option
  (`__test__/fixtures.ts`); every service ships `makeTest` / `layerTest`.
- Read `__test__/reachability.test.ts` before adding any import between
  `src/` modules or any dependency: it pins the import graph the bundle's
  reachability table describes, that every `src/` module is re-exported from
  `src/index.ts`, and that `RepositorySecret` alone reaches the crypto pair.
- Import `blakejs` as a default import only, and keep `internal/crypto.ts`
  imported by `RepositorySecret` and nothing else.
- Wrap a `static readonly layer` factory in an arrow; classify status codes
  only through `GitHubError`'s shared `classify` (`fromOctokit` /
  `fromResponse`); narrow ids only through `internal/ids.ts`; paginate
  every list read.
