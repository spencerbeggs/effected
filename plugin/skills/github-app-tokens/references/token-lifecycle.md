# The `GitHubToken` bridge and the complete lifecycle recipe

Load when: wiring App auth into an action's `pre`/`main`/`post` phases —
provisioning a token in `pre`, reading it back in `main`, or revoking it in
`post`.

## The bridge: `GitHubToken` in `@effected/github-actions`

```ts
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
a legitimate carve-out for grouped statics, not the namespace-object hazard.

**Why not `GitHubApp.scopedToken` or `GitHubApp.clientLayer` here.** Both
revoke when their `Scope` closes, and in an action the scope closes at the
end of `pre` — before `main` has run a single request. `pre`, `main`, and
`post` are three separate processes; nothing survives between them except
what `GITHUB_STATE` carries. This is a persistence problem, not a `Scope`
problem, which is why `GitHubToken` exists as a distinct primitive.

### The member-usage table, and why it is executable

| Member | `ActionState` | `ActionOutputs` | `GitHubApp` |
| --- | --- | --- | --- |
| `provision` | `save` | `setSecret` | `token`, `identity`, `revoke` |
| `read` | `get` | — | — |
| `botIdentity` | `get` | — | — |
| `clientLayer` | `get` | — | — |
| `dispose` | `getOptional` | — | `revoke` |

This table is the fix for "partial mocks degrade to unimplemented-member
roulette": build a `layerTest` from the table instead of from a stack
trace — supply exactly the documented members for a call and it passes,
omit one and the same call dies. It is not documentation dressed as a
contract, it is executable: a test supplying exactly the documented members
for `provision` passes, and one omitting `ActionOutputs.setSecret` dies the
same way production would. When you extend `GitHubToken`, extend the table
in the same edit, and add both halves of that test.

## The one-hour contract, and why nothing works around it

An installation token lives about an hour. No later phase can re-mint
one — the credential that could is the App's private key, and persisting
*that* through `GITHUB_STATE` (a plaintext file by GitHub's own protocol)
would trade a one-hour token for a permanent one. So the contract is stated
rather than worked around: `GitHubTokenError` carries `reason:
Schema.Literals(["expired"])` — deliberately the only reason — plus
`expiresAt`. `GitHubToken.read` fails typed with `reason: "expired"` rather
than handing back a token that would answer a bare 401 with no explanation.
A phase expected to outlive the hour calls `GitHubToken.provision` itself
instead of trying to stretch a persisted token.

The expiry check underneath both `read` and `dispose` defaults to a
60-second skew, because the check and the request it guards are not the
same instant. `read`'s own `options.skew` overrides it per call; `dispose`
calls it with a zero skew — see below.

## `ProvisionOptions`: what's required, and the field that isn't `permissions`

```ts
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
credentials on its own, so a caller must already hold both.

**The scope-verification field is named `required`, not `permissions`.**
`permissions` is the name of the field on the *minted token*
(`InstallationToken.permissions`, what GitHub actually granted); `required`
is what the caller asks `TokenPermissions.assertSufficient` to check the
grant against. The two are compared, never conflated — a double or a
migration script that writes `permissions` on `ProvisionOptions` compiles
to nothing: the field is silently absent, `options.required` reads
`undefined`, and `provision` skips scope verification entirely rather than
failing to find it.

For a migrant that read its own App-auth inputs (`app-id`, `private-key`,
`owner`) directly: `GitHubToken.provision` takes those as plain fields on
`ProvisionOptions` rather than reading `ActionInput` itself — the
input-reading step moves into the calling action's `pre.ts`. `GitHubToken`
is Actions-agnostic about *how* credentials arrive; `pre.ts` is what makes
it Actions-shaped.

## `provision`: mint, verify, mask, persist — and revoke on any failure

`provision` is an `acquireUseRelease`, and the release arm is the
load-bearing part: if scope verification
(`TokenPermissions.fromGitHub(minted.permissions).assertSufficient(options.required)`)
or persistence fails, the minted token is **revoked** rather than left
live until GitHub expires it — a workflow retrying a failing `pre` would
otherwise leave an hour's worth of unreferenced write tokens behind, each
one a credential nobody is tracking. Revocation failure itself is ignored on
purpose — the action is already failing for a reason the caller needs to
see, and replacing it with "revocation failed" would hide it.

**Masking happens before persistence, structurally, not by convention.**
The secret-declassification member that hands back the plaintext token
registers it with the runner's log filter and *then* returns plaintext;
`provision` calls it before saving state. Ordering is asserted directly on
the event log itself — masking then saving, not merely "both happened" — so
a regression that reorders them fails the test even though both steps still
occur. See `actions-state-and-secrets` for the declassification seam in
full — the raw secret value appears nowhere in `@effected/github-actions`
outside that one module.

