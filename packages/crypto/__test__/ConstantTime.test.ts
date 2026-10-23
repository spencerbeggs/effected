import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
import { afterEach, vi } from "vitest";
import { ConstantTime } from "../src/ConstantTime.js";

const byteEqual = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((value, index) => value === b[index]);

describe("ConstantTime.equal", () => {
	it.prop("agrees with byte equality", [Schema.Uint8Array, Schema.Uint8Array], ([a, b]) => {
		return ConstantTime.equal(a, b) === byteEqual(a, b);
	});

	it.prop("is true for a copy and false once any one byte differs", [Schema.Uint8Array, Schema.Number], ([a, n]) => {
		if (!ConstantTime.equal(a, new Uint8Array(a))) return false;
		if (a.length === 0) return true;
		const index = Math.abs(Math.trunc(Number.isFinite(n) ? n : 0)) % a.length;
		const changed = new Uint8Array(a);
		changed[index] = (changed[index] ?? 0) ^ 0xff;
		return !ConstantTime.equal(a, changed);
	});

	it("is false on a length mismatch, even when one is a prefix of the other", () => {
		assert.isFalse(ConstantTime.equal(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])));
		assert.isFalse(ConstantTime.equal(new Uint8Array(0), new Uint8Array([0])));
		assert.isFalse(ConstantTime.equal("secret", "secret!"));
	});

	it("compares strings as their UTF-8 bytes", () => {
		assert.isTrue(ConstantTime.equal("", ""));
		assert.isTrue(ConstantTime.equal("héllo", "héllo"));
		assert.isFalse(ConstantTime.equal("héllo", "hello"));
		assert.isTrue(ConstantTime.equal("é", new Uint8Array([0xc3, 0xa9])));
	});
});

describe("ConstantTime.secretsEqual", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it.effect("is true for equal secrets in any input form, with nothing in R", () =>
		Effect.gen(function* () {
			assert.isTrue(yield* ConstantTime.secretsEqual(Redacted.make("hunter2"), "hunter2"));
			assert.isTrue(yield* ConstantTime.secretsEqual("hunter2", new TextEncoder().encode("hunter2")));
			assert.isTrue(yield* ConstantTime.secretsEqual("", ""));
		}),
	);

	it.effect("is false for different secrets, including a prefix and a different length", () =>
		Effect.gen(function* () {
			assert.isFalse(yield* ConstantTime.secretsEqual(Redacted.make("hunter2"), "hunter3"));
			assert.isFalse(yield* ConstantTime.secretsEqual(Redacted.make("hunter2"), "hunter"));
			assert.isFalse(yield* ConstantTime.secretsEqual(Redacted.make("hunter2"), ""));
			assert.isFalse(yield* ConstantTime.secretsEqual(Redacted.make("hunter2"), " hunter2 "));
		}),
	);

	it.effect("blinds both sides under one fresh, non-extractable HMAC key per comparison", () =>
		Effect.gen(function* () {
			// Spies pass through to the real WebCrypto and only record the calls.
			const generateKey = vi.spyOn(globalThis.crypto.subtle, "generateKey");
			const sign = vi.spyOn(globalThis.crypto.subtle, "sign");
			assert.isTrue(yield* ConstantTime.secretsEqual("a", "a"));
			assert.isFalse(yield* ConstantTime.secretsEqual("a", "b"));
			const params: ReadonlyArray<unknown> = [{ name: "HMAC", hash: "SHA-256" }, false, ["sign"]];
			assert.deepStrictEqual(
				generateKey.mock.calls.map((call): ReadonlyArray<unknown> => [...call]),
				[params, params],
			);
			const keys = sign.mock.calls.map((call) => call[1]);
			assert.strictEqual(keys.length, 4);
			assert.strictEqual(keys[0], keys[1], "both sides of one comparison share its key");
			assert.strictEqual(keys[2], keys[3]);
			assert.notStrictEqual(keys[0], keys[2], "a key is never reused across comparisons");
			assert.isFalse(keys[0]?.extractable);
		}),
	);

	it.effect("fails with unsupportedRuntime when the runtime has no crypto.subtle", () =>
		Effect.gen(function* () {
			vi.stubGlobal("crypto", undefined);
			const error = yield* Effect.flip(ConstantTime.secretsEqual("a", "a"));
			assert.strictEqual(error._tag, "CryptoError");
			assert.strictEqual(error.reason, "unsupportedRuntime");
		}),
	);
});
