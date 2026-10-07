import { assert, describe, it } from "@effect/vitest";
import { Cause, DateTime, Effect, Exit, Option, Result, Schema } from "effect";
import { frameResult } from "../src/Envelope.js";
import type { EnvelopeUnion, EnvelopeWithTag, JsonlEvent as JsonlEventType } from "../src/index.js";
import {
	Envelope,
	InvalidData,
	JsonlEvent,
	Line,
	MalformedLine,
	UnknownEvent,
	UnserializableData,
} from "../src/index.js";

// ── A registry, exactly as a consumer declares one ──────────────────────────

const MailReceived = JsonlEvent.make("mail-received", {
	data: Schema.Struct({ round: Schema.Number, from: Schema.String }),
});
const Unlinked = JsonlEvent.make("unlinked", { data: Schema.Void, terminal: true });
const Relinked = JsonlEvent.make("relinked", { data: Schema.Struct({ reason: Schema.String }), reopen: true });

const registry = [MailReceived, Unlinked, Relinked] as const;

const AT = "2026-08-03T17:04:11.912Z";
const at = DateTime.makeUnsafe(AT);

const line = (text: string) => {
	const [slice] = Line.split(text);
	assert.isDefined(slice);
	return slice;
};

const envelopeText = (over: Record<string, unknown> = {}): string =>
	JSON.stringify({ at: AT, event: "mail-received", data: { round: 7, from: "silk" }, ...over });

/**
 * Unconditional extraction helpers.
 *
 * Written after a mutation run showed the flagship walk-back test could NOT
 * fail: `if (Option.isSome(x) && x.value.event === "t")` silently skips its
 * assertions when the discriminant is wrong, so a broken implementation slips
 * through a green test. These turn "is the right variant" into an assertion
 * rather than a condition — the narrowing `if` with no else branch is a known
 * false-green and it has no place in this file.
 */
const ok = <A, E>(result: Result.Result<A, E>): A => Result.getOrThrow(result);
const some = <A>(option: Option.Option<A>): A => Option.getOrThrow(option);
/** Asserts the failure branch and returns the error. */
const err = <A, E>(result: Result.Result<A, E>): E => {
	assert.isTrue(Result.isFailure(result), "expected a failure");
	return (result as Extract<Result.Result<A, E>, { readonly _tag: "Failure" }>).failure;
};
/** Asserts an array element exists, then returns it. */
const nth = <A>(items: ReadonlyArray<A>, index: number): A => {
	const item = items[index];
	assert.isDefined(item, `no element at ${index}`);
	return item as A;
};
/** Asserts the envelope carries `tag`, then narrows to that variant. */
const tagged = <T extends JsonlEventType.Tag<typeof registry>>(
	envelope: EnvelopeUnion<typeof registry>,
	tag: T,
): EnvelopeWithTag<typeof registry, T> => {
	assert.strictEqual(envelope.event, tag, "wrong envelope variant");
	return envelope as EnvelopeWithTag<typeof registry, T>;
};

describe("JsonlEvent", () => {
	it("keeps tags and markings as literals, not widened types", () => {
		assert.strictEqual(MailReceived.tag, "mail-received");
		assert.strictEqual(Unlinked.terminal, true);
		assert.strictEqual(Unlinked.reopen, false);
		assert.strictEqual(Relinked.reopen, true);
		assert.strictEqual(Relinked.terminal, false);
	});

	it("defaults terminal and reopen to false when unstated", () => {
		assert.strictEqual(MailReceived.terminal, false);
		assert.strictEqual(MailReceived.reopen, false);
	});

	it("carries the registered payload schema through unchanged", () => {
		assert.strictEqual(MailReceived.data, MailReceived.data);
		assert.isTrue(Result.isSuccess(Schema.decodeUnknownResult(MailReceived.data)({ round: 1, from: "x" })));
	});
});

