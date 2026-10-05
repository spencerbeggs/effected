import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema, Stream } from "effect";
import type { LspFrameError } from "../src/index.js";
import { LspFrame } from "../src/index.js";

const encoder = new TextEncoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);
const text = (data: Uint8Array): string => new TextDecoder().decode(data);

/** A frame whose header the test writes by hand, so the test does not trust `encode` to build its inputs. */
const raw = (body: string, header = `Content-Length: ${encoder.encode(body).length}`): string =>
	`${header}\r\n\r\n${body}`;

const failureOf = <A>(result: Result.Result<A, LspFrameError>): LspFrameError => {
	if (Result.isFailure(result)) return result.failure;
	return assert.fail(`expected a frame error, got ${JSON.stringify(result.success)}`);
};

/** Split `data` at each cut (taken modulo its length), the way a pipe might. */
const chunked = (data: Uint8Array, cuts: ReadonlyArray<number>): ReadonlyArray<Uint8Array> => {
	const points = [...new Set(cuts.map((cut) => (data.length === 0 ? 0 : cut % data.length)))].sort((a, b) => a - b);
	const chunks: Array<Uint8Array> = [];
	let from = 0;
	for (const point of points) {
		chunks.push(data.subarray(from, point));
		from = point;
	}
	chunks.push(data.subarray(from));
	return chunks;
};

describe("LspFrame.encode", () => {
	it("counts UTF-8 bytes, not UTF-16 code units", () => {
		const message = { jsonrpc: "2.0", method: "note", params: { text: "é✓🚀" } };
		const json = JSON.stringify(message);
		const frame = text(LspFrame.encode(message));
		// é is 2 bytes, ✓ 3, 🚀 4 (and 2 UTF-16 units): bytes exceed .length by 1 + 2 + 2.
		assert.strictEqual(encoder.encode(json).length, json.length + 5);
		assert.strictEqual(frame, `Content-Length: ${json.length + 5}\r\n\r\n${json}`);
	});

	it("frames an ASCII message exactly as the specification spells it", () => {
		assert.strictEqual(
			text(LspFrame.encode({ jsonrpc: "2.0", method: "exit" })),
			'Content-Length: 33\r\n\r\n{"jsonrpc":"2.0","method":"exit"}',
		);
	});
});

