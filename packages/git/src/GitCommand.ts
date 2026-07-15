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
 * `git ls-tree -r -z <ref>` — every path in the tree at `ref`, recursively,
 * NUL-terminated.
 *
 * @remarks
 * `-z` is load-bearing: git paths may themselves contain newlines, so the
 * caller must split on `"\0"`, never on `"\n"`.
 *
 * @public
 */
const lsTree = (ref: string): ChildProcess.StandardCommand => git(["ls-tree", "-r", "-z", ref]);

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
 * When `relative` is true, `--relative` is added: git then reports paths
 * relative to the command's `cwd` (rather than the repository top-level) and
 * excludes changes outside that subtree. This is what a workspace nested
 * inside a larger repository needs — without it, a nested workspace sees
 * repository-relative paths that resolve to nothing under its own root.
 *
 * @public
 */
const changedFiles = (base: string, head: string, relative = false): ChildProcess.StandardCommand =>
	git(["diff", "--name-only", "-z", ...(relative ? ["--relative"] : []), `${base}...${head}`]);

/**
 * `git diff --name-only -z [--relative]` — the paths with unstaged working-tree
 * changes (the working tree against the index), NUL-terminated.
 *
 * @remarks
 * `relative` behaves as it does for {@link GitCommand.changedFiles}: scope the
 * report to `cwd` and report paths relative to it.
 *
 * @public
 */
const unstagedChanges = (relative = false): ChildProcess.StandardCommand =>
	git(["diff", "--name-only", "-z", ...(relative ? ["--relative"] : [])]);

/**
 * `git diff --name-only -z [--relative] --cached` — the paths staged for the
 * next commit (the index against `HEAD`), NUL-terminated.
 *
 * @remarks
 * `relative` behaves as it does for {@link GitCommand.changedFiles}.
 *
 * @public
 */
const stagedChanges = (relative = false): ChildProcess.StandardCommand =>
	git(["diff", "--name-only", "-z", ...(relative ? ["--relative"] : []), "--cached"]);

/**
 * `git ls-files --others --exclude-standard -z` — the untracked paths git is
 * not ignoring, NUL-terminated.
 *
 * @remarks
 * `ls-files` already reports paths relative to `cwd`, so there is no
 * `--relative` toggle to apply here.
 *
 * @public
 */
const untrackedFiles = (): ChildProcess.StandardCommand => git(["ls-files", "--others", "--exclude-standard", "-z"]);

/**
 * `git rev-parse --verify <ref>` — resolves `ref` to its full object id, or
 * fails if `ref` does not resolve.
 *
 * @public
 */
const revParse = (ref: string): ChildProcess.StandardCommand => git(["rev-parse", "--verify", ref]);

/**
 * `git checkout <ref>` — the one mutating operation in this package. Moves
 * the working tree (and, for a branch ref, `HEAD`) to `ref`.
 *
 * @public
 */
const checkout = (ref: string): ChildProcess.StandardCommand => git(["checkout", ref]);

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
} as const;
