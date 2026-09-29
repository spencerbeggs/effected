# CLAUDE.md — @effected/github-actions

The GitHub Actions **runtime**: the services an action needs to talk to the
runner it runs inside — workflow commands, inputs/outputs/state, cache and blob
store, OIDC, artifacts, tool install, the reporting suite and the
`@effected/sbom` adapters. Integrated tier; peers `effect` and
`@effect/platform-node`; every `@effected/*` arrow points inward.

**`github` talks to the GitHub API; this package talks to the runner.** They
meet at two seams, both here: `GitHubToken` and `ActionLogger.logger`.

## Knowledge bundle

Read `okf/modules/github-actions.md` before adding a module — it is the
authority on what exists, why, and what is deliberately not here. Then load
what matches what you touch:

- Package shape, the closed list of sanctioned `node:` imports, bundle
  reachability, the two structural invariants, testing doubles and disciplines
  → `okf/modules/github-actions.md` — Load when: adding a module, adding a
  dependency, or writing a test here.
- Environment, inputs, logging, outputs/state, secrets, the App-token bridge,
  detached processes and `ChildEnv` → `okf/interfaces/actions-runtime.md` —
  Load when: touching anything `Action.run` composes.
- `RUNNER_DEBUG=1` lowering `References.MinimumLogLevel` to `Debug` inside
  `Action.run` (only ever lowers; opt out with `stepDebugLogLevel: false`)
  → `okf/modules/github-actions.md` §Observability — Load when: touching
  `Action.run`'s composition or why `Effect.logDebug` does or does not show.
- Cache, artifacts, blob store, cache keys, tool and package-manager install
  → `okf/interfaces/actions-storage.md` — Load when: touching `ActionCache`,
  `Artifact`, `BlobStore*`, `CacheKey`, `ToolInstaller` or
  `PackageManagerInstaller`.
- Check surfaces (`CheckState`, `ManagedDocument`, `GitHubMarkdown`,
  `CheckDocument` and its staleness guard) →
  `okf/interfaces/actions-reporting.md` — Load when: touching the reporting
  suite.
- OIDC and provenance adapters → `okf/interfaces/actions-attestation.md` —
  Load when: touching `OidcTokenIssuer`, `ActionsIdentityToken` or
  `ActionsProvenance`.
- Why `@azure/storage-blob` may be imported by exactly three modules, and why
  `@effect/platform-node` is a peer here alone →
  `okf/decisions/azure-blob-confined-to-three-modules.md`,
  `okf/decisions/platform-node-peer-in-one-package.md`,
  `okf/conventions/bundle-reachability-suite.md` — Load when: a reachability
  test fails or you are tempted to hoist a heavy import into `internal/`.
- Per-reason tagged error unions and when to split →
  `okf/decisions/github-actions-per-reason-tagged-errors.md` — Load when:
  adding or reshaping an error class.
- The two structural tests → `okf/invariants/ambient-process-state-read-once.md`
  (a `process.env` read outside `ActionEnvironment` fails
  `__test__/ambientReads.test.ts`) and
  `okf/invariants/redacted-value-only-in-secret.md` (`Redacted.value` outside
  `Secret.ts` fails `__test__/Secret.test.ts`) — Load when: either suite goes
  red.
- Traps → `okf/gotchas/action-input-default-swallows-validation-failure.md`,
  `okf/gotchas/action-r-channel-erasure-and-env-shadowing.md`,
  `okf/gotchas/pnpm-12-placeholder-bin-runs-under-node.md` — Load when: an
  input defaults when it should fail, an `R` channel is cast to `never`, or a
  provisioned pnpm dies at first use.
- Package-manager majors this package must provision →
  `okf/conventions/package-manager-support-policy.md`.
- The line against `github` in full → `okf/glossary/github-split.md`,
  `okf/modules/github.md`.

## Working here

```bash
pnpm vitest run packages/github-actions --coverage.enabled=false   # from the repo root
pnpm build --filter @effected/github-actions
```

Tests use `@effect/vitest` and `assert.*` — **never `expect`** — and live in
`__test__/`. Never run `node savvy.build.ts --target prod`: it skips
`build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped like
a clean gate. Never add an `@actions/*` dependency, and never add the reverse
edge `sbom → github-actions`.
