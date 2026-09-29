# @effected/git

Typed git introspection over core's `ChildProcessSpawner`: a **read tier** that reads a repository's state at any ref without checking it out, a clearly-marked **mutating tier** that changes it, and a **pure git-config core** (`GitConfig` with `Gitmodules` on top, no subprocess anywhere near them). Boundary tier: `effect` is the only peer, zero runtime dependencies, zero `node:` imports in `src/`.

Durable knowledge lives in the OKF bundle at the repo root. Start at `okf/modules/git.md`, then load what the task needs:

- Package design, tiers, the module map, the parsed models and the argv rules → `okf/modules/git.md` — Load when: changing the service surface, adding a member or constructor, or touching a parser or parsed model.
- Error classification (the `ClassifyKind` table, what each kind buys, absorption of `PlatformError` and the timeout) → `okf/decisions/git-classification-happens-once.md`, `okf/limitations/git-stderr-classification-unanchored.md` — Load when: adding a `ClassifyKind` row, a typed error, or asking why a git failure surfaces as the error it does.
- Redaction (the `redactedArgs` mask, error values, span annotations) → `okf/conventions/git-redaction-policy.md` — Load when: adding a constructor that takes a URL, remote or config value, or annotating a span.
- Environment pins and the ssh `BatchMode` resolution → `okf/invariants/git-command-constructors-carry-no-cwd-or-env.md`, `okf/decisions/git-ssh-pin-appends-and-declines.md`, `okf/limitations/git-network-member-latency-multiple-of-timeout.md` — Load when: touching `BASE_ENV`, `resolveSshEnv`, `withBatchMode`, or adding a network-touching member.
- Locating a repository (`repoRoot` is physical, `commonDir` is identity across worktrees) → `okf/modules/git.md`, `okf/decisions/physical-ceiling-is-a-separate-static.md` — Load when: touching `repoRoot` or `commonDir`, or bounding an upward walk by the repository root.
- Config reads versus writes → `okf/gotchas/git-config-read-without-scope-is-merged.md`, `okf/limitations/git-config-set-refuses-dash-leading-values.md` — Load when: touching `configGet`, `configList` or `configSet`.
- Integration-suite traps → `okf/gotchas/git-protocol-file-allow-does-not-reach-submodule-clone.md`, `okf/gotchas/git-log-follow-drops-merge-commits.md` — Load when: writing or debugging a fixture under `__test__/integration/`.
- Testing standards (the shared-fixture `beforeAll`/`afterAll` lifecycle, `assert.*`, the mock spawner) → `okf/conventions/testing-standards.md` — Load when: writing tests or mocking the spawner.

## Operating rules

- Every mutating method's TSDoc opens with the literal word `"Mutating:"`; that is the only tier signal a caller gets, and nothing here serializes concurrent access.
- Every `Git` method funnels through the private `classify` step in `Git.ts`; nothing else in the package may inspect `stderr`, `stdout` or `exitCode`. The stderr matching is unanchored by design — do not "fix" it without discussion.
- A `GitCommand` constructor carries argv and a redaction mask only — no `cwd`, no `env`, no validation. Do not put a pin or a guard back onto one; `assertGitCommand` fails at once.
- A new network-touching member routes through `runForNetwork`; a non-network member never does.
- `parseNameStatus` and `parseStatus` order their rename tokens opposite each other and must never be merged into one implementation.
- Do not delete the dual-stream backpressure integration test; it is the sole regression guard for `runCollected`'s `{ concurrency: "unbounded" }`.
- `@effect/platform-node` is a devDependency for the integration suites only; never in `dependencies` or `peerDependencies`.
- A consumer needing a git read this package lacks gets `@effected/commands`' `Run.collect` (the README recipe), never `src/internal/run.ts`.
- Never widen the narrow `_base` suppression in `savvy.build.ts`; never run `node savvy.build.ts --target prod` directly.

## Commands

```bash
pnpm vitest run packages/git        # @effect/vitest, assert.* — never expect
pnpm build --filter @effected/git   # from the repo root, through turbo
```