describe("Envelope registry cache", () => {
	it("freezes the registry on first lookup, converting post-lookup mutation from silent-stale to a loud throw", () => {
		// A fresh registry array — never passed to decodeResult before — so this
		// test observes the cache's FIRST population rather than reusing the
		// module-level `registry` some other test may already have indexed.
		const isolatedRegistry = [MailReceived, Unlinked, Relinked] as const;

		const first = tagged(ok(Envelope.decodeResult(isolatedRegistry, line(envelopeText()))), "mail-received");
		assert.deepStrictEqual(first.data, { round: 7, from: "silk" });

		assert.throws(
			() => (isolatedRegistry as unknown as Array<unknown>).push(JsonlEvent.make("extra", { data: Schema.Void })),
			TypeError,
		);

		// The cache still serves the ORIGINAL definitions correctly — there is no
		// stale data to serve, because the freeze converted the mutation attempt
		// into a throw instead of letting it through.
		const second = tagged(
			ok(Envelope.decodeResult(isolatedRegistry, line(envelopeText({ data: { round: 9, from: "x" } })))),
			"mail-received",
		);
		assert.deepStrictEqual(second.data, { round: 9, from: "x" });
	});
});

describe("frameResult (internal stage one)", () => {
	it("decodes the frame WITHOUT decoding the payload", () => {
		// The payload here would fail its registered schema; the frame does not care.
		const frame = ok(frameResult(line(envelopeText({ data: { round: "not a number" } }))));
		assert.strictEqual(frame.event, "mail-received");
		assert.deepStrictEqual(frame.data, { round: "not a number" });
	});

	it("is independent of payload depth — Schema.Unknown does not traverse", () => {
		// 200k-deep payload. If the frame traversed `data`, this is where it would
		// blow the stack; it does not, which is the property filtering relies on.
		const deep = JSON.parse(`${"[".repeat(200_000)}1${"]".repeat(200_000)}`) as unknown;
		const text = JSON.stringify({ at: AT, event: "mail-received", data: deep });
		assert.strictEqual(ok(frameResult(line(text))).event, "mail-received");
	});

	it("decodes `at` through DateTimeUtcFromString into a DateTime.Utc", () => {
		const frame = ok(frameResult(line(envelopeText())));
		assert.strictEqual(DateTime.formatIso(frame.at), AT);
	});

	it("omits `scope` when absent and carries it when present", () => {
		assert.notProperty(ok(frameResult(line(envelopeText()))), "scope");
		assert.strictEqual(ok(frameResult(line(envelopeText({ scope: "mailbox-a" })))).scope, "mailbox-a");
	});

	it("fails MalformedLine when the line is not JSON at all", () => {
		assert.instanceOf(err(frameResult(line("{not json"))), MalformedLine);
	});

	it("fails InvalidData with no event when the JSON is not an envelope", () => {
		const failure = err(frameResult(line('{"hello":"world"}')));
		assert.instanceOf(failure, InvalidData);
		assert.isTrue(Option.isNone((failure as InvalidData).event));
	});
});

