---
name: github-app-tokens
description: Use when a token needs to come into existence, live somewhere, and die — GitHubClient.layerFromToken/layerFromConfig, GitHubApp.clientLayer and the module-split rule behind it, GitHubApp.token/scopedToken/revoke/identity, TokenPermissions.assertSufficient/assertExact, InstallationToken.isExpired, or GitHubToken.provision/read/clientLayer/dispose across an Action's pre/main/post phases. Trigger phrases include GitHubApp, installation token, App JWT, token bridge, GitHubTokenError, botIdentity, TokenPermissionError, revoke on release, acquireUseRelease token, GITHUB_STATE persisted token, plain GITHUB_TOKEN input.
---

# GitHub App tokens: the credential lifecycle

Two packages, one lifecycle: how a GitHub credential comes into existence,
where it lives, and when it dies. `@effected/github` mints and revokes;
`@effected/github-actions` persists a mint across a process boundary and
guarantees it dies exactly once. That is a deliberate cut from the old
plugin's "github-app-auth" skill, which organized around the API surface
instead. For the request surface itself (`client.request`, `GitHubError`,
pagination), see `github-api`. For wiring `Action.run` and
`ActionRunOptions.layer`, see `actions-runtime`. For the `Secret` seam and
`ActionState`, see `actions-state-and-secrets`.

## Three ways to get a `GitHubClient`, in two modules

| Constructor | Module | Needs | Error |
| --- | --- | --- | --- |
| `GitHubClient.layerFromToken({ token, ... })` | `src/GitHubClient.ts` | a `Redacted<string>` you already hold | none |
| `GitHubClient.layerFromConfig({ name?, ... })` | `src/GitHubClient.ts` | `Config.redacted("GITHUB_TOKEN")` via the ambient `ConfigProvider` | `ConfigError` |
| `GitHubApp.clientLayer(request, options?)` | `src/GitHubApp.ts` | app id + PEM private key | `GitHubAppError` |

`layerFromConfig` (`packages/github/src/GitHubClient.ts:212-221`) is what
replaced a `layerFromEnv` that read `process.env.GITHUB_TOKEN` directly. A
missing token now fails as an honest `ConfigError` — construction can fail,
and that is what dissolved a consumer's five-line comment justifying
`Layer.orDie` over a wire-failure error type that didn't mean "no token
configured."

**`GitHubApp.clientLayer` lives on `GitHubApp`, not as a third static on
`GitHubClient`.** This is not arbitrary organization — it is the general rule
`effect-v4-services-layers` states for layer-family statics, with this as the
instance that has a test enforcing it:

> A layer-family static belongs to the module that **owns the dependency it
> needs**, not to the module that **declares the service**.

`GitHubApp.ts` is the only module in the package importing
`universal-github-app-jwt` (`packages/github/src/GitHubApp.ts:1-8`, the JWT
signer import). Putting `clientLayer` on `GitHubClient` would make every
token-only consumer's import graph reach that signer, because **statics on
one class share one module** — there is no way to put a static "on"
`GitHubClient` from a different file. `GitHubClient.ts` itself imports only
`@octokit/core` and the paginate plugin
(`packages/github/src/GitHubClient.ts:1-11`).

`packages/github/__test__/reachability.test.ts:102-115` is the enforcement,
not a comment: it asserts `GitHubApp.ts` **does** reach
`universal-github-app-jwt` (the control — without it the negative assertion
below could pass because the walker is broken) and that `GitHubClient.ts`
does **not**. **Never add an import from `GitHubClient.ts` to
`GitHubApp.ts`** — the test will fail, but the point is the invariant, not
the assertion.

```ts
// packages/github/src/GitHubClient.ts:196-197 — imports @octokit/core only
GitHubClient.layerFromToken({ token }); // Layer<GitHubClient>

// packages/github/src/GitHubApp.ts:281-288 — the only module reaching the JWT signer
GitHubApp.clientLayer({ appId, privateKey, installationId });
// Layer<GitHubClient, GitHubAppError>
```

### The bundle diet this buys

`@effected/github` deliberately does not depend on `@octokit/rest` or
`@octokit/auth-app` (`packages/github/CLAUDE.md:21-25`,
`.claude/design/effected/packages/github.md:88-141`):

