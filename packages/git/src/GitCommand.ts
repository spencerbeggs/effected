import { ChildProcess } from "effect/unstable/process";

/**
 * Builds a `git` `ChildProcess.StandardCommand` with the argv this package
 * classifies against.
 *
 * @remarks
 * `LC_ALL=C` is pinned on every invocation because git's stderr
 * classification (used by `Git`'s error taxonomy) depends on a stable,
 * untranslated locale. `extendEnv: true` is required alongside it: the
 * default value of `extendEnv` is owned by the platform backend that
 * implements `ChildProcessSpawner`, not by core, so a command that needs
 * `PATH` and the rest of the parent environment must request the merge
 * explicitly rather than rely on an implementation-specific default.
 *
 * The returned command carries no `cwd` — every `GitCommand` constructor
 * produces a cwd-less, pure value. The caller (the `Git` service) applies
 * the working directory per invocation via `ChildProcess.setCwd`, which
 * returns a new command and leaves this one unchanged.
 */
const git = (args: ReadonlyArray<string>): ChildProcess.StandardCommand =>
	ChildProcess.make("git", args, { env: { LC_ALL: "C" }, extendEnv: true });

/**
 * `git show <ref>:<path>` — the contents of `path` as it existed at `ref`,
 * without checking anything out.
 *
 * @public
 */
const show = (ref: string, path: string): ChildProcess.StandardCommand => git(["show", `${ref}:${path}`]);

/**
 * `git ls-tree -r -z <ref> [-- <pathspec>...]` — every path in the tree at
 * `ref`, recursively, NUL-terminated, optionally scoped to `pathspec`.
 *
 * @remarks
 * `-z` is load-bearing: git paths may themselves contain newlines, so the
 * caller must split on `"\0"`, never on `"\n"`. When `pathspec` is provided,
 * a literal `--` separator is inserted before the pathspec entries to prevent
 * git from interpreting pathspec values as options.
 *
 * @public
 */
const lsTree = (ref: string, pathspec: ReadonlyArray<string> = []): ChildProcess.StandardCommand =>
	git(["ls-tree", "-r", "-z", ref, ...(pathspec.length > 0 ? ["--", ...pathspec] : [])]);

/**
 * `git cat-file -e <ref>` — checks whether `ref` resolves to an existing
 * object, without printing it. A non-zero exit means the ref does not exist.
 *
 * @public
 */
const refExists = (ref: string): ChildProcess.StandardCommand => git(["cat-file", "-e", ref]);

/**
 * `git merge-base <a> <b>` — the best common ancestor commit of `a` and `b`.
 *
 * @public
 */
const mergeBase = (a: string, b: string): ChildProcess.StandardCommand => git(["merge-base", a, b]);

/**
 * `git diff --name-only -z [--relative] <base>...<head>` — the paths that
 * differ between the merge base of `base` and `head`, and `head` itself,
 * NUL-terminated.
 *
 * @remarks
 * `-z` is load-bearing here too, for the same reason as {@link GitCommand.lsTree}: split
 * the output on `"\0"`, never on `"\n"`.
 *
 * The relative flag is **explicit in both branches** — `--relative` when
 * `relative` is true, `--no-relative` when false — never omitted. git honors a
 * configured `diff.relative=true` when no flag is passed, so an omitted flag
 * would silently yield cwd-relative paths on such a machine even for
 * `relative: false`, misaligning with {@link GitCommand.untrackedFiles}'s
 * repo-root base and breaking `Git.workingChanges`' dedup in a nested workspace.
 * `--relative` scopes the report to `cwd` (a workspace nested inside a larger
 * repository); `--no-relative` overrides any `diff.relative` config and reports
 * paths from the repository top-level.
 *
 * @public
 */
const changedFiles = (base: string, head: string, relative = false): ChildProcess.StandardCommand =>
	git(["diff", "--name-only", "-z", relative ? "--relative" : "--no-relative", `${base}...${head}`]);

/**
 * `git diff --name-only -z (--relative | --no-relative)` — the paths with
 * unstaged working-tree changes (the working tree against the index),
 * NUL-terminated.
 *
 * @remarks
 * `relative` behaves as it does for {@link GitCommand.changedFiles}, including the
 * explicit-flag-in-both-branches rule: `--no-relative` is passed for
 * `relative: false` so a configured `diff.relative=true` cannot silently make the
 * output cwd-relative.
 *
 * @public
 */
const unstagedChanges = (relative = false): ChildProcess.StandardCommand =>
	git(["diff", "--name-only", "-z", relative ? "--relative" : "--no-relative"]);

/**
 * `git diff --name-only -z (--relative | --no-relative) --cached` — the paths
 * staged for the next commit (the index against `HEAD`), NUL-terminated.
 *
 * @remarks
 * `relative` behaves as it does for {@link GitCommand.changedFiles}, including the
 * explicit `--no-relative` on the `relative: false` branch.
 *
 * @public
 */
