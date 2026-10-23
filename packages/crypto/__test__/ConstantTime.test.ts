import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Crypto, Effect, Redacted, Schema } from "effect";
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

layer(NodeCrypto.layer)("ConstantTime.secretsEqual", (it) => {
	it.effect("is true for equal secrets in any input form", () =>
		Effect.gen(function* () {
			assert.isTrue(yield* ConstantTime.secretsEqual(Redacted.make("hunter2"), "hunter2"));
			assert.isTrue(yield* ConstantTime.secretsEqual("hunter2", new TextEncoder().encode("hunter2")));
		}),
	);

	it.effect("is false for different secrets, including a prefix and a different length", () =>
		Effect.gen(function* () {
			assert.isFalse(yield* ConstantTime.secretsEqual(Redacted.make("hunter2"), "hunter3"));
			assert.isFalse(yield* ConstantTime.secretsEqual(Redacted.make("hunter2"), "hunter"));
			assert.isFalse(yield* ConstantTime.secretsEqual(Redacted.make("hunter2"), ""));
		}),
	);

	it.effect("hashes both sides through the Crypto service in R", () =>
		Effect.gen(function* () {
			// A digest that ignores its input makes every pair of secrets equal,
			// which proves the comparison runs over Crypto.digest's output.
			const constant = Crypto.make({
				randomBytes: (size) => new Uint8Array(size),
				digest: () => Effect.succeed(new Uint8Array(32)),
			});
			const equal = yield* ConstantTime.secretsEqual("a", "b").pipe(Effect.provideService(Crypto.Crypto, constant));
			assert.isTrue(equal);
		}),
	);
});
