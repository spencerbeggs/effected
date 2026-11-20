import type { GitCommandError, NotARepositoryError, UnknownRefError } from "@effected/git";
import { Git } from "@effected/git";
import type { FileSystem, Path, PlatformError, Scope } from "effect";
import { Effect, Option, Schema } from "effect";
import type { SecureRandom } from "effect/crypto";
import type { ChildProcessSpawner } from "effect/process";
import type { ActionEnvironment, ActionEnvironmentError } from "./ActionEnvironment.js";
import type { ActionLogger } from "./ActionLogger.js";
import type { ActionOutputs } from "./ActionOutputs.js";
import type { ActionStateError } from "./ActionState.js";
import { ActionState } from "./ActionState.js";
import { CredentialRecord, remove } from "./internal/checkout/credentials.js";
import { getSource } from "./internal/checkout/source.js";

const Sha = Schema.String;

/**
 * What to check out: a tagged union naming the ref the working tree lands on.
 *
 * @remarks
 * `Event` is the workflow's own `GITHUB_REF` at `GITHUB_SHA`; `Default` is the
 * repository's default branch. `Ref` takes a raw ref exactly as the `ref` input
 * of the stock checkout action does. Every member that names something movable
 * may pin it with `commit`.
 *
 * @public
 */
export const CheckoutRef = Schema.TaggedUnion({
	Event: {},
	Default: {},
	Branch: { name: Schema.String, commit: Schema.optionalKey(Sha) },
	Tag: { name: Schema.String, commit: Schema.optionalKey(Sha) },
	Commit: { sha: Sha },
	PullRequest: {
		number: Schema.Number,
		kind: Schema.Literals(["merge", "head"]),
		commit: Schema.optionalKey(Sha),
	},
	Ref: { ref: Schema.String, commit: Schema.optionalKey(Sha) },
});

/**
 * The ref a checkout lands on.
 *
 * @public
 */
export type CheckoutRef = typeof CheckoutRef.Type;

/**
 * How a checkout authenticates: a token, or an SSH key.
 *
 * @remarks
 * `Ssh` defaults `strict` to `true` and `user` to `"git"`. Its optional `token`
 * still serves the API calls, as the stock checkout's does. Every secret is a
 * `Redacted<string>`.
 *
 * @public
 */
export const CheckoutAuth = Schema.TaggedUnion({
	Token: { token: Schema.Redacted(Schema.String) },
	Ssh: {
		key: Schema.Redacted(Schema.String),
		knownHosts: Schema.optionalKey(Schema.String),
		strict: Schema.optionalKey(Schema.Boolean),
		user: Schema.optionalKey(Schema.String),
		token: Schema.optionalKey(Schema.Redacted(Schema.String)),
	},
});

/**
 * How a checkout authenticates.
 *
 * @public
 */
export type CheckoutAuth = typeof CheckoutAuth.Type;

/**
 * Everything {@link Checkout.checkout} accepts.
 *
 * @remarks
 * Defaults: `ref` is `Event` when `repository` is the workflow's own
 * (case-insensitive), else `Default`; `path` `"."`; `credentials` `"job"`;
 * `clean` true; `depth` 1; `fetchTags` false; `sparse.cone` true; `lfs` false;
 * `submodules` false; `safeDirectory` true; `serverUrl` the runner's
 * `GITHUB_SERVER_URL` or `https://github.com`; `stateKey` `"effected-checkout"`.
 *
 * @public
 */
export interface CheckoutOptions {
	/** The repository to check out; the workflow's own when omitted. */
	readonly repository?: { readonly owner: string; readonly name: string };
	/** What to check out. */
	readonly ref?: CheckoutRef;
	/** The directory to check out into, relative to the workspace. */
	readonly path?: string;
	/** How to authenticate. */
	readonly auth: CheckoutAuth;
	/** Where the credential lives afterwards: for the job, for the action's own run, or nowhere. */
	readonly credentials?: "job" | "action" | "none";
	/** Whether to clean the target directory first. */
	readonly clean?: boolean;
	/** The fetch depth, or `"full"` for all history. */
	readonly depth?: number | "full";
	/** Whether to fetch tags. */
	readonly fetchTags?: boolean;
	/** A partial-clone filter, such as `blob:none`. */
	readonly filter?: string;
	/** A sparse checkout. */
	readonly sparse?: { readonly patterns: ReadonlyArray<string>; readonly cone?: boolean };
	/** Whether to fetch Git LFS objects. */
	readonly lfs?: boolean;
	/** Whether to check out submodules, and whether recursively. */
	readonly submodules?: boolean | "recursive";
	/** Whether to mark the checkout a git `safe.directory`. */
	readonly safeDirectory?: boolean;
	/** The GitHub server URL. */
	readonly serverUrl?: string;
	/** The remote URL to use instead of one derived from `serverUrl` and `repository`. */
	readonly remoteUrl?: string;
	/** Permits checking out fork pull request code from a privileged event. */
	readonly allowUnsafePrCheckout?: boolean;
	/** The state key the cleanup phase reads back. */
	readonly stateKey?: string;
}

