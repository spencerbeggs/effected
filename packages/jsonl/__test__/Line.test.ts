import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option, Result } from "effect";
import { Line, LineSlice, MalformedLine, ParsedLine } from "../src/index.js";

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

		it("produces a LineSlice instance", () => {
			const lines = Line.split("x\n");
			assert.instanceOf(lines[0], LineSlice);
		});
	});

	describe("consumedOffset", () => {
		it("is zero for empty input", () => {
			assert.strictEqual(Line.consumedOffset(""), 0);
		});

		it("is the whole length when every line is terminated", () => {
			const text = '{"a":1}\n{"b":2}\n';
			assert.strictEqual(Line.consumedOffset(text), bytes(text));
		});

		it("excludes a torn (unterminated) tail so its bytes are not consumed", () => {
			const text = '{"a":1}\n{"b":';
			assert.strictEqual(Line.consumedOffset(text), 8);
			assert.isBelow(Line.consumedOffset(text), bytes(text));
		});

		it("excludes a torn tail that is itself valid JSON", () => {
			// A complete-looking final line with no newline may still be mid-write.
			const text = '{"a":1}\n{"b":2}';
			assert.strictEqual(Line.consumedOffset(text), 8);
		});

		it("counts multi-byte terminated lines in bytes", () => {
			const text = `{"a":"${EMOJI}"}\n`;
			assert.strictEqual(Line.consumedOffset(text), bytes(text));
		});
	});

	describe("parseResult", () => {
		it("parses a JSON object line", () => {
			const [line] = Line.split('{"a":1}\n');
			assert.isDefined(line);
			const result = Line.parseResult(line);
			assert.isTrue(Result.isSuccess(result));
			if (Result.isSuccess(result)) {
				assert.instanceOf(result.success, ParsedLine);
				assert.deepStrictEqual(result.success.value, { a: 1 });
				assert.strictEqual(result.success.line.offset, 0);
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

	describe("parseAll", () => {
		it("returns one Result per non-blank line, in source order", () => {
			const results = Line.parseAll('{"a":1}\n{"b":2}\n');
			assert.strictEqual(results.length, 2);
			assert.isTrue(results.every(Result.isSuccess));
		});

		it("reports a malformed INTERIOR line instead of dropping it", () => {
			const results = Line.parseAll('{"a":1}\nnot json\n{"b":2}\n');
			assert.strictEqual(results.length, 3, "the hole is reported, not skipped");
			assert.deepStrictEqual(results.map(Result.isSuccess), [true, false, true]);
		});

		it("carries byte offsets that address the malformed line in the source", () => {
			const source = '{"a":1}\nnot json\n{"b":2}\n';
			const results = Line.parseAll(source);
			const failure = results[1];
			assert.isDefined(failure);
			assert.isTrue(Result.isFailure(failure));
			if (Result.isFailure(failure)) {
				const { offset, length } = failure.failure.line;
				const encoded = new TextEncoder().encode(source);
				const slice = new TextDecoder().decode(encoded.slice(offset, offset + length));
				assert.strictEqual(slice, "not json");
			}
		});

		it("skips whitespace-only lines rather than reporting them as corruption", () => {
			const results = Line.parseAll('{"a":1}\n\n   \n{"b":2}\n');
			assert.strictEqual(results.length, 2);
			assert.isTrue(results.every(Result.isSuccess));
		});

		it("reports an unterminated torn tail as a failure", () => {
			const results = Line.parseAll('{"a":1}\n{"b":');
			assert.strictEqual(results.length, 2);
			assert.deepStrictEqual(results.map(Result.isSuccess), [true, false]);
		});
	});

	describe("lastValid", () => {
		it("is none for empty input", () => {
			assert.isTrue(Option.isNone(Line.lastValid("")));
		});

		it("is none when no line parses", () => {
			assert.isTrue(Option.isNone(Line.lastValid("nope\nalso nope\n")));
		});

		it("returns the last line of a well-formed journal", () => {
			const last = Line.lastValid('{"n":1}\n{"n":2}\n{"n":3}\n');
			assert.isTrue(Option.isSome(last));
			if (Option.isSome(last)) {
				assert.deepStrictEqual(last.value.value, { n: 3 });
			}
		});

		it("walks back past a torn final line — the killed-writer case", () => {
			const last = Line.lastValid('{"n":1}\n{"n":2}\n{"n":');
			assert.isTrue(Option.isSome(last));
			if (Option.isSome(last)) {
				assert.deepStrictEqual(last.value.value, { n: 2 });
				assert.strictEqual(last.value.line.offset, 8);
				assert.strictEqual(last.value.line.terminated, true);
			}
		});

		it("walks back past several malformed trailing lines", () => {
			const last = Line.lastValid('{"n":1}\nbroken\nalso broken\n{"n"');
			assert.isTrue(Option.isSome(last));
			if (Option.isSome(last)) {
				assert.deepStrictEqual(last.value.value, { n: 1 });
			}
		});

		it("ignores trailing blank lines", () => {
			const last = Line.lastValid('{"n":1}\n\n   \n');
			assert.isTrue(Option.isSome(last));
			if (Option.isSome(last)) {
				assert.deepStrictEqual(last.value.value, { n: 1 });
			}
		});

		it("CANNOT detect a torn tail that truncates to valid JSON — a scalar line", () => {
			// Truncating `42` mid-write leaves `4`, which parses as a DIFFERENT value.
			// The walk-back has nothing to walk back over, so it returns the fragment.
			// This is a real limit of the JSON layer, recorded rather than hidden: the
			// envelope layer closes it, because `4` is not an envelope.
			const last = Line.lastValid('{"n":1}\n4');
			assert.isTrue(Option.isSome(last));
			if (Option.isSome(last)) {
				assert.strictEqual(last.value.value, 4, "the fragment parses — detection is the envelope layer's job");
				assert.strictEqual(last.value.line.terminated, false, "but it is flagged unterminated");
			}
		});

		it("DOES detect a torn tail that truncates an object, whatever the cut point", () => {
			const line = '{"event":"unlinked","data":null}';
			for (let keep = 1; keep < line.length; keep++) {
				const last = Line.lastValid(`{"n":1}\n${line.slice(0, keep)}`);
				assert.isTrue(Option.isSome(last), `keep=${keep}`);
				if (Option.isSome(last)) {
					assert.deepStrictEqual(last.value.value, { n: 1 }, `keep=${keep}`);
				}
			}
		});

		it("accepts an unterminated final line that does parse", () => {
			const last = Line.lastValid('{"n":1}\n{"n":2}');
			assert.isTrue(Option.isSome(last));
			if (Option.isSome(last)) {
				assert.deepStrictEqual(last.value.value, { n: 2 });
				assert.strictEqual(last.value.line.terminated, false);
			}
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
					Line.split(shape);
					Line.parseAll(shape);
					Line.lastValid(shape);
					Line.consumedOffset(shape);
				} catch (error) {
					threw = error;
				}
				assert.isUndefined(threw, `shape ${JSON.stringify(shape)} threw: ${String(threw)}`);
			}
		});
	});
});
