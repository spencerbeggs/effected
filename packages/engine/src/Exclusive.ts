import type { Scope } from "effect";
import { Duration, Effect, Schema, Semaphore } from "effect";

/**
 * {@link Exclusive.run}'s required options.
 *
 * @public
 */
export interface ExclusiveRunOptions {
	/**
	 * How long the body may run once it holds the permit. Required: a lane
	 * that mutates process-global state must not be held forever by a body
	 * that never settles. The timeout interrupts the body; it never releases
	 * the permit before the body's finalizers have run.
	 */
	readonly timeout: Duration.Input;
}

/**
 * {@link Exclusive.promise}'s options.
 *
 * @public
 */
export interface ExclusivePromiseOptions<A, E> {
	/** Starts the promise. `signal` aborts when the effect is interrupted. */
	readonly try: (signal: AbortSignal) => PromiseLike<A>;
	/** Maps a rejection, or a synchronous throw from `try`, to the typed failure. */
	readonly catch: (cause: unknown) => E;
	/**
	 * On interruption, abort `signal` and resume at once instead of waiting for
	 * the promise to settle. Default `false` (abort, then wait). Set it for a
	 * promise that ignores its signal, which would otherwise hold the interrupt
	 * forever; see {@link Exclusive.promise}.
	 */
	readonly abandon?: boolean;
}

/**
 * The body of an {@link Exclusive.run} call ran past its timeout and was
 * interrupted. Its finalizers had run, and the permit was released, by the
 * time the caller sees this.
 *
 * @remarks
 * Audience: calling code, which usually folds it into its own outcome (a tool
 * result's `{ kind: "timeout" }`). `timeout` is the formatted duration.
 *
 * @public
 */
export class ExclusiveTimeout extends Schema.TaggedError<ExclusiveTimeout>()("ExclusiveTimeout", {
	timeout: Schema.String,
	message: Schema.String,
}) {}

/**
 * A one-permit lane for work that mutates process-global state (the working
 * directory, the environment, a patched stream), so two requests never
 * interleave it and the state is restored before the next one starts.
 *
 * @remarks
 * Ordering, on every exit path:
 *
 * 1. Waiting for the permit is interruptible: a request cancelled while it is
 *    queued leaves the queue and never runs.
 * 2. Once the permit is held, the caller's interruption is masked until the
 *    body ends. A transport that maps a client cancel to an interrupt (an MCP
 *    server does) only drops the response; the next request still waits for
 *    the real work to finish.
 * 3. The required timeout interrupts the body, and only the body.
 * 4. The body runs in its own `Scope`: its finalizers (restoring the working
 *    directory or the environment with {@link ProcessScope}, removing a temp
 *    directory) run, then the permit is released, then the caller sees the
 *    result, an {@link ExclusiveTimeout}, or its own deferred interruption.
 *
 * A body that ignores interruption delays its timeout and the permit release
 * until it settles, as an uninterruptible region does. That is
 * deliberate, because releasing the permit while process state is still being
 * changed is the bug this lane exists to prevent. Run promise work through
 * {@link Exclusive.promise}, whose interruption aborts the signal and then
 * waits for the promise to settle; `Effect.promise` would abandon it. A
 * promise that ignores its signal and never settles therefore hangs the
 * timeout and the permit forever: give it `abandon: true`.
 *
 * **Not reentrant.** A `run` on the same lane from inside a body waits for the
 * permit its own caller holds. It never gets it: the nested call waits until
 * the outer timeout fires, which interrupts the body (and the nested wait with
 * it), so the outer `run` fails with {@link ExclusiveTimeout}. Call the inner
 * work directly instead of through the lane again.
 *
 * @example
 * ```ts
 * import { Exclusive, ProcessScope } from "@effected/engine"
 * import { Effect } from "effect"
 *
 * const lane = yield* Exclusive.make
 * const result = yield* lane.run(
 * 	Effect.gen(function* () {
 * 		yield* ProcessScope.chdir(process, root)
 * 		return yield* Exclusive.promise({ try: (signal) => runTool(signal), catch: (cause) => new ToolFailed({ cause }) })
 * 	}),
 * 	{ timeout: "2 minutes" },
 * )
 * ```
 *
 * @public
 */
