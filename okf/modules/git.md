---
type: Module
title: git
description: Typed git for the kit — a read tier over a repository's state and a clearly-marked mutating tier, plus a pure git-config document model.
status: stable
kind: package
resource: ../../packages/git
tags:
  - architecture
  - security
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T13:22:20Z
integrity:
  generated:
    body: 32319c607e3f61bb
---

# git

## Purpose

`@effected/git` is typed git for the kit, one service in two tiers: a
**read tier** that reads a repository's state without touching the
working tree, and a clearly-marked **mutating tier** that changes it (see
`packages/git/src/Git.ts` for the surface). It programs against core's
subprocess contract (`ChildProcessSpawner` and `ChildProcess.Command`
values from `effect/process`), requiring the spawner in its `R`
channel exactly as the kit's boundary packages require core
`FileSystem`; the consumer's platform layer discharges it once at the
edge.

Scope is closed by its consumers, not by git's porcelain — there is no
ambition toward a general git client, and an operation earns a method
here when a consumer needs it typed. Mutating operations live on `Git`
itself, one service, two tiers, never a second service or package. The
tier marker is documentary and absolute: every mutating method's TSDoc
opens with the literal word `"Mutating:"`, and that is the only signal —
nothing in this package serializes concurrent access, so a caller running
a mutating call alongside anything else against the same `cwd` owns the
race, per `cwd`.

## Why it owns git interpretation

Interpreting git — the exit-code and stderr taxonomy, the
absent-vs-error distinction, tree-entry parsing — is a concern that
should exist once, typed, in a package named for it. The consumers would
otherwise interpret git output and exit codes themselves:
[`workspaces`](workspaces.md)' snapshot reader needs "file at ref, or
none," and multiple consumer packages spawn `git` from many call sites.
Those responsibilities live here instead, behind a small typed surface.
`workspaces`' `ChangeDetector` and `WorkspaceSnapshots` service stand on
this package.

## Tier and dependencies

Boundary tier. `effect` is the only peer; there are no `@effected` edges,
no external runtime dependencies and no `node:` built-ins anywhere in
`src/` — spawning is entirely behind core's `ChildProcessSpawner`
contract, required in `R`. Requiring a core-declared service in `R`
costs the consumer nothing: the IO is discharged by the platform layer
provided once at the edge, the same argument that keeps
[`walker`](walker.md), [`xdg`](xdg.md) and [`config-file`](config-file.md)
at boundary tier over core `FileSystem`. `@effect/platform-node` appears
only in `devDependencies`, for the integration suites — devDependencies
never count toward tier.

## Public surface

See `src/GitCommand.ts` and `src/Git.ts`; the index re-exports only.

### `GitCommand` — pure, inspectable invocations

One git-flavored constructor per operation, producing core
`ChildProcess.StandardCommand` values wrapped in `GitInvocation` (see
[the redaction policy](../conventions/git-redaction-policy.md)), covering
both tiers. `GitCommand` and `Git` are static classes with private
constructors, not `as const` namespace objects, per [the grouped-statics
rule](../conventions/no-barrel-re-exports.md). Constructors know the `git`
executable and each operation's argument conventions; they do **not**
know the environment — a constructor sets `extendEnv: true` and nothing
else, returning a value with neither `cwd` nor `env`, so a test can
assert the exact `command`/`args`/`options` an operation runs without
spawning ([the invariant](../invariants/git-command-constructors-carry-no-cwd-or-env.md)
pins this for every constructor). `Git` applies both `cwd` and `env` per
call via `ChildProcess.setCwd` and `ChildProcess.setEnv` at its single
spawn choke point. The environment pins live on the `Git` **service**
because they serve `classify` and the timeout, which live there, and the
ambient environment is read once in `Git.layer` through `ConfigProvider`,
never `process.env`. Each pin exists for a named failure:

- `LC_ALL=C` — classification depends on untranslated stderr text; a
  localized message silently misclassifies a typed domain error into
  `GitCommandError`.
- `GIT_TERMINAL_PROMPT=0` — git's own credential prompt, which otherwise
  blocks until the timeout.
- `GIT_ASKPASS=""` — the askpass chain, which `GIT_TERMINAL_PROMPT=0` does
  not close; an empty value is a hard stop (probed against git 2.55) that
  also suppresses a configured `core.askPass` and `SSH_ASKPASS`.
