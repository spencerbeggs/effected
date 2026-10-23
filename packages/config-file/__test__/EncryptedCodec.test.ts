import { inspect } from "node:util";
import { afterEach, assert, describe, it, vi } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import type { ConfigCodec } from "../src/ConfigCodec.js";
import { ConfigEncryptionError, EncryptedCodec, EncryptedCodecKey } from "../src/EncryptedCodec.js";
import { JsonCodec } from "../src/JsonCodec.js";

const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const key = () => EncryptedCodecKey.fromPassphrase("correct horse battery staple", salt);

/** A real AES-GCM key, generated rather than derived — drives the `fromCryptoKey` variant. */
const generateKeyForTest = (): Effect.Effect<CryptoKey, ConfigEncryptionError> =>
	Effect.promise(() =>
		globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
	);

/** A codec that hands its input straight through, so we can encrypt bytes the json codec would reject. */
const passthrough: ConfigCodec<never> = {
	name: "raw",
	parse: (raw) => Effect.succeed(raw as unknown),
	stringify: (value) => Effect.succeed(value as string),
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("EncryptedCodec", () => {
	it.effect("round-trips a value through encryption", () =>
		Effect.gen(function* () {
			const codec = EncryptedCodec(JsonCodec, key());
			const ciphertext = yield* codec.stringify({ port: 8080 });
			assert.deepStrictEqual(yield* codec.parse(ciphertext), { port: 8080 });
		}),
	);

	it.effect("the ciphertext does not leak the plaintext", () =>
		Effect.gen(function* () {
			const codec = EncryptedCodec(JsonCodec, key());
			const ciphertext = yield* codec.stringify({ port: 8080, secret: "hunter2" });
			// Neither the base64 envelope nor its decoded bytes may contain the plaintext.
			assert.notInclude(ciphertext, "8080");
			assert.notInclude(ciphertext, "hunter2");
			const decoded = atob(ciphertext);
			assert.notInclude(decoded, "8080");
			assert.notInclude(decoded, "hunter2");
			assert.notInclude(decoded, "port");
		}),
	);

	it.effect("produces a different ciphertext each time — the IV is random", () =>
		Effect.gen(function* () {
			const codec = EncryptedCodec(JsonCodec, key());
			const a = yield* codec.stringify({ port: 1 });
			const b = yield* codec.stringify({ port: 1 });
			assert.notStrictEqual(a, b);
			// The 12-byte IV prefix differs...
			assert.notStrictEqual(atob(a).slice(0, 12), atob(b).slice(0, 12));
			// ...and both still decrypt to the same plaintext.
			assert.deepStrictEqual(yield* codec.parse(a), { port: 1 });
			assert.deepStrictEqual(yield* codec.parse(b), { port: 1 });
		}),
	);

	it.effect("fails with ConfigEncryptionError when the ciphertext is too short for an IV", () =>
		Effect.gen(function* () {
			const codec = EncryptedCodec(JsonCodec, key());
			const error = yield* Effect.flip(codec.parse(btoa("short")));
			assert.instanceOf(error, ConfigEncryptionError);
			assert.strictEqual(error._tag, "ConfigEncryptionError");
			assert.strictEqual((error as ConfigEncryptionError).phase, "decrypt");
		}),
	);

	it.effect("a too-short ciphertext fails typed, never as a defect", () =>
		Effect.gen(function* () {
			const codec = EncryptedCodec(JsonCodec, key());
			const exit = yield* Effect.exit(codec.parse(btoa("short")));
			assert.isTrue(Exit.isFailure(exit));
			const cause = Exit.getCause(exit);
			assert.isTrue(Option.isSome(cause));
			if (Option.isSome(cause)) {
				assert.isTrue(Cause.hasFails(cause.value));
				assert.isFalse(Cause.hasDies(cause.value));
			}
		}),
	);

	it.effect("fails with phase encoding when the input is not valid base64", () =>
		Effect.gen(function* () {
			const codec = EncryptedCodec(JsonCodec, key());
			const error = yield* Effect.flip(codec.parse("!!! not base64 !!!"));
			assert.instanceOf(error, ConfigEncryptionError);
			assert.strictEqual((error as ConfigEncryptionError).phase, "encoding");
			// The caught host failure rides along structurally — never String(e).
			assert.notStrictEqual(typeof (error as ConfigEncryptionError).cause, "string");
		}),
	);

	it.effect("fails with ConfigEncryptionError on a wrong passphrase", () =>
		Effect.gen(function* () {
			const ciphertext = yield* EncryptedCodec(JsonCodec, key()).stringify({ port: 1 });
			const wrong = EncryptedCodec(JsonCodec, EncryptedCodecKey.fromPassphrase("wrong", salt));
			const error = yield* Effect.flip(wrong.parse(ciphertext));
			assert.instanceOf(error, ConfigEncryptionError);
			assert.strictEqual((error as ConfigEncryptionError).phase, "decrypt");
		}),
	);

	it.effect("a wrong passphrase fails typed, never as a defect", () =>
		Effect.gen(function* () {
			const ciphertext = yield* EncryptedCodec(JsonCodec, key()).stringify({ port: 1 });
			const wrong = EncryptedCodec(JsonCodec, EncryptedCodecKey.fromPassphrase("wrong", salt));
			const exit = yield* Effect.exit(wrong.parse(ciphertext));
			assert.isTrue(Exit.isFailure(exit));
			const cause = Exit.getCause(exit);
			assert.isTrue(Option.isSome(cause));
			if (Option.isSome(cause)) {
				assert.isTrue(Cause.hasFails(cause.value));
				assert.isFalse(Cause.hasDies(cause.value));
			}
		}),
	);

	it.effect("surfaces the inner codec's error after successful decryption", () =>
		Effect.gen(function* () {
			// Encrypt invalid JSON with a raw passthrough codec, then decrypt with json.
			const ciphertext = yield* EncryptedCodec(passthrough, key()).stringify("{ not json");
			const error = yield* Effect.flip(EncryptedCodec(JsonCodec, key()).parse(ciphertext));
			// The inner codec's error, widened not flattened.
			assert.strictEqual(error._tag, "ConfigCodecError");
			assert.notInstanceOf(error, ConfigEncryptionError);
			// Decryption succeeded and JSON.parse then failed, so the SyntaxError it
			// threw must reach the caller intact. Without this, a regression that
			// replaced `cause` with its string form would still pass.
			assert.instanceOf(error.cause, SyntaxError);
		}),
	);

	it("names itself after the codec it wraps", () => {
		assert.strictEqual(EncryptedCodec(JsonCodec, key()).name, "encrypted(json)");
	});

	it.effect("derives the key exactly once across many operations", () =>
		Effect.gen(function* () {
			// Count derivations directly. Never assert on wall-clock time: it is
			// machine-dependent, and "the second call was fast" is not the claim.
			let derivations = 0;
			const counting = EncryptedCodecKey.fromCryptoKey(
				Effect.suspend(() => {
					derivations++;
					return generateKeyForTest();
				}),
			);
			const codec = EncryptedCodec(JsonCodec, counting);

			const a = yield* codec.stringify({ a: 1 });
			yield* codec.stringify({ a: 2 });
			yield* codec.parse(a);

			assert.strictEqual(derivations, 1);
		}),
	);

	it.effect("does not derive the key until the codec is first used", () =>
		Effect.gen(function* () {
			let derivations = 0;
			const counting = EncryptedCodecKey.fromCryptoKey(
				Effect.suspend(() => {
					derivations++;
					return generateKeyForTest();
				}),
			);
			// Constructing the codec must not run the key effect.
			const codec = EncryptedCodec(JsonCodec, counting);
			assert.strictEqual(derivations, 0);
			yield* codec.stringify({ a: 1 });
			assert.strictEqual(derivations, 1);
		}),
	);

	it.effect("runs PBKDF2 exactly once per codec instance across parse and stringify", () =>
		Effect.gen(function* () {
			// Count the real derivations at the WebCrypto boundary, so the passphrase
			// path is held to the same standard as `fromCryptoKey`.
			const subtle = globalThis.crypto.subtle;
			const spy = vi.spyOn(subtle, "deriveKey");
			const codec = EncryptedCodec(JsonCodec, key());

			const a = yield* codec.stringify({ a: 1 });
			yield* codec.stringify({ a: 2 });
			yield* codec.parse(a);
			yield* codec.parse(a);

			assert.strictEqual(spy.mock.calls.length, 1);
		}),
	);

	it.effect("a separate codec instance derives its own key", () =>
		Effect.gen(function* () {
			const subtle = globalThis.crypto.subtle;
			const spy = vi.spyOn(subtle, "deriveKey");
			yield* EncryptedCodec(JsonCodec, key()).stringify({ a: 1 });
			yield* EncryptedCodec(JsonCodec, key()).stringify({ a: 1 });
			assert.strictEqual(spy.mock.calls.length, 2);
		}),
	);

	it.effect("a failing key effect is retried after failure", () =>
		Effect.gen(function* () {
			let attempts = 0;
			const boom = new ConfigEncryptionError({ phase: "key-derivation", cause: new Error("kms down") });
			const failing = EncryptedCodecKey.fromCryptoKey(
				Effect.suspend(() => {
					attempts++;
					return Effect.fail(boom);
				}),
			);
			const codec = EncryptedCodec(JsonCodec, failing);

			const first = yield* Effect.flip(codec.stringify({ a: 1 }));
			// A well-formed envelope: parse validates it before resolving the key, so
			// this reaches the key rather than short-circuiting on the too-short guard.
			const second = yield* Effect.flip(codec.parse(btoa("x".repeat(32))));
			// The deterministic failure still fails, by identity, every time...
			assert.strictEqual(first, boom);
			assert.strictEqual(second, boom);
			// ...but only success is memoized, so each operation resolves the key again.
			assert.strictEqual(attempts, 2);
		}),
	);

	it.effect("an interrupted operation does not poison the codec", () =>
		Effect.gen(function* () {
			let attempts = 0;
			const counting = EncryptedCodecKey.fromCryptoKey(
				Effect.suspend((): Effect.Effect<CryptoKey, ConfigEncryptionError> => {
					attempts++;
					// Park the first resolution so the sibling failure interrupts it.
					return attempts === 1 ? Effect.never : generateKeyForTest();
				}),
			);
			const codec = EncryptedCodec(JsonCodec, counting);

			// Clock-free by construction: `it.effect` runs on a virtual TestClock, so a
			// timeout- or sleep-driven interrupt would never fire. A failing sibling
			// under `Effect.all` interrupts the parked key resolution immediately.
			const exit = yield* Effect.exit(
				Effect.all([codec.stringify({ a: 1 }), Effect.fail("sibling")], { concurrency: 2 }),
			);
			assert.isTrue(Exit.isFailure(exit));

			// The interrupt was not memoized: the codec re-resolves and still works.
			const ciphertext = yield* codec.stringify({ port: 8080 });
			assert.deepStrictEqual(yield* codec.parse(ciphertext), { port: 8080 });
			assert.strictEqual(attempts, 2);
		}),
	);

	it.effect("a transient key failure recovers on the next operation", () =>
		Effect.gen(function* () {
			let attempts = 0;
			const flaky = EncryptedCodecKey.fromCryptoKey(
				Effect.suspend((): Effect.Effect<CryptoKey, ConfigEncryptionError> => {
					attempts++;
					return attempts === 1
						? Effect.fail(new ConfigEncryptionError({ phase: "key-derivation", cause: new Error("kms down") }))
						: generateKeyForTest();
				}),
			);
			const codec = EncryptedCodec(JsonCodec, flaky);

			assert.instanceOf(yield* Effect.flip(codec.stringify({ a: 1 })), ConfigEncryptionError);
			// The failure was not cached, so the retry derives a usable key.
			const ciphertext = yield* codec.stringify({ port: 8080 });
			assert.deepStrictEqual(yield* codec.parse(ciphertext), { port: 8080 });
			assert.strictEqual(attempts, 2);
		}),
	);

	it.effect("a key effect that throws instead of failing is a defect, not a typed error", () =>
		Effect.gen(function* () {
			// Caller-supplied code with a declared error channel: a throw is a
			// programmer bug and must not be laundered into ConfigEncryptionError.
			const throwing = EncryptedCodecKey.fromCryptoKey(
				Effect.suspend((): Effect.Effect<CryptoKey, ConfigEncryptionError> => {
					throw new Error("bug");
				}),
			);
			const exit = yield* Effect.exit(EncryptedCodec(JsonCodec, throwing).stringify({ a: 1 }));
			assert.isTrue(Exit.isFailure(exit));
			const cause = Exit.getCause(exit);
			assert.isTrue(Option.isSome(cause));
			if (Option.isSome(cause)) {
				assert.isTrue(Cause.hasDies(cause.value));
				assert.isFalse(Cause.hasFails(cause.value));
			}
		}),
	);

	it.effect("a ciphertext written by one instance decrypts in another with the same passphrase", () =>
		Effect.gen(function* () {
			const written = yield* EncryptedCodec(JsonCodec, key()).stringify({ port: 8080 });
			const read = yield* EncryptedCodec(JsonCodec, key()).parse(written);
			assert.deepStrictEqual(read, { port: 8080 });
		}),
	);
});

describe("EncryptedCodec envelope encoding", () => {
	/** Fails the test unless `parse` failed typed with phase `encoding`, and never as a defect. */
	const assertEncodingFailure = (input: string) =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(EncryptedCodec(JsonCodec, key()).parse(input));
			if (Exit.isSuccess(exit)) return assert.fail(`expected ${JSON.stringify(input)} to be rejected`);
			assert.isFalse(Cause.hasDies(exit.cause));
			const error = Cause.findErrorOption(exit.cause);
			assert.isTrue(Option.isSome(error));
			if (Option.isSome(error)) {
				assert.instanceOf(error.value, ConfigEncryptionError);
				assert.strictEqual((error.value as ConfigEncryptionError).phase, "encoding");
			}
		});

	it.effect("tolerates whitespace around the envelope, a BOM included", () =>
		Effect.gen(function* () {
			const codec = EncryptedCodec(JsonCodec, key());
			const ciphertext = yield* codec.stringify({ port: 8080 });
			assert.deepStrictEqual(yield* codec.parse(`\n  ${ciphertext}  \n`), { port: 8080 });
			assert.deepStrictEqual(yield* codec.parse(`\uFEFF${ciphertext}\t`), { port: 8080 });
		}),
	);

	it.effect("rejects whitespace inside the envelope with phase encoding", () =>
		Effect.gen(function* () {
			const ciphertext = yield* EncryptedCodec(JsonCodec, key()).stringify({ port: 8080 });
			const middle = Math.floor(ciphertext.length / 2);
			yield* assertEncodingFailure(`${ciphertext.slice(0, middle)} ${ciphertext.slice(middle)}`);
			yield* assertEncodingFailure(`${ciphertext.slice(0, middle)}\t${ciphertext.slice(middle)}`);
		}),
	);

	it.effect("rejects an envelope whose padding was stripped, with phase encoding", () =>
		Effect.gen(function* () {
			// `{"port":1}` is 10 bytes; with the 12-byte IV and 16-byte tag the
			// envelope is 38 bytes, which base64 must pad.
			const ciphertext = yield* EncryptedCodec(JsonCodec, key()).stringify({ port: 1 });
			assert.isTrue(ciphertext.endsWith("="), "the fixture must carry padding for this test to mean anything");
			yield* assertEncodingFailure(ciphertext.replace(/=+$/, ""));
		}),
	);

	it.effect("a plaintext file handed to the codec does not leak its contents into the error", () =>
		Effect.gen(function* () {
			// Core's EncodingError keeps the whole input; the cause must not. Two
			// shapes: one whose length fails the multiple-of-4 check, and one of
			// length 28 that reaches the character scan.
			const secret = "npm_SECRETVALUE";
			for (const plaintext of [`{"token":"${secret}"}`, `{"token":"${secret}1"}`]) {
				const exit = yield* Effect.exit(EncryptedCodec(JsonCodec, key()).parse(plaintext));
				if (Exit.isSuccess(exit)) return assert.fail("expected a plaintext envelope to be rejected");
				const error = Cause.findErrorOption(exit.cause);
				if (Option.isNone(error)) return assert.fail("expected a typed failure");
				assert.strictEqual((error.value as ConfigEncryptionError).phase, "encoding");
				assert.notInclude(inspect(error.value, { depth: Infinity }), secret);
				assert.notInclude(JSON.stringify(error.value), secret);
				assert.notInclude(Cause.pretty(exit.cause), secret);
			}
		}),
	);

	it.effect("decrypts a frozen envelope fixture", () =>
		Effect.gen(function* () {
			// A fixed ciphertext pinning the envelope format: PBKDF2 over this
			// passphrase and salt, then IV followed by ciphertext, base64-encoded.
			// It was written by the earlier btoa encoder, but btoa and core's
			// Base64.encode emit identical padded RFC 4648 text for the same bytes,
			// so this pins the format and the decrypt path, not which encoder ran.
			const legacySalt = new TextEncoder().encode("fixture-salt-0001");
			const codec = EncryptedCodec(JsonCodec, EncryptedCodecKey.fromPassphrase("legacy-btoa-fixture", legacySalt));
			const legacy = "JtqcET1um1R2IxhkU3zxRkemVCHcztK0raVjIlJdTfwhoO4CUMEpyn7Hd9/Nxzh1Dz/bPiXFmwtNse/IomG4xw4T";
			assert.deepStrictEqual(yield* codec.parse(legacy), { port: 4242, name: "legacy" });
		}),
	);
});

describe("EncryptedCodec IV generation", () => {
	it.effect("a runtime without WebCrypto randomness fails typed with phase encrypt, not as a defect", () =>
		Effect.gen(function* () {
			// Resolve the key while WebCrypto is still present, so the only
			// missing piece at `stringify` time is the IV's random source.
			const cryptoKey = yield* generateKeyForTest();
			const codec = EncryptedCodec(JsonCodec, EncryptedCodecKey.fromCryptoKey(Effect.succeed(cryptoKey)));
			const exit = yield* Effect.acquireUseRelease(
				Effect.sync(() => vi.stubGlobal("crypto", undefined)),
				() => Effect.exit(codec.stringify({ port: 1 })),
				() => Effect.sync(() => vi.unstubAllGlobals()),
			);
			if (Exit.isSuccess(exit)) return assert.fail("expected stringify to fail without globalThis.crypto");
			assert.isFalse(Cause.hasDies(exit.cause));
			const error = Cause.findErrorOption(exit.cause);
			assert.isTrue(Option.isSome(error));
			if (Option.isSome(error)) {
				assert.instanceOf(error.value, ConfigEncryptionError);
				assert.strictEqual((error.value as ConfigEncryptionError).phase, "encrypt");
			}
		}),
	);
});
