---
"@effected/github": minor
---

## Features

### Six repository resource services, and an extension to a seventh

Secrets, variables, rulesets, deployment environments, security features and CodeQL default setup — route families this package did not cover at all — plus four settings behaviours folded onto the existing `GitHubRepository`. Ported from `@spencerbeggs/reposets`, restructured onto this package's `Repo`-from-context convention.

| Service | Covers |
| :--- | :--- |
| `GitHubRepository` (extended) | the GraphQL `updateRepository` mutation, `security_and_analysis` folding, dependent-merge-key dropping and `ownerType` — folded into the existing service rather than shipped as a second one |
| `RepositorySecret` | Actions / Dependabot / Codespaces / environment secrets, with sealed-box encryption |
| `RepositoryVariable` | Actions and environment variables |
| `Ruleset` | ruleset CRUD, team-slug and org-role resolution |
| `DeploymentEnvironment` | deployment environments |
| `RepositorySecurity` | vulnerability alerts, automated fixes, private vulnerability reporting |
| `CodeScanning` | CodeQL default setup and repository language detection |

No method takes `owner`/`repo`: every one resolves `Repo` per call and carries it in `R`, so `Repo.provide` redirects a program at another repository — the same contract `GitBranch` and its neighbours already keep.

```ts
const program = Effect.gen(function* () {
  const settings = yield* RepositorySettings
  yield* settings.update({ has_issues: true, has_sponsorships: true })
})

// One program, many repositories.
yield* program.pipe(Repo.provide(RepoRef.make({ owner: "acme", repo: "widget" })))
```

### Secrets are encrypted client-side, and the value is `Redacted`

`RepositorySecret.set` takes a `Redacted.Redacted<string>`, fetches the store's public key and sends a libsodium sealed box; the plaintext never crosses the wire. The single `Redacted.value` unwrap happens at the moment of encryption.

`tweetnacl` and `blakejs` are new runtime dependencies, and neither ties this package to Node: `blakejs` is pure JavaScript, and `tweetnacl` feature-detects `getRandomValues` before falling back to Node's `crypto`. The sealing itself uses core's `Encoding` and `TextEncoder`, so **`src` imports no runtime builtin at all**.

A public key that is not valid base64 fails as a typed `GitHubError` naming the route it came from, rather than throwing — garbage from the API is input, and input failures are typed.

### `WorkflowDispatch.list` — ask whether a repository has workflows

```ts
const workflows = yield* (yield* WorkflowDispatch).list;
// ReadonlyArray<WorkflowInfo>: { id, name, path, state }
```

Nothing in this package could answer that question before. It matters for CodeQL setup: `actions` is a real CodeQL language, and GitHub validates it against **workflow files** — which repository *languages* can never report, because those come from linguist. A consumer offering CodeQL setup otherwise had to request `actions` blindly and absorb a 422, or drop it for every repository including the ones where it is valid.

`state` is GitHub's own string (`active`, `disabled_manually`, …), reported rather than interpreted: whether a *disabled* workflow counts for a given GitHub feature is that feature's server-side rule, which this package cannot test, so it does not encode a guess. Filter on it yourself if you care. A repository with no workflows is an empty array, not a failure.

### `updateSettings` now prepares the patch it sends

`GitHubRepository.updateSettings` gained two transformations, so an existing method's behaviour changed:

* **`security_and_analysis` is normalised.** A bare `"enabled"` / `"disabled"` is wrapped into the `{ status }` form GitHub requires; an already-wrapped value passes through untouched. Both shapes now work, and a block that is neither is dropped rather than sent.
* **Dependent merge keys are dropped when their strategy is disabled.** Sending `merge_commit_title` in the same request that sets `allow_merge_commit: false` is a 422 from GitHub, so those keys now travel only with the strategy that owns them.

If you were assembling either shape by hand before calling `updateSettings`, that work is now done for you and doing it yourself is still correct — the wrapped form is passed through, not re-wrapped.

### `applySettings` reports what it sent

It now returns `AppliedSettings` — `{ rest, graphql }`, the field names that actually went out — instead of `void`.

The reason is a dry run. `applySettings` drops what GitHub would reject, so a caller reporting `Object.keys(desired)` describes its own *intent* while this package decides the *content*. The two agree right up until a field is dropped, which is exactly the case someone reading a plan is checking. Both lists use the caller's key names, not the wire names, because the audience is a person reading the plan against the config they wrote.

Deriving the drop rule a second time downstream would be worse than the original mistake, since nothing fails when the copy drifts.

## Bug Fixes

### List reads were truncated to one page

Every list read in the new services — secrets, variables, rulesets, deployment environments, workflows — used a single request, which returns **one page**. A repository with more items than a page holds reported a subset that looked complete.

The most consequential was `Ruleset.upsert`: its existence check is what decides create-versus-update, so past the first page an existing ruleset was invisible and an update became a create. `RepositoryVariable.set` had the same shape.

All of them paginate now. The symptom to recognise, if you have been reading these listings: the array length disagrees with GitHub's own `total_count`.



### A repository-scoped write can no longer overwrite an organization's ruleset

**This is a live defect in `@spencerbeggs/reposets` v3 and anyone running that shape should treat it as a security fix.**

`GET /repos/{owner}/{repo}/rulesets` returns rulesets **inherited from the organization** alongside the repository's own. Matching a ruleset by name alone therefore lets a repository-scoped call issue a `PUT` against the **organization's** ruleset id — rewriting policy for *every repository the organization owns*, from a caller that never mentioned the organization and had no intention of changing anything beyond one repository.

`Ruleset.upsert` filters on `source_type` before matching, so an inherited ruleset can never be the target of a write. Removing that predicate fails two tests, one of which places the organization's ruleset first in the listing precisely so a `find` without the filter takes it.

### A type-correct `security_and_analysis` is no longer silently dropped

Caught in review before this shipped: the first version of the patch preparation above wrapped bare strings only, so a caller passing the shape `RepositoryPatch` actually declares — `{ advanced_security: { status: "enabled" } }`, GitHub's own parameter type — had the entire block discarded on the way out. The request still succeeded, and the setting was never applied.
