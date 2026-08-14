# @effected/git

Typed git introspection over core's `ChildProcessSpawner`: a **read tier** that reads a repository's state at any ref without checking it out (including the network read `lsRemote` and the index read `lsFiles`), plus a clearly-marked **mutating tier** that changes it. It also carries a **pure git-config core** — `GitConfig` (a lossless, surgical-edit document model) with `Gitmodules` on top, no subprocess anywhere near them. `@effected/workspaces` runs `ChangeDetector` and `WorkspaceSnapshots` on this package's `Git`.

**Design doc:** `@../../.claude/design/effected/packages/git.md` — Load when: changing the service surface, the error taxonomy or the config core.

## Child context files

Each states the reasoning behind a rule below. Load on demand:

- Surface → `@./CLAUDE.surface.md` — Load when: locating a module, adding a constructor, or touching a parser or parsed model.
- Classification → `@./CLAUDE.classification.md` — Load when: adding a `ClassifyKind` row, or asking why a git failure surfaces as the error it does.
- Mutating tier → `@./CLAUDE.mutating.md` — Load when: adding or changing a mutating method.
- Testing and building → `@./CLAUDE.testing.md` — Load when: writing tests, mocking the spawner, or touching the build config.

## Tier: boundary

`effect` is the only peer; there are **zero runtime dependencies and zero `node:` imports anywhere in `src/`**. IO goes through core's `ChildProcessSpawner`, **arriving via the `R` channel** — the same R3 shape as `FileSystem`/`Path` in `@effected/xdg` and `@effected/walker`. `Git.layer` resolves the spawner once at construction (`Layer.effect` reading `ChildProcessSpawner.ChildProcessSpawner`), so every `Git` method's `R` is `never`. Consumers pay nothing for the spawn machinery beyond providing a spawner layer once, at the edge.

`@effect/platform-node` is a **devDependency used only by integration tests** — the `@effected/workspaces` `self.int.test.ts` precedent. It must never appear in `dependencies` or `peerDependencies`; a consumer chooses its own platform backend.

## The redaction policy (#86) — documented, not just convention

Every `GitCommand` constructor returns a **`GitInvocation`**: the spawnable `ChildProcess.StandardCommand` plus `redactedArgs`, the same argv with every sensitive positional masked. The mask lives on the pure constructor because the constructor is the one place that knows which positionals are sensitive:

- `configSet`'s value is masked wholesale as `<redacted>` — a config value can be a secret.
- URL positionals (the remote of `fetch`, `fetchUnshallow`, `lsRemote`, `push` and `pull`; the url of `submoduleAdd`, `submoduleSetUrl`, `remoteAdd` and `remoteSetUrl`) keep everything but an embedded `userinfo@` credential — a plain remote name or credential-free URL passes through untouched. The userinfo mask is greedy through the LAST `@` before the first path slash, so a password containing a literal `@` is masked whole.

`classify` persists ONLY `redactedArgs` into `GitCommandError.args`, and `message` renders that redacted vector, so **raw argv never survives into an error value**; a pre-spawn guard refusal of a sensitive value reports `<redacted>` too. The second half of the policy: **span annotations carry stable identifiers only** — `cwd`, refs, keys, paths, remote names — never config values and never URLs. A new method must follow both halves before it ships; a constructor with no sensitive positional produces element-wise identical raw and redacted argvs, pinned by the `assertGitCommand` helper's default.

## Read tier versus mutating tier

Thirty-one of `Git`'s seventy-one methods only read repository state without touching the working tree (`lsRemote` reads over the NETWORK — still a read); forty mutate. `submoduleStatus` is the one submodule-tier READ, and `submoduleForeach` is marked mutating because the shell command it runs can mutate anything.

**The tier rule is simple and absolute: every mutating method's TSDoc opens with the literal word `"Mutating:"`, and that is the ONLY signal a caller gets.** Nothing in this package serializes concurrent access — a caller running two mutating calls, or a mutating call alongside a read, against the same `cwd` at once owns the race. `Git` does not queue, lock, or detect it.

## The other things that will bite you

- **`LC_ALL=C` + `extendEnv: true` are pinned on every `GitCommand`, unconditionally.** Classification depends on stable, untranslated stderr text (`"not a git repository"`, `"unknown revision"`); a localized message would silently misclassify into `GitCommandError` instead of the typed domain error. `extendEnv: true` is required alongside it because its default is owned by whichever platform backend implements `ChildProcessSpawner`, not by core.
- **Classification happens once.** Every `Git` method funnels through the private `classify` step in `Git.ts`; nothing else in the package may inspect `stderr`, `stdout` or `exitCode`. `PlatformError` and `Cause.TimeoutError` are absorbed inside `runClassified` and never escape a method; the 30s `GIT_TIMEOUT` ceiling is owned here, not by the caller.
- **The stderr matching is unanchored substring matching** against `LC_ALL=C`-pinned phrases, so a path or ref that literally contains one could misclassify. **Accepted as a deliberate tradeoff** — anchoring is deferred until a real collision is observed. Do not "fix" it without discussion.
- **The option-injection guard runs pre-spawn.** Every ref/range argument (`show`/`lsTree`/`refExists`/`revParse`/`checkout` refs, both sides of `mergeBase` and `changedFiles`) beginning with `-` fails typed as `GitCommandError` — git would parse it as a flag, and `checkout("-b")` would create a branch. A blanket `--` separator is deliberately NOT used (it flips `checkout` into pathspec mode). `GitCommand`'s pure constructors do not validate; the `Git` service is the guard's home, pinned including a never-spawn mock.
- **The `-z` rule.** `lsTree`, `changedFiles` and the three working-tree constructors **always** use `-z` and split on `"\0"` via `parseNulSeparated` — never on `"\n"`, because git paths may contain newlines. `-z` is baked into the argv unconditionally; there is no non-`-z` code path to regress into.
- **`NameStatusEntry` and `StatusEntry` order their rename token OPPOSITE each other** — `diff --name-status -z` emits old-path-then-new-path, `status --porcelain -z` emits new-path-then-old-path. `parseNameStatus` and `parseStatus` must never be conflated or refactored into one implementation; each is correct only for its own token order.
- **Never widen the narrow `_base` build suppression**, and never run `node savvy.build.ts --target prod` directly — build through `pnpm build --filter @effected/git`.
- **Do not delete the dual-stream backpressure integration test** — it is the sole regression guard for `runCollected`'s `{ concurrency: "unbounded" }`.

Tests: `pnpm vitest run packages/git` (`@effect/vitest`, `assert.*` — never `expect`).
