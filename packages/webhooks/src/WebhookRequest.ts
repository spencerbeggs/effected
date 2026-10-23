import type { DateTime, Duration, Option, Redacted } from "effect";

/**
 * One inbound delivery, as every preset's `verify` takes it.
 *
 * @remarks
 * Plain data, so it adapts from core `effect/http`, a Workers `Request` or a test alike.
 *
 * @public
 */
export interface WebhookRequest {
	/**
	 * Look up a header. Presets call it with lower-case names. An empty or whitespace-only value counts as absent;
	 * values are trimmed.
	 */
	readonly header: (name: string) => Option.Option<string>;
	/** The raw body: the exact bytes received, never a re-serialized parse. */
	readonly body: Uint8Array;
	/** When the delivery arrived. Staleness is judged against this, never the wall clock. */
	readonly receivedAt: DateTime.Utc;
	/** The endpoint's secret, in the form the vendor shows it. */
	readonly secret: Redacted.Redacted<string>;
}

/**
 * The tolerance option shared by the timestamped presets.
 *
 * @public
 */
export interface FreshnessOptions {
	/** How far the signed timestamp may sit from `receivedAt`, either way. Five minutes when omitted. */
	readonly tolerance?: Duration.Input;
}
