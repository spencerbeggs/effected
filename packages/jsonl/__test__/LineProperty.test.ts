import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Result, Schema } from "effect";
import { Envelope, JsonlEvent, Line } from "../src/index.js";

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
const payload = Schema.Literals([
	'{"at":"2026-08-03T00:00:00Z","event":"mail-received","data":{}}',
	'{"note":"line1\\nline2"}',
	'{"emoji":"\u{1F600}","snow":"☃"}',
	"null",
	"42",
	'"a bare string"',
	"[1,2,3]",
	"{}",
]);

/** Lines that do not parse — the holes and the torn writes. */
const brokenLine = Schema.Literals(['{"a":', "not json at all", "{", "}", '{"unterminated":"str']);

const terminator = Schema.Literals(["\n", "\r\n"]);

/** A line as written: valid or broken, in equal measure. */
const anyLine = Schema.Union([payload, brokenLine]);

/** A whole journal file: valid and broken lines, mixed terminators, torn tail or not. */
const journal = Arbitrary.schema(
	Schema.Tuple([
		Schema.Array(Schema.Tuple([anyLine, terminator])).check(Schema.isMaxLength(12)),
		Schema.UndefinedOr(anyLine),
	]),
).pipe(
	Arbitrary.map(([lines, tail]) => {
		const body = lines.map(([text, end]) => `${text}${end}`).join("");
		return tail === undefined ? body : `${body}${tail}`;
	}),
);

/**
 * Arbitrary UTF-16 code units — unpaired surrogates included — which is the
 * case a hand-rolled byte counter gets wrong. Built from the code-unit domain
 * directly: a Schema string only ever generates well-formed text plus a
 * handful of edge cases, so the lone-surrogate space needs its own generator.
 */
const codeUnitText = Arbitrary.schema(
	Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffff }))),
).pipe(Arbitrary.map((units) => String.fromCharCode(...units)));

/**
 * Arbitrary Unicode scalar values, astral code points included — every UTF-8
 * width from one byte to four, with no lone surrogates.
 */
const codePointText = Arbitrary.schema(
	Schema.Array(
		Schema.Int.check(
			Schema.isBetween({ minimum: 0, maximum: 0x10ffff }),
			Schema.makeFilter((codePoint) => codePoint < 0xd800 || codePoint > 0xdfff),
		),
	),
).pipe(Arbitrary.map((codePoints) => String.fromCodePoint(...codePoints)));

/** A uniform choice between arbitraries — the native module only unions Schemas. */
const oneOf = <A>(
	first: Arbitrary.Arbitrary<A>,
	...rest: ReadonlyArray<Arbitrary.Arbitrary<A>>
): Arbitrary.Arbitrary<A> =>
	Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: rest.length }))).pipe(
		Arbitrary.flatMap((index) => (index === 0 ? first : (rest[index - 1] ?? first))),
	);

/** Arbitrary text, including text that is nothing like a journal. */
const anyText = oneOf<string>(
	journal,
	Arbitrary.schema(Schema.String),
	codeUnitText,
	codePointText,
	Arbitrary.schema(Schema.Literals(["", "\n", "\r\n", "\n\n", "   ", "\ud800", "\ud800\n"])),
);

/** Any non-negative 32-bit integer — the cut position, taken modulo the tail length. */
const nat = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0x7fffffff }));

/**
 * The registry the envelope-level properties decode against. `mail-received`
 * admits the one envelope in `payload`; `round` carries a number so a torn
 * tail can be told apart from the line before it.
 */
const registry = [
	JsonlEvent.make("mail-received", { data: Schema.Struct({}) }),
	JsonlEvent.make("round", { data: Schema.Struct({ round: Schema.Number }) }),
] as const;

/** A complete `round` envelope line, without its terminator. */
const roundEnvelope = (round: number): string =>
	JSON.stringify({ at: "2026-08-03T00:00:00.000Z", event: "round", data: { round } });

/** Payloads that are valid JSON but not envelopes — scalars included, whose prefixes still parse. */
const nonEnvelope = Schema.Literals([
	'{"note":"line1\\nline2"}',
	"null",
	"42",
	"12345",
	'"a bare string"',
	"[1,2,3]",
	"{}",
]);

