// `CliUi.routeStream` and its public types: the Node shell, a `Writable` a host hands to a library in place of a
// terminal stream, which feeds the pure line router (`internal/lineRouter.ts`). The fourth file the process-streams
// licence names (okf/decisions/ui-binds-process-streams.md): it imports `node:stream` and reads no `process`.

import { Writable } from "node:stream";
import type { LinePrinter } from "./internal/lineRouter.js";
import { makeLineRouter } from "./internal/lineRouter.js";

/**
 * Options for `CliUi.routeStream`.
 *
 * @public
 */
export interface RouteStreamOptions {
	/** Which of the printer's streams the lines belong on. */
	readonly stream: "stdout" | "stderr";
	/**
	 * The most characters held back waiting for a line break; 8192 by default. Past it, the held text is offered as a
	 * line of its own, so a writer that never ends a line cannot grow the buffer without bound.
	 */
	readonly maxHeld?: number | undefined;
	/**
	 * What a line holding a carriage return is printed as: `keep` (the default) prints it as written, and `last` prints
	 * only the text after its last `\r`, which is what a terminal would have shown of a progress bar redrawn in place.
	 * A CRLF line ending is a line ending either way. A line written to the original stream is always written as it came.
	 */
	readonly carriageReturn?: "keep" | "last" | undefined;
	/**
	 * Called with every piece of text written, decoded, before it is routed: a tap for a recorder.
	 *
	 * @remarks
	 * Every write reaches it, a write of nothing but escape sequences (a cursor hide, a clear-screen) included, though
	 * such a write is never offered to the printer. A write holding only the first bytes of a character reaches it when
	 * the character completes, or as U+FFFD at `flush`.
	 */
	readonly onText?: ((text: string) => void) | undefined;
}

/**
 * A stream routed line by line through a printer, from `CliUi.routeStream`.
 *
 * @public
 */
export interface RoutedStream {
	/**
	 * The stream to hand to the writer in place of the original. It reports the original's `isTTY`, `columns`, `rows`,
	 * `getColorDepth`, `hasColors` and `getWindowSize`, where the original has them, so a library that sizes its output
	 * to the terminal still sees one.
	 */
	readonly writable: Writable;
	/**
	 * Turn routing on (the default) or off. Turned off, the text held waiting for a line break is written to the
	 * original, and every later write goes straight to it, decoded, until routing is turned back on.
	 */
	readonly route: (on: boolean) => void;
	/**
	 * Offer the text held waiting for a line break to the printer now, or write it to the original if it declines.
	 * It ends the decoding too: a character split across writes whose second half has not arrived is written as
	 * U+FFFD. Ending `writable` (`end()`) flushes the same way, so a last line with no line break is never lost.
	 */
	readonly flush: () => void;
}

/** The terminal facts a writer reads off its stream, delegated only where the original carries them. */
const DELEGATED = ["isTTY", "columns", "rows", "getColorDepth", "hasColors", "getWindowSize"] as const;

const DEFAULT_MAX_HELD = 8192;

/** Run one `Writable` step and settle its callback: with nothing, or with what the step threw, as an `Error`. */
const guarded = (step: () => void, callback: (error?: Error | null) => void): void => {
	try {
		step();
		callback();
	} catch (error) {
		callback(error instanceof Error ? error : new Error(String(error)));
	}
};

/** @internal */
export const routeStream = (
	original: NodeJS.WritableStream,
	printer: LinePrinter,
	options: RouteStreamOptions,
): RoutedStream => {
	const maxHeld = options.maxHeld ?? DEFAULT_MAX_HELD;
	if (!Number.isInteger(maxHeld) || maxHeld < 0) {
		throw new RangeError(`CliUi.routeStream: maxHeld must be a non-negative integer, got ${String(maxHeld)}`);
	}
	const router = makeLineRouter({
		stream: options.stream,
		printer,
		write: (text) => {
			original.write(text);
		},
		maxHeld,
		carriageReturn: options.carriageReturn ?? "keep",
		onText: options.onText,
	});
	const writable = new Writable({
		decodeStrings: false,
		write(chunk: string | Uint8Array, _encoding, callback) {
			guarded(() => router.take(chunk), callback);
		},
		// `end()`: the last line, which no line break will ever complete, is flushed rather than lost.
		final(callback) {
			guarded(router.flush, callback);
		},
	});
	for (const key of DELEGATED) {
		if (!(key in original)) continue;
		// Read live, since a resize changes `columns`; a method is bound once per function it reads, not per access.
		let source: unknown;
		let bound: unknown;
		Object.defineProperty(writable, key, {
			configurable: true,
			enumerable: true,
			get: () => {
				const value = (original as unknown as Record<string, unknown>)[key];
				if (typeof value !== "function") return value;
				if (value !== source) {
					source = value;
					bound = value.bind(original);
				}
				return bound;
			},
		});
	}
	return { writable, route: router.route, flush: router.flush };
};
