// `CliUi.liveDetached`: a live view hosted by code that is not built on Effect (a test runner's reporter, a bundler
// plugin). The one place `./ui` runs an effect itself; that is its whole purpose.

import type * as Cli from "@effected/cli";
import type { Layer, Stream } from "effect";
import { Deferred, Effect, Exit, Fiber, PubSub, Scope } from "effect";
import type { LiveHandle, LiveOptions } from "./CliUiLive.js";
import { live } from "./CliUiLive.js";

/**
 * Options for `CliUi.liveDetached`: those of `CliUi.live`, with the events given as a `PubSub` or a stream, and the
 * render given directly or as an effect that makes it.
 *
 * @typeParam R - the services a `render` effect reads, which the `env` layer provides
 *
 * @public
 */
export interface DetachedLiveOptions<E, S, R = never> extends Omit<LiveOptions<E, S>, "events" | "render"> {
	/**
	 * The events to fold. A `PubSub` is subscribed before `liveDetached` returns, in the view's own scope, so an event
	 * published right after the call is seen and `close` folds every message still queued. A stream is read as
	 * `CliUi.live` reads one.
	 */
	readonly events: PubSub.PubSub<E> | Stream.Stream<E>;
	/**
	 * Draw the state, as `CliUi.live`'s `render`; or an effect that makes that function, run once under `env` before
	 * the view is set up, so a render that needs an environment service (`CliLinks` to build links, `TerminalEnv` for
	 * the terminal's capabilities) reads it from the layer the view already builds rather than from a second build.
	 *
	 * @remarks
	 * A render effect that dies is the view's setup failing: `handle` rejects, `close` resolves, and `exit` carries
	 * the die, as for an `env` layer that dies. It can return a `CliUi.lazyView`.
	 */
	readonly render: LiveOptions<E, S>["render"] | Effect.Effect<LiveOptions<E, S>["render"], never, R>;
}

/**
 * A live view running outside Effect, from `CliUi.liveDetached`.
 *
 * @public
 */
export interface DetachedLive<S> {
	/**
	 * The view's handle once `CliUi.live` has set it up (it loads Ink asynchronously). Rejects if the view could not be
	 * set up; the rejection is handled, so a host that never awaits it sees no unhandled rejection.
	 */
	readonly handle: Promise<LiveHandle<S>>;
	/**
	 * The handle's `printAbove`: print one line above the frame and say whether it did. `false`, with nothing written,
	 * before the handle is set up, whenever no run's frame is mounted, and from the moment `close` is called, so the
	 * host writes the line itself.
	 */
	readonly printAbove: (stream: "stdout" | "stderr", line: string) => boolean;
	/**
	 * End the view and release it.
	 *
	 * @remarks
	 * In order: `printAbove` stops printing; the view's setup is awaited (one that died counts as settled); the
	 * handle's `close` folds every message still queued in the subscription and commits the last run; then the view's
	 * scope is closed, which unsubscribes and unmounts. Shut the `PubSub` down only after the returned promise
	 * resolves: a `PubSub.shutdown` before it drops the events the view has not taken yet.
	 *
	 * Idempotent: every call returns the same promise. It never rejects; how the view ended is `exit`.
	 */
	readonly close: () => Promise<void>;
	/**
	 * How the view ended: a success when its events ended or `close` ended them, the failure it died of (a `reduce`
	 * that threw, a stream that died, a setup that failed), or an interrupt when its scope closed under it.
	 */
	readonly exit: Promise<Exit.Exit<void>>;
}

/** @internal */
export const liveDetached = <E, S, R = never>(
	options: DetachedLiveOptions<E, S, R>,
	env: Layer.Layer<Cli.CliTheme | NoInfer<R>>,
): DetachedLive<S> => {
	const scope = Effect.runSync(Scope.make());
	const { events: source, render: drawing, ...rest } = options;
	// Resolved inside the program, under the one `env` build, so the render reads the services the view runs under.
	const render: Effect.Effect<LiveOptions<E, S>["render"], never, R> = Effect.isEffect(drawing)
		? drawing
		: Effect.succeed(drawing);
	// Subscribed here, synchronously, so nothing published after the call is missed.
	const events = PubSub.isPubSub<E>(source)
		? Effect.runSync(PubSub.subscribe(source).pipe(Scope.provide(scope)))
		: source;
	const mounted = Effect.runSync(Deferred.make<LiveHandle<S>>());
	const program = Effect.flatMap(render, (draw) => live<E, S>({ ...rest, render: draw, events })).pipe(
		Effect.tap((handle) => Deferred.succeed(mounted, handle)),
		Effect.flatMap((handle) => handle.done),
		Scope.provide(scope),
		Effect.provide(env),
		// Outermost, so a failure anywhere before the handle exists settles `mounted` too, the env layer's build
		// included: `close` and `handle` never wait on a view that died before it was set up. Once `mounted` holds the
		// handle, this changes nothing.
		Effect.onExit((exit) =>
			Deferred.done(
				mounted,
				Exit.isFailure(exit) ? Exit.failCause(exit.cause) : Exit.die(new Error("CliUi.liveDetached: the view ended")),
			),
		),
	);
	const fiber = Effect.runFork(program);
	const exit = Effect.runPromise(Fiber.await(fiber));

	const handle = Effect.runPromise(Deferred.await(mounted));
	let closing: Promise<void> | undefined;
	let print: ((stream: "stdout" | "stderr", line: string) => boolean) | undefined;
	handle.then(
		(mountedHandle) => {
			print = mountedHandle.printAbove;
		},
		() => undefined,
	);

	return {
		handle,
		exit,
		// Declines from the moment `close` is called, mounted frame or not: a host that has begun to close owns its output.
		printAbove: (stream, line) => (closing === undefined && print !== undefined ? print(stream, line) : false),
		close: () => {
			closing ??= Effect.runPromise(
				Deferred.await(mounted).pipe(
					Effect.flatMap((mountedHandle) => mountedHandle.close),
					Effect.exit,
					Effect.ensuring(Scope.close(scope, Exit.void)),
					Effect.asVoid,
				),
			);
			return closing;
		},
	};
};