Identity resolution degrades rather than failing the action: a hiccup
looking the app identity up logs a warning and the enriched token comes
back without identity fields, falling back to `BotIdentity.githubActions`.
The identity lookup is supplied the just-minted installation token on
purpose — an unauthenticated identity request runs against GitHub's much
tighter per-IP limit, and an app JWT is rejected by that endpoint outright.

## `clientLayer`: `layerFromToken`, never the App path

```ts
static readonly clientLayer = (options: ClientLayerOptions = {}) =>
  Layer.unwrap(
    Effect.map(GitHubToken.read(options), (token) =>
      GitHubClient.layerFromToken({ token: token.token, ...options })),
  );
```

Built with `GitHubClient.layerFromToken`, **not** through `GitHubApp` — the
App path links a JWT signer and needs the private key, neither of which a
later phase has or should have. This path needs only the token `pre`
already minted. A parameterized layer factory mints a fresh layer per
call — bind `clientLayer(...)`'s result to a `const` rather than calling it
at each composition site.

## `dispose`: revoke unless there is nothing to revoke, or nothing left to revoke

```ts
const found = yield* state.getOptional(stateKey, InstallationToken);
if (Option.isNone(found)) return; // pre never got as far as provisioning
if (found.value.isExpired(now, Duration.zero)) return; // GitHub already stopped accepting it
yield* app.revoke(found.value.token);
```

`getOptional`, not `get` — a `post` phase running after a `pre` that failed
before minting anything is a **no-op, not an error**. An already-expired
token is **not** revoked either: GitHub has already stopped accepting it, so
the request could only turn a successful run into a failed one on the way
out. This is the one place `dispose` checks expiry with a zero skew rather
than the default margin — it wants "is GitHub definitely done with this,"
not "is it inside the safety margin."

## The lightweight alternative: when a plain token is enough

`GitHubClient.layerFromConfig()` needs none of the above — no
`ActionState`, no `GitHubApp`, no revoke lifecycle, no expiry tracking. It
reads a token through the ambient `ConfigProvider` and hands back a client.
Reach for it, over adopting a runner-issued token into a `ConfigProvider`
yourself, when the workflow's own runner-issued token already carries what
the action needs.

**What forces the App path instead** is a permission or an identity the
runner token cannot provide — `TokenPermissions.assertSufficient` (via
`GitHubToken.provision`'s `required` option) is how that gap is *discovered
typed*, at `pre`, rather than as a 403 in the middle of `main`. Reach for
`GitHubToken.provision` when the action needs permissions broader than what
the workflow's own token was granted, needs to act as a distinct bot
identity rather than `github-actions[bot]`, or needs an installation token
whose revoke-on-release and revoke-on-expiry-boundary guarantees are worth
having.

## The complete recipe, both directions

Most actions never need App auth; when one does, this is the whole working
lifecycle, not a partial sketch — five elements, gathered here as one
sequence so an App-auth module has a single place to copy from.

1. **`pre.ts` provisions, with required-scope verification.**
   `GitHubToken.provision({ appId, privateKey, installationId?, owner?,
   required })` — the `required` permission map turns a misconfigured
   installation into a typed failure in `pre`, not a 403 mid-`main`.
   Leaving `required` unset skips verification entirely, silently, so a
   working App-auth module always sets it.
2. **The mint is persisted as an envelope, not read back from the App.**
   `provision` calls the state-saving member internally — nothing in
   `pre.ts` touches `ActionState` directly.
3. **`main.ts` reads back through `clientLayer()`, never through
   `GitHubApp` again.** It fails typed (`reason: "expired"`) rather than
   surfacing an unexplained 401 — `main` never re-authenticates as the App,
   because the App's private key never crosses the `pre`/`main` process
   boundary.
4. **`post.ts` disposes unconditionally, double-netted.** `dispose()` is
   already a no-op when `pre` never provisioned and skips an
   already-expired token on its own — but the call still needs the same
   belt-and-braces every `post` phase needs generally: wrap it in `catch` +
   `catchDefect` so a revoke failure (network hiccup, GitHub outage)
   degrades to a logged warning rather than turning a green run red on the
   way out. A `post` phase that fails the workflow over a token it was only
   trying to clean up is strictly worse than a live token that expires in
   an hour on its own.
5. **Add/remove is a documented, symmetric edit, not a one-way door.**
   Adding App auth to an action that started token-minimal: create `pre.ts`
   plus its layer, add two inputs to `action.yml` (the App id and private
   key), and in `main.ts` swap `GitHubClient.layerFromConfig()` for
   `GitHubToken.clientLayer()`; create `post.ts` plus its layer calling
   `dispose()` per item 4. Removing it later is the exact inverse: delete
   `pre.ts`/`post.ts` and their two inputs, and swap `GitHubToken.clientLayer()`
   back to `GitHubClient.layerFromConfig()` in `main.ts`. Neither direction
   touches any other step — the token source is the only thing that
   changes.
