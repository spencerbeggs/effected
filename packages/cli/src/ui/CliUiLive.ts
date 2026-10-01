// Root types are named through the package's own name, so the emitted ui.d.ts imports them from "@effected/cli".
import type * as Cli from "@effected/cli";
import { Audience } from "@effected/env";
import type { Console } from "effect";
import { Cause, Clock, Duration, Effect, Exit, Fiber, Option, Pull, Queue, Schedule, Scope, Stream } from "effect";
import type { FunctionComponent, ReactElement, ReactNode } from "react";
import { CliInteractive } from "../CliInteractive.js";
import { CliTheme, themeForAudience } from "../CliTheme.js";
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
	 * `useTerminalSize` work in it. When the final frame is printed as a string (not interactive, or a run that degraded
	 * before it painted), `useTerminalSize().rows` is `Infinity`, since that frame has no height to fit: a render must
	 * not allocate per row.
	 */
	readonly render: (state: S, frame: number) => ReactElement;
	/** Whether an event starts a run. */
	readonly isStart: (event: E) => boolean;
	/** Whether an event ends a run: its frame is committed to the terminal and the view unmounts until the next. */
	readonly isTerminal: (event: E) => boolean;
	/**
	 * `"owned"` (the default) for a view that owns its output, `"hosted"` for one drawn inside a host's (a test
	 * reporter). They differ only when the run is not interactive: owned writes each run's final frame once, as a
	 * string; hosted writes nothing, its host having its own output.
	 */
	readonly mode?: "owned" | "hosted";
	/**
	 * The frame tick, in milliseconds; 80 by default. While a run is drawn the view redraws on every tick, so a spinner
	 * turns without events. Anything but a positive, finite number is a defect.
	 */
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
	 * A `Console` whose every method writes above the frame while a run is mounted, and straight to the stream otherwise;
	 * none falls through to the program's own console. Output is split as Node's console splits it: `log`, `info`,
	 * `debug`, `dir`, `dirxml`, `table`, `count`, `timeLog`, `timeEnd` and a group's label to stdout, and `error`,
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
		// The content keeps its own height (`flexShrink: 0`) and the clamp clips it: left to shrink, Yoga squeezes every
		// row of a tall column into the height, and Ink draws a scattered sample of them, or nothing.
		return react.createElement(
			ink.Box,
			{ flexDirection: "column", maxHeight: rows, overflow: "hidden" },
			react.createElement(ink.Box, { flexDirection: "column", flexShrink: 0 }, props.children),
		);
	};
	HeightClamp.displayName = "CliUiLiveHeightClamp";
	return HeightClamp;
});

/**
 * What the controller acts on: a chunk of events, a tick, a render failure to look at, the end of the stream, or the
 * stream's death.
 */
type Message<E> =
	| { readonly _tag: "Events"; readonly chunk: ReadonlyArray<E> }
	| { readonly _tag: "Tick"; readonly frame: number }
	| { readonly _tag: "Failed" }
	| { readonly _tag: "Ended" }
	| { readonly _tag: "Died"; readonly cause: Cause.Cause<never> };

/** What is mounted for a run: its scope (permit, colour, Ink instance, tick) and the slot that swaps its frame. */
interface Mounted {
	readonly scope: Scope.Closeable;
	readonly slot: HolderSlot;
}

/** A run, from its first event to its terminal one, mounted or not. */
interface Run<S> {
	mounted: Mounted | undefined;
	/** A render failed, or the mount did: the run is unmounted and draws nothing more. */
	degraded: boolean;
	/** A frame of this run was committed to the terminal. */
	painted: boolean;
	/** The error a render threw, reported by the error boundary, not yet acted on. */
	failed: { readonly error: unknown } | undefined;
	/** The frame index last drawn. */
	frame: number;
	/** The last state and frame committed, which the boundary draws in place of a frame that threw. */
	good: { readonly state: S; readonly frame: number } | undefined;
}

const TICK_INVALID = (tickMillis: number): string =>
	`@effected/cli/ui: CliUi.live's tickMillis must be a positive, finite number of milliseconds, not ${tickMillis}`;

const DEGRADED = (error: unknown): string =>
	`@effected/cli/ui: the live view stopped drawing this run, and will draw its last frame when it ends: ${
		error instanceof Error ? error.message : String(error)
	}`;

