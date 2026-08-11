import { Schema } from "effect";
import { headerNumber, headerString, retryAfterMillisFrom } from "./internal/headers.js";

/**
 * Why a GitHub call failed, as a value you can branch on.
 *
 * @remarks
 * This discriminant is what replaces string-matching an error message. The
 * package this replaces carried a free-form `reason` string and nothing else
 * structural, so consumers grepped it: one repo lowercased a GraphQL message and
 * tested `includes("already") || includes("exists")`, and another re-issued an
 * existence check after every failed branch creation because it could not tell
 * "someone else created it" from "that failed".
 *
 * @public
 */
export const GitHubErrorKind = Schema.Literals([
	/** The resource is not there (404). Often not an error at all — see the `*Option` reads. */
	"notFound",
	/** The resource already exists (422/409 saying so). What makes `upsert` implementable. */
	"alreadyExists",
	/** GitHub understood and refused: validation, policy, conflict. */
	"rejected",
	/** Credentials are missing, wrong, or lack the required scope. */
	"unauthorized",
	/** A rate limit — primary or secondary. Retryable, usually with a server-advised delay. */
	"rateLimited",
	/** The request never got a usable answer: 5xx, a network failure, an abort. Retryable. */
	"transport",
	/** A response arrived but did not match the schema it was decoded against. */
	"decode",
]);

/**
 * Every REST failure this package produces, from every resource.
 *
 * @remarks
 * One error class, not one per resource. Across the six repos surveyed for this
 * port, consumers read `reason` about forty times, `status` twice, `operation`
 * twice, and matched a resource-specific `_tag` exactly **once** — at a call
 * site that disappears entirely now that `GitBranch.upsert` exists. Eighteen
 * near-identical error classes and thirteen near-identical mapper closures
 * bought that one match.
 *
 * What replaces them is {@link GitHubErrorKind} for routing and `operation` for
 * identification. This mirrors `@effected/git`, where the rule is that no
 * consumer ever string-matches stderr because classification happens once.
 *
 * @public
 */
