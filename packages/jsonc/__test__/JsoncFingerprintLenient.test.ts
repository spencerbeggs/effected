// The lenient canonicalization rules of `JsoncCanonicalizeOptions` (#1121):
// each value kind's rule, its strict default, its inertness on plain JSON,
// and cycles under the lenient walk.

import { createHash } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { Digest } from "effect/crypto";
import type { JsoncDigest } from "../src/index.js";
import { JsoncCanonicalizeError, JsoncCanonicalizeOptions, JsoncFingerprint } from "../src/index.js";

const ALL = JsoncCanonicalizeOptions.make({ bigint: "number", undefined: "omit", nonFinite: "null", toJSON: "all" });

const text = (value: unknown, options?: JsoncCanonicalizeOptions): string => {
	const result = JsoncFingerprint.canonicalizeResult(value, options);
	if (Result.isSuccess(result)) return result.success;
	return assert.fail(`expected success, got ${result.failure.message}`);
};

const failure = (value: unknown, options?: JsoncCanonicalizeOptions): JsoncCanonicalizeError => {
	const result = JsoncFingerprint.canonicalizeResult(value, options);
	if (Result.isFailure(result)) return result.failure;
	return assert.fail(`expected failure, got ${result.success}`);
};

const nodeDigest: JsoncDigest = (bytes) => createHash("sha256").update(bytes).digest();

const DigestTest = Digest.layerWebCrypto;

