// The pure half of `CliUi.routeStream`: decoding, line buffering with a cap, the escape-only pass-through and the
// routing decision, with no stream in sight. `routeStream.ts` is the Node `Writable` shell around it.

import { isEscapeOnly } from "../../internal/displayWidth.js";

/**
 * Where a routed line is offered first: `true` when it was printed (above a live view's frame), `false` with nothing
 * written when it was not, and the router writes it to the original stream instead.
 *
 * @internal
 */
export type LinePrinter = (stream: "stdout" | "stderr", line: string) => boolean;

/** @internal */
export interface LineRouterOptions {
	readonly stream: "stdout" | "stderr";
	readonly printer: LinePrinter;
	/** Writes text to the original stream: decoded, so a character split across writes arrives whole. */
	readonly write: (text: string) => void;
	readonly maxHeld: number;
	readonly carriageReturn: "keep" | "last";
	readonly onText?: ((text: string) => void) | undefined;
}

/** @internal */
export interface LineRouter {
	readonly take: (chunk: string | Uint8Array) => void;
	readonly route: (on: boolean) => void;
	readonly flush: () => void;
}

/** The text a printer is handed for one line: a CRLF's `\r` dropped, and under `last` only what the line ends on. */
const printable = (line: string, carriageReturn: "keep" | "last"): string => {
	const text = line.endsWith("\r") ? line.slice(0, -1) : line;
	if (carriageReturn === "keep") return text;
	const cut = text.lastIndexOf("\r");
	return cut === -1 ? text : text.slice(cut + 1);
};

/** @internal */
export const makeLineRouter = (options: LineRouterOptions): LineRouter => {
	// One decoder for every byte chunk, routed or not, so a character split across two writes is decoded once, whole,
	// whichever path its two halves take. Everything written to the original is the decoded text.
	const decoder = new TextDecoder("utf-8");
	let held = "";
	let routing = true;

	const offer = (line: string): void => {
		if (!options.printer(options.stream, printable(line, options.carriageReturn))) options.write(`${line}\n`);
	};

	const route = (text: string): void => {
		if (text === "") return;
		if (!routing) {
			options.write(text);
			return;
		}
		// A cursor hide, a clear-screen: nothing to print above a frame, and held back it would land late. One that
		// arrives mid-line is held with the line instead, so its place in the text is kept.
		if (held === "" && isEscapeOnly(text)) {
			options.write(text);
			return;
		}
		// No line break: nothing completes, so the text joins what is held, offered as a line of its own past the cap.
		if (!text.includes("\n")) {
			held += text;
			if (held.length > options.maxHeld) {
				const line = held;
				held = "";
				offer(line);
			}
			return;
		}
		const lines = (held + text).split("\n");
		const rest = lines.pop() ?? "";
		if (rest.length > options.maxHeld) {
			lines.push(rest);
			held = "";
		} else {
			held = rest;
		}
		for (const line of lines) offer(line);
	};

	return {
		take: (chunk) => {
			const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
			if (text !== "") options.onText?.(text);
			route(text);
		},
		route: (on) => {
			if (!on && held !== "") {
				options.write(held);
				held = "";
			}
			routing = on;
		},
		flush: () => {
			// The decoder's pending bytes, as text: a partial character at the end of input becomes U+FFFD.
			const pending = decoder.decode();
			if (pending !== "") options.onText?.(pending);
			const text = held + pending;
			held = "";
			if (text === "") return;
			if (!routing || !options.printer(options.stream, printable(text, options.carriageReturn))) options.write(text);
		},
	};
};