- `SSH_ASKPASS_REQUIRE=never` — defense in depth for a caller-supplied ssh
  wrapper that swallows the appended `BatchMode` option.
- `GIT_SSH_COMMAND` — the one conditional pin, scoped to the seven
  network-touching members (`lsRemote`, `fetch`, `fetchUnshallow`,
  `push`, `pull`, `submoduleAdd`, `submoduleUpdate`). `ssh` reads from
  `/dev/tty` directly, so `-o BatchMode=yes` is the only lever that makes
  it fail instead of hang; it is appended to what git would have used and
  declines rather than substitutes — see [the ssh pin
  decision](../decisions/git-ssh-pin-appends-and-declines.md), and [the
  latency limitation](../limitations/git-network-member-latency-multiple-of-timeout.md)
  it implies.

Three invariants ride on the argv: **the `-z` rule** — every
path-emitting constructor emits NUL-terminated output and splits on
`"\0"`, never `"\n"`, because git paths may themselves contain newlines,
while ref-emitting constructors split on newlines safely, since refname
grammar forbids one (two parsers, `lsRemote` and `submoduleStatus`, are
line-based with no choice at all because git offers no `-z` mode for
them; only `submoduleStatus` is unsafe, a recorded git-imposed
limitation). `log`'s `-z` does double duty — NUL-terminating the
`--format` output and disabling git's C-style path quoting — which is why
no `core.quotePath` handling exists anywhere in the package.
**`checkIgnore` bakes stdin into the pure command value** (`check-ignore
-z --stdin`), the only constructor that does, because git rejects `-z`
without `--stdin`. And **an explicit relative flag** — `changedFiles`,
`nameStatus` and the working-tree diff constructors pass `--relative` or
`--no-relative` explicitly, never omitted, because git honors a configured
`diff.relative=true` on an omitted flag; `untrackedFiles` inverts it,
adding `--full-name` when `relative` is false, so its `ls-files` output
shares the `--no-relative` diffs' repo-root base and `workingChanges`'
`Set` actually dedups from a nested `cwd`.

Two argv decisions ride on the service's pre-spawn guards. **Every
ref/range positional beginning with `-` is refused typed** as a
`GitCommandError` of `kind: "refused"` — git would parse it as a flag, and
`checkout("-b")` would create a branch. A blanket `--` separator is
deliberately not used because it flips `checkout` into pathspec mode;
`restore` puts its paths behind a literal `--` and guards only its
`source` ref, which is why it is a separate member. **The stash index
constructors render `stash@{n}` from an integer the service validates**
through `rejectNonNaturalNumber`, because every relational guard admits
`NaN`. `GitCommand`'s pure constructors never validate; the `Git` service
is the guards' home, pinned with never-spawn mocks.

### `Git` — the read tier

A `Context.Service` whose layer resolves `ChildProcessSpawner` once at
construction, so every method's `R` is `never`. The service's shape is
the exported `GitShape` interface, not an inferred object type, so a
consumer can write a function accepting any `GitShape` — a test double, a
decorated instance — without naming the service class. Every method
takes `cwd` explicitly. The per-operation ceiling is git's own policy (30
seconds via `Effect.timeoutOrElse`, owned here).

The core read contracts: `show(cwd, ref, path)` returns `Option<string>` —
absent-at-ref degrades to `Option.none`, never an error, the invariant
`WorkspaceSnapshots.at` depends on; `lsTree`, optionally
pathspec-filtered, returns the entries a compiled
[`glob`](glob.md) set filters; `refExists` answers a non-resolving ref as
`false`, never an error; `mergeBase` and `changedFiles` are the
committed-range primitives `ChangeDetector` runs on; `revParse`
normalizes refs for snapshot cache keys. Working-tree primitives
(`unstagedChanges`, `stagedChanges`, `untrackedFiles`) are public service
methods in their own right, with `workingChanges` composing them as a
deduplicated union that takes no ref, so `UnknownRefError` cannot arise
from it. `nameStatus` is the semantically-typed diff, with a typed status
vocabulary and `oldPath` on renames/copies. `lsRemote` reads over the
network and `lsFiles` reads the index — the only read that sees a
staged-but-uncommitted `160000` gitlink — and both are still reads.
`log` is the history walk, the one member whose parser can fail typed
(see [classification](../decisions/git-classification-happens-once.md)).
Introspection probes degrade "not there" to `Option.none`:
`defaultBranch`, `currentBranch` (git's literal `"HEAD"` for detached HEAD
maps to none — a fake branch name would be worse than an honest absence),
`configGet`, `remoteUrl` and `mergeBaseOption`. `remoteUrl` answers the
URL as git would fetch from it: `git remote get-url` applies the
`url.<base>.insteadOf` rewrites in effect, so for the URL as written in the
configuration — the right source for anything persisted or compared across
machines — read `configGet(cwd, "remote.<remote>.url")`.

