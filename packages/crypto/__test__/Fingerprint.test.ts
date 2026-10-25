import { createHash } from "node:crypto";
import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Exit, HashMap, Option, Result, Schema } from "effect";
import { DriftDecision } from "../src/DriftDecision.js";
import { Fingerprint } from "../src/Fingerprint.js";

const canonical = (value: unknown): string => {
	const result = Fingerprint.canonicalizeResult(value);
	if (Result.isFailure(result)) throw new Error(result.failure.message);
	return result.success;
};

const refusal = (value: unknown) => {
	const result = Fingerprint.canonicalizeResult(value);
	assert.isTrue(Result.isFailure(result), "expected a refusal");
	if (Result.isSuccess(result)) throw new Error("unreachable");
	assert.strictEqual(result.failure._tag, "FingerprintError");
	return result.failure;
};

describe("Fingerprint.canonicalizeResult", () => {
	it("sorts object keys at every depth", () => {
		assert.strictEqual(
			canonical({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 2 } }),
			'{"a":{"c":2,"d":[{"y":2,"z":1}]},"b":1}',
		);
	});

	it("sorts by UTF-16 code units, not locale", () => {
		assert.strictEqual(canonical({ b: 1, B: 2, é: 3, a: 4 }), '{"B":2,"a":4,"b":1,"é":3}');
	});

	it("preserves array order", () => {
		assert.strictEqual(canonical([3, 1, 2]), "[3,1,2]");
		assert.notStrictEqual(canonical({ rules: ["a", "b"] }), canonical({ rules: ["b", "a"] }));
	});

	it("drops undefined object members, so absent and undefined are equal", () => {
		assert.strictEqual(canonical({ a: 1, b: undefined }), canonical({ a: 1 }));
		assert.strictEqual(canonical({ a: { b: undefined } }), '{"a":{}}');
	});

	it("writes an undefined array element as null, as JSON.stringify does", () => {
		assert.strictEqual(canonical([1, undefined]), "[1,null]");
	});

	it("honours a Date's toJSON, so a Date fingerprints as its ISO string", () => {
		assert.strictEqual(canonical({ at: new Date(0) }), '{"at":"1970-01-01T00:00:00.000Z"}');
		assert.strictEqual(canonical([new Date(Number.NaN)]), "[null]");
	});

	it("sorts numeric-like keys lexicographically", () => {
		assert.strictEqual(canonical({ 2: "b", 10: "a", 1: "c" }), '{"1":"c","10":"a","2":"b"}');
	});

	it("matches JSON.stringify's text for already-sorted plain JSON", () => {
		const value = { a: [1, "two", true, null, { b: -0.5 }], c: 'q"uote\n' };
		assert.strictEqual(canonical(value), JSON.stringify(value));
	});

	it("accepts a null-prototype object", () => {
		const bare = Object.assign(Object.create(null) as object, { b: 1, a: 2 });
		assert.strictEqual(canonical(bare), '{"a":2,"b":1}');
	});

	describe("refuses values with no faithful JSON form", () => {
		const cases: ReadonlyArray<readonly [string, unknown, string, string]> = [
			["a bigint", { n: 1n }, "/n", "a bigint"],
			["a function member", { f: () => 1 }, "/f", "a function"],
			["a symbol element", [Symbol("s")], "/0", "a symbol"],
			["a non-finite number", { x: Number.NaN }, "/x", "the number NaN"],
			["Infinity", [Infinity], "/0", "the number Infinity"],
			["a Map", { m: new Map() }, "/m", "a Map (encode it to plain JSON first)"],
			["a Set", new Set(), "", "a Set (encode it to plain JSON first)"],
			["a class instance", { c: new (class Point {})() }, "/c", "a non-plain object (encode it to plain JSON first)"],
			[
				"a class instance with a toJSON",
				{
					c: new (class Point {
						toJSON() {
							return { x: 1 };
						}
					})(),
				},
				"/c",
				"a non-plain object (encode it to plain JSON first)",
			],
			["an Option", { o: Option.some(1) }, "/o", "a non-plain object (encode it to plain JSON first)"],
			["a HashMap", [HashMap.make(["a", 1])], "/0", "a non-plain object (encode it to plain JSON first)"],
			["a plain object's toJSON member", { v: { toJSON: () => 1 } }, "/v/toJSON", "a function"],
			["a top-level undefined", undefined, "", "undefined"],
			["a key needing escape", { "a/b": { "~": 1n } }, "/a~1b/~0", "a bigint"],
		];
		for (const [name, value, path, detail] of cases) {
			it(name, () => {
				const error = refusal(value);
				assert.strictEqual(error.path, path);
				assert.strictEqual(error.detail, detail);
			});
		}

		it("a cycle", () => {
			const cyclic: Record<string, unknown> = { a: 1 };
			cyclic.self = { back: cyclic };
			const error = refusal(cyclic);
			assert.strictEqual(error.detail, "a cycle");
			assert.strictEqual(error.path, "/self/back");
		});

		it("a shared, acyclic reference is not a cycle", () => {
			const shared = { x: 1 };
			assert.strictEqual(canonical({ a: shared, b: shared }), '{"a":{"x":1},"b":{"x":1}}');
		});

		it("a value nested too deeply to walk", () => {
			let deep: unknown = 1;
			for (let depth = 0; depth < 1_000_000; depth++) deep = [deep];
			const error = refusal(deep);
			assert.strictEqual(error.path, "");
			assert.strictEqual(error.detail, "a value nested too deeply");
		});

		it("a getter that throws", () => {
			const value = {
				get boom(): number {
					throw new Error("nope");
				},
			};
			const error = refusal(value);
			assert.strictEqual(error.path, "/boom");
			assert.strictEqual(error.detail, "a getter that throws");
			assert.strictEqual(error.message, 'cannot fingerprint "/boom": a getter that throws has no canonical JSON form');
		});
	});
});

