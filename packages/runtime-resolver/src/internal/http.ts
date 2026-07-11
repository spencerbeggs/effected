/**
 * JSON-over-HTTP transport, free of the public facade.
 *
 * This is the lowest engine layer: it speaks `HttpClient` and returns **raw
 * failure records**, never the public error classes. The facade (`GitHub.ts`)
 * materializes those records into `AuthenticationError` / `RateLimitError` /
 * `NetworkError` / `ResponseParseError`. That is what keeps this module
 * importable from every direction without an import cycle.
 *
 * @internal
 */

import type { Schema } from "effect";
import { Duration, Effect, Schedule } from "effect";
import { HttpClient } from "effect/unstable/http";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { DEFAULT_MAX_PAGES, DEFAULT_PER_PAGE, PAGE_CEILING } from "./limits.js";

/**
 * A transport failure, before the facade gives it a class.
 *
 * @internal
 */
export type HttpFailure =
	| { readonly _kind: "auth" }
	| { readonly _kind: "rateLimit"; readonly retryAfter?: number; readonly limit: number; readonly remaining: number }
	| { readonly _kind: "network"; readonly url: string; readonly status?: number; readonly cause: unknown }
	| { readonly _kind: "parse"; readonly source: string; readonly cause: unknown };

const parseHeaderInt = (raw: string | undefined): number | undefined => {
	if (raw === undefined) return undefined;
	const n = Number.parseInt(raw, 10);
	return Number.isInteger(n) ? n : undefined;
};

/**
 * A `retry-after` is a number a remote server chose, so it is bounded before it
 * becomes a sleep. Without this a misconfigured — or hostile — server parks the
 * caller's fiber for as long as it likes by sending one large header. A negative
 * value is discarded outright.
 */
const MAX_RETRY_AFTER_SECONDS = 60;

const parseRetryAfter = (raw: string | undefined): number | undefined => {
	const seconds = parseHeaderInt(raw);
	return seconds === undefined || seconds < 0 ? undefined : seconds;
};

/**
 * Map an HTTP status onto the failure ladder.
 *
 * 401 is an authentication problem and 429 is definitionally a rate limit. 403
 * is the one that has to be classified rather than assumed: GitHub returns it
 * for an exhausted rate limit, but *also* for permission and resource failures
 * ("Resource not accessible by personal access token"), which no amount of
 * backoff will fix. Treating every 403 as a rate limit retries those three times
 * and then reports a `RateLimitError` naming a quota that was never the problem.
 *
 * The two signals GitHub documents for a rate limit are the primary limit's
 * `x-ratelimit-remaining: 0` and the secondary limit's `retry-after`. A 403 with
 * neither is a permission failure, and it leaves as a `NetworkError` carrying the
 * status rather than being retried.
 */
const failureForStatus = (
	url: string,
	status: number,
	headers: Readonly<Record<string, string | undefined>>,
): HttpFailure => {
	if (status === 401) return { _kind: "auth" };

	if (status === 403 || status === 429) {
		const remaining = parseHeaderInt(headers["x-ratelimit-remaining"]);
		const retryAfter = parseRetryAfter(headers["retry-after"]);
		const rateLimited = status === 429 || remaining === 0 || retryAfter !== undefined;

		if (rateLimited) {
			return {
				_kind: "rateLimit",
				...(retryAfter !== undefined ? { retryAfter } : {}),
				limit: parseHeaderInt(headers["x-ratelimit-limit"]) ?? 0,
				remaining: remaining ?? 0,
			};
		}
	}

	return { _kind: "network", url, status, cause: `HTTP ${status}` };
};

/**
 * GET a URL and decode its JSON body with `schema`.
 *
 * Every failure mode — transport, status, malformed body — leaves through the
 * typed channel as an {@link HttpFailure}. Nothing throws.
 */