describe("LspFrame.decodeResult", () => {
	it("decodes several frames in one buffer and returns an incomplete tail as rest", () => {
		const input = bytes(`${raw('{"a":1}')}${raw('{"b":"✓"}')}Content-Length: 9\r\n\r\n{"c"`);
		const decoded = Result.getOrThrow(LspFrame.decodeResult(input));
		assert.deepStrictEqual(decoded.messages, [{ a: 1 }, { b: "✓" }]);
		assert.strictEqual(text(decoded.rest), 'Content-Length: 9\r\n\r\n{"c"');
	});

	it("holds a frame whose header is not yet terminated", () => {
		const decoded = Result.getOrThrow(LspFrame.decodeResult(bytes("Content-Length: 2\r\n")));
		assert.deepStrictEqual(decoded.messages, []);
		assert.strictEqual(text(decoded.rest), "Content-Length: 2\r\n");
	});

	it("returns a copy, so the rest survives the caller reusing its buffer", () => {
		const input = bytes("Content-Le");
		const { rest } = Result.getOrThrow(LspFrame.decodeResult(input));
		input.fill(0);
		assert.strictEqual(text(rest), "Content-Le");
	});

	it("accepts a Content-Type field and any case of Content-Length", () => {
		const input = bytes(
			raw('{"x":true}', "content-length: 10\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8"),
		);
		assert.deepStrictEqual(Result.getOrThrow(LspFrame.decodeResult(input)).messages, [{ x: true }]);
	});

	it("trims spaces and tabs around the Content-Length value, and only those", () => {
		const input = bytes(raw('{"x":true}', "Content-Length: \t 10 \t"));
		assert.deepStrictEqual(Result.getOrThrow(LspFrame.decodeResult(input)).messages, [{ x: true }]);
		assert.strictEqual(
			failureOf(LspFrame.decodeResult(bytes(raw("{}", "Content-Length: 2 x")))).code,
			"InvalidContentLength",
		);
	});

	it("reads Content-Length as bytes: a char-counted header swallows the next frame's first bytes", () => {
		const body = '{"t":"🚀"}';
		const charCounted = `Content-Length: ${body.length}\r\n\r\n${body}${raw("{}")}`;
		// The body is 12 bytes but 10 UTF-16 units: decoding 10 bytes splits the rocket.
		const error = failureOf(LspFrame.decodeResult(bytes(charCounted)));
		assert.strictEqual(error.code, "InvalidBody");
		assert.strictEqual(error.offset, 0);
	});

	it.each([
		["MissingContentLength", raw("{}", "Content-Type: application/json")],
		["MissingContentLength", "\r\n\r\n{}"],
		["InvalidContentLength", raw("{}", "Content-Length: two")],
		["InvalidContentLength", raw("{}", "Content-Length: -2")],
		["InvalidContentLength", raw("{}", "Content-Length: 2\r\nContent-Length: 2")],
		["InvalidContentLength", raw("{}", "Content-Length: 99999999999999999999")],
		["InvalidHeader", `server starting\n${raw("{}")}`],
		["InvalidHeader", raw("{}", "Content-Length 2")],
		["InvalidHeader", raw("{}", "Contént-Length: 2")],
		["InvalidBody", raw("{nope")],
		["InvalidBody", raw("")],
	] as const)("fails %s on %j", (code, input) => {
		const error = failureOf(LspFrame.decodeResult(bytes(input)));
		assert.strictEqual(error._tag, "LspFrameError");
		assert.strictEqual(error.code, code);
	});

	it("fails InvalidBody with the original UTF-8 failure as cause", () => {
		const input = new Uint8Array([...bytes("Content-Length: 1\r\n\r\n"), 0xff]);
		const error = failureOf(LspFrame.decodeResult(input));
		assert.strictEqual(error.code, "InvalidBody");
		assert.instanceOf(error.cause, TypeError);
	});

	it("names the offending frame's stream position and echoes its start", () => {
		const input = bytes(`${raw("{}")}junk\r\n\r\n`);
		const error = failureOf(LspFrame.decodeResult(input, 100));
		assert.strictEqual(error.code, "InvalidHeader");
		assert.strictEqual(error.offset, 100 + raw("{}").length);
		assert.strictEqual(error.excerpt, JSON.stringify("junk\r\n\r\n"));
		assert.include(error.message, `byte ${100 + raw("{}").length}`);
	});

	it("refuses an unterminated header past 8 KiB instead of buffering it", () => {
		const atCap = Result.getOrThrow(LspFrame.decodeResult(bytes("X".repeat(8192 + 3))));
		assert.strictEqual(atCap.rest.length, 8192 + 3, "at the cap it is still a header in progress");
		const error = failureOf(LspFrame.decodeResult(bytes("X".repeat(8192 + 4))));
		assert.strictEqual(error.code, "HeaderTooLarge");
	});
});

describe("LspFrame.decodeAllResult", () => {
	it("decodes a collected stdout given as a string, honouring byte counts", () => {
		const stdout = `${raw('{"n":"é"}')}${raw('{"n":"🚀"}')}`;
		assert.deepStrictEqual(Result.getOrThrow(LspFrame.decodeAllResult(stdout)), [{ n: "é" }, { n: "🚀" }]);
	});

	it("fails Truncated on leftover bytes, at their stream position", () => {
		const error = failureOf(LspFrame.decodeAllResult(`${raw("{}")}Content-Length: 5\r\n\r\n{}`));
		assert.strictEqual(error.code, "Truncated");
		assert.strictEqual(error.offset, raw("{}").length);
	});
});

describe("LspFrame effect forms", () => {
	it.effect("decode and decodeAll carry the frame error in the typed channel", () =>
		Effect.gen(function* () {
			const decoded = yield* LspFrame.decode(bytes(raw("[1]")));
			assert.deepStrictEqual(decoded.messages, [[1]]);
			const error = yield* Effect.flip(LspFrame.decodeAll(bytes("Content-Length: x\r\n\r\n")));
			assert.strictEqual(error.code, "InvalidContentLength");
		}),
	);
});

