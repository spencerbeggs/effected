import type { Cause } from "effect";
import { Effect, Layer, Queue, Terminal } from "effect";

/**
 * A `Terminal` for tests that must never read input: `readInput` and `readLine` die, `display` discards, and the
 * size (`columns`, `rows`, and the `size` subscription seeded with them) is fixed.
 */
export const inertTerminal = (options?: {
	readonly columns?: number | Effect.Effect<number> | undefined;
	readonly rows?: number | undefined;
}): Layer.Layer<Terminal.Terminal> => {
	const columns = Effect.isEffect(options?.columns) ? options.columns : Effect.succeed(options?.columns ?? 80);
	const rows = Effect.succeed(options?.rows ?? 24);
	return Layer.succeed(
		Terminal.Terminal,
		Terminal.make({
			columns,
			rows,
			size: Effect.acquireRelease(
				Effect.gen(function* () {
					const queue = yield* Queue.sliding<Terminal.Size, Cause.Done>(1);
					yield* Queue.offer(queue, { columns: yield* columns, rows: yield* rows });
					return queue;
				}),
				(queue) => Queue.end(queue),
			),
			readInput: Effect.die("unused"),
			readLine: Effect.die("unused"),
			display: () => Effect.void,
		}),
	);
};