export const getJson = <A, I>(
	url: string,
	schema: Schema.Codec<A, I>,
	headers: Readonly<Record<string, string>> = {},
): Effect.Effect<A, HttpFailure, HttpClient.HttpClient> =>
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient;

		const response = yield* client
			.get(url, { headers })
			.pipe(Effect.mapError((cause): HttpFailure => ({ _kind: "network", url, cause })));

		if (response.status < 200 || response.status >= 300) {
			return yield* Effect.fail(failureForStatus(url, response.status, response.headers));
		}

		return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
			Effect.mapError((cause): HttpFailure => ({ _kind: "parse", source: url, cause })),
		);
	});

/**
 * Exponential backoff, overridden by the server's own `retry-after` when it sent
 * one.
 *
 * GitHub tells you how long to wait for a secondary rate limit, and guessing
 * `1s, 2s, 4s` against that is both ruder and less effective than doing as it
 * asked. `Schedule.passthrough` re-types the schedule's output as its *input* —
 * the failure — which is what lets `modifyDelay` see the `retryAfter` that the
 * failure is carrying and replace the computed delay with it.
 */
const rateLimitBackoff: Schedule.Schedule<HttpFailure, HttpFailure> = Schedule.exponential("1 second").pipe(
	Schedule.setInputType<HttpFailure>(),
	Schedule.passthrough,
	Schedule.modifyDelay((failure, delay) =>
		Effect.succeed(
			failure._kind === "rateLimit" && failure.retryAfter !== undefined
				? Duration.seconds(Math.min(failure.retryAfter, MAX_RETRY_AFTER_SECONDS))
				: delay,
		),
	),
);

/**
 * Retry a rate-limited effect, honoring the server's backoff.
 *
 * Only `rateLimit` failures are retried — an auth failure, a permission failure
 * or a malformed body will not fix itself, and retrying them just burns the
 * caller's quota.
 */
export const retryOnRateLimit = <A, R>(effect: Effect.Effect<A, HttpFailure, R>): Effect.Effect<A, HttpFailure, R> =>
	effect.pipe(
		Effect.retry({
			schedule: rateLimitBackoff,
			times: 3,
			while: (failure: HttpFailure) => failure._kind === "rateLimit",
		}),
	);

/**
 * Options accepted by a paginated listing.
 *
 * @internal
 */
export interface PageOptions {
	readonly perPage?: number;
	readonly pages?: number;
}

/**
 * Validate a caller-supplied numeric bound.
 *
 * `if (n < 1)` is the obvious spelling and it is wrong twice over: every
 * relational comparison against `NaN` is `false`, so `NaN` sails through, and
 * so does `2.5`. Both are developer wiring errors rather than data conditions,
 * so they die rather than entering the typed channel.
 */
const requirePositiveInteger = (name: string, value: number): Effect.Effect<number> =>
	Number.isInteger(value) && value >= 1
		? Effect.succeed(value)
		: Effect.die(new Error(`${name} must be a positive integer, received ${value}`));

/**
 * Walk a paginated listing, decoding each page and stopping at a short page.
 *
 * Pagination is bounded in two places: the caller's `pages` (validated) and a
 * hard {@link PAGE_CEILING}, so a remote server cannot drive an unbounded loop.
 */
export const paginate = <A, I>(
	url: (page: number, perPage: number) => string,
	schema: Schema.Codec<ReadonlyArray<A>, ReadonlyArray<I>>,
	headers: Readonly<Record<string, string>>,
	options: PageOptions = {},
): Effect.Effect<ReadonlyArray<A>, HttpFailure, HttpClient.HttpClient> =>
	Effect.gen(function* () {
		const perPage = yield* requirePositiveInteger("perPage", options.perPage ?? DEFAULT_PER_PAGE);
		const requested = yield* requirePositiveInteger("pages", options.pages ?? DEFAULT_MAX_PAGES);
		const maxPages = Math.min(requested, PAGE_CEILING);

		const all: A[] = [];
		for (let page = 1; page <= maxPages; page++) {
			const items = yield* retryOnRateLimit(getJson(url(page, perPage), schema, headers));
			all.push(...items);
			if (items.length < perPage) break;
		}
		return all;
	});
