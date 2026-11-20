import { Effect } from "effect";
import { CheckoutUnsafePullRequestError } from "../../Checkout.js";

const PR_REF_PATTERN = /^refs\/pull\/[0-9]+\/(?:head|merge)$/;

/**
 * Reads a dotted path out of an unknown JSON payload, tolerating any shape.
 *
 * @internal
 */
export const fromPayload = (payload: unknown, path: string): unknown => {
	let current: unknown = payload;
	for (const key of path.split(".")) {
		if (current === null || current === undefined || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return current;
};

const pushIfSha = (target: Array<string>, value: unknown): void => {
	if (typeof value === "string" && value.length > 0) {
		target.push(value.toLowerCase());
	}
};

/**
 * Refuses to check out fork pull request code from a privileged event, as
 * `assertSafePrCheckout` of the stock checkout action does.
 *
 * @internal
 */
export const assertSafePullRequest = (
	input: {
		readonly repository: string;
		readonly ref: string;
		readonly commit: string | undefined;
		readonly allowUnsafe: boolean;
	},
	event: { readonly name: string; readonly payload: unknown },
): Effect.Effect<void, CheckoutUnsafePullRequestError> => {
	if (input.allowUnsafe) {
		return Effect.void;
	}
	const eventName = event.name;
	if (eventName !== "pull_request_target" && eventName !== "workflow_run") {
		return Effect.void;
	}
	const baseRepoId = fromPayload(event.payload, "repository.id");
	if (typeof baseRepoId !== "number") {
		return Effect.void;
	}

	let prHeadRepoId: unknown;
	let prHeadRepoFullName: unknown;
	const prShas: Array<string> = [];

	if (eventName === "pull_request_target") {
		prHeadRepoId = fromPayload(event.payload, "pull_request.head.repo.id");
		prHeadRepoFullName = fromPayload(event.payload, "pull_request.head.repo.full_name");
		pushIfSha(prShas, fromPayload(event.payload, "pull_request.head.sha"));
		pushIfSha(prShas, fromPayload(event.payload, "pull_request.merge_commit_sha"));
	} else {
		const wrEvent = fromPayload(event.payload, "workflow_run.event");
		if (typeof wrEvent !== "string" || !wrEvent.startsWith("pull_request")) {
			return Effect.void;
		}
		prHeadRepoId = fromPayload(event.payload, "workflow_run.head_repository.id");
		prHeadRepoFullName = fromPayload(event.payload, "workflow_run.head_repository.full_name");
		pushIfSha(prShas, fromPayload(event.payload, "workflow_run.head_commit.id"));
		// For a `pull_request_target`-triggered workflow_run, `head_sha` is the base
		// default branch SHA, not the PR head.
		if (wrEvent !== "pull_request_target") {
			pushIfSha(prShas, fromPayload(event.payload, "workflow_run.head_sha"));
		}
	}

	// (A) Fork PR?
	if (typeof prHeadRepoId !== "number" || prHeadRepoId === baseRepoId) {
		return Effect.void;
	}

	// (B) Not every fork PR ref can be recognised, so check whether the resolved
	// input points at the fork PR the payload describes.
	const repositoryMatchesPrHead =
		typeof prHeadRepoFullName === "string" && input.repository.toLowerCase() === prHeadRepoFullName.toLowerCase();
	const refMatchesPullPattern = PR_REF_PATTERN.test(input.ref);
	const commitMatchesPrHeadSha = !!input.commit && prShas.includes(input.commit.toLowerCase());

	if (!repositoryMatchesPrHead && !refMatchesPullPattern && !commitMatchesPrHeadSha) {
		return Effect.void;
	}

	return Effect.fail(
		new CheckoutUnsafePullRequestError({ event: eventName, repository: input.repository, ref: input.ref }),
	);
};