**`upstream(cwd)`** is the current branch's upstream with its tracking
state, as `Option<UpstreamBranch>`: `ref` (the full refname,
`refs/remotes/origin/main`, or `refs/heads/<b>` when tracking a local
branch), `name` (the same string `git rev-parse --abbrev-ref @{upstream}`
answers), `gone`, `ahead` and `behind`. Two spawns: `GitCommand.headRef()`
(`symbolic-ref --quiet HEAD`) and `GitCommand.upstream(branchRef)`
(`for-each-ref` with a NUL-separated format), keeping only the exact
record. `Option.none()` covers a detached `HEAD`, an unborn branch and no
configured upstream. **A deleted upstream is still reported**, with
`gone: true` and both counts 0, where `rev-parse @{upstream}` would fail as
an unknown revision. A tracking field the C locale does not write fails as
a `GitCommandError` with `detail`.

Two probes locate a repository, and both answer **physical** paths.
`repoRoot` (`rev-parse --show-toplevel`) is git's symlink-resolved
toplevel, so it need not match the spelling a caller reached the checkout
by — every macOS tmpdir is `/var` reached as `/private/var` — and an
upward walk bounded by it uses [walker](walker.md)'s
`Walker.ascendWithin`, never `ascend`'s lexical `stopAt`. `commonDir`
(`rev-parse --path-format=absolute --git-common-dir`) is repository
**identity**: git answers the same absolute, symlink-resolved directory
from the main checkout, any subdirectory, any linked worktree and any
symlinked path (probed on git 2.55), so two answers compare with `===`,
where `repoRoot` cannot serve because each worktree has its own toplevel.
A bare repository answers its own directory. `--path-format=absolute` is
load-bearing and needs git 2.31 or later: without it git prints `.git`
relative in a plain checkout but absolute inside a linked worktree. An
older git does not refuse the flag: `rev-parse` echoes it to stdout,
answers the relative form and exits 0, so `commonDir` rejects an answer
that starts with `-` or spans lines as a `GitCommandError` rather than
letting it pass as an identity. Only git's terminating newline is
stripped, never `trim`, because a directory name may end in whitespace.
The canonicalization is git's, deliberately — resolving symlinks in this
package would add `FileSystem` to `Git.layer`'s `R`, which stays
`ChildProcessSpawner` alone.

**`treeIdentity(cwd)`** answers both in one spawn
(`GitCommand.treeIdentity()`: `rev-parse --show-toplevel
--path-format=absolute --git-common-dir`; the toplevel comes first because
`--path-format` applies only to the options after it) as
`Option<TreeIdentity { toplevel, commonDir }>`. `Option.none()` covers a
directory outside any repository and one in a repository with no working
tree (a bare repository, or inside `.git`), the latter through the `"tree"`
classify kind. **`TreeIdentity.relation(self, that)`** (dual) answers
`"same-tree"`, `"sibling-worktree"` (one `commonDir`, two toplevels) or
`"different-repo"`. Both paths are git's physical, true-case answers, so
two identities compare as strings with **no realpath step**; compare git
output only with git output, never with a path the caller spelled. The
answer must be exactly two non-empty lines, so an older git that echoes the
flag fails as a `GitCommandError`.

Config reads are
scopeable and config writes are not; [the merged-read
gotcha](../gotchas/git-config-read-without-scope-is-merged.md) explains
the asymmetry.

### `Git` — the mutating tier

