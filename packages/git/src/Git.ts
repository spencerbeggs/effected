import { Context, Duration, Effect, Layer, Option, PlatformError, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type { GitInvocation } from "./GitCommand.js";
import { GitCommand } from "./GitCommand.js";
import type { Collected } from "./internal/run.js";
import { runCollected } from "./internal/run.js";

/** git's own ceiling: a run that has not answered in 30s is not going to. */
const GIT_TIMEOUT = Duration.seconds(30);

/**
 * git ran and failed in a way that is not one of the recognized domain cases
 * ({@link NotARepositoryError} / {@link UnknownRefError}), or the spawn itself
 * failed before git could run at all.
 *
 * @remarks
 * `exitCode` and `stderr` are populated when git actually ran. `detail`
 * carries a human-readable explanation of an absorbed spawn-level
 * `PlatformError` or a per-run timeout — the two cases where git never
 * produced an exit code at all. `kind`
 * discriminates a pre-spawn guard rejection (`"refused"`) from a genuine git
 * failure (`"failed"`) structurally, so composed retry/fallback logic never has
 * to parse the prose in `message` or `detail`.
 *
 * @public
 */
export class GitCommandError extends Schema.TaggedError<GitCommandError>()("GitCommandError", {
	/**
	 * Discriminates a pre-spawn guard rejection from a genuine git failure.
	 * `"refused"` — a pre-spawn guard (an option-like ref) rejected the
	 * invocation and no process was ever spawned. `"failed"` — git actually ran
	 * and exited non-zero, or the spawn/IO itself failed. Composed retry/fallback
	 * logic routes on this instead of matching `detail` prose.
	 */
	kind: Schema.Literals(["refused", "failed"]),
	/**
	 * The REDACTED argument vector, without the leading `git`.
	 *
	 * Sensitive positionals — config values, a URL's embedded userinfo — are
	 * already masked by the constructor's redaction mask before this error is
	 * constructed (`configSet`'s value reads `<redacted>`; a
	 * `https://user:token@host/...` remote keeps everything but its
	 * `userinfo@`). The raw argv is never persisted in an error value, and
	 * `message` renders this redacted vector.
	 */
	args: Schema.Array(Schema.String),
	/** The working directory the command ran in. */
	cwd: Schema.String,
	/** git's exit code, when it produced one. */
	exitCode: Schema.optionalKey(Schema.Number),
	/** git's stderr, captured under `LC_ALL=C`. */
	stderr: Schema.String,
	/** Set when git never ran: an absorbed spawn failure or a timeout. */
	detail: Schema.optionalKey(Schema.String),
}) {
	/** Renders the invocation and its failure into a one-line message. */
	override get message(): string {
		return this.detail !== undefined
			? `git ${this.args.join(" ")} in ${this.cwd}: ${this.detail}`
			: `git ${this.args.join(" ")} in ${this.cwd} failed (exit ${this.exitCode ?? "?"}): ${this.stderr}`;
	}
}

/**
 * `cwd` is not inside a git work tree.
 *
 * @public
 */
export class NotARepositoryError extends Schema.TaggedError<NotARepositoryError>()("NotARepositoryError", {
	/** The working directory that is not a git repository. */
	cwd: Schema.String,
}) {
	/** Renders the failing directory into a one-line message. */
	override get message(): string {
		return `not a git repository: ${this.cwd}`;
	}
}

/**
 * `ref` does not resolve to an object in the repository at `cwd`.
 *
 * @public
 */
export class UnknownRefError extends Schema.TaggedError<UnknownRefError>()("UnknownRefError", {
	/** The ref (or ref range) that failed to resolve. */
	ref: Schema.String,
	/** The working directory the ref was resolved against. */
	cwd: Schema.String,
}) {
	/** Renders the unresolvable ref into a one-line message. */
	override get message(): string {
		return `unknown ref '${this.ref}' in ${this.cwd}`;
	}
}

/**
 * A `git push` was rejected because the remote ref has moved: the classic
 * non-fast-forward rejection (`fetch first` / `non-fast-forward`), or a
 * `--force-with-lease` lease failure (`stale info`).
 *
 * @remarks
 * The typed signal a fetch-then-retry (or rebase-then-retry) fallback
 * branches on — every other push failure stays a {@link GitCommandError}.
 * Only `Git.push` can fail with this error.
 *
 * @public
 */
export class NonFastForwardError extends Schema.TaggedError<NonFastForwardError>()("NonFastForwardError", {
	/** The working directory the push ran in. */
	cwd: Schema.String,
	/** The refspec that was rejected, when the caller passed one. */
	refspec: Schema.optionalKey(Schema.String),
}) {
	/** Renders the rejected push into a one-line message. */
	override get message(): string {
		return this.refspec !== undefined
			? `push of '${this.refspec}' rejected as non-fast-forward in ${this.cwd}`
			: `push rejected as non-fast-forward in ${this.cwd}`;
	}
}

/**
 * A merge-shaped operation (`pull`, `stash pop`, `stash apply`) stopped with
 * conflict markers in the working tree.
 *
 * @remarks
 * The typed signal a resolve-or-abort recovery branches on. The conflicted
 * state is REAL: git has already written conflict markers, and (for `pull`)
 * `MERGE_HEAD` is set — the caller owns resolving or aborting. Detection
 * matches git's conflict report, which lands on STDOUT for a merge and on
 * stderr for a rebase-mode pull; both streams are inspected.
 *
 * @public
 */
export class MergeConflictError extends Schema.TaggedError<MergeConflictError>()("MergeConflictError", {
	/** The working directory the merge ran in. */
	cwd: Schema.String,
}) {
	/** Renders the conflicted merge into a one-line message. */
	override get message(): string {
		return `merge conflict in ${this.cwd}: fix conflicts (or abort) before continuing`;
	}
}

/**
 * A merge-shaped operation refused to start because local modifications would
 * be overwritten — git's refusal reads
 * `Your local changes ... would be overwritten by merge`.
 *
 * @remarks
 * The typed "commit or stash first" signal. Unlike {@link MergeConflictError}
 * the working tree is UNTOUCHED — git aborted before changing anything.
 * Only the merge-shaped methods (`pull`, `stashPop`, `stashApply`) can fail
 * with this error.
 *
 * @public
 */
export class DirtyWorktreeError extends Schema.TaggedError<DirtyWorktreeError>()("DirtyWorktreeError", {
	/** The working directory whose local changes blocked the operation. */
	cwd: Schema.String,
}) {
	/** Renders the blocked operation into a one-line message. */
	override get message(): string {
		return `local changes would be overwritten in ${this.cwd}: commit or stash them first`;
	}
}

/**
 * One entry of a `git ls-tree` listing.
 *
 * @public
 */
export class LsTreeEntry extends Schema.Class<LsTreeEntry>("LsTreeEntry")({
	/** The entry's file mode, e.g. `100644`. */
	mode: Schema.String,
	/** The kind of object the entry points at. */
	type: Schema.Literals(["blob", "tree", "commit"]),
	/** The object id the entry points at. */
	oid: Schema.String,
	/** The entry's path, relative to the tree root. May contain spaces or newlines. */
	path: Schema.String,
}) {}

/**
 * One entry of a `git diff --name-status` listing.
 *
 * @remarks
 * The `status` vocabulary is this package's own decoded spelling:
 * `"typeChanged"` and `"broken"` — deliberately NOT git porcelain's
 * `"typechange"` word. A consumer mapping these values onto an existing
 * enum that follows porcelain's spelling must translate.
 *
 * @public
 */
export class NameStatusEntry extends Schema.Class<NameStatusEntry>("NameStatusEntry")({
	/**
	 * The change kind, decoded from git's one-letter status code. `T` decodes
	 * to `"typeChanged"` and `B` to `"broken"` — this package's spelling, not
	 * porcelain's `"typechange"`.
	 */
	status: Schema.Literals([
		"added",
		"modified",
		"deleted",
		"renamed",
		"copied",
		"typeChanged",
		"unmerged",
		"unknown",
		"broken",
	]),
	/** The entry's path — for a rename or copy, the NEW path. */
	path: Schema.String,
	/** The pre-rename/pre-copy path; present only for renamed/copied entries. */
	oldPath: Schema.optionalKey(Schema.String),
}) {}

/**
 * The outcome of classifying one completed run (or spawn failure) against
 * git's stderr taxonomy. Never leaked outside this module — every `Git`
 * method maps it to its own public return type.
 */
type Classified =
	| { readonly _tag: "success"; readonly output: string }
	| { readonly _tag: "absent" }
	| { readonly _tag: "refMissing" }
	| { readonly _tag: "notARepository" }
	| { readonly _tag: "unknownRef" }
	| { readonly _tag: "nonFastForward" }
	| { readonly _tag: "mergeConflict" }
	| { readonly _tag: "dirtyWorktree" }
	| { readonly _tag: "failure"; readonly error: GitCommandError };

/**
 * Which method-specific classification rows apply on top of the shared
 * taxonomy: `"show"` enables the absent-at-ref degrade, `"refExists"` enables
 * the exit-1-is-false degrade, `"quiet"` enables the silent-exit-1-is-absent
 * degrade, `"noSuchRemote"` enables the no-such-remote degrade, `"push"`
 * enables the rejected-non-fast-forward row, `"merge"` enables the
 * dirty-worktree and merge-conflict rows, `"generic"` enables none of them.
 */
type ClassifyKind = "show" | "refExists" | "quiet" | "noSuchRemote" | "push" | "merge" | "generic";

const NOT_A_REPOSITORY = "not a git repository";
// Unanchored substring matching against LC_ALL=C-pinned phrases: a path or ref
// name that happens to literally contain one of these phrases could misclassify.
// Accepted for now; anchoring is deliberately deferred until a real collision
// is observed.
const UNKNOWN_REF_PATTERNS = [
	"unknown revision",
	"bad revision",
	"Not a valid object name",
	"invalid object name",
	// fetch's missing-remote-ref shape — the typed signal a tag-then-branch
	// fetch fallback (Effect.orElse) branches on.
	"couldn't find remote ref",
];
const ABSENT_AT_REF_PATTERNS = ["does not exist in", "exists on disk, but not in"];
// Push-rejection shapes (probed against git 2.54 under LC_ALL=C): the remote
// moved (`fetch first`), the classic wording (`non-fast-forward`), and a
// --force-with-lease lease failure (`stale info`). All ride the `! [rejected]`
// line, which is required alongside one of these so an unrelated stderr
// mention cannot misclassify.
const PUSH_REJECTED_PATTERNS = ["non-fast-forward", "fetch first", "stale info"];
// Merge-conflict shapes: git's merge machinery reports `CONFLICT (` and
// `Automatic merge failed` on STDOUT (probed: pull and stash pop alike), while
// a rebase-mode pull reports `could not apply` on stderr — both streams are
// matched.
const MERGE_CONFLICT_PATTERNS = ["CONFLICT (", "Automatic merge failed", "could not apply"];
// The dirty-worktree refusal (`error: Your local changes to the following
// files would be overwritten by merge`) arrives on stderr, before git touches
// anything.
const DIRTY_WORKTREE_PATTERN = "would be overwritten by";

const matchesAny = (stderr: string, patterns: ReadonlyArray<string>): boolean =>
	patterns.some((pattern) => stderr.includes(pattern));

/**
 * Classifies one completed run (or spawn-level `PlatformError`) against
 * git's stderr taxonomy. Written once — every `Git` method funnels through
 * this before deciding its own return value.
 *
 * `args` is the invocation's REDACTED argv: it is the only argv this
 * function may persist into a `GitCommandError`, per the #86 redaction
 * policy.
 */
const classify = (
	cwd: string,
	args: ReadonlyArray<string>,
	outcome: Collected | PlatformError.PlatformError,
	kind: ClassifyKind,
): Classified => {
	if (outcome instanceof PlatformError.PlatformError) {
		// The non-NotFound arms keep the underlying diagnostic: flattening the
		// PlatformError to its reason tag alone drops module/method/cause detail
		// a caller debugging a PermissionDenied or TimedOut spawn genuinely needs.
		const detail =
			outcome.reason._tag === "NotFound"
				? "git is not installed (or the working directory does not exist)"
				: `spawn failed: ${outcome.reason._tag}: ${outcome.message}`;
		return { _tag: "failure", error: GitCommandError.make({ kind: "failed", args, cwd, stderr: "", detail }) };
	}
	const { stdout, stderr, exitCode } = outcome;
	if (exitCode === 0) {
		return { _tag: "success", output: stdout };
	}
	if (stderr.includes(NOT_A_REPOSITORY)) {
		return { _tag: "notARepository" };
	}
	if (matchesAny(stderr, UNKNOWN_REF_PATTERNS)) {
		return { _tag: "unknownRef" };
	}
	if (kind === "push" && stderr.includes("[rejected]") && matchesAny(stderr, PUSH_REJECTED_PATTERNS)) {
		return { _tag: "nonFastForward" };
	}
	if (kind === "merge") {
		// The dirty refusal is checked FIRST: it aborts before any merge starts,
		// so its stderr can never carry conflict text — but checking it first
		// keeps the ordering explicit rather than incidental.
		if (stderr.includes(DIRTY_WORKTREE_PATTERN)) {
			return { _tag: "dirtyWorktree" };
		}
		if (matchesAny(stdout, MERGE_CONFLICT_PATTERNS) || matchesAny(stderr, MERGE_CONFLICT_PATTERNS)) {
			return { _tag: "mergeConflict" };
		}
	}
	if (kind === "quiet" && exitCode === 1 && stderr === "") {
		// --quiet probes (symbolic-ref) and config --get signal "unset" as a
		// silent exit 1; any stderr text means a real failure instead.
		return { _tag: "absent" };
	}
	if (kind === "noSuchRemote" && stderr.includes("No such remote")) {
		return { _tag: "absent" };
	}
	if (kind === "show" && matchesAny(stderr, ABSENT_AT_REF_PATTERNS)) {
		return { _tag: "absent" };
	}
	if (kind === "refExists" && exitCode === 1) {
		return { _tag: "refMissing" };
	}
	return { _tag: "failure", error: GitCommandError.make({ kind: "failed", args, cwd, exitCode, stderr }) };
};

/**
 * Runs an invocation's command in `cwd`, classifies the outcome, and never
 * fails: a spawn-level `PlatformError` and a per-run timeout are both
 * absorbed into the `"failure"` classification rather than escaping the
 * effect's error channel.
 *
 * The argv handed to `classify` — and therefore persisted into any
 * `GitCommandError` — is the invocation's REDACTED argv, never the raw one:
 * the redaction mask the pure constructor carries is applied here, at the
 * single classification choke point (the #86 redaction policy).
 */
const runClassified = (
	invocation: GitInvocation,
	cwd: string,
	kind: ClassifyKind,
): Effect.Effect<Classified, never, ChildProcessSpawner.ChildProcessSpawner> => {
	const args = invocation.redactedArgs;
	const command = ChildProcess.setCwd(invocation.command, cwd);
	return runCollected(command).pipe(
		Effect.map((collected) => classify(cwd, args, collected, kind)),
		Effect.catch((platformError) => Effect.succeed(classify(cwd, args, platformError, kind))),
		Effect.timeoutOrElse({
			duration: GIT_TIMEOUT,
			orElse: () =>
				Effect.succeed<Classified>({
					_tag: "failure",
					error: GitCommandError.make({ kind: "failed", args, cwd, stderr: "", detail: "timed out after 30s" }),
				}),
		}),
	);
};

/** Splits `-z` (NUL-terminated) output into its constituent entries. */
const parseNulSeparated = (output: string): ReadonlyArray<string> =>
	output.split("\0").filter((entry) => entry.length > 0);

/**
 * Parses `git ls-tree -r -z` output: each NUL-terminated entry is
 * `<mode> <type> <oid>\t<path>`. `path` is everything after the first tab,
 * so a path containing spaces or newlines is preserved intact.
 */
const parseLsTree = (output: string): ReadonlyArray<LsTreeEntry> =>
	parseNulSeparated(output).map((entry) => {
		const tabIndex = entry.indexOf("\t");
		const header = entry.slice(0, tabIndex).split(" ");
		const path = entry.slice(tabIndex + 1);
		return LsTreeEntry.make({
			mode: header[0] ?? "",
			// git's own tree-entry format only ever emits these three kinds.
			type: (header[1] ?? "blob") as "blob" | "tree" | "commit",
			oid: header[2] ?? "",
			path,
		});
	});

/** git's one-letter name-status codes, score digits stripped (`R100` → `R`). */
const NAME_STATUS_CODES: Record<string, NameStatusEntry["status"] | undefined> = {
	A: "added",
	B: "broken",
	C: "copied",
	D: "deleted",
	M: "modified",
	R: "renamed",
	T: "typeChanged",
	U: "unmerged",
	X: "unknown",
};

/**
 * Parses `git diff --name-status -z` output. A plain entry is two NUL tokens
 * (`<code>`, `<path>`); a rename/copy entry is three (`<R|C><score>`,
 * `<oldPath>`, `<newPath>`), and only the code's first character carries the
 * status — the similarity score digits are dropped.
 */
const parseNameStatus = (output: string): ReadonlyArray<NameStatusEntry> => {
	const tokens = output.split("\0");
	const entries: Array<NameStatusEntry> = [];
	let index = 0;
	while (index < tokens.length) {
		const code = tokens[index] ?? "";
		if (code === "") {
			index += 1;
			continue;
		}
		const letter = code.charAt(0);
		const status = NAME_STATUS_CODES[letter] ?? "unknown";
		if (letter === "R" || letter === "C") {
			entries.push(NameStatusEntry.make({ status, path: tokens[index + 2] ?? "", oldPath: tokens[index + 1] ?? "" }));
			index += 3;
		} else {
			entries.push(NameStatusEntry.make({ status, path: tokens[index + 1] ?? "" }));
			index += 2;
		}
	}
	return entries;
};

/**
 * The metadata of a single commit, read via `git log -1` with NUL-separated
 * `%H` / `%G?` / `%B` placeholders.
 *
 * @public
 */
export class CommitInfo extends Schema.Class<CommitInfo>("CommitInfo")({
	/** The commit's full object id (`%H`). */
	sha: Schema.String,
	/** git's `%G?` signature verdict: Good, Bad, Unknown validity, eXpired, expired-key (Y), Revoked, cannot-check (E), None. */
	signatureStatus: Schema.Literals(["G", "B", "U", "X", "Y", "R", "E", "N"]),
	/** The raw commit message (`%B`), untrimmed — includes git's trailing format newline. */
	message: Schema.String,
}) {}

/** One two-letter porcelain v1 status axis code. */
const porcelainCode = Schema.Literals([" ", "M", "T", "A", "D", "R", "C", "U", "?", "!"]);

/**
 * Options for {@link StatusEntry.toLine} / {@link StatusEntry.format}: how a
 * rename/copy entry's path field renders.
 *
 * @public
 */
export interface StatusRenderOptions {
	/**
	 * `"new"` (the default) renders only the NEW path — the entry's current
	 * path, the one that exists on disk. `"arrow"` renders git's own non-`-z`
	 * porcelain form, `<origPath> -> <path>`. Non-rename entries are
	 * unaffected either way.
	 */
	readonly renames?: "new" | "arrow";
}

/**
 * One entry of a `git status --porcelain -z` listing.
 *
 * @public
 */
export class StatusEntry extends Schema.Class<StatusEntry>("StatusEntry")({
	/** The index-side status code (first porcelain column). */
	x: porcelainCode,
	/** The working-tree-side status code (second porcelain column). */
	y: porcelainCode,
	/** The entry's path — for a rename or copy, the NEW path. */
	path: Schema.String,
	/** The original path; present only on rename/copy entries. */
	origPath: Schema.optionalKey(Schema.String),
}) {
	/**
	 * Renders this entry back to one porcelain-shaped line: `XY <path>`.
	 *
	 * @remarks
	 * **The rename convention is decided here, once, for every consumer.** By
	 * default a rename/copy entry renders its NEW path only — `path` IS the
	 * entry's current path, the one a line-oriented downstream can actually
	 * open — which is a deliberate divergence from git's own non-`-z`
	 * rendering (`orig -> new`). The arrow form is ambiguous to naive
	 * line/whitespace splitters (paths may contain spaces, or a literal
	 * `" -> "`), so it is opt-in via `renames: "arrow"` for consumers that
	 * want git parity.
	 *
	 * A second recorded divergence: git's non-`-z` porcelain C-quotes paths
	 * containing special characters; this renderer emits paths raw. It exists
	 * for whitespace-insensitive text consumers — a machine parser should
	 * consume the decoded {@link StatusEntry} values (or `-z` output)
	 * directly, never re-parse this rendering.
	 */
	toLine(options?: StatusRenderOptions): string {
		const rendered =
			options?.renames === "arrow" && this.origPath !== undefined ? `${this.origPath} -> ${this.path}` : this.path;
		return `${this.x}${this.y} ${rendered}`;
	}

	/**
	 * Renders entries back to porcelain-shaped text: one {@link StatusEntry.toLine}
	 * line per entry, newline-joined, no trailing newline.
	 *
	 * @remarks
	 * The route back from `Git.status`'s parsed entries to line-oriented text,
	 * so a consumer whose downstream contract is porcelain-shaped text does
	 * not hand-roll its own renderer (and re-decide the rename convention —
	 * see {@link StatusEntry.toLine} for that decision). An empty array
	 * renders as the empty string.
	 */
	static readonly format = (entries: ReadonlyArray<StatusEntry>, options?: StatusRenderOptions): string =>
		entries.map((entry) => entry.toLine(options)).join("\n");
}

/**
 * Parses `git log -1 --format=%H%x00%G?%x00%B` output: exactly two NUL
 * separators, everything after the second is the raw message, untrimmed.
 * Only ever called on the successful output of this package's own format
 * string, so the separators are guaranteed present.
 */
const parseCommitInfo = (output: string): CommitInfo => {
	const first = output.indexOf("\0");
	const second = output.indexOf("\0", first + 1);
	return CommitInfo.make({
		sha: output.slice(0, first),
		// Our own format string only ever emits git's %G? verdict letters.
		signatureStatus: output.slice(first + 1, second) as CommitInfo["signatureStatus"],
		message: output.slice(second + 1),
	});
};

/**
 * Parses `git status --porcelain -z` output: each entry is `XY <path>`, and a
 * rename/copy entry appends the ORIGINAL path as one extra NUL token AFTER
 * the new path — the opposite order from `diff --name-status`.
 */
const parseStatus = (output: string): ReadonlyArray<StatusEntry> => {
	const tokens = output.split("\0");
	const entries: Array<StatusEntry> = [];
	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index] ?? "";
		if (token === "") {
			index += 1;
			continue;
		}
		// Porcelain v1 only ever emits these axis codes.
		const x = token.charAt(0) as StatusEntry["x"];
		const y = token.charAt(1) as StatusEntry["y"];
		const path = token.slice(3);
		if (x === "R" || x === "C" || y === "R" || y === "C") {
			entries.push(StatusEntry.make({ x, y, path, origPath: tokens[index + 1] ?? "" }));
			index += 2;
		} else {
			entries.push(StatusEntry.make({ x, y, path }));
			index += 1;
		}
	}
	return entries;
};