- **`@octokit/rest`** is a 36 KB wrapper bundling `plugin-request-log` (the
  package silences it anyway) and `plugin-rest-endpoint-methods` — 1.4 MB of
  generated types that duplicate what `@octokit/types` already carries.
  `@octokit/core`'s `request` is already typed against `@octokit/types`'
  generated `Endpoints` map, so route-keyed typing needs neither plugin.
- **`@octokit/auth-app`** re-exports `createOAuthUserAuth`, making ~492 KB of
  OAuth app/user/device-flow machinery reachable from a package that only
  ever mints installation tokens. What it actually needs — an RS256 app JWT
  and `POST /app/installations/{id}/access_tokens` — is `universal-github-app-jwt`
  (the same JWT leaf `auth-app` itself uses, 80 KB, zero dependencies) plus a
  typed route already on the client.

Do not reintroduce either as a dependency; a design change that needs one
back is a design change worth re-litigating, not a quiet re-add.

## The App: `GitHubApp`

```ts
// packages/github/src/GitHubApp.ts:314-355 (abridged)
export interface GitHubAppShape {
 readonly token: (request: TokenRequest) => Effect.Effect<InstallationToken, GitHubAppError>;
 readonly scopedToken: (request: TokenRequest) => Effect.Effect<InstallationToken, GitHubAppError, Scope.Scope>;
 readonly revoke: (token: Redacted.Redacted<string>) => Effect.Effect<void, GitHubAppError>;
 readonly identity: (request: AppCredentials & { installationToken?: Redacted.Redacted<string> }) =>
  Effect.Effect<AppIdentity, GitHubAppError>;
 readonly installations: (credentials: AppCredentials) => Effect.Effect<ReadonlyArray<Installation>, GitHubAppError>;
}
```

- **`mintJwt`** (`packages/github/src/GitHubApp.ts:362-367`) is the only
  cryptography in this package, and it is a leaf call into
  `universal-github-app-jwt` — not a re-implementation.
- **`token`** discovers the installation from `owner` when `installationId`
  is omitted, walking `GET /app/installations` through the client's real
  paginator (`packages/github/src/GitHubApp.ts:400-426`) rather than a
  hand-rolled `Link:` header regex.
- **`GitHubApp.clientLayer`'s rotation is invisible to the caller**
  (`packages/github/src/GitHubApp.ts:264-279,499-579`): each member resolves
  the current client first, re-minting when the held token is inside one
  minute (`DEFAULT_SKEW`, `packages/github/src/GitHubApp.ts:138`) of expiry.
  Rotating **revokes the token it replaces** before minting the next one, so
  at most one live token exists at a time, and the layer's `Scope` finalizer
  revokes the last of them on release. A credential failure surfaces as
  `GitHubError { kind: "unauthorized" }` carrying the `GitHubAppError` as
  `cause` — "could not authenticate" already reads as an authorization
  failure to a request caller, so no method's error channel widens for it.
