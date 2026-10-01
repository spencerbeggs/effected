import { Console, Effect, Inspectable } from "effect";
import type { FunctionComponent, ReactNode } from "react";
import { UiStreams } from "../UiStreams.js";
import { inkModules } from "./ink.js";

/**
 * A `Console` that writes above a mounted Ink frame, the component that connects it, and the switch back to direct
 * writes.
 *
 * @internal
 */
export interface InkConsole {
	/**
	 * `log`, `info` and `debug` go to stdout and `error`, `warn` and `trace` to stderr, one line per call: through Ink's
	 * own writers while a `Bridge` is mounted and attached, so the line lands above the frame, and
	 * straight to `UiStreams` otherwise. Every other method is the ambient `Console`'s. Named `writer`, not `console`:
	 * the boundary scan's console rule has no scope analysis and would read the key as the global.
	 */
	readonly writer: Console.Console;
	/** Mounted inside the Ink tree, it hands Ink's writers to `writer`, and renders its children. */
	readonly Bridge: FunctionComponent<{ readonly children?: ReactNode }>;
	/** Write straight to the streams from now on, until a `Bridge` mounts again; call it before Ink's `unmount()`. */
	readonly detach: () => void;
}

type Write = (data: string) => void;

/** The line a console call writes: its arguments formatted as data (an object as JSON), joined by spaces. */
const lineOf = (args: ReadonlyArray<unknown>): string =>
	`${args.map((arg) => Inspectable.toStringUnknown(arg, 0)).join(" ")}\n`;

/**
 * Build an `InkConsole` over `UiStreams` and the ambient `Console` (`okf/decisions/live-logs-through-ink.md`).
 *
 * @remarks
 * Ink's writers (`useStdout().write`, `useStderr().write`) clear the frame, write the line and repaint the frame, so a
 * line written through them lands above the frame without tearing it; a raw write to the stream lands inside the frame
 * instead. They are reachable only from inside the tree, which is what the `Bridge` is for. Ink drops whatever they
 * are handed once it has unmounted, so the owner detaches before it unmounts, and a line written after goes straight
 * to the stream.
 *
 * @internal
 */
export const makeInkConsole: Effect.Effect<InkConsole> = Effect.gen(function* () {
	const streams = yield* UiStreams;
	const ambient = yield* Console.Console;
	let attached: { readonly out: Write; readonly err: Write } | undefined;
	const stdout: Write = (data) => {
		streams.stdout.write(data);
	};
	const stderr: Write = (data) => {
		streams.stderr.write(data);
	};
	const line =
		(pick: (writers: { readonly out: Write; readonly err: Write }) => Write, direct: Write) =>
		(...args: ReadonlyArray<unknown>): void => {
			const data = lineOf(args);
			if (attached === undefined) direct(data);
			else pick(attached)(data);
		};
	const toOut = line((writers) => writers.out, stdout);
	const toErr = line((writers) => writers.err, stderr);
	const writer: Console.Console = Object.assign(Object.create(ambient) as Console.Console, {
		log: toOut,
		info: toOut,
		debug: toOut,
		error: toErr,
		warn: toErr,
		trace: toErr,
	});
	const Bridge: InkConsole["Bridge"] = (props) => {
		const { ink, react } = inkModules();
		const out = ink.useStdout().write;
		const err = ink.useStderr().write;
		react.useLayoutEffect(() => {
			const writers = { out, err };
			attached = writers;
			// An unmount without a detach first also goes back to the streams, once Ink has let go of the tree.
			return () => {
				if (attached === writers) attached = undefined;
			};
		}, [out, err]);
		return props.children ?? null;
	};
	return {
		writer,
		Bridge,
		detach: () => {
			attached = undefined;
		},
	};
});