Covers checkout, the fetch family, the working-tree restore trio
(`reset`, `clean`, `restore`), branches, tags, stashes, remotes,
worktrees, `commit`/`push`/`pull`, config writes, staging and the
submodule and sparse-checkout operations. `reset` and `clean` fail
loudly on any non-zero exit, so a consumer can restore a tree before
retrying a non-idempotent operation; `clean` passes `--force`
unconditionally, since under git's default `clean.requireForce` a
forceless clean is a guaranteed no-op. `restore` is a separate member
from `checkout`, so `checkout`'s option-like-ref refusal is never
weakened to admit pathspecs. `branchCreate` is one member with two argvs
(`branch [-f]` or `checkout (-b|-B)`), because the delete-then-create
longhand swallows a real edge: `branch -D` refuses the currently
checked-out branch while `checkout -B` resets it fine. `isShallow` is a
dedicated predicate rather than a `revParse` mode, so that member's
contract stays "resolve this ref". `fetchUnshallow` is a distinct mode
and **the caller guards**: git rejects `--unshallow` in a non-shallow
repository and the method does not tolerate that (tolerating would
swallow every other fetch failure shape), so probe with `isShallow`
first; `fetch`'s `unshallow: true` follows the same rule and is refused
typed pre-spawn when combined with `depth`, exactly as git rejects the
pair. `fetch`'s `ref` accepts a full refspec passed through verbatim
(`src:dst`, optionally `+`-prefixed; the guard refuses only a leading
`-`) — never guess-transform a bare ref into a refspec, because under a
single-branch clone a bare-ref fetch updates only `FETCH_HEAD`, and the
`+refs/heads/<b>:refs/remotes/origin/<b>` form is the caller's own
decision. `fetchAny` composes a tag-then-branch fallback as a method,
routing on the caught error's `kind` rather than its stderr text — every
consumer of "fetch this ref, I don't know which kind it is" would
otherwise rebuild the same fallback on stderr strings; a
`kind: "refused"` error re-fails immediately since the plain form would
reject it identically, `NotARepositoryError` propagates from the tag
attempt, and when both attempts fail the plain fetch's error surfaces.
`configSet` writes repository-local, always, and offers no scope; its
guard on `key`, `value` and `file` is [a recorded
limitation](../limitations/git-config-set-refuses-dash-leading-values.md).

### The parsed models

`Git.ts` defines its parsed results as `Schema.Class` models, one per
list parser. Three carry rules a refactor would silently break.
`NameStatusEntry` (`diff --name-status -z`) and `StatusEntry` (`status
--porcelain -z`) order their rename token **opposite** each other — git
emits old-path-then-new-path for the former and new-path-then-old-path
for the latter — so `parseNameStatus` and `parseStatus` must never be
conflated into one implementation. `CommitInfo.message` is the raw `%B`,
deliberately untrimmed including git's trailing format newline, because
this package does not decide what "the message" means for a consumer that
cares about trailing whitespace. `StashEntry`'s array position is the
current stash index. `LsRemoteEntry` carries the near-miss suggestion
policy (`shortName`, `nearMatches`) on the entry value, not in the
service. `ConfigListEntry` splits `--list -z` output on the first newline
so multi-line values survive, and a valueless boolean-shorthand key
surfaces as `""`.

`Git.status` always passes an explicit `--untracked-files=<mode>`
(`GitUntrackedFilesMode`), defaulting to `"all"`, so the listing names one
`??` entry per untracked file and a caller's `status.showUntrackedFiles`
config cannot hide or reshape the untracked axis. Other config, such as
`status.renames`, still applies. A `??` path ending in `/` is a directory,
never a file: under `"normal"` it is a collapsed directory of untracked
files, and under `"all"` only an untracked nested repository still appears
that way (`vendor/inner/`). The default is `"all"` rather than git's
`"normal"` because every consumer that turns entries into file changes
needs files, and silk-release-action's release commit failed reading a
collapsed `.changeset/pre/` entry.

### `GitRemote` — pure remote-address parsing

`GitRemote.ts` is a pure module inside the boundary package: no spawn, no
`Git` service, no regex, no recursion, total and linear.
`GitRemote.parse(raw)` returns `Option<GitRemoteForm>`, `none` only for a
blank string, splitting an address into **verbatim** parts: nothing is
lowercased, no `.git` is stripped, no trailing slash trimmed, nothing
percent-decoded, no shorthand expanded. Four forms, classified in git's own
order (probed against git 2.56 with a recording `GIT_SSH_COMMAND` and a stub
remote helper):

1. **`GitRemoteTransport`** — `<transport>::<address>`, a run of scheme
   characters then `::` (transport.c `transport_get`); the address is parsed
   once more as one of the other three forms, never as a second transport.
2. **`GitRemoteUrl`** — any `://` makes a URL (connect.c
   `parse_connect_url`), with `scheme` (unvalidated), `user`, `host`
   (brackets and case kept, empty for `file:///`), `port` and `path`
   (everything from the first `/`, `?` or `#`).
