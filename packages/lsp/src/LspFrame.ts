import { Effect, Result, Schema, Stream } from "effect";

/** The longest header block, terminator excluded, the decoder buffers before failing `HeaderTooLarge`. */
const MAX_HEADER_BYTES = 8192;
/** How many bytes of an offending header an error echoes. */
const EXCERPT_BYTES = 80;
const CR = 13;
const LF = 10;
const EMPTY = new Uint8Array(0);
// Identity-compared end-of-stream marker `decodeStream` appends; never a caller's chunk.
const END = new Uint8Array(0);
const encoder = new TextEncoder();
// `fatal`: a body that is not valid UTF-8 is an error, never a U+FFFD substitution.
const utf8 = new TextDecoder("utf-8", { fatal: true });
const lenient = new TextDecoder("utf-8");
// The body codec: JSON text to any JSON value, and back.
const JsonValue = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeUnknownResult(JsonValue);
const encodeJson = Schema.encodeUnknownSync(JsonValue);
// An RFC 9110 field-name token.
const FIELD_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DIGITS = /^[0-9]+$/;

/**
 * Why a byte stream is not a sequence of LSP base-protocol frames.
 *
 * @remarks
 * - `MissingContentLength`: the header block has no `Content-Length` field.
 * - `InvalidContentLength`: a `Content-Length` that is not one decimal,
 *   non-negative safe integer, or a second `Content-Length` field.
 * - `InvalidHeader`: a header line that is not `Name: value`, or a header
 *   byte outside ASCII. A server that writes a log line to stdout before its
 *   first frame lands here, because the stray text joins the header block.
 * - `HeaderTooLarge`: more than 8 KiB without the `\r\n\r\n` terminator. The
 *   decoder refuses to buffer an unterminated header without bound.
 * - `InvalidBody`: the body is not valid UTF-8 or not valid JSON.
 * - `Truncated`: the input ended inside a frame.
 *
 * @public
 */
export const LspFrameErrorCode = Schema.Literals([
	"MissingContentLength",
	"InvalidContentLength",
	"InvalidHeader",
	"HeaderTooLarge",
	"InvalidBody",
	"Truncated",
]);

/**
 * The `code` of an {@link LspFrameError}.
 *
 * @public
 */
export type LspFrameErrorCode = typeof LspFrameErrorCode.Type;

/**
 * A byte stream that is not a sequence of LSP base-protocol frames.
 *
 * @remarks
 * `offset` is the stream position of the offending frame's first byte, so a
 * caller can point at it; `excerpt` echoes up to 80 bytes of the frame's
 * start, JSON-quoted so control characters stay visible; `cause` carries the
 * UTF-8 or JSON failure of an `InvalidBody` as the original value, never a
 * stringified copy. `message` is derived from those fields when read.
 *
 * @public
 */
