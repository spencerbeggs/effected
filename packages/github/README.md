# @effected/github

[![npm](https://img.shields.io/npm/v/@effected%2Fgithub?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/github)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Typed GitHub REST and GraphQL for [Effect](https://effect.website) v4. `client.request("GET /repos/{owner}/{repo}", { owner, repo })` types both the parameters and the returned `data` from the route literal alone — no `operation: string`, no callback, no cast. One `GitHubError` covers every REST failure with a `kind` you branch on instead of grepping a message, one pagination engine backs every paginating route and `client.request`'s `Stream` form, and a set of resource services (`GitBranch`, `GitTag`, `CheckRun`, `PullRequest`, `PullRequestComment`, `GitHubRelease`, `Attestation`) turn multi-call dances — "does this branch already exist?", "conclude this check run no matter how the program exits" — into one call. `GitHubApp` mints and revokes installation tokens for App auth.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/github

Hand-rolled octokit wrappers tend to converge on the same shape: a `rest<T>(operation: string, fn: (octokit) => Promise<{ data: T }>)` helper where `T` is whatever the caller wrote and nothing connects it to the endpoint. This package's route-keyed `request` closes that gap — `@octokit/types` already generates a map from GitHub's own OpenAPI description, and `@octokit/core`'s `request` already consumes it, so there was no reason to reinvent either.

The error model gets the same treatment. `GitHubError.kind` is a literal union (`notFound`, `alreadyExists`, `rejected`, `unauthorized`, `rateLimited`, `transport`, `decode`) produced by one classification step, `GitHubError.fromOctokit`, instead of one hand-written mapper per resource. `kind: "alreadyExists"` is what makes `GitBranch.upsert` and `GitTag.upsert` a single round trip in the common case, rather than a create-then-catch-then-check-then-reset dance repeated at every call site that needs it.

This package also owns the octokit runtime so nothing downstream has to. `@octokit/rest` and `@octokit/auth-app` are deliberately absent — the rest wrapper is a request-logging plugin plus 1.4 MB of duplicate endpoint types, and `auth-app` drags in `createOAuthUserAuth`, roughly 492 KB of OAuth machinery this package never calls. GitHub App JWTs are signed by `universal-github-app-jwt` instead, the same zero-dependency signer `@octokit/auth-app` itself uses. A consumer that only authenticates with a token it already holds never links the JWT signer at all: the App-authenticated layer lives in its own module (`GitHubApp`), and nothing here is gathered into a namespace object that would defeat that split.

## Install

```bash
npm install @effected/github effect
```

```bash
pnpm add @effected/github effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

## Quick start

```ts
import { GitHubClient, Repo, RepoRef } from "@effected/github";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const client = yield* GitHubClient;
  const repo = yield* client.request("GET /repos/{owner}/{repo}", { owner: "effect-ts", repo: "effect" });
  return repo.default_branch; // string — typed from the route literal, no cast
});

const ClientLayer = GitHubClient.layerFromConfig(); // reads GITHUB_TOKEN through the ambient ConfigProvider
const RepoLayer = Repo.layer(RepoRef.make({ owner: "effect-ts", repo: "effect" }));

Effect.runPromise(program.pipe(Effect.provide(ClientLayer), Effect.provide(RepoLayer))).then(console.log);
// the repository's default branch name, e.g. "main"
```

`Repo` carries the `{ owner, repo }` coordinate in `R` rather than as a per-call argument, so every resource method below reads as a single expression. A program acting on more than one repository uses `Repo.provide(otherRef)` around the part that needs it.

## Resource services

Each resource is a service over `GitHubClient`, with its own `layer`, `makeTest` and `layerTest`. `GitBranch.upsert` is the case that motivated the whole set:

```ts
import { GitBranch, GitHubClient, Repo } from "@effected/github";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const branches = yield* GitBranch;
  return yield* branches.upsert("release/1.2", "abc123");
});
// Effect<"created" | "reset", GitHubError, GitBranch | Repo>
// one round trip in the common case, two in the raced one — never four
```

`CheckRun.withCheckRun` runs a program inside a check run and concludes it on every exit path — success, typed failure, defect or interrupt — so a run never gets stuck `in_progress`:

```ts
import { CheckRun } from "@effected/github";
import { Effect } from "effect";

declare const lint: () => Effect.Effect<ReadonlyArray<string>>;
declare const deriveConclusion: (findings: ReadonlyArray<string>) => "success" | "neutral" | "failure";

