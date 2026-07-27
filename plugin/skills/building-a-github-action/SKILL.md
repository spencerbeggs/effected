---
name: building-a-github-action
description: Use FIRST when building, extending or reviewing a GitHub Action, a release/publish pipeline, or any Effect v4 program that talks to the GitHub API — to decide which @effected package owns a capability and which skill teaches it. Answers "how do I build an action", "which service handles X", "does the kit ship Y", and "what replaced @actions/core / @savvy-web/github-action-effects". Trigger phrases include build a GitHub Action, new action, action.yml, GITHUB_TOKEN, GitHub App token, workflow command, job summary, check run, cache in an action, upload an artifact, publish to npm from CI, SBOM, attestation. Rows route; they do not teach.
---

# Building a GitHub Action

The routing map for the five kit packages an action-shaped program uses. **Rows
route; they do not teach** — every pattern lives in the skill the row names.

## The stack

| Package | What it is | Tier |
| --- | --- | --- |
| `@effected/github-actions` | the **runner**: inputs, outputs, state, env, workflow commands, logging, caches, artifacts, tool installs, OIDC, the token bridge | integrated |
| `@effected/github` | the **API**: typed REST and GraphQL over octokit's request surface, App auth, resource services | integrated |
| `@effected/commands` | subprocesses (`Run`) and CLI tool discovery over core's `ChildProcessSpawner` | boundary |
| `@effected/npm` | registry reads (`NpmRegistry`) and publishing (`PackagePublish`), plus dependency vocabulary | boundary |
| `@effected/sbom` | CycloneDX 1.6, NTIA, in-toto/SLSA, Sigstore DSSE signing | integrated |

**The line between the first two is the whole design**: `github` talks to the
GitHub API, `github-actions` talks to the runner it is executing inside.
Nothing in `github-actions` reads `process.env.GITHUB_REPOSITORY` on `github`'s
behalf, and nothing in `github` imports a workflow command. They meet at
exactly two seams, both living in `github-actions`: the token bridge
(`GitHubToken`) and the `Logger` that maps `Effect.log*` onto workflow commands
(`ActionLogger.logger`).

For anything outside these five — globs, semver, lockfiles, JSONC/YAML/TOML,
XDG paths, git introspection, managed file sections — consult
`effected-packages` before writing it by hand.

## I need to… → reach for…

| I need to… | Reach for | Skill |
| --- | --- | --- |
| write `main.ts` / `pre.ts` / `post.ts`, wire layers | `Action.run`, `ActionRuntime.layer`, `ActionServices` | `actions-runtime` |
| read an input, validate it, apply a default | `ActionInput` + Effect `Config` | `actions-inputs-outputs` |
| set an output, export a variable, add to PATH | `ActionOutputs` | `actions-inputs-outputs` |
| emit a machine-readable output contract | `ActionOutputs.setJson` + a `Schema` codec | `actions-inputs-outputs` |
| make the run log readable | `ActionLogger` (`group`, `withBuffer`, `notice`, `annotated`) | `actions-reporting` |
| write the job summary | `ActionOutputs.summary` | `actions-reporting` |
| create a check run or annotate a PR | `CheckRun`, `CheckRun.withCheckRun` | `actions-reporting` |
| post or update a sticky PR comment | `PullRequestComment.upsert` + `CommentMarker` | `actions-reporting` |
| write GitHub-flavored markdown / a findings table | `GitHubMarkdown`, `GitHubMarkdown.tableFor` | `actions-reporting` |
| maintain a sticky-comment or PR-description document | `ManagedDocument` (marker-delimited regions) | `actions-reporting` |
| reconcile check state onto a living document | `CheckDocument` + `CheckState` / `projectCheckState` | `actions-reporting` |
| read the webhook event payload | `ActionEnvironment.payload` | `actions-runtime` |
| pass a value from `pre` to `main` to `post` | `ActionState` | `actions-state-and-secrets` |
| handle a secret without leaking it | `Secret`, `Redacted`, `Redaction` | `actions-state-and-secrets` |
| decide whether a failure should fail the run | `Action.run`'s contract, `DryRun` | `actions-state-and-secrets` |
| kill a background process started in `main` | `DetachedProcess.reap` | `actions-state-and-secrets` |
| call any GitHub REST or GraphQL endpoint | `GitHubClient.request` / `.graphql` / `.paginate` | `github-api` |
| create a branch, tag, release, commit, PR | the resource services (`GitBranch`, `GitTag`, …) | `github-api` |
| authenticate as a GitHub App | `GitHubApp`, `GitHubApp.clientLayer` | `github-app-tokens` |
| mint a token in `pre` and revoke it in `post` | `GitHubToken` provision → read → dispose | `github-app-tokens` |
| cache a directory between runs | `ActionCache` | `actions-cache-and-artifacts` |
| upload or download a workflow artifact | `Artifact` | `actions-cache-and-artifacts` |
| store a blob (GitHub cache or S3-compatible) | `BlobStore`, `GitHubCacheBlobStore`, `BlobEnvelope` | `actions-cache-and-artifacts` |
| install a toolchain on the runner | `ToolInstaller` | `actions-cache-and-artifacts` |
| compute a cache key from file contents | `CacheKey` | `actions-cache-and-artifacts` |
| run a subprocess and get a typed result | `Run.collect` / `text` / `lines` / `json` | `running-commands-and-tools` |
| ask whether a CLI tool is installed | `ToolDiscovery` | `running-commands-and-tools` |
| run a local binary in a workspace or a bare repo | `LocalExec` | `running-commands-and-tools` |
| read a registry: latest version, dist-tags, times | `NpmRegistry` | `release-and-publish` |
| pack and publish a package | `PackagePublish`, `NpmExecutor` | `release-and-publish` |
| derive a release tag or a tracking tag | `ReleaseTag`, `VersioningStrategy` | `release-and-publish` |
| hold a release back by age | `ReleaseAgeGate` | `release-and-publish` |
| emit an SBOM | `Sbom.generate` / `toJson` / `write` | `supply-chain-attestation` |
| sign an artifact and attest a build | `SigstoreSigner`, `SlsaProvenance`, `Attestation.upload` | `supply-chain-attestation` |
| get an OIDC token from the runner | `OidcTokenIssuer` | `supply-chain-attestation` |
| capture SLSA provenance from the runner's claims | `ActionsProvenance.capture` | `supply-chain-attestation` |
| serve `sbom`'s identity contract from the runner | `ActionsIdentityToken.layer` | `supply-chain-attestation` |
| render a DCO sign-off trailer on a bot commit | `BotIdentity.signoff` | `github-api` |
| test any of the above | `makeTest` / `layerTest` on every service | `testing-actions` |