const stagedChanges = (relative = false): ChildProcess.StandardCommand =>
	git(["diff", "--name-only", "-z", relative ? "--relative" : "--no-relative", "--cached"]);

/**
 * `git ls-files --others --exclude-standard -z [--full-name]` — the untracked
 * paths git is not ignoring, NUL-terminated.
 *
 * @remarks
 * `ls-files` reports paths relative to `cwd` by default, matching the
 * `--relative` diffs. When `relative` is `false`, `--full-name` makes it emit
 * repo-root-relative paths instead, so the untracked half shares a base with the
 * un-`--relative` diffs — otherwise `Git.workingChanges`'s union would dedup two
 * spellings of one file from a nested `cwd`.
 *
 * @public
 */
const untrackedFiles = (relative = false): ChildProcess.StandardCommand =>
	git(["ls-files", "--others", "--exclude-standard", "-z", ...(relative ? [] : ["--full-name"])]);

/**
 * `git rev-parse --verify <ref>` — resolves `ref` to its full object id, or
 * fails if `ref` does not resolve.
 *
 * @public
 */
const revParse = (ref: string): ChildProcess.StandardCommand => git(["rev-parse", "--verify", ref]);

/**
 * Mutating: `git checkout [--detach] <ref>` — moves the working tree (and, for
 * a branch ref, `HEAD`) to `ref`. When `detach` is true, checks out the ref in
 * detached-HEAD state.
 *
 * @public
 */
const checkout = (ref: string, detach = false): ChildProcess.StandardCommand =>
	git(["checkout", ...(detach ? ["--detach"] : []), ref]);

/**
 * Mutating: `git fetch [--depth <n>] <remote> [tag] <ref>` — fetches the given
 * ref from a remote, optionally with a depth limit and the `tag` keyword.
 *
 * @public
 */
const fetch = (remote: string, ref: string, depth?: number, tag = false): ChildProcess.StandardCommand =>
	git(["fetch", ...(depth !== undefined ? ["--depth", String(depth)] : []), remote, ...(tag ? ["tag"] : []), ref]);

/**
 * Mutating: `git submodule update [--init] [--depth <n>] [-- <paths>...]` — updates
 * registered submodules, optionally initializing them, with an optional depth limit,
 * and scoped to specific paths. The literal `--` separator makes the pathspec
 * injection-safe by construction.
 *
 * @public
 */
const submoduleUpdate = (
	init = false,
	depth?: number,
	paths: ReadonlyArray<string> = [],
): ChildProcess.StandardCommand =>
	git([
		"submodule",
		"update",
		...(init ? ["--init"] : []),
		...(depth !== undefined ? ["--depth", String(depth)] : []),
		...(paths.length > 0 ? ["--", ...paths] : []),
	]);

/**
 * Mutating: `git submodule add [--depth <n>] -- <url> <path>` — registers and
 * initializes a new submodule. The literal `--` separator makes the url and path
 * injection-safe by construction.
 *
 * @public
 */
const submoduleAdd = (url: string, path: string, depth?: number): ChildProcess.StandardCommand =>
	git(["submodule", "add", ...(depth !== undefined ? ["--depth", String(depth)] : []), "--", url, path]);

/**
 * Mutating: `git sparse-checkout set (--cone | --no-cone) <patterns...>` — configures
 * which paths are checked out in a sparse repository. The cone flag is explicit in both
 * branches — `--cone` when `cone` is true, `--no-cone` when false — to prevent git's
 * default from silently changing the behavior.
 *
 * @public
 */
const sparseCheckoutSet = (patterns: ReadonlyArray<string>, cone: boolean): ChildProcess.StandardCommand =>
	git(["sparse-checkout", "set", cone ? "--cone" : "--no-cone", ...patterns]);

/**
 * Mutating: `git config [-f <file>] <key> <value>` — writes a configuration value,
 * optionally into an explicit configuration file (e.g., `.gitmodules`).
 *
 * @public
 */
const configSet = (key: string, value: string, file?: string): ChildProcess.StandardCommand =>
	git(["config", ...(file !== undefined ? ["-f", file] : []), key, value]);

/**
 * Mutating: `git add -- <paths...>` — stages the given paths for commit. The literal
 * `--` separator makes the pathspec injection-safe by construction.
 *
 * @public
 */
const add = (paths: ReadonlyArray<string>): ChildProcess.StandardCommand => git(["add", "--", ...paths]);

