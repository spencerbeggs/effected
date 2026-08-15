# Surface — @effected/git

The six source modules, the argv decisions baked into `GitCommand`, and the parsed models. Read the module for its full list of members; this is the map and the decision record.

**Parent:** [@effected/git context](./CLAUDE.md)

## Six modules

`GitCommand` (and `Git`) are static classes with private constructors, **not `as const` namespace objects** — an `as const` object's member types are inferred in the built `.d.ts` and lose their TSDoc entirely, while `static readonly` declarations keep it (the `@effected/commands` precedent, `11a121e0`). Call syntax is unaffected.

- `GitCommand.ts` — 69 pure constructors returning `GitInvocation` values (a core `ChildProcess.StandardCommand` plus the redacted argv). Every one is cwd-less: the private `git` helper pins `{ env: { LC_ALL: "C" }, extendEnv: true }` and nothing else. `Git` applies `cwd` per call via `ChildProcess.setCwd`, which is dual and returns a **new** command, leaving the pure value untouched.
- `internal/run.ts` — `runCollected` (scoped `spawner.spawn` + `Effect.all` over `[stdout, stderr, exitCode]` with `{ concurrency: "unbounded" }`) and `available`. **Not exported.** `Git.ts` consumes `runCollected` only; `available` has no production consumer (its intended caller `GitReader` dissolved) and is kept deliberately with its tests.
- `Git.ts` — the `Context.Service` (tag id `"@effected/git/Git"`) over the exported `GitShape` interface (the `WorkspaceDiscoveryShape` precedent — consumers type fakes and fields against it), the error taxonomy, the parsed-result models, and the private `classify`/`runClassified` pair.
- `GitConfig.ts` — the pure git-config document model: `GitConfig` (text + structural index; `stringify` is byte-for-byte identity on unmodified documents), `GitConfigSection`/`Entry`/`Include`, `GitConfigDiagnostic`, and typed `GitConfigParseError` / `GitConfigEditError`.
- `Gitmodules.ts` — the typed `.gitmodules` view: `GitmodulesEntry`, decode via `fromConfigResult`/`parseResult`/`parse`, the `FromString` codec, canonical `stringify`, and entry-level mutation statics that compile into `GitConfig`'s surgical edits so a mutated file keeps its formatting. `update` stays a raw string deliberately (git accepts `!command` values).
- `internal/config.ts` — the git-config engine: the line-oriented scanner emitting raw records + diagnostics (the cycle firewall — it never imports the public classes) and the splice/serialize primitives. No recursion anywhere, so no depth cap is needed.

`GitConfig` semantics are git-config, NOT generic INI: case-insensitive section/key names, case-SENSITIVE quoted subsections, the deprecated `[a.b]` dotted form (its subsection compares case-insensitively), multi-valued keys, the bare-`key` boolean shorthand, quoting/escapes/continuations, and `include`/`includeIf` surfaced by `includes()` but never resolved. Edits are text splices + re-parse, so git's own formatting survives; malformed INPUT fails typed, while a hand-built `GitConfig.make` over unparseable text dies as a defect (bad wiring, not bad input).

## Argv decisions inside `GitCommand`

- `checkIgnore` is the one constructor with STDIN baked into the pure command value (`check-ignore -z --stdin` — the only fully robust form, and nothing caller-controlled enters the argv).
- The stash index constructors render `stash@{n}` from an INTEGER the service validates (`rejectNonNaturalNumber`), because every relational guard admits NaN.
- `changedFiles` and the three working-tree diff constructors take a `relative` flag whose diff flag is **explicit in both branches** — `true` passes `--relative`, `false` passes `--no-relative`. The `--no-relative` is load-bearing: git honors a configured `diff.relative=true` when no flag is passed, so an omitted flag would yield cwd-relative paths even for `relative: false`, breaking the repo-root alignment `workingChanges` dedups on. `untrackedFiles` inverts the flag — `false` adds `--full-name` so its `ls-files` output shares the `--no-relative` diffs' repo-root base.
- `Git.workingChanges` and `Git.fetchAny` compose existing methods (`unstagedChanges` + `stagedChanges` + `untrackedFiles`; tag-form `fetch` then plain `fetch`) rather than adding their own constructors.

`submoduleStatus` is the ONE path-emitting parser without a `-z` rule to lean on — git offers no `-z` for `submodule status`, so its parse is line-based and a path containing a newline (or a literal space-parenthesis suffix mimicking the describe parenthesis) would corrupt it. A recorded git-imposed limitation, not an oversight.

## `workingChanges` is the deduplicated union

`Git.workingChanges(cwd, { relative? })` runs `unstagedChanges`, `stagedChanges` and `untrackedFiles` and returns `[...new Set(...)]` of their paths — the full working-tree delta against `HEAD`. It takes no ref, so `UnknownRefError` cannot arise (the arm stays declared for switch exhaustiveness). The `relative`/`--full-name` inversion exists precisely so the `Set` dedups: from a nested `cwd` the diffs and `ls-files` must share one path base, or one file appears under two spellings. `ChangeDetector`'s `includeUncommitted` path consumes this with `relative: true`.

## The parsed models

`Git.ts` defines ten `Schema.Class` models beyond `LsTreeEntry`. Seven back one list parser each: `LsRemoteEntry` (`sha` + full `ref`, `^{}` peel entries preserved, plus the decode-side statics `shortName` and `nearMatches` — the near-miss suggestion policy lives on the entry VALUE, not in the service), `StashEntry` (fixed `-z` `%gd%x1f%H%x1f%gs` format — array position IS the current stash index), `BranchEntry` (`current` decodes the `*` marker), `RefEntry` (the `%(refname)%00%(objectname)%00%(objecttype)` triple), `ConfigListEntry` (`--list -z`, first-newline key/value split so multi-line values survive; a valueless boolean-shorthand key surfaces as `""`), `WorktreeEntry` (porcelain `-z` attribute blocks) and `LsFilesEntry` (`ls-files --stage -z` — the INDEX-side sibling of `LsTreeEntry`, the only read that sees a staged-but-uncommitted `160000` gitlink).

The original three:

- `NameStatusEntry` — `git diff --name-status -z` (`parseNameStatus`). A plain entry is two NUL tokens (`<code>`, `<path>`); a rename/copy entry is three: `<R|C><score>`, the OLD path, then the NEW path. `path` always holds the current path; `oldPath` is set only on rename/copy.
- `StatusEntry` — `git status --porcelain -z` (`parseStatus`). Each entry is `XY <path>`, and a rename/copy entry appends ONE extra NUL token: the ORIGINAL path, AFTER the new path.
- `CommitInfo` — `git log -1 --format=%H%x00%G?%x00%B` (`parseCommitInfo`). `message` is the raw `%B`, deliberately untrimmed — it includes git's trailing format newline, and this package does not decide what "the message" means for a consumer that cares about trailing whitespace.

`StatusEntry.toLine()` renders one `XY <path>` line and `StatusEntry.format(entries)` newline-joins them (no trailing newline). **The rename convention is decided here, once**: the default renders a rename/copy entry's NEW path only — the one a line-oriented consumer can open — a recorded divergence from git's own non-`-z` `orig -> new` rendering, which is opt-in via `{ renames: "arrow" }`. Second recorded divergence: no C-quoting of special-character paths; the rendering targets whitespace-insensitive text consumers, and machine parsers should consume the decoded entries directly.

**Related:** [classification](./CLAUDE.classification.md) · [mutating tier](./CLAUDE.mutating.md) · [testing](./CLAUDE.testing.md)