describe("a throw that is not about the value's JSON form", () => {
	const trap = new Error("ownKeys trap");
	const hostile = () =>
		new Proxy(
			{},
			{
				ownKeys() {
					throw trap;
				},
			},
		);

	it("propagates out of canonicalizeResult rather than becoming a refusal", () => {
		assert.throws(() => Fingerprint.canonicalizeResult({ p: hostile() }), "ownKeys trap");
	});

	it("SpiderMonkey's InternalError: too much recursion is the same refusal", () => {
		const exhausted = new Proxy(
			{},
			{
				ownKeys() {
					const error = new Error("too much recursion");
					error.name = "InternalError";
					throw error;
				},
			},
		);
		const error = refusal({ p: exhausted });
		assert.strictEqual(error.detail, "a value nested too deeply");
	});

	it("a RangeError that is not a stack overflow propagates too", () => {
		const ranged = new Proxy(
			{},
			{
				ownKeys() {
					throw new RangeError("Invalid string length");
				},
			},
		);
		assert.throws(() => Fingerprint.canonicalizeResult({ p: ranged }), "Invalid string length");
	});

	it.effect("is a defect, not a FingerprintError, from Fingerprint.of", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(Fingerprint.of({ p: hostile() }));
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				assert.isTrue(exit.cause.reasons.some((reason) => reason._tag === "Die" && reason.defect === trap));
			}
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);
});

layer(NodeCrypto.layer)("Fingerprint.of", (it) => {
	it.effect("is the sha256 hex of the canonical text", () =>
		Effect.gen(function* () {
			const value = { b: [2, 1], a: "x" };
			const expected = createHash("sha256").update('{"a":"x","b":[2,1]}').digest("hex");
			assert.strictEqual(yield* Fingerprint.of(value), expected);
		}),
	);

	it.effect("is independent of key order and undefined members", () =>
		Effect.gen(function* () {
			const a = yield* Fingerprint.of({ name: "main", rules: [{ type: "x", on: true }], note: undefined });
			const b = yield* Fingerprint.of({ rules: [{ on: true, type: "x" }], name: "main" });
			assert.strictEqual(a, b);
		}),
	);

	it.effect("is sensitive to array order", () =>
		Effect.gen(function* () {
			assert.notStrictEqual(yield* Fingerprint.of({ r: ["a", "b"] }), yield* Fingerprint.of({ r: ["b", "a"] }));
		}),
	);

	it.effect("is stable across runs: a pinned digest", () =>
		Effect.gen(function* () {
			// sha256 of {"a":1,"b":[true,null,"x"]}, computed once and pinned so a rule change cannot pass silently.
			assert.strictEqual(
				yield* Fingerprint.of({ b: [true, null, "x"], a: 1 }),
				createHash("sha256").update('{"a":1,"b":[true,null,"x"]}').digest("hex"),
			);
			assert.strictEqual(
				yield* Fingerprint.of({ b: [true, null, "x"], a: 1 }),
				"eca8cfb31ab74533e1eb2f4c74d2d55dfe3c79ac704787e54be8647ea7777eb1",
			);
		}),
	);

	it.effect("fails typed for a value with no JSON form", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Fingerprint.of({ n: 1n }));
			assert.strictEqual(error._tag, "FingerprintError");
		}),
	);
});

describe("Fingerprint.decide", () => {
	it("no baseline is Apply", () => {
		assert.strictEqual(Fingerprint.decide({ live: "l", desired: "d" })._tag, "Apply");
		assert.strictEqual(Fingerprint.decide({ applied: undefined, live: "d", desired: "d" })._tag, "Apply");
	});

	it("live matches the baseline and desired is unchanged: Unchanged", () => {
		assert.strictEqual(Fingerprint.decide({ applied: "a", live: "a", desired: "a" })._tag, "Unchanged");
	});

	it("live matches the baseline and desired changed: Apply", () => {
		assert.strictEqual(Fingerprint.decide({ applied: "a", live: "a", desired: "d" })._tag, "Apply");
	});

	it("live departed from the baseline: Drift, carrying both", () => {
		const decision = Fingerprint.decide({ applied: "a", live: "l", desired: "a" });
		assert.strictEqual(decision._tag, "Drift");
		if (decision._tag === "Drift") {
			assert.strictEqual(decision.applied, "a");
			assert.strictEqual(decision.live, "l");
		}
	});

	it("desired changed AND live drifted: Drift wins, so nothing is overwritten unannounced", () => {
		const decision = Fingerprint.decide({ applied: "a", live: "l", desired: "d" });
		assert.strictEqual(decision._tag, "Drift");
	});

	it("an out-of-band change that equals desired is still Drift", () => {
		assert.strictEqual(Fingerprint.decide({ applied: "a", live: "d", desired: "d" })._tag, "Drift");
	});

	it("a decision round-trips through the DriftDecision schema", () => {
		const decision = Fingerprint.decide({ applied: "a", live: "l", desired: "d" });
		const encoded = Schema.encodeSync(DriftDecision)(decision);
		assert.deepStrictEqual(encoded, { _tag: "Drift", applied: "a", live: "l" });
		assert.deepStrictEqual(Schema.decodeUnknownSync(DriftDecision)(encoded), decision);
	});
});
