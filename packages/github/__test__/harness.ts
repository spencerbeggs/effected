import type { Exit } from "effect";
import { Cause, Layer, Redacted } from "effect";
import { GitHubClient } from "../src/GitHubClient.js";
import { Repo, RepoRef } from "../src/Repo.js";
import { RetryPolicy } from "../src/Resilience.js";
import type { Reply, ScriptedFetch } from "./fixtures.js";
import { scriptedFetch } from "./fixtures.js";

/**
 * The message of the defect `exit` died with, or `undefined` when it did not
 * die: the one assertion an unstubbed `makeTest` member owes a test.
 */
export const defectMessage = <A, E>(exit: Exit.Exit<A, E>): string | undefined => {
	if (exit._tag !== "Failure") return undefined;
	const die = exit.cause.reasons.find(Cause.isDieReason);
	return die === undefined ? undefined : String((die.defect as { message?: unknown }).message ?? die.defect);
};

/** The repository every resource test acts on. */
export const REPO = RepoRef.make({ owner: "acme", repo: "widget" });

export interface Harness {
	/** What the scripted transport recorded. */
	readonly script: ScriptedFetch;
	/** A live client over that transport, plus the repository coordinate. */
	readonly base: Layer.Layer<GitHubClient | Repo>;
}

/**
 * A live client over scripted HTTP, plus a repository.
 *
 * @remarks
 * Resource tests drive the **real** client — real route interpolation, real
 * classification, real pagination — rather than a double of it. A stubbed client
 * would let a resource request the wrong route, send the wrong body or
 * mis-handle a 404 and still pass, which is most of what a resource can get
 * wrong.
 */
export const harness = (replies: ReadonlyArray<Reply>, options: { readonly apiVersion?: string } = {}): Harness => {
	const script = scriptedFetch(replies);
	const base = Layer.mergeAll(
		GitHubClient.layerFromToken({
			token: Redacted.make("ghs_test"),
			fetch: script.fetch,
			retry: RetryPolicy.none,
			...(options.apiVersion !== undefined ? { apiVersion: options.apiVersion } : {}),
		}),
		Repo.layer(REPO),
	);
	return { script, base };
};