describe("LspFrame.decodeStream", () => {
	it.effect("decodes frames split one byte per chunk", () =>
		Effect.gen(function* () {
			const data = bytes(`${raw('{"a":"✓"}')}${raw('{"b":"🚀"}')}`);
			const single = Array.from(data, (byte) => new Uint8Array([byte]));
			const messages = yield* Stream.runCollect(LspFrame.decodeStream(Stream.fromIterable(single)));
			assert.deepStrictEqual(messages, [{ a: "✓" }, { b: "🚀" }]);
		}),
	);

	it.effect("fails Truncated when the stream ends inside a frame", () =>
		Effect.gen(function* () {
			const chunks = [bytes(raw("{}")), bytes('Content-Length: 4\r\n\r\n{"')];
			const error = yield* Effect.flip(Stream.runCollect(LspFrame.decodeStream(Stream.fromIterable(chunks))));
			assert.strictEqual(error._tag, "LspFrameError");
			assert.strictEqual(error._tag === "LspFrameError" ? error.code : undefined, "Truncated");
			assert.strictEqual(error._tag === "LspFrameError" ? error.offset : undefined, raw("{}").length);
		}),
	);

	it.effect("reports a bad frame at its stream position across chunks", () =>
		Effect.gen(function* () {
			const chunks = [bytes(raw("{}")), bytes("Content-Length: z\r\n\r\n")];
			const error = yield* Effect.flip(Stream.runCollect(LspFrame.decodeStream(Stream.fromIterable(chunks))));
			assert.strictEqual(error._tag === "LspFrameError" ? error.offset : undefined, raw("{}").length);
		}),
	);

	it.effect("an empty stream decodes to nothing", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* Stream.runCollect(LspFrame.decodeStream(Stream.empty)), []);
		}),
	);
});

// Multi-byte glyphs, so every generated body exercises bytes != UTF-16 units.
const Glyph = Schema.Literals(["a", "é", "✓", "🚀"]);
const Sample = Schema.Struct({
	messages: Schema.NonEmptyArray(
		Schema.Struct({ method: Schema.String, text: Schema.String, glyph: Glyph, n: Schema.Int }),
	),
	cuts: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4096 }))),
});

describe("LspFrame properties", () => {
	it.effect.prop(
		"decoding the concatenated encodings, chunked anywhere, returns the messages in order",
		[Sample],
		([sample]) =>
			Effect.gen(function* () {
				const messages = sample.messages.map(({ method, text, glyph, n }) => ({
					jsonrpc: "2.0",
					method,
					// The generator emits -0, which JSON writes as 0: normalise it so the round trip is exact.
					params: { text: `${glyph}${text}${glyph}`, n: n === 0 ? 0 : n },
				}));
				const parts = messages.map((message) => LspFrame.encode(message));
				const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
				let at = 0;
				for (const part of parts) {
					whole.set(part, at);
					at += part.length;
				}
				const decoded = yield* Stream.runCollect(
					LspFrame.decodeStream(Stream.fromIterable(chunked(whole, sample.cuts))),
				);
				assert.deepStrictEqual(decoded, messages);
				assert.deepStrictEqual(Result.getOrThrow(LspFrame.decodeAllResult(whole)), messages);
			}),
	);

	it.effect.prop("every Content-Length equals the UTF-8 byte length of its body", [Sample], ([sample]) =>
		Effect.sync(() => {
			for (const { method, text: body, glyph } of sample.messages) {
				const frame = LspFrame.encode({ jsonrpc: "2.0", method, params: `${glyph}${body}` });
				const separator = text(frame).indexOf("\r\n\r\n");
				const declared = Number(/^Content-Length: (\d+)$/.exec(text(frame).slice(0, separator))?.[1]);
				assert.strictEqual(declared, frame.length - encoder.encode(text(frame).slice(0, separator + 4)).length);
			}
		}),
	);
});
