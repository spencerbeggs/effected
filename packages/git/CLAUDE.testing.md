# Testing and building — @effected/git

What the 425 tests cover, the two integration suites and their sanctioned patterns, and the mock-spawner recipe.

**Parent:** [@effected/git context](./CLAUDE.md)

## Suite composition

- The `GitCommand` constructor suite: pure invocation shape + the `setCwd` non-mutation guarantee across all 69 constructors, plus the redaction-mask block asserting `redactedArgs` for the sensitive constructors (incl. the `lsRemote`/`remoteAdd`/`remoteSetUrl`/`push`/`pull` URL remotes) and element-wise identity for the rest.
- 6 `internal/run` tests, including defect passthrough through `available`.
- The `Git` suite: the full classification matrix across all seven `ClassifyKind`s; the option-injection guard block, where every guarded positional has a **no-spawn** rejection test; `workingChanges`' union/dedup; `fetchAny`'s tag-then-plain fallback matrix (single-spawn success, both fallback triggers, plain-error surfacing, `NotARepositoryError` short-circuit, no-spawn guard rejection); the `NameStatusEntry`/`CommitInfo`/`StatusEntry`/`SubmoduleStatusEntry` parsers; the submodule tier incl. redaction-through-classify; and the round-2 block (lsRemote parse + `nearMatches`, the stash family incl. NaN/fractional index refusals, the refs/history/config/misc tiers, the push/merge classification matrix with its zero-churn gating control, and redaction-through-classify for the URL-carrying members). Mocked spawner throughout.
- The `Git.log` suite (`__test__/GitLog.test.ts`): the record parser's byte shape over a scripted spawner — the trailing-NUL token that separates "no paths" from "one empty path", the single `\n` git puts before the first path (a path may itself begin with a newline), raw unquoted names — plus the unborn-HEAD degrade in both stderr spellings, both pre-spawn refusals with a **never-spawn** mock, and the typed (never defect) failures for unparseable output and an undecodable date.
- The `GitConfig` suite: a 27-case conformance corpus — count-guarded — each case asserting lookups AND byte-for-byte round-trip, the malformed-input family proving typed failure never defect, and the surgical-edit family.
- The `Gitmodules` suite: decode incl. git boolean vocabulary, typed decode errors naming entry+field, the `FromString` codec, and mutation-compiles-to-surgical-edit assertions.
- 36 integration tests over real git + `@effect/platform-node`: 14 in `__test__/integration/Git.int.test.ts` (show/lsTree/refExists/mergeBase/changedFiles/workingChanges/revParse/checkout, plus the dual-stream backpressure test) and 14 in `__test__/integration/GitSurface.int.test.ts` (`nameStatus`, the promoted working-tree primitives, the quiet probes, `commitInfo`/`status`, and the full mutating tier), including **fixture C**, `Git.log`'s own history repository. Fixture C exists because `log` is the only member whose answer depends on the SHAPE of history rather than one tree: it carries a rename across the scoped path, an off-pathspec commit and a real conflicted-then-resolved merge, which is what makes `--follow` and `--diff-merges=first-parent` falsifiable at all. **`--follow` is not "the unfollowed walk plus more"** — it linearizes and DROPS merge commits (probed, git 2.54), so the two walks can be the same length and only their contents discriminate; a length comparison there is a test that cannot fail for the right reason.

`@effect/vitest` with `assert.*` — never `expect`.

```bash
pnpm vitest run packages/git
pnpm build --filter @effected/git   # from the repo root
```

## Integration-suite rules

- **Do not delete the dual-stream backpressure integration test.** It is the only thing that actually exercises `runCollected`'s `{ concurrency: "unbounded" }` collection — a mock spawner over in-memory streams cannot deadlock the way a real OS pipe can. It puts pressure on *both* stdout and stderr simultaneously; a large-output-on-one-stream case would not discriminate sequential from concurrent collection.
- The integration suites' lifecycle is plain `beforeAll`/`afterAll` + `Effect.runPromise` — the first of its kind in this repo's `@effect/vitest` suites. Triage is done: this is SANCTIONED as a second integration-suite pattern for shared, expensive real-world fixtures; `app`'s `Effect.ensuring` per-test pattern remains the default for cheap per-test fixtures.
- **`GitSurface.int.test.ts` sets `process.env.GIT_ALLOW_PROTOCOL = "file"` at module scope.** git ≥ 2.38 (CVE-2022-39253) blocks a `file://` submodule remote by default; this is a CALLER-ENVIRONMENT decision, not something `Git`'s argv enables — nothing this package spawns sets it. A repo-local `git config protocol.file.allow always` on the superproject does NOT reach `git submodule add`'s internal clone subprocess (verified against git 2.54); only a command-line `-c`, the environment, or global config do. It is contained by the `forks` pool's per-file process isolation, so it cannot leak into other suites.

## Mocking the spawner

Use `Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(mockSpawn))` with `ChildProcessSpawner.makeHandle({...})` over in-memory streams. Only the integration suites spawn real git.

## Build

`savvy.build.ts` carries the **narrow** `_base` suppression (`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the synthesized bases behind every `Schema.TaggedError`/`Schema.Class` export — the error taxonomy, the parsed models, `Git`, the round-2 models and errors, and the `GitConfig`/`Gitmodules` class families (29 suppressed entries at last clean build). **Never widen it**, and never run `node savvy.build.ts --target prod` directly.

**Related:** [surface](./CLAUDE.surface.md) · [classification](./CLAUDE.classification.md) · [mutating tier](./CLAUDE.mutating.md)