- **`GitHubApp.scopedToken`** ties a token's life to a `Scope` — right for a
  single-process action, wrong for a multi-process one. `GitHubToken` (below)
  explicitly does not use it: see [The bridge](#the-bridge-githubtoken-in-effectedgithub-actions).

`GitHubApp.makeTest`/`layerTest` (`packages/github/src/GitHubApp.ts:290-301`)
die naming the member for anything unstubbed — build a partial double from
the shape above, not from a stack trace. **A double built for
`GitHubToken.provision` specifically must stub `token`, `identity` and
`revoke`** — those three, exactly, per the member-usage table below; stubbing
fewer dies partway through a run, stubbing `scopedToken` or `installations`
as well stubs members `provision` never calls.

### `TokenPermissions` — a pure class, not a service

```ts
// packages/github/src/TokenPermissions.ts:113-174 (abridged)
export class TokenPermissions extends Schema.Class<TokenPermissions>("TokenPermissions")({
 granted: Schema.Record(Schema.String, PermissionLevel), // "read" | "write" | "admin"
}) {
 static fromGitHub(permissions: Readonly<Record<string, string>>): TokenPermissions;
 compare(required: Readonly<Record<string, PermissionLevel>>): PermissionResult;
 assertSufficient(required): Effect.Effect<void, TokenPermissionError>; // at least what was asked
 assertExact(required): Effect.Effect<void, TokenPermissionError>; // exactly what was asked, no more
}
```

No layer needed to compare permissions — `TokenPermissions.fromGitHub(minted.permissions)`
reads a token's own grant and compares it in place
(`packages/github/src/TokenPermissions.ts:125-131`). The predecessor was a
`Context.Service` whose live layer was a `Layer.succeed` with zero octokit
calls; the only thing a service boundary bought was the heaviest test double
in the package, reimplementing the whole ranking. There is nothing here to
mock, so there is no mock.

`TokenPermissionError` (`packages/github/src/TokenPermissions.ts:69-80`)
reports:

- `kind`: `"insufficient"` (from `assertSufficient` or a failed
  `assertExact`) or `"excess"` (from `assertExact` only, when nothing is
  missing but something ungranted is present).
- `result: PermissionResult` — `missing: ReadonlyArray<PermissionGap>` (each
  carrying `permission`, `required`, and `granted` when the token had
  *some* level of it) and `extra: ReadonlyArray<ExtraPermission>`.

`assertSufficient` never fails on a broader-than-asked grant; only
`assertExact` treats a spare permission as a misconfiguration.

### `BotIdentity` — pure, not a service member

```ts
// packages/github/src/GitHubApp.ts:151-190
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
porcelain adds it, and a hand-built trailer that is subtly wrong fails late
as a red DCO check on someone else's pull request
(`GitHubApp.ts:175-190`). Whether a missing identity falls back to
`BotIdentity.githubActions` stays the caller's policy.

The predecessor put `botIdentity(source?)` directly on the `GitHubApp`
service shape as a plain synchronous method — required in every
`Layer.mock`, degrading every partial double to a full implementation. Moving
it to a pure class is the same fix `effect-v4-services-layers` documents for
"no non-effectful members on a service shape": move the member off the
shape, never wrap it in `Effect.succeed` to buy back optionality.
`InstallationToken.botIdentity()` (`packages/github/src/GitHubApp.ts:126-134`)
is the instance-method form: it falls back to `BotIdentity.githubActions`
when the token was never enriched with an app identity.

## The bridge: `GitHubToken` in `@effected/github-actions`

```ts
// packages/github-actions/src/GitHubToken.ts:188-330 (member signatures)
export class GitHubToken {
 static readonly provision: (options?: ProvisionOptions) =>
  Effect.Effect<InstallationToken, GitHubAppError | TokenPermissionError | ActionStateError | ConfigError,
   ActionState | ActionOutputs | GitHubApp>;
 static readonly read: (options?: ReadOptions) => Effect.Effect<InstallationToken, ActionStateError, ActionState>;
 static readonly botIdentity: (options?: ReadOptions) => Effect.Effect<BotIdentity, ActionStateError, ActionState>;
 static readonly clientLayer: (options?: ClientLayerOptions) =>
  Layer.Layer<GitHubClient, ActionStateError | GitHubTokenError, ActionState>;
 static readonly dispose: (options?: ReadOptions) =>
  Effect.Effect<void, GitHubAppError | ActionStateError, ActionState | GitHubApp>;
}
```

Grouped statics on one module reaching one dependency (`@effected/github`) —
the carve-out `effect-v4-services-layers` names for grouped statics, not the
namespace-object hazard.

**Why not `GitHubApp.scopedToken` or `GitHubApp.clientLayer` here.** Both
revoke when their `Scope` closes, and in an Action the scope closes at the
end of `pre` — **before `main` has run a single request**
(`packages/github-actions/src/GitHubToken.ts:134-147`). `pre`, `main`, and
`post` are three separate processes; nothing survives between them except
what `GITHUB_STATE` carries. This is a persistence problem, not a `Scope`
problem, which is why `GitHubToken` exists as a distinct primitive.

### The member-usage table, and why it is executable

```ts
// packages/github-actions/src/GitHubToken.ts:163-169
```

| Member | `ActionState` | `ActionOutputs` | `GitHubApp` |
| --- | --- | --- | --- |
| `provision` | `save` | `setSecret` | `token`, `identity`, `revoke` |
| `read` | `get` | — | — |
| `botIdentity` | `get` | — | — |
| `clientLayer` | `get` | — | — |
| `dispose` | `getOptional` | — | `revoke` |

This is the fix for "partial mocks degrade to `UnimplementedError` roulette":
a caller builds a `layerTest` from the table instead of from a stack trace.
It is not documentation dressed as a contract — it is executable.
`packages/github-actions/__test__/GitHubToken.test.ts:343-358` supplies
exactly the documented members for `provision` and passes; `:360-377` omits
`ActionOutputs.setSecret` and the same call dies. When you extend
`GitHubToken`, extend the table in the same edit, and add both halves of
that test.

### The one-hour contract, and why nothing works around it

An installation token lives about an hour. **No later phase can re-mint
one** — the credential that could is the App's private key, and persisting
*that* through `GITHUB_STATE` (a plaintext file by GitHub's own protocol)
would trade a one-hour token for a permanent one
(`packages/github-actions/src/GitHubToken.ts:149-155`). So the contract is
stated rather than worked around:

```ts
// packages/github-actions/src/GitHubToken.ts:14-27
export class GitHubTokenError extends Schema.TaggedErrorClass<GitHubTokenError>()("GitHubTokenError", {
 reason: Schema.Literals(["expired"]), // deliberately the only reason
 expiresAt: Schema.String,
}) {}
```

`GitHubToken.read` fails typed with `reason: "expired"` rather than handing
back a token that would answer a bare `401` with no explanation
(`packages/github-actions/src/GitHubToken.ts:248-262`). A phase expected to
outlive the hour calls `GitHubToken.provision` itself instead of trying to
stretch a persisted token.

`InstallationToken.isExpired(nowMillis, skew?)`
(`packages/github/src/GitHubApp.ts:122-124`) is the check underneath both
`read` and `dispose`, defaulting to a 60-second skew
(`packages/github/src/GitHubApp.ts:138`) because the check and the request it
guards are not the same instant. `read`'s `options.skew` overrides it per
call; `dispose` calls it with `Duration.zero` — see below.

### `ProvisionOptions`: what's required, and the field that isn't `permissions`

```ts
// packages/github-actions/src/GitHubToken.ts:37-59
export interface ProvisionOptions {
 readonly appId: string;                                          // required
 readonly privateKey: Redacted.Redacted<string>;                   // required
 readonly installationId?: number | undefined;
 readonly owner?: string | undefined;
 readonly required?: Readonly<Record<string, PermissionLevel>> | undefined;
 readonly stateKey?: string | undefined;
}
```

`appId` and `privateKey` carry no `?` — `provision` cannot discover
credentials on its own, so a caller must already hold both. **The
scope-verification field is named `required`, not `permissions`** —
`permissions` is the name of the field on the *minted token*
(`InstallationToken.permissions`, what GitHub actually granted); `required`
is what the caller is asking `TokenPermissions.assertSufficient` to check the
grant against (`GitHubToken.ts:222`). The two are compared, never conflated:
a double or a migration script that writes `permissions` on `ProvisionOptions`
compiles to nothing — the field is silently absent, `options.required` reads
`undefined`, and `provision` skips scope verification entirely rather than
failing to find it.

**For a migrant from a predecessor that read its own App-auth inputs**
(`app-id`, `private-key`, `owner`) **directly**: `GitHubToken.provision` takes
those values as plain fields on `ProvisionOptions` rather than reading
`ActionInput` itself, so the input-reading step moves into the calling
action's `pre.ts` — resolve `ActionInput.string("app-id")`,
`ActionInput.redacted("private-key")`, etc., and pass the results into
`provision({ appId, privateKey, ... })`. `GitHubToken` is Actions-agnostic
about *how* credentials arrive; `pre.ts` is what makes it Actions-shaped.

### `provision`: mint, verify, mask, persist — and revoke on any failure

```ts
// packages/github-actions/src/GitHubToken.ts:206-237 (shape)
Effect.acquireUseRelease(
 app.token({ appId, privateKey, installationId?, owner? }),
 (minted) => /* verify required permissions, mask, enrich identity, persist */,
 (minted, exit) => Exit.isSuccess(exit) ? Effect.void : Effect.ignore(app.revoke(minted.token)),
);
```

It is an `acquireUseRelease`, and the release arm is the load-bearing part:
if scope verification (`TokenPermissions.fromGitHub(minted.permissions)
.assertSufficient(options.required)`) or persistence fails, the minted token
is **revoked** rather than left live until GitHub expires it. A workflow
retrying a failing `pre` would otherwise leave an hour's worth of
unreferenced write tokens behind, each one a credential nobody is tracking.
Two tests prove both failure paths revoke:
`packages/github-actions/__test__/GitHubToken.test.ts:145-163` (insufficient
scope) and `:165-191` (persistence failure). Revocation failure itself is
ignored on purpose — the action is already failing for a reason the caller
needs to see, and replacing it with "revocation failed" would hide it.

**Masking happens before persistence, structurally, not by convention.**
`Secret.forRunnerFile(minted.token)` (`packages/github-actions/src/Secret.ts:74-80`)
registers the value with the runner's log filter and *then* returns
plaintext; `provision` calls it before `state.save(...)`
(`packages/github-actions/src/GitHubToken.ts:224-226`). The test that proves
the ordering asserts the event log itself:
`packages/github-actions/__test__/GitHubToken.test.ts:82-109` records
`["mask:ghs_installation", "save:githubToken"]`, not merely that both
happened. See `actions-state-and-secrets` for the `Secret` seam in full —
`Redacted.value` appears nowhere in `@effected/github-actions` outside that
one module, and a structural test enforces it.

Identity resolution degrades rather than failing the action: a `GET /app`
hiccup logs a warning and the enriched token comes back without identity
fields, falling back to `BotIdentity.githubActions`
(`packages/github-actions/src/GitHubToken.ts:101-132`, tested at
`packages/github-actions/__test__/GitHubToken.test.ts:127-143`). The identity
lookup is supplied the just-minted installation token on purpose:
`GET /users/{slug}[bot]` rejects an app JWT, so without one the request runs
unauthenticated against GitHub's 60-per-hour-per-IP limit.

### `clientLayer`: `layerFromToken`, never the App path

```ts
// packages/github-actions/src/GitHubToken.ts:288-301
static readonly clientLayer = (options: ClientLayerOptions = {}) =>
 Layer.unwrap(
  Effect.map(GitHubToken.read(options), (token) =>
   GitHubClient.layerFromToken({ token: token.token, ...options })),
 );
```

Built with `GitHubClient.layerFromToken`, **not** through `GitHubApp` — quote
the source's own reason
(`packages/github-actions/src/GitHubToken.ts:279-282`): *"the App path links a
JWT signer and needs the private key, neither of which a later phase has or
should have. This path needs only the token the `pre` phase already
minted."* A parameterized layer factory mints a fresh layer per call — bind
`clientLayer(...)`'s result to a `const` rather than calling it at each
composition site, per the memoization discipline in
`effect-v4-services-layers`.

### `dispose`: revoke unless there is nothing to revoke, or nothing left to revoke

```ts
// packages/github-actions/src/GitHubToken.ts:316-329 (shape)
const found = yield* state.getOptional(stateKey, InstallationToken);
if (Option.isNone(found)) return; // pre never got as far as provisioning
if (found.value.isExpired(now, Duration.zero)) return; // GitHub already stopped accepting it
yield* app.revoke(found.value.token);
```

`getOptional`, not `get` — a `post` phase running after a `pre` that failed
before minting anything is a **no-op, not an error**
(tested at `packages/github-actions/__test__/GitHubToken.test.ts:297-306`).
An already-expired token is **not** revoked either
(`:323-339`): GitHub has already stopped accepting it, so the request could
only turn a successful run into a failed one on the way out. This is the one
place `dispose` calls `isExpired` with `Duration.zero` rather than the
default skew — it wants "is GitHub definitely done with this," not "is it
inside the safety margin."

## The lightweight alternative: when a plain token is enough

`GitHubClient.layerFromConfig()` needs none of the above — no `ActionState`,
no `GitHubApp`, no revoke lifecycle, no expiry tracking. It reads a token
through the ambient `ConfigProvider` and hands back a client
(`packages/github/src/GitHubClient.ts:212-221`). Reach for it, over
`Secret.adopt("GITHUB_TOKEN")` (see `actions-state-and-secrets`) feeding a
`ConfigProvider`, when the workflow's own runner-issued token already carries
what the action needs.

**What forces the App path instead** is a permission or an identity the
runner token cannot provide — and `TokenPermissions.assertSufficient`
(via `GitHubToken.provision`'s `required` option) is how that gap is
*discovered typed*, at `pre`, rather than as a `403` in the middle of `main`.
Reach for `GitHubToken.provision` when the action needs permissions broader
than what the workflow's own token was granted, needs to act as a distinct
bot identity rather than `github-actions[bot]`, or needs an installation
token whose lifecycle this package's revoke-on-release and
revoke-on-expiry-boundary guarantees are worth having.

## The complete recipe, both directions

The panel's canon ships a token-minimal template by default — most actions
never need App auth. When one does, this is the whole working lifecycle, not
a partial sketch: five elements, each already documented above and gathered
here as one sequence so a template's optional App-auth module has a single
place to copy from.

1. **`pre.ts` provisions, with required-scope verification.** `GitHubToken.provision({ appId, privateKey, installationId?, owner?, required })` —
   the `required` permission map turns a misconfigured installation into a
   typed failure in `pre`, not a `403` mid-`main`. This is `TokenPermissions.assertSufficient`
   under the hood (see "The lightweight alternative" above); leaving `required`
   unset skips verification entirely, silently, so a working App-auth module
   always sets it.
2. **The mint is persisted as an envelope, not read back from the App.**
   `provision` calls `ActionState.saveSecret` internally — nothing in `pre.ts`
   touches `ActionState` directly; see `actions-state-and-secrets` for the
   masking-before-persistence ordering this relies on.
3. **`main.ts` reads back through `clientLayer()`, never through `GitHubApp` again.**
   `GitHubToken.clientLayer()` builds a `GitHubClient` from the persisted
   token and fails typed (`reason: "expired"`) rather than surfacing an
   unexplained `401` — `main` never re-authenticates as the App, because the
   App's private key never crosses the `pre`/`main` process boundary.
4. **`post.ts` disposes unconditionally, double-netted.** `GitHubToken.dispose()`
   is already a no-op when `pre` never provisioned and skips an already-expired
   token on its own — but the call still needs the same belt-and-braces every
   `post` phase needs generally (`designing-an-action`'s failure-posture step):
   `wrap the dispose call in catch + catchDefect` so a revoke failure (network
   hiccup, GitHub outage) degrades to a logged warning rather than turning a
   green run red on the way out. A `post` phase that fails the workflow over a
   token it was only trying to clean up is strictly worse than a live token
   that expires in an hour on its own.
5. **Add/remove is a documented, symmetric edit, not a one-way door.** Adding
   App auth to an action that started token-minimal: create `pre.ts` + a
   `PreLive` layer, add two inputs to `action.yml` (the App id and private
   key), and in `main.ts` swap `GitHubClient.layerFromConfig()` for
   `GitHubToken.clientLayer()`; create `post.ts` + a `PostLive` layer calling
   `dispose()` per item 4. Removing it later is the exact inverse: delete
   `pre.ts`/`post.ts` and their two inputs, and swap `GitHubToken.clientLayer()`
   back to `GitHubClient.layerFromConfig()` in `main.ts`. Neither direction
   touches any other step — the token source is the only thing that changes.

## Pointers

- **The request surface** (`client.request`, `GitHubError`'s `kind`
  taxonomy, pagination, GraphQL) — `github-api`.
- **Wiring `Action.run`, `ActionRuntime.layer`, and the `ActionRunOptions.layer`
  type-level constraint `clientLayer()`'s fallible construction runs into** —
  `actions-runtime`.
- **The `Secret` declassification seam and `ActionState` persistence** —
  `actions-state-and-secrets`.
- **Testing doubles for any of the above** (`layerTest`, the
  member-usage-table pattern, `TestClock` for expiry) — `testing-actions`.
- **The `Context.Service` form, layer-static placement rule, and
  memoization discipline** referenced throughout — `effect-v4-services-layers`.
- **General v4 idioms** (conditional-spread on `optionalKey`, `Effect.fn`
  spans, `Result` vs `Effect`) — `effect-v4-idioms`.