/**
 * What a checkout resolved to.
 *
 * @remarks
 * `ref` is the resolved ref, as the `ref` output of the stock checkout action
 * is: `""` for a bare commit.
 *
 * @public
 */
export class CheckoutResult extends Schema.Class<CheckoutResult>("CheckoutResult")({
	/** The resolved ref, or `""` for a bare commit. */
	ref: Schema.String,
	/** The commit now checked out. */
	commit: Schema.String,
	/** The directory checked out into. */
	path: Schema.String,
	/** The repository checked out. */
	repository: Schema.Struct({ owner: Schema.String, name: Schema.String }),
}) {}

/**
 * Raised when the runner's git is older than the floor.
 *
 * @public
 */
export class CheckoutGitTooOldError extends Schema.TaggedError<CheckoutGitTooOldError>()("CheckoutGitTooOldError", {
	/** The git version found. */
	found: Schema.String,
	/** The oldest git version supported. */
	required: Schema.String,
}) {
	override get message(): string {
		return `git ${this.found} is older than the ${this.required} a checkout requires`;
	}
}

/**
 * Raised when a privileged event would check out fork pull request code.
 *
 * @public
 */
export class CheckoutUnsafePullRequestError extends Schema.TaggedError<CheckoutUnsafePullRequestError>()(
	"CheckoutUnsafePullRequestError",
	{
		/** The triggering event, such as `pull_request_target`. */
		event: Schema.String,
		/** The repository being checked out. */
		repository: Schema.String,
		/** The ref being checked out. */
		ref: Schema.String,
	},
) {
	override get message(): string {
		return (
			`Refusing to check out fork pull request code from a '${this.event}' workflow. ` +
			`This workflow runs with the base repository's GITHUB_TOKEN, secrets, default-branch ` +
			`cache scope, and runner access. Fetching and executing a fork's code in that trusted ` +
			`context commonly leads to "pwn request" vulnerabilities. To opt in, review the risks ` +
			`at https://gh.io/securely-using-pull_request_target and set 'allow-unsafe-pr-checkout: true' ` +
			`on the checkout.`
		);
	}
}

/**
 * Raised when the requested ref does not exist on the remote.
 *
 * @public
 */
export class CheckoutRefNotFoundError extends Schema.TaggedError<CheckoutRefNotFoundError>()(
	"CheckoutRefNotFoundError",
	{
		/** The ref that was not found. */
		ref: Schema.String,
	},
) {
	override get message(): string {
		return `The ref "${this.ref}" was not found on the remote`;
	}
}

/**
 * Raised when a ref resolved to a different commit than the one pinned.
 *
 * @public
 */
export class CheckoutCommitMismatchError extends Schema.TaggedError<CheckoutCommitMismatchError>()(
	"CheckoutCommitMismatchError",
	{
		/** The ref that was fetched. */
		ref: Schema.String,
		/** The commit the caller pinned. */
		expected: Schema.String,
	},
) {
	override get message(): string {
		return `The ref "${this.ref}" did not resolve to the pinned commit ${this.expected}`;
	}
}

/**
 * Raised when the credentials were refused.
 *
 * @public
 */
export class CheckoutAuthError extends Schema.TaggedError<CheckoutAuthError>()("CheckoutAuthError", {
	/** The repository being accessed. */
	repository: Schema.String,
	/** What went wrong, with no secret in it. */
	detail: Schema.String,
}) {
	override get message(): string {
		return `Authentication to ${this.repository} failed: ${this.detail}`;
	}
}

/**
 * Raised when the target path escapes the workspace.
 *
 * @public
 */
export class CheckoutPathError extends Schema.TaggedError<CheckoutPathError>()("CheckoutPathError", {
	/** The path requested. */
	path: Schema.String,
	/** The workspace it must stay within. */
	workspace: Schema.String,
}) {
	override get message(): string {
		return `The checkout path "${this.path}" is outside the workspace "${this.workspace}"`;
	}
}

/**
 * Raised when the repository's default branch could not be determined.
 *
 * @public
 */
export class CheckoutDefaultBranchError extends Schema.TaggedError<CheckoutDefaultBranchError>()(
	"CheckoutDefaultBranchError",
	{
		/** The repository whose default branch is unknown. */
		repository: Schema.String,
	},
) {
	override get message(): string {
		return `Could not determine the default branch of ${this.repository}`;
	}
}