describe("Envelope.decodeResult", () => {
	it("decodes a well-formed envelope and validates its payload", () => {
		const envelope = tagged(ok(Envelope.decodeResult(registry, line(envelopeText()))), "mail-received");
		assert.deepStrictEqual(envelope.data, { round: 7, from: "silk" });
		assert.strictEqual(envelope.position.offset, 0);
	});

	it("exposes the line's position and nothing else of the line", () => {
		const text = `${envelopeText()}\r\n`;
		const envelope = ok(Envelope.decodeResult(registry, line(text)));
		assert.deepStrictEqual(envelope.position, { offset: 0, end: Line.byteLength(text) });
		assert.deepStrictEqual(Object.keys(envelope.position).sort(), ["end", "offset"]);
		// No raw text rides along: the payload is already decoded, and a second copy
		// of every line as JSON would double what a buffered stream holds.
		assert.notProperty(envelope, "line");
		assert.notProperty(envelope, "text");
		assert.deepStrictEqual(Object.keys(envelope).sort(), ["at", "data", "event", "position"]);
	});

	it("narrows the payload type on the discriminant", () => {
		const envelope = ok(Envelope.decodeResult(registry, line(envelopeText())));
		// Exhaustive discrimination; the payload type follows the tag. Every arm
		// either asserts or fails, so no input can slip through unasserted.
		switch (envelope.event) {
			case "mail-received":
				assert.strictEqual(envelope.data.round, 7);
				break;
			case "relinked":
			case "unlinked":
				assert.fail("wrong variant");
		}
	});

	it("fails UnknownEvent for a tag outside the registry, carrying the known tags", () => {
		const failure = err(Envelope.decodeResult(registry, line(envelopeText({ event: "from-the-future" }))));
		assert.instanceOf(failure, UnknownEvent);
		assert.strictEqual((failure as UnknownEvent).event, "from-the-future");
		assert.deepStrictEqual([...(failure as UnknownEvent).known], ["mail-received", "unlinked", "relinked"]);
	});

	it("fails InvalidData carrying the issue tree structurally, not stringified", () => {
		const failure = err(
			Envelope.decodeResult(registry, line(envelopeText({ data: { round: "seven", from: "silk" } }))),
		) as InvalidData;
		assert.instanceOf(failure, InvalidData);
		assert.strictEqual(some(failure.event), "mail-received");
		// The live issue tree, not a string.
		assert.isDefined(failure.error.issue);
		assert.notTypeOf(failure.error.issue, "string");
		assert.include(failure.message, "mail-received");
	});

	it("accepts a void payload for a payload-less event", () => {
		const text = JSON.stringify({ at: AT, event: "unlinked", data: null });
		assert.strictEqual(tagged(ok(Envelope.decodeResult(registry, line(text))), "unlinked").event, "unlinked");
	});
});

describe("Envelope hostile input", () => {
	it("does not pollute Object.prototype via __proto__ in the envelope", () => {
		const text =
			'{"at":"2026-08-03T17:04:11.912Z","event":"mail-received","__proto__":{"polluted":true},"data":{"round":1,"from":"x"}}';
		// The input is genuinely hostile: JSON.parse leaves `__proto__` as an OWN
		// property, which an `Object.assign`-style copy would then feed to the
		// inherited setter.
		const raw = JSON.parse(text) as object;
		assert.include(Object.getOwnPropertyNames(raw), "__proto__", "the fixture is actually hostile");

		const envelope = ok(Envelope.decodeResult(registry, line(text)));
		assert.isUndefined(Reflect.get({}, "polluted"));
		assert.isUndefined(Reflect.get(Object.prototype, "polluted"));
		// The subtler hazard: a copy through `Object.assign` hijacks the TARGET's
		// prototype rather than the global one, which a global-only assertion
		// would miss entirely.
		assert.strictEqual(Object.getPrototypeOf(envelope), Object.prototype, "envelope prototype intact");
		assert.isUndefined(Reflect.get(envelope, "polluted"));
	});

	it("does not pollute Object.prototype via __proto__ inside the payload", () => {
		const Payload = Schema.Struct({ round: Schema.Number, from: Schema.String });
		const events = [JsonlEvent.make("mail-received", { data: Payload })] as const;
		const text = envelopeText({ data: { round: 1, from: "x", __proto__: { polluted: true } } });
		const payload = ok(Envelope.decodeResult(events, line(text))).data as object;
		assert.isUndefined(Reflect.get({}, "polluted"));
		assert.isUndefined(Reflect.get(Object.prototype, "polluted"));
		assert.strictEqual(Object.getPrototypeOf(payload), Object.prototype, "payload prototype intact");
		assert.isUndefined(Reflect.get(payload, "polluted"));
	});

	it("treats constructor and prototype as ordinary keys, not a defect", () => {
		for (const key of ["constructor", "prototype", "__defineGetter__"]) {
			const text = envelopeText({ [key]: { evil: true } });
			const result = Envelope.decodeResult(registry, line(text));
			// Whatever the verdict, it is a value and the runtime is unharmed.
			assert.isTrue(Result.isSuccess(result) || Result.isFailure(result), key);
		}
		assert.strictEqual(typeof {}.constructor, "function");
	});

	it("carries C0 control characters in payload strings without failing", () => {
		// Escapes, not raw control bytes: the payload is hostile, the source is not.
		const hostile = "a\u0000b\u001fc";
		const text = envelopeText({ data: { round: 1, from: hostile } });
		const envelope = tagged(ok(Envelope.decodeResult(registry, line(text))), "mail-received");
		assert.strictEqual(envelope.data.from, hostile);
	});

	// `it.effect`, NOT `it`. A plain `it` returning an Effect constructs it and
	// throws it away: the body never runs and the test passes unconditionally.
	// This one was dead until a canary caught it.
	it.effect("fails typed, never as a defect, across every hostile shape", () =>
		Effect.gen(function* () {
			const shapes = [
				"{not json",
				"null",
				"42",
				'"a string"',
				"[]",
				"{}",
				'{"event":"mail-received"}',
				'{"at":"nonsense","event":"mail-received","data":{}}',
				envelopeText({ event: 42 }),
				envelopeText({ at: null }),
				envelopeText({ data: undefined }),
			];
			for (const shape of shapes) {
				const exit = yield* Effect.exit(Effect.fromResult(Envelope.decodeResult(registry, line(shape))));
				// Unconditional: every shape MUST fail, and fail typed. An
				// `if (Exit.isFailure(...))` here would let a shape that wrongly
				// succeeded slip past unasserted.
				assert.isTrue(Exit.isFailure(exit), `must reject: ${shape}`);
				const cause = (exit as Exit.Failure<never, unknown>).cause;
				assert.isTrue(Cause.hasFails(cause), `typed failure for ${shape}`);
				assert.isFalse(Cause.hasDies(cause), `never a defect for ${shape}`);
			}
		}),
	);
});

