# Checking a repository out: the `Checkout` service

`Checkout` rebuilds the stock `actions/checkout` on `@effected/git`, so an action
can encapsulate the standard checkout (no separate workflow step) or rebuild it
from the kit's parts. It is exported from the `@effected/github-actions` root
beside `ActionLogger`, and it requires `@effected/git`'s `Git` service.

Four static members:

- **`Checkout.checkout(options)`** — does the checkout and resolves a
  `CheckoutResult` (`ref`, `commit`, `path`, `repository`). It sets no action
  outputs itself.
- **`Checkout.cleanup({ stateKey? })`** — the `post` entry's one call. It reads
  what a `"job"` checkout recorded and removes everything it wrote.
- **`Checkout.fromInputs({ prefix? })`** — reads the stock checkout's exact input
  names through `ActionInput`, with the stock defaults, into `CheckoutOptions`.
- **`Checkout.inputs({ prefix? })`** — the matching input declarations (names,
  descriptions, defaults) to merge into `action.yml`; `effected action init` does
  not scaffold them. **`Checkout.writeOutputs(result, { prefix? })`** publishes
  `ref` and `commit` as step outputs.

## The options

`auth` is the only required option: a JavaScript action cannot see `github.token`
unless its `action.yml` declares an input defaulting to `${{ github.token }}`, and
there is no ambient token to fall back on. Pass `CheckoutAuth.Token` with a
`Redacted` token read from an input, or the App token from `GitHubToken.read`;
`CheckoutAuth.Ssh` carries a key, optional known hosts, `strict` (default true),
`user` (default `git`) and an optional token for the API calls.

`ref` is a `CheckoutRef`: `Event` (the workflow's own ref, the default for its own
repository), `Default` (the repository's default branch, the default for any other),
`Branch`, `Tag`, `Commit`, `PullRequest` (`merge` or `head`) or `Ref` (a raw ref
classified as the stock action classifies it). Each member that names something
movable may pin it with `commit`; a mismatch fails `CheckoutCommitMismatchError`.

The rest mirrors the stock inputs: `path`, `clean` (default true), `depth` (default
1, or `"full"`), `fetchTags`, `filter`, `sparse` (`patterns`, `cone` default true),
`lfs`, `submodules` (`false`, `true` or `"recursive"`), `safeDirectory` (default
true), `serverUrl` for GHES, and `allowUnsafePrCheckout` (default false: a fork pull
request checkout under `pull_request_target` or `workflow_run` is refused with
`CheckoutUnsafePullRequestError`).

## The three credential lifetimes

`credentials` decides how long the token (or SSH key) stays on disk. The on-disk
layout matches the stock action's, so a later `git push` or `git fetch` cannot tell
them apart.

| Lifetime | What a later step sees | Removed |
| --- | --- | --- |
| `"job"` (default, as `persist-credentials: true`) | the credentials, usable | by `Checkout.cleanup` in the `post` entry |
| `"action"` | nothing, once the action's own work is done | by a scope finalizer: on success, failure and interruption |
| `"none"` | nothing | before `checkout` returns |

`checkout` requires a `Scope` under every lifetime (the finalizer is a no-op under
`"job"` and `"none"`), so call it inside `Effect.scoped` or the entry's scope. **An
action that uses `"job"` must call `Checkout.cleanup()` in its `post` entry**; without
one the credentials stay on the runner for the rest of the job. A `"job"` checkout
saves its record under `stateKey` before any fetch, so cleanup works after a failed
or cancelled run. `cleanup` never fails (every failure becomes a warning) and is
uninterruptible.

```ts
// main.ts program
const checkedOut = yield* Effect.scoped(
  Checkout.checkout({
    auth: { _tag: "Token", token: Redacted.make(token) },
    credentials: "job",
    ref: { _tag: "Branch", name: "main" },
  }),
);

// post.ts program
const post = Checkout.cleanup();
```

An action that exposes a checkout-compatible interface instead reads
`Checkout.fromInputs()` and merges `Checkout.inputs()` into its `action.yml`;
`persist-credentials: true` is `"job"` and `false` is `"none"`.

## Requirements and failures

`checkout` requires `Scope`, `Git`, `FileSystem`, `Path`, `ChildProcessSpawner`,
`SecureRandom`, `ActionEnvironment`, `ActionOutputs`, `ActionState` and
`ActionLogger`. `Action.run` already provides all but `Git`: add `Git.layer` as the
extra layer. A `GitHubClient` provided in the program is used for the repository's
object format and default branch; without one the checkout builds a client from its
own token (a GHES `serverUrl` derives the API base from it).

It requires a modern git and checks the version once up front, failing
`CheckoutGitTooOldError` before any other git runs. The other typed failures are one
class per reason: `CheckoutRefNotFoundError`, `CheckoutCommitMismatchError`,
`CheckoutAuthError`, `CheckoutPathError` (a `path` that leaves the workspace) and
`CheckoutDefaultBranchError`, plus the git errors `@effected/git` already classifies.
Recover from one with `Effect.catchTag`.

## The log

A checkout is one phase, `Checkout <owner>/<name> @ <ref>`, with one step per piece
of work: version, fetch, checkout, credentials. A green run is a few result lines; a
red one shows the failing git command and its output without a click. The detail of
each step is the `@effected/git` Debug transcript, so a checkout you rebuild from
`Git` members under your own `ActionLogger.step` gets the same one (see
`actions-reporting`). The token is masked before any git runs and never reaches an
argv or `.git/config`.
