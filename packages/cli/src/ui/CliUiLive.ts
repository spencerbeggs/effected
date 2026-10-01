// Root types are named through the package's own name, so the emitted ui.d.ts imports them from "@effected/cli".
import type * as Cli from "@effected/cli";
import type { Console } from "effect";
import { Clock, Effect, Exit, Fiber, Pull, Scope, Stream } from "effect";
import type { FunctionComponent, ReactElement, ReactNode } from "react";
import { CliInteractive } from "../CliInteractive.js";
import { CliTheme } from "../CliTheme.js";
import { errorBoundary } from "./internal/ErrorBoundary.js";
import type { HolderSlot } from "./internal/Holder.js";
import { holder, holderSlot } from "./internal/Holder.js";
import { fromReact, inkModules, loadInk, withInkColour } from "./internal/ink.js";
import { makeInkConsole } from "./internal/inkConsole.js";
import { mountPermit } from "./internal/mountPermit.js";
import { drainPerformance, resolveDrain } from "./internal/perfDrain.js";
import { UiRenderOptions } from "./internal/renderOptions.js";
import { uiProviders } from "./internal/UiProviders.js";
import { UiStreams } from "./UiStreams.js";
import { useTerminalSize } from "./UiTheme.js";

/**
 * Options for `CliUi.live`.
 *
 * @public
 */
export interface LiveOptions<E, S> {
	/**
	 * The events to fold. `live` makes the stream's first pull before it returns, so a stream that subscribes on its
	 * first pull without forking (`Stream.fromPubSub`) is subscribed by then and sees an event published at once. One
	 * that forks its upstream (`Stream.merge`, `buffer`, a concurrent `flatMap`) subscribes later, and an event published
	 * before that is lost. To be certain, subscribe first (`PubSub.subscribe`) and pass `Stream.fromSubscription`.
	 */
	readonly events: Stream.Stream<E>;
	/** The state before the first event. */
	readonly initial: S;
	/** Fold one event into the state. The kit never resets the state: a reducer that wants a fresh run resets it. */
	readonly reduce: (state: S, event: E) => S;
	/**
	 * Draw the state. `frame` is the wall clock in ticks of `tickMillis` (`floor(now / tickMillis)`, from `Clock`), so a
	 * spinner keeps turning across runs. Rendered inside the kit's providers: `useTheme`, `useGlyphs`, `Styled` and
	 * `useTerminalSize` work in it.
	 */
	readonly render: (state: S, frame: number) => ReactElement;
	/** Whether an event starts a run. */
	readonly isStart: (event: E) => boolean;
	/** Whether an event ends a run: its frame is committed to the terminal and the view unmounts until the next. */
	readonly isTerminal: (event: E) => boolean;
	/**
	 * `"owned"` (the default) for a view that owns its output, `"hosted"` for one drawn inside a host's (a test
	 * reporter). They differ only when the run is not interactive.
	 */
	readonly mode?: "owned" | "hosted";
	/** The frame tick, in milliseconds; 80 by default. */
	readonly tickMillis?: number;
	/**
	 * Clear React's user-timing entries after every render: `true`, `false`, or `"auto"` (the default), which clears
	 * unless `NODE_ENV` is exactly `"production"`. React's development build records them on every render and never
	 * clears them. The clear is process-wide: it removes every `measure` entry, a program's own included; marks are left
	 * alone.
	 */
	readonly drainPerformance?: boolean | "auto";
}

/**
 * The handle of a live view.
 *
 * @public
 */
export interface LiveHandle<S> {
	/** The current state of the fold. */
	readonly state: Effect.Effect<S>;
	/**
	 * A `Console` whose every method writes above the frame while a run is mounted, and straight to the stream
	 * otherwise; none falls through to the program's own console. Output is split as Node's console splits it: `log`,
	 * `info`, `debug`, `dir`, `dirxml`, `table`, `count`, `timeLog`, `timeEnd` and a group's label to stdout, and `error`,
	 * `warn`, `trace` and a failed `assert` to stderr; a group indents what follows. An `Error` argument is written with
	 * its stack. `clear` does nothing, since erasing the screen would take the scrollback above the frame. Provide it
	 * around the work done while the view is mounted; a line written to the terminal any other way tears the frame.
	 */
	readonly logConsole: Console.Console;
	/** Completes once the event stream has ended and the last run's frame is committed. */
	readonly done: Effect.Effect<void>;
}

/**
 * The live tree's height clamp: at most the terminal's rows less one, re-read on every render and when the terminal
 * resizes, so a tall frame never takes Ink's clear-terminal path, which wipes the scrollback
 * (`okf/decisions/live-height-clamp-not-width.md`). No width: Ink sizes the root itself.
 */
const heightClamp: () => FunctionComponent<{ readonly children?: ReactNode }> = fromReact(() => {
	const HeightClamp = (props: { readonly children?: ReactNode }): ReactElement => {
		const { ink, react } = inkModules();
		const { rows } = useTerminalSize();
		return react.createElement(
			ink.Box,
			{ flexDirection: "column", maxHeight: rows, overflow: "hidden" },
			props.children,
		);
	};
	HeightClamp.displayName = "CliUiLiveHeightClamp";
	return HeightClamp;
});

/** One mounted run: its scope (permit, colour, Ink instance) and the slot that swaps its frame. */
interface Run {
	readonly scope: Scope.Closeable;
	readonly slot: HolderSlot;
}

/**
 * `CliUi.live`, kept in its own module: see `CliUi.live` for the contract.
 *
 * @internal
 */
