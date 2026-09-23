import { Context, Effect, Layer, MutableRef } from "effect";

/**
 * The shape behind {@link CliExit}.
 *
 * @public
 */
export interface CliExitShape {
	/** The highest exit code recorded during the run; `0` until one is set. */
	readonly code: MutableRef.MutableRef<number>;
}

/**
 * The exit code a successful run wants, for commands whose findings are a
 * result rather than a failure (a linter that found problems, say).
 *
 * @remarks
 * Findings are not a failure — a JSON `tapError` must not fire, and the
 * handler must return normally — yet the process must exit non-zero. Writing
 * `process.exitCode` works only because Node's `runMain` skips
 * `process.exit(0)` on success; `process.exit(n)` in a handler skips every
 * finalizer. {@link CliRuntime.main} reads this cell after the program
 * succeeds and turns a non-zero code into a marked failure the runtime's
 * teardown honours, on any runtime, with finalizers intact.
 *
 * A `Service`, not a `Reference`: forgetting `CliRuntime.main` is a type error,
 * never a silently ignored global.
 *
 * @public
 */
export class CliExit extends Context.Service<CliExit, CliExitShape>()("@effected/cli/CliExit") {
	/**
	 * A fresh cell at `0`; `CliRuntime.main` provides it, and tests provide it
	 * directly.
	 *
	 * @remarks
	 * Every provide mints a new cell. Layers memoize by reference across
	 * `Effect.provide` calls, so without `Layer.fresh` a second provide of this
	 * layer anywhere in the program — a nested `CliRuntime.main`, a test
	 * helper — would silently share the first run's cell and inherit its code.
	 */
	static readonly layer: Layer.Layer<CliExit> = Layer.fresh(Layer.sync(this, () => ({ code: MutableRef.make(0) })));

	/**
	 * Record an exit code; the highest code set during the run wins.
	 *
	 * @remarks
	 * Highest-wins, not last-wins, so a later "clean" step cannot quietly
	 * downgrade an earlier finding's code.
	 */
	static readonly set = (code: number): Effect.Effect<void, never, CliExit> =>
		Effect.gen(function* () {
			const exit = yield* CliExit;
			if (code > MutableRef.get(exit.code)) MutableRef.set(exit.code, code);
		});
}
