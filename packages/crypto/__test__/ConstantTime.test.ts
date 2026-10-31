import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Exit, Layer, Redacted, Schema } from "effect";
import { Mac, SecureRandom, WebCrypto } from "effect/crypto";
import { ConstantTime } from "../src/ConstantTime.js";

const MacLive = Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));

/** What a recording `Mac` saw: every generated key, and the key each sign or verify used. */
interface Recorded {
	readonly generated: Array<Mac.Key>;
	readonly used: Array<Mac.Key>;
}

/** The real WebCrypto `Mac`, recording the keys it generates and is handed. */
const recording = (recorded: Recorded): Layer.Layer<Mac.Mac> =>
	Layer.effect(
		Mac.Mac,
		Effect.gen(function* () {
			const real = yield* Mac.Mac;
			return Mac.Mac.of({
				generateKey: (algorithm) =>
					Effect.tap(real.generateKey(algorithm), (key) => Effect.sync(() => recorded.generated.push(key))),
				sign: (key, data) =>
					Effect.suspend(() => {
						recorded.used.push(key);
						return real.sign(key, data);
					}),
				verify: (key, tag, data) =>
					Effect.suspend(() => {
						recorded.used.push(key);
						return real.verify(key, tag, data);
					}),
			});
		}),
	).pipe(Layer.provide(MacLive));

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

layer(MacLive)("ConstantTime.secretsEqual", (it) => {
	it.effect("is true for equal secrets in any input form", () =>
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

	it.effect("blinds both sides under one fresh HMAC-SHA256 key per comparison", () => {
		const recorded: Recorded = { generated: [], used: [] };
		return Effect.gen(function* () {
			assert.isTrue(yield* ConstantTime.secretsEqual("a", "a"));
			assert.isFalse(yield* ConstantTime.secretsEqual("a", "b"));
			assert.strictEqual(recorded.generated.length, 2);
			assert.deepStrictEqual(
				recorded.generated.map((key) => key.algorithm),
				[Mac.hmacSha256, Mac.hmacSha256],
			);
			assert.notStrictEqual(recorded.generated[0], recorded.generated[1], "a key is never reused across comparisons");
			// One sign and one verify per comparison, both under that comparison's key.
			assert.deepStrictEqual(recorded.used, [
				recorded.generated[0],
				recorded.generated[0],
				recorded.generated[1],
				recorded.generated[1],
			]);
		}).pipe(Effect.provide(recording(recorded)));
	});

	it.effect("dies, rather than failing, when the runtime has no crypto.subtle", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(ConstantTime.secretsEqual("a", "a"));
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				assert.deepStrictEqual(
					exit.cause.reasons.map((reason) => reason._tag),
					["Die"],
				);
			}
		}).pipe(
			Effect.provide(
				// `Layer.fresh`: the suite's memo map already holds the real one.
				Layer.fresh(Mac.layerWebCrypto).pipe(
					Layer.provide([SecureRandom.layerWebCrypto, WebCrypto.layer({} as typeof globalThis.crypto)]),
				),
			),
		),
	);
});

layer(NodeCrypto.layerMac)("ConstantTime.secretsEqual on a platform Mac layer", (it) => {
	it.effect("answers the same on NodeCrypto.layerMac", () =>
		Effect.gen(function* () {
			assert.isTrue(yield* ConstantTime.secretsEqual(Redacted.make("hunter2"), "hunter2"));
			assert.isFalse(yield* ConstantTime.secretsEqual(Redacted.make("hunter2"), "hunter"));
		}),
	);
});
