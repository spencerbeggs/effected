# Client construction and the App surface

Load when: choosing between the three `GitHubClient` constructors, wiring
`GitHubApp` directly (outside the `GitHubToken` bridge), or auditing why
`@effected/github` doesn't depend on `@octokit/rest`/`@octokit/auth-app`.

## Three ways to get a `GitHubClient`, in two modules

| Constructor | Module | Needs | Error |
| --- | --- | --- | --- |
| `GitHubClient.layerFromToken({ token, ... })` | `GitHubClient` | a `Redacted<string>` you already hold | none |
| `GitHubClient.layerFromConfig({ name?, ... })` | `GitHubClient` | `Config.redacted("GITHUB_TOKEN")` via the ambient `ConfigProvider` | `ConfigError` |
| `GitHubApp.clientLayer(request, options?)` | `GitHubApp` | an app id and a PEM private key | `GitHubAppError` |

`layerFromConfig` reads a token through the ambient `ConfigProvider` rather
than `process.env.GITHUB_TOKEN` directly, so a missing token fails as an
honest `ConfigError` — construction itself can fail, cleanly, rather than
needing a `Layer.orDie` justified by a comment explaining that the wire-shaped
error type didn't really mean "no token configured."

**`GitHubApp.clientLayer` lives on `GitHubApp`, not as a third static on
`GitHubClient`.** This follows the general rule for layer-family statics: a
layer-family static belongs to the module that owns the dependency it
needs, not the module that declares the service. `GitHubApp`'s module is the
only one in the package importing the JWT-signing library that mints an app
JWT. Putting `clientLayer` on `GitHubClient` would make every token-only
consumer's import graph reach that signer, because statics on one class
share one module — there is no way to attach a static "onto" `GitHubClient`
from a different file. A reachability test enforces the boundary: it
asserts `GitHubApp`'s module *does* reach the JWT signer (the control) and
`GitHubClient`'s module does *not*. Never add an import from
`GitHubClient`'s module to `GitHubApp`'s.

## The bundle diet this buys

`@effected/github` deliberately does not depend on `@octokit/rest` or
`@octokit/auth-app`:

- `@octokit/rest` bundles a generated-types plugin that duplicates what the
  route-typing already carries, for a package that never needed the
  plugin's own generated interface.
- `@octokit/auth-app` re-exports OAuth app/user/device-flow machinery far
  larger than what minting an installation token actually needs — an RS256
  app JWT plus one typed route call. A small, zero-dependency JWT-signing
  library covers exactly that, at a fraction of the weight.

Do not reintroduce either dependency; a design change that genuinely needs
one back is worth re-litigating explicitly, not a quiet re-add.

## `GitHubApp`

```ts
export interface GitHubAppShape {
  readonly token: (request: TokenRequest) => Effect.Effect<InstallationToken, GitHubAppError>;
  readonly scopedToken: (request: TokenRequest) => Effect.Effect<InstallationToken, GitHubAppError, Scope.Scope>;
  readonly revoke: (token: Redacted.Redacted<string>) => Effect.Effect<void, GitHubAppError>;
  readonly identity: (request: AppCredentials & { installationToken?: Redacted.Redacted<string> }) =>
    Effect.Effect<AppIdentity, GitHubAppError>;
  readonly installations: (credentials: AppCredentials) => Effect.Effect<ReadonlyArray<Installation>, GitHubAppError>;
}
```

- Minting the app JWT is the only cryptography in the package, and it is a
  leaf call into the JWT-signing library — never a re-implementation.
- `token` discovers the installation from `owner` when `installationId` is
  omitted, walking the installations list through the client's real
  paginator rather than a hand-rolled `Link:` header regex.
- **`GitHubApp.clientLayer`'s rotation is invisible to the caller**: each
  member resolves the current client first, re-minting when the held token
  is inside a short skew window of expiry. Rotating **revokes the token it
  replaces** before minting the next one, so at most one live token exists
  at a time, and the layer's scope finalizer revokes the last of them on
  release. A credential failure surfaces as `GitHubError { kind:
  "unauthorized" }` carrying the underlying `GitHubAppError` as `cause` —
  "could not authenticate" already reads as an authorization failure to a
  request caller, so no method's error channel widens for it.
- `GitHubApp.scopedToken` ties a token's life to a `Scope` — right for a
  single-process action, wrong for a multi-process one. `GitHubToken` (see
  `references/token-lifecycle.md`) explicitly does not use it.

`GitHubApp.makeTest`/`layerTest` die naming the member for anything
unstubbed — build a partial double from the shape above, not from a stack
trace. A double built for `GitHubToken.provision` specifically must stub
`token`, `identity` and `revoke` — those three, exactly, per the
member-usage table in `references/token-lifecycle.md`; stubbing fewer dies
partway through a run, stubbing `scopedToken` or `installations` as well
stubs members `provision` never calls.

## `TokenPermissions` — a pure class, not a service

```ts
export class TokenPermissions extends Schema.Class<TokenPermissions>("TokenPermissions")({
  granted: Schema.Record(Schema.String, PermissionLevel), // "read" | "write" | "admin"
}) {
  static fromGitHub(permissions: Readonly<Record<string, string>>): TokenPermissions;
  compare(required: Readonly<Record<string, PermissionLevel>>): PermissionResult;
  assertSufficient(required): Effect.Effect<void, TokenPermissionError>; // at least what was asked
  assertExact(required): Effect.Effect<void, TokenPermissionError>;     // exactly what was asked, no more
}
```

No layer is needed to compare permissions — `TokenPermissions.fromGitHub(minted.permissions)`
reads a token's own grant and compares it in place. Wrapping this in a
service would buy nothing but the heaviest kind of test double: one that
reimplements the whole ranking to answer a pure comparison. There is
nothing here to mock, so there is no mock.

`TokenPermissionError` reports `kind: "insufficient"` (from
`assertSufficient`, or from a failed `assertExact`) or `"excess"` (from
`assertExact` only, when nothing is missing but something ungranted is
present), plus `result: PermissionResult` — `missing` (each gap carrying
`permission`/`required`/`granted`) and `extra`. `assertSufficient` never
fails on a broader-than-asked grant; only `assertExact` treats a spare
permission as a misconfiguration.

## `BotIdentity` — pure, not a service member

```ts
export class BotIdentity extends Schema.Class<BotIdentity>("BotIdentity")({
  name: Schema.String,
  email: Schema.String,
}) {
  static forApp(source: { appSlug: string; appUserId?: number }): BotIdentity;
  static readonly githubActions: BotIdentity; // "github-actions[bot]"
  get signoff(): string; // "Signed-off-by: <name> <email>"
}
```

`signoff` renders the DCO 1.1 trailer from the type that owns the data —
commits created through the Git Data API bypass `git commit -s`, so no
porcelain adds the trailer, and a hand-built one that's subtly wrong fails
late as a red DCO check on someone else's pull request. Whether a missing
identity falls back to `BotIdentity.githubActions` stays the caller's
policy.

A pure class, not a member on the `GitHubApp` service shape — a plain
synchronous method on a service shape is required in every partial double,
degrading every one of them to a full implementation for no service-boundary
benefit. `InstallationToken.botIdentity()` is the instance-method form,
falling back to `BotIdentity.githubActions` when the token was never
enriched with an app identity.
