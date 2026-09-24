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
 * The JSON-RPC 2.0 answer to a frame that is JSON but no JSON-RPC message
 * core can handle, newline-framed. The id is `null` because such a frame
 * carries no usable id.
 *
 * @internal
 */
export const INVALID_REQUEST_FRAME = `${JSON.stringify({
	jsonrpc: "2.0",
	id: null,
	error: { code: McpSchema.INVALID_REQUEST_ERROR_CODE, message: "Invalid Request" },
})}\n`;

/**
 * One stdin chunk after the guard: the bytes to hand to core, and the reply
 * frames the guard answered lines with instead, in stdin order.
 *
 * @internal
 */
export interface FrameGuardStep {
	readonly forward: Uint8Array | undefined;
	readonly replies: ReadonlyArray<string>;
}

/** JSON's insignificant whitespace, minus the newline that ends the line. */
const BLANK = /^[ \t\r]*$/;

const isNullish = (value: unknown): boolean => value === null || value === undefined;

/**
 * The guard's answer to one non-blank line within the cap, or `undefined` to
 * forward it to core.
 *
 * @remarks
 * A frame that parses is forwarded unless core would throw on it or ignore
 * it without a reply, which JSON-RPC 2.0 calls an Invalid Request:
 *
 * - a value that is neither an object nor an array: core throws on `null`,
 *   dropping every other frame in its chunk, and ignores a number, string or
 *   boolean without a reply;
 * - an object with a `method` that is not a string and no usable `id`: core
 *   throws on it, dropping the rest of its chunk (with an `id`, core answers
 *   `-32601` itself);
 * - an object with neither `method` nor `id`: every JSON-RPC request carries a
 *   `method` and every response an `id`, so it is neither, and core ignores it
 *   as a response to nothing.
 *
 * Arrays are forwarded: core answers a batch `-32600` itself. So is any object
 * with an `id` and no `method`, which is a response; JSON-RPC never answers a
 * response.
 */
const answerFor = (line: string): string | undefined => {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return PARSE_ERROR_FRAME;
	}
	if (typeof value !== "object" || value === null) return INVALID_REQUEST_FRAME;
	if (Array.isArray(value)) return undefined;
	const message = value as { readonly method?: unknown; readonly id?: unknown };
	if (Object.hasOwn(message, "method")) {
		return typeof message.method !== "string" && isNullish(message.id) ? INVALID_REQUEST_FRAME : undefined;
	}
	return Object.hasOwn(message, "id") ? undefined : INVALID_REQUEST_FRAME;
};

/**
 * A stateful step over stdin chunks that forwards only complete lines core's
 * decoder will parse and answer, each with its newline.
 *
 * @remarks
 * Core's stdio decoder parses each line inside its read loop. A line that is
 * not JSON throws before the decoder advances past it, so the line stays at
 * the head of its buffer and every later chunk throws on it again: the server
 * never reads another frame. A line that is JSON but no JSON-RPC message core
 * can handle either throws inside the decoder, dropping the frames after it in
 * the same chunk, or is ignored without a reply. The guard frames stdin
 * exactly as core does and answers such a line itself, returning
 * {@link PARSE_ERROR_FRAME} or {@link INVALID_REQUEST_FRAME} for the caller
 * to write.
 *
 * - Decoding mirrors core: one streaming UTF-8 decoder, so a character split
 *   across chunks decodes whole, a byte-order mark is stripped only at the
 *   start of the stream, and a U+FEFF opening any later line stays in that
 *   line, where `JSON.parse` rejects it as core's would.
 * - A partial line is held until its newline arrives.
 * - A line of JSON whitespace only is not a frame: dropped, not answered.
 * - A line that is JSON is answered `-32600` when it is not an object or an
 *   array, when its `method` is not a string and it has no usable `id`, or
 *   when it has neither `method` nor `id`; everything else goes to core.
 * - A line longer than `maxFrameLength` code units is answered once, as soon
 *   as the held part exceeds the cap, and the rest of it is discarded up to
 *   its newline. Nothing is held beyond the cap.
 *
 * Create one guard per stdin: its state must outlive core re-subscribing to
 * stdin after any failure in its read loop, or a held partial line is lost.
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
		const replies: Array<string> = [];
		let start = 0;
		if (discarding) {
			const newline = text.indexOf("\n");
			if (newline === -1) return { forward: undefined, replies };
			discarding = false;
			start = newline + 1;
		}
		let newline = text.indexOf("\n", start);
		while (newline !== -1) {
			const line = pending + text.slice(start, newline);
			pending = "";
			start = newline + 1;
			newline = text.indexOf("\n", start);
			if (line.length > maxFrameLength) {
				replies.push(PARSE_ERROR_FRAME);
				continue;
			}
			if (BLANK.test(line)) continue;
			const answer = answerFor(line);
			if (answer === undefined) forward += `${line}\n`;
			else replies.push(answer);
		}
		pending += text.slice(start);
		if (pending.length > maxFrameLength) {
			pending = "";
			discarding = true;
			replies.push(PARSE_ERROR_FRAME);
		}
		return { forward: forward === "" ? undefined : encoder.encode(forward), replies };
	};
};

/**
 * `Stdio` whose `stdin` carries only lines core's decoder will parse and
 * answer, writing the guard's reply to every other line on `stdout`: one
 * write per chunk, replies in stdin order. Everything else is the ambient
 * `Stdio`.
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
				const { forward, replies } = step(chunk);
				return replies.length === 0
					? Effect.succeed(forward)
					: Stream.run(Stream.make(replies.join("")), stdio.stdout()).pipe(Effect.as(forward));
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
