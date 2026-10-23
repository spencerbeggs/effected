// Shared mechanics for every preset: header reads, signed-content assembly,
// freshness arithmetic and the span's outcome annotation.

import { DateTime, Duration, Effect, Option } from "effect";
import type { FreshnessOptions, WebhookRequest } from "../WebhookRequest.js";
import type { WebhookPreset, WebhookVerificationReason } from "../WebhookVerificationError.js";
import { WebhookVerificationError } from "../WebhookVerificationError.js";

/**
 * The default freshness tolerance: five minutes either way.
 *
 * @internal
 */
export const DEFAULT_TOLERANCE: Duration.Duration = Duration.minutes(5);

/**
 * A header's trimmed value, or `undefined` when absent, empty or whitespace.
 *
 * @internal
 */
export const readHeader = (request: WebhookRequest, name: string): string | undefined => {
	const value = Option.getOrUndefined(request.header(name))?.trim();
	return value === undefined || value === "" ? undefined : value;
};

const encoder = new TextEncoder();

/**
 * `prefix` as UTF-8, then the raw body bytes, joined as bytes and never via a decoded string.
 *
 * @internal
 */
export const signedContent = (prefix: string, body: Uint8Array): Uint8Array => {
	const head = encoder.encode(prefix);
	const out = new Uint8Array(head.byteLength + body.byteLength);
	out.set(head, 0);
	out.set(body, head.byteLength);
	return out;
};

/**
 * A typed verification failure.
 *
 * @internal
 */
export const reject = (
	preset: WebhookPreset,
	reason: WebhookVerificationReason,
	detail?: string,
): Effect.Effect<never, WebhookVerificationError> => Effect.fail(WebhookVerificationError.of(preset, reason, detail));

/**
 * Whether `timestampMillis` sits within `tolerance` of `receivedAt`, either way; the boundary is fresh.
 *
 * @internal
 */
export const isFresh = (timestampMillis: number, receivedAt: DateTime.Utc, tolerance: Duration.Input): boolean =>
	Math.abs(DateTime.toEpochMillis(receivedAt) - timestampMillis) <= Duration.toMillis(tolerance);

/**
 * The freshness check every timestamped preset runs, after the signature.
 *
 * @internal
 */
export const checkFresh = (
	preset: WebhookPreset,
	timestampMillis: number,
	receivedAt: DateTime.Utc,
	options: FreshnessOptions | undefined,
): Effect.Effect<void, WebhookVerificationError> =>
	isFresh(timestampMillis, receivedAt, options?.tolerance ?? DEFAULT_TOLERANCE)
		? Effect.void
		: reject(preset, "stale_timestamp", "the signed timestamp is outside the tolerance");

/**
 * Annotate the current span with the preset and the outcome: `verified`, or the failure reason. Applied as an
 * `Effect.fn` pipeable, so it runs inside the preset's span. Never annotates the secret, a signature or the body.
 *
 * @internal
 */
export const annotateOutcome =
	(preset: WebhookPreset) =>
	<A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		Effect.annotateCurrentSpan("webhook.preset", preset).pipe(
			Effect.andThen(self),
			Effect.tap(() => Effect.annotateCurrentSpan("webhook.outcome", "verified")),
			Effect.tapError((error) =>
				error instanceof WebhookVerificationError
					? Effect.annotateCurrentSpan("webhook.outcome", error.reason)
					: Effect.void,
			),
		);
