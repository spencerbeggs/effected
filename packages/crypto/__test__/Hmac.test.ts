import { readFileSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { afterEach, vi } from "vitest";
import type { HmacAlgorithm } from "../src/Hmac.js";
import { Hmac } from "../src/Hmac.js";

interface Vector {
	readonly case: number;
	readonly key: string;
	readonly data: string;
	readonly sha256: string;
	readonly sha512: string;
	readonly truncatedBytes?: number;
}

const vectors: ReadonlyArray<Vector> = JSON.parse(
	readFileSync(new URL("./fixtures/rfc4231.json", import.meta.url), "utf-8"),
);

const bytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, "hex"));
const hexOf = (value: Uint8Array): string => Buffer.from(value).toString("hex");

const algorithms: ReadonlyArray<readonly [HmacAlgorithm, "sha256" | "sha512"]> = [
	["SHA-256", "sha256"],
	["SHA-512", "sha512"],
];

describe("Hmac.sign (RFC 4231)", () => {
	it("reads all seven RFC 4231 test cases", () => {
		assert.deepStrictEqual(
			vectors.map((vector) => vector.case),
			[1, 2, 3, 4, 5, 6, 7],
		);
	});

	for (const [algorithm, field] of algorithms) {
		for (const vector of vectors) {
			const expected = vector[field];
			const options = { algorithm, key: bytes(vector.key), message: bytes(vector.data) } as const;

			if (vector.truncatedBytes !== undefined) {
				// The RFC publishes only the leading 128 bits of this MAC.
				it.effect(`${algorithm} case ${vector.case}: the truncated prefix`, () =>
					Effect.gen(function* () {
						const mac = yield* Hmac.sign(options);
						assert.strictEqual(hexOf(mac.subarray(0, vector.truncatedBytes)), expected);
					}),
				);
				continue;
			}

			it.effect(`${algorithm} case ${vector.case}: bytes, hex, base64 and base64url`, () =>
				Effect.gen(function* () {
					const oracle = Buffer.from(expected, "hex");
					const raw = yield* Hmac.sign(options);
					assert.instanceOf(raw, Uint8Array);
					assert.strictEqual(hexOf(raw), expected);
					assert.strictEqual(yield* Hmac.sign({ ...options, encoding: "bytes" }).pipe(Effect.map(hexOf)), expected);
					assert.strictEqual(yield* Hmac.sign({ ...options, encoding: "hex" }), expected);
					const base64 = yield* Hmac.sign({ ...options, encoding: "base64" });
					assert.strictEqual(base64, oracle.toString("base64"));
					const base64url = yield* Hmac.sign({ ...options, encoding: "base64url" });
					assert.strictEqual(base64url, oracle.toString("base64url"));
					assert.notInclude(base64url, "=", "base64url is unpadded");
				}),
			);
		}
	}

	it.effect("signs a string message as its UTF-8 bytes and a Redacted key as its UTF-8 bytes", () =>
		Effect.gen(function* () {
			// RFC 4231 case 2: key "Jefe", data "what do ya want for nothing?".
			const mac = yield* Hmac.sign({
				algorithm: "SHA-256",
				key: Redacted.make("Jefe"),
				message: "what do ya want for nothing?",
				encoding: "hex",
			});
			assert.strictEqual(mac, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
		}),
	);

	it.effect("pads base64 when the MAC length calls for it", () =>
		Effect.gen(function* () {
			// A 32-byte MAC is not a multiple of three bytes, so padded base64 ends in "=".
			const base64 = yield* Hmac.sign({ algorithm: "SHA-256", key: bytes("0b"), message: "x", encoding: "base64" });
			assert.isTrue(base64.endsWith("="));
		}),
	);
});

describe("Hmac.verify", () => {
	const case2 = { algorithm: "SHA-256", key: Redacted.make("Jefe"), message: "what do ya want for nothing?" } as const;
	const hex = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";
	const oracle = Buffer.from(hex, "hex");

	it.effect("accepts the right MAC in every encoding", () =>
		Effect.gen(function* () {
			assert.isTrue(yield* Hmac.verify({ ...case2, signature: new Uint8Array(oracle) }));
			assert.isTrue(yield* Hmac.verify({ ...case2, signature: hex, encoding: "hex" }));
			assert.isTrue(yield* Hmac.verify({ ...case2, signature: hex.toUpperCase(), encoding: "hex" }));
			assert.isTrue(yield* Hmac.verify({ ...case2, signature: oracle.toString("base64"), encoding: "base64" }));
			assert.isTrue(yield* Hmac.verify({ ...case2, signature: oracle.toString("base64url"), encoding: "base64url" }));
		}),
	);

	it.effect("rejects a MAC one bit off, in bytes and as a string", () =>
		Effect.gen(function* () {
			const flipped = new Uint8Array(oracle);
			flipped[31] = (flipped[31] ?? 0) ^ 1;
			assert.isFalse(yield* Hmac.verify({ ...case2, signature: flipped }));
			assert.isFalse(yield* Hmac.verify({ ...case2, signature: hexOf(flipped), encoding: "hex" }));
		}),
	);

	it.effect("rejects the right MAC under the wrong key, message or algorithm", () =>
		Effect.gen(function* () {
			const signature = new Uint8Array(oracle);
			assert.isFalse(yield* Hmac.verify({ ...case2, key: Redacted.make("Jeff"), signature }));
			assert.isFalse(yield* Hmac.verify({ ...case2, message: "what do ya want for nothing!", signature }));
			assert.isFalse(yield* Hmac.verify({ ...case2, algorithm: "SHA-512", signature }));
		}),
	);

	it.effect("answers false, not a failure, for a signature that does not decode or is the wrong length", () =>
		Effect.gen(function* () {
			assert.isFalse(yield* Hmac.verify({ ...case2, signature: "not hex at all", encoding: "hex" }));
			assert.isFalse(yield* Hmac.verify({ ...case2, signature: "abc", encoding: "hex" }));
			assert.isFalse(yield* Hmac.verify({ ...case2, signature: "!!!", encoding: "base64" }));
			assert.isFalse(yield* Hmac.verify({ ...case2, signature: hex.slice(0, 62), encoding: "hex" }));
			assert.isFalse(yield* Hmac.verify({ ...case2, signature: new Uint8Array(0) }));
		}),
	);
});

describe("Hmac over a multi-part message", () => {
	const key = Redacted.make("parts-key");
	const body = new Uint8Array([0xff, 0x00, 0xc3]);

	it.effect("signs the parts' bytes joined in order, exactly as the one joined message", () =>
		Effect.gen(function* () {
			const joined = new Uint8Array([...new TextEncoder().encode("1700000000."), ...body]);
			const whole = yield* Hmac.sign({ algorithm: "SHA-256", key, message: joined, encoding: "hex" });
			const parts = yield* Hmac.sign({ algorithm: "SHA-256", key, message: ["1700000000.", body], encoding: "hex" });
			assert.strictEqual(parts, whole);
			const split = yield* Hmac.sign({ algorithm: "SHA-256", key, message: ["17", "00000000", ".", body] });
			assert.deepStrictEqual(split, yield* Hmac.sign({ algorithm: "SHA-256", key, message: joined }));
			assert.isTrue(
				yield* Hmac.verify({
					algorithm: "SHA-256",
					key,
					message: ["1700000000.", body],
					signature: whole,
					encoding: "hex",
				}),
			);
		}),
	);

	it.effect("is order-sensitive, and an empty list is the empty message", () =>
		Effect.gen(function* () {
			const forward = yield* Hmac.sign({ algorithm: "SHA-256", key, message: ["a", "b"], encoding: "hex" });
			const backward = yield* Hmac.sign({ algorithm: "SHA-256", key, message: ["b", "a"], encoding: "hex" });
			assert.notStrictEqual(forward, backward);
			assert.strictEqual(
				yield* Hmac.sign({ algorithm: "SHA-256", key, message: [], encoding: "hex" }),
				yield* Hmac.sign({ algorithm: "SHA-256", key, message: "", encoding: "hex" }),
			);
		}),
	);
});

describe("Hmac failures", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.effect("fails with unsupportedRuntime when the runtime has no crypto.subtle", () =>
		Effect.gen(function* () {
			vi.stubGlobal("crypto", undefined);
			const error = yield* Effect.flip(Hmac.sign({ algorithm: "SHA-256", key: bytes("0b"), message: "x" }));
			assert.strictEqual(error._tag, "CryptoError");
			assert.strictEqual(error.reason, "unsupportedRuntime");
		}),
	);

	it.effect("fails with key when WebCrypto refuses the key, and never names the key", () =>
		Effect.gen(function* () {
			// WebCrypto refuses a zero-length HMAC key.
			const error = yield* Effect.flip(
				Hmac.verify({ algorithm: "SHA-512", key: Redacted.make(""), message: "x", signature: new Uint8Array(64) }),
			);
			assert.strictEqual(error.reason, "key");
			assert.include(error.message, "SHA-512");
		}),
	);
});

describe("Hmac.sign over byte views", () => {
	it.effect("signs exactly a view's bytes, whether it spans its buffer or sits at an offset inside one", () =>
		Effect.gen(function* () {
			const key = Redacted.make("view-key");
			const whole = new Uint8Array([1, 2, 3, 4]);
			// The same four bytes, as a window into a larger buffer: a pass-through of
			// `.buffer` here would sign all eight bytes instead.
			const backing = new Uint8Array([9, 9, 1, 2, 3, 4, 9, 9]);
			const window = backing.subarray(2, 6);
			const fromWhole = yield* Hmac.sign({ algorithm: "SHA-256", key, message: whole, encoding: "hex" });
			const fromWindow = yield* Hmac.sign({ algorithm: "SHA-256", key, message: window, encoding: "hex" });
			const fromBacking = yield* Hmac.sign({ algorithm: "SHA-256", key, message: backing, encoding: "hex" });
			assert.strictEqual(fromWindow, fromWhole);
			assert.notStrictEqual(fromBacking, fromWhole, "the control: the whole backing buffer signs differently");
		}),
	);
});
