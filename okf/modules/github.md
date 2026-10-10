---
type: Module
title: "@effected/github"
description: The kit's typed GitHub REST and GraphQL API layer, owning the octokit runtime.
status: stable
kind: package
resource: ../../packages/github
tags: [bundle, architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-10-10T00:53:24Z
  body_sha256: d30fc9c6077fc670b4237a3b77ea22376d573ee173ea02696c459a9878e7668d
---

# @effected/github

`@effected/github` is the kit's typed GitHub API layer: one client over
GitHub's REST and GraphQL endpoints, plus the resource services that turn raw
endpoints into domain operations. It owns the octokit runtime so that
[`@effected/github-actions`](github-actions.md) and the consumer repositories
never take an octokit edge themselves.

Three properties define the package:

1. **Nothing is `unknown`.** octokit ships a complete, generated, types-only
   description of every GitHub endpoint. `client.request("GET
   /repos/{owner}/{repo}", { owner, repo })` types both the parameters and the
   returned data from the route literal alone — see
   [the REST client interface](../interfaces/github-rest-client.md).
2. **A light consumer cannot reach a heavy engine.** The client, the repo
   coordinate and most resource services import only octokit core and its
   paginator; the JWT signer and the sealed-box crypto pair are each confined
   to one module. See [Bundle reachability](#bundle-reachability).
3. **Errors are sized to what consumers read**: a reason string, a status, an
   operation name and a structural `kind` — see
   [errors and retry](../interfaces/github-errors-and-retry.md).

Scope is closed by the consumer repositories, not by GitHub's API. An endpoint
earns a resource method when a consumer needs it typed; everything else is
reachable through the typed request surface without a cast, so "not modelled"
never means "not usable".

The contract lives in five child interfaces:

- [The typed REST surface](../interfaces/github-rest-client.md) — the
  route-is-the-key mechanism, the client shape, the escape hatch for routes
  outside the generated map, and the pagination model.
- [Errors and resilience](../interfaces/github-errors-and-retry.md) — one
  classification step, the structural `kind`, and the single retry policy
  driven by GitHub's own headers.
- [App authentication](../interfaces/github-app-auth.md) — the JWT engine,
  the token lifecycle, and the seam `@effected/github-actions` builds its
  bridge on.
- [The resource services](../interfaces/github-resources.md) — what each
  resource owns: upserts, say-once semantics, projections, the
  configuration-write half, the check-run bracket, byte budgeting, the
  permission comparator, and attestation metadata.
- [GraphQL](../interfaces/github-graphql.md) — typed documents and which of
  them this package owns.

See also [why `github` owns the octokit runtime](../decisions/github-owns-octokit-runtime.md).

## Tier and dependencies

**Integrated tier**, per [the tier taxonomy](../glossary/library-tier.md) —
it owns the octokit runtime, which is the whole reason the package exists:
interpreting GitHub's API is a concern that should exist once, typed, in a
package named for it.

| Dependency | Why |
| --- | --- |
| `@octokit/core` | the `Octokit` class: a route-keyed, fully typed `request`, plus `graphql` |
| `@octokit/plugin-paginate-rest` | the composable paginator over a bare core instance, plus the type that statically rejects paginating a non-paginating route |
| `@octokit/types` | the generated endpoint map; ships no JavaScript — types only |
| `@effected/jwt` (`workspace:^`) | signs the App JWT over WebCrypto; no runtime dependencies, and accepts PKCS#1 and PKCS#8 keys on every runtime — see [`jwt`](jwt.md) |
| `tweetnacl` + `blakejs` | the libsodium sealed box GitHub's secrets API requires, reachable only from `RepositorySecret` |
| `@effected/semver` (`workspace:^`) | semver-aware tag selection; pure tier, so the edge is free |
| `@effected/github-references` (`workspace:^`) | the compat re-export of six issue-reference names — see [`github-references`](github-references.md) |

**The crypto pair is not a free-hand choice, and `node:crypto` is not an
alternative.** A sealed box is `crypto_box` under an ephemeral keypair with a
nonce derived as `blake2b(ephemeral_pk ‖ recipient_pk, 24)`
(`packages/github/src/internal/crypto.ts`); Node ships neither X25519
`crypto_box` nor blake2b, so the choice was these two leaves or a full
libsodium build. Treat a third non-octokit dependency added here as a fresh
decision, not a free ride on this one. `blakejs`'s `blake2b` must be imported
as a default import: Node's `cjs-module-lexer` detects `blake2b` as a named
export and not its nine siblings, so a named import works for one function
and throws for its neighbour at runtime after a clean build
(`packages/github/src/internal/crypto.ts:5-13`).

`@octokit/rest` and `@octokit/auth-app` are deliberately absent and must not
be reintroduced. `@octokit/rest` bundles a request-log plugin this package
would immediately silence, plus megabytes of generated types duplicating
`@octokit/types`. `@octokit/auth-app` re-exports an OAuth user-auth factory,
making hundreds of kilobytes of OAuth app, user and device-flow machinery
reachable from a package that only ever mints installation tokens; what is
actually needed — an RS256-signed App JWT plus one typed token-endpoint
route — comes from the kit's own [`@effected/jwt`](jwt.md), a WebCrypto
signer with no runtime dependencies that runs on workerd as well as Node.

## Bundle reachability

The tree-shakability invariant is measured:

| A consumer that imports… | links | does **not** link |
| --- | --- | --- |
| the client, the repo coordinate, the route vocabulary, any resource service but `RepositorySecret` | octokit core and the paginator | the JWT signer, the crypto pair |
| the App service or any of its client layers | the above plus the JWT signer | the crypto pair |
| the Actions OIDC verifier (`ActionsOidc`) | `@effected/jwt` and nothing else | all octokit, the crypto pair |
| the installation token store seam (`InstallationTokenStore`) | nothing but `effect` | the JWT signer, all octokit |
| `RepositorySecret` | the above plus `tweetnacl` and `blakejs` | the JWT signer |
| the pure classes | nothing but `effect` | all octokit |

Three mechanisms carry it:

1. **Module-per-layer-variant.** The token and config client layers live in
   `GitHubClient.ts`, which imports only octokit core and the paginator; the
   App-authenticated client layer lives in `GitHubApp.ts`, the only module
   importing the JWT signer.
2. **No namespace object, anywhere** — see
   [no barrel re-exports](../conventions/no-barrel-re-exports.md). The entry
   point re-exports by name only, so referencing one member never retains
   every member's whole module graph.
3. **The pure surface is genuinely pure.** The permission comparator, bot
   identity, the repo reference, the comment marker, the check-run output
   budgeter and the retry policy are schema classes in modules importing
   nothing but `effect`. The closing-reference grammar is the case that
   moved out entirely — see [`github-references`](github-references.md) —
   because hosting a pure vendor rule "in the kit" turned out not to mean
   "in this package": keeping it here cost nothing to `github`'s own
   consumers and cost the octokit-free ones the whole client tree. `github`
   keeps a six-name compat re-export and nothing else.

This invariant gets a test rather than a promise:
`packages/github/__test__/reachability.test.ts` walks the runtime import
graph of `src` statically (type-only imports skipped, since they are erased),
asserting the token-only client does not reach the JWT signer and that the
App module does, that `ActionsOidc` reaches `@effected/jwt` but not
octokit, that `InstallationTokenStore` reaches nothing but `effect` (neither
the signer nor the App module), and that `RepositorySecret` reaches the
crypto pair while no other resource service does. Each "does not reach"
assertion has a positive control beside it. It constrains the import graph, not the
resolver graph: the claim is "no edge exists, so a tree-shaking bundler can
drop it," not "it is absent from any particular consumer's bundle."

## Module topology

Module-per-concept, no barrels, `src/index.ts` re-exports only. `src/` holds
the route vocabulary and the client, the App module, the repo coordinate,
resilience, GraphQL, one module per resource service, and the pure permission
comparator; `src/internal/` holds the octokit factory, the pagination
engine, the crypto leaf, the id funnel and header parsing.

Repository settings live on `GitHubRepository`, not in a service of their
own, because the endpoint a settings service would want is one
`GitHubRepository` already owns — module-per-*concept* deciding it, not a
size judgement. A candidate settings module once collided with the
`RepositorySettings` type alias the entry point already exported, silently,
because `tsc`, the bundler and API Extractor all accept a name collision when
a valid export by that name already exists.
`packages/github/__test__/reachability.test.ts` now asserts every module in
`src/` is re-exported from the entry point, which is the only check that
could have caught it, since nearly every per-module test file imports its
module path directly rather than through the entry point.

## The repo coordinate

Every resource method takes `Repo` in its `R` and no method takes owner and
repo arguments (`packages/github/src/Repo.ts`), which is what makes a
resource call a single expression and what makes a scoped override work:

```ts
yield* Effect.forEach(targets, (target) => syncOneRepo.pipe(Repo.provide(target)), { concurrency: 4 });
```

**Resolving `Repo` per call rather than once at layer construction is
load-bearing.** If a resource resolved both the client and the repository at
construction, a scoped override would silently do nothing, because the
resource would already hold the repository it was built with. The client
stays resolved at construction; the coordinate is read per call. The general
rule this refines: resolve a dependency once when it is stable, per call
when varying it is the point.

**The scope of a method follows the API, never the consumer's call
pattern.** An org-scoped route still sources its org from `Repo.owner` when
the org *is* the repository's owner; only a method needing an org that is
not the repository's owner takes an explicit argument. `Repo` is also a
deliberate exception to "no non-effectful members on a service shape": its
entire shape is one immutable value class, `Layer.succeed` is the correct
double for it, and the exception holds only while the shape is entirely one
value with no methods.

## Actions decoupling

Three places where GitHub-Actions-runtime knowledge could leak into this
layer, and what keeps it out instead:

| Leak avoided | Replacement |
| --- | --- |
| rerouting octokit's request log into a workflow command | octokit's log is silenced, and the client logs its own retries with `Effect.logDebug`; `@effected/github-actions` maps Effect logs onto workflow commands through a `Logger` |
| reading the repository slug from the environment | [the repo coordinate](#the-repo-coordinate), with the env-driven layer variant named for what it does |
| reading the token from the environment | the config-provider client layer, over a redacted config |

There is no token masking here (that is an Actions output command), no state
persistence (an installation token is merely encodable so
`@effected/github-actions` can persist it), and no workflow-command import of
any kind. This package reads no environment variable except through a
`Config` in a layer variant named for being env-driven, and is otherwise
runnable anywhere.

## Shared vocabulary

- **One canonical semver model.** `@effected/semver` is pure tier, so the
  edge is free, and returning a real semver value is what lets a consumer
  compare tags without re-parsing.
- **The repo reference, pull-request info, installation tokens, check-run
  output and release data are canonical here**, and
  `@effected/github-actions` consumes rather than duplicates them.
- **A digest is a small deliberate duplication.** An attestation subject
  digest and a lockfile integrity hash are different concepts wearing
  similar clothes, and taking a dependency edge across a seam to share a
  branded string is not worth it; this package declares its own.
- **The release-tag format authority stays in `@effected/workspaces`.** This
  package's tag-name-to-version extraction is a parsing convention, not the
  tag-format authority.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in
`__test__/`. There is no `./testing` subpath.

- Every service ships `makeTest(overrides?)` and `layerTest(overrides?)`,
  with unstubbed members dying loudly and naming themselves.
- Tests drive the real client through octokit's documented `fetch` option
  (`packages/github/__test__/fixtures.ts`), not a double of this package's
  own service, so classification, header capture, retry and
  link-following pagination are all genuinely exercised. A hand-built
  response has an empty URL, and octokit's paginator constructs a URL from
  it for any payload carrying a total count, so the harness must define
  that property or the failure gets classified as a transport fault
  instead. octokit percent-encodes path parameters, so assertions run
  against the recorded decoded path rather than the URL.
- One recorded-fixture client double (`GitHubClient.layerFixture`) exists
  and reimplements nothing: it pages recorded arrays through the same
  pagination engine the live layer uses and records the page requests it
  issued (`RecordedCall`, carrying `kind` and params), which is what makes
  truncation testable and what makes normalising writes testable.
- An unstubbed fixture route dies naming the route (`unstubbed: "die"`, the
  default); a recorded `GitHubError` value is how a suite stubs a 404, a 422
  or a rate limit deliberately. A missing fixture is test wiring, not a
  domain outcome, and a typed failure is only loud in code that does not
  catch — a consumer catching `GitHubError` per resource turns a missing
  stub into a different execution path whose failures name no fixture.
  `"fail"` restores the typed not-found and `"empty"` serves an empty value
  for a suite whose subject is decisions rather than endpoints; `graphql`
  ignores the setting and always dies, since no empty payload decodes
  against a document's schema. `fixtures.requested` records every call as a
  `RecordedCall` — `kind`, `route` (the document name for `graphql`), the
  params it was made with, and `perPage` for a paginated read — so a suite
  can assert what a method *sent*, which is the question a normalising
  write turns on.
- Repairing fixtures after a route moves is where a false green gets
  manufactured — see
  [repaired fixtures go green on an impossible state](../gotchas/repaired-fixtures-go-green-on-impossible-state.md).
- Pure classes get pure tests, with no layer at all; the byte budgeter gets
  a property test over multi-byte and four-byte code points.
- A pagination-forwarding test exists per paginating method.
- The App suite generates a real RSA key and signs for real.
- Mutating the edges — the page bound, the byte budget, the already-exists
  classification, the retry predicate — is expected to turn the suite red.

Run subset suites root-relative with coverage disabled.

## Observability and build

Named spans on every public fallible boundary, with stable identifiers only
in annotations — the route, the coordinate, the resulting status, the page
count, the failure kind — and never a token, a private key, a request or
response body, or GraphQL variables (which routinely carry node ids and
comment bodies). Retries log at debug, one line per retry, and that is the
only logging in the package. There are no metrics: the spans are there for a
consumer to derive counters from, at whatever cardinality the consumer
chooses.

Build through `pnpm build --filter @effected/github`. Naming third-party
generic types on a public signature is fine — API Extractor resolves a
declared dependency's types as externals — so the only suppressed build
entries are the synthesized schema-class bases. A `static readonly layer`
must wrap its factory in an arrow or it throws an access-before-initialization
error at import time while typechecking clean
(`packages/github/src/GitHubClient.ts`).

## See also

- [`github-references`](github-references.md) — the extracted issue-reference
  grammar and the compat re-export back into this package.
- [why `github` owns the octokit runtime](../decisions/github-owns-octokit-runtime.md)
- [the GraphQL schema is not owned here](../limitations/github-graphql-schema-not-owned.md)
- [branch reset closes an open pull request](../gotchas/branch-reset-closes-pull-request.md)
- [repaired fixtures go green on an impossible state](../gotchas/repaired-fixtures-go-green-on-impossible-state.md)
- [the compat re-export is droppable](../decisions/github-compat-re-export-droppable.md)
- [the github-split program](../glossary/github-split.md)
- [the tier taxonomy](../glossary/library-tier.md)