/**
 * `git diff --name-status -z (--relative | --no-relative) [<base> | <base>...<head>]`
 * — the changed paths WITH their one-letter status codes, NUL-terminated.
 *
 * @remarks
 * With `head` omitted this is the single-argument diff form: the working tree
 * (staged + unstaged) against `base` — NOT a two-ref range. With `head`
 * present it is the familiar `base...head` merge-base form, matching
 * {@link GitCommand.changedFiles}. `-z` and the explicit relative flag follow
 * the same rules as {@link GitCommand.changedFiles}. In `-z` mode a rename or
 * copy entry is THREE NUL tokens: `R<score>`, the old path, the new path.
 *
 * @public
 */
const nameStatus = (base: string, head: string | undefined, relative = false): ChildProcess.StandardCommand =>
	git([
		"diff",
		"--name-status",
		"-z",
		relative ? "--relative" : "--no-relative",
		head === undefined ? base : `${base}...${head}`,
	]);

/**
 * `git symbolic-ref --quiet --short refs/remotes/<remote>/HEAD` — the name of
 * the default branch on the given remote, or empty string / exit 1 if unset.
 *
 * @remarks
 * `--quiet` suppresses error messages; the exit code alone signals success
 * (0) or "symbolic-ref does not exist" (1). The contract is "does the remote
 * have a HEAD?" — an unset symbolic ref exits 1 silently, which `Git.defaultBranch`
 * degrades to `Option.none()` rather than a typed error. `symbolic-ref` is a
 * purely local ref lookup; it never touches the network.
 *
 * @public
 */
const defaultBranch = (remote = "origin"): ChildProcess.StandardCommand =>
	git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]);

/**
 * `git rev-parse --abbrev-ref HEAD` — the name of the branch `HEAD` is
 * pointing to.
 *
 * @remarks
 * Returns `"HEAD"` (detached state), `"<branch>"` (an attached branch), or
 * fails if the repository has no commits.
 *
 * @public
 */
const currentBranch = (): ChildProcess.StandardCommand => git(["rev-parse", "--abbrev-ref", "HEAD"]);

/**
 * `git rev-parse --show-toplevel` — the filesystem path to the root of the
 * enclosing git repository.
 *
 * @public
 */
const repoRoot = (): ChildProcess.StandardCommand => git(["rev-parse", "--show-toplevel"]);

/**
 * `git log -1 --format=%H%x00%G?%x00%B <ref>` — a NUL-separated triple: the
 * full commit hash, the GPG trust level, and the full commit body (message),
 * all untrimmed.
 *
 * @remarks
 * `%H` is the full object id (40-char sha1, or sha256 if configured).
 * `%x00` is a literal NUL byte (the separator). `%G?` is the GPG trust level
 * (`G` = good signature, `B` = bad, `U` = untrusted, `X` = expired, `Y` =
 * expired key, `R` = revoked key, `E` = error, or `N` = not signed).
 * `%B` is the full body, **untrimmed** — it includes leading/trailing
 * whitespace — so the caller must decide whether to trim it. Splits on the
 * two `\x00` bytes to extract all three values.
 *
 * @public
 */
const commitInfo = (ref = "HEAD"): ChildProcess.StandardCommand => git(["log", "-1", "--format=%H%x00%G?%x00%B", ref]);

/**
 * `git config --get <key>` — the value of the given git config key, or empty
 * string / exit 1 if unset.
 *
 * @public
 */
const configGet = (key: string): ChildProcess.StandardCommand => git(["config", "--get", key]);

/**
 * `git remote get-url <remote>` — the fetch URL of the given remote, or a
 * typed error if the remote does not exist.
 *
 * @public
 */
const remoteUrl = (remote = "origin"): ChildProcess.StandardCommand => git(["remote", "get-url", remote]);

/**
 * `git status --porcelain -z` — the porcelain (stable, machine-readable) short
 * status of every modified file in the working tree, NUL-terminated.
 *
 * @remarks
 * `-z` is load-bearing here too, for the same reason as
 * {@link GitCommand.lsTree}: split the output on `"\0"`, never on `"\n"`.
 * Each entry is a pair of status codes followed by a space and the path.
 *
 * @public
 */
const status = (): ChildProcess.StandardCommand => git(["status", "--porcelain", "-z"]);

/**
 * Pure constructors for the `git` `ChildProcess.Command` values this package
 * spawns.
 *
 * @remarks
 * Every constructor returns a cwd-less, argv-only `Command` — no spawning,
 * no working directory baked in. `Git` applies the working directory per
 * call with `ChildProcess.setCwd` and owns the actual spawn, timeout, and
 * error classification.
 *
 * @public
 */
export const GitCommand = {
	show,
	lsTree,
	refExists,
	mergeBase,
	changedFiles,
	unstagedChanges,
	stagedChanges,
	untrackedFiles,
	revParse,
	checkout,
	fetch,
	submoduleUpdate,
	submoduleAdd,
	sparseCheckoutSet,
	configSet,
	add,
	nameStatus,
	defaultBranch,
	currentBranch,
	repoRoot,
	commitInfo,
	configGet,
	remoteUrl,
	status,
} as const;