export const live = <E, S>(
	options: LiveOptions<E, S>,
): Effect.Effect<LiveHandle<S>, never, Scope.Scope | Cli.CliTheme> =>
	Effect.gen(function* () {
		const theme = (yield* CliTheme).forStream("stdout");
		const interactive = yield* CliInteractive;
		const streams = yield* UiStreams;
		const overrides = yield* UiRenderOptions;
		const drain = yield* resolveDrain(options.drainPerformance ?? "auto");
		const tickMillis = options.tickMillis ?? 80;
		const bridge = yield* makeInkConsole;

		let state = options.initial;
		let run: Run | undefined;

		// The consumer's render runs inside React, under the error boundary, never in the drain fiber.
		const Frame = (props: { readonly state: S; readonly frame: number }): ReactElement =>
			options.render(props.state, props.frame);
		const frameOf = Effect.map(Clock.currentTimeMillis, (now) => Math.floor(now / tickMillis));
		const elementOf = (frame: number): ReactElement => inkModules().react.createElement(Frame, { state, frame });

		// A run's scope is its own, not a child of the caller's: the caller's scope ends runs through one finalizer that
		// stops the drain first, so no event is folded or drawn while a run is closing.
		const mountRun: Effect.Effect<void> = Effect.gen(function* () {
			const scope = yield* Scope.make("sequential");
			const slot = holderSlot();
			yield* Effect.gen(function* () {
				// One Ink mount at a time, process-wide, held for this run only: a `CliUi.run` between runs mounts.
				yield* Effect.acquireRelease(mountPermit.take(1), () => mountPermit.release(1), { interruptible: true });
				yield* Effect.acquireRelease(
					Effect.sync(() => overrides.onMount?.()),
					() => Effect.sync(() => overrides.onUnmount?.(undefined)),
				);
				const { ink, react } = yield* loadInk;
				yield* withInkColour(theme.color);
				const initial = elementOf(yield* frameOf);
				const tree = react.createElement(errorBoundary(), {
					// What a render that throws comes to is the degrade path's; until then the boundary draws nothing.
					onError: () => undefined,
					children: uiProviders(
						{ theme, glyphs: theme.glyphs },
						react.createElement(
							bridge.Bridge,
							null,
							react.createElement(heightClamp(), null, react.createElement(holder(), { initial, bind: slot.bind })),
						),
					),
				});
				yield* Effect.acquireRelease(
					Effect.sync(() => {
						const instance = ink.render(tree, {
							stdin: streams.stdin,
							stdout: streams.stdout,
							stderr: streams.stderr,
							interactive: true,
							exitOnCtrlC: false,
							patchConsole: false,
							...(overrides.debug === true ? { debug: true } : {}),
							...(overrides.onRender === undefined ? {} : { onRender: overrides.onRender }),
						});
						drainPerformance(drain);
						return instance;
					}),
					(instance) =>
						Effect.promise(async () => {
							// Ink drops a hook write once it has unmounted: the console goes back to the streams first.
							bridge.detach();
							// Ink's own unmount commits the last frame to the terminal; `clear()` is never called.
							instance.unmount();
							drainPerformance(drain);
							await instance.waitUntilExit().catch(() => undefined);
						}),
				);
			}).pipe(
				Scope.provide(scope),
				// A mount that fails or is interrupted partway releases what it took: the permit, the colour, the instance.
				Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : Scope.close(scope, exit))),
			);
			run = { scope, slot };
		});

		const endRun: Effect.Effect<void> = Effect.suspend(() => {
			const current = run;
			run = undefined;
			return current === undefined ? Effect.void : Scope.close(current.scope, Exit.void);
		});

		// A swap is committed by React in a microtask, not at once: wait for it, so the next event, or the unmount that
		// commits a run's last frame, sees it drawn.
		const draw: Effect.Effect<void> = Effect.suspend(() => {
			const current = run;
			if (current === undefined) return Effect.void;
			return Effect.flatMap(frameOf, (frame) =>
				Effect.callback<void>((resume) => {
					current.slot.swap(elementOf(frame), () => resume(Effect.void));
				}),
			).pipe(Effect.andThen(Effect.sync(() => drainPerformance(drain))));
		});

		const step = (event: E): Effect.Effect<void> =>
			Effect.suspend(() => {
				state = options.reduce(state, event);
				if (!interactive) return Effect.void;
				if (options.isTerminal(event)) return Effect.andThen(draw, endRun);
				// A start, or any event while nothing is mounted, begins a run; a start while mounted redraws in place.
				return run === undefined ? mountRun : draw;
			});

		const pull = yield* Stream.toPull(options.events);
		const drainEvents = Effect.forever(
			Effect.flatMap(pull, (chunk) => Effect.forEach(chunk, step, { discard: true })),
		).pipe(
			Pull.catchDone(() => Effect.void),
			// The stream ended mid-run: commit what is drawn.
			Effect.andThen(endRun),
		);
		// Started at once, so its first pull (which subscribes a PubSub-backed stream) happens before `live` returns.
		const fiber = yield* Effect.forkScoped(drainEvents, { startImmediately: true });
		// Registered last, so it runs first when the caller's scope closes: stop the drain, then end the run drawn.
		yield* Effect.addFinalizer(() => Fiber.interrupt(fiber).pipe(Effect.andThen(endRun)));
		return {
			state: Effect.sync(() => state),
			logConsole: bridge.writer,
			done: Fiber.join(fiber),
		};
	});
