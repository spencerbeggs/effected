import { Effect, Layer, Stdio, Stream } from "effect";
import { McpSchema } from "effect/unstable/ai";

/**
 * The line-length cap core's stdio NDJSON decoder applies, in the same unit
 * (UTF-16 code units of the decoded text) and with the same predicate
 * (`length > cap`). The guard answers a longer line itself, so no line core
 * would reject ever reaches core.
 *
 * @internal
 */
export const MAX_FRAME_LENGTH = 16 * 1024 * 1024;

/**
 * The JSON-RPC 2.0 answer to a frame that is not JSON, newline-framed. The id
 * is `null` because no id can be read from an unparseable frame.
 *
 * @internal
 */
export const PARSE_ERROR_FRAME = `${JSON.stringify({
	jsonrpc: "2.0",
	id: null,
	error: { code: McpSchema.PARSE_ERROR_CODE, message: "Parse error" },
})}\n`;

/**
 * One stdin chunk after the guard: the bytes to hand to core, and how many
 * lines the guard answered with a parse error instead.
 *
 * @internal
 */
export interface FrameGuardStep {
	readonly forward: Uint8Array | undefined;
	readonly parseErrors: number;
}

/** JSON's insignificant whitespace, minus the newline that ends the line. */
const BLANK = /^[ \t\r]*$/;

const isJson = (line: string): boolean => {
	try {
		JSON.parse(line);
		return true;
	} catch {
		return false;
	}
};

/**
 * A stateful step over stdin chunks that forwards only complete lines core's
 * decoder will parse, each with its newline.
 *
 * @remarks
 * Core's stdio decoder parses each line inside its read loop. A line that is
 * not JSON throws before the decoder advances past it, so the line stays at
 * the head of its buffer and every later chunk throws on it again: the server
 * never reads another frame. The guard frames stdin exactly as core does and
 * answers such a line itself, counting it for the caller to write
 * {@link PARSE_ERROR_FRAME}.
 *
 * - Decoding mirrors core: one streaming UTF-8 decoder, so a character split
 *   across chunks decodes whole, a byte-order mark is stripped only at the
 *   start of the stream, and a U+FEFF opening any later line stays in that
 *   line, where `JSON.parse` rejects it as core's would.
 * - A partial line is held until its newline arrives.
 * - A line of JSON whitespace only is not a frame: dropped, not answered.
 * - A line longer than `maxFrameLength` code units is answered once, as soon
 *   as the held part exceeds the cap, and the rest of it is discarded up to
 *   its newline. Nothing is held beyond the cap.
 *
 * Create one guard per stdin: its state must outlive core re-subscribing to
 * stdin after a failure, or a held partial line is lost.
 *
 * @internal
 */
export const makeFrameGuard = (maxFrameLength: number = MAX_FRAME_LENGTH): ((chunk: Uint8Array) => FrameGuardStep) => {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let pending = "";
	// Discarding the rest of an over-cap line, already answered, up to its newline.
	let discarding = false;

	return (chunk) => {
		const text = decoder.decode(chunk, { stream: true });
		let forward = "";
		let parseErrors = 0;
		let start = 0;
		if (discarding) {
			const newline = text.indexOf("\n");
			if (newline === -1) return { forward: undefined, parseErrors: 0 };
			discarding = false;
			start = newline + 1;
		}
		let newline = text.indexOf("\n", start);
		while (newline !== -1) {
			const line = pending + text.slice(start, newline);
			pending = "";
			start = newline + 1;
			newline = text.indexOf("\n", start);
			if (line.length > maxFrameLength || (!BLANK.test(line) && !isJson(line))) parseErrors++;
			else if (!BLANK.test(line)) forward += `${line}\n`;
		}
		pending += text.slice(start);
		if (pending.length > maxFrameLength) {
			pending = "";
			discarding = true;
			parseErrors++;
		}
		return { forward: forward === "" ? undefined : encoder.encode(forward), parseErrors };
	};
};

/**
 * `Stdio` whose `stdin` carries only lines core's decoder will parse,
 * answering every other line with {@link PARSE_ERROR_FRAME} on `stdout`.
 * Everything else is the ambient `Stdio`.
 *
 * @remarks
 * One guard per call, shared by every subscription to the returned `stdin`,
 * because core re-subscribes after a failure and builds its own decoder once.
 *
 * @internal
 */
export const guardStdin = (stdio: Stdio.Stdio): Stdio.Stdio => {
	const step = makeFrameGuard();
	return Stdio.make({
		args: stdio.args,
		stdinIsTerminal: stdio.stdinIsTerminal,
		stdoutIsTerminal: stdio.stdoutIsTerminal,
		stdout: (options) => stdio.stdout(options),
		stderr: (options) => stdio.stderr(options),
		stdin: stdio.stdin.pipe(
			Stream.mapEffect((chunk) => {
				const { forward, parseErrors } = step(chunk);
				return parseErrors === 0
					? Effect.succeed(forward)
					: Stream.run(Stream.make(PARSE_ERROR_FRAME.repeat(parseErrors)), stdio.stdout()).pipe(Effect.as(forward));
			}),
			Stream.filter((chunk): chunk is Uint8Array => chunk !== undefined),
		),
	});
};

/**
 * A layer replacing the ambient `Stdio` with {@link guardStdin}'s, for one
 * server layer only.
 *
 * @remarks
 * A function, never a module constant: layers memoize by reference, so one
 * shared constant is built once per graph, and a second server in that graph
 * would read the first server's guarded stdin. Each call mints a fresh layer;
 * `McpStdio.layer` calls it once per server.
 *
 * @internal
 */
export const makeGuardedStdio = (): Layer.Layer<Stdio.Stdio, never, Stdio.Stdio> =>
	Layer.effect(Stdio.Stdio, Effect.map(Stdio.Stdio, guardStdin));
