import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";
import { FastCheck } from "effect/testing";
import { Line } from "../src/index.js";

// Array form ONLY: the named-record form of it.effect.prop silently discards
// Schema conversion (see packages/glob/__test__/compliance.test.ts).

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const byteLength = (text: string): number => encoder.encode(text).length;
/** What a string becomes after a UTF-8 write/read cycle — lossy for lone surrogates. */
const utf8RoundTrip = (text: string): string => decoder.decode(encoder.encode(text));

/**
 * The payload shapes a real journal produces. Deliberately includes values that
 * are valid JSON but NOT envelopes, and strings carrying embedded newlines and
 * multi-byte characters, because those are what break a naive splitter.
 */
const payload = FastCheck.oneof(
	FastCheck.constant('{"at":"2026-08-03T00:00:00Z","event":"mail-received","data":{}}'),
	FastCheck.constant('{"note":"line1\\nline2"}'),
	FastCheck.constant('{"emoji":"\u{1F600}","snow":"☃"}'),
	FastCheck.constant("null"),
	FastCheck.constant("42"),
	FastCheck.constant('"a bare string"'),
	FastCheck.constant("[1,2,3]"),
	FastCheck.constant("{}"),
);

/**
 * Object payloads only. Every strict prefix of a JSON object text fails to
 * parse, which is what makes a mid-line truncation detectable at this layer.
 */
const objectPayload = FastCheck.oneof(
	FastCheck.constant('{"at":"2026-08-03T00:00:00Z","event":"mail-received","data":{}}'),
	FastCheck.constant('{"note":"line1\\nline2"}'),
	FastCheck.constant('{"emoji":"\u{1F600}","snow":"☃"}'),
	FastCheck.constant("{}"),
);

/** Lines that do not parse — the holes and the torn writes. */
const brokenLine = FastCheck.oneof(
	FastCheck.constant('{"a":'),
	FastCheck.constant("not json at all"),
	FastCheck.constant("{"),
	FastCheck.constant("}"),
	FastCheck.constant('{"unterminated":"str'),
);

const terminator = FastCheck.oneof(FastCheck.constant("\n"), FastCheck.constant("\r\n"));

/** A whole journal file: valid and broken lines, mixed terminators, torn tail or not. */
const journal = FastCheck.tuple(
	FastCheck.array(FastCheck.tuple(FastCheck.oneof(payload, brokenLine), terminator), { maxLength: 12 }),
	FastCheck.option(FastCheck.oneof(payload, brokenLine), { nil: undefined }),
).map(([lines, tail]) => {
	const body = lines.map(([text, end]) => `${text}${end}`).join("");
	return tail === undefined ? body : `${body}${tail}`;
});

/**
 * Arbitrary text, including text that is nothing like a journal.
 *
 * `unit: "binary"` emits arbitrary UTF-16 code units — unpaired surrogates
 * included — which is the case a hand-rolled byte counter gets wrong.
 * `fullUnicodeString` does not exist in fast-check v4; this is its replacement.
 */
const anyText = FastCheck.oneof(
	journal,
	FastCheck.string(),
	FastCheck.string({ unit: "binary" }),
	FastCheck.string({ unit: "grapheme" }),
	FastCheck.constantFrom("", "\n", "\r\n", "\n\n", "   ", "\ud800", "\ud800\n"),
);

