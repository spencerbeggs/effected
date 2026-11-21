import { Effect, Option, Path } from "effect";
import type { GitHubContext } from "../../ActionEnvironment.js";
import type { CheckoutAuth, CheckoutOptions, CheckoutRef, CheckoutUnsafePullRequestError } from "../../Checkout.js";
import { CheckoutPathError } from "../../Checkout.js";
import { asciiTrim } from "./asciiTrim.js";
import { assertSafePullRequest } from "./unsafePullRequest.js";

/**
 * A checkout's fully resolved settings: checkout's `IGitSourceSettings` in the
 * fields this port uses.
 *
 * @internal
 */
export interface Settings {
	readonly owner: string;
	readonly name: string;
	/** The absolute directory checked out into. */
	readonly path: string;
	/** The ref to fetch, `""` for a bare commit or the default branch. */
	readonly ref: string;
	/** The pinned commit, `""` for none. */
	readonly commit: string;
	readonly isWorkflowRepository: boolean;
	readonly clean: boolean;
	/** The fetch depth, `0` for all history. */
	readonly depth: number;
	readonly fetchTags: boolean;
	readonly filter: Option.Option<string>;
	readonly sparse: Option.Option<{ readonly patterns: ReadonlyArray<string>; readonly cone: boolean }>;
	readonly lfs: boolean;
	readonly submodules: boolean;
	readonly nestedSubmodules: boolean;
	readonly auth: CheckoutAuth;
	readonly credentials: "job" | "action" | "none";
	readonly safeDirectory: boolean;
	readonly serverUrl: string;
	readonly remoteUrl: Option.Option<string>;
	readonly allowUnsafePrCheckout: boolean;
	readonly stateKey: string;
}

const SHA_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

const lowerRef = (ref: CheckoutRef, context: GitHubContext): { readonly ref: string; readonly commit: string } => {
	switch (ref._tag) {
		case "Event": {
			const commit = context.sha;
			// Some events carry an unqualified ref: a merged pull request's is `main`.
			const eventRef =
				commit && context.ref && !context.ref.startsWith("refs/") ? `refs/heads/${context.ref}` : context.ref;
			return { ref: eventRef, commit };
		}
		case "Default":
			return { ref: "", commit: "" };
		case "Branch":
			return { ref: `refs/heads/${ref.name}`, commit: ref.commit ?? "" };
		case "Tag":
			return { ref: `refs/tags/${ref.name}`, commit: ref.commit ?? "" };
		case "Commit":
			return { ref: "", commit: ref.sha };
		case "PullRequest":
			return { ref: `refs/pull/${ref.number}/${ref.kind}`, commit: ref.commit ?? "" };
		case "Ref": {
			const trimmed = asciiTrim(ref.ref);
			if (SHA_PATTERN.test(trimmed)) {
				return { ref: "", commit: trimmed };
			}
			return { ref: ref.ref, commit: ref.commit ?? "" };
		}
	}
};

/**
 * Resolves {@link CheckoutOptions} into {@link Settings}, as checkout's
 * `getInputs` does.
 *
 * @remarks
 * Pure: the workflow's context, workspace and event payload come in as
 * arguments. Fails when the path leaves the workspace, or when a privileged
 * event would check out fork pull request code. The guard is skipped only for
 * the default self-checkout: the workflow's own repository at `Event`.
 *
 * @internal
 */
export const lower = (
	options: CheckoutOptions,
	context: { readonly github: GitHubContext; readonly workspace: string; readonly payload: unknown },
): Effect.Effect<Settings, CheckoutPathError | CheckoutUnsafePullRequestError, Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const workspace = path.resolve(context.workspace);

		const owner = options.repository?.owner ?? context.github.repositoryOwner;
		const name =
			options.repository?.name ?? context.github.repository.slice(context.github.repository.indexOf("/") + 1);
		const qualified = `${owner}/${name}`;

		const repositoryPath = path.resolve(workspace, options.path ?? ".");
		if (!(repositoryPath + path.sep).startsWith(workspace + path.sep)) {
			return yield* new CheckoutPathError({ path: options.path ?? ".", workspace });
		}

		const isWorkflowRepository = qualified.toUpperCase() === context.github.repository.toUpperCase();
		const refOption: CheckoutRef = options.ref ?? (isWorkflowRepository ? { _tag: "Event" } : { _tag: "Default" });
		const { ref, commit } = lowerRef(refOption, context.github);

		const allowUnsafePrCheckout = options.allowUnsafePrCheckout ?? false;
		const isDefaultCheckout = isWorkflowRepository && refOption._tag === "Event";
		if (!isDefaultCheckout) {
			yield* assertSafePullRequest(
				{ repository: qualified, ref, commit, allowUnsafe: allowUnsafePrCheckout },
				{ name: context.github.eventName, payload: context.payload },
			);
		}

		const rawDepth = options.depth ?? 1;
		const depth = rawDepth === "full" ? 0 : Math.floor(rawDepth);
		const submodules = options.submodules ?? false;

		return {
			owner,
			name,
			path: repositoryPath,
			ref,
			commit,
			isWorkflowRepository,
			clean: options.clean ?? true,
			depth: Number.isNaN(depth) || depth < 0 ? 0 : depth,
			fetchTags: options.fetchTags ?? false,
			filter: Option.fromNullishOr(options.filter),
			sparse: Option.map(Option.fromNullishOr(options.sparse), (s) => ({
				patterns: s.patterns,
				cone: s.cone ?? true,
			})),
			lfs: options.lfs ?? false,
			submodules: submodules !== false,
			nestedSubmodules: submodules === "recursive",
			auth: options.auth,
			credentials: options.credentials ?? "job",
			safeDirectory: options.safeDirectory ?? true,
			serverUrl: options.serverUrl ?? context.github.serverUrl,
			remoteUrl: Option.fromNullishOr(options.remoteUrl),
			allowUnsafePrCheckout,
			stateKey: options.stateKey ?? "effected-checkout",
		};
	});
