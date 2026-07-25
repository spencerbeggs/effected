---
status: current
module: effected
category: migration
created: 2026-07-25
updated: 2026-07-25
last-synced: 2026-07-25
completeness: 90
related:
  - README.md
  - ../../plans/2026-07-25-github-split-master.md
  - ../packages/github.md
  - ../packages/github-actions.md
  - ../packages/npm.md
  - ../packages/commands.md
  - claude-code-marketplace-manager.md
  - silk-release-action.md
  - silk-router-action.md
  - silk-sync-action.md
---

# Fluency audit — the Phase 6 acceptance gate

The program's acceptance gate: the five known-bad consumer call sites, rewritten
against the **shipped** kit. Each case quotes the real code as it stands in the
consumer repo today, shows the replacement, and returns a verdict against one
bar:

> **Shorter, clearer, and cast-free.** All three, or the case does not pass.

**No consumer repo is modified by this audit.** Every "before" is a quote; every
"after" is written against APIs verified to exist at this repo's HEAD. Where an
API is cited, it was read out of the committed source, not from memory.

**A note on the source of the five cases.** The master plan's
[acceptance gate](../../../plans/2026-07-25-github-split-master.md#acceptance-gate-phase-6)
lists them; the external spec has no heading called "the fluency test" — its
[§7 table](https://github.com/savvy-web/systems) is the evidence behind them.
The five below are the master plan's, in its order.

## Scoreboard

| # | Case | Shorter | Clearer | Cast-free | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | Octokit typing | yes | yes | yes | **PASS** |
| 2 | Branch upsert | yes | yes | yes | **PASS** |
| 3 | Layer wiring | yes | yes | n/a | **PASS** |
| 4 | Error construction | yes | yes | yes | **PASS** |
| 5 | Env-scoped effects | yes | yes | yes | **PASS — and it fixes a documented defect** |

**All five pass.** Case 3 was provisional in this document's first revision,
pending `Action.run`; it was re-scored **upward** once that landed, because the
self-contained-layer constraint that shaped its "before" turned out to be gone
rather than merely relocated. The re-score is recorded inside the case.

---

## Case 1 — Octokit typing

**The bar:** no `unknown`, no consumer casts.

### 1a. silk-sync-action — three cast interfaces, eight use sites

`silk-sync-action/src/github/reads.ts:57-68` declares three interfaces whose
only purpose is to describe octokit to a library that already had octokit:

```ts
interface RestOctokit {
  rest: {
    repos: { get: (p: unknown) => Promise<{ data: GitHubRepo }>; update: (p: unknown) => Promise<{ data: unknown }> };
    issues: Record<string, (p: unknown) => Promise<{ data: unknown }>>;
  };
}
interface PaginateOctokit<T> {
  rest: { issues: { [k: string]: (p: unknown) => Promise<{ data: T[] }> } };
}
interface RequestOctokit {
  request: (route: string, p: unknown) => Promise<{ data: unknown }>;
}
```

Read the second line of `RestOctokit`: `issues: Record<string, (p: unknown) =>
Promise<{ data: unknown }>>`. The consumer gave up naming the methods at all.

Above them sits `GitHubRepo` (`:6-24`) — **sixteen** repository-settings fields,
hand-declared:

```ts
export interface GitHubRepo {
  readonly node_id: string;
  readonly name: string;
  // … full_name, owner, has_wiki, has_issues, has_projects, has_discussions,
  //   allow_merge_commit, allow_squash_merge, squash_merge_commit_title,
  //   squash_merge_commit_message, allow_rebase_merge, allow_update_branch,
  //   delete_branch_on_merge, web_commit_signoff_required, allow_auto_merge
}
```

Every one of those sixteen exists verbatim in the OpenAPI description the kit
now leans on. And the reads themselves (`:70-73`, `:79-86`):

```ts
export const getRepo = (owner: string, repo: string): Effect.Effect<GitHubRepo, GitHubClientError, GitHubClient> =>
  Effect.flatMap(GitHubClient, (gh) =>
    gh.rest("repos.get", (octokit) => (octokit as RestOctokit).rest.repos.get({ owner, repo })),
  );

export const listLabels = (owner: string, repo: string) =>
  Effect.flatMap(GitHubClient, (gh) =>
    gh.paginate<GitHubLabel>("issues.listLabelsForRepo", (octokit, page, perPage) =>
      (octokit as PaginateOctokit<GitHubLabel>).rest.issues.listLabelsForRepo({ owner, repo, per_page: perPage, page }),
    ),
  );
```

**After.** The three interfaces and the sixteen-field `GitHubRepo` are deleted
outright; `RepositorySettings` is `Rest.Data<"GET /repos/{owner}/{repo}">`:

```ts
const getRepo = GitHubRepository.settings;

const listLabels = Effect.flatMap(GitHubClient, (client) =>
  client.paginate("GET /repos/{owner}/{repo}/issues/labels", { owner, repo }),
);
```

`settings` is the faithful generated payload, not a projection
(`packages/github/src/GitHubRepository.ts:35`) — which is the point: a
projection here would have been the same sixteen-field re-declaration with our
name on it. The `updateSettings` round-trip the consumer performs
(`reads.ts:136-145`) takes `RepositoryPatch`, itself
`Omit<Rest.Params<"PATCH /repos/{owner}/{repo}">, "owner" | "repo">`.

The `RequestOctokit` escape hatch at `:171-175` — a raw
`request("GET /orgs/{org}/properties/values")` with a second cast on the result —
becomes a typed route on the client, no cast on either side.

**Deltas.** 12 lines of cast interface + 19 lines of hand-declared response
shape deleted; 8 cast sites → 0; `unknown` count 6 → 0.

### 1b. claude-code-marketplace-manager — 8 lines of interface for one string

`ManifestCommitter.ts:12-19` and `:48-58`:

```ts
/** Minimal shape of the octokit `repos.get` REST method, cast from `unknown`. */
interface ReposGetOctokit {
  readonly rest: {
    readonly repos: {
      readonly get: (args: { owner: string; repo: string }) => Promise<{ data: { default_branch: string } }>;
    };
  };
}
// …
export const resolveBaseBranch = (input: string | null): Effect.Effect<string, GitHubClientError, GitHubClient> =>
  input !== null
    ? Effect.succeed(input)
    : Effect.gen(function* () {
        const client = yield* GitHubClient;
        const { owner, repo } = yield* client.repo;
        const { default_branch } = yield* client.rest<{ default_branch: string }>("repos.get", (octokit) =>
          (octokit as ReposGetOctokit).rest.repos.get({ owner, repo }),
        );
        return default_branch;
      });
```

**After** (`GitHubRepository.defaultBranch`, `GitHubRepository.ts:45`):

```ts
const resolveBaseBranch = (input: string | null): Effect.Effect<string, GitHubError, GitHubRepository | Repo> =>
  input !== null ? Effect.succeed(input) : GitHubRepository.defaultBranch;
```

**Deltas.** 8 + 11 = 19 lines → 2. The `client.repo` preamble disappears because
the repository is `Repo` in the effect's context rather than something each
caller destructures first.

### 1c. silk-router-action — the survey's only `noExplicitAny`

`phase-detector.ts:118-129`, with its `AssociatedPR` interface at `:17-22`:

```ts
const findMergedReleasePR = Effect.suspend(() =>
  gh
    .rest<ReadonlyArray<AssociatedPR>>(
      "listPullRequestsAssociatedWithCommit",
      // biome-ignore lint/suspicious/noExplicitAny: Octokit shape is opaque to the library
      async (octokit: any) =>
        octokit.rest.repos.listPullRequestsAssociatedWithCommit({
          owner: ghRepo.owner, repo: ghRepo.repo, commit_sha: github.sha,
        }),
    )
    .pipe(/* … */),
);
```

**After** — the method existed in the old package too, at
`services/PullRequest.ts:74`, and this repo never found it. It is now named for
the question it answers and it paginates
(`packages/github/src/PullRequest.ts:103`):

```ts
const findMergedReleasePR = Effect.map(
  PullRequest.listAssociatedWithCommit(github.sha),
  (associated) =>
    associated.find(
      (pull) => Option.isSome(pull.mergedAt) && pull.head === releaseBranch && pull.base === targetBranch,
    ),
);
```

`Effect.suspend` goes too. It was there because the surrounding hand-rolled
retry replayed a cached effect — a footgun the file documents in a comment at
`:117`. The polling half is Case 5's sibling and belongs to `github-actions`;
the *lookup* is now one call.

**Deltas.** 6-line `AssociatedPR` interface + 12-line callback → 5 lines. One
`biome-ignore` suppression deleted — the only one the six-repo survey found.

### Verdict — Case 1: **PASS**

| | Before | After |
| --- | --- | --- |
| Cast interfaces | 5 (37 lines) | 0 |
| Cast **sites** | 16 | 0 |
| `any` suppressions | 1 | 0 |
| Hand-declared response shapes | 25 lines | 0 |

Shorter: yes. Clearer: yes — a route literal says which endpoint is being
called, where `"repos.get"` was a free-form string unrelated to the callback
beside it. Cast-free: yes, and provably so — the package's own suite would not
compile if a resource re-cast a response.

---

## Case 2 — Branch upsert

**The bar:** one call, no TOCTOU dance.

**Before** — `claude-code-marketplace-manager/src/services/ManifestCommitter.ts:91-116`:

```ts
const baseSha = yield* branch.getSha(params.base);
const branchExists = yield* branch.exists(params.branch);
if (branchExists) {
  yield* Effect.logInfo(`Step: land — reset ${params.branch} onto …`);
  yield* branch.reset(params.branch, baseSha);
} else {
  // TOCTOU: another concurrent run can create this branch between the
  // `exists` check above and this `create` call. The library's
  // GitBranchError carries no structured "already exists" discriminant
  // (just a free-form `reason` string), so re-checking existence after a
  // failure — rather than string-matching the message — is the robust
  // way to tell "someone else already created it" from a real failure.
  // The recovery resets rather than merely proceeding, so a concurrent
  // creator that rooted the branch elsewhere is corrected, not inherited.
  yield* branch
    .create(params.branch, baseSha)
    .pipe(
      Effect.catchTag("GitBranchError", (error) =>
        Effect.flatMap(branch.exists(params.branch), (existsNow) =>
          existsNow ? branch.reset(params.branch, baseSha) : Effect.fail(error),
        ),
      ),
    );
}
```

**After** (`packages/github/src/GitBranch.ts`, `upsert`):

```ts
const baseSha = yield* branch.getSha(params.base);
yield* branch.upsert(params.branch, baseSha);
```

**Round trips.** Before: `getSha` + `exists` + (`reset`) or (`create` → on
failure `exists` → `reset`) — up to **four**. After: `getSha` + `upsert`, where
`upsert` is **one** call in the common case and two in the raced one. Both
counts are pinned by tests (*"the common case must not cost an existence
check"*, *"resets in two when a concurrent creator won the race"*).

**The semantics the comment was defending are preserved, not traded away.** The
recovery still *resets* rather than inheriting a branch a concurrent creator
rooted elsewhere, and a failure that is **not** already-exists is still a
failure — there is a test asserting a genuine 422 is not retried as a reset.
What changed is that `kind: "alreadyExists"` is a structural discriminant, so
the second existence check is unnecessary rather than merely unfashionable.

The mirror-image dance at silk-release-action
`create-release-branch.ts:316-339` (update-then-create through a raw cast)
collapses onto the same call, and `GitTag.upsert` covers the tag form that
`releases.test.ts:338,429` string-encodes as `"Reference already exists"` twice.

### Verdict — Case 2: **PASS**

Shorter: 25 lines → 2. Clearer: yes — the 8-line comment explaining *why the
workaround was shaped that way* has nothing left to explain. Cast-free: yes
(there was no cast here; the criterion is satisfied vacuously and the other two
carry the verdict).

---

## Case 3 — Layer wiring

**The bar:** no duplicate sub-provides to mask a token.

**Before** — `silk-release-action/src/main.ts:1085-1105`:

```ts
const actionStateLayer = ActionStateLive.pipe(Layer.provide(NodeServices.layer));
const githubClient = GitHubToken.client().pipe(Layer.provide(actionStateLayer), Layer.orDie);
const githubGraphQL = GitHubGraphQLLive.pipe(Layer.provide(githubClient));
const githubApiBase = Layer.merge(githubClient, githubGraphQL);

const releaseLive = ReleaseLive.pipe(Layer.provide(NodeServices.layer), Layer.orDie);
const npmRegistryLive = NpmRegistryLive.pipe(Layer.provide(CommandRunnerLive));
// 2.0: `PackagePublishLive.setupAuth` masks the registry token via
// `ActionOutputs.setSecret`, so the layer now requires `ActionOutputs`.
// `Action.run`'s `layer` option must be self-contained, so provide a
// `NodeServices`-backed `ActionOutputsLive` here rather than leaking the
// requirement up to `MainLive`.
const actionOutputsLive = ActionOutputsLive.pipe(Layer.provide(NodeServices.layer));
const packagePublishLive = PackagePublishLive.pipe(
  Layer.provide(Layer.mergeAll(CommandRunnerLive, npmRegistryLive, actionOutputsLive)),
);
```

Two separate `NodeServices`-backed sub-provides (`actionStateLayer`,
`actionOutputsLive`), one of them existing **only** so a publish helper can call
`setSecret`, plus a five-line comment explaining why the requirement could not
be allowed to travel upward.

**What shipped that changes it.**

1. **`PackagePublish` no longer requires `ActionOutputs`.** Its layer is
   `Layer<PackagePublish, never, FileSystem | Crypto | ChildProcessSpawner | LocalExec>`
   (`packages/npm/src/PackagePublish.ts:425-429`) — no Actions service anywhere
   in it. The shape's own doc states the hoist: *"Masking the token in a CI log
   is the **caller's** job; this package takes a `Redacted` and has no opinion
   about log output."* The `actionOutputsLive` sub-provide and its comment have
   no successor.
2. **`GitHubGraphQLLive` is gone** — GraphQL is a member of the client, so the
   `githubGraphQL` / `githubApiBase` pair collapses to the client itself.
3. **`NpmRegistry` runs on core `HttpClient`**
   (`packages/npm/src/NpmRegistry.ts:342`), not a shelled `npm view`, so
   `CommandRunnerLive` drops out of that branch entirely.

4. **The self-contained constraint is gone.** This is the one that collapses the
   rest. `Action.run`'s options are
   `readonly layer?: Layer.Layer<R, never, ActionServices>`
   (`packages/github-actions/src/Action.ts:98`) — the extra layer **may require
   anything the runtime provides**, and the runner feeds it in
   (`Layer.provide(extra, ActionRuntime.layer)`, `:199`). And
   `ActionRuntime.layer` is `Layer<ActionServices>` with **no requirements of its
   own** (`:58`), because it composes `NodeServices.layer` and
   `FetchHttpClient.layer` internally (`:81`). A consumer therefore never
   mentions the platform at all — both `NodeServices` sub-provides in the before
   are not relocated, they are **deleted**.

   The whole of the old constraint was **one `never`** in that option's third
   type parameter. Twenty-one lines of consumer wiring, a duplicated
   platform-backed `ActionOutputs`, and a five-line comment explaining why the
   requirement could not travel upward, all followed from a single type argument
   — which is worth holding onto as a general lesson about where a `R` channel's
   width actually gets decided.

**After:**

```ts
// The whole of the wiring.
const githubClient = GitHubToken.clientLayer().pipe(Layer.orDie);
const npm = Layer.mergeAll(
  NpmRegistry.layer,
  PackagePublish.layer.pipe(Layer.provide(Workspaces.localExecLayer())),
);

await Action.run(main, {
  layer: Layer.mergeAll(githubClient, npm, Repo.layerFromConfig().pipe(Layer.orDie)),
});
```

Everything else is satisfied by `ActionServices`, which is
`ActionEnvironment | ActionLogger | ActionOutputs | ActionState | NodeServices | HttpClient`
(`Action.ts:21-26`): `NpmRegistry` needs `HttpClient`; `PackagePublish` needs
`FileSystem | Crypto | ChildProcessSpawner`, all three inside `NodeServices`
(`ChildProcessSpawner | Crypto | FileSystem | Path | Stdio | Terminal`, verified
in `@effect/platform-node`'s `NodeServices.d.ts` at beta.101). The **only**
requirement left over is `LocalExec` — which is the seam that keeps
`@effected/commands` out of the monorepo-tier dependency graph, so paying one
line for it here is the design working, not leaking.

### Verdict — Case 3: **PASS**

**Shorter: yes** — 21 lines → 7, and more to the point **two `NodeServices`
sub-provides → zero**. **Clearer: yes** — the platform is the runtime's business,
and the five-line comment explaining why a masking requirement could not travel
upward has nothing left to explain. **Cast-free: n/a** — this case never had
casts; the other two criteria carry the verdict.

The three questions the provisional verdict left open are all answered by
committed source:

1. **Self-contained constraint: relaxed** — `Layer<R, never, ActionServices>`,
   `Action.ts:98`. Re-scored upward, as the provisional said it should be if this
   turned out to be the case.

   This case now has a **regression test on the other side of the seam**
   (`packages/github-actions/__test__/Action.test.ts:207`, *"takes a layer
   requiring the PLATFORM and ActionOutputs, with no sub-provide"*), which cites
   this audit by name and reconstructs the exact shape of the before: a
   publish-like layer requiring `FileSystem` **and** `ActionOutputs`, handed
   straight to the runner, asserting both that the mask reached the runner and
   that the platform reached the layer. Its discriminating mutant is
   **type-level** — narrowing the option's third parameter back to `never` fails
   compilation rather than failing an assertion, which is the right shape for a
   regression whose original was a type constraint rather than a behaviour.
2. **The App token enters `main` via the persisted token** —
   `GitHubToken.clientLayer()` builds with `GitHubClient.layerFromToken`
   (`GitHubToken.ts:288-301`), and its docstring gives the reason the App path is
   wrong there: *"the App path links a JWT signer and needs the private key,
   neither of which a later phase has or should have."* That is exactly the
   composition the provisional assumed.
3. **No `ActionOutputs` sub-provide anywhere.** Masking moved to the persist
   path — `ActionState.save` calls `setSecret` before it writes
   (`ActionState.ts:116`), as does `Secret` (`Secret.ts:61,78`). `ActionOutputs`
   is a member of `ActionServices`, so it is provided by the runtime rather than
   sub-provided by a consumer. `GitHubToken`'s member-usage table
   (`GitHubToken.ts:160-169`) documents `provision` → `setSecret` explicitly.

**One constraint worth recording, which none of the three questions covered.**
`ActionRunOptions.layer` fixes `E` at `never`, so a layer that can fail at
construction cannot be passed directly. Both `GitHubToken.clientLayer()`
(`E = ActionStateError | GitHubTokenError`) and `Repo.layerFromConfig()`
(`E = ConfigError | InvalidRepoRefError`) need `Layer.orDie` or explicit
handling. **The `Layer.orDie` from the before therefore survives** — but for a
better reason: it used to be there because a *wire-failure* error type was the
wrong shape for "no token configured", and it is now a deliberate "a missing
token is fatal at boot" choice against an honest error. A consumer that would
rather report the expiry than die has the typed error to catch, which is what
`GitHubToken.read`'s expired-token failure exists for (`GitHubToken.ts:153`).

---

## Case 4 — Error construction

**The bar:** one or two fields to build, ergonomic statics.

**Before** — `silk-release-action/src/release/releases.test.ts:203-214`, a
failure-injection test that must hand-build a five-field error inside a
whole-service `Layer.succeed` double:

```ts
const failingReleaseLayer = Layer.succeed((await import("@savvy-web/github-action-effects")).GitHubRelease, {
  create: (options: { tag: string; name: string; body: string; draft?: boolean; prerelease?: boolean }) => {
    customReleaseState.createCalls.push({ tag: options.tag, name: options.name });
    if (options.tag === "v1.0.0") {
      return Effect.fail(
        new GitHubReleaseError({
          operation: "create",
          tag: options.tag,
          reason: "Simulated create failure for pkg-a",
          retryable: false,
        }),
      );
    }
    // … then create/uploadAsset/getByTag/list/updateRelease/listReleaseAssets
    //   all reimplemented around `customReleaseState`
```

and `:248`:

```ts
return Effect.fail(new GitHubReleaseError({ operation: "getByTag", tag, reason: "not found", retryable: false }));
```

and `:334-344`, twice over, string-encoding a condition the type system could
have carried:

```ts
return Effect.fail(new GitTagError({ operation: "create", tag, reason: "Reference already exists" }));
```

**After** — two changes compose. The double goes partial, so only the member
under test is written; and the error has a static, so writing it is one call:

```ts
const failingReleases = GitHubRelease.layerTest({
  create: (input) =>
    input.tag === "v1.0.0"
      ? Effect.fail(GitHubError.rejected("GitHubRelease.create", 422, "simulated create failure for pkg-a"))
      : Effect.succeed(release(input.tag)),
});

const missing = GitHubRelease.layerTest({
  getByTag: (tag) => Effect.fail(GitHubError.notFound("GitHubRelease.getByTag", tag)),
});

const tagExists = GitTag.layerTest({
  create: (tag) => Effect.fail(GitHubError.alreadyExists("GitTag.create", tag)),
});
```

**Three things change at once.**

1. **Fields to build: 4-5 → the static's arguments.** `notFound(operation,
   subject)` and `alreadyExists(operation, subject)` take two; `rejected` takes
   three. `retryable` is gone from the surface entirely — it is a **derived
   getter** over `kind`, because the census found zero consumer reads of it.
2. **The whole-service double disappears.** `releases.test.ts:203-…`
   reimplements six members around a `customReleaseState` map to exercise one;
   `layerTest` stubs the one and lets the other five **die loudly** if touched —
   which also turns the test into a proof that it touches nothing else.
3. **`"Reference already exists"` stops being a string.** The third site above
   encodes a domain condition as prose that some other code must then match.
   `GitHubError.alreadyExists(...)` produces `kind: "alreadyExists"`, the same
   discriminant `GitBranch.upsert` routes on in Case 2 — so the test and the
   production path now agree by construction rather than by coincidence.

### Verdict — Case 4: **PASS**

Shorter: the three quoted constructions go 8 + 3 + 7 lines → 1 line each, and
the surrounding doubles shed roughly 40 lines of reimplemented members between
them. Clearer: yes — `GitHubError.notFound("GitHubRelease.getByTag", tag)` reads
as what it is. Cast-free: yes.

**One honest caveat.** A consumer that today catches `GitHubReleaseError`
specifically will catch `GitHubError` after the port, because the kit ships one
REST error rather than eighteen. That is a deliberate, recorded trade — across
six repos, consumers matched a resource-specific `_tag` exactly **once**, at a
site Case 2 deletes — but it is a real behavioural difference at migration time
and belongs in the per-repo migration notes, not buried here.

---

## Case 5 — Env-scoped effects

**The bar:** a parallel-safe scoped override.

**Before** — `silk-release-action/src/utils/native-version.ts:61-91`. Read the
second `@remarks` block; the file states the defect itself:

```ts
/**
  * Set `GITHUB_TOKEN` from the App token around `use`, restoring the prior state after.
  * …
  * @remarks
  * This mutates shared process env and is not parallel-safe. Phase 1 runs
  * strictly sequentially — do not invoke concurrent applies while this is in
  * effect.
  */
const withGithubTokenEnv = <A, E, R>(use: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.GITHUB_TOKEN;
      const token = Redacted.value(appToken());
      if (token !== "") { process.env.GITHUB_TOKEN = token; }
      return previous;
    }),
    () => use,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.GITHUB_TOKEN;
        else process.env.GITHUB_TOKEN = previous;
      }),
  );