/**
 * One line of a `git submodule status` listing.
 *
 * @remarks
 * The `state` decodes git's one-character prefix: `" "` → `"current"` (the
 * checked-out commit matches the index gitlink), `"-"` → `"uninitialized"`,
 * `"+"` → `"outOfSync"` (the checked-out commit differs from the gitlink),
 * `"U"` → `"conflict"` (merge conflicts). `describe` carries the
 * parenthesized `git describe` suffix git appends for initialized
 * submodules.
 *
 * @public
 */
export class SubmoduleStatusEntry extends Schema.Class<SubmoduleStatusEntry>("SubmoduleStatusEntry")({
	/** The decoded state prefix. */
	state: Schema.Literals(["current", "uninitialized", "outOfSync", "conflict"]),
	/** The submodule's checked-out (or, uninitialized, gitlink) commit sha. */
	sha: Schema.String,
	/** The submodule's path relative to the superproject root. */
	path: Schema.String,
	/** The `git describe` suffix, present only for initialized submodules. */
	describe: Schema.optionalKey(Schema.String),
}) {}

/**
 * Parses `git submodule status` output. Line-based — the one parser in this
 * package without a `-z` mode to lean on, because git does not offer one for
 * `submodule status`; a submodule path containing a newline (or a literal
 * ` (` suffix mimicking the describe parenthesis) would corrupt the parse.
 * Accepted as a git-imposed limitation.
 */
const parseSubmoduleStatus = (output: string): ReadonlyArray<SubmoduleStatusEntry> => {
	const entries: Array<SubmoduleStatusEntry> = [];
	for (const line of output.split("\n")) {
		const trimmedEnd = line.endsWith("\r") ? line.slice(0, -1) : line;
		if (trimmedEnd === "") continue;
		const prefix = trimmedEnd.charAt(0);
		const state =
			prefix === "-" ? "uninitialized" : prefix === "+" ? "outOfSync" : prefix === "U" ? "conflict" : "current";
		const rest =
			prefix === " " || prefix === "-" || prefix === "+" || prefix === "U" ? trimmedEnd.slice(1) : trimmedEnd;
		const shaEnd = rest.indexOf(" ");
		const sha = shaEnd === -1 ? rest : rest.slice(0, shaEnd);
		const remainder = shaEnd === -1 ? "" : rest.slice(shaEnd + 1);
		const describeStart = remainder.endsWith(")") ? remainder.lastIndexOf(" (") : -1;
		if (describeStart === -1) {
			entries.push(SubmoduleStatusEntry.make({ state, sha, path: remainder }));
		} else {
			entries.push(
				SubmoduleStatusEntry.make({
					state,
					sha,
					path: remainder.slice(0, describeStart),
					describe: remainder.slice(describeStart + 2, -1),
				}),
			);
		}
	}
	return entries;
};

/**
 * One ref a remote advertises, from `git ls-remote`.
 *
 * @remarks
 * `ref` is the FULL refname as advertised (`refs/heads/main`,
 * `refs/tags/v1`), including the `^{}` suffix on an annotated tag's peeled
 * entry — an annotated tag appears twice, once as the tag object and once
 * peeled to its commit.
 *
 * @public
 */
export class LsRemoteEntry extends Schema.Class<LsRemoteEntry>("LsRemoteEntry")({
	/** The sha the advertised ref points at. */
	sha: Schema.String,
	/** The full advertised refname, `^{}` peel suffix included. */
	ref: Schema.String,
}) {
	/**
	 * The human-facing short name of an advertised refname: the
	 * `refs/heads/` / `refs/tags/` / `refs/remotes/` prefix and any `^{}`
	 * peel suffix stripped (`refs/tags/v1^{}` → `v1`).
	 */
	static readonly shortName = (ref: string): string => {
		const base = ref.endsWith("^{}") ? ref.slice(0, -3) : ref;
		for (const prefix of ["refs/heads/", "refs/tags/", "refs/remotes/"]) {
			if (base.startsWith(prefix)) {
				return base.slice(prefix.length);
			}
		}
		return base;
	};

	/**
	 * The entries whose short name is a NEAR MISS for `ref`: not an exact
	 * match, but ending in `ref` right behind a separator (`@`, `/`, `-`,
	 * `_`) — the monorepo-prefixed-tag case, where a caller asks for
	 * `4.0.0-beta.101` and the remote advertises `effect@4.0.0-beta.101`.
	 *
	 * @remarks
	 * A pure, decode-side helper for validate-before-mutate flows: run
	 * `lsRemote`, look for the wanted ref, and when it is absent hand the
	 * listing to this to compute a suggestion. Deliberately a helper on the
	 * ENTRY value rather than behavior baked into the service — the service
	 * returns the full listing and the caller owns the matching policy. An
	 * annotated tag's peeled `^{}` entry shares its base short name, so a
	 * near miss on such a tag can surface both of its entries.
	 */
	static readonly nearMatches = (entries: ReadonlyArray<LsRemoteEntry>, ref: string): ReadonlyArray<LsRemoteEntry> => {
		const separators = ["@", "/", "-", "_"];
		return entries.filter((entry) => {
			const short = LsRemoteEntry.shortName(entry.ref);
			if (short === ref || !short.endsWith(ref)) {
				return false;
			}
			return separators.includes(short.charAt(short.length - ref.length - 1));
		});
	};
}

/**
 * Parses `git ls-remote` output: one `<sha>\t<refname>` line per advertised
 * ref. Line-based deliberately — refnames cannot contain a newline (or a
 * tab), so the split is safe without a `-z` mode (which `ls-remote` does not
 * offer).
 */
const parseLsRemote = (output: string): ReadonlyArray<LsRemoteEntry> =>
	output
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => {
			const tabIndex = line.indexOf("\t");
			return LsRemoteEntry.make({ sha: line.slice(0, tabIndex), ref: line.slice(tabIndex + 1) });
		});

/**
 * One stash entry, from `git stash list`.
 *
 * @public
 */
export class StashEntry extends Schema.Class<StashEntry>("StashEntry")({
	/** The reflog selector (`stash@{0}`) — the index other stash methods take. */
	ref: Schema.String,
	/** The stash commit's sha. */
	sha: Schema.String,
	/** The reflog subject: `WIP on <branch>: ...` or `On <branch>: <message>`. */
	message: Schema.String,
}) {}

/**
 * Parses `git stash list -z --format=%gd%x1f%H%x1f%gs` output: NUL-terminated
 * records of unit-separated (`\x1f`) fields. Reflog subjects are single-line
 * and cannot contain either separator byte.
 */
const parseStashList = (output: string): ReadonlyArray<StashEntry> =>
	parseNulSeparated(output).map((record) => {
		const [ref = "", sha = "", ...rest] = record.split("\u001f");
		return StashEntry.make({ ref, sha, message: rest.join("\u001f") });
	});

/**
 * One local (or remote-tracking) branch, from `git branch --list`.
 *
 * @public
 */
export class BranchEntry extends Schema.Class<BranchEntry>("BranchEntry")({
	/** The short branch name (`main`, or `origin/main` for a remote branch). */
	name: Schema.String,
	/** The branch tip's sha. */
	sha: Schema.String,
	/** Whether this branch is checked out in the current working tree. */
	current: Schema.Boolean,
}) {}

/**
 * Parses `git branch --list --format=%(HEAD)%00%(refname:short)%00%(objectname)`
 * output: newline-separated records (refnames cannot contain newlines) of
 * NUL-separated fields. The `%(HEAD)` marker is `*` for the checked-out
 * branch; anything else (` `, or `+` for a branch checked out in a linked
 * worktree) is not-current.
 */
const parseBranchList = (output: string): ReadonlyArray<BranchEntry> =>
	output
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => {
			const [marker = "", name = "", sha = ""] = line.split("\0");
			return BranchEntry.make({ name, sha, current: marker === "*" });
		});

/**
 * One ref, from `git for-each-ref`.
 *
 * @public
 */
export class RefEntry extends Schema.Class<RefEntry>("RefEntry")({
	/** The full refname (`refs/tags/v1`). */
	ref: Schema.String,
	/** The sha of the object the ref points at. */
	sha: Schema.String,
	/**
	 * The pointed-at object's type. An annotated tag is `tag` (the tag
	 * object itself, not its target commit).
	 */
	objectType: Schema.Literals(["commit", "tag", "tree", "blob"]),
}) {}

/**
 * Parses `git for-each-ref --format=%(refname)%00%(objectname)%00%(objecttype)`
 * output: newline-separated records (refnames cannot contain newlines) of
 * NUL-separated fields.
 */