## Call sequences — when the capability is a chain, not one service

Single rows above answer "which service"; these answer "in what order" for the
flows that span services. Each arrow is a real member, verified against source.

| I need to… | Call sequence | Packages |
| --- | --- | --- |
| sign and store an attestation | `SlsaProvenance.forGitHubWorkflow` → `InTotoStatement.forSubject` → `SigstoreSigner.sign` → `Attestation.upload` | `sbom` + `github` |
| publish a package, integrity-checked | `NpmRegistry.version` (already-published probe) → `PackagePublish.setupAuth` → `PackagePublish.pack` → `PackagePublish.publishTarball` | `npm` |
| hold a token across the three phases | `GitHubToken.provision` (pre) → `GitHubToken.read` (main) → `GitHubToken.dispose` (post) | `github-actions` |
| emit an SBOM and attest it | `Sbom.generate` → `Sbom.toJson` → `InTotoStatement.forSubject` → `SigstoreSigner.sign` → `Attestation.upload` | `sbom` + `github` |

## What does NOT exist — do not invent it

| Predecessor construct | Status |
| --- | --- |
| `@actions/core`, `@actions/cache`, `@actions/artifact`, any `@actions/*` | **never** a dependency; the protocols are implemented directly |
| `ActionsRuntime.Default`, `MainLive`/`PreLive`/`PostLive`, any `XLive` const | gone — `ActionRuntime.layer` and `static readonly layer` on each service |
| `ActionsConfigProvider`, an `ActionInputs` service, `ActionInputError` | gone — inputs are `Config`, input failures are `ConfigError` |
| `RateLimiter`, a rate-limit subsystem, proactive throttling | gone — one `RetryPolicy` inside the client, and `client.rateLimit` for the headers |
| eighteen resource-specific error classes | gone — one `GitHubError` with a `kind` discriminant |
| `GitHubGraphQLLive` | gone — GraphQL is a member of the client |
| `GithubMarkdown` (predecessor spelling) | **superseded 2026-07-26** — the kit now ships `GitHubMarkdown` in `@effected/github-actions` (`table`, `tableFor(schema)`, `heading`, `link`, `code`, `codeBlock`, `list`, `details`, `raw`); see `actions-reporting` |
| `ReportBuilder` | **no kit successor, by decision** — report *shaping* is consumer policy. Compose `GitHubMarkdown` pieces, or reach for `@effected/markdown` |
| `ErrorAccumulator` | **no kit successor, by decision** — it is core composition: `Effect.partition(items, f)` returns `[failures, successes]` and never fails (`.repos/effect/packages/effect/src/Effect.ts:556`), and `Effect.all(effects, { mode: "result" })` is the same idea per-effect |
| an ANSI / colour API | does not exist and must not be invented — GitHub's log viewer colours the workflow commands itself |
| the nine `*Test` doubles and the `./testing` subpath | gone — every service ships `makeTest` / `layerTest` from its own module |
| `Action.resolveLogLevel` | **no successor by that name** — `ActionEnvironment.isDebug` (`Effect.Effect<boolean>`, reading `RUNNER_DEBUG === "1"`) is what a program reaches for instead; see `actions-runtime` |