describe("Line properties", () => {
	it.effect.prop(
		"byteLength agrees with TextEncoder for any string",
		[FastCheck.string({ unit: "binary" })],
		([text]) =>
			Effect.sync(() => {
				assert.strictEqual(Line.byteLength(text), byteLength(text));
			}),
	);

	it.effect.prop("every slice's byte offsets address its own text in the source", [anyText], ([text]) =>
		Effect.sync(() => {
			const source = encoder.encode(text);
			for (const line of Line.split(text)) {
				const decoded = decoder.decode(source.slice(line.offset, line.offset + line.length));
				// Compared against the UTF-8 round trip, not the raw text: an unpaired
				// surrogate encodes to U+FFFD and cannot come back, so `text` itself is
				// the wrong oracle for exactly the inputs this property exists to cover.
				assert.strictEqual(decoded, utf8RoundTrip(line.text), `offset ${line.offset} of ${JSON.stringify(text)}`);
			}
		}),
	);

	it.effect.prop("slices tile the source: each end is the next offset, the last is the length", [anyText], ([text]) =>
		Effect.sync(() => {
			const lines = Line.split(text);
			if (lines.length === 0) {
				assert.strictEqual(byteLength(text), 0);
				return;
			}
			assert.strictEqual(lines[0]?.offset, 0);
			for (let i = 0; i < lines.length - 1; i++) {
				assert.strictEqual(lines[i]?.end, lines[i + 1]?.offset, "no gap and no overlap between lines");
			}
			assert.strictEqual(lines.at(-1)?.end, byteLength(text), "the last line ends at the end of the source");
		}),
	);

	it.effect.prop("no non-blank line is ever silently dropped", [anyText], ([text]) =>
		Effect.sync(() => {
			const nonBlank = Line.split(text).filter((line) => line.text.trim() !== "");
			assert.strictEqual(Line.parseAll(text).length, nonBlank.length);
		}),
	);

	it.effect.prop("consumedOffset never consumes an unterminated tail's bytes", [anyText], ([text]) =>
		Effect.sync(() => {
			const lines = Line.split(text);
			const consumed = Line.consumedOffset(text);
			assert.isAtLeast(consumed, 0);
			assert.isAtMost(consumed, byteLength(text));
			const last = lines.at(-1);
			if (last !== undefined && !last.terminated) {
				assert.strictEqual(consumed, last.offset, "a torn tail is left for the next read");
			} else {
				assert.strictEqual(consumed, byteLength(text));
			}
		}),
	);

	it.effect.prop("lastValid is exactly the last success of parseAll", [anyText], ([text]) =>
		Effect.sync(() => {
			const successes = Line.parseAll(text).filter(Result.isSuccess);
			const last = Line.lastValid(text);
			if (successes.length === 0) {
				assert.isTrue(Option.isNone(last));
				return;
			}
			assert.isTrue(Option.isSome(last));
			if (Option.isSome(last)) {
				assert.strictEqual(last.value.line.offset, successes.at(-1)?.success.line.offset);
			}
		}),
	);

	it.effect.prop(
		"appending a well-formed terminated line makes it the last valid line",
		[anyText, payload],
		([prefix, line]) =>
			Effect.sync(() => {
				// A torn prefix is superseded by the next complete append, exactly as
				// the dogfood journal's correction-by-append rule requires.
				const source = `${prefix}${prefix === "" || prefix.endsWith("\n") ? "" : "\n"}${line}\n`;
				const last = Line.lastValid(source);
				assert.isTrue(Option.isSome(last));
				if (Option.isSome(last)) {
					assert.deepStrictEqual(last.value.value, JSON.parse(line));
				}
			}),
	);

	it.effect.prop(
		"truncating a journal mid-final-line walks back to the previous line",
		[FastCheck.array(objectPayload, { minLength: 2, maxLength: 8 }), FastCheck.nat()],
		([payloads, cut]) =>
			Effect.sync(() => {
				// OBJECT payloads only, and the reason is a real property of JSONL: every
				// strict prefix of a JSON object text is unparseable, but a strict prefix
				// of a SCALAR is not — truncating `42` yields `4`, which parses fine as a
				// different value. See the "torn scalar" test in Line.test.ts; closing
				// that hole is the envelope layer's job, not this one's.
				const head = payloads
					.slice(0, -1)
					.map((p) => `${p}\n`)
					.join("");
				const tail = payloads.at(-1) ?? "{}";
				const keep = 1 + (cut % (tail.length - 1));
				const torn = `${head}${tail.slice(0, keep)}`;
				const last = Line.lastValid(torn);
				const expected = payloads.at(-2);
				assert.isTrue(Option.isSome(last));
				if (Option.isSome(last) && expected !== undefined) {
					assert.deepStrictEqual(last.value.value, JSON.parse(expected));
				}
			}),
	);

	it.effect.prop("is total: no input throws", [anyText], ([text]) =>
		Effect.sync(() => {
			assert.doesNotThrow(() => {
				Line.split(text);
				Line.parseAll(text);
				Line.lastValid(text);
				Line.consumedOffset(text);
				Line.byteLength(text);
			});
		}),
	);
});