/**
 * Anything that can go wrong checking out a repository.
 *
 * @remarks
 * One class per failure, so each member carries exactly the fields its own
 * message needs and `Effect.catchTag` recovers from one without catching the
 * others.
 *
 * @public
 */
export type CheckoutError =
	| CheckoutGitTooOldError
	| CheckoutUnsafePullRequestError
	| CheckoutRefNotFoundError
	| CheckoutCommitMismatchError
	| CheckoutAuthError
	| CheckoutPathError
	| CheckoutDefaultBranchError;

/**
 * Checks a repository out the way the stock checkout action does, on `@effected/git`.
 *
 * @public
 */
export class Checkout {
	/**
	 * Checks a repository out, in the stock checkout action's order: version
	 * check, unsafe pull request guard, directory preparation, `init`, auth,
	 * default branch, one fetch, ref verification, LFS, sparse set, checkout,
	 * submodules.
	 *
	 * @remarks
	 * Requires git 2.39.0 or later and fails {@link CheckoutGitTooOldError}
	 * before any other git runs. Every secret is masked first.
	 *
	 * An existing repository of the same remote is reused (lock files removed,
	 * `HEAD` detached, local and conflicting remote-tracking branches deleted,
	 * and with `clean` a `clean -ffdx` and `reset --hard HEAD`); any other
	 * directory has its contents deleted. The fetch, the default branch lookup
	 * and the LFS fetch are retried, as the stock action retries them, and the
	 * network steps run under a 30 minute ceiling.
	 *
	 * The credentials' lifetime is `options.credentials`: `"job"` saves what
	 * was written under `stateKey` before any fetch, for {@link Checkout.cleanup}
	 * in the post step; `"action"` removes it when the enclosing `Scope`
	 * closes, on success, failure or interruption; `"none"` removes it before
	 * this returns. The temporary global config holding `safe.directory` is
	 * discarded when this returns, whatever the lifetime.
	 *
	 * The log is one phase, `Checkout <owner>/<name> @ <ref>`, with one step
	 * per phase of work; each step's detail is the git transcript. The
	 * repository's object format and default branch come from the GitHub API:
	 * through the ambient `GitHubClient` when one is provided, else a client
	 * built from the checkout's own token.
	 */
	static readonly checkout = (
		options: CheckoutOptions,
	): Effect.Effect<
		CheckoutResult,
		| CheckoutError
		| GitCommandError
		| NotARepositoryError
		| UnknownRefError
		| ActionStateError
		| ActionEnvironmentError
		| PlatformError.PlatformError,
		| Scope.Scope
		| Git
		| FileSystem.FileSystem
		| Path.Path
		| ChildProcessSpawner.ChildProcessSpawner
		| SecureRandom.SecureRandom
		| ActionEnvironment
		| ActionOutputs
		| ActionState
		| ActionLogger
	> => getSource(options);

	/**
	 * Runs the post-step cleanup of a `"job"` checkout: reads the record saved
	 * under `stateKey` and removes everything the checkout wrote.
	 *
	 * @remarks
	 * No saved record is a no-op. Removal covers the credentials file, the SSH
	 * files, `includeIf`, the extraheader, `core.sshCommand` and the submodules'
	 * `insteadOf`, with `safe.directory` handled for the repository as the stock
	 * post step does. It never fails: every failure, an unreadable record
	 * included, becomes a warning, so a post step cannot turn a green job red.
	 */
	static readonly cleanup = (options?: {
		readonly stateKey?: string;
	}): Effect.Effect<
		void,
		never,
		| Git
		| FileSystem.FileSystem
		| Path.Path
		| ChildProcessSpawner.ChildProcessSpawner
		| SecureRandom.SecureRandom
		| ActionEnvironment
		| ActionState
		| ActionLogger
	> =>
		Effect.gen(function* () {
			const state = yield* ActionState;
			const git = yield* Git;
			const record = yield* state.getOptional(options?.stateKey ?? "effected-checkout", CredentialRecord);
			if (Option.isSome(record)) yield* remove(record.value, git);
		}).pipe(
			Effect.catch((error) => Effect.logWarning(`Checkout cleanup failed: ${error.message}`)),
			Effect.catchDefect((defect) => Effect.logWarning(`Checkout cleanup failed: ${String(defect)}`)),
		);

	/** Reads {@link CheckoutOptions} from the action's inputs. Not yet implemented. */
	static readonly fromInputs = (): Effect.Effect<CheckoutOptions> => Effect.die("not implemented");

	/** Declares the action inputs a checkout reads. Not yet implemented. */
	static readonly inputs = (): Effect.Effect<ReadonlyArray<string>> => Effect.die("not implemented");

	/** Publishes a {@link CheckoutResult} as step outputs. Not yet implemented. */
	static readonly writeOutputs = (_result: CheckoutResult): Effect.Effect<void> => Effect.die("not implemented");
}