```

**After** (`packages/github-actions/src/ActionEnvironment.ts:126-129`):

```ts
const withGithubTokenEnv = <A, E, R>(use: Effect.Effect<A, E, R>) =>
  Effect.flatMap(ActionEnvironment, (env) =>
    env.withEnv({ GITHUB_TOKEN: Redacted.value(appToken()) }, use),
  );
```

**This case is the only one of the five that fixes a defect rather than a
verbosity.** `withEnv` is backed by a `Context.Reference` holding fiber-local
overrides (`ActionEnvironment.ts:85-88`), so `process.env` is **never mutated**:
concurrent fibers cannot see each other's overrides and there is nothing to
restore. The consumer's "do not invoke concurrent applies" instruction has no
successor because the hazard it warns about cannot occur.

**The claim is proven, not asserted.** `__test__/ActionEnvironment.test.ts:236`
uses **two** latches specifically to defeat a false pass, and its comment says
why:

> TWO latches, and the order is the whole test. A save/restore implementation
> over a shared global is LIFO-correct whenever the two overrides nest properly,
> so an interleaving where the inner one restores before the outer one reads
> passes for the wrong reason. This order forces LEFT TO READ WHILE RIGHT'S
> OVERRIDE IS STILL APPLIED AND UNRESTORED — which only a fiber-local
> implementation survives.

A sibling test (`:281`) asserts `process.env` is untouched after a `withEnv`
call, which is the other half: fiber-local *and* non-mutating.

One recorded trade, from the shape's own docs: a variable exported mid-run by
`ActionOutputs.exportVariable` is not observed, because the snapshot is taken
once — matching GitHub's model, where `exportVariable` targets *subsequent*
steps.

### Verdict — Case 5: **PASS**, and strongest of the five

Shorter: 23 lines → 4. Clearer: yes. Cast-free: yes. And the "not parallel-safe"
caveat is deleted rather than relocated.

---

## Bonus fluency wins

Not part of the five, but earned by the same work and worth the record.

### `GitTag.latestSemver` — O(n) Effects → one pass

`silk-release-action/src/utils/link-issues-from-commits.ts:142-176` spends 35
lines answering "which tag is newest", running **one `Effect.result` per parse**
(`:155`) and **one per comparison** (`:168`):

```ts
for (const entry of tags) {
  const version = extractVersionFromTag(entry.tag);
  const parseResult = yield* Effect.result(SemverResolver.parse(version));
  if (parseResult._tag === "Success") { parseable.push({ ...entry, version }); }
}
let latest = parseable[0] as TagEntry;
for (let i = 1; i < parseable.length; i++) {
  const cmp = yield* Effect.result(SemverResolver.compare(candidate.version, latest.version));
  if (cmp._tag === "Success" && cmp.success === 1) { latest = candidate; }
}
```

**After:** `yield* gitTag.latestSemver()` — `Option<SemverTag>`. **35 lines → 1**,
and no Effect round trip per candidate, because `@effected/semver` exposes
`parseResult` and `compare` as **synchronous** primitives
(`packages/github/src/GitTag.ts:247`). This is the sync-`Result`-primitive
convention paying off across a package boundary, and is worth citing as evidence
in [formatter-convention.md](../formatter-convention.md).

### `ConfigFile.read` — a service per schema → one call

`ConfigFile.read(path, { schema, codec })` (`packages/config-file/src/ConfigFile.ts:708`)
is the one-shot read for a file a program touches once, where standing up a
per-schema service was pure friction. It normalizes `SchemaError` into
`ConfigValidationError` at the boundary, carrying the issue tree rather than a
string.

### `LocalExec` — actions stop installing a monorepo engine

An action running in a single-package checkout wires
`LocalExec.layerFor("npm")` or `LocalExec.layerNone`
(`packages/commands/src/LocalExec.ts:158,163`) and never installs
`@effected/workspaces`. Under the rejected direct-edge design it would have
pulled pnpm's catalog engine into its bundle to ask whether `tar` exists.

### `NpmRegistry`'s registry-axis double

`NpmRegistry`'s test double is seeded **registry → package → version → facts**
(`packages/npm/src/NpmRegistry.ts:325`), the axis the two consumer call sites
were hand-rolling. Its own doc names the evidence: *"Both call sites hand-rolled
a replacement stub; this shape is what they were hand-rolling."* The per-package
keying of the old double broke twice in production tests.

---

## What this audit does not claim

- **No consumer repo has been migrated.** Every "after" is written against
  shipped APIs and reviewed for type-correctness by reading the committed
  signatures; none has been compiled inside a consumer, because the consumers
  are read-only for this program. That is the honest limit of a five-for-five
  scoreboard: it says the surfaces compose as designed, not that a migration has
  been executed.
- **Runtime behaviour is unverified against live GitHub.** The kit's own suites
  drive the real client against scripted HTTP; no case here was executed against
  api.github.com.
- **Case 4 carries a migration caveat**, stated in the case: consumers catching a
  resource-specific error tag will catch `GitHubError` after the port.