const program = Effect.gen(function* () {
  const check = yield* CheckRun;
  return yield* check.withCheckRun("lint", "abc123", (_id, conclude) =>
    Effect.gen(function* () {
      const findings = yield* lint();
      yield* conclude(deriveConclusion(findings));
      return findings;
    }),
  );
});
```

`GitTag.latestSemver` walks tags and picks the newest version-shaped one in a single pass, over `@effected/semver`'s synchronous comparator — no round trip per candidate. `PullRequest.upsert` and `PullRequestComment.upsert` (a marker-tagged sticky comment) follow the same one-call-one-intent shape.

## GitHub App authentication

`GitHubApp.clientLayer` builds a `GitHubClient` authenticated as an app installation. The token is minted on build, re-minted a minute before it expires, and revoked on release — best effort — so a workflow does not leave live credentials behind:

```ts
import { GitHubApp } from "@effected/github";
import { Redacted } from "effect";

// bind once — layers memoize by reference
const AppClient = GitHubApp.clientLayer({
  appId: "123456",
  privateKey: Redacted.make(process.env.GITHUB_APP_PRIVATE_KEY as string),
  owner: "effect-ts",
});
// Layer<GitHubClient, GitHubAppError> — provide it wherever a GitHubClient is needed
```

Only `GitHubApp` and its statics import the JWT signer — a consumer authenticating with a plain token never reaches it.

## Errors

`GitHubError` covers REST, `GitHubGraphQLError` covers GraphQL, `GitHubAppError` covers app authentication, and `TokenPermissions` produces its own `TokenPermissionError` — four kinds, not one per resource:

```ts
import { GitHubError } from "@effected/github";
import { Effect } from "effect";

declare const upsertBranch: Effect.Effect<"created" | "reset", GitHubError>;

const program = upsertBranch.pipe(
  Effect.catchIf(GitHubError.hasKind("rateLimited"), (error) => Effect.logWarning(`retry after ${error.retryAfterMillis}ms`)),
);
```

Retrying is handled once, in the client: `RetryPolicy.default` retries a `transport` or `rateLimited` failure with full-jitter backoff, honoring GitHub's `retry-after` header up to a configurable ceiling. `RetryPolicy.none` disables it. A `notFound`, `rejected` or `unauthorized` failure never retries — it cannot change its mind between attempts.

## Testing

Every resource ships `makeTest(overrides?)` and `layerTest(overrides?)`: stub the members a test exercises, and every other member dies naming itself, so a test proves it touches nothing it did not stub:

```ts
import { GitBranch } from "@effected/github";
import { Effect } from "effect";

const TestBranches = GitBranch.layerTest({
  upsert: () => Effect.succeed("created"),
});
```

`GitHubClient.layerFixture(fixtures)` is the one recorded-response double that pages for real: it builds a `PageSource` over the recorded array and hands it to the same pagination engine the live client uses, so a truncation path behaves identically under test and in production.

## Features

- `GitHubClient` — the typed transport: `request`, `requestDecoded` (a mandatory-schema escape hatch for routes outside the generated map), `paginate` / `paginateStream`, `graphql`, and `rateLimit` (observation only — nothing here throttles on your behalf).
- `Repo` / `RepoRef` — the `{ owner, repo }` coordinate, resolved per call through `R`, with `Repo.provide` for multi-repository programs.
- `GitHubError` / `GitHubGraphQLError` — one error per transport, `kind`-routed with `hasKind` for `Effect.catchIf`.
- `RetryPolicy` — the client's one retry policy: full-jitter backoff, server-advised delays honored up to a ceiling.
- `GitHubApp` — App JWT signing, installation token minting/revocation, app and installation identity, and `clientLayer` for an App-authenticated `GitHubClient`.
- `GitBranch` / `GitTag` — Git Database API refs, with `upsert` collapsing the create-or-reset dance to one call and `GitTag.latestSemver` picking the newest version-shaped tag in one pass.
- `CheckRun` — `withCheckRun` concludes on every exit path; `CheckRunOutput.truncated()` cuts rendered output to GitHub's byte limits.
- `PullRequest` / `PullRequestComment` — upserts for both, `listFiles` answering with the same full `CommitFile` records a commit read returns, `headSha`/`baseSha` on `PullRequestInfo`, plus `CommentMarker` for finding a sticky comment again.
- `GitHubRelease` — releases and asset uploads, including the one route (`uploadAsset`, with the endpoint's optional display label) outside GitHub's generated endpoint map.
- `BotIdentity` — the author and committer a bot commits as, with `signoff` rendering the DCO trailer that a commit made through the Git Data API never gets from `git commit -s`.
- `Attestation` — upload and list attestations against a subject digest; building and signing the bundle is `@effected/sbom`'s job.
- `TokenPermissions` — a pure comparator between granted and required permissions, reaching nothing but `effect`.

## License

[MIT](LICENSE)
