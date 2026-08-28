---
name: github-app-tokens
description: >-
  Use when a GitHub credential needs to come into existence, live somewhere, and die —
  constructing a client from a plain token or a GitHub App, or wiring GitHubToken's
  provision/read/clientLayer/dispose lifecycle across an Action's pre/main/post phases.
---

# GitHub App tokens: the credential lifecycle

Two packages, one lifecycle: how a GitHub credential comes into existence,
where it lives, and when it dies. `@effected/github` mints and revokes;
`@effected/github-actions` persists a mint across a process boundary and
guarantees it dies exactly once. For the request surface itself
(`client.request`, `GitHubError`, pagination) see `github-api`. For wiring
`Action.run` and `ActionRunOptions.layer`, see `actions-runtime`. For the
`Secret` seam and `ActionState`, see `actions-state-and-secrets`.

## What you have

| Construct | Import | Reach for it when |
| --- | --- | --- |
| `GitHubClient.layerFromToken` | `import { GitHubClient } from "@effected/github"` | You already hold a `Redacted<string>` token |
| `GitHubClient.layerFromConfig` | `@effected/github` | The workflow's own runner-issued token is enough |
| `GitHubApp` (`.token`, `.scopedToken`, `.revoke`, `.identity`, `.installations`, `.clientLayer`) | `@effected/github` | Minting/revoking an installation token directly, outside an Action's process boundary |
| `TokenPermissions` | `@effected/github` | Comparing a token's granted scopes against what a program requires |
| `BotIdentity` | `@effected/github` | Rendering a DCO trailer, or naming the bot identity behind a token |
| `GitHubToken` (`.provision`, `.read`, `.botIdentity`, `.clientLayer`, `.dispose`) | `import { GitHubToken } from "@effected/github-actions"` | Bridging an App-minted token across an Action's `pre`/`main`/`post` process boundary |

## Standards

- **Pick the plain-token path first.** `GitHubClient.layerFromConfig()`
  needs no `ActionState`, no `GitHubApp`, no revoke lifecycle — reach for
  App auth only when the runner's own token can't provide a permission or a
  distinct bot identity your program needs.
- **`GitHubApp.clientLayer` lives on `GitHubApp`, not `GitHubClient`.** A
  layer-family static belongs to the module that owns the dependency it
  needs; putting it on `GitHubClient` would drag the JWT signer into every
  token-only consumer's bundle. See
  [`references/client-construction.md`](references/client-construction.md).
- **Use `GitHubToken`, never `GitHubApp.scopedToken`/`.clientLayer`, inside
  an Action.** Both revoke on their `Scope`'s close, and in an Action the
  scope closes at the end of `pre` — before `main` runs a single request.
  `GitHubToken` persists the mint through `GITHUB_STATE` instead.
- **Build a `layerTest` from the member-usage table, not from a stack
  trace.** Each `GitHubToken` member touches an exact, documented set of
  `ActionState`/`ActionOutputs`/`GitHubApp` members — stub exactly those.
  See [`references/token-lifecycle.md`](references/token-lifecycle.md).
- **Verify required scope at `pre`, not by waiting for a 403 in `main`.**
  Set `GitHubToken.provision`'s `required` option every time — leaving it
  unset skips verification silently.
- **Revoke the mint on any provisioning failure.** `provision` is an
  acquire-use-release: a scope-verification or persistence failure revokes
  the just-minted token rather than leaving an hour of unreferenced access
  live for a retried `pre`.
- **`post` disposes unconditionally, wrapped double-netted.** `dispose()`
  is already a no-op with nothing to revoke, but still wrap the call in
  `catch` + `catchDefect` — a `post` phase must never turn a green run red
  over a token it was only trying to clean up.
- **Never reintroduce `@octokit/rest` or `@octokit/auth-app`.** A small,
  zero-dependency JWT signer plus one typed route call covers what minting
  an installation token actually needs; both larger dependencies were
  deliberately dropped.

## Footguns

- An installation token lives about an hour and **nothing can re-mint one
  after `pre`** — the only credential that could is the App's private key,
  and persisting that through `GITHUB_STATE` (plaintext by GitHub's own
  protocol) would trade an hour-long token for a permanent one. A phase
  expecting to outlive the hour calls `provision` itself.
- The scope-verification field is named `required`, **not** `permissions` —
  `permissions` is the field on the *minted* token. A double or migration
  script that writes `permissions` on `ProvisionOptions` compiles clean and
  silently skips verification. See
  [`references/token-lifecycle.md`](references/token-lifecycle.md).
- Masking must happen **before** persistence — the ordering is structural in
  `provision`, not a convention a caller has to remember; get it backwards
  in a hand-rolled variant and a plaintext token reaches `GITHUB_STATE`
  unmasked.
- `dispose` reads with `getOptional`, never `get` — a `post` phase after a
  `pre` that failed before minting anything must be a no-op, not a typed
  failure.

## Additional resources

- [references/token-lifecycle.md](references/token-lifecycle.md) — the
  `GitHubToken` bridge in full: the member-usage table, the one-hour
  contract, `provision`/`clientLayer`/`dispose` mechanics, and the complete
  five-element App-auth recipe including how to add or remove it from an
  action. Load when: wiring App auth into an action's `pre`/`main`/`post`
  phases.
- [references/client-construction.md](references/client-construction.md) —
  the three `GitHubClient` constructors in detail, why the package skips
  `@octokit/rest`/`@octokit/auth-app`, the `GitHubApp` service shape and its
  rotation/revocation mechanics, and the pure `TokenPermissions`/`BotIdentity`
  classes. Load when: constructing a client directly, or working with
  `GitHubApp` outside the `GitHubToken` bridge.

## Pointers

- The request surface (`client.request`, `GitHubError`'s `kind` taxonomy,
  pagination, GraphQL) — `github-api`.
- Wiring `Action.run`, `ActionRuntime.layer`, and the `ActionRunOptions.layer`
  type-level constraint `clientLayer()`'s fallible construction runs into —
  `actions-runtime`.
- The `Secret` declassification seam and `ActionState` persistence —
  `actions-state-and-secrets`.
- Testing doubles for any of the above (`layerTest`, the member-usage-table
  pattern, `TestClock` for expiry) — `testing-actions`.
