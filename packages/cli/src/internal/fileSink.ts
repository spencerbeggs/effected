import type { Cause, LogLevel, Scope } from "effect";
import { Console, Effect, Fiber, FileSystem, Logger, Path, Queue, Result } from "effect";
import { formatNdjson, passes } from "./diagnostics.js";

/**
 * An asynchronous NDJSON file logger.
 *
 * @remarks
 * `Logger.make` takes a synchronous callback, so the logger only offers the line to a queue; a fiber scoped to the
 * layer drains it and appends each batch with `FileSystem.writeFileString(..., { flag: "a" })`. The first write
 * error prints one stderr line and disables the sink: later lines, including any still queued, are discarded
 * without a message. Closing the scope ends the queue and waits for the drain, so lines queued before the close
 * are flushed, unless the sink had already disabled itself.
 *
 * @internal
 */
export const makeFileSink = (
	path: string,
	installed: LogLevel.LogLevel,
): Effect.Effect<Logger.Logger<unknown, void>, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const location = yield* Path.Path;
		const queue = yield* Queue.unbounded<string, Cause.Done>();
		let disabled = false;

		const append = (lines: ReadonlyArray<string>) =>
			fs
				.makeDirectory(location.dirname(path), { recursive: true })
				.pipe(Effect.andThen(fs.writeFileString(path, lines.map((line) => `${line}\n`).join(""), { flag: "a" })));

		const drain = Effect.gen(function* () {
			while (true) {
				// Fails with Done once the queue has ended and emptied, which stops the loop.
				const batch = yield* Queue.takeAll(queue);
				if (disabled) continue;
				const result = yield* Effect.result(append(batch));
				if (Result.isFailure(result)) {
					disabled = true;
					yield* Console.error(
						`diagnostics log file ${path} failed: ${result.failure.message}; further file logging disabled`,
					);
				}
			}
		}).pipe(Effect.ignore);

		const fiber = yield* Effect.forkScoped(drain);
		// Runs before the fork's own interrupt: end the queue, let the drain write what is left, then it stops.
		yield* Effect.addFinalizer(() => Queue.end(queue).pipe(Effect.andThen(Fiber.join(fiber)), Effect.ignore));

		return Logger.make<unknown, void>((record) => {
			if (!passes(record, installed)) return;
			Queue.offerUnsafe(queue, formatNdjson(record));
		});
	});