export class LspFrameError extends Schema.TaggedError<LspFrameError>()("LspFrameError", {
	/** Which rule the frame broke; see {@link (LspFrameErrorCode:variable)}. */
	code: LspFrameErrorCode,
	/** The stream position of the offending frame's first byte. */
	offset: Schema.Number,
	/** Up to 80 bytes of the frame's start, JSON-quoted. */
	excerpt: Schema.optionalKey(Schema.String),
	/** The UTF-8 or JSON failure behind an `InvalidBody`. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const at = `the LSP frame at byte ${this.offset}`;
		const detail =
			this.code === "MissingContentLength"
				? `${at} has no Content-Length header`
				: this.code === "InvalidContentLength"
					? `${at} has a Content-Length that is not one non-negative decimal integer`
					: this.code === "InvalidHeader"
						? `${at} has a header line that is not an ASCII "Name: value" field`
						: this.code === "HeaderTooLarge"
							? `${at} has no \\r\\n\\r\\n header terminator within ${MAX_HEADER_BYTES} bytes`
							: this.code === "InvalidBody"
								? `${at} has a body that is not UTF-8 JSON`
								: `the input ended inside ${at}`;
		return this.excerpt === undefined ? detail : `${detail}: ${this.excerpt}`;
	}
}

/**
 * What {@link LspFrame.decodeResult} decoded from one buffer.
 *
 * @public
 */
export interface LspFrameDecoded {
	/** Every complete frame's parsed JSON body, in order. */
	readonly messages: ReadonlyArray<unknown>;
	/** The bytes of an incomplete trailing frame, copied; prepend them to the next chunk. Empty when the buffer ended on a frame boundary. */
	readonly rest: Uint8Array;
}

const excerptOf = (bytes: Uint8Array, start: number): string =>
	JSON.stringify(lenient.decode(bytes.subarray(start, Math.min(bytes.length, start + EXCERPT_BYTES))));

const frameError = (code: LspFrameErrorCode, offset: number, bytes: Uint8Array, start: number): LspFrameError =>
	LspFrameError.make({ code, offset, excerpt: excerptOf(bytes, start) });

/** The index of the `\r\n\r\n` that ends the header starting at `from`, or -1, scanning at most the header cap. */
const headerEnd = (bytes: Uint8Array, from: number): number => {
	const limit = Math.min(bytes.length - 3, from + MAX_HEADER_BYTES + 1);
	for (let i = from; i < limit; i++) {
		if (bytes[i] === CR && bytes[i + 1] === LF && bytes[i + 2] === CR && bytes[i + 3] === LF) return i;
	}
	return -1;
};

const isOptionalWhitespace = (code: number): boolean => code === 0x20 || code === 0x09;

/**
 * `value` without leading and trailing spaces and tabs (a header value's optional whitespace). An index scan, not a
 * regex: a trailing-whitespace pattern backtracks quadratically over a long run of whitespace followed by anything
 * else, and header bytes are untrusted input.
 */
const trimOptionalWhitespace = (value: string): string => {
	let start = 0;
	let end = value.length;
	while (start < end && isOptionalWhitespace(value.charCodeAt(start))) start++;
	while (end > start && isOptionalWhitespace(value.charCodeAt(end - 1))) end--;
	return value.slice(start, end);
};

/** The `Content-Length` of the header block `bytes[from, to)`, or the code it breaks. */
const contentLength = (bytes: Uint8Array, from: number, to: number): number | LspFrameErrorCode => {
	let text = "";
	for (let i = from; i < to; i++) {
		const byte = bytes[i] ?? 0;
		if (byte > 0x7f) return "InvalidHeader";
		text += String.fromCharCode(byte);
	}
	if (text === "") return "MissingContentLength";
	let length: number | undefined;
	for (const line of text.split("\r\n")) {
		const colon = line.indexOf(":");
		if (colon <= 0 || line.includes("\r") || line.includes("\n")) return "InvalidHeader";
		const name = line.slice(0, colon);
		if (!FIELD_NAME.test(name)) return "InvalidHeader";
		if (name.toLowerCase() !== "content-length") continue;
		const value = trimOptionalWhitespace(line.slice(colon + 1));
		if (length !== undefined || !DIGITS.test(value)) return "InvalidContentLength";
		const parsed = Number(value);
		if (!Number.isSafeInteger(parsed)) return "InvalidContentLength";
		length = parsed;
	}
	return length ?? "MissingContentLength";
};

const concatBytes = (left: Uint8Array, right: Uint8Array): Uint8Array => {
	if (left.length === 0) return right;
	if (right.length === 0) return left;
	const joined = new Uint8Array(left.length + right.length);
	joined.set(left, 0);
	joined.set(right, left.length);
	return joined;
};

const decodeResult = (bytes: Uint8Array, offset = 0): Result.Result<LspFrameDecoded, LspFrameError> => {
	const messages: Array<unknown> = [];
	let position = 0;
	while (position < bytes.length) {
		const start = position;
		const end = headerEnd(bytes, start);
		if (end === -1 ? bytes.length - start - 3 > MAX_HEADER_BYTES : end - start > MAX_HEADER_BYTES) {
			return Result.fail(frameError("HeaderTooLarge", offset + start, bytes, start));
		}
		if (end === -1) break;
		const length = contentLength(bytes, start, end);
		if (typeof length === "string") return Result.fail(frameError(length, offset + start, bytes, start));
		const bodyStart = end + 4;
		if (bodyStart + length > bytes.length) break;
		const body = bytes.subarray(bodyStart, bodyStart + length);
		let text: string;
		try {
			text = utf8.decode(body);
		} catch (cause) {
			return Result.fail(
				LspFrameError.make({ code: "InvalidBody", offset: offset + start, excerpt: excerptOf(bytes, start), cause }),
			);
		}
		const value = decodeJson(text);
		if (Result.isFailure(value)) {
			return Result.fail(
				LspFrameError.make({
					code: "InvalidBody",
					offset: offset + start,
					excerpt: excerptOf(bytes, start),
					cause: value.failure,
				}),
			);
		}
		messages.push(value.success);
		position = bodyStart + length;
	}
	return Result.succeed({ messages, rest: bytes.slice(position) });
};

const decodeAllResult = (input: Uint8Array | string): Result.Result<ReadonlyArray<unknown>, LspFrameError> => {
	const bytes = typeof input === "string" ? encoder.encode(input) : input;
	return Result.flatMap(decodeResult(bytes), ({ messages, rest }) =>
		rest.length === 0
			? Result.succeed(messages)
			: Result.fail(frameError("Truncated", bytes.length - rest.length, rest, 0)),
	);
};

/**
 * The LSP base protocol's framing: a `Content-Length` header block, a blank
 * line, and a UTF-8 JSON body of exactly that many bytes.
 *
 * @remarks
 * `Content-Length` counts **bytes**, never characters. A hand-rolled frame
 * that writes `body.length` is correct for ASCII and wrong by one for every
 * extra byte of a multi-byte character, so the server reads into the next
 * frame and the session fails far from the cause; {@link LspFrame.encode}
 * counts the UTF-8 encoding.
 *
 * The decoder is incremental and pure: {@link LspFrame.decodeResult} takes a
 * buffer and returns every complete frame plus the bytes of an incomplete
 * trailing one, so a chunk boundary may fall anywhere — inside a header,
 * inside a body, inside a multi-byte character — and one chunk may carry
 * several frames. {@link LspFrame.decodeStream} threads that state across a
 * `Stream` of chunks.
 *
 * Header fields end `\r\n` and the block ends `\r\n\r\n`; field names are
 * case-insensitive; unknown fields such as `Content-Type` are accepted and
 * ignored. A header longer than 8 KiB without its terminator fails rather
 * than buffering without bound.
 *
 * @example
 * ```ts
 * import { LspFrame } from "@effected/lsp";
 * import { Result } from "effect";
 *
 * const bytes = LspFrame.encode({ jsonrpc: "2.0", method: "exit" });
 * const decoded = LspFrame.decodeAllResult(bytes);
 * console.log(Result.isSuccess(decoded) ? decoded.success : decoded.failure.message);
 * // => [ { jsonrpc: '2.0', method: 'exit' } ]
 * ```
 *
 * @public
 */
export class LspFrame {
	private constructor() {}

	/**
	 * Frame one message: `Content-Length: N\r\n\r\n` followed by its JSON text,
	 * where `N` is the UTF-8 byte length of that text.
	 *
	 * @remarks
	 * A value JSON cannot encode (a `bigint`, a cycle) is a caller bug and
	 * throws; nothing a server sends reaches this function.
	 */
	static encode(message: unknown): Uint8Array {
		const body = encoder.encode(encodeJson(message));
		const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
		return concatBytes(header, body);
	}

	/**
	 * Decode every complete frame at the front of `bytes`, returning their
	 * bodies and the bytes of an incomplete trailing frame.
	 *
	 * @remarks
	 * The sync primitive; {@link LspFrame.decode} is its spanned `Effect`
	 * form. `offset` is the stream position of `bytes[0]` (default 0), so an
	 * error names a stream position rather than a buffer index. To decode a
	 * stream by hand, keep `rest`, prepend it to the next chunk, and advance
	 * `offset` by the bytes consumed.
	 */
	static decodeResult(bytes: Uint8Array, offset?: number): Result.Result<LspFrameDecoded, LspFrameError> {
		return decodeResult(bytes, offset);
	}

	/** The `Effect` form of {@link LspFrame.decodeResult}, behind the `LspFrame.decode` span. */
	static readonly decode = Effect.fn("LspFrame.decode")((bytes: Uint8Array, offset?: number) =>
		Effect.fromResult(decodeResult(bytes, offset)),
	);

	/**
	 * Decode a complete buffer — a collected stdout — into its messages.
	 *
	 * @remarks
	 * A string is UTF-8 encoded first, so its byte counts are honoured.
	 * Leftover bytes after the last complete frame fail `Truncated`. The sync
	 * primitive; {@link LspFrame.decodeAll} is the spanned `Effect` form.
	 */
	static decodeAllResult(input: Uint8Array | string): Result.Result<ReadonlyArray<unknown>, LspFrameError> {
		return decodeAllResult(input);
	}

	/** The `Effect` form of {@link LspFrame.decodeAllResult}, behind the `LspFrame.decodeAll` span. */
	static readonly decodeAll = Effect.fn("LspFrame.decodeAll")((input: Uint8Array | string) =>
		Effect.fromResult(decodeAllResult(input)),
	);

	/**
	 * Decode a stream of byte chunks into a stream of message bodies.
	 *
	 * @remarks
	 * Chunk boundaries may fall anywhere. A malformed frame fails the stream
	 * with an {@link LspFrameError}; a stream that ends inside a frame fails
	 * `Truncated`, so a server that dies mid-write is never read as a clean end.
	 */
	static decodeStream<E, R>(self: Stream.Stream<Uint8Array, E, R>): Stream.Stream<unknown, E | LspFrameError, R> {
		return Stream.concat(self, Stream.succeed(END)).pipe(
			Stream.mapAccumEffect(
				(): { readonly rest: Uint8Array; readonly offset: number } => ({ rest: EMPTY, offset: 0 }),
				(state, chunk) => {
					if (chunk === END) {
						return state.rest.length === 0
							? Effect.succeed([state, []] as const)
							: Effect.fail(frameError("Truncated", state.offset, state.rest, 0));
					}
					const buffer = concatBytes(state.rest, chunk);
					return Effect.map(Effect.fromResult(decodeResult(buffer, state.offset)), ({ messages, rest }) => [
						{ rest, offset: state.offset + buffer.length - rest.length },
						messages,
					]);
				},
			),
		);
	}
}