describe("Envelope.lastValid — the binding walk-back", () => {
	const good = (round: number) => `${envelopeText({ data: { round, from: "silk" } })}\n`;

	it("returns the last valid envelope of a well-formed journal", () => {
		const last = tagged(some(Envelope.lastValid(registry, `${good(1)}${good(2)}${good(3)}`)), "mail-received");
		assert.strictEqual(last.data.round, 3);
	});

	it("walks back past a torn final envelope", () => {
		// A real mid-write truncation: a complete envelope, cut short of its close.
		const third = envelopeText({ data: { round: 3, from: "silk" } });
		const torn = `${good(1)}${good(2)}${third.slice(0, third.length - 12)}`;
		const last = tagged(some(Envelope.lastValid(registry, torn)), "mail-received");
		assert.strictEqual(last.data.round, 2);
	});

	it("CLOSES THE SCALAR HOLE that the JSON layer cannot", () => {
		// At the JSON layer the torn fragment `4` parses cleanly, as a different
		// value. The envelope walk-back rejects it, because `4` is not an envelope.
		const torn = `${good(1)}4`;
		const fragment = Line.split(torn).at(-1);
		assert.isDefined(fragment);
		assert.strictEqual(ok(Line.parseResult(fragment)), 4, "the JSON layer is fooled");
		const envelopeLevel = tagged(some(Envelope.lastValid(registry, torn)), "mail-received");
		assert.strictEqual(envelopeLevel.data.round, 1, "the envelope layer is not");
	});

	it("walks back past a line whose tag is unknown to this registry", () => {
		const foreign = `${good(1)}${envelopeText({ event: "from-the-future" })}\n`;
		const last = tagged(some(Envelope.lastValid(registry, foreign)), "mail-received");
		assert.strictEqual(last.data.round, 1);
	});

	it("is none when no line is a valid envelope", () => {
		assert.isTrue(Option.isNone(Envelope.lastValid(registry, "4\nnull\n{}\n")));
	});

	it("is none for empty input", () => {
		assert.isTrue(Option.isNone(Envelope.lastValid(registry, "")));
	});

	it("is none when no line even parses", () => {
		assert.isTrue(Option.isNone(Envelope.lastValid(registry, "nope\nalso nope\n")));
	});

	it("locates the walked-back envelope by byte position", () => {
		const torn = `${good(1)}${good(2)}{"at":`;
		const last = some(Envelope.lastValid(registry, torn));
		assert.deepStrictEqual(last.position, { offset: good(1).length, end: good(1).length + good(2).length });
	});

	it("walks back past several malformed trailing lines", () => {
		const last = tagged(some(Envelope.lastValid(registry, `${good(1)}broken\nalso broken\n{"at"`)), "mail-received");
		assert.strictEqual(last.data.round, 1);
	});

	it("ignores trailing blank lines", () => {
		const last = tagged(some(Envelope.lastValid(registry, `${good(1)}\n   \n`)), "mail-received");
		assert.strictEqual(last.data.round, 1);
	});

	it("detects a torn tail that truncates an envelope, whatever the cut point", () => {
		const third = envelopeText({ data: { round: 3, from: "silk" } });
		for (let keep = 1; keep < third.length; keep++) {
			const last = tagged(some(Envelope.lastValid(registry, `${good(1)}${third.slice(0, keep)}`)), "mail-received");
			assert.strictEqual(last.data.round, 1, `keep=${keep}`);
		}
	});

	it("accepts an unterminated final line that IS a complete envelope", () => {
		const third = envelopeText({ data: { round: 3, from: "silk" } });
		const text = `${good(1)}${third}`;
		const last = tagged(some(Envelope.lastValid(registry, text)), "mail-received");
		assert.strictEqual(last.data.round, 3);
		assert.strictEqual(last.position.end, Line.byteLength(text), "an unterminated line ends at its last content byte");
	});

	it("shifts the position by `base` when the text is a tail of the journal", () => {
		const text = `${good(1)}${good(2)}`;
		const base = 4096;
		const last = some(Envelope.lastValid(registry, text, base));
		const unshifted = some(Envelope.lastValid(registry, text));
		assert.deepStrictEqual(last.position, {
			offset: unshifted.position.offset + base,
			end: unshifted.position.end + base,
		});
		assert.strictEqual(last.position.offset, base + good(1).length);
	});
});