/**
 * `CliUi.live`, kept in its own module: see `CliUi.live` for the contract.
 *
 * @internal
 */
export const live = <E, S>(
	options: LiveOptions<E, S>,
): Effect.Effect<LiveHandle<S>, never, Scope.Scope | Cli.CliTheme> =>
	Effect.gen(function* () {
		const tickMillis = options.tickMillis ?? 80;
		if (!(Number.isFinite(tickMillis) && tickMillis > 0)) return yield* Effect.die(new Error(TICK_INVALID(tickMillis)));
		// An agent never gets an escape of any kind, whatever the terminal could do: it sees the theme at colour none, as
		// `Render.context` does, both as Ink's colour level and as the theme the tree reads (its `paint`, its colour-none
		// markers). Read only when provided, so `Audience` stays out of the requirements.
		const audience = yield* Effect.serviceOption(Audience);
		const theme = themeForAudience(
			(yield* CliTheme).forStream("stdout"),
			Option.isSome(audience) ? audience.value.kind : undefined,
		);
		const colour = theme.color;
		const interactive = yield* CliInteractive;
		const streams = yield* UiStreams;
		const overrides = yield* UiRenderOptions;
		const drain = yield* resolveDrain(options.drainPerformance ?? "auto");
		const bridge = yield* makeInkConsole;
		const inbox = yield* Queue.unbounded<Message<E>>();

		let state = options.initial;
		let run: Run<S> | undefined;

		// The consumer's render runs inside React, under an error boundary, never in a fiber of the kit's.
		const Frame = (props: { readonly state: S; readonly frame: number }): ReactElement =>
			options.render(props.state, props.frame);
		const frameOf = Effect.map(Clock.currentTimeMillis, (now) => Math.floor(now / tickMillis));
		const elementOf = (shown: S, frame: number): ReactElement =>
			inkModules().react.createElement(Frame, { state: shown, frame });

		/** Unmount what a run has mounted: Ink's own unmount commits the last frame. Nothing is written after it. */
		const unmount = (current: Run<S>): Effect.Effect<void> =>
			Effect.suspend(() => {
				const mounted = current.mounted;
				current.mounted = undefined;
				return mounted === undefined ? Effect.void : Scope.close(mounted.scope, Exit.void);
			});

		/** Stop drawing a run: unmount first, so the one warning never lands inside a frame (ruling P1), then warn. */
		const degrade = (current: Run<S>, error: unknown): Effect.Effect<void> =>
			Effect.suspend(() => {
				if (current.degraded) return unmount(current);
				current.degraded = true;
				return Effect.andThen(unmount(current), Effect.logWarning(DEGRADED(error)));
			});

		/** Act on a failure the boundary reported for the run mounted now, if any. */
		const checkFailure: Effect.Effect<void> = Effect.suspend(() => {
			const current = run;
			const failed = current?.failed;
			return current === undefined || failed === undefined ? Effect.void : degrade(current, failed.error);
		});

		/** The final frame as a string, at the stdout width (80 when it reports none) and with no height to fit. */
		const printFrame = (current: Run<S>): Effect.Effect<void> =>
			Effect.gen(function* () {
				const { ink, react } = yield* loadInk;
				const frame = yield* frameOf;
				const reported = streams.stdout.columns;
				const columns = reported !== undefined && reported > 0 ? reported : 80;
				let failure: { readonly error: unknown } | undefined;
				const tree = react.createElement(errorBoundary(), {
					onError: (error) => {
						failure ??= { error };
					},
					children: uiProviders(
						{ theme, glyphs: theme.glyphs, size: { columns, rows: Number.POSITIVE_INFINITY } },
						elementOf(state, frame),
					),
				});
				const text = yield* Effect.scoped(
					Effect.andThen(
						withInkColour(colour),
						Effect.sync(() => ink.renderToString(tree, { columns })),
					),
				);
				drainPerformance(drain);
				if (failure !== undefined) {
					// Already said once for a degraded run; a run that never mounted says it here.
					if (!current.degraded) {
						current.degraded = true;
						yield* Effect.logWarning(DEGRADED(failure.error));
					}
					return;
				}
				bridge.print(text);
			});

		/** Mount a run's view with the current state, its tick beside it; a failure degrades the run. */
		const mount = (current: Run<S>): Effect.Effect<void> =>
			Effect.gen(function* () {
				const scope = yield* Scope.make("sequential");
				const slot = holderSlot();
				// Recorded before anything is acquired, so the close-time finalizer finds and closes it however an interrupt
				// lands: mid-acquisition, or after the acquisition returns and before this fiber resumes.
				current.mounted = { scope, slot };
				const report = (error: unknown): void => {
					current.failed ??= { error };
					Queue.offerUnsafe(inbox, { _tag: "Failed" });
				};
				yield* Effect.gen(function* () {
					// One Ink mount at a time, process-wide, held for this run only: a `CliUi.run` between runs mounts.
					yield* Effect.acquireRelease(mountPermit.take(1), () => mountPermit.release(1), { interruptible: true });
					yield* Effect.acquireRelease(
						Effect.sync(() => overrides.onMount?.()),
						() => Effect.sync(() => overrides.onUnmount?.(undefined)),
					);
					const { ink, react } = yield* loadInk;
					yield* withInkColour(colour);
					const frame = yield* frameOf;
					const initial = elementOf(state, frame);
					const shown = state;
					// A frame that throws is replaced by the last good one, guarded in turn, so the run's last frame stays.
					const lastGood = (): ReactElement | null => {
						const good = current.good;
						return good === undefined
							? null
							: react.createElement(errorBoundary(), {
									// The last good frame threw as well: nothing of this run is left on the terminal, so its end
									// prints the final frame as a string.
									onError: () => {
										current.painted = false;
									},
									children: elementOf(good.state, good.frame),
								});
					};
					const tree = react.createElement(errorBoundary(), {
						onError: report,
						children: uiProviders(
							{ theme, glyphs: theme.glyphs },
							react.createElement(
								bridge.Bridge,
								null,
								react.createElement(
									heightClamp(),
									null,
									react.createElement(errorBoundary(), {
										onError: report,
										fallback: lastGood,
										children: react.createElement(holder(), { initial, bind: slot.bind }),
									}),
								),
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
					// The tick, in the run's scope: interrupted with the run, so no timer outlives it (probe L7).
					yield* Effect.forkIn(
						// The frame index is read when the tick fires, so a frame is never skipped while the controller is busy.
						Effect.repeat(
							Effect.flatMap(frameOf, (at) => Queue.offer(inbox, { _tag: "Tick", frame: at })),
							Schedule.spaced(Duration.millis(tickMillis)),
						),
						scope,
					);
					current.frame = frame;
					if (current.failed === undefined) {
						current.painted = true;
						current.good = { state: shown, frame };
					}
				}).pipe(
					Scope.provide(scope),
					// A mount that fails or is interrupted partway releases what it took: the permit, the colour, the instance.
					Effect.onExit((exit) =>
						Exit.isSuccess(exit)
							? Effect.void
							: Effect.andThen(
									Effect.sync(() => {
										if (current.mounted?.scope === scope) current.mounted = undefined;
									}),
									Scope.close(scope, exit),
								),
					),
				);
				yield* checkFailure;
			}).pipe(
				Effect.catchCause((cause) =>
					Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : degrade(current, Cause.squash(cause)),
				),
			);

		/**
		 * Push the current state to the mounted run, at `at` or the clock's frame, and wait for React to commit it; a
		 * frame that throws degrades the run.
		 */
		const drawAt = (at: number | undefined): Effect.Effect<void> =>
			Effect.suspend(() => {
				const current = run;
				const mounted = current?.mounted;
				if (current === undefined || mounted === undefined) return Effect.void;
				const shown = state;
				return Effect.gen(function* () {
					const frame = at ?? (yield* frameOf);
					yield* Effect.callback<void>((resume) => {
						mounted.slot.swap(elementOf(shown, frame), () => resume(Effect.void));
					});
					drainPerformance(drain);
					current.frame = frame;
					if (current.failed === undefined) {
						current.painted = true;
						current.good = { state: shown, frame };
					}
					yield* checkFailure;
				});
			});
		const draw = drawAt(undefined);

		/** End the run: unmount, which commits its frame; a degraded run that never painted prints its frame instead. */
		const endRun: Effect.Effect<void> = Effect.suspend(() => {
			const current = run;
			run = undefined;
			if (current === undefined) return Effect.void;
			if (!interactive) return options.mode === "hosted" ? Effect.void : printFrame(current);
			return Effect.andThen(unmount(current), current.painted ? Effect.void : printFrame(current));
		});

		const beginRun: Effect.Effect<void> = Effect.suspend(() => {
			const current: Run<S> = {
				mounted: undefined,
				degraded: false,
				painted: false,
				failed: undefined,
				frame: 0,
				good: undefined,
			};
			run = current;
			return interactive ? mount(current) : Effect.void;
		});

		/** Fold a chunk, starting and ending runs at its events, and draw once for what is left of it. */
		const onChunk = (chunk: ReadonlyArray<E>): Effect.Effect<void> =>
			Effect.gen(function* () {
				let dirty = false;
				for (const event of chunk) {
					const folded = yield* Effect.try({ try: () => options.reduce(state, event), catch: (error) => error }).pipe(
						// A reducer that throws: unmount first, then the drain dies with the error.
						Effect.catch((error) =>
							Effect.andThen(
								Effect.suspend(() => (run === undefined ? Effect.void : unmount(run))),
								Effect.die(error),
							),
						),
					);
					state = folded;
					if (options.isTerminal(event)) {
						if (dirty || run !== undefined) yield* draw;
						dirty = false;
						yield* endRun;
					} else if (run === undefined) {
						// A start, or any event while no run is going, begins one; a start during a run redraws in place.
						yield* beginRun;
						dirty = false;
					} else {
						dirty = true;
					}
				}
				if (dirty) yield* draw;
			});

		const onTick = (frame: number): Effect.Effect<void> =>
			Effect.suspend(() => {
				const current = run;
				// A tick that waited in the inbox past a later draw is stale: the spinner never steps back.
				return current?.mounted === undefined || frame <= current.frame ? Effect.void : drawAt(frame);
			});

		const control: Effect.Effect<void> = Effect.gen(function* () {
			while (true) {
				// Everything queued at once, in order. Event chunks that arrived together are folded as one chunk and drawn
				// once, so a controller that lags behind its stream catches up in one draw, not one per chunk.
				const messages = yield* Queue.takeAll(inbox);
				let pending: Array<E> = [];
				const flush = Effect.suspend(() => {
					const chunk = pending;
					pending = [];
					return chunk.length === 0 ? Effect.void : onChunk(chunk);
				});
				for (const message of messages) {
					if (message._tag === "Events") {
						pending.push(...message.chunk);
						continue;
					}
					yield* flush;
					switch (message._tag) {
						case "Tick":
							yield* onTick(message.frame);
							break;
						case "Failed":
							yield* checkFailure;
							break;
						case "Ended":
							// The stream ended mid-run: commit what is drawn, or print it.
							return yield* endRun;
						case "Died":
							// The stream died: unmount first, as for a reducer that throws, then die with its cause.
							yield* Effect.suspend(() => {
								const current = run;
								run = undefined;
								return current === undefined ? Effect.void : unmount(current);
							});
							return yield* Effect.failCause(message.cause);
					}
				}
				yield* flush;
			}
		});

		const pull = yield* Stream.toPull(options.events);
		const pump = Effect.forever(Effect.flatMap(pull, (chunk) => Queue.offer(inbox, { _tag: "Events", chunk }))).pipe(
			Pull.catchDone(() => Queue.offer(inbox, { _tag: "Ended" })),
			// A stream that dies tells the controller, which would otherwise wait for an event that never comes.
			Effect.catchCause((cause) =>
				Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Queue.offer(inbox, { _tag: "Died", cause }),
			),
		);
		// Started at once, so its first pull (which subscribes a PubSub-backed stream) happens before `live` returns.
		const pumping = yield* Effect.forkScoped(pump, { startImmediately: true });
		const controlling = yield* Effect.forkScoped(Effect.onExit(control, () => Fiber.interrupt(pumping)));
		// Registered last, so it runs first when the caller's scope closes: stop the fold, then unmount what is drawn.
		// Nothing more is written: a run cut off by the close prints nothing.
		yield* Effect.addFinalizer(() =>
			Effect.andThen(
				Fiber.interruptAll([controlling, pumping]),
				Effect.suspend(() => {
					const current = run;
					run = undefined;
					return current === undefined ? Effect.void : unmount(current);
				}),
			),
		);
		return {
			state: Effect.sync(() => state),
			logConsole: bridge.writer,
			done: Fiber.join(controlling),
		};
	});
