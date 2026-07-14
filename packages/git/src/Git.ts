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
 * produced an exit code at all.
 *
 * @public
 */
export class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()("GitCommandError", {
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
 * the exit-1-is-false degrade, `"generic"` enables neither.
 */
type ClassifyKind = "show" | "refExists" | "generic";

const NOT_A_REPOSITORY = "not a git repository";
// Unanchored substring matching against LC_ALL=C-pinned phrases: a path or ref
// name that happens to literally contain one of these phrases could misclassify.
// Accepted for now; anchoring is deliberately deferred until a real collision
// is observed.
const UNKNOWN_REF_PATTERNS = ["unknown revision", "bad revision", "Not a valid object name", "invalid object name"];
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
		const detail =
			outcome.reason._tag === "NotFound"
				? "git is not installed (or the working directory does not exist)"
				: `spawn failed: ${outcome.reason._tag}`;
		return { _tag: "failure", error: GitCommandError.make({ args, cwd, stderr: "", detail }) };
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
	if (kind === "show" && matchesAny(stderr, ABSENT_AT_REF_PATTERNS)) {
		return { _tag: "absent" };
	}
	if (kind === "refExists" && exitCode === 1) {
		return { _tag: "refMissing" };
	}
	return { _tag: "failure", error: GitCommandError.make({ args, cwd, exitCode, stderr }) };
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
					error: GitCommandError.make({ args, cwd, stderr: "", detail: "timed out after 30s" }),
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

/** Builds the `Git.Service` shape over an already-resolved `ChildProcessSpawner`. */
const make = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) => {
	const runFor = (command: ChildProcess.Command, cwd: string, kind: ClassifyKind) =>
		runClassified(command, cwd, kind).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

	const show = Effect.fn("Git.show")(function* (cwd: string, ref: string, path: string) {
		yield* Effect.annotateCurrentSpan({ cwd, ref, path });
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

	const lsTree = Effect.fn("Git.lsTree")(function* (cwd: string, ref: string) {
		yield* Effect.annotateCurrentSpan({ cwd, ref });
		const command = ChildProcess.setCwd(GitCommand.lsTree(ref), cwd);
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
		options: { readonly base: string; readonly head: string },
	) {
		yield* Effect.annotateCurrentSpan({ cwd, base: options.base, head: options.head });
		const command = ChildProcess.setCwd(GitCommand.changedFiles(options.base, options.head), cwd);
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

	const revParse = Effect.fn("Git.revParse")(function* (cwd: string, ref: string) {
		yield* Effect.annotateCurrentSpan({ cwd, ref });
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

	const checkout = Effect.fn("Git.checkout")(function* (cwd: string, ref: string) {
		yield* Effect.annotateCurrentSpan({ cwd, ref });
		const command = ChildProcess.setCwd(GitCommand.checkout(ref), cwd);
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

	return { show, lsTree, refExists, mergeBase, changedFiles, revParse, checkout };
};

/**
 * Typed git introspection over core's `ChildProcessSpawner`: read a
 * repository's state at any ref without checking it out, plus `checkout`,
 * the one mutating operation.
 *
 * @remarks
 * Every method takes `cwd` explicitly and classifies git's stderr/exit-code
 * taxonomy exactly once, in this module's private `classify` step — a
 * spawn-level `PlatformError` and `Cause.TimeoutError` never escape a `Git`
 * method; every failure surfaces as {@link GitCommandError},
 * {@link NotARepositoryError}, or {@link UnknownRefError}, or degrades to
 * the documented non-error (`Option.none`, `false`).
 *
 * @public
 */
export class Git extends Context.Service<
	Git,
	{
		/** `git show <ref>:<path>` — the contents of `path` at `ref`, or `Option.none` if absent there. */
		readonly show: (
			cwd: string,
			ref: string,
			path: string,
		) => Effect.Effect<Option.Option<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
		/** `git ls-tree -r -z <ref>` — every path in the tree at `ref`, recursively. */
		readonly lsTree: (
			cwd: string,
			ref: string,
		) => Effect.Effect<ReadonlyArray<LsTreeEntry>, GitCommandError | NotARepositoryError | UnknownRefError>;
		/** `git cat-file -e <ref>` — whether `ref` resolves to an existing object. */
		readonly refExists: (cwd: string, ref: string) => Effect.Effect<boolean, GitCommandError | NotARepositoryError>;
		/** `git merge-base <a> <b>` — the best common ancestor commit, trimmed. */
		readonly mergeBase: (
			cwd: string,
			a: string,
			b: string,
		) => Effect.Effect<string, GitCommandError | NotARepositoryError | UnknownRefError>;
		/** `git diff --name-only -z <base>...<head>` — the paths that differ. */
		readonly changedFiles: (
			cwd: string,
			options: { readonly base: string; readonly head: string },
		) => Effect.Effect<ReadonlyArray<string>, GitCommandError | NotARepositoryError | UnknownRefError>;
		/** `git rev-parse --verify <ref>` — resolves `ref` to its full object id, trimmed. */
		readonly revParse: (
			cwd: string,
			ref: string,
		) => Effect.Effect<string, GitCommandError | NotARepositoryError | UnknownRefError>;
		/**
		 * `git checkout <ref>` — the one mutating operation in this package.
		 * Real git reports an unknown ref to checkout as a pathspec error, which
		 * classifies as `GitCommandError` rather than `UnknownRefError`; the
		 * `UnknownRefError` arm remains declared for the stderr shapes that do match.
		 */
		readonly checkout: (
			cwd: string,
			ref: string,
		) => Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError>;
	}
>()("@effected/git/Git") {
	/** Resolves `ChildProcessSpawner` once, at construction — every method's `R` is `never`. */
	static readonly layer: Layer.Layer<Git, never, ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
		this,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			return make(spawner);
		}),
	);
}
