import { Effect, Option } from "effect";
import type { CheckoutAuth } from "../../Checkout.js";
import { CheckoutRefNotFoundError } from "../../Checkout.js";

const TAGS_REF_SPEC = "+refs/tags/*:refs/tags/*";

const bothEmpty = (): never => {
	throw new Error("Args ref and commit cannot both be empty");
};

/**
 * Every refspec for fetching all history, as `getRefSpecForAllHistory` does.
 *
 * @internal
 */
export const refSpecForAllHistory = (ref: string, commit: string): ReadonlyArray<string> => {
	const result = ["+refs/heads/*:refs/remotes/origin/*", TAGS_REF_SPEC];
	if (ref && ref.toUpperCase().startsWith("REFS/PULL/")) {
		const branch = ref.substring("refs/pull/".length);
		result.push(`+${commit || ref}:refs/remotes/pull/${branch}`);
	}
	return result;
};

/**
 * The refspecs of the initial fetch, as `getRefSpec` does. Throws when `ref` and
 * `commit` are both empty, a programming error.
 *
 * @internal
 */
export const refSpec = (ref: string, commit: string, fetchTags: boolean): ReadonlyArray<string> => {
	if (!ref && !commit) {
		return bothEmpty();
	}
	const upperRef = (ref || "").toUpperCase();
	const result: Array<string> = [];

	if (fetchTags) {
		result.push(TAGS_REF_SPEC);
	}

	if (commit) {
		if (upperRef.startsWith("REFS/HEADS/")) {
			const branch = ref.substring("refs/heads/".length);
			result.push(`+${commit}:refs/remotes/origin/${branch}`);
		} else if (upperRef.startsWith("REFS/PULL/")) {
			const branch = ref.substring("refs/pull/".length);
			result.push(`+${commit}:refs/remotes/pull/${branch}`);
		} else if (upperRef.startsWith("REFS/TAGS/")) {
			if (!fetchTags) {
				result.push(`+${ref}:${ref}`);
			}
		} else {
			result.push(commit);
		}
	} else if (!upperRef.startsWith("REFS/")) {
		result.push(`+refs/heads/${ref}*:refs/remotes/origin/${ref}*`);
		if (!fetchTags) {
			result.push(`+refs/tags/${ref}*:refs/tags/${ref}*`);
		}
	} else if (upperRef.startsWith("REFS/HEADS/")) {
		const branch = ref.substring("refs/heads/".length);
		result.push(`+${ref}:refs/remotes/origin/${branch}`);
	} else if (upperRef.startsWith("REFS/PULL/")) {
		const branch = ref.substring("refs/pull/".length);
		result.push(`+${ref}:refs/remotes/pull/${branch}`);
	} else if (upperRef.startsWith("REFS/TAGS/")) {
		if (!fetchTags) {
			result.push(`+${ref}:${ref}`);
		}
	} else {
		result.push(`+${ref}:${ref}`);
	}

	return result;
};

/**
 * The git lookups {@link checkoutInfo} needs.
 *
 * @internal
 */
export interface CheckoutInfoLookup {
	readonly branchExists: (remoteName: string) => Effect.Effect<boolean>;
	readonly tagExists: (name: string) => Effect.Effect<boolean>;
}

/**
 * Where the working tree is checked out to, as `getCheckoutInfo` does.
 *
 * @remarks
 * `ref` and `commit` both empty is a programming error and dies, as checkout's
 * throw does.
 *
 * @internal
 */
