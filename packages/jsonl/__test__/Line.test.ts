import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { Line, LineSlice, MalformedLine } from "../src/index.js";

/** UTF-8 byte length, computed independently of the implementation under test. */
const bytes = (text: string): number => new TextEncoder().encode(text).length;

/** A 4-byte astral character (U+1F600) and a 3-byte BMP character. */
const EMOJI = "\u{1F600}";
const SNOWMAN = "☃";

describe("Line", () => {
	describe("byteLength", () => {
		it("counts UTF-8 bytes, not UTF-16 code units", () => {
			assert.strictEqual(Line.byteLength(""), 0);
			assert.strictEqual(Line.byteLength("abc"), 3);
			assert.strictEqual(Line.byteLength(SNOWMAN), 3);
			assert.strictEqual(Line.byteLength(EMOJI), 4);
			// The trap: "\u{1F600}".length is 2 in UTF-16 but 4 bytes in UTF-8.
			assert.strictEqual(EMOJI.length, 2);
			assert.notStrictEqual(Line.byteLength(EMOJI), EMOJI.length);
		});

		it("encodes a lone surrogate as the 3-byte replacement character", () => {
			const lone = "\ud800";
			assert.strictEqual(Line.byteLength(lone), bytes(lone));
			assert.strictEqual(Line.byteLength(lone), 3);
		});

		it("offsets an unpaired surrogate by its ENCODED width, which is lossy", () => {
			// A lone surrogate has no UTF-8 encoding; it becomes U+FFFD on write. The
			// offsets describe the bytes that would be written, so they stay correct
			// against the file — but the character itself does not survive a round
			// trip. Text read back from a UTF-8 file can never contain one.
			const lone = "\ud800";
			const [line] = Line.split(`${lone}\n`);
			assert.strictEqual(line?.length, 3);
			assert.strictEqual(line?.end, 4);
			const roundTripped = new TextDecoder().decode(new TextEncoder().encode(lone));
			assert.notStrictEqual(roundTripped, lone);
			assert.strictEqual(roundTripped, "�");
		});
	});

	describe("split", () => {
		it("returns no lines for empty input", () => {
			assert.deepStrictEqual(Line.split(""), []);
		});

		it("splits a terminated single line without synthesizing a trailing empty line", () => {
			const lines = Line.split('{"a":1}\n');
			assert.strictEqual(lines.length, 1);
			assert.strictEqual(lines[0]?.text, '{"a":1}');
			assert.strictEqual(lines[0]?.offset, 0);
			assert.strictEqual(lines[0]?.length, 7);
			assert.strictEqual(lines[0]?.end, 8);
			assert.strictEqual(lines[0]?.terminated, true);
		});

		it("marks an unterminated final line as unterminated", () => {
			const lines = Line.split('{"a":1}');
			assert.strictEqual(lines.length, 1);
			assert.strictEqual(lines[0]?.terminated, false);
			assert.strictEqual(lines[0]?.end, 7);
		});

		it("treats a lone newline as one empty terminated line", () => {
			const lines = Line.split("\n");
			assert.strictEqual(lines.length, 1);
			assert.strictEqual(lines[0]?.text, "");
			assert.strictEqual(lines[0]?.offset, 0);
			assert.strictEqual(lines[0]?.end, 1);
			assert.strictEqual(lines[0]?.terminated, true);
		});

		it("tracks BYTE offsets across multi-byte characters", () => {
			const text = `{"a":"${EMOJI}"}\n{"b":"${SNOWMAN}"}\n`;
			const lines = Line.split(text);
			assert.strictEqual(lines.length, 2);
			// first line: {"a":"<4 bytes>"} == 6 + 4 + 2 == 12 bytes
			assert.strictEqual(lines[0]?.offset, 0);
			assert.strictEqual(lines[0]?.length, bytes(`{"a":"${EMOJI}"}`));
			assert.strictEqual(lines[0]?.end, lines[0].length + 1);
			// second line starts immediately after the first line's terminator
			assert.strictEqual(lines[1]?.offset, lines[0]?.end);
			assert.strictEqual(lines[1]?.length, bytes(`{"b":"${SNOWMAN}"}`));
			assert.strictEqual(lines[1]?.end, bytes(text));
		});

		it("does not treat a newline inside a JSON string payload as a line break", () => {
			// The escaped \n is two source characters, not a terminator.
			const text = '{"note":"line1\\nline2"}\n';
			const lines = Line.split(text);
			assert.strictEqual(lines.length, 1);
			assert.strictEqual(lines[0]?.text, '{"note":"line1\\nline2"}');
		});

		it("treats CR LF as the terminator and excludes the CR from the content", () => {
			const lines = Line.split('{"a":1}\r\n{"b":2}\r\n');
			assert.strictEqual(lines.length, 2);
			assert.strictEqual(lines[0]?.text, '{"a":1}');
			assert.strictEqual(lines[0]?.length, 7);
			assert.strictEqual(lines[0]?.end, 9, "CRLF is two terminator bytes");
			assert.strictEqual(lines[1]?.offset, 9);
			assert.strictEqual(lines[1]?.end, 18);
		});

		it("keeps a bare CR as content, since only LF terminates", () => {
			const lines = Line.split("a\rb\n");
			assert.strictEqual(lines.length, 1);
			assert.strictEqual(lines[0]?.text, "a\rb");
		});

		it("reports interior blank lines as lines with correct offsets", () => {
			const lines = Line.split('{"a":1}\n\n{"b":2}\n');
			assert.strictEqual(lines.length, 3);
			assert.strictEqual(lines[1]?.text, "");
			assert.strictEqual(lines[1]?.offset, 8);
			assert.strictEqual(lines[1]?.end, 9);
			assert.strictEqual(lines[2]?.offset, 9);
		});

		it("produces plain records that satisfy the LineSlice schema", () => {
			const lines = Line.split("x\n");
			assert.isTrue(Schema.is(LineSlice)(lines[0]));
			assert.strictEqual(Object.getPrototypeOf(lines[0]), Object.prototype, "a plain record, not a class instance");
		});
	});

	describe("split with a base offset", () => {
		it("shifts every offset and end by the base, leaving lengths and text alone", () => {
			const text = `{"a":"${EMOJI}"}\r\n\n{"b":`;
			const base = 1000;
			const shifted = Line.split(text, base);
			const unshifted = Line.split(text);
			assert.strictEqual(shifted.length, 3);
			assert.deepStrictEqual(
				shifted,
				unshifted.map((line) => ({ ...line, offset: line.offset + base, end: line.end + base })),
			);
			assert.strictEqual(shifted[0]?.offset, base, "the first line starts AT the base, not at zero");
			assert.strictEqual(shifted.at(-1)?.end, base + bytes(text));
		});

		it("is the same as no base when the base is zero", () => {
			assert.deepStrictEqual(Line.split('{"a":1}\n', 0), Line.split('{"a":1}\n'));
		});

		it("returns no lines for empty input whatever the base", () => {
			assert.deepStrictEqual(Line.split("", 42), []);
		});
	});

	describe("parseResult", () => {
		it("parses a JSON object line", () => {
			const [line] = Line.split('{"a":1}\n');
			assert.isDefined(line);
			const result = Line.parseResult(line);
			assert.isTrue(Result.isSuccess(result));
			if (Result.isSuccess(result)) {
				assert.deepStrictEqual(result.success, { a: 1 }, "the parsed value itself, not a wrapper");
			}
		});

		it("parses non-object JSON values — the envelope contract is a later layer", () => {
			for (const source of ["5", '"text"', "null", "true", "[1,2]"]) {
				const [line] = Line.split(source);
				assert.isDefined(line);
				assert.isTrue(Result.isSuccess(Line.parseResult(line)), source);
			}
		});

		it("fails typed with MalformedLine on invalid JSON, carrying the slice", () => {
			const [line] = Line.split('{"a":');
			assert.isDefined(line);
			const result = Line.parseResult(line);
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.instanceOf(result.failure, MalformedLine);
				assert.strictEqual(result.failure.line.offset, 0);
				assert.strictEqual(result.failure.line.text, '{"a":');
				assert.strictEqual(result.failure.line.terminated, false);
			}
		});

		it("fails typed rather than throwing on a blank line", () => {
			const [line] = Line.split("\n");
			assert.isDefined(line);
			assert.isTrue(Result.isFailure(Line.parseResult(line)));
		});

		it("does not pollute Object.prototype via a __proto__ key", () => {
			const [line] = Line.split('{"__proto__":{"polluted":true}}');
			assert.isDefined(line);
			const result = Line.parseResult(line);
			assert.isTrue(Result.isSuccess(result));
			assert.isUndefined(Reflect.get({}, "polluted"));
			assert.isUndefined(Reflect.get(Object.prototype, "polluted"));
		});

		it("parses pathologically deep nesting without a defect — V8's parser is iterative", () => {
			// Probed on node v26.5.0: JSON.parse succeeds at 1k, 10k, 100k, 200k and
			// 1M depth, so there is no RangeError path to assert on this engine. The
			// `try/catch` in parseResult stays as cross-engine defense — an engine
			// with a recursive parser would throw here, and a throw escaping the
			// module would be a defect no Effect.catch* combinator can see.
			const deep = `${"[".repeat(200_000)}1${"]".repeat(200_000)}`;
			const [line] = Line.split(deep);
			assert.isDefined(line);
			const result = Line.parseResult(line);
			assert.isTrue(Result.isSuccess(result), "deep nesting parses rather than throwing on V8");
		});
	});

	describe("hardening", () => {
		it.effect("fails through the typed channel, never as a defect", () =>
			Effect.gen(function* () {
				const [line] = Line.split("{oh no");
				assert.isDefined(line);
				const exit = yield* Effect.exit(Effect.fromResult(Line.parseResult(line)));
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					assert.isTrue(Cause.hasFails(exit.cause), "malformed input is a typed failure");
					assert.isFalse(Cause.hasDies(exit.cause), "malformed input is never a defect");
				}
			}),
		);

		it("never throws for any of the shapes a real journal produces", () => {
			const shapes = [
				"",
				"\n",
				"\n\n",
				"   ",
				"{",
				'{"a":1}',
				'{"a":1}\n',
				'{"a":1}\r\n',
				'{"a":1}\n{"b":',
				`{"a":"${EMOJI}"}\n`,
				"\ud800\n",
				'{"__proto__":1}\n',
				"null\n",
			];
			for (const shape of shapes) {
				// NOT `assert.doesNotThrow(fn, label)`: chai reads that second argument
				// as an error-MESSAGE MATCHER, so any throw whose message differs from
				// the label passes straight through and the assertion is dead.
				let threw: unknown;
				try {
					for (const line of Line.split(shape)) {
						Line.parseResult(line);
					}
					Line.split(shape, 7);
				} catch (error) {
					threw = error;
				}
				assert.isUndefined(threw, `shape ${JSON.stringify(shape)} threw: ${String(threw)}`);
			}
		});
	});
});