const parseForEachRef = (output: string): ReadonlyArray<RefEntry> =>
	output
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => {
			const [ref = "", sha = "", objectType = "commit"] = line.split("\0");
			// Our own fixed format only ever emits git's four object types.
			return RefEntry.make({ ref, sha, objectType: objectType as RefEntry["objectType"] });
		});

/**
 * One configuration entry, from `git config --list`.
 *
 * @public
 */
export class ConfigListEntry extends Schema.Class<ConfigListEntry>("ConfigListEntry")({
	/** The canonical dotted key (`section.subsection.key`). */
	key: Schema.String,
	/**
	 * The raw value. A valueless key (git's boolean-true shorthand,
	 * `[section]` + bare `key`) surfaces as the empty string — distinguish it
	 * with `configGetAll` if the difference matters.
	 */
	value: Schema.String,
}) {}

/**
 * Parses `git config --list -z` output: NUL-terminated records, key separated
 * from value by the FIRST newline (a config value may itself contain
 * newlines — the reason `-z` is load-bearing). A record with no newline is a
 * valueless boolean-shorthand key.
 */
const parseConfigList = (output: string): ReadonlyArray<ConfigListEntry> =>
	parseNulSeparated(output).map((record) => {
		const newlineIndex = record.indexOf("\n");
		return newlineIndex === -1
			? ConfigListEntry.make({ key: record, value: "" })
			: ConfigListEntry.make({ key: record.slice(0, newlineIndex), value: record.slice(newlineIndex + 1) });
	});

/**
 * One working tree, from `git worktree list --porcelain`.
 *
 * @public
 */
export class WorktreeEntry extends Schema.Class<WorktreeEntry>("WorktreeEntry")({
	/** The working tree's absolute path. */
	path: Schema.String,
	/** The checked-out commit sha; absent for a bare repository entry. */
	head: Schema.optionalKey(Schema.String),
	/** The checked-out branch's full refname; absent when detached or bare. */
	branch: Schema.optionalKey(Schema.String),
	/** Whether the working tree is in detached-HEAD state. */
	detached: Schema.Boolean,
	/** Whether the entry is the bare repository itself. */
	bare: Schema.Boolean,
	/** Present when the worktree is locked; holds the lock reason (possibly empty). */
	locked: Schema.optionalKey(Schema.String),
	/** Present when the worktree is prunable; holds the reason (possibly empty). */
	prunable: Schema.optionalKey(Schema.String),
}) {}

/**
 * Parses `git worktree list --porcelain -z` output: NUL-terminated attribute
 * lines, one blank attribute terminating each entry. Attribute vocabulary:
 * `worktree <path>`, `HEAD <sha>`, `branch <ref>`, and the flag/annotation
 * attributes `detached`, `bare`, `locked [<reason>]`, `prunable [<reason>]`.
 */
const parseWorktreeList = (output: string): ReadonlyArray<WorktreeEntry> => {
	const entries: Array<WorktreeEntry> = [];
	let path: string | undefined;
	let head: string | undefined;
	let branch: string | undefined;
	let detached = false;
	let bare = false;
	let locked: string | undefined;
	let prunable: string | undefined;
	const flush = (): void => {
		if (path !== undefined) {
			entries.push(
				WorktreeEntry.make({
					path,
					detached,
					bare,
					...(head !== undefined ? { head } : {}),
					...(branch !== undefined ? { branch } : {}),
					...(locked !== undefined ? { locked } : {}),
					...(prunable !== undefined ? { prunable } : {}),
				}),
			);
		}
		path = undefined;
		head = undefined;
		branch = undefined;
		detached = false;
		bare = false;
		locked = undefined;
		prunable = undefined;
	};
	for (const attribute of output.split("\0")) {
		if (attribute === "") {
			flush();
		} else if (attribute.startsWith("worktree ")) {
			path = attribute.slice("worktree ".length);
		} else if (attribute.startsWith("HEAD ")) {
			head = attribute.slice("HEAD ".length);
		} else if (attribute.startsWith("branch ")) {
			branch = attribute.slice("branch ".length);
		} else if (attribute === "detached") {
			detached = true;
		} else if (attribute === "bare") {
			bare = true;
		} else if (attribute === "locked" || attribute.startsWith("locked ")) {
			locked = attribute === "locked" ? "" : attribute.slice("locked ".length);
		} else if (attribute === "prunable" || attribute.startsWith("prunable ")) {
			prunable = attribute === "prunable" ? "" : attribute.slice("prunable ".length);
		}
	}
	flush();
	return entries;
};

/**
 * One index (staging area) entry, from `git ls-files --stage`.
 *
 * @remarks
 * The index-side sibling of {@link LsTreeEntry}: this is the ONLY place a
 * staged-but-uncommitted gitlink (`mode` `160000`) is visible — `lsTree`
 * reads the committed tree and misses exactly that window.
 *
 * @public
 */
export class LsFilesEntry extends Schema.Class<LsFilesEntry>("LsFilesEntry")({
	/** The entry's file mode, e.g. `100644` — `160000` for a gitlink. */
	mode: Schema.String,
	/** The staged object id. */
	oid: Schema.String,
	/** The merge stage: `0` normally; `1`/`2`/`3` during an unresolved merge. */
	stage: Schema.Number,
	/** The entry's path, relative to `cwd`. May contain spaces or newlines. */
	path: Schema.String,
}) {}

/**
 * Parses `git ls-files --stage -z` output: each NUL-terminated entry is
 * `<mode> <oid> <stage>\t<path>`. `path` is everything after the first tab,
 * so a path containing spaces or newlines is preserved intact — the same
 * split rule as `parseLsTree`.
 */
const parseLsFiles = (output: string): ReadonlyArray<LsFilesEntry> =>
	parseNulSeparated(output).map((entry) => {
		const tabIndex = entry.indexOf("\t");
		const header = entry.slice(0, tabIndex).split(" ");
		return LsFilesEntry.make({
			mode: header[0] ?? "",
			oid: header[1] ?? "",
			stage: Number(header[2] ?? "0"),
			path: entry.slice(tabIndex + 1),
		});
	});

/**
 * Refuse a caller-supplied ref or range that git would parse as an option.
 *
 * Refs are caller-controlled and land in git's argv as positional entries; a
 * value beginning with `-` is read as a flag instead — `checkout("-b")` would
 * CREATE a branch. A bare `--` separator is not a safe fix for every command
 * (it switches `checkout` into pathspec mode), so option-like values are
 * refused outright, before any spawn, as a typed {@link GitCommandError}.
 * `show`'s `path` needs no guard: it is fused after the ref into one
 * `ref:path` token, which cannot begin with `-` unless the ref does.
 *
 * `sensitive` values get the same check but a REDACTED report: a refused
 * sensitive positional (a `configSet` value) must not leak into
 * `GitCommandError.args`/`detail` any more than a spawned one may — the #86
 * redaction policy applies to guard rejections too.
 */
const rejectOptionLikeRefs = (
	cwd: string,
	refs: ReadonlyArray<string>,
	sensitive: ReadonlyArray<string> = [],
): Effect.Effect<void, GitCommandError> => {
	const offending = refs.find((ref) => ref.startsWith("-"));
	if (offending !== undefined) {
		return Effect.fail(
			new GitCommandError({
				kind: "refused",
				args: [offending],
				cwd,
				stderr: "",
				detail: `refused a ref argument git would parse as an option: ${JSON.stringify(offending)}`,
			}),
		);
	}
	const offendingSensitive = sensitive.find((value) => value.startsWith("-"));
	return offendingSensitive === undefined
		? Effect.void
		: Effect.fail(
				new GitCommandError({
					kind: "refused",
					args: ["<redacted>"],
					cwd,
					stderr: "",
					detail: "refused a sensitive argument git would parse as an option (value redacted)",
				}),
			);
};

/**
 * Refuse a caller-supplied numeric index/limit that is not a non-negative
 * integer.
 *
 * Every relational comparison against `NaN` is `false`, so a bare
 * `value < 0` guard admits `NaN` (and a fractional value truncates nothing —
 * it rides straight into the argv as `stash@{1.5}` / `--max-count=NaN`).
 * Integrality and range are therefore checked together, pre-spawn, as a
 * typed refusal.
 */
const rejectNonNaturalNumber = (
	cwd: string,
	label: string,
	value: number | undefined,
): Effect.Effect<void, GitCommandError> =>
	value === undefined || (Number.isInteger(value) && value >= 0)
		? Effect.void
		: Effect.fail(
				new GitCommandError({
					kind: "refused",
					args: [String(value)],
					cwd,
					stderr: "",
					detail: `refused ${label}: expected a non-negative integer, received ${value}`,
				}),
			);