**A bare `Config.*` read on an action input is a false green in tests, not a
shortcut.** Since the 2026-07-25 ruling, `ActionRuntime.layer` installs
`ActionInput.layerDefault`, so **under `Action.run`** a bare read does resolve
the runner's `INPUT_` derivation — production is defended at the root. The
false green lives in suites that bypass the runtime: a test injecting its own
`ConfigProvider` passes against plain names, and the two paths do not parse
booleans identically. Read inputs through `ActionInput` — it carries the
parsing and the typed `ConfigError`s; the runtime provider only stops a
side-step from silently missing. See `actions-inputs-outputs` for the mangling
rule and the production incident it traces to.

**The bundler and the scaffold are not here.** `@savvy-web/github-action-builder`,
`action.config.ts`, rsbuild externals, the committed `dist/`, `action.yml`
metadata validation and the `github-action-template` repo are downstream
savvy-web tooling with their own plugin. This suite teaches the *code* an action
is made of, not how it is bundled or scaffolded.

## Cross-cutting facts every consumer inherits

- **`@effected/github-actions` is the one package in the kit with
  `@effect/platform-node` as a required peer**, and the only one where a `node:`
  import is sanctioned — for digests and HMAC (core `Crypto` is RNG-only at
  beta.101, with no digest), reaping a bare pid, the fd-level detached spawn, and
  the cache/artifact codecs. Sanctioned is not unlimited: everything that *can*
  go through a core contract does.
- **A consumer never mentions the platform.** `ActionRuntime.layer` composes
  `NodeServices.layer` and `FetchHttpClient.layer` internally and has no
  requirements of its own, and `ActionRunOptions.layer` may require anything the
  runtime provides.
- **Heavy engines stay confined and it is measured, not promised.** Azure to
  three modules, Sigstore to one, octokit to `@effected/github`, each with a
  reachability test carrying a control. **Never gather them into a namespace
  object**, never route one through a shared `internal/` helper, and never fold
  one into a default runtime. Consuming actions went from 5 MB to 0.5 MB on this
  invariant.
- **The route is the key.** `client.request("GET /repos/{owner}/{repo}", …)`
  types the parameters *and* the response from the literal alone. A cast in
  GitHub API code is a defect, not a shortcut.
- **Every service ships `makeTest` / `layerTest` and unstubbed members die
  loudly**, naming themselves. The handful of exceptions each carry a stated
  reason.
- **Errors are `Schema.TaggedErrorClass` with ergonomic statics and a `kind`
  discriminant**, and every error reason in these packages has a test that fires
  it. When porting a channel, either demonstrate its failure path or delete it
  from the signature.

## Source access

The packages are the authority, in this order: the package's `CLAUDE.md`, then
its design doc under `.claude/design/effected/packages/`, then the source under
`packages/<name>/src/`. When a doc and the source disagree, **the source wins**
and the doc is a finding worth reporting. For Effect core itself, use
`effect-v4-source-lookup` — the vendored tree under `.repos/effect` settles
existence and signature; only a probe settles semantics.

## The suite

| Skill | Owns |
| --- | --- |
| `actions-runtime` | entry points, `Action.run`, layer wiring, failure rendering |
| `actions-inputs-outputs` | `ActionInput`, `ActionOutputs`, output contracts |
| `actions-reporting` | logs, annotations, summaries, check runs, PR comments |
| `actions-state-and-secrets` | `ActionState`, `Secret`, `DryRun`, `DetachedProcess` |
| `actions-cache-and-artifacts` | `ActionCache`, `Artifact`, `BlobStore`, `ToolInstaller`, `CacheKey` |
| `github-api` | the client, routes, pagination, resilience, the error taxonomy, resources |
| `github-app-tokens` | `GitHubApp`, the client constructors, the `GitHubToken` bridge |
| `running-commands-and-tools` | `Run`, `ToolDiscovery`, `LocalExec`, `Redaction`, `Retry` |
| `release-and-publish` | `NpmRegistry`, `PackagePublish`, tags, versioning, release gates |
| `supply-chain-attestation` | SBOM, NTIA, in-toto/SLSA, OIDC, Sigstore, `Attestation` |
| `testing-actions` | the doubles convention, the octokit harness, the domain's mutants |

For the general Effect v4 rules these all sit on — schema design, service and
layer form, core idioms, observability, testing — see `effect-v4-schema`,
`effect-v4-services-layers`, `effect-v4-idioms`, `effect-v4-observability` and
`effect-v4-testing`. This suite carries only the GitHub-specific instances.
