# CLAUDE.md — @effected/github-actions

The GitHub Actions **runtime**: the services an action needs to talk to the
runner it runs inside — workflow commands, inputs/outputs/state, cache and blob
store, OIDC, artifacts, tool install, the reporting suite and the
`@effected/sbom` adapters.

**Tier: integrated. Status: complete** (2026-07-25; `sbom` adapters and reporting
suite 2026-07-26). Peers: `effect` and `@effect/platform-node`.
Six `@effected/*` dependencies, every arrow inward. Program frame:
`.claude/plans/2026-07-25-github-split-master.md`.

**Design doc:** `@../../.claude/design/effected/packages/github-actions.md` — the
entry point, and the authority on what exists and why; read it before adding a
module. Depth lives in four children, loaded on demand:

- `@../../.claude/design/effected/packages/github-actions-runtime.md` — the
  runtime services.
- `@../../.claude/design/effected/packages/github-actions-storage.md` — cache,
  blob store, tool install.
- `@../../.claude/design/effected/packages/github-actions-reporting.md` — the
  check and markdown surfaces.
- `@../../.claude/design/effected/packages/github-actions-attestation.md` — OIDC
  and provenance.

**Child context files** carry the reasoning; the rules below stand alone. Load
what matches what you touch: `@./CLAUDE.runtime.md`
(environment, inputs, state, logging, errors), `@./CLAUDE.processes.md`
(`Secret`, `DetachedProcess`, `ChildEnv`), `@./CLAUDE.storage.md` (cache,
artifacts, blob store, tools), `@./CLAUDE.reporting.md` (check surfaces, `sbom`
adapters, `GitHubToken`), `@./CLAUDE.testing.md` (doubles, reachability).

## The line against `@effected/github`

**`github` talks to the GitHub API; this package talks to the runner.** Nothing
here reads `GITHUB_REPOSITORY` on `github`'s behalf, and nothing there imports a
workflow command. They meet at exactly two seams, both living here:
`GitHubToken` and `ActionLogger.logger`. `RepoRef`, `InstallationToken`,
`BotIdentity` and `GitHubClient` stay canonical in `github`; `GitHubContext`,
`RunnerContext` and the workflow-command protocol are canonical **here**.

## What it takes from the kit

The only in-kit consumer of `templates`, `markdown` and `sbom`.

- `github` — the token bridge's vocabulary. `glob` — `CacheKey` matching.
- `npm` — `PackageManagerPin`, **confined to `PackageManagerInstaller.ts`** and
  unreachable from `ActionRuntime.layer`, so taking it costs one layer line.
- `templates` — the region engine under `ManagedDocument` / `CheckDocument`. **Not
  a second engine**: the grammar, line-ending invariant and idempotence proof stay
  in `templates`, under test there.
- `markdown` — the GFM writer's escaping, **confined to `GitHubMarkdown.ts`**.
- `sbom` — `IdentityToken` and `SlsaProvenance`, closed here. **`sbom` must not
  depend on the Actions runtime, so the adapter closing its contract lives here.**
  Never add the reverse edge.

## The `@effect/platform-node` licence, and its limits

This is the **one place in the kit where `@effect/platform-node` is a required
peer** — an action always compiles into a Node process on a GitHub-provided
runner. Two licences follow that nothing else in the kit has: **a sanctioned
`node:` import** for the four things core cannot do (crypto digests,
`process.kill`, the fd-level detached spawn, the zlib/stream codecs) plus the
SigV4 primitives, and **direct `NodeServices.layer` composition** in the default
runtime — the point of `Action.run`.

**Sanctioned is not unlimited**: that list is closed, and everything that *can*
go through a core contract does (why → `@./CLAUDE.processes.md`).

**No `@actions/*` package, ever** — the cache, artifact and tool-cache protocols
are implemented directly against their HTTP APIs, and `@actions/cache` alone
drags a tree larger than this package. Globbing is `@effected/glob`, never
`@actions/glob`.

## Non-negotiables

Each line is the rule; its reasoning is in the child beside it.

**Secrets and processes** → `@./CLAUDE.processes.md`

