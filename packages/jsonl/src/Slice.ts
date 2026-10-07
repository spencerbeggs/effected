// The one filter shape, shared by every read surface.
//
// One vocabulary means one thing to learn: a consumer who can express a
// subscription can express a query and a projection without translating. Every
// field here lives on the envelope **frame**, so matching never touches `data`.

import type { DateTime } from "effect";
import type { JsonlEvent } from "./JsonlEvent.js";

/**
 * A filter over envelope fields, plus where to resume and what to do with a
 * line that cannot be decoded.
 *
 * Every field is optional and the filters combine with AND. An omitted field
 * does not filter; an empty `events: []` or `scopes: []` matches nothing.
 *
 * @public
 */
export interface Slice<R extends JsonlEvent.Registry, T extends JsonlEvent.Tag<R> = JsonlEvent.Tag<R>> {
	/**
	 * Restrict to these event tags.
	 *
	 * Passing a literal array narrows the element type of the surface's stream to
	 * exactly those variants, so a projection over a slice is exhaustively
	 * checkable.
	 */
	readonly events?: ReadonlyArray<T> | undefined;
	/** Restrict to these partition keys. An envelope with no `scope` matches none of them. */
	readonly scopes?: ReadonlyArray<string> | undefined;
	/** Lower bound on `at`, **inclusive**. */
	readonly from?: DateTime.Utc | undefined;
	/**
	 * Upper bound on `at`, **exclusive**, so adjacent windows tile without
	 * double-delivering an envelope on the seam.
	 */
	readonly to?: DateTime.Utc | undefined;
	/**
	 * Resume from this logical byte offset, **inclusive**.
	 *
	 * Persist a processed envelope's `position.end` and pass it back to replay
	 * exactly the remainder. A cursor pointing into a line skips that line whole.
	 */
	readonly cursor?: number | undefined;
	/**
	 * What to do with a line that cannot be decoded — not JSON, not an envelope,
	 * an unknown tag, or a payload its schema rejects.
	 *
	 * - `"skip"` (the default): leave it out and keep reading. A journal shared
	 *   with another writer, or with an older or newer version of this one, stays
	 *   readable past lines this registry does not understand.
	 * - `"fail"`: end the stream with the typed error.
	 *
	 * A line whose frame decodes but does not match the slice is never decoded
	 * further, so it cannot fail a stream that would not have delivered it. One
	 * that cannot be framed at all counts against every slice.
	 */
	readonly onInvalid?: "skip" | "fail" | undefined;
}

/**
 * The frame fields a slice reads. An envelope satisfies it, and so does a
 * decoded frame.
 *
 * @internal
 */
export interface Framed {
	readonly at: DateTime.Utc;
	readonly event: string;
	readonly scope?: string | undefined;
}

/**
 * A {@link Slice} with its registry erased — what the engine works with.
 *
 * @internal
 */
export type AnySlice = Slice<JsonlEvent.Registry, string>;

/**
 * Whether frame fields satisfy a slice.
 *
 * @internal
 */
export const matchesFrame = (frame: Framed, slice: AnySlice | undefined): boolean => {
	if (slice === undefined) {
		return true;
	}
	if (slice.events !== undefined && !slice.events.includes(frame.event)) {
		return false;
	}
	if (slice.scopes !== undefined && (frame.scope === undefined || !slice.scopes.includes(frame.scope))) {
		return false;
	}
	const millis = frame.at.epochMilliseconds;
	if (slice.from !== undefined && millis < slice.from.epochMilliseconds) {
		return false;
	}
	return slice.to === undefined || millis < slice.to.epochMilliseconds;
};