/** Builds the `Git.Service` shape over an already-resolved `ChildProcessSpawner`. */
const make = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) => {
	const runFor = (invocation: GitInvocation, cwd: string, kind: ClassifyKind) =>
		runClassified(invocation, cwd, kind).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

	const show = Effect.fn("Git.show")(function* (cwd: string, ref: string, path: string) {
		yield* Effect.annotateCurrentSpan({ cwd, ref, path });
		yield* rejectOptionLikeRefs(cwd, [ref]);
		const classified = yield* runFor(GitCommand.show(ref, path), cwd, "show");
		switch (classified._tag) {
			case "success":
				return Option.some(classified.output);
			case "absent":
				return Option.none();
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.show: unexpected classification "${classified._tag}"`);
		}
	});

	const lsTree = Effect.fn("Git.lsTree")(function* (
		cwd: string,
		ref: string,
		options?: { readonly pathspec?: ReadonlyArray<string> },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, ref });
		yield* rejectOptionLikeRefs(cwd, [ref]);
		const classified = yield* runFor(GitCommand.lsTree(ref, options?.pathspec ?? []), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return parseLsTree(classified.output);
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.lsTree: unexpected classification "${classified._tag}"`);
		}
	});

	const refExists = Effect.fn("Git.refExists")(function* (cwd: string, ref: string) {
		yield* Effect.annotateCurrentSpan({ cwd, ref });
		yield* rejectOptionLikeRefs(cwd, [ref]);
		const classified = yield* runFor(GitCommand.refExists(ref), cwd, "refExists");
		switch (classified._tag) {
			case "success":
				return true;
			case "refMissing":
				return false;
			case "unknownRef":
				// A ref that doesn't resolve IS the negative answer this method
				// promises — never an error, and never a defect.
				return false;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.refExists: unexpected classification "${classified._tag}"`);
		}
	});

	const mergeBase = Effect.fn("Git.mergeBase")(function* (cwd: string, a: string, b: string) {
		yield* Effect.annotateCurrentSpan({ cwd, a, b });
		yield* rejectOptionLikeRefs(cwd, [a, b]);
		// "quiet" kind: no common ancestor is a SILENT exit 1 (probed against
		// git 2.54) — the legitimate "these histories are disjoint" answer,
		// degraded to Option.none. An unknown ref still exits 128 with a
		// `Not a valid object name` stderr and stays UnknownRefError.
		const classified = yield* runFor(GitCommand.mergeBase(a, b), cwd, "quiet");
		switch (classified._tag) {
			case "success":
				return Option.some(classified.output.trim());
			case "absent":
				return Option.none();
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: `${a}...${b}`, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.mergeBase: unexpected classification "${classified._tag}"`);
		}
	});

	const changedFiles = Effect.fn("Git.changedFiles")(function* (
		cwd: string,
		options: { readonly base: string; readonly head: string; readonly relative?: boolean },
	) {
		const relative = options.relative ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, base: options.base, head: options.head, relative });
		yield* rejectOptionLikeRefs(cwd, [options.base, options.head]);
		const classified = yield* runFor(GitCommand.changedFiles(options.base, options.head, relative), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return parseNulSeparated(classified.output);
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: `${options.base}...${options.head}`, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.changedFiles: unexpected classification "${classified._tag}"`);
		}
	});

	// Runs a NUL-separated, ref-free path listing (the working-tree queries) and
	// classifies through the shared path. No ref is involved, so `unknownRef`
	// cannot arise in practice — it is handled defensively to keep the switch
	// exhaustive and the error channel uniform with the ref-taking methods.
	const collectPaths = (method: string, invocation: GitInvocation, cwd: string) =>
		Effect.gen(function* () {
			const classified = yield* runFor(invocation, cwd, "generic");
			switch (classified._tag) {
				case "success":
					return parseNulSeparated(classified.output);
				case "notARepository":
					return yield* Effect.fail(new NotARepositoryError({ cwd }));
				case "unknownRef":
					return yield* Effect.fail(new UnknownRefError({ ref: "working tree", cwd }));
				case "failure":
					return yield* Effect.fail(classified.error);
				default:
					return yield* Effect.die(`${method}: unexpected classification "${classified._tag}"`);
			}
		});

	const unstagedChanges = Effect.fn("Git.unstagedChanges")(function* (
		cwd: string,
		options?: { readonly relative?: boolean },
	) {
		const relative = options?.relative ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, relative });
		return yield* collectPaths("Git.unstagedChanges", GitCommand.unstagedChanges(relative), cwd);
	});

	const stagedChanges = Effect.fn("Git.stagedChanges")(function* (
		cwd: string,
		options?: { readonly relative?: boolean },
	) {
		const relative = options?.relative ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, relative });
		return yield* collectPaths("Git.stagedChanges", GitCommand.stagedChanges(relative), cwd);
	});

	const untrackedFiles = Effect.fn("Git.untrackedFiles")(function* (
		cwd: string,
		options?: { readonly relative?: boolean },
	) {
		const relative = options?.relative ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, relative });
		return yield* collectPaths("Git.untrackedFiles", GitCommand.untrackedFiles(relative), cwd);
	});

	const workingChanges = Effect.fn("Git.workingChanges")(function* (
		cwd: string,
		options?: { readonly relative?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, relative: options?.relative ?? false });
		const unstaged = yield* unstagedChanges(cwd, options);
		const staged = yield* stagedChanges(cwd, options);
		const untracked = yield* untrackedFiles(cwd, options);
		return [...new Set([...unstaged, ...staged, ...untracked])];
	});

	const nameStatus = Effect.fn("Git.nameStatus")(function* (
		cwd: string,
		options: { readonly base: string; readonly head?: string; readonly relative?: boolean },
	) {
		const relative = options.relative ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, base: options.base, head: options.head ?? "(working tree)", relative });
		yield* rejectOptionLikeRefs(cwd, options.head === undefined ? [options.base] : [options.base, options.head]);
		const classified = yield* runFor(GitCommand.nameStatus(options.base, options.head, relative), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return parseNameStatus(classified.output);
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(
					new UnknownRefError({
						ref: options.head === undefined ? options.base : `${options.base}...${options.head}`,
						cwd,
					}),
				);
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.nameStatus: unexpected classification "${classified._tag}"`);
		}
	});

	const revParse = Effect.fn("Git.revParse")(function* (cwd: string, ref: string) {
		yield* Effect.annotateCurrentSpan({ cwd, ref });
		yield* rejectOptionLikeRefs(cwd, [ref]);
		const classified = yield* runFor(GitCommand.revParse(ref), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return classified.output.trim();
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.revParse: unexpected classification "${classified._tag}"`);
		}
	});

	const checkout = Effect.fn("Git.checkout")(function* (
		cwd: string,
		ref: string,
		options?: { readonly detach?: boolean },
	) {
		const detach = options?.detach ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, ref, detach });
		yield* rejectOptionLikeRefs(cwd, [ref]);
		const classified = yield* runFor(GitCommand.checkout(ref, detach), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.checkout: unexpected classification "${classified._tag}"`);
		}
	});

	const reset = Effect.fn("Git.reset")(function* (
		cwd: string,
		options?: { readonly mode?: "soft" | "mixed" | "hard"; readonly ref?: string },
	) {
		const mode = options?.mode ?? "mixed";
		yield* Effect.annotateCurrentSpan({ cwd, mode, ref: options?.ref ?? "HEAD" });
		if (options?.ref !== undefined) {
			yield* rejectOptionLikeRefs(cwd, [options.ref]);
		}
		const classified = yield* runFor(GitCommand.reset(mode, options?.ref), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: options?.ref ?? "HEAD", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.reset: unexpected classification "${classified._tag}"`);
		}
	});

	const clean = Effect.fn("Git.clean")(function* (
		cwd: string,
		options?: { readonly directories?: boolean; readonly ignored?: boolean; readonly paths?: ReadonlyArray<string> },
	) {
		const directories = options?.directories ?? false;
		const ignored = options?.ignored ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, directories, ignored });
		const classified = yield* runFor(GitCommand.clean(directories, ignored, options?.paths ?? []), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "working tree", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.clean: unexpected classification "${classified._tag}"`);
		}
	});

	const restore = Effect.fn("Git.restore")(function* (
		cwd: string,
		paths: ReadonlyArray<string>,
		options?: { readonly source?: string; readonly staged?: boolean; readonly worktree?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, count: paths.length, source: options?.source ?? "(index)" });
		if (options?.source !== undefined) {
			yield* rejectOptionLikeRefs(cwd, [options.source]);
		}
		const classified = yield* runFor(
			GitCommand.restore(paths, options?.source, options?.staged ?? false, options?.worktree ?? false),
			cwd,
			"generic",
		);
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: options?.source ?? "working tree", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.restore: unexpected classification "${classified._tag}"`);
		}
	});

	const branchCreate = Effect.fn("Git.branchCreate")(function* (
		cwd: string,
		name: string,
		options?: { readonly startPoint?: string; readonly checkout?: boolean; readonly force?: boolean },
	) {
		const checkoutBranch = options?.checkout ?? false;
		const force = options?.force ?? false;
		yield* Effect.annotateCurrentSpan({
			cwd,
			name,
			startPoint: options?.startPoint ?? "HEAD",
			checkout: checkoutBranch,
			force,
		});
		yield* rejectOptionLikeRefs(cwd, [name, ...(options?.startPoint !== undefined ? [options.startPoint] : [])]);
		const classified = yield* runFor(
			GitCommand.branchCreate(name, options?.startPoint, checkoutBranch, force),
			cwd,
			"generic",
		);
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: options?.startPoint ?? name, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.branchCreate: unexpected classification "${classified._tag}"`);
		}
	});

	const branchDelete = Effect.fn("Git.branchDelete")(function* (
		cwd: string,
		name: string,
		options?: { readonly force?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, name, force: options?.force ?? false });
		yield* rejectOptionLikeRefs(cwd, [name]);
		const classified = yield* runFor(GitCommand.branchDelete(name, options?.force ?? false), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: name, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.branchDelete: unexpected classification "${classified._tag}"`);
		}
	});

	const isShallow = Effect.fn("Git.isShallow")(function* (cwd: string) {
		yield* Effect.annotateCurrentSpan({ cwd });
		const classified = yield* runFor(GitCommand.isShallow(), cwd, "generic");
		switch (classified._tag) {
			case "success":
				// rev-parse --is-shallow-repository prints exactly "true" or "false".
				return classified.output.trim() === "true";
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "HEAD", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.isShallow: unexpected classification "${classified._tag}"`);
		}
	});

	const fetchUnshallow = Effect.fn("Git.fetchUnshallow")(function* (
		cwd: string,
		options?: { readonly remote?: string },
	) {
		const remote = options?.remote ?? "origin";
		yield* Effect.annotateCurrentSpan({ cwd });
		yield* rejectOptionLikeRefs(cwd, [remote]);
		const classified = yield* runFor(GitCommand.fetchUnshallow(remote), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "--unshallow", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.fetchUnshallow: unexpected classification "${classified._tag}"`);
		}
	});

	const fetch = Effect.fn("Git.fetch")(function* (
		cwd: string,
		options: {
			readonly ref: string;
			readonly remote?: string;
			readonly depth?: number;
			readonly tag?: boolean;
			readonly unshallow?: boolean;
		},
	) {
		const remote = options.remote ?? "origin";
		const tag = options.tag ?? false;
		const unshallow = options.unshallow ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, ref: options.ref, tag, unshallow });
		yield* rejectOptionLikeRefs(cwd, [remote, options.ref]);
		yield* rejectNonNaturalNumber(cwd, "a fetch depth", options.depth);
		if (unshallow && options.depth !== undefined) {
			// git itself rejects the pair (`--depth and --unshallow cannot be used
			// together`, exit 128) — refused typed pre-spawn, the submoduleDeinit
			// constraint-refusal precedent.
			return yield* Effect.fail(
				new GitCommandError({
					kind: "refused",
					args: ["--unshallow", "--depth", String(options.depth)],
					cwd,
					stderr: "",
					detail: "refused: fetch cannot combine unshallow with depth (git rejects the pair)",
				}),
			);
		}
		const classified = yield* runFor(
			GitCommand.fetch(remote, options.ref, options.depth, tag, unshallow),
			cwd,
			"generic",
		);
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: options.ref, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.fetch: unexpected classification "${classified._tag}"`);
		}
	});

	const fetchAny = Effect.fn("Git.fetchAny")(function* (
		cwd: string,
		options: { readonly ref: string; readonly remote?: string; readonly depth?: number },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, ref: options.ref });
		return yield* fetch(cwd, { ...options, tag: true }).pipe(
			// UnknownRefError is the typed "not a tag on the remote" signal; a
			// GitCommandError keeps unclassified tag-form stderr shapes on the
			// fallback path too. NotARepositoryError deliberately propagates —
			// the plain form would fail identically, so the retry is pure waste.
			// A refused GitCommandError (kind "refused") is a pre-spawn guard
			// rejection — an option-like remote or ref — that the plain form's own
			// guard would reproduce identically: it short-circuits here rather than
			// routing through a phantom fallback and re-rejecting. Routing on `kind`
			// is why fetchAny no longer duplicates the guard up front.
			Effect.catchTag(["UnknownRefError", "GitCommandError"], (error) =>
				error._tag === "GitCommandError" && error.kind === "refused" ? Effect.fail(error) : fetch(cwd, options),
			),
		);
	});

	const submoduleUpdate = Effect.fn("Git.submoduleUpdate")(function* (
		cwd: string,
		options?: {
			readonly init?: boolean;
			readonly depth?: number;
			readonly paths?: ReadonlyArray<string>;
			readonly checkout?: boolean;
			readonly remote?: boolean;
			readonly fetch?: false;
			readonly recursive?: boolean;
			readonly force?: boolean;
		},
	) {
		const init = options?.init ?? false;
		const checkout = options?.checkout ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, init, checkout });
		yield* rejectNonNaturalNumber(cwd, "a submodule update depth", options?.depth);
		const classified = yield* runFor(
			GitCommand.submoduleUpdate(init, options?.depth, options?.paths ?? [], {
				checkout,
				remote: options?.remote ?? false,
				recursive: options?.recursive ?? false,
				force: options?.force ?? false,
				// exactOptionalPropertyTypes: `fetch` only exists when the caller
				// asked for --no-fetch; an explicit undefined is not assignable.
				...(options?.fetch === false ? { fetch: false as const } : {}),
			}),
			cwd,
			"generic",
		);
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "submodule update", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.submoduleUpdate: unexpected classification "${classified._tag}"`);
		}
	});

	const submoduleAdd = Effect.fn("Git.submoduleAdd")(function* (
		cwd: string,
		options: { readonly url: string; readonly path: string; readonly depth?: number },
	) {
		// The url is deliberately NOT annotated: a URL can embed userinfo, and
		// span annotations carry stable identifiers only (the #86 policy).
		yield* Effect.annotateCurrentSpan({ cwd, path: options.path });
		yield* rejectNonNaturalNumber(cwd, "a submodule add depth", options.depth);
		const classified = yield* runFor(GitCommand.submoduleAdd(options.url, options.path, options.depth), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: options.path, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.submoduleAdd: unexpected classification "${classified._tag}"`);
		}
	});

	const sparseCheckoutSet = Effect.fn("Git.sparseCheckoutSet")(function* (
		cwd: string,
		patterns: ReadonlyArray<string>,
		options: { readonly cone: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, cone: options.cone });
		yield* rejectOptionLikeRefs(cwd, patterns);
		const classified = yield* runFor(GitCommand.sparseCheckoutSet(patterns, options.cone), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "sparse-checkout", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.sparseCheckoutSet: unexpected classification "${classified._tag}"`);
		}
	});

	const configSet = Effect.fn("Git.configSet")(function* (
		cwd: string,
		key: string,
		value: string,
		options?: { readonly file?: string },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, key, file: options?.file ?? "(repository config)" });
		// git config has no documented -- separator, so key, value AND file are all
		// guarded — a leading-dash value is refused typed rather than risking git
		// reading it as a flag. Recorded limitation: a legitimate "-..." config
		// value cannot be written through this method. The value rides the
		// SENSITIVE arm: a refused config value is reported as <redacted>, never
		// echoed into the error (the #86 redaction policy).
		yield* rejectOptionLikeRefs(cwd, [key, ...(options?.file !== undefined ? [options.file] : [])], [value]);
		const classified = yield* runFor(GitCommand.configSet(key, value, options?.file), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: key, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.configSet: unexpected classification "${classified._tag}"`);
		}
	});

	const add = Effect.fn("Git.add")(function* (cwd: string, paths: ReadonlyArray<string>) {
		yield* Effect.annotateCurrentSpan({ cwd, count: paths.length });
		const classified = yield* runFor(GitCommand.add(paths), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "working tree", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.add: unexpected classification "${classified._tag}"`);
		}
	});

	const defaultBranch = Effect.fn("Git.defaultBranch")(function* (cwd: string, options?: { readonly remote?: string }) {
		const remote = options?.remote ?? "origin";
		yield* Effect.annotateCurrentSpan({ cwd, remote });
		yield* rejectOptionLikeRefs(cwd, [remote]);
		const classified = yield* runFor(GitCommand.defaultBranch(remote), cwd, "quiet");
		switch (classified._tag) {
			case "success": {
				const short = classified.output.trim();
				const prefix = `${remote}/`;
				return Option.some(short.startsWith(prefix) ? short.slice(prefix.length) : short);
			}
			case "absent":
				return Option.none();
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: `refs/remotes/${remote}/HEAD`, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.defaultBranch: unexpected classification "${classified._tag}"`);
		}
	});

	const currentBranch = Effect.fn("Git.currentBranch")(function* (cwd: string) {
		yield* Effect.annotateCurrentSpan({ cwd });
		const classified = yield* runFor(GitCommand.currentBranch(), cwd, "generic");
		switch (classified._tag) {
			case "success": {
				const name = classified.output.trim();
				// A detached HEAD answers with the literal string "HEAD" (exit 0) —
				// "no current branch" is the honest typed answer, not a fake name.
				return name === "HEAD" ? Option.none() : Option.some(name);
			}
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "HEAD", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.currentBranch: unexpected classification "${classified._tag}"`);
		}
	});

	const repoRoot = Effect.fn("Git.repoRoot")(function* (cwd: string) {
		yield* Effect.annotateCurrentSpan({ cwd });
		const classified = yield* runFor(GitCommand.repoRoot(), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return classified.output.trim();
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "working tree", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.repoRoot: unexpected classification "${classified._tag}"`);
		}
	});

	const configGet = Effect.fn("Git.configGet")(function* (cwd: string, key: string) {
		yield* Effect.annotateCurrentSpan({ cwd, key });
		yield* rejectOptionLikeRefs(cwd, [key]);
		const classified = yield* runFor(GitCommand.configGet(key), cwd, "quiet");
		switch (classified._tag) {
			case "success":
				return Option.some(classified.output.trim());
			case "absent":
				return Option.none();
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: key, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.configGet: unexpected classification "${classified._tag}"`);
		}
	});

	const remoteUrl = Effect.fn("Git.remoteUrl")(function* (cwd: string, options?: { readonly remote?: string }) {
		const remote = options?.remote ?? "origin";
		yield* Effect.annotateCurrentSpan({ cwd, remote });
		yield* rejectOptionLikeRefs(cwd, [remote]);
		const classified = yield* runFor(GitCommand.remoteUrl(remote), cwd, "noSuchRemote");
		switch (classified._tag) {
			case "success":
				return Option.some(classified.output.trim());
			case "absent":
				return Option.none();
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: remote, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.remoteUrl: unexpected classification "${classified._tag}"`);
		}
	});

	const commitInfo = Effect.fn("Git.commitInfo")(function* (cwd: string, ref?: string) {
		const target = ref ?? "HEAD";
		yield* Effect.annotateCurrentSpan({ cwd, ref: target });
		yield* rejectOptionLikeRefs(cwd, [target]);
		const classified = yield* runFor(GitCommand.commitInfo(target), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return parseCommitInfo(classified.output);
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: target, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.commitInfo: unexpected classification "${classified._tag}"`);
		}
	});

	const status = Effect.fn("Git.status")(function* (cwd: string) {
		yield* Effect.annotateCurrentSpan({ cwd });
		const classified = yield* runFor(GitCommand.status(), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return parseStatus(classified.output);
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "working tree", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.status: unexpected classification "${classified._tag}"`);
		}
	});

	const submoduleStatus = Effect.fn("Git.submoduleStatus")(function* (
		cwd: string,
		options?: { readonly paths?: ReadonlyArray<string>; readonly recursive?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, recursive: options?.recursive ?? false });
		const classified = yield* runFor(
			GitCommand.submoduleStatus(options?.paths ?? [], options?.recursive ?? false),
			cwd,
			"generic",
		);
		switch (classified._tag) {
			case "success":
				return parseSubmoduleStatus(classified.output);
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "submodule status", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.submoduleStatus: unexpected classification "${classified._tag}"`);
		}
	});

	const submoduleInit = Effect.fn("Git.submoduleInit")(function* (
		cwd: string,
		options?: { readonly paths?: ReadonlyArray<string> },
	) {
		yield* Effect.annotateCurrentSpan({ cwd });
		const classified = yield* runFor(GitCommand.submoduleInit(options?.paths ?? []), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "submodule init", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.submoduleInit: unexpected classification "${classified._tag}"`);
		}
	});

	const submoduleDeinit = Effect.fn("Git.submoduleDeinit")(function* (
		cwd: string,
		options: { readonly paths?: ReadonlyArray<string>; readonly all?: boolean; readonly force?: boolean },
	) {
		const paths = options.paths ?? [];
		const all = options.all ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, all, count: paths.length });
		if (!all && paths.length === 0) {
			// git itself refuses deinit with neither --all nor a pathspec; refusing
			// pre-spawn keeps the contract explicit and spawn-free.
			return yield* Effect.fail(
				new GitCommandError({
					kind: "refused",
					args: ["submodule", "deinit"],
					cwd,
					stderr: "",
					detail: "refused: submoduleDeinit needs either paths or all: true",
				}),
			);
		}
		const classified = yield* runFor(GitCommand.submoduleDeinit(paths, all, options.force ?? false), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "submodule deinit", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.submoduleDeinit: unexpected classification "${classified._tag}"`);
		}
	});

	const submoduleSync = Effect.fn("Git.submoduleSync")(function* (
		cwd: string,
		options?: { readonly paths?: ReadonlyArray<string>; readonly recursive?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, recursive: options?.recursive ?? false });
		const classified = yield* runFor(
			GitCommand.submoduleSync(options?.paths ?? [], options?.recursive ?? false),
			cwd,
			"generic",
		);
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "submodule sync", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.submoduleSync: unexpected classification "${classified._tag}"`);
		}
	});

	const submoduleSetUrl = Effect.fn("Git.submoduleSetUrl")(function* (cwd: string, path: string, url: string) {
		// The url is deliberately NOT annotated: a URL can embed userinfo, and
		// span annotations carry stable identifiers only (the #86 policy).
		yield* Effect.annotateCurrentSpan({ cwd, path });
		const classified = yield* runFor(GitCommand.submoduleSetUrl(path, url), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: path, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.submoduleSetUrl: unexpected classification "${classified._tag}"`);
		}
	});

	const submoduleSetBranch = Effect.fn("Git.submoduleSetBranch")(function* (
		cwd: string,
		path: string,
		options?: { readonly branch?: string },
	) {
		const branch = options?.branch;
		yield* Effect.annotateCurrentSpan({ cwd, path, branch: branch ?? "(default)" });
		if (branch !== undefined) {
			yield* rejectOptionLikeRefs(cwd, [branch]);
		}
		const classified = yield* runFor(GitCommand.submoduleSetBranch(path, branch), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: branch ?? path, cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.submoduleSetBranch: unexpected classification "${classified._tag}"`);
		}
	});

	const submoduleAbsorbgitdirs = Effect.fn("Git.submoduleAbsorbgitdirs")(function* (
		cwd: string,
		options?: { readonly paths?: ReadonlyArray<string> },
	) {
		yield* Effect.annotateCurrentSpan({ cwd });
		const classified = yield* runFor(GitCommand.submoduleAbsorbgitdirs(options?.paths ?? []), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "submodule absorbgitdirs", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.submoduleAbsorbgitdirs: unexpected classification "${classified._tag}"`);
		}
	});

	const submoduleForeach = Effect.fn("Git.submoduleForeach")(function* (
		cwd: string,
		command: string,
		options?: { readonly recursive?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, recursive: options?.recursive ?? false });
		// The command is a positional git would read as a flag if it led with a
		// dash — the same option-injection guard as refs.
		yield* rejectOptionLikeRefs(cwd, [command]);
		const classified = yield* runFor(GitCommand.submoduleForeach(command, options?.recursive ?? false), cwd, "generic");
		switch (classified._tag) {
			case "success":
				return classified.output;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: "submodule foreach", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.submoduleForeach: unexpected classification "${classified._tag}"`);
		}
	});

	// Runs a void-returning invocation and classifies through the shared path,
	// mapping `unknownRef` to the given ref label — the shared shape of every
	// mutating method with no method-specific classification rows.
	const runVoid = (method: string, invocation: GitInvocation, cwd: string, refLabel: string) =>
		Effect.gen(function* () {
			const classified = yield* runFor(invocation, cwd, "generic");
			switch (classified._tag) {
				case "success":
					return undefined;
				case "notARepository":
					return yield* Effect.fail(new NotARepositoryError({ cwd }));
				case "unknownRef":
					return yield* Effect.fail(new UnknownRefError({ ref: refLabel, cwd }));
				case "failure":
					return yield* Effect.fail(classified.error);
				default:
					return yield* Effect.die(`${method}: unexpected classification "${classified._tag}"`);
			}
		});

	// Runs a parse-returning invocation and classifies through the shared path.
	// `absent` handles the `"quiet"` kind's silent-exit-1 degrade (an unset
	// config key, a no-paths-ignored check-ignore run); for kinds that cannot
	// produce it the arm falls to the defensive default die.
	const runParsed = <A>(
		method: string,
		invocation: GitInvocation,
		cwd: string,
		refLabel: string,
		kind: ClassifyKind,
		parse: (output: string) => A,
		absent?: () => A,
	) =>
		Effect.gen(function* () {
			const classified = yield* runFor(invocation, cwd, kind);
			switch (classified._tag) {
				case "success":
					return parse(classified.output);
				case "absent":
					if (absent !== undefined) {
						return absent();
					}
					return yield* Effect.die(`${method}: unexpected classification "absent"`);
				case "notARepository":
					return yield* Effect.fail(new NotARepositoryError({ cwd }));
				case "unknownRef":
					return yield* Effect.fail(new UnknownRefError({ ref: refLabel, cwd }));
				case "failure":
					return yield* Effect.fail(classified.error);
				default:
					return yield* Effect.die(`${method}: unexpected classification "${classified._tag}"`);
			}
		});

	const lsRemote = Effect.fn("Git.lsRemote")(function* (
		cwd: string,
		remote: string,
		options?: {
			readonly heads?: boolean;
			readonly tags?: boolean;
			readonly patterns?: ReadonlyArray<string>;
		},
	) {
		// The remote is deliberately NOT annotated: it may be a URL embedding
		// userinfo, and span annotations carry stable identifiers only (#86).
		yield* Effect.annotateCurrentSpan({
			cwd,
			heads: options?.heads ?? false,
			tags: options?.tags ?? false,
			patterns: (options?.patterns ?? []).length,
		});
		yield* rejectOptionLikeRefs(cwd, [remote, ...(options?.patterns ?? [])]);
		return yield* runParsed(
			"Git.lsRemote",
			GitCommand.lsRemote(remote, options?.heads ?? false, options?.tags ?? false, options?.patterns ?? []),
			cwd,
			"ls-remote",
			"generic",
			parseLsRemote,
		);
	});

	const remoteAdd = Effect.fn("Git.remoteAdd")(function* (cwd: string, name: string, url: string) {
		// The url is deliberately NOT annotated (#86).
		yield* Effect.annotateCurrentSpan({ cwd, name });
		yield* rejectOptionLikeRefs(cwd, [name, url]);
		return yield* runVoid("Git.remoteAdd", GitCommand.remoteAdd(name, url), cwd, name);
	});

	const remoteRemove = Effect.fn("Git.remoteRemove")(function* (cwd: string, name: string) {
		yield* Effect.annotateCurrentSpan({ cwd, name });
		yield* rejectOptionLikeRefs(cwd, [name]);
		return yield* runVoid("Git.remoteRemove", GitCommand.remoteRemove(name), cwd, name);
	});

	const remoteSetUrl = Effect.fn("Git.remoteSetUrl")(function* (cwd: string, name: string, url: string) {
		// The url is deliberately NOT annotated (#86).
		yield* Effect.annotateCurrentSpan({ cwd, name });
		yield* rejectOptionLikeRefs(cwd, [name, url]);
		return yield* runVoid("Git.remoteSetUrl", GitCommand.remoteSetUrl(name, url), cwd, name);
	});

	const stashPush = Effect.fn("Git.stashPush")(function* (
		cwd: string,
		options?: {
			readonly message?: string;
			readonly includeUntracked?: boolean;
			readonly paths?: ReadonlyArray<string>;
		},
	) {
		yield* Effect.annotateCurrentSpan({ cwd, includeUntracked: options?.includeUntracked ?? false });
		return yield* runVoid(
			"Git.stashPush",
			GitCommand.stashPush(options?.message, options?.includeUntracked ?? false, options?.paths ?? []),
			cwd,
			"stash",
		);
	});

	// The shared body of stashPop and stashApply — the two merge-shaped stash
	// operations, whose conflict/dirty stderr classifies exactly like a pull's.
	const stashRestore = (method: string, invocation: (index?: number) => GitInvocation) =>
		Effect.fn(method)(function* (cwd: string, options?: { readonly index?: number }) {
			yield* Effect.annotateCurrentSpan({ cwd, index: options?.index ?? 0 });
			yield* rejectNonNaturalNumber(cwd, "a stash index", options?.index);
			const classified = yield* runFor(invocation(options?.index), cwd, "merge");
			switch (classified._tag) {
				case "success":
					return undefined;
				case "dirtyWorktree":
					return yield* Effect.fail(new DirtyWorktreeError({ cwd }));
				case "mergeConflict":
					return yield* Effect.fail(new MergeConflictError({ cwd }));
				case "notARepository":
					return yield* Effect.fail(new NotARepositoryError({ cwd }));
				case "unknownRef":
					return yield* Effect.fail(new UnknownRefError({ ref: "stash", cwd }));
				case "failure":
					return yield* Effect.fail(classified.error);
				default:
					return yield* Effect.die(`${method}: unexpected classification "${classified._tag}"`);
			}
		});

	const stashPop = stashRestore("Git.stashPop", GitCommand.stashPop);
	const stashApply = stashRestore("Git.stashApply", GitCommand.stashApply);

	const stashDrop = Effect.fn("Git.stashDrop")(function* (cwd: string, options?: { readonly index?: number }) {
		yield* Effect.annotateCurrentSpan({ cwd, index: options?.index ?? 0 });
		yield* rejectNonNaturalNumber(cwd, "a stash index", options?.index);
		return yield* runVoid("Git.stashDrop", GitCommand.stashDrop(options?.index), cwd, "stash");
	});

	const stashList = Effect.fn("Git.stashList")(function* (cwd: string) {
		yield* Effect.annotateCurrentSpan({ cwd });
		return yield* runParsed("Git.stashList", GitCommand.stashList(), cwd, "stash", "generic", parseStashList);
	});

	const branchList = Effect.fn("Git.branchList")(function* (
		cwd: string,
		options?: { readonly remotes?: boolean; readonly all?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, remotes: options?.remotes ?? false, all: options?.all ?? false });
		return yield* runParsed(
			"Git.branchList",
			GitCommand.branchList(options?.remotes ?? false, options?.all ?? false),
			cwd,
			"branches",
			"generic",
			parseBranchList,
		);
	});

	const tagCreate = Effect.fn("Git.tagCreate")(function* (
		cwd: string,
		name: string,
		options?: { readonly ref?: string; readonly message?: string; readonly force?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, name, ref: options?.ref ?? "HEAD", force: options?.force ?? false });
		yield* rejectOptionLikeRefs(cwd, [name, ...(options?.ref !== undefined ? [options.ref] : [])]);
		return yield* runVoid(
			"Git.tagCreate",
			GitCommand.tagCreate(name, options?.ref, options?.message, options?.force ?? false),
			cwd,
			options?.ref ?? name,
		);
	});

	const tagDelete = Effect.fn("Git.tagDelete")(function* (cwd: string, name: string) {
		yield* Effect.annotateCurrentSpan({ cwd, name });
		yield* rejectOptionLikeRefs(cwd, [name]);
		return yield* runVoid("Git.tagDelete", GitCommand.tagDelete(name), cwd, name);
	});

	const tagList = Effect.fn("Git.tagList")(function* (cwd: string, options?: { readonly pattern?: string }) {
		yield* Effect.annotateCurrentSpan({ cwd });
		yield* rejectOptionLikeRefs(cwd, options?.pattern !== undefined ? [options.pattern] : []);
		return yield* runParsed("Git.tagList", GitCommand.tagList(options?.pattern), cwd, "tags", "generic", (output) =>
			output.split("\n").filter((line) => line.length > 0),
		);
	});

	const forEachRef = Effect.fn("Git.forEachRef")(function* (
		cwd: string,
		options?: { readonly patterns?: ReadonlyArray<string> },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, patterns: (options?.patterns ?? []).length });
		yield* rejectOptionLikeRefs(cwd, options?.patterns ?? []);
		return yield* runParsed(
			"Git.forEachRef",
			GitCommand.forEachRef(options?.patterns ?? []),
			cwd,
			"for-each-ref",
			"generic",
			parseForEachRef,
		);
	});

	const revList = Effect.fn("Git.revList")(function* (
		cwd: string,
		ref: string,
		options?: { readonly limit?: number; readonly firstParent?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, ref, firstParent: options?.firstParent ?? false });
		yield* rejectOptionLikeRefs(cwd, [ref]);
		yield* rejectNonNaturalNumber(cwd, "a rev-list limit", options?.limit);
		return yield* runParsed(
			"Git.revList",
			GitCommand.revList(ref, options?.limit, options?.firstParent ?? false),
			cwd,
			ref,
			"generic",
			(output) => output.split("\n").filter((line) => line.length > 0),
		);
	});

	const commit = Effect.fn("Git.commit")(function* (
		cwd: string,
		message: string,
		options?: {
			readonly all?: boolean;
			readonly allowEmpty?: boolean;
			readonly amend?: boolean;
			readonly author?: string;
		},
	) {
		yield* Effect.annotateCurrentSpan({ cwd, amend: options?.amend ?? false });
		return yield* runVoid(
			"Git.commit",
			GitCommand.commit(
				message,
				options?.all ?? false,
				options?.allowEmpty ?? false,
				options?.amend ?? false,
				options?.author,
			),
			cwd,
			"HEAD",
		);
	});

	const push = Effect.fn("Git.push")(function* (
		cwd: string,
		options?: {
			readonly remote?: string;
			readonly refspec?: string;
			readonly force?: boolean;
			readonly forceWithLease?: boolean;
			readonly tags?: boolean;
			readonly setUpstream?: boolean;
		},
	) {
		const remote = options?.remote ?? "origin";
		// The remote is deliberately NOT annotated: it may be a URL (#86).
		yield* Effect.annotateCurrentSpan({
			cwd,
			refspec: options?.refspec ?? "(current branch)",
			forceWithLease: options?.forceWithLease ?? false,
		});
		yield* rejectOptionLikeRefs(cwd, [remote, ...(options?.refspec !== undefined ? [options.refspec] : [])]);
		const classified = yield* runFor(
			GitCommand.push(
				remote,
				options?.refspec,
				options?.force ?? false,
				options?.forceWithLease ?? false,
				options?.tags ?? false,
				options?.setUpstream ?? false,
			),
			cwd,
			"push",
		);
		switch (classified._tag) {
			case "success":
				return undefined;
			case "nonFastForward":
				return yield* Effect.fail(
					new NonFastForwardError({
						cwd,
						...(options?.refspec !== undefined ? { refspec: options.refspec } : {}),
					}),
				);
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: options?.refspec ?? "HEAD", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.push: unexpected classification "${classified._tag}"`);
		}
	});

	const pull = Effect.fn("Git.pull")(function* (
		cwd: string,
		options?: {
			readonly remote?: string;
			readonly ref?: string;
			readonly rebase?: boolean;
			readonly ffOnly?: boolean;
		},
	) {
		const remote = options?.remote ?? "origin";
		// The remote is deliberately NOT annotated: it may be a URL (#86).
		yield* Effect.annotateCurrentSpan({
			cwd,
			ref: options?.ref ?? "(upstream)",
			rebase: options?.rebase ?? false,
		});
		yield* rejectOptionLikeRefs(cwd, [remote, ...(options?.ref !== undefined ? [options.ref] : [])]);
		const classified = yield* runFor(
			GitCommand.pull(remote, options?.ref, options?.rebase ?? false, options?.ffOnly ?? false),
			cwd,
			"merge",
		);
		switch (classified._tag) {
			case "success":
				return undefined;
			case "dirtyWorktree":
				return yield* Effect.fail(new DirtyWorktreeError({ cwd }));
			case "mergeConflict":
				return yield* Effect.fail(new MergeConflictError({ cwd }));
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: options?.ref ?? "(upstream)", cwd }));
			case "failure":
				return yield* Effect.fail(classified.error);
			default:
				return yield* Effect.die(`Git.pull: unexpected classification "${classified._tag}"`);
		}
	});

	const configList = Effect.fn("Git.configList")(function* (cwd: string, options?: { readonly file?: string }) {
		yield* Effect.annotateCurrentSpan({ cwd, file: options?.file ?? "(repository config)" });
		yield* rejectOptionLikeRefs(cwd, options?.file !== undefined ? [options.file] : []);
		return yield* runParsed(
			"Git.configList",
			GitCommand.configList(options?.file),
			cwd,
			"config",
			"generic",
			parseConfigList,
		);
	});

	const configGetAll = Effect.fn("Git.configGetAll")(function* (
		cwd: string,
		key: string,
		options?: { readonly file?: string },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, key, file: options?.file ?? "(repository config)" });
		yield* rejectOptionLikeRefs(cwd, [key, ...(options?.file !== undefined ? [options.file] : [])]);
		return yield* runParsed(
			"Git.configGetAll",
			GitCommand.configGetAll(key, options?.file),
			cwd,
			key,
			"quiet",
			parseNulSeparated,
			() => [],
		);
	});

	const configUnset = Effect.fn("Git.configUnset")(function* (
		cwd: string,
		key: string,
		options?: { readonly file?: string; readonly all?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, key, file: options?.file ?? "(repository config)" });
		yield* rejectOptionLikeRefs(cwd, [key, ...(options?.file !== undefined ? [options.file] : [])]);
		return yield* runVoid(
			"Git.configUnset",
			GitCommand.configUnset(key, options?.file, options?.all ?? false),
			cwd,
			key,
		);
	});

	const configRemoveSection = Effect.fn("Git.configRemoveSection")(function* (
		cwd: string,
		section: string,
		options?: { readonly file?: string },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, section, file: options?.file ?? "(repository config)" });
		// git config has no documented -- separator, so section AND file are both
		// guarded — the configSet/configUnset posture.
		yield* rejectOptionLikeRefs(cwd, [section, ...(options?.file !== undefined ? [options.file] : [])]);
		return yield* runVoid(
			"Git.configRemoveSection",
			GitCommand.configRemoveSection(section, options?.file),
			cwd,
			section,
		);
	});

	const configRenameSection = Effect.fn("Git.configRenameSection")(function* (
		cwd: string,
		oldName: string,
		newName: string,
		options?: { readonly file?: string },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, oldName, newName, file: options?.file ?? "(repository config)" });
		yield* rejectOptionLikeRefs(cwd, [oldName, newName, ...(options?.file !== undefined ? [options.file] : [])]);
		return yield* runVoid(
			"Git.configRenameSection",
			GitCommand.configRenameSection(oldName, newName, options?.file),
			cwd,
			oldName,
		);
	});

	const rm = Effect.fn("Git.rm")(function* (
		cwd: string,
		paths: ReadonlyArray<string>,
		options?: { readonly cached?: boolean; readonly recursive?: boolean; readonly force?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, count: paths.length, cached: options?.cached ?? false });
		return yield* runVoid(
			"Git.rm",
			GitCommand.rm(paths, options?.cached ?? false, options?.recursive ?? false, options?.force ?? false),
			cwd,
			"working tree",
		);
	});

	const mv = Effect.fn("Git.mv")(function* (
		cwd: string,
		source: string,
		destination: string,
		options?: { readonly force?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, source, destination });
		return yield* runVoid("Git.mv", GitCommand.mv(source, destination, options?.force ?? false), cwd, "working tree");
	});

	const checkIgnore = Effect.fn("Git.checkIgnore")(function* (cwd: string, paths: ReadonlyArray<string>) {
		yield* Effect.annotateCurrentSpan({ cwd, count: paths.length });
		return yield* runParsed(
			"Git.checkIgnore",
			GitCommand.checkIgnore(paths),
			cwd,
			"check-ignore",
			"quiet",
			parseNulSeparated,
			() => [],
		);
	});

	const worktreeAdd = Effect.fn("Git.worktreeAdd")(function* (
		cwd: string,
		path: string,
		options?: { readonly ref?: string; readonly detach?: boolean; readonly force?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, path, ref: options?.ref ?? "(default)" });
		yield* rejectOptionLikeRefs(cwd, [path, ...(options?.ref !== undefined ? [options.ref] : [])]);
		return yield* runVoid(
			"Git.worktreeAdd",
			GitCommand.worktreeAdd(path, options?.ref, options?.detach ?? false, options?.force ?? false),
			cwd,
			options?.ref ?? path,
		);
	});

	const worktreeList = Effect.fn("Git.worktreeList")(function* (cwd: string) {
		yield* Effect.annotateCurrentSpan({ cwd });
		return yield* runParsed(
			"Git.worktreeList",
			GitCommand.worktreeList(),
			cwd,
			"worktrees",
			"generic",
			parseWorktreeList,
		);
	});

	const worktreeRemove = Effect.fn("Git.worktreeRemove")(function* (
		cwd: string,
		path: string,
		options?: { readonly force?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, path });
		yield* rejectOptionLikeRefs(cwd, [path]);
		return yield* runVoid("Git.worktreeRemove", GitCommand.worktreeRemove(path, options?.force ?? false), cwd, path);
	});

	const lsFiles = Effect.fn("Git.lsFiles")(function* (
		cwd: string,
		options?: { readonly pathspec?: ReadonlyArray<string> },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, patterns: (options?.pathspec ?? []).length });
		return yield* runParsed(
			"Git.lsFiles",
			GitCommand.lsFiles(options?.pathspec ?? []),
			cwd,
			"index",
			"generic",
			parseLsFiles,
		);
	});

	return {
		show,
		lsTree,
		refExists,
		mergeBase,
		changedFiles,
		workingChanges,
		revParse,
		checkout,
		fetch,
		fetchAny,
		fetchUnshallow,
		isShallow,
		reset,
		clean,
		restore,
		branchCreate,
		branchDelete,
		submoduleUpdate,
		submoduleAdd,
		submoduleStatus,
		submoduleInit,
		submoduleDeinit,
		submoduleSync,
		submoduleSetUrl,
		submoduleSetBranch,
		submoduleAbsorbgitdirs,
		submoduleForeach,
		sparseCheckoutSet,
		configSet,
		add,
		nameStatus,
		unstagedChanges,
		stagedChanges,
		untrackedFiles,
		defaultBranch,
		currentBranch,
		repoRoot,
		configGet,
		remoteUrl,
		commitInfo,
		status,
		lsRemote,
		remoteAdd,
		remoteRemove,
		remoteSetUrl,
		stashPush,
		stashPop,
		stashApply,
		stashDrop,
		stashList,
		branchList,
		tagCreate,
		tagDelete,
		tagList,
		forEachRef,
		revList,
		commit,
		push,
		pull,
		configList,
		configGetAll,
		configUnset,
		configRemoveSection,
		configRenameSection,
		rm,
		mv,
		checkIgnore,
		worktreeAdd,
		worktreeList,
		worktreeRemove,
		lsFiles,
	};
};