describe("Envelope.decodeAllResult", () => {
	it("reports a bad interior line instead of dropping it", () => {
		const text = `${envelopeText()}\nnot json\n${envelopeText()}\n`;
		const results = Envelope.decodeAllResult(registry, text);
		assert.deepStrictEqual(results.map(Result.isSuccess), [true, false, true]);
	});

	it("carries byte offsets that address the bad line in the source", () => {
		const source = `${envelopeText({ data: { round: 1, from: "\u{1F600}" } })}\nnot json\n${envelopeText()}\n`;
		const failure = err(nth(Envelope.decodeAllResult(registry, source), 1));
		assert.instanceOf(failure, MalformedLine);
		const { offset, length } = (failure as MalformedLine).line;
		const encoded = new TextEncoder().encode(source);
		assert.strictEqual(new TextDecoder().decode(encoded.slice(offset, offset + length)), "not json");
	});

	it("skips whitespace-only lines rather than reporting them as corruption", () => {
		const results = Envelope.decodeAllResult(registry, `${envelopeText()}\n\n   \n${envelopeText()}\n`);
		assert.deepStrictEqual(results.map(Result.isSuccess), [true, true]);
	});

	it("reports an unterminated torn tail as a failure", () => {
		const results = Envelope.decodeAllResult(registry, `${envelopeText()}\n{"at":`);
		assert.deepStrictEqual(results.map(Result.isSuccess), [true, false]);
		const torn = err(nth(results, 1));
		assert.instanceOf(torn, MalformedLine);
		assert.isFalse((torn as MalformedLine).line.terminated);
	});

	it("shifts every position and error offset by `base`", () => {
		const first = `${envelopeText()}\n`;
		const text = `${first}not json\n${envelopeText()}\n`;
		const base = 777;
		const results = Envelope.decodeAllResult(registry, text, base);
		assert.deepStrictEqual(ok(nth(results, 0)).position, {
			offset: base,
			end: base + first.length,
		});
		assert.strictEqual((err(nth(results, 1)) as MalformedLine).line.offset, base + first.length);
		assert.strictEqual(ok(nth(results, 2)).position.end, base + text.length);
	});
});