3. **`GitRemotePath`** — no `:`, or a `/` before the first `:`
   (`url_is_local_not_ssh`, a plain `strchr` with no bracket skipping).
4. **`GitRemoteScp`** — otherwise `[<user>@]<host>:<path>`, the host ending
   at the first `:` after git's bracket rule, `user` split at the last `@`.
   The rule is git's POSIX one, applied on every platform, so a Windows
   drive path `C:/repo` is scp with host `C`, and `github:o/n` is scp with
   host `github`.

**The credential contract** is exact: a URL's password is **never
retained**, in any form, a transport's address included. Credentials in
other positions are retained, because the parts are verbatim: a token used
as the URL user, a token in a query string, and anything git itself reads as
an scp path (git reads `u:s3cret@host:repo` as host `u`, path
`s3cret@host:repo`). `GitRemote.format(remote)` renders it back, so for any
input whose URL userinfo has no password, `format(parse(raw))` is `raw`.
The URL userinfo ends at the **last** `@` after `://`, which is stricter
than git's credential parser (it splits at the first `@` inside the first
`/?#`-bounded span), so an unencoded password holding `@`, `/`, `?` or `#`
is consumed whole instead of leaking part of itself into the host or path.
The accepted cost: an `@` in a URL path is read as the end of userinfo and
the host is lost (`https://h/pkg@1.0/r.git` parses as user `h/pkg`, host
`1.0`).

**`GitRemote.redact(remote)`** is for logging. It masks with `<redacted>`
a URL's or scp form's `user`; a URL's query (from `?` to the end, fragment
included); a URL scheme outside RFC 3986's grammar; in an scp or path form,
whatever could be userinfo before the last `@`, wherever the parse put it,
by string-level masking of the formatted text, which is then re-parsed — so
**a redacted form can come back as a different form**; a transport's URL
scheme unless well-known; and a transport's non-URL address the same
way. Valid schemes, hosts and ports are kept, so the redacted form still
says where the remote is. Log a parsed remote only through `redact`; the
argv redaction rides the same function (see [the redaction
policy](../conventions/git-redaction-policy.md)).
**`GitRemote.repositoryPath(remote)`** strips a URL's leading `/`, one
trailing `/` and one trailing `.git` (`o/n` for both
`https://github.com/o/n.git/` and `git@host:o/n.git`); it is a display and
matching convenience, not a canonical key, since case is untouched and the
host is not included.

## Rendering status back to text

`StatusEntry.toLine()` and `StatusEntry.format(entries)` take the whole
round trip from `git status --porcelain -z` back to line-oriented text
through this package instead of through each consumer's ad-hoc string
building. The rename convention is decided once, here: the default
renders a rename/copy entry's new path only, a recorded divergence from
git's own non-`-z` `orig -> new` rendering, available opt-in via
`StatusRenderOptions`. Paths are emitted raw, never C-quoted, since the
rendering targets whitespace-insensitive text consumers.

## Errors: classification happens once

See [classification happens once](../decisions/git-classification-happens-once.md).

## The pure git-config core

A pure git-config parser/serializer lives inside this package, not as an
INI codec in `config-file` or as shell-out-only access — git-config is
not INI. `GitConfig` is text-first and lossless: the document holds its
source text plus a structural index, `stringify` returns byte-for-byte
identity on unmodified documents, and every edit compiles to a minimal
text splice and re-parses, so comments, ordering and whitespace outside
the edited span survive. The semantics are git-config's, not generic INI:
case-insensitive section and key names, case-sensitive quoted
subsections, the deprecated `[a.b]` dotted form (whose subsection compares
case-insensitively), multi-valued keys, the bare-`key` boolean shorthand,
quoting, escapes and continuations, and `include`/`includeIf` surfaced by
`includes()` but never resolved. Malformed input fails typed
(`GitConfigParseError`), while a hand-built `GitConfig.make` over
unparseable text dies as a defect — bad wiring, not bad input. `Gitmodules` is the typed view on top: a
`GitmodulesEntry` per submodule section, with entry-level mutations
(`setUrl`/`setPath`/`setBranch`/`setShallow`/`add`/`remove`/`rename`)
compiling into `GitConfig`'s surgical editor so git's own formatting
survives. Its `update` field stays a raw string deliberately, since git
accepts `!command` values there.

## The redaction policy

See [the git redaction policy](../conventions/git-redaction-policy.md).

## Module layout