export class Exclusive {
	private constructor(private readonly semaphore: Semaphore.Semaphore) {}

	/** A new lane with one permit. Bind it once (a module-level or layer-built value); every call shares it. */
	static readonly make: Effect.Effect<Exclusive> = Effect.map(
		Semaphore.make(1),
		(semaphore) => new Exclusive(semaphore),
	);

	/**
	 * A promise whose interruption aborts `signal` and then waits for the
	 * promise to settle, rather than abandoning it as `Effect.promise` and
	 * `Effect.tryPromise` do. A rejection, or a synchronous throw from `try`,
	 * fails through `catch`; a `catch` that itself throws dies with what it
	 * threw.
	 *
	 * @remarks
	 * **The default hangs on a promise that ignores its signal.** Waiting is
	 * the point: the interrupt (a lane timeout, a cancel) returns only once the
	 * promise has settled, so no work is still changing process state when the
	 * permit is released. But a promise that never observes `signal` and never
	 * settles (a test runner's `start`, a third-party call with no
	 * cancellation) holds the interrupt, the lane's timeout and the permit
	 * forever.
	 *
	 * Pass `abandon: true` for such a promise. Interruption still aborts
	 * `signal`, then resumes at once without waiting; the promise keeps running
	 * unobserved and its eventual result is dropped. Inside {@link Exclusive.run}
	 * the body's scope still closes, and its finalizers still run, before the
	 * permit is released. What abandoning gives up is the guarantee that the
	 * promise itself has stopped: choose it only when the promise cannot be
	 * stopped, and restore any state it touches in a finalizer.
	 */
	static readonly promise = <A, E>(options: ExclusivePromiseOptions<A, E>): Effect.Effect<A, E> =>
		Effect.callback<A, E>((resume, signal) => {
			// A `catch` that throws is a defect, on every path: thrown inside the
			// `.then` handler it would reject a promise nobody observes and never
			// resume, hanging the caller until the lane timeout (or forever).
			const failure = (cause: unknown): Effect.Effect<never, E> => {
				try {
					return Effect.fail(options.catch(cause));
				} catch (error) {
					return Effect.die(error);
				}
			};
			let settled: Promise<A>;
			try {
				settled = Promise.resolve(options.try(signal));
			} catch (cause) {
				resume(failure(cause));
				return;
			}
			settled.then(
				(value) => resume(Effect.succeed(value)),
				(cause: unknown) => resume(failure(cause)),
			);
			// No cancel effect: core aborts the signal and resumes the interrupt immediately.
			if (options.abandon === true) return;
			return Effect.promise(() =>
				settled.then(
					() => undefined,
					() => undefined,
				),
			);
		});

	/**
	 * Runs `body` holding this lane's permit, under the ordering in the class
	 * remarks. `body` gets its own `Scope`, closed before the permit is released.
	 */
	readonly run = <A, E, R>(
		body: Effect.Effect<A, E, R>,
		options: ExclusiveRunOptions,
	): Effect.Effect<A, E | ExclusiveTimeout, Exclude<R, Scope.Scope>> => {
		const timeout = Duration.fromInputUnsafe(options.timeout);
		// Core's race runs the body and the timer on their own fibers and returns only after the loser
		// is interrupted and has exited: a timed-out body's finalizers have run, and a body that won has
		// stopped the timer, before the permit is released. `interruptible` lets the timer interrupt the
		// body while the caller stays masked by the `uninterruptible` below.
		const lane = Effect.interruptible(Effect.scoped(body)).pipe(
			Effect.timeoutOrElse({
				duration: timeout,
				orElse: () => {
					const formatted = Duration.format(timeout);
					return Effect.fail(new ExclusiveTimeout({ timeout: formatted, message: `Timed out after ${formatted}.` }));
				},
			}),
		);
		return this.semaphore.withPermit(Effect.uninterruptible(lane)).pipe(Effect.withSpan("Exclusive.run"));
	};
}