export class GitHubError extends Schema.TaggedError<GitHubError>()("GitHubError", {
	/** Structural routing. Branch on this, never on the rendered message. */
	kind: GitHubErrorKind,
	/** What was attempted: a resource method (`"GitBranch.upsert"`) or a raw route. */
	operation: Schema.String,
	/** Human-readable cause, for logs and messages. Never a routing surface. */
	reason: Schema.String,
	/** GitHub's HTTP status, when the request reached GitHub at all. */
	status: Schema.optionalKey(Schema.Int),
	/**
	 * A server-advised delay before retrying, in milliseconds.
	 *
	 * @remarks
	 * Written by the client from `retry-after` or the rate-limit reset, and read
	 * by exactly one thing: the retry `Schedule`. It is a policy input, not
	 * information for a caller — which is why it is optional and why the
	 * `retryable` boolean it used to travel with is now a derived getter.
	 */
	retryAfterMillis: Schema.optionalKey(Schema.Int),
	/** The underlying throwable, when one exists. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	/** `"GitBranch.upsert failed (422): Reference already exists"`. */
	override get message(): string {
		return this.status === undefined
			? `${this.operation} failed: ${this.reason}`
			: `${this.operation} failed (${this.status}): ${this.reason}`;
	}

	/**
	 * Whether retrying could plausibly succeed.
	 *
	 * @remarks
	 * Derived from `kind` rather than stored. A 404 or a
	 * validation rejection will fail identically on every attempt; only a
	 * transport failure or a rate limit can change its mind.
	 */
	get retryable(): boolean {
		return this.kind === "transport" || this.kind === "rateLimited";
	}

	/** The requested thing is not there. */
	static notFound(operation: string, subject: string): GitHubError {
		return new GitHubError({ kind: "notFound", operation, reason: `${subject} not found`, status: 404 });
	}

	/** The thing you asked to create is already there. */
	static alreadyExists(operation: string, subject: string): GitHubError {
		return new GitHubError({
			kind: "alreadyExists",
			operation,
			reason: `${subject} already exists`,
			status: 422,
		});
	}

	/** GitHub understood the request and refused it. */
	static rejected(operation: string, status: number, reason: string): GitHubError {
		return new GitHubError({ kind: "rejected", operation, reason, status });
	}

	/** A response did not match the schema it was decoded against. */
	static decode(operation: string, reason: string, cause?: unknown): GitHubError {
		return new GitHubError({
			kind: "decode",
			operation,
			reason,
			...(cause !== undefined ? { cause } : {}),
		});
	}

	/**
	 * Classify anything octokit threw.
	 *
	 * @remarks
	 * The single classification step for the whole package — every resource
	 * method's failures come through here, so the taxonomy cannot drift between
	 * resources the way thirteen hand-written mapper closures did.
	 *
	 * `nowMillis` is passed in rather than read from the wall clock so the
	 * function stays pure and total: the rate-limit reset header is an absolute
	 * epoch second, and turning it into a delay needs a "now" the caller controls.
	 * The client supplies `Clock.currentTimeMillis`, which is the `TestClock`
	 * under test.
	 */
	static fromOctokit(operation: string, error: unknown, nowMillis: number): GitHubError {
		const facts = readThrowable(error);
		const retryAfterMillis = retryAfterMillisFrom(facts.headers, nowMillis);
		const kind = classify(facts, retryAfterMillis);
		return new GitHubError({
			kind,
			operation,
			reason: facts.reason,
			...(facts.status !== undefined ? { status: facts.status } : {}),
			...(retryAfterMillis !== undefined ? { retryAfterMillis } : {}),
			cause: error,
		});
	}

	/**
	 * A predicate over one or more kinds, for `Effect.catchIf`.
	 *
	 * @example
	 * ```ts
	 * import { GitHubError } from "@effected/github";
	 * import { Effect } from "effect";
	 *
	 * declare const read: Effect.Effect<string, GitHubError>;
	 *
	 * const orDefault = read.pipe(
	 *   Effect.catchIf(GitHubError.hasKind("notFound"), () => Effect.succeed("")),
	 * );
	 * ```
	 */
	static hasKind(...kinds: ReadonlyArray<(typeof GitHubErrorKind.literals)[number]>): (error: GitHubError) => boolean {
		const set = new Set<string>(kinds);
		return (error) => set.has(error.kind);
	}
}

/** What classification needs out of an unknown throwable. */
interface Throwable {
	readonly status: number | undefined;
	readonly headers: Readonly<Record<string, unknown>> | undefined;
	readonly reason: string;
	readonly detailMessages: ReadonlyArray<string>;
}

/**
 * Read an unknown throwable structurally.
 *
 * @remarks
 * Deliberately structural rather than `instanceof RequestError`:
 * `@octokit/request-error` is a transitive dependency this package does not
 * declare, and importing a package you did not declare is how a peer closure
 * rots. The shape it throws — `{ status, response: { headers, data } }` — is
 * stable and public.
 */
const readThrowable = (error: unknown): Throwable => {
	if (typeof error !== "object" || error === null) {
		return { status: undefined, headers: undefined, reason: String(error), detailMessages: [] };
	}
	const record = error as Record<string, unknown>;
	const response = asRecord(record.response);
	const headers = asRecord(response?.headers);
	const data = asRecord(response?.data);
	return {
		status: typeof record.status === "number" ? record.status : undefined,
		headers,
		reason: sanitizeReason(typeof record.message === "string" ? record.message : String(error)),
		detailMessages: readDetailMessages(data),
	};
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

/**
 * GitHub answers some requests with an HTML error page whose body becomes a
 * multi-kilobyte "message".
 *
 * @remarks
 * The package this replaces detected the "Unicorn" page specifically; this is
 * the general form — an HTML body is never a useful reason string, and letting
 * one through means a log line with a whole web page in it.
 */
const sanitizeReason = (message: string): string => {
	const trimmed = message.trim();
	if (trimmed.startsWith("<") || trimmed.length > MAX_REASON_LENGTH) {
		return trimmed.startsWith("<")
			? "GitHub returned an HTML error page instead of a JSON response"
			: `${trimmed.slice(0, MAX_REASON_LENGTH)}…`;
	}
	return trimmed;
};

const MAX_REASON_LENGTH = 500;

/** GitHub's validation failures arrive as `data.errors[].message`. */
const readDetailMessages = (data: Record<string, unknown> | undefined): ReadonlyArray<string> => {
	const errors = data?.errors;
	if (!Array.isArray(errors)) return [];
	const messages: Array<string> = [];
	for (const entry of errors) {
		const message = asRecord(entry)?.message;
		if (typeof message === "string") messages.push(message);
	}
	return messages;
};

const ALREADY_EXISTS = "already exists";

const classify = (
	facts: Throwable,
	retryAfterMillis: number | undefined,
): (typeof GitHubErrorKind.literals)[number] => {
	const { status } = facts;
	if (status === undefined) return "transport";
	if (status === 404) return "notFound";
	if (status >= 500) return "transport";
	if (status === 429) return "rateLimited";
	if (status === 403) {
		// A 403 is GitHub's answer to BOTH "you may not" and "you have asked too
		// often". Only the headers tell them apart: an exhausted budget carries a
		// zeroed remaining count or an explicit delay.
		return retryAfterMillis !== undefined ? "rateLimited" : "unauthorized";
	}
	if (status === 401) return "unauthorized";
	if (status === 422 || status === 409) {
		return saysAlreadyExists(facts) ? "alreadyExists" : "rejected";
	}
	return "rejected";
};

const saysAlreadyExists = (facts: Throwable): boolean => {
	if (facts.reason.toLowerCase().includes(ALREADY_EXISTS)) return true;
	return facts.detailMessages.some((message) => message.toLowerCase().includes(ALREADY_EXISTS));
};

/**
 * Re-exported for the client, which reads the same headers on the **success**
 * path to keep its rate-limit snapshot current.
 *
 * @internal
 */
export const readRateLimitHeaders = (
	headers: Readonly<Record<string, unknown>> | undefined,
): { remaining: number; limit: number; resetEpochSeconds: number } | undefined => {
	const remaining = headerNumber(headers, "x-ratelimit-remaining");
	const limit = headerNumber(headers, "x-ratelimit-limit");
	const reset = headerNumber(headers, "x-ratelimit-reset");
	if (remaining === undefined || limit === undefined || reset === undefined) return undefined;
	return { remaining, limit, resetEpochSeconds: reset };
};

/** @internal */
export const readHeaderString = headerString;