describe("Envelope.encodeResult", () => {
	it("produces a complete line INCLUDING its terminator", () => {
		const result = Envelope.encodeResult(registry, {
			event: "mail-received",
			data: { round: 7, from: "silk" },
			at,
		});
		const encoded = ok(result);
		assert.isTrue(encoded.endsWith("\n"), "the terminator is part of the line");
		assert.strictEqual(encoded, `{"at":"${AT}","event":"mail-received","data":{"round":7,"from":"silk"}}\n`);
	});

	it("round-trips through decodeResult", () => {
		const encoded = Envelope.encodeResult(registry, {
			event: "relinked",
			data: { reason: "resumed" },
			at,
			scope: "mailbox-a",
		});
		const decoded = tagged(ok(Envelope.decodeResult(registry, line(ok(encoded)))), "relinked");
		assert.deepStrictEqual(decoded.data, { reason: "resumed" });
		assert.strictEqual(decoded.scope, "mailbox-a");
		assert.strictEqual(DateTime.formatIso(decoded.at), AT);
	});

	it("omits scope entirely when not supplied", () => {
		assert.notInclude(ok(Envelope.encodeResult(registry, { event: "unlinked", data: undefined, at })), "scope");
	});

	it("round-trips a VOID payload — the data key must survive stringify", () => {
		// JSON.stringify DROPS keys whose value is `undefined`, and Schema.Void
		// encodes to `undefined`. If the encoder let that through, the line would
		// carry no `data` key at all and the frame — which requires one — could
		// never decode it back.
		const encoded = ok(Envelope.encodeResult(registry, { event: "unlinked", data: undefined, at }));
		assert.include(encoded, '"data"', "the data key survives a void payload");
		const decoded = tagged(ok(Envelope.decodeResult(registry, line(encoded))), "unlinked");
		assert.strictEqual(decoded.event, "unlinked");
	});

	it("fails InvalidData when the payload does not match its schema", () => {
		const result = Envelope.encodeResult(registry, {
			event: "mail-received",
			// biome-ignore lint/suspicious/noExplicitAny: deliberately bypassing the type gate to reach the runtime check
			data: { round: "seven", from: "silk" } as any,
			at,
		});
		assert.instanceOf(err(result), InvalidData);
	});

	it("fails InvalidData with NO line and no invented offset — there is no line yet", () => {
		const failure = err(
			Envelope.encodeResult(registry, {
				event: "mail-received",
				// biome-ignore lint/suspicious/noExplicitAny: deliberately bypassing the type gate to reach the runtime check
				data: { round: "seven", from: "silk" } as any,
				at,
			}),
		) as InvalidData;
		assert.instanceOf(failure, InvalidData);
		assert.notProperty(failure, "line");
		assert.strictEqual(some(failure.event), "mail-received");
		assert.notInclude(failure.message, "byte offset");
		assert.include(failure.message, "mail-received");
	});

	it("fails UnknownEvent with NO line for a tag outside the registry", () => {
		const failure = err(
			Envelope.encodeResult(registry, {
				// biome-ignore lint/suspicious/noExplicitAny: deliberately bypassing the type gate to reach the runtime check
				event: "from-the-future" as any,
				data: undefined,
				at,
			}),
		) as UnknownEvent;
		assert.instanceOf(failure, UnknownEvent);
		assert.notProperty(failure, "line");
		assert.deepStrictEqual([...failure.known], ["mail-received", "unlinked", "relinked"]);
		assert.notInclude(failure.message, "byte offset");
		assert.include(failure.message, "from-the-future");
	});
});