describe("JsoncCanonicalizeOptions", () => {
	describe("bigint", () => {
		const big = 123456789012345678901n;

		it("fails BigIntValue by default and under bigint: fail", () => {
			assert.strictEqual(failure({ n: big }).code, "BigIntValue");
			assert.strictEqual(failure({ n: big }, JsoncCanonicalizeOptions.make({ bigint: "fail" })).code, "BigIntValue");
		});

		it("writes the bare decimal literal under bigint: number, at any depth", () => {
			const options = JsoncCanonicalizeOptions.make({ bigint: "number" });
			assert.strictEqual(text({ ticket: big, list: [-big] }, options), `{"list":[-${big}],"ticket":${big}}`);
			assert.strictEqual(text(big, options), String(big));
		});

		it("never collides with the same digits as a string, and equals the number of the same value", () => {
			const options = JsoncCanonicalizeOptions.make({ bigint: "number" });
			assert.notStrictEqual(text({ n: big }, options), text({ n: String(big) }, options));
			assert.strictEqual(text({ n: 5n }, options), text({ n: 5 }, options));
		});

		it("equals the number of the same value only up to the safe-integer bound", () => {
			const options = JsoncCanonicalizeOptions.make({ bigint: "number" });
			// Inside the bound both write every digit.
			for (const n of [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 0]) {
				assert.strictEqual(text(BigInt(n), options), text(n, options), String(n));
			}
			// Past it a number writes its shortest round-trip form, zero-filling
			// the digits a double cannot hold, then exponent notation from 1e21;
			// a bigint always writes its exact digits.
			assert.strictEqual(text(2 ** 60, options), "1152921504606847000");
			assert.strictEqual(text(2n ** 60n, options), "1152921504606846976");
			assert.strictEqual(text(1e21, options), "1e+21");
			assert.strictEqual(text(10n ** 21n, options), "1000000000000000000000");
		});
	});

	describe("undefined", () => {
		const omit = JsoncCanonicalizeOptions.make({ undefined: "omit" });

		it("fails UnrepresentableValue by default", () => {
			assert.strictEqual(failure({ a: undefined }).code, "UnrepresentableValue");
			assert.strictEqual(failure([undefined]).path, "/0");
		});

		it("omits an undefined object member under undefined: omit", () => {
			assert.strictEqual(text({ b: 1, a: undefined, c: { d: undefined } }, omit), '{"b":1,"c":{}}');
		});

		it("writes an undefined array element and a hole as null, so indexes never shift", () => {
			// biome-ignore lint/suspicious/noSparseArray: the hole is the input under test.
			const sparse = [1, , 3];
			assert.strictEqual(text([undefined, 2], omit), "[null,2]");
			assert.strictEqual(text(sparse, omit), "[1,null,3]");
		});

		it("still fails an undefined document root, with no text to write", () => {
			const error = failure(undefined, omit);
			assert.strictEqual(error.code, "UnrepresentableValue");
			assert.strictEqual(error.path, "");
		});

		it("still fails functions and symbols at any position", () => {
			assert.strictEqual(failure({ f: () => 1 }, omit).code, "UnrepresentableValue");
			assert.strictEqual(failure([Symbol("s")], omit).path, "/0");
		});
	});

	describe("nonFinite", () => {
		it("fails NonFiniteNumber by default", () => {
			assert.strictEqual(failure({ x: Number.NaN }).code, "NonFiniteNumber");
		});

		it("writes NaN and both infinities as null under nonFinite: null", () => {
			const options = JsoncCanonicalizeOptions.make({ nonFinite: "null" });
			assert.strictEqual(
				text({ a: Number.NaN, b: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY] }, options),
				'{"a":null,"b":[null,null]}',
			);
		});
	});

	describe("toJSON", () => {
		class Money {
			constructor(readonly cents: number) {}
			toJSON(): unknown {
				return { cents: this.cents };
			}
		}

		it("is ignored by default: a Date and a toJSON-bearing class fail NonPlainObject", () => {
			assert.strictEqual(failure({ at: new Date(0) }).code, "NonPlainObject");
			assert.strictEqual(failure(new Money(5)).code, "NonPlainObject");
			assert.strictEqual(failure({ at: new Date(0) }, JsoncCanonicalizeOptions.make({ toJSON: "ignore" })).path, "/at");
		});

		it("honours a Date only under toJSON: date, valid and invalid", () => {
			const options = JsoncCanonicalizeOptions.make({ toJSON: "date" });
			assert.strictEqual(
				text({ at: new Date(0), bad: new Date(Number.NaN) }, options),
				'{"at":"1970-01-01T00:00:00.000Z","bad":null}',
			);
			assert.strictEqual(failure({ m: new Money(5) }, options).code, "NonPlainObject");
		});

		it("honours any toJSON under toJSON: all, canonicalizing its result", () => {
			const options = JsoncCanonicalizeOptions.make({ toJSON: "all" });
			assert.strictEqual(
				text({ m: new Money(5), at: new Date(0) }, options),
				'{"at":"1970-01-01T00:00:00.000Z","m":{"cents":5}}',
			);
			// Plain objects and arrays carrying a callable toJSON are honoured too.
			assert.strictEqual(text({ toJSON: () => [2, 1] }, options), "[2,1]");
			const list = Object.assign([1, 2], { toJSON: () => "list" });
			assert.strictEqual(text(list, options), '"list"');
		});

		it("calls toJSON with the member key, the index as a string, or the empty root key", () => {
			const keys: Array<string> = [];
			const probe = {
				toJSON: (key: string) => {
					keys.push(key);
					return 0;
				},
			};
			text({ k: probe, l: [probe] }, JsoncCanonicalizeOptions.make({ toJSON: "all" }));
			text(probe, JsoncCanonicalizeOptions.make({ toJSON: "all" }));
			assert.deepStrictEqual(keys, ["k", "0", ""]);
		});

		it("does not call toJSON again on its result", () => {
			const inner = { toJSON: () => "inner was called" };
			const outer = { toJSON: () => inner };
			// The result's own toJSON is a function member, which never canonicalizes.
			const error = failure(outer, JsoncCanonicalizeOptions.make({ toJSON: "all" }));
			assert.strictEqual(error.code, "UnrepresentableValue");
			assert.strictEqual(error.path, "/toJSON");
		});

		it("applies the other rules to toJSON's result, undefined omission included", () => {
			const options = JsoncCanonicalizeOptions.make({ toJSON: "all", undefined: "omit", bigint: "number" });
			assert.strictEqual(
				text({ gone: { toJSON: () => undefined }, kept: { toJSON: () => 7n } }, options),
				'{"kept":7}',
			);
			assert.strictEqual(
				failure({ n: { toJSON: () => 7n } }, JsoncCanonicalizeOptions.make({ toJSON: "all" })).code,
				"BigIntValue",
			);
		});

		it("fails UnrepresentableValue at its path when toJSON throws, never escaping", () => {
			const hostile = {
				toJSON: () => {
					throw new Error("hostile toJSON");
				},
			};
			const error = failure({ a: [hostile] }, JsoncCanonicalizeOptions.make({ toJSON: "all" }));
			assert.strictEqual(error.code, "UnrepresentableValue");
			assert.strictEqual(error.path, "/a/0");
			assert.include(error.detail, "toJSON");
		});
	});

	describe("cycles", () => {
		it("a property cycle still fails NestingDepthExceeded under every lenient rule", () => {
			const cyclic: Record<string, unknown> = { gone: undefined };
			cyclic.self = cyclic;
			assert.strictEqual(failure(cyclic, ALL).code, "NestingDepthExceeded");
		});

		it("a cycle through toJSON results fails NestingDepthExceeded, never a stack overflow", () => {
			class Endless {
				toJSON(): unknown {
					return { next: new Endless() };
				}
			}
			assert.strictEqual(failure(new Endless(), ALL).code, "NestingDepthExceeded");
		});
	});

	describe("inert on plain JSON", () => {
		it("an empty options value is the strict default", () => {
			assert.strictEqual(failure({ n: 1n }, JsoncCanonicalizeOptions.make({})).code, "BigIntValue");
		});

		it.prop(
			"every rule together leaves plain JSON output byte-identical to strict RFC 8785",
			[Schema.Json],
			([value]) => {
				const strict = JsoncFingerprint.canonicalizeResult(value);
				const lenient = JsoncFingerprint.canonicalizeResult(value, ALL);
				assert.deepStrictEqual(lenient, strict);
			},
		);
	});

	describe("hashing threads the options through", () => {
		const options = JsoncCanonicalizeOptions.make({ bigint: "number", undefined: "omit" });
		const value = { ticket: 123456789012345678901n, note: undefined };

		it("hashResult fingerprints the lenient canonical text", () => {
			const expected = createHash("sha256").update(text(value, options)).digest("hex");
			const result = JsoncFingerprint.hashResult(value, nodeDigest, options);
			assert.isTrue(Result.isSuccess(result));
			assert.strictEqual(Result.getOrThrow(result), expected);
			const strict = JsoncFingerprint.hashResult(value, nodeDigest);
			if (Result.isFailure(strict)) {
				// Keys sort first: the strict walk refuses `note` before reaching `ticket`.
				assert.strictEqual(strict.failure.code, "UnrepresentableValue");
				assert.strictEqual(strict.failure.path, "/note");
			} else {
				assert.fail("expected the strict default to refuse the undefined member");
			}
		});

		it.effect("hash and canonicalize agree with their Result twins", () =>
			Effect.gen(function* () {
				const expected = createHash("sha256").update(text(value, options)).digest("hex");
				assert.strictEqual(yield* JsoncFingerprint.hash(value, options), expected);
				assert.strictEqual(yield* JsoncFingerprint.canonicalize(value, options), text(value, options));
				const error = yield* Effect.flip(JsoncFingerprint.hash(value));
				assert.instanceOf(error, JsoncCanonicalizeError);
			}).pipe(Effect.provide(DigestTest)),
		);
	});
});