describe("Line properties", () => {
	it.effect.prop("byteLength agrees with TextEncoder for any string", [codeUnitText], ([text]) =>
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

	it.effect.prop("split with a base is split without one, shifted by the base", [anyText, nat], ([text, base]) =>
		Effect.sync(() => {
			const shifted = Line.split(text, base);
			const unshifted = Line.split(text);
			assert.strictEqual(shifted.length, unshifted.length);
			unshifted.forEach((line, i) => {
				const moved = shifted[i];
				assert.strictEqual(moved?.offset, line.offset + base, "offset shifted");
				assert.strictEqual(moved?.end, line.end + base, "end shifted");
				assert.strictEqual(moved?.length, line.length, "length is not a position");
				assert.strictEqual(moved?.text, line.text);
				assert.strictEqual(moved?.terminated, line.terminated);
			});
		}),
	);

	it.effect.prop("no non-blank line is ever silently dropped by decodeAllResult", [anyText], ([text]) =>
		Effect.sync(() => {
			const nonBlank = Line.split(text).filter((line) => line.text.trim() !== "");
			assert.strictEqual(Envelope.decodeAllResult(registry, text).length, nonBlank.length);
		}),
	);

	it.effect.prop("Envelope.lastValid is exactly the last success of decodeAllResult", [anyText, nat], ([text, base]) =>
		Effect.sync(() => {
			const successes = Envelope.decodeAllResult(registry, text, base).filter(Result.isSuccess);
			const last = Envelope.lastValid(registry, text, base);
			const expected = successes.at(-1);
			if (expected === undefined) {
				assert.isTrue(Option.isNone(last));
				return;
			}
			assert.deepStrictEqual(Option.getOrThrow(last).position, expected.success.position);
		}),
	);

	it.effect.prop(
		"appending a well-formed terminated envelope makes it the last valid one",
		[anyText, nat],
		([prefix, round]) =>
			Effect.sync(() => {
				// A torn prefix is superseded by the next complete append, exactly as
				// the dogfood journal's correction-by-append rule requires.
				const head = `${prefix}${prefix === "" || prefix.endsWith("\n") ? "" : "\n"}`;
				const source = `${head}${roundEnvelope(round)}\n`;
				const last = Option.getOrThrow(Envelope.lastValid(registry, source));
				assert.strictEqual(last.event, "round");
				assert.deepStrictEqual(last.data, { round });
				assert.deepStrictEqual(last.position, { offset: byteLength(head), end: byteLength(source) });
			}),
	);

	it.effect.prop(
		"truncating a journal mid-final-envelope walks back to the previous envelope",
		[Schema.Array(nat).check(Schema.isBetweenLength(2, 8)), nat],
		([rounds, cut]) =>
			Effect.sync(() => {
				// Every strict prefix of an envelope is either unparseable or not an
				// envelope, so the cut can fall anywhere in the final line.
				const head = rounds
					.slice(0, -1)
					.map((round) => `${roundEnvelope(round)}\n`)
					.join("");
				const tail = roundEnvelope(rounds.at(-1) ?? 0);
				const keep = 1 + (cut % (tail.length - 1));
				const last = Option.getOrThrow(Envelope.lastValid(registry, `${head}${tail.slice(0, keep)}`));
				assert.deepStrictEqual(last.data, { round: rounds.at(-2) });
			}),
	);

	it.effect.prop(
		"a torn tail of ANY JSON value — scalars included — never displaces the last envelope",
		[Schema.Array(nat).check(Schema.isBetweenLength(1, 6)), nonEnvelope, nat],
		([rounds, fragment, cut]) =>
			Effect.sync(() => {
				// The JSON layer cannot close this hole: truncating `42` leaves `4`,
				// which parses as a different value. The envelope layer can, because a
				// scalar — whole or torn — is never an envelope.
				const head = rounds.map((round) => `${roundEnvelope(round)}\n`).join("");
				const keep = 1 + (cut % fragment.length);
				const last = Option.getOrThrow(Envelope.lastValid(registry, `${head}${fragment.slice(0, keep)}`));
				assert.deepStrictEqual(last.data, { round: rounds.at(-1) });
			}),
	);

	it.effect.prop("is total: no input throws", [anyText], ([text]) =>
		Effect.sync(() => {
			assert.doesNotThrow(() => {
				for (const line of Line.split(text, 3)) {
					Line.parseResult(line);
				}
				Envelope.decodeAllResult(registry, text);
				Envelope.lastValid(registry, text);
				Line.byteLength(text);
			});
		}),
	);
});