describe("Envelope.encodeResult — unserializable payloads", () => {
	// A payload schema may legitimately admit values JSON cannot represent:
	// `Schema.Unknown` admits everything. Schema validity and serializability are
	// separate questions, and the encode path has to answer the second one too.
	const Anything = [JsonlEvent.make("anything", { data: Schema.Unknown })] as const;

	const circular = (): unknown => {
		const node: Record<string, unknown> = { name: "loop" };
		node.self = node;
		return node;
	};

	it("fails typed on a bigint payload instead of throwing", () => {
		const failure = err(Envelope.encodeResult(Anything, { event: "anything", data: { n: 1n }, at }));
		assert.instanceOf(failure, UnserializableData);
		assert.strictEqual((failure as UnserializableData).event, "anything");
		// The thrown value is carried as-is, not flattened to a string.
		assert.instanceOf((failure as UnserializableData).cause, TypeError);
	});

	it("fails typed on a circular payload instead of throwing", () => {
		const failure = err(Envelope.encodeResult(Anything, { event: "anything", data: circular(), at }));
		assert.instanceOf(failure, UnserializableData);
		assert.instanceOf((failure as UnserializableData).cause, TypeError);
	});

	it("renders a message without touching the cyclic cause", () => {
		const failure = err(Envelope.encodeResult(Anything, { event: "anything", data: circular(), at }));
		assert.include((failure as UnserializableData).message, "anything");
	});

	it("does not throw at Effect CONSTRUCTION — the eager-evaluation trap", () => {
		// `Effect.fromResult` evaluates its argument eagerly, so an unguarded throw
		// escapes before any fiber exists and `runSyncExit` never sees it. Merely
		// building the Effect must therefore be safe.
		// NOT `assert.doesNotThrow(fn, "message")`: chai reads that second argument
		// as an error-MESSAGE MATCHER, so an unrelated TypeError slips through and
		// the assertion silently passes. Caught by mutation; written explicitly.
		let threw: unknown;
		try {
			Effect.fromResult(Envelope.encodeResult(Anything, { event: "anything", data: { n: 1n }, at }));
		} catch (error) {
			threw = error;
		}
		assert.isUndefined(threw, `constructing the Effect must not throw, but it threw: ${String(threw)}`);
	});

	it.effect("surfaces a bigint payload as a typed Exit failure, not a defect", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.fromResult(Envelope.encodeResult(Anything, { event: "anything", data: { n: 1n }, at })),
			);
			assert.isTrue(Exit.isFailure(exit));
			const cause = (exit as Exit.Failure<never, unknown>).cause;
			assert.isTrue(Cause.hasFails(cause), "typed failure");
			assert.isFalse(Cause.hasDies(cause), "never a defect");
		}),
	);

	it.effect("surfaces a circular payload as a typed Exit failure, not a defect", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.fromResult(Envelope.encodeResult(Anything, { event: "anything", data: circular(), at })),
			);
			assert.isTrue(Exit.isFailure(exit));
			const cause = (exit as Exit.Failure<never, unknown>).cause;
			assert.isTrue(Cause.hasFails(cause), "typed failure");
			assert.isFalse(Cause.hasDies(cause), "never a defect");
		}),
	);
});

describe("acceptance criterion 2 — the hook path", () => {
	it("reads a journal's current state with NO Effect runtime", () => {
		// This test deliberately calls only synchronous functions. There is no
		// Effect.gen, no it.effect, no runSync, no runtime of any kind — which is
		// the whole point: a PreToolUse hook that had to build one would not adopt
		// this package. If this test ever needs a runtime, the contract is broken.
		const third = envelopeText({ data: { round: 3, from: "silk" } });
		const journal = [
			`${envelopeText({ data: { round: 1, from: "silk" } })}\n`,
			`${envelopeText({ data: { round: 2, from: "silk" } })}\n`,
			third.slice(0, third.length - 12), // killed mid-write: no terminator, no closing braces
		].join("");

		const state = tagged(some(Envelope.lastValid(registry, journal)), "mail-received");

		assert.strictEqual(state.data.round, 2);
		// And the resume cursor for the next incremental read, in bytes: the end of
		// the last valid envelope, which is where the torn tail begins.
		assert.strictEqual(state.position.end, Line.byteLength(journal.slice(0, journal.lastIndexOf("\n") + 1)));
	});
});