- `Secret.ts` is the only place `Redacted.value` appears in `src/`; a structural
  test asserts it. A new case means **a new `Secret` member, never an exception**.
- A detached worker inverts masking: it composes `ActionOutputs.layerDetached`,
  and the parent masks **before** the spawn via `Secret.forChildEnv`.
- `DetachedProcess.reap` takes a plain `number` and guards it: `process.kill(0)`
  signals the whole process group. Never trade the guard for a brand.
- `PATH` prepends go through `ChildEnv.prependPath` — a bare `env` replaces the
  child's whole environment.

**Runtime** → `@./CLAUDE.runtime.md`

- Only `ActionEnvironment` reads `process.env`, once, at layer construction, and
  nothing mutates it.
- No caller spells a runner variable name: `ActionInput` for inputs,
  `ActionLogger.annotated` for annotations.
- **Never remove the default `ConfigProvider`** `Action.run` installs; the design
  doc's earlier "no provider" probe is superseded.
- A missing input and `""` are both *missing data*; optional inputs need
  `Config.withDefault`, and a typed `ConfigError` must carry its `actual`.
- Runner-file delimiters are **derived, never random**.
- Every ported error channel is provable with a test, or deleted.

**Storage** → `@./CLAUDE.storage.md`

- `ToolInstaller` stages under the cache root and **renames** into place; a
  partial tool must never be a cache hit.
- `versionOf` hashes the **literal** pattern list on both sides; `save` resolves
  globs, `restore` does not.
- `ActionState.save` proves the encoded form is plain JSON
  (`Schema.OptionFromNullOr`, never `Schema.Option`).
- The results backend exists only inside a `uses:` step; absence reports
  `misconfigured` **naming the variable**.
- Twirp retry lives inside `internal/twirp.ts`, keyed on a structured failure.

**Reporting** → `@./CLAUDE.reporting.md`

- `GitHubMarkdown`'s impossible serializer arm is a **defect, not a fallback**;
  `tableFor` requires `format`.
- `CheckState` mirrors `github`'s conclusion literals **structurally**; never
  "fix" it into an import.
- `CheckDocument` writes only when the render changed, and only `flush` surfaces
  the error.
- `CheckDocument`'s `stamp` is a **per-run constant**; a strictly older pass is
  dropped, announced once, and `flush` answers `written | unchanged | stale`.
- `ManagedDocument` region `meta` is always present and **never addressable**.
- `ActionsProvenance.capture` owns the OIDC-claims rename **once**: eleven
  all-string fields where a transposition typechecks and signs the wrong
  provenance.
- `GitHubToken.read` fails typed on expiry; the app private key never reaches
  `GITHUB_STATE`.

## Bundle reachability

`@azure/storage-blob` is the heaviest external dependency: `ActionCache.ts`,
`Artifact.ts` and `BlobStore.githubCache.ts` may import it, **nothing else** —
three, not the spec's two, because Twirp hands back an Azure blob URL. No shared
helper in `internal/` may import it, the three are separate
named re-exports in `index.ts` (**never** a namespace object), and
**`ActionRuntime.layer` excludes all three**. `@effected/markdown`
(`GitHubMarkdown.ts`) and `@effected/npm` (`PackageManagerInstaller.ts`) are
confined on the same terms.

**Confined means no import edge, not absent.** These are declared dependencies:
every consumer installs them and a bundler's resolver still walks them.
`__test__/reachability.test.ts` proves no light module imports a heavy one, which
— with `"sideEffects": false` and module-per-file output — lets a tree-shaking
bundler drop it. Droppable by construction, not absent by construction; never
restate it as the stronger claim. Mechanics → `@./CLAUDE.testing.md`.

## Working here

```bash
pnpm vitest run packages/github-actions --coverage.enabled=false   # from the repo root
pnpm build --filter @effected/github-actions
```

Tests use `@effect/vitest` and `assert.*` — **never `expect`** — and live in
`__test__/`. Never run `node savvy.build.ts --target prod`: it skips `build:dev`,
emits no `.d.ts`, and leaves a truncated `issues.json` shaped like a clean gate.
