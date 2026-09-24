import { Effect, Layer, Stdio, Stream } from "effect";
import { McpSchema } from "effect/unstable/ai";

const NEWLINE = 0x0a;
const NEWLINE_BYTES = new Uint8Array([NEWLINE]);

/**
 * The frame-size cap core's NDJSON decoder applies to one line, in the same
 * units: a longer line is forwarded unexamined so core's own cap reports it.
 *
 * @internal
 */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

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
 * complete lines were dropped for not being JSON.
 *
 * @internal
 */
export interface FrameGuardStep {
	readonly forward: Uint8Array | undefined;
	readonly parseErrors: number;
}

const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
	if (parts.length === 1) return parts[0] as Uint8Array;
	let length = 0;
	for (const part of parts) length += part.length;
	const out = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
};

const decoder = new TextDecoder();

const classify = (line: Uint8Array): "blank" | "json" | "unparseable" => {
	const text = decoder.decode(line);
	if (text.trim() === "") return "blank";
	try {
		JSON.parse(text);
		return "json";
	} catch {
		return "unparseable";
	}
};

/**
 * A stateful step over stdin chunks that forwards only complete lines that
 * parse as JSON, each with its newline.
 *
 * @remarks
 * Core's stdio decoder parses each line inside its read loop. A line that is
 * not JSON throws before the decoder advances past it, so the line stays at
 * the head of its buffer and every later chunk throws on it again: the server
 * never reads another frame. The guard drops such a line and counts it,
 * which the caller answers with {@link PARSE_ERROR_FRAME}.
 *
 * - A partial line is held until its newline arrives, as core does.
 * - A whitespace-only line is not a frame; it is dropped and not counted.
 * - A line longer than `maxFrameBytes` is forwarded unexamined, so core's own
 *   frame-size cap applies exactly as before.
 *
 * @internal
 */
export const makeFrameGuard = (maxFrameBytes: number = MAX_FRAME_BYTES): ((chunk: Uint8Array) => FrameGuardStep) => {
	let pending: Array<Uint8Array> = [];
	let pendingBytes = 0;
	// Forwarding an over-cap line to core until its newline.
	let passthrough = false;

	return (chunk) => {
		const out: Array<Uint8Array> = [];
		let parseErrors = 0;
		let start = 0;
		while (true) {
			const newline = chunk.indexOf(NEWLINE, start);
			if (newline === -1) {
				const rest = chunk.subarray(start);
				if (passthrough) {
					if (rest.length > 0) out.push(rest);
				} else if (rest.length > 0) {
					// Copied: a held line must not alias a chunk the source may reuse.
					pending.push(rest.slice());
					pendingBytes += rest.length;
					if (pendingBytes > maxFrameBytes) {
						out.push(...pending);
						pending = [];
						pendingBytes = 0;
						passthrough = true;
					}
				}
				break;
			}
			const lineStart = start;
			start = newline + 1;
			if (passthrough) {
				out.push(chunk.subarray(lineStart, start));
				passthrough = false;
				continue;
			}
			pending.push(chunk.subarray(lineStart, newline));
			const line = concat(pending);
			pending = [];
			pendingBytes = 0;
			const kind = line.length > maxFrameBytes ? "oversized" : classify(line);
			if (kind === "oversized" || kind === "json") out.push(line, NEWLINE_BYTES);
			else if (kind === "unparseable") parseErrors++;
		}
		return { forward: out.length === 0 ? undefined : concat(out), parseErrors };
	};
};

/**
 * `Stdio` whose `stdin` carries only JSON lines, answering each unparseable
 * line with {@link PARSE_ERROR_FRAME} on `stdout`. Everything else is the
 * ambient `Stdio`.
 *
 * @internal
 */
export const guardStdin = (stdio: Stdio.Stdio): Stdio.Stdio =>
	Stdio.make({
		args: stdio.args,
		stdinIsTerminal: stdio.stdinIsTerminal,
		stdoutIsTerminal: stdio.stdoutIsTerminal,
		stdout: (options) => stdio.stdout(options),
		stderr: (options) => stdio.stderr(options),
		// Fresh guard state per subscription: core re-subscribes to stdin after a failure.
		stdin: Stream.suspend(() => {
			const step = makeFrameGuard();
			return stdio.stdin.pipe(
				Stream.mapEffect((chunk) => {
					const { forward, parseErrors } = step(chunk);
					return parseErrors === 0
						? Effect.succeed(forward)
						: Stream.run(Stream.make(PARSE_ERROR_FRAME.repeat(parseErrors)), stdio.stdout()).pipe(Effect.as(forward));
				}),
				Stream.filter((chunk): chunk is Uint8Array => chunk !== undefined),
			);
		}),
	});

/**
 * Replaces the ambient `Stdio` with {@link guardStdin}'s, for the server
 * layer only.
 *
 * @internal
 */
export const GuardedStdio: Layer.Layer<Stdio.Stdio, never, Stdio.Stdio> = Layer.effect(
	Stdio.Stdio,
	Effect.map(Stdio.Stdio, guardStdin),
);
