---
"@effected/github": minor
---

## Features

First release. Typed GitHub REST and GraphQL over octokit's core request
surface, with GitHub App authentication and a set of resource services.

### The route is the key — no casts

```ts
import { GitHubClient } from "@effected/github";
import { Effect } from "effect";

const defaultBranch = Effect.gen(function* () {
  const client = yield* GitHubClient;
  const repo = yield* client.request("GET /repos/{owner}/{repo}", { owner: "o", repo: "r" });
  return repo.default_branch; // string — no cast, no hand-written interface
});
```

`client.request(route, params)` types both the parameters and the returned
data from the route literal alone; a route outside the generated map goes
through `requestDecoded(route, params, schema)`, where the schema is
mandatory. One paginating engine backs every paginated read.

### Resource services

`GitBranch.upsert`, `GitTag.latestSemver` / `.upsert`, `CheckRun.withCheckRun`
(with `conclude`), `PullRequest` / `PullRequestComment` upserts,
`GitHubRelease`, `ArtifactMetadata`, `Attestation`, `GitHubCommit`,
`GitHubContent`, `GitHubIssue`, `GitHubRepository` and `WorkflowDispatch`
round out the typed surface over the raw request primitive.

### Errors and auth

One `GitHubError` covers every REST resource, with a `kind` for routing and
`hasKind` for narrowing; `kind: "alreadyExists"` is what makes an upsert
implementable without a second existence check. `GitHubGraphQLError` covers
GraphQL, and `GitHubApp` mints installation tokens (`GitHubAppError` on
failure) without pulling in `@octokit/auth-app`'s OAuth machinery.