export const checkoutInfo = (
	lookup: CheckoutInfoLookup,
	ref: string,
	commit: string,
): Effect.Effect<{ readonly ref: string; readonly startPoint: Option.Option<string> }, CheckoutRefNotFoundError> =>
	Effect.gen(function* () {
		if (!ref && !commit) {
			return yield* Effect.die(new Error("Args ref and commit cannot both be empty"));
		}
		const upperRef = (ref || "").toUpperCase();

		if (!ref) {
			return { ref: commit, startPoint: Option.none<string>() };
		}
		if (upperRef.startsWith("REFS/HEADS/")) {
			const branch = ref.substring("refs/heads/".length);
			return { ref: branch, startPoint: Option.some(`refs/remotes/origin/${branch}`) };
		}
		if (upperRef.startsWith("REFS/PULL/")) {
			const branch = ref.substring("refs/pull/".length);
			return { ref: `refs/remotes/pull/${branch}`, startPoint: Option.none<string>() };
		}
		if (upperRef.startsWith("REFS/TAGS/")) {
			return { ref, startPoint: Option.none<string>() };
		}
		if (upperRef.startsWith("REFS/")) {
			return { ref: commit ? commit : ref, startPoint: Option.none<string>() };
		}
		if (yield* lookup.branchExists(`origin/${ref}`)) {
			return { ref, startPoint: Option.some(`refs/remotes/origin/${ref}`) };
		}
		if (yield* lookup.tagExists(ref)) {
			return { ref: `refs/tags/${ref}`, startPoint: Option.none<string>() };
		}
		return yield* new CheckoutRefNotFoundError({ ref });
	});

/**
 * The git lookups {@link testRef} needs.
 *
 * @internal
 */
export interface TestRefLookup {
	readonly shaExists: (sha: string) => Effect.Effect<boolean>;
	readonly branchExists: (remoteName: string) => Effect.Effect<boolean>;
	readonly revParse: (ref: string) => Effect.Effect<string>;
	readonly tagExists: (name: string) => Effect.Effect<boolean>;
}

/**
 * Tests whether the initial fetch created the ref at the expected commit, as
 * `testRef` does.
 *
 * @internal
 */
export const testRef = (lookup: TestRefLookup, ref: string, commit: string): Effect.Effect<boolean> =>
	Effect.gen(function* () {
		if (!ref && !commit) {
			return yield* Effect.die(new Error("Args ref and commit cannot both be empty"));
		}
		if (!commit) {
			return true;
		}
		if (!ref) {
			return yield* lookup.shaExists(commit);
		}
		const upperRef = ref.toUpperCase();
		if (upperRef.startsWith("REFS/HEADS/")) {
			const branch = ref.substring("refs/heads/".length);
			return (
				(yield* lookup.branchExists(`origin/${branch}`)) &&
				commit === (yield* lookup.revParse(`refs/remotes/origin/${branch}`))
			);
		}
		if (upperRef.startsWith("REFS/PULL/")) {
			// Assume it matches: the fetch used the commit.
			return true;
		}
		if (upperRef.startsWith("REFS/TAGS/")) {
			const tagName = ref.substring("refs/tags/".length);
			// `^{commit}` dereferences an annotated tag to its commit.
			return (yield* lookup.tagExists(tagName)) && commit === (yield* lookup.revParse(`${ref}^{commit}`));
		}
		return true;
	});

/**
 * The `SCHEME://HOST[:PORT]` of a server URL.
 *
 * @internal
 */
export const serverOrigin = (serverUrl: string): string => new URL(serverUrl).origin;

/**
 * The remote URL a checkout fetches from, as `getFetchUrl` builds it.
 *
 * @internal
 */
export const fetchUrl = (settings: {
	readonly owner: string;
	readonly name: string;
	readonly serverUrl: string;
	readonly auth: CheckoutAuth;
}): string => {
	const service = new URL(settings.serverUrl);
	const owner = encodeURIComponent(settings.owner);
	const name = encodeURIComponent(settings.name);
	if (settings.auth._tag === "Ssh") {
		const user = settings.auth.user !== undefined && settings.auth.user.length > 0 ? settings.auth.user : "git";
		return `${user}@${service.hostname}:${owner}/${name}.git`;
	}
	return `${service.origin}/${owner}/${name}`;
};