/**
 * The {@link Git} service shape.
 *
 * @remarks
 * Exported so a consumer can type a variable, field or test fake holding the
 * service without re-declaring the surface — `Layer.succeed(Git, fake)`
 * accepts any `GitShape`.
 *
 * @public
 */
export interface GitShape {
	/** `git show <ref>:<path>` — the contents of `path` at `ref`, or `Option.none` if absent there. */
	readonly show: (
		cwd: string,
		ref: string,
		path: string,
	) => Effect.Effect<Option.Option<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git ls-tree -r -z <ref> [-- <pathspec>...]` — every path in the tree at
	 * `ref`, recursively, optionally scoped to `pathspec`.
	 */
	readonly lsTree: (
		cwd: string,
		ref: string,
		options?: { readonly pathspec?: ReadonlyArray<string> },
	) => Effect.Effect<ReadonlyArray<LsTreeEntry>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/** `git cat-file -e <ref>` — whether `ref` resolves to an existing object. */
	readonly refExists: (cwd: string, ref: string) => Effect.Effect<boolean, GitCommandError | NotARepositoryError>;
	/**
	 * `git merge-base <a> <b>` — the best common ancestor commit, trimmed, as
	 * a PROBE: two refs with no common ancestor (disjoint histories — a
	 * grafted CI clone, an orphan branch) answer `Option.none`, never an
	 * error, because git signals that case as a silent exit 1. An unknown ref
	 * is still a real failure (`UnknownRefError`).
	 *
	 * The value is a plain sha string — no decode or brand step. A caller
	 * that only wants reachability ("do these histories connect?") reads the
	 * boolean directly: `Option.isSome(yield* git.mergeBase(cwd, a, b))`.
	 */
	readonly mergeBase: (
		cwd: string,
		a: string,
		b: string,
	) => Effect.Effect<Option.Option<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git diff --name-only -z [--relative] <base>...<head>` — the paths that
	 * differ. Pass `relative: true` to report paths relative to `cwd` and
	 * exclude changes outside it (a workspace nested in a larger repository).
	 */
	readonly changedFiles: (
		cwd: string,
		options: { readonly base: string; readonly head: string; readonly relative?: boolean },
	) => Effect.Effect<ReadonlyArray<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * The union of unstaged, staged and untracked working-tree paths —
	 * `git diff --name-only -z [--relative]`, `--cached`, and
	 * `git ls-files --others --exclude-standard -z`, deduplicated. Pass
	 * `relative: true` for `cwd`-relative diff paths (`ls-files` reports
	 * `cwd`-relative paths by default too; when `relative` is `false`,
	 * `--full-name` makes it repo-root-relative instead, matching the
	 * un-`--relative` diffs). No ref is involved, so it never fails `UnknownRefError`.
	 */
	readonly workingChanges: (
		cwd: string,
		options?: { readonly relative?: boolean },
	) => Effect.Effect<ReadonlyArray<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/** `git rev-parse --verify <ref>` — resolves `ref` to its full object id, trimmed. */
	readonly revParse: (
		cwd: string,
		ref: string,
	) => Effect.Effect<string, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git checkout [--detach] <ref>` — moves the working tree
	 * (and, for a branch ref, `HEAD`) to `ref`; `options.detach` checks it out
	 * in detached-HEAD state instead of updating a branch.
	 * Real git reports an unknown ref to checkout as a pathspec error, which
	 * classifies as `GitCommandError` rather than `UnknownRefError`; the
	 * `UnknownRefError` arm remains declared for the stderr shapes that do match.
	 */
	readonly checkout: (
		cwd: string,
		ref: string,
		options?: { readonly detach?: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git fetch [--depth <n>] [--unshallow] <remote> [tag] <ref>` —
	 * fetches `options.ref` from `options.remote` (default `origin`) into the
	 * local object database, optionally shallow (`options.depth`), unshallowing
	 * (`options.unshallow`), and/or as a tag (`options.tag`). A ref the remote
	 * does not have surfaces as `UnknownRefError` — the typed signal a
	 * tag-then-branch fetch fallback can branch on.
	 *
	 * `options.ref` also accepts a full refspec (`src:dst`, optionally
	 * `+`-prefixed), passed through verbatim — never guessed at or
	 * transformed. Under a single-branch clone (`actions/checkout`'s default
	 * `fetch-depth: 1` shape) a bare-ref fetch updates only `FETCH_HEAD` and
	 * never creates the remote-tracking ref, so
	 * `+refs/heads/<b>:refs/remotes/origin/<b>` is the spelling that
	 * materializes `origin/<b>`.
	 *
	 * `options.unshallow` follows `fetchUnshallow`'s caller-guards rule: git
	 * rejects `--unshallow` in a non-shallow repository (a loud
	 * `GitCommandError`, deliberately untolerated) — probe with `isShallow`
	 * first. Combining it with `options.depth` is refused typed, pre-spawn,
	 * exactly as git itself would reject the pair.
	 */
	readonly fetch: (
		cwd: string,
		options: {
			readonly ref: string;
			readonly remote?: string;
			readonly depth?: number;
			readonly tag?: boolean;
			readonly unshallow?: boolean;
		},
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: fetches `options.ref` from `options.remote` (default
	 * `origin`) without knowing whether it names a tag — the tag form
	 * (`git fetch [--depth <n>] <remote> tag <ref>`) runs first, and when it
	 * fails as `UnknownRefError` (the typed "not a tag on the remote"
	 * signal) or any `GitCommandError`, the plain form
	 * (`git fetch [--depth <n>] <remote> <ref>`) runs as the fallback.
	 *
	 * `NotARepositoryError` from the tag attempt propagates immediately —
	 * the plain form would fail identically. When both attempts fail, the
	 * PLAIN fetch's error surfaces; the tag attempt's failure is discarded.
	 */
	readonly fetchAny: (
		cwd: string,
		options: { readonly ref: string; readonly remote?: string; readonly depth?: number },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git fetch --unshallow <remote>` — converts a shallow clone
	 * into a complete one by fetching all missing history from
	 * `options.remote` (default `origin`).
	 *
	 * `--unshallow` is a distinct mode, not a depth value: **git rejects it in
	 * a repository that is not shallow**, with
	 * `--unshallow on a complete repository does not make sense` — and this
	 * method deliberately does NOT tolerate that; the failure surfaces typed
	 * as `GitCommandError`, because swallowing it would also swallow every
	 * other fetch failure shape. The caller owns the guard: probe with
	 * `isShallow` first and skip the fetch when the repository is already
	 * complete.
	 */
	readonly fetchUnshallow: (
		cwd: string,
		options?: { readonly remote?: string },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git rev-parse --is-shallow-repository` — whether the repository is a
	 * shallow clone.
	 *
	 * A dedicated predicate, deliberately not folded into `revParse`: that
	 * method's contract is "resolve this REF"; this one takes no ref and
	 * answers a repository-shape question. The intended pairing is
	 * `isShallow` → `fetchUnshallow`.
	 */
	readonly isShallow: (cwd: string) => Effect.Effect<boolean, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git reset --soft|--mixed|--hard [<ref>]` — moves `HEAD` (and,
	 * per `options.mode`, the index and working tree) to `options.ref`
	 * (default `HEAD`, i.e. unstage/discard against the current commit).
	 *
	 * The restore-before-retry primitive: **a failed reset fails loudly and
	 * typed** (`GitCommandError` on any non-zero exit), never a silent no-op —
	 * a reset that silently did nothing would hand a retry of a
	 * non-idempotent operation the same dirty tree. `mode` defaults to
	 * `"mixed"` (git's own default), emitted explicitly in the argv.
	 *
	 * `mode: "hard"` is destructive and legitimately reached for: after
	 * committing through an out-of-band channel (e.g. the GitHub Data API,
	 * which writes the commit server-side), `reset --hard origin/<branch>`
	 * is how the local tree is synchronized to the commit it never made.
	 */
	readonly reset: (
		cwd: string,
		options?: { readonly mode?: "soft" | "mixed" | "hard"; readonly ref?: string },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git clean --force [-d] [-x] [-- <paths>...]` — deletes
	 * untracked files (and, with `options.directories`, untracked directories;
	 * with `options.ignored`, ignored files too), optionally scoped to
	 * `options.paths`.
	 *
	 * `--force` is unconditional: this member exists so a consumer can restore
	 * a tree to a known state before retrying a non-idempotent operation, and
	 * without it git refuses to clean under the default `clean.requireForce`
	 * config — **a clean that silently did nothing corrupts the retry**. Any
	 * non-zero exit fails loudly as `GitCommandError`.
	 */
	readonly clean: (
		cwd: string,
		options?: { readonly directories?: boolean; readonly ignored?: boolean; readonly paths?: ReadonlyArray<string> },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git restore [--source <ref>] [--staged] [--worktree] -- <paths...>`
	 * — restores `paths` from the index, or from `options.source`. The
	 * `checkout -- .`-shaped operation: `restore(cwd, ["."])` discards all
	 * unstaged working-tree changes.
	 *
	 * A separate member deliberately, because `checkout`'s option-injection
	 * guard refuses `--` and option-like refs by design and stays that way.
	 * `restore`'s paths always sit behind a literal `--`, so they are
	 * injection-safe by construction; only `options.source` is a guarded ref.
	 * With neither `staged` nor `worktree` set, git restores the working tree.
	 */
	readonly restore: (
		cwd: string,
		paths: ReadonlyArray<string>,
		options?: { readonly source?: string; readonly staged?: boolean; readonly worktree?: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git branch [-f] <name> [<start-point>]` — creates a branch,
	 * optionally from `options.startPoint`; `options.checkout` switches to it
	 * on creation (`git checkout -b <name> [<start-point>]`), and
	 * `options.force` resets the branch if it already exists (`branch -f`,
	 * or `checkout -B` with `checkout`).
	 *
	 * Branch creation is a branch-member concern, not a `checkout` option:
	 * `checkout`'s contract stays "move to an existing ref" with its
	 * option-like-ref refusal intact. Both `name` and `startPoint` are
	 * guarded — an option-like value is refused typed before any spawn.
	 *
	 * `force` with `checkout` replaces the delete-then-create longhand — a
	 * swallowed `branchDelete(force: true)` followed by a plain create —
	 * which papers over a real edge: `git branch -D` refuses to delete the
	 * currently checked-out branch, so on a runner already sitting on that
	 * branch the swallowed delete fails and the create then fails for real.
	 * `checkout -B` handles both states in one invocation.
	 */
	readonly branchCreate: (
		cwd: string,
		name: string,
		options?: { readonly startPoint?: string; readonly checkout?: boolean; readonly force?: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git branch -d <name>` (or `-D` with `options.force`) —
	 * deletes a local branch. The default `-d` refuses a branch that is not
	 * fully merged — a typed `GitCommandError`, which is usually the honest
	 * answer; `force: true` deletes regardless.
	 */
	readonly branchDelete: (
		cwd: string,
		name: string,
		options?: { readonly force?: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating:
	 * `git submodule update [--init] [--checkout] [--remote] [--no-fetch] [--recursive] [--force] [--depth <n>] [-- <paths>...]`
	 * — updates registered submodules in the working tree, optionally
	 * initializing them (`options.init`), with an optional depth limit and
	 * scoped to `options.paths`.
	 *
	 * `options.checkout` is the documented override for a
	 * `submodule.<name>.update = none` configuration — without it, updating
	 * such a submodule silently no-ops (git reports success and checks out
	 * nothing). `options.fetch` accepts only the literal `false` (emitting
	 * `--no-fetch`): the default already fetches and git has no positive
	 * spelling. `options.remote` tracks the remote branch's tip instead of
	 * the recorded sha; `options.recursive` descends into nested submodules;
	 * `options.force` discards local changes in the submodule working tree.
	 */
	readonly submoduleUpdate: (
		cwd: string,
		options?: {
			readonly init?: boolean;
			readonly depth?: number;
			readonly paths?: ReadonlyArray<string>;
			readonly checkout?: boolean;
			readonly remote?: boolean;
			readonly fetch?: false;
			readonly recursive?: boolean;
			readonly force?: boolean;
		},
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git submodule add [--depth <n>] -- <url> <path>` —
	 * registers and initializes a new submodule at `options.path`, cloned
	 * from `options.url`, optionally shallow.
	 */
	readonly submoduleAdd: (
		cwd: string,
		options: { readonly url: string; readonly path: string; readonly depth?: number },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git submodule status [--recursive] [-- <paths>...]` — one
	 * {@link SubmoduleStatusEntry} per registered submodule, decoding git's
	 * state prefix (`current` / `uninitialized` / `outOfSync` / `conflict`).
	 *
	 * The output is line-based (git offers no `-z` mode here), so a submodule
	 * path containing a newline would corrupt the parse — a git-imposed
	 * limitation, recorded on the entry class.
	 */
	readonly submoduleStatus: (
		cwd: string,
		options?: { readonly paths?: ReadonlyArray<string>; readonly recursive?: boolean },
	) => Effect.Effect<ReadonlyArray<SubmoduleStatusEntry>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git submodule init [-- <paths>...]` — registers submodules
	 * from `.gitmodules` into `.git/config` (all of them, or only
	 * `options.paths`) without cloning or checking anything out.
	 */
	readonly submoduleInit: (
		cwd: string,
		options?: { readonly paths?: ReadonlyArray<string> },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git submodule deinit [--force] (--all | -- <paths>...)` —
	 * unregisters submodules: clears their working trees and removes their
	 * `.git/config` registration. Requires either `options.paths` or
	 * `options.all: true`; neither is refused typed before any spawn, exactly
	 * as git itself would refuse it. `options.force` discards local changes
	 * in the submodule working tree.
	 */
	readonly submoduleDeinit: (
		cwd: string,
		options: { readonly paths?: ReadonlyArray<string>; readonly all?: boolean; readonly force?: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git submodule sync [--recursive] [-- <paths>...]` — re-copies
	 * each submodule's URL from `.gitmodules` into `.git/config` (and the
	 * submodule's own `remote.origin.url`), so a `.gitmodules` URL change
	 * actually reaches git's live configuration.
	 */
	readonly submoduleSync: (
		cwd: string,
		options?: { readonly paths?: ReadonlyArray<string>; readonly recursive?: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git submodule set-url -- <path> <url>` — rewrites the
	 * submodule's URL in `.gitmodules` and synchronizes it into `.git/config`.
	 *
	 * The url never surfaces raw in an error — an embedded `userinfo@`
	 * credential is masked in `GitCommandError.args`/`.message` — and the
	 * method's span annotates `cwd` and `path` only.
	 */
	readonly submoduleSetUrl: (
		cwd: string,
		path: string,
		url: string,
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git submodule set-branch (--branch <branch> | --default) -- <path>`
	 * — records the branch the submodule tracks in `.gitmodules`, or clears
	 * it back to the default when `options.branch` is omitted.
	 */
	readonly submoduleSetBranch: (
		cwd: string,
		path: string,
		options?: { readonly branch?: string },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git submodule absorbgitdirs [-- <paths>...]` — moves each
	 * submodule's embedded `.git` directory into the superproject's
	 * `.git/modules/` and leaves a gitfile pointer behind.
	 */
	readonly submoduleAbsorbgitdirs: (
		cwd: string,
		options?: { readonly paths?: ReadonlyArray<string> },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git submodule foreach [--recursive] <command>` — runs one
	 * shell command string in every checked-out submodule and returns the
	 * collected stdout. The command can mutate anything, which is why the
	 * method is marked mutating regardless of what it runs; a command
	 * beginning with `-` is refused typed before any spawn.
	 */
	readonly submoduleForeach: (
		cwd: string,
		command: string,
		options?: { readonly recursive?: boolean },
	) => Effect.Effect<string, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git sparse-checkout set (--cone | --no-cone) <patterns...>`
	 * — rewrites which paths are checked out in the working tree to
	 * `patterns`, in cone mode or full pattern mode per `options.cone`.
	 */
	readonly sparseCheckoutSet: (
		cwd: string,
		patterns: ReadonlyArray<string>,
		options: { readonly cone: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git config [-f <file>] <key> <value>` — writes `value` for
	 * `key` into the repository config, or into `options.file` when given
	 * (e.g. `.gitmodules`).
	 *
	 * The value never surfaces in an error: a failing `configSet` carries
	 * `<redacted>` in `GitCommandError.args` and `.message`, and the method's
	 * span annotates `key` and `file` only.
	 */
	readonly configSet: (
		cwd: string,
		key: string,
		value: string,
		options?: { readonly file?: string },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git add -- <paths...>` — stages `paths` in the index for
	 * the next commit.
	 */
	readonly add: (
		cwd: string,
		paths: ReadonlyArray<string>,
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git diff --name-status -z [--relative] [<base> | <base>...<head>]` —
	 * the changed paths with their status codes. `head` omitted diffs the
	 * working tree against `base`; `head` present diffs the merge-base range.
	 */
	readonly nameStatus: (
		cwd: string,
		options: { readonly base: string; readonly head?: string; readonly relative?: boolean },
	) => Effect.Effect<ReadonlyArray<NameStatusEntry>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/** `git diff --name-only -z [--relative]` — the unstaged working-tree paths. */
	readonly unstagedChanges: (
		cwd: string,
		options?: { readonly relative?: boolean },
	) => Effect.Effect<ReadonlyArray<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/** `git diff --name-only -z [--relative] --cached` — the staged paths. */
	readonly stagedChanges: (
		cwd: string,
		options?: { readonly relative?: boolean },
	) => Effect.Effect<ReadonlyArray<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/** `git ls-files --others --exclude-standard -z [--full-name]` — the untracked paths. */
	readonly untrackedFiles: (
		cwd: string,
		options?: { readonly relative?: boolean },
	) => Effect.Effect<ReadonlyArray<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git symbolic-ref --quiet --short refs/remotes/<remote>/HEAD` — the
	 * bare branch name, remote prefix stripped, or `Option.none` when the
	 * remote's HEAD is unset — run `git remote set-head` to set it.
	 */
	readonly defaultBranch: (
		cwd: string,
		options?: { readonly remote?: string },
	) => Effect.Effect<Option.Option<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git rev-parse --abbrev-ref HEAD` — the current branch name, or
	 * `Option.none` when `HEAD` is detached (the literal answer `"HEAD"`
	 * degrades to the typed absence rather than a fake branch name).
	 */
	readonly currentBranch: (
		cwd: string,
	) => Effect.Effect<Option.Option<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/** `git rev-parse --show-toplevel` — the absolute repository root path, trimmed. */
	readonly repoRoot: (cwd: string) => Effect.Effect<string, GitCommandError | NotARepositoryError | UnknownRefError>;
	/** `git config --get <key>` — the trimmed value, or `Option.none` when the key is unset. */
	readonly configGet: (
		cwd: string,
		key: string,
	) => Effect.Effect<Option.Option<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/** `git remote get-url <remote>` — the trimmed URL, or `Option.none` when the remote does not exist. */
	readonly remoteUrl: (
		cwd: string,
		options?: { readonly remote?: string },
	) => Effect.Effect<Option.Option<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git log -1 --format=%H%x00%G?%x00%B <ref>` — a single commit's sha,
	 * signature verdict and raw (untrimmed) message. `ref` defaults to `HEAD`.
	 */
	readonly commitInfo: (
		cwd: string,
		ref?: string,
	) => Effect.Effect<CommitInfo, GitCommandError | NotARepositoryError | UnknownRefError>;
	/** `git status --porcelain -z` — the working tree's porcelain status listing. */
	readonly status: (
		cwd: string,
	) => Effect.Effect<ReadonlyArray<StatusEntry>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git ls-remote [--heads] [--tags] <remote> [<patterns>...]` — the refs
	 * `remote` advertises, as {@link LsRemoteEntry} values, optionally
	 * filtered to branch heads and/or tags and/or shell-glob patterns.
	 *
	 * The one read that talks to the NETWORK. Auth failure and an unreachable
	 * remote stay {@link GitCommandError} deliberately — no consumer branches
	 * on them, so they carry no dedicated type. The validate-before-mutate
	 * consumer story: look for the wanted ref in the listing, and on a miss
	 * hand the entries to `LsRemoteEntry.nearMatches` for a suggestion (the
	 * monorepo-prefixed-tag case, `effect@<ref>`). `remote` may be a URL; an
	 * embedded credential never surfaces in an error value.
	 */
	readonly lsRemote: (
		cwd: string,
		remote: string,
		options?: {
			readonly heads?: boolean;
			readonly tags?: boolean;
			readonly patterns?: ReadonlyArray<string>;
		},
	) => Effect.Effect<ReadonlyArray<LsRemoteEntry>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git remote add <name> <url>` — registers a new remote.
	 * `url`'s embedded credential (if any) never surfaces in an error value,
	 * and the method's span annotates `name` only.
	 */
	readonly remoteAdd: (
		cwd: string,
		name: string,
		url: string,
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git remote remove <name>` — deletes a remote, its
	 * remote-tracking refs and its configuration. A missing remote fails
	 * loudly as {@link GitCommandError} — probe with `remoteUrl` first when
	 * idempotency is wanted.
	 */
	readonly remoteRemove: (
		cwd: string,
		name: string,
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git remote set-url <name> <url>` — rewrites a remote's fetch
	 * URL. `url`'s embedded credential (if any) never surfaces in an error
	 * value, and the method's span annotates `name` only.
	 */
	readonly remoteSetUrl: (
		cwd: string,
		name: string,
		url: string,
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git stash push [--include-untracked] [-m <message>] [-- <paths>...]`
	 * — saves the working-tree (and index) state onto the stash stack and
	 * resets the tree to `HEAD`.
	 */
	readonly stashPush: (
		cwd: string,
		options?: {
			readonly message?: string;
			readonly includeUntracked?: boolean;
			readonly paths?: ReadonlyArray<string>;
		},
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git stash pop [stash@{n}]` — applies a stash entry
	 * (`options.index`, default the latest) and drops it on success.
	 *
	 * The two branchable failures are typed: {@link DirtyWorktreeError} when
	 * local changes would be overwritten (the tree is untouched), and
	 * {@link MergeConflictError} when the apply stopped on conflicts — in
	 * that case the stash entry is KEPT, and the caller owns resolving. A
	 * non-integer index is refused typed before any spawn.
	 */
	readonly stashPop: (
		cwd: string,
		options?: { readonly index?: number },
	) => Effect.Effect<
		void,
		GitCommandError | NotARepositoryError | UnknownRefError | MergeConflictError | DirtyWorktreeError
	>;
	/**
	 * Mutating: `git stash apply [stash@{n}]` — applies a stash entry and
	 * keeps it on the stack. Fails exactly like `stashPop`
	 * ({@link DirtyWorktreeError} / {@link MergeConflictError} are the
	 * branchable shapes).
	 */
	readonly stashApply: (
		cwd: string,
		options?: { readonly index?: number },
	) => Effect.Effect<
		void,
		GitCommandError | NotARepositoryError | UnknownRefError | MergeConflictError | DirtyWorktreeError
	>;
	/**
	 * Mutating: `git stash drop [stash@{n}]` — deletes a stash entry
	 * (`options.index`, default the latest) without applying it.
	 */
	readonly stashDrop: (
		cwd: string,
		options?: { readonly index?: number },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git stash list -z --format=%gd%x1f%H%x1f%gs` — every stash entry as a
	 * {@link StashEntry} (reflog selector, sha, subject). The entry's
	 * position in the returned array IS its current index — `entries[2]` is
	 * `stash@{2}` — which is what the index-taking stash methods consume.
	 */
	readonly stashList: (
		cwd: string,
	) => Effect.Effect<ReadonlyArray<StashEntry>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git branch --list [--remotes | --all]` — every branch as a
	 * {@link BranchEntry} (short name, tip sha, current marker), via the
	 * NUL-separated for-each-ref format. `all` wins when both flags are set.
	 */
	readonly branchList: (
		cwd: string,
		options?: { readonly remotes?: boolean; readonly all?: boolean },
	) => Effect.Effect<ReadonlyArray<BranchEntry>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git tag [--force] [-m <message>] <name> [<ref>]` — creates a
	 * lightweight tag at `options.ref` (default `HEAD`), or an annotated one
	 * when `options.message` is given. An existing tag fails loudly unless
	 * `options.force` is set.
	 */
	readonly tagCreate: (
		cwd: string,
		name: string,
		options?: { readonly ref?: string; readonly message?: string; readonly force?: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/** Mutating: `git tag --delete <name>` — deletes a local tag. */
	readonly tagDelete: (
		cwd: string,
		name: string,
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git tag --list [<pattern>]` — tag names, optionally filtered by a
	 * shell-glob `options.pattern`.
	 */
	readonly tagList: (
		cwd: string,
		options?: { readonly pattern?: string },
	) => Effect.Effect<ReadonlyArray<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git for-each-ref [<patterns>...]` — every matching ref as a
	 * {@link RefEntry} (full refname, sha, object type), via this package's
	 * fixed `%(refname)%00%(objectname)%00%(objecttype)` format.
	 */
	readonly forEachRef: (
		cwd: string,
		options?: { readonly patterns?: ReadonlyArray<string> },
	) => Effect.Effect<ReadonlyArray<RefEntry>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git rev-list [--max-count=<n>] [--first-parent] <ref>` — the commit
	 * shas reachable from `ref` (which may be a range, `main..feat`), newest
	 * first. A non-integer `options.limit` is refused typed before any spawn.
	 */
	readonly revList: (
		cwd: string,
		ref: string,
		options?: { readonly limit?: number; readonly firstParent?: boolean },
	) => Effect.Effect<ReadonlyArray<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git commit [--all] [--allow-empty] [--amend] [--author=<author>] -m <message>`
	 * — records a commit. The message rides argv; committer identity comes
	 * from the caller's ENVIRONMENT (this package sets only `LC_ALL`), and
	 * `options.author` is the explicit `--author=` override. "Nothing to
	 * commit" fails loudly as {@link GitCommandError}.
	 */
	readonly commit: (
		cwd: string,
		message: string,
		options?: {
			readonly all?: boolean;
			readonly allowEmpty?: boolean;
			readonly amend?: boolean;
			readonly author?: string;
		},
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git push [--force | --force-with-lease] [--tags] [--set-upstream] <remote> [<refspec>]`
	 * — updates remote refs.
	 *
	 * A rejected push — the remote moved (`fetch first` /
	 * `non-fast-forward`), or a `--force-with-lease` lease failure
	 * (`stale info`) — fails typed as {@link NonFastForwardError}, the signal
	 * a fetch-then-retry fallback branches on. Every other failure stays
	 * {@link GitCommandError}. `remote` may be a URL; an embedded credential
	 * never surfaces in an error value.
	 */
	readonly push: (
		cwd: string,
		options?: {
			readonly remote?: string;
			readonly refspec?: string;
			readonly force?: boolean;
			readonly forceWithLease?: boolean;
			readonly tags?: boolean;
			readonly setUpstream?: boolean;
		},
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError | NonFastForwardError>;
	/**
	 * Mutating: `git pull [--rebase] [--ff-only] <remote> [<ref>]` — fetches
	 * and integrates.
	 *
	 * The two branchable failures are typed: {@link DirtyWorktreeError} when
	 * local modifications block the merge before it starts (the tree is
	 * untouched — commit or stash first), and {@link MergeConflictError} when
	 * the merge stopped on conflicts (markers are in the tree; resolve or
	 * abort). `remote` may be a URL; an embedded credential never surfaces in
	 * an error value.
	 */
	readonly pull: (
		cwd: string,
		options?: {
			readonly remote?: string;
			readonly ref?: string;
			readonly rebase?: boolean;
			readonly ffOnly?: boolean;
		},
	) => Effect.Effect<
		void,
		GitCommandError | NotARepositoryError | UnknownRefError | MergeConflictError | DirtyWorktreeError
	>;
	/**
	 * `git config [-f <file>] --list -z` — every configuration entry in scope
	 * (or in `options.file` only) as {@link ConfigListEntry} values. `-z`
	 * keeps multi-line values lossless.
	 */
	readonly configList: (
		cwd: string,
		options?: { readonly file?: string },
	) => Effect.Effect<ReadonlyArray<ConfigListEntry>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git config [-f <file>] --get-all -z <key>` — every value of a
	 * (possibly multi-valued) key, in order. An unset key degrades to the
	 * empty array, never an error — the multi-valued sibling of `configGet`'s
	 * `Option.none`.
	 */
	readonly configGetAll: (
		cwd: string,
		key: string,
		options?: { readonly file?: string },
	) => Effect.Effect<ReadonlyArray<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git config [-f <file>] (--unset | --unset-all) <key>` —
	 * removes `key` (or, with `options.all`, every value of a multi-valued
	 * key). Unsetting a key that was never set fails LOUDLY (git exits 5) —
	 * an unset that silently did nothing is indistinguishable from one that
	 * worked; probe with `configGet` first when idempotency is wanted.
	 */
	readonly configUnset: (
		cwd: string,
		key: string,
		options?: { readonly file?: string; readonly all?: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git config [-f <file>] --remove-section <section>` — removes
	 * a whole configuration section (every key under it, and the header) from
	 * the live config, or from `options.file`. The section-level sibling of
	 * `configUnset` — clearing a stale `submodule.<name>` registration is one
	 * invocation instead of a key-by-key probe-and-unset. Removing a section
	 * that does not exist fails LOUDLY (git exits 128,
	 * `fatal: no such section`) — the `configUnset` posture; probe with
	 * `configList` first when idempotency is wanted.
	 */
	readonly configRemoveSection: (
		cwd: string,
		section: string,
		options?: { readonly file?: string },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git config [-f <file>] --rename-section <old> <new>` —
	 * renames a configuration section, carrying every key under it across.
	 * Renaming a section that does not exist fails LOUDLY (git exits 128,
	 * `fatal: no such section`) — the same posture as `configRemoveSection`.
	 */
	readonly configRenameSection: (
		cwd: string,
		oldName: string,
		newName: string,
		options?: { readonly file?: string },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git rm [--cached] [-r] [--force] -- <paths...>` — removes
	 * `paths` from the index and (without `options.cached`) the working tree.
	 * `cached: true` is the unstage-but-keep-file form a submodule removal
	 * sequence needs.
	 */
	readonly rm: (
		cwd: string,
		paths: ReadonlyArray<string>,
		options?: { readonly cached?: boolean; readonly recursive?: boolean; readonly force?: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git mv [--force] -- <source> <destination>` — moves or
	 * renames a tracked path, updating the index and the working tree
	 * together.
	 */
	readonly mv: (
		cwd: string,
		source: string,
		destination: string,
		options?: { readonly force?: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git check-ignore -z --stdin` — the subset of `paths` git would ignore,
	 * predicate-shaped: paths in, the ignored ones back. Paths are fed via
	 * STDIN (NUL-separated both directions), so nothing caller-controlled
	 * enters the argv and special-character paths survive unquoted. No path
	 * ignored degrades to the empty array, never an error.
	 */
	readonly checkIgnore: (
		cwd: string,
		paths: ReadonlyArray<string>,
	) => Effect.Effect<ReadonlyArray<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git worktree add [--force] [--detach] <path> [<ref>]` —
	 * creates a linked working tree at `path`, checked out at `options.ref`
	 * (or a branch named after `path`'s basename).
	 */
	readonly worktreeAdd: (
		cwd: string,
		path: string,
		options?: { readonly ref?: string; readonly detach?: boolean; readonly force?: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git worktree list --porcelain -z` — every working tree (the main one
	 * first) as a {@link WorktreeEntry}.
	 */
	readonly worktreeList: (
		cwd: string,
	) => Effect.Effect<ReadonlyArray<WorktreeEntry>, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * Mutating: `git worktree remove [--force] <path>` — removes a linked
	 * working tree. A dirty worktree fails loudly unless `options.force` is
	 * set.
	 */
	readonly worktreeRemove: (
		cwd: string,
		path: string,
		options?: { readonly force?: boolean },
	) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	/**
	 * `git ls-files --stage -z [-- <pathspec>...]` — every INDEX entry as an
	 * {@link LsFilesEntry} (mode, oid, merge stage, path), optionally scoped
	 * to `options.pathspec`.
	 *
	 * The index-side sibling of `lsTree`: the only read that sees a
	 * staged-but-uncommitted gitlink (`160000 <oid> 0 <path>`) — the state a
	 * stage-without-commit window (a submodule pin/add) deliberately
	 * produces, which a HEAD-side `lsTree` misreports.
	 */
	readonly lsFiles: (
		cwd: string,
		options?: { readonly pathspec?: ReadonlyArray<string> },
	) => Effect.Effect<ReadonlyArray<LsFilesEntry>, GitCommandError | NotARepositoryError | UnknownRefError>;
}

/**
 * The default for every {@link Git.makeTest} method a test did not stub: a
 * defect naming the method, so an unexercised call fails loudly instead of
 * succeeding with a lie or failing with a dishonest typed error.
 */
const notStubbed = (method: string) => () =>
	Effect.die(
		new Error(
			`Git.makeTest: ${method}() was called but not stubbed — no honest default exists for a test double; pass a \`${method}\` override.`,
		),
	);

/**
 * Typed git introspection over core's `ChildProcessSpawner`: read a
 * repository's state at any ref without checking it out (including the
 * network read `lsRemote` and the index read `lsFiles`), plus the mutating
 * tier — checkout/fetch, the working-tree restore trio and stash, branches
 * and tags, remotes, worktrees, commit/push/pull, submodules,
 * sparse-checkout, config writes and staging — that changes it. Every
 * mutating method's TSDoc opens with the literal word `Mutating:`.
 *
 * @remarks
 * Every method takes `cwd` explicitly and classifies git's stderr/exit-code
 * taxonomy exactly once, in this module's private `classify` step — a
 * spawn-level `PlatformError` and `Cause.TimeoutError` never escape a `Git`
 * method; every failure surfaces as {@link GitCommandError},
 * {@link NotARepositoryError}, {@link UnknownRefError}, or one of the three
 * consumer-branchable classifications ({@link NonFastForwardError} from
 * `push`; {@link MergeConflictError} and {@link DirtyWorktreeError} from the
 * merge-shaped `pull` / `stashPop` / `stashApply`), or degrades to the
 * documented non-error (`Option.none`, `false`, the empty array).
 *
 * Every method whose TSDoc opens "Mutating:" changes the working tree,
 * `HEAD`, the index, the repository config, the object database and
 * remote-tracking refs (`fetch`), or a submodule. None of it is
 * safe to run concurrently against the same `cwd`; nothing here serializes
 * that — a caller running two mutating calls (or a mutating call alongside a
 * read) against one `cwd` at once owns the race.
 *
 * **Redaction policy (documented, not just convention).** Error values
 * persist only the constructor's REDACTED argv (see `GitCommandError.args`),
 * and span annotations carry stable identifiers only — `cwd`, refs, keys,
 * paths, remote names — never config values and never URLs, which can embed
 * userinfo. A new method must follow both halves before it ships.
 *
 * @public
 */
export class Git extends Context.Service<Git, GitShape>()("@effected/git/Git") {
	/** Resolves `ChildProcessSpawner` once, at construction — every method's `R` is `never`. */
	static readonly layer: Layer.Layer<Git, never, ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
		this,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			return make(spawner);
		}),
	);

	/**
	 * An in-memory test double of the service shape: stub only the methods the
	 * test exercises, every other method **dies** with a defect naming itself.
	 *
	 * @remarks
	 * Unlike `WorkspaceDiscovery.makeTest`, **no method here has an honest
	 * default** — the shape is unrelated git operations, and a
	 * fabricated answer for any of them (an empty tree, a made-up sha, a silent
	 * no-op `checkout`) would leak into consumer logic as fact. So every
	 * unstubbed method fails loudly as a defect
	 * (`Git.makeTest: <name>() was called but not stubbed`) rather than
	 * succeeding with a lie or failing with a dishonest typed error — which is
	 * also what makes the double a proof that a test touches *nothing but* the
	 * methods it stubbed.
	 *
	 * The double deliberately models **none** of the live service's semantics:
	 * no stderr classification, no option-injection guard (an option-like ref a
	 * stub accepts would be refused live), no `LC_ALL=C` pinning, no timeout,
	 * and no `./`-vs-bare path resolution on `show` — a stub answers exactly
	 * what it is told and nothing else. A suite exercising any of those wants
	 * `Git.layer` over a mocked `ChildProcessSpawner` (or real git) instead.
	 *
	 * @example
	 * ```ts
	 * import { Git } from "@effected/git";
	 * import { Effect, Option } from "effect";
	 *
	 * const double = Git.makeTest({
	 *   show: (_cwd, _ref, path) =>
	 *     Effect.succeed(path === "./package.json" ? Option.some("{}") : Option.none()),
	 * });
	 * // `double.show(...)` answers; `double.status(...)` dies, named.
	 * ```
	 */
	static readonly makeTest = (overrides: Partial<GitShape> = {}): GitShape => ({
		show: notStubbed("show"),
		lsTree: notStubbed("lsTree"),
		refExists: notStubbed("refExists"),
		mergeBase: notStubbed("mergeBase"),
		changedFiles: notStubbed("changedFiles"),
		workingChanges: notStubbed("workingChanges"),
		revParse: notStubbed("revParse"),
		checkout: notStubbed("checkout"),
		fetch: notStubbed("fetch"),
		fetchAny: notStubbed("fetchAny"),
		fetchUnshallow: notStubbed("fetchUnshallow"),
		isShallow: notStubbed("isShallow"),
		reset: notStubbed("reset"),
		clean: notStubbed("clean"),
		restore: notStubbed("restore"),
		branchCreate: notStubbed("branchCreate"),
		branchDelete: notStubbed("branchDelete"),
		submoduleUpdate: notStubbed("submoduleUpdate"),
		submoduleAdd: notStubbed("submoduleAdd"),
		submoduleStatus: notStubbed("submoduleStatus"),
		submoduleInit: notStubbed("submoduleInit"),
		submoduleDeinit: notStubbed("submoduleDeinit"),
		submoduleSync: notStubbed("submoduleSync"),
		submoduleSetUrl: notStubbed("submoduleSetUrl"),
		submoduleSetBranch: notStubbed("submoduleSetBranch"),
		submoduleAbsorbgitdirs: notStubbed("submoduleAbsorbgitdirs"),
		submoduleForeach: notStubbed("submoduleForeach"),
		sparseCheckoutSet: notStubbed("sparseCheckoutSet"),
		configSet: notStubbed("configSet"),
		add: notStubbed("add"),
		nameStatus: notStubbed("nameStatus"),
		unstagedChanges: notStubbed("unstagedChanges"),
		stagedChanges: notStubbed("stagedChanges"),
		untrackedFiles: notStubbed("untrackedFiles"),
		defaultBranch: notStubbed("defaultBranch"),
		currentBranch: notStubbed("currentBranch"),
		repoRoot: notStubbed("repoRoot"),
		configGet: notStubbed("configGet"),
		remoteUrl: notStubbed("remoteUrl"),
		commitInfo: notStubbed("commitInfo"),
		status: notStubbed("status"),
		lsRemote: notStubbed("lsRemote"),
		remoteAdd: notStubbed("remoteAdd"),
		remoteRemove: notStubbed("remoteRemove"),
		remoteSetUrl: notStubbed("remoteSetUrl"),
		stashPush: notStubbed("stashPush"),
		stashPop: notStubbed("stashPop"),
		stashApply: notStubbed("stashApply"),
		stashDrop: notStubbed("stashDrop"),
		stashList: notStubbed("stashList"),
		branchList: notStubbed("branchList"),
		tagCreate: notStubbed("tagCreate"),
		tagDelete: notStubbed("tagDelete"),
		tagList: notStubbed("tagList"),
		forEachRef: notStubbed("forEachRef"),
		revList: notStubbed("revList"),
		commit: notStubbed("commit"),
		push: notStubbed("push"),
		pull: notStubbed("pull"),
		configList: notStubbed("configList"),
		configGetAll: notStubbed("configGetAll"),
		configUnset: notStubbed("configUnset"),
		configRemoveSection: notStubbed("configRemoveSection"),
		configRenameSection: notStubbed("configRenameSection"),
		rm: notStubbed("rm"),
		mv: notStubbed("mv"),
		checkIgnore: notStubbed("checkIgnore"),
		worktreeAdd: notStubbed("worktreeAdd"),
		worktreeList: notStubbed("worktreeList"),
		worktreeRemove: notStubbed("worktreeRemove"),
		lsFiles: notStubbed("lsFiles"),
		...overrides,
	});

	/**
	 * The test layer: {@link Git.makeTest} behind `Layer.succeed`, so a suite
	 * provides only the methods it exercises.
	 *
	 * @remarks
	 * A parameterized layer factory mints a **fresh reference per call**, and
	 * layers memoize by reference — bind the result to a `const` and reuse it
	 * rather than calling `layerTest(...)` at each composition site.
	 *
	 * @example
	 * ```ts
	 * import { Git, LsTreeEntry } from "@effected/git";
	 * import { Effect } from "effect";
	 *
	 * const TestGit = Git.layerTest({
	 *   lsTree: () =>
	 *     Effect.succeed([
	 *       LsTreeEntry.make({ mode: "100644", type: "blob", oid: "0".repeat(40), path: "package.json" }),
	 *     ]),
	 * });
	 * // program.pipe(Effect.provide(TestGit))
	 * ```
	 */
	static readonly layerTest = (overrides: Partial<GitShape> = {}): Layer.Layer<Git> =>
		Layer.succeed(Git, Git.makeTest(overrides));
}
