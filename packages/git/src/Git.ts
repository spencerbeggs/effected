import { Context, Duration, Effect, Layer, Option, PlatformError, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
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
 * produced an exit code at all. {@link GitCommandError.kind | `kind`}
 * discriminates a pre-spawn guard rejection (`"refused"`) from a genuine git
 * failure (`"failed"`) structurally, so composed retry/fallback logic never has
 * to parse the prose in `message` or `detail`.
 *
 * @public
 */
export class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()("GitCommandError", {
	/**
	 * Discriminates a pre-spawn guard rejection from a genuine git failure.
	 * `"refused"` — a pre-spawn guard (an option-like ref) rejected the
	 * invocation and no process was ever spawned. `"failed"` — git actually ran
	 * and exited non-zero, or the spawn/IO itself failed. Composed retry/fallback
	 * logic routes on this instead of matching `detail` prose.
	 */
	kind: Schema.Literals(["refused", "failed"]),
	/** The argument vector, without the leading `git`. */
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
export class NotARepositoryError extends Schema.TaggedErrorClass<NotARepositoryError>()("NotARepositoryError", {
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
export class UnknownRefError extends Schema.TaggedErrorClass<UnknownRefError>()("UnknownRefError", {
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
	| { readonly _tag: "failure"; readonly error: GitCommandError };

/**
 * Which method-specific classification rows apply on top of the shared
 * taxonomy: `"show"` enables the absent-at-ref degrade, `"refExists"` enables
 * the exit-1-is-false degrade, `"quiet"` enables the silent-exit-1-is-absent
 * degrade, `"noSuchRemote"` enables the no-such-remote degrade, `"generic"`
 * enables neither.
 */
type ClassifyKind = "show" | "refExists" | "quiet" | "noSuchRemote" | "generic";

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

const matchesAny = (stderr: string, patterns: ReadonlyArray<string>): boolean =>
	patterns.some((pattern) => stderr.includes(pattern));

/**
 * Classifies one completed run (or spawn-level `PlatformError`) against
 * git's stderr taxonomy. Written once — every `Git` method funnels through
 * this before deciding its own return value.
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
 * Runs `command`, classifies the outcome, and never fails: a spawn-level
 * `PlatformError` and a per-run timeout are both absorbed into the
 * `"failure"` classification rather than escaping the effect's error
 * channel.
 */
const runClassified = (
	command: ChildProcess.Command,
	cwd: string,
	kind: ClassifyKind,
): Effect.Effect<Classified, never, ChildProcessSpawner.ChildProcessSpawner> => {
	const args = ChildProcess.isStandardCommand(command) ? command.args : [];
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
}) {}

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
 * Refuse a caller-supplied ref or range that git would parse as an option.
 *
 * Refs are caller-controlled and land in git's argv as positional entries; a
 * value beginning with `-` is read as a flag instead — `checkout("-b")` would
 * CREATE a branch. A bare `--` separator is not a safe fix for every command
 * (it switches `checkout` into pathspec mode), so option-like values are
 * refused outright, before any spawn, as a typed {@link GitCommandError}.
 * `show`'s `path` needs no guard: it is fused after the ref into one
 * `ref:path` token, which cannot begin with `-` unless the ref does.
 */
const rejectOptionLikeRefs = (cwd: string, refs: ReadonlyArray<string>): Effect.Effect<void, GitCommandError> => {
	const offending = refs.find((ref) => ref.startsWith("-"));
	return offending === undefined
		? Effect.void
		: Effect.fail(
				new GitCommandError({
					kind: "refused",
					args: [offending],
					cwd,
					stderr: "",
					detail: `refused a ref argument git would parse as an option: ${JSON.stringify(offending)}`,
				}),
			);
};

/** Builds the `Git.Service` shape over an already-resolved `ChildProcessSpawner`. */
const make = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) => {
	const runFor = (command: ChildProcess.Command, cwd: string, kind: ClassifyKind) =>
		runClassified(command, cwd, kind).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

	const show = Effect.fn("Git.show")(function* (cwd: string, ref: string, path: string) {
		yield* Effect.annotateCurrentSpan({ cwd, ref, path });
		yield* rejectOptionLikeRefs(cwd, [ref]);
		const command = ChildProcess.setCwd(GitCommand.show(ref, path), cwd);
		const classified = yield* runFor(command, cwd, "show");
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
		const command = ChildProcess.setCwd(GitCommand.lsTree(ref, options?.pathspec ?? []), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
		const command = ChildProcess.setCwd(GitCommand.refExists(ref), cwd);
		const classified = yield* runFor(command, cwd, "refExists");
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
		const command = ChildProcess.setCwd(GitCommand.mergeBase(a, b), cwd);
		const classified = yield* runFor(command, cwd, "generic");
		switch (classified._tag) {
			case "success":
				return classified.output.trim();
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
		const command = ChildProcess.setCwd(GitCommand.changedFiles(options.base, options.head, relative), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
	const collectPaths = (method: string, command: ChildProcess.Command, cwd: string) =>
		Effect.gen(function* () {
			const classified = yield* runFor(command, cwd, "generic");
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
		return yield* collectPaths(
			"Git.unstagedChanges",
			ChildProcess.setCwd(GitCommand.unstagedChanges(relative), cwd),
			cwd,
		);
	});

	const stagedChanges = Effect.fn("Git.stagedChanges")(function* (
		cwd: string,
		options?: { readonly relative?: boolean },
	) {
		const relative = options?.relative ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, relative });
		return yield* collectPaths("Git.stagedChanges", ChildProcess.setCwd(GitCommand.stagedChanges(relative), cwd), cwd);
	});

	const untrackedFiles = Effect.fn("Git.untrackedFiles")(function* (
		cwd: string,
		options?: { readonly relative?: boolean },
	) {
		const relative = options?.relative ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, relative });
		return yield* collectPaths(
			"Git.untrackedFiles",
			ChildProcess.setCwd(GitCommand.untrackedFiles(relative), cwd),
			cwd,
		);
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
		const command = ChildProcess.setCwd(GitCommand.nameStatus(options.base, options.head, relative), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
		const command = ChildProcess.setCwd(GitCommand.revParse(ref), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
		const command = ChildProcess.setCwd(GitCommand.checkout(ref, detach), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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

	const fetch = Effect.fn("Git.fetch")(function* (
		cwd: string,
		options: { readonly ref: string; readonly remote?: string; readonly depth?: number; readonly tag?: boolean },
	) {
		const remote = options.remote ?? "origin";
		const tag = options.tag ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, remote, ref: options.ref, tag });
		yield* rejectOptionLikeRefs(cwd, [remote, options.ref]);
		const command = ChildProcess.setCwd(GitCommand.fetch(remote, options.ref, options.depth, tag), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
		const remote = options.remote ?? "origin";
		yield* Effect.annotateCurrentSpan({ cwd, remote, ref: options.ref });
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
		options?: { readonly init?: boolean; readonly depth?: number; readonly paths?: ReadonlyArray<string> },
	) {
		const init = options?.init ?? false;
		yield* Effect.annotateCurrentSpan({ cwd, init });
		const command = ChildProcess.setCwd(GitCommand.submoduleUpdate(init, options?.depth, options?.paths ?? []), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
		yield* Effect.annotateCurrentSpan({ cwd, url: options.url, path: options.path });
		const command = ChildProcess.setCwd(GitCommand.submoduleAdd(options.url, options.path, options.depth), cwd);
		const classified = yield* runFor(command, cwd, "generic");
		switch (classified._tag) {
			case "success":
				return undefined;
			case "notARepository":
				return yield* Effect.fail(new NotARepositoryError({ cwd }));
			case "unknownRef":
				return yield* Effect.fail(new UnknownRefError({ ref: options.url, cwd }));
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
		const command = ChildProcess.setCwd(GitCommand.sparseCheckoutSet(patterns, options.cone), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
		// value cannot be written through this method.
		yield* rejectOptionLikeRefs(cwd, [key, value, ...(options?.file !== undefined ? [options.file] : [])]);
		const command = ChildProcess.setCwd(GitCommand.configSet(key, value, options?.file), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
		const command = ChildProcess.setCwd(GitCommand.add(paths), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
		const command = ChildProcess.setCwd(GitCommand.defaultBranch(remote), cwd);
		const classified = yield* runFor(command, cwd, "quiet");
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
		const command = ChildProcess.setCwd(GitCommand.currentBranch(), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
		const command = ChildProcess.setCwd(GitCommand.repoRoot(), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
		const command = ChildProcess.setCwd(GitCommand.configGet(key), cwd);
		const classified = yield* runFor(command, cwd, "quiet");
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
		const command = ChildProcess.setCwd(GitCommand.remoteUrl(remote), cwd);
		const classified = yield* runFor(command, cwd, "noSuchRemote");
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
		const command = ChildProcess.setCwd(GitCommand.commitInfo(target), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
		const command = ChildProcess.setCwd(GitCommand.status(), cwd);
		const classified = yield* runFor(command, cwd, "generic");
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
		submoduleUpdate,
		submoduleAdd,
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
	/** `git merge-base <a> <b>` — the best common ancestor commit, trimmed. */
	readonly mergeBase: (
		cwd: string,
		a: string,
		b: string,
	) => Effect.Effect<string, GitCommandError | NotARepositoryError | UnknownRefError>;
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
	 * Mutating: `git fetch [--depth <n>] <remote> [tag] <ref>` — fetches
	 * `options.ref` from `options.remote` (default `origin`) into the local
	 * object database, optionally shallow (`options.depth`) and/or as a tag
	 * (`options.tag`). A ref the remote does not have surfaces as
	 * `UnknownRefError` — the typed signal a tag-then-branch fetch fallback
	 * can branch on.
	 */
	readonly fetch: (
		cwd: string,
		options: { readonly ref: string; readonly remote?: string; readonly depth?: number; readonly tag?: boolean },
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
	 * Mutating: `git submodule update [--init] [--depth <n>] [-- <paths>...]`
	 * — updates registered submodules in the working tree, optionally
	 * initializing them (`options.init`), with an optional depth limit and
	 * scoped to `options.paths`.
	 */
	readonly submoduleUpdate: (
		cwd: string,
		options?: { readonly init?: boolean; readonly depth?: number; readonly paths?: ReadonlyArray<string> },
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
}

/**
 * Typed git introspection over core's `ChildProcessSpawner`: read a
 * repository's state at any ref without checking it out, plus the mutating
 * tier (`checkout`, `fetch`, `fetchAny`, `submoduleUpdate`, `submoduleAdd`,
 * `sparseCheckoutSet`, `configSet`, `add`) that changes it.
 *
 * @remarks
 * Every method takes `cwd` explicitly and classifies git's stderr/exit-code
 * taxonomy exactly once, in this module's private `classify` step — a
 * spawn-level `PlatformError` and `Cause.TimeoutError` never escape a `Git`
 * method; every failure surfaces as {@link GitCommandError},
 * {@link NotARepositoryError}, or {@link UnknownRefError}, or degrades to
 * the documented non-error (`Option.none`, `false`).
 *
 * Every method whose TSDoc opens "Mutating:" changes the working tree,
 * `HEAD`, the index, the repository config, the object database and
 * remote-tracking refs (`fetch`), or a submodule. None of it is
 * safe to run concurrently against the same `cwd`; nothing here serializes
 * that — a caller running two mutating calls (or a mutating call alongside a
 * read) against one `cwd` at once owns the race.
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
}
