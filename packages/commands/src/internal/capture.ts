import type { PlatformError } from "effect";
import { Data, Effect, Ref, Stream } from "effect";

/**
 * Raised when a captured stream exceeds its byte budget.
 *
 * @remarks
 * Internal and never exported from the package: `Run` maps it to the public
 * `CommandOutputError`. `Data.TaggedError` is appropriate precisely because it
 * never escapes — it is an in-process signal, not a contract.
 */
export class OutputTooLarge extends Data.TaggedError("OutputTooLarge")<{
	readonly limit: number;
}> {}

/**
 * Collects a byte stream into a string, failing once more than `limit` bytes
 * have arrived.
 *
 * @remarks
 * The budget is enforced **during** accumulation, not after: checking the
 * length of an already-collected string would mean the memory was already
 * spent, which is the exact failure the budget exists to prevent. Counting is
 * on raw bytes, before decoding, because bytes are what the process actually
 * produced.
 */
export const collectBounded = (
	stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
	limit: number,
): Effect.Effect<string, PlatformError.PlatformError | OutputTooLarge> =>
	Effect.flatMap(bounded(stream, limit), (checked) => Stream.mkString(Stream.decodeText(checked)));

/**
 * Collects a byte stream into one `Uint8Array`, failing once more than
 * `limit` bytes have arrived — `collectBounded` without the decode, for output
 * that is data rather than text.
 */
export const collectBoundedBytes = (
	stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
	limit: number,
): Effect.Effect<Uint8Array, PlatformError.PlatformError | OutputTooLarge> =>
	Effect.gen(function* () {
		const chunks = yield* Stream.runCollect(yield* bounded(stream, limit));
		const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
		let offset = 0;
		for (const chunk of chunks) {
			joined.set(chunk, offset);
			offset += chunk.length;
		}
		return joined;
	});

/** `stream`, failing with `OutputTooLarge` the moment more than `limit` bytes have passed through it. */
const bounded = (
	stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
	limit: number,
): Effect.Effect<Stream.Stream<Uint8Array, PlatformError.PlatformError | OutputTooLarge>> =>
	Effect.map(Ref.make(0), (seen) =>
		Stream.mapEffect(stream, (chunk) =>
			Effect.flatMap(
				Ref.updateAndGet(seen, (total) => total + chunk.length),
				(total) => (total > limit ? Effect.fail(new OutputTooLarge({ limit })) : Effect.succeed(chunk)),
			),
		),
	);