Nine source modules, per the module-per-concept standard: `GitCommand.ts`
(pure invocation constructors, both tiers), `Git.ts` (the service, its
live layer and test double, the error taxonomy, `classify`/`runClassified`
and the parsed-result models, `TreeIdentity` and `UpstreamBranch`
included), `GitRemote.ts` (the pure remote-address parser, a pure module
inside the boundary package), `GitConfig.ts` (the lossless document
model and surgical editor), `Gitmodules.ts` (the typed `.gitmodules`
view), `internal/redact.ts` (the form-independent credential backstop and
the exact-secret maskers), `internal/redactRemote.ts` (the one
string-to-string remote redaction entry point, apart from `redact.ts`
because `GitRemote` imports that module and folding it in would be a
cycle), `internal/run.ts` (the collected-run and `available` helpers over
`ChildProcessSpawner`, not exported — `available` has no production
consumer and is kept deliberately with its tests) and `internal/config.ts`
(the git-config engine: raw scanner records and splice/serialize
primitives behind the cycle firewall; it never imports the public
classes, and it recurses nowhere, so no depth cap is needed).

## Observability

Named spans on each `Git` method, annotated with stable identifiers
(`cwd`, `ref`), never file contents. No logging, no metrics —
telemetry-agnostic. The stable-identifiers-only rule is half of [the
redaction policy](../conventions/git-redaction-policy.md).

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in
`__test__/`. Unit tests over a mocked `ChildProcessSpawner` pin the
classification boundary — the full matrix across every `ClassifyKind`,
the absence-family degrades, the option-injection and natural-number
guards rejecting pre-spawn, the parsers with their opposed rename token
orders, and redaction surviving through `classify`. Unit tests over
`GitCommand` constructors assert exact argv and env plus the redaction
mask, with no spawning. `GitConfig`'s conformance corpus is count-guarded
and asserts both lookups and byte-for-byte round-trip. Integration tests
drive fixture repositories through `@effect/platform-node`'s real
`ChildProcessSpawner` layer, using the shared-fixture `beforeAll`/`afterAll`
lifecycle [testing standards](../conventions/testing-standards.md)
sanction for expensive real-world fixtures. Every integration test is
independent of its siblings' run order, and the surface suite is checked
under `vitest --sequence.shuffle`: a shared fixture is read-only to the
tests that share it, a write a test must make to one is scoped or lands
outside the working tree, and the mutating tier builds a fresh
superproject per test from one read-only library repository rather than
walking a staircase of stages over a shared one. Two traps in those
suites are recorded: [`protocol.file.allow` does not reach a submodule
clone](../gotchas/git-protocol-file-allow-does-not-reach-submodule-clone.md),
and [`--follow` drops merge
commits](../gotchas/git-log-follow-drops-merge-commits.md), which is why
`log` has its own history fixture. A new typed error ships with a control: a test asserts
the error fires on its own members, and a control asserts another member
fed the same stderr still fails as the generic `GitCommandError`, so kind
gating is a guarantee rather than an intention. The dual-stream
backpressure integration test is the only thing that exercises
`runCollected`'s `{ concurrency: "unbounded" }` collection and must not
be deleted — a mock spawner over in-memory streams cannot deadlock the
way a real OS pipe can.

## Consumers

[`workspaces`](workspaces.md)' `ChangeDetector` runs on `Git`
(`changedFiles(relative: true)` for the committed range,
`workingChanges(relative: true)` for `includeUncommitted`), and its
`WorkspaceSnapshots` service reads refs through `show`/`lsTree`. A
non-repository surfaces as this package's typed `NotARepositoryError`.
Other consumers use the introspection tier in place of hand-rolled
subprocess helpers, and the mutating tier backs release-automation flows
such as the restore trio for pre-retry cleanup, `branchCreate`/`push`/`commit`
for a release branch, the stash family and porcelain rendering for job
summaries.

A consumer needing a git read `Git` does not have is pointed at
[`commands`](commands.md)' `Run.collect`, never at the private
`internal/run.ts`: `Run.collect` is the public, bounded (16 MiB per
stream), redaction-capable version of the identical discipline, and the
package README's "Need a git command this package does not have?" section
is the sanctioned recipe, including the pins the caller re-applies by
hand. `Git` itself does not take that edge — the package has no
`@effected` edges by design, and consolidating would swap unbounded
capture for a ceiling and add a child span under every member — so the
parallel implementations are deliberate; amend this concept before
changing that.
