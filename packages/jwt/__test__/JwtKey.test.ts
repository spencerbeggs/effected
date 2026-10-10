import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
import type { Algorithm } from "../src/internal/algorithms.js";
import { Jwk, Jwks } from "../src/Jwk.js";
import type { JwtAlgorithm } from "../src/JwtKey.js";
import { JwtKey } from "../src/JwtKey.js";

const data = new TextEncoder().encode("header.payload");

const rsaPair = (privateType: "pkcs1" | "pkcs8", modulusLength = 2048) =>
	generateKeyPairSync("rsa", {
		modulusLength,
		privateKeyEncoding: { type: privateType, format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	});

const actionsJwks = Schema.decodeUnknownSync(Jwks)(
	JSON.parse(readFileSync(new URL("./fixtures/actions-jwks.json", import.meta.url), "utf-8")),
);
const firstActionsKey = actionsJwks.keys[0];
if (firstActionsKey === undefined) throw new Error("the Actions JWKS fixture is empty");

const reasonOf = <A>(effect: Effect.Effect<A, { readonly reason: string }>) =>
	Effect.map(Effect.flip(effect), (error) => error.reason);

describe("JwtKey.fromPkcs8Pem", () => {
	it.effect("imports a PKCS#1 RSA key whose signatures node:crypto verifies", () =>
		Effect.gen(function* () {
			const { privateKey, publicKey } = rsaPair("pkcs1");
			assert.include(privateKey, "BEGIN RSA PRIVATE KEY");
			const signing = yield* JwtKey.fromPkcs8Pem(Redacted.make(privateKey), { alg: "RS256", kid: "app" });
			assert.strictEqual(signing.alg, "RS256");
			assert.strictEqual(signing.kid, "app");
			assert.isFalse(signing.key.extractable);
			const signature = new Uint8Array(
				yield* Effect.promise(() => globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", signing.key, data)),
			);
			assert.isTrue(verify("sha256", data, publicKey, signature));
			// control: the same signature does not verify against a different key
			assert.isFalse(verify("sha256", data, rsaPair("pkcs8").publicKey, signature));
		}),
	);

	it.effect("imports the same kind of key in PKCS#8", () =>
		Effect.gen(function* () {
			const { privateKey, publicKey } = rsaPair("pkcs8");
			assert.include(privateKey, "BEGIN PRIVATE KEY");
			const signing = yield* JwtKey.fromPkcs8Pem(Redacted.make(privateKey), { alg: "RS256" });
			assert.isUndefined(signing.kid);
			const signature = new Uint8Array(
				yield* Effect.promise(() => globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", signing.key, data)),
			);
			assert.isTrue(verify("sha256", data, publicKey, signature));
		}),
	);

	it.effect("imports PKCS#1 and PKCS#8 keys whose newlines arrive escaped, as from an environment variable", () =>
		Effect.gen(function* () {
			for (const type of ["pkcs1", "pkcs8"] as const) {
				const { privateKey, publicKey } = rsaPair(type);
				const escaped = privateKey.replace(/\n/g, "\\n");
				// control: the escaped form really is one line with no newline in it
				assert.notInclude(escaped, "\n", type);
				assert.include(escaped, "\\n", type);
				const signing = yield* JwtKey.fromPkcs8Pem(Redacted.make(escaped), { alg: "RS256" });
				const signature = new Uint8Array(
					yield* Effect.promise(() => globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", signing.key, data)),
				);
				assert.isTrue(verify("sha256", data, publicKey, signature), type);
			}
		}),
	);

	it.effect("imports a P-256 PKCS#8 key for ES256", () =>
		Effect.gen(function* () {
			const { privateKey, publicKey } = generateKeyPairSync("ec", {
				namedCurve: "P-256",
				privateKeyEncoding: { type: "pkcs8", format: "pem" },
				publicKeyEncoding: { type: "spki", format: "pem" },
			});
			const signing = yield* JwtKey.fromPkcs8Pem(Redacted.make(privateKey), { alg: "ES256" });
			const signature = new Uint8Array(
				yield* Effect.promise(() =>
					globalThis.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signing.key, data),
				),
			);
			assert.isTrue(verify("sha256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature));
		}),
	);

	it.effect("rejects a corrupted body as key without echoing it", () =>
		Effect.gen(function* () {
			const { privateKey } = rsaPair("pkcs8");
			const lines = privateKey.split("\n");
			lines[3] = `${lines[3]?.slice(0, 10)}!!!!${lines[3]?.slice(14)}`;
			const error = yield* Effect.flip(JwtKey.fromPkcs8Pem(Redacted.make(lines.join("\n")), { alg: "RS256" }));
			assert.strictEqual(error.reason, "key");
			assert.notInclude(JSON.stringify(error), lines[5] ?? "");
		}),
	);

	it.effect("rejects well-formed base64 that is not a key as key", () =>
		Effect.gen(function* () {
			const pem = "-----BEGIN PRIVATE KEY-----\nAQIDBAUGBwg=\n-----END PRIVATE KEY-----\n";
			assert.strictEqual(yield* reasonOf(JwtKey.fromPkcs8Pem(Redacted.make(pem), { alg: "RS256" })), "key");
		}),
	);

	it.effect("rejects a PKCS#1 key for ES256, and an RSA key imported as ES256, as key", () =>
		Effect.gen(function* () {
			const pkcs1 = Redacted.make(rsaPair("pkcs1").privateKey);
			const refused = yield* Effect.flip(JwtKey.fromPkcs8Pem(pkcs1, { alg: "ES256" }));
			assert.strictEqual(refused.reason, "key");
			// refused on the label, before any import is attempted
			assert.include(refused.detail, "RSA PRIVATE KEY PEM block cannot be imported as an ES256");
			const pkcs8 = Redacted.make(rsaPair("pkcs8").privateKey);
			assert.strictEqual(yield* reasonOf(JwtKey.fromPkcs8Pem(pkcs8, { alg: "ES256" })), "key");
		}),
	);
});

describe("RSA key strength", () => {
	it.effect("refuses a 1024-bit PKCS#8 or PKCS#1 PEM as key, and accepts 2048 bits", () =>
		Effect.gen(function* () {
			for (const type of ["pkcs8", "pkcs1"] as const) {
				const error = yield* Effect.flip(
					JwtKey.fromPkcs8Pem(Redacted.make(rsaPair(type, 1024).privateKey), { alg: "RS256" }),
				);
				assert.strictEqual(error.reason, "key", type);
				assert.include(error.detail, "at least 2048 bits, got 1024");
				const ok = yield* JwtKey.fromPkcs8Pem(Redacted.make(rsaPair(type, 2048).privateKey), { alg: "RS256" });
				assert.strictEqual(ok.alg, "RS256");
			}
		}),
	);

	it.effect("refuses a 1024-bit public JWK as key, and accepts 2048 bits", () =>
		Effect.gen(function* () {
			const jwkOf = (modulusLength: number) =>
				Schema.decodeUnknownSync(Jwk)({
					...generateKeyPairSync("rsa", { modulusLength }).publicKey.export({ format: "jwk" }),
					alg: "RS256",
				});
			const error = yield* Effect.flip(JwtKey.fromJwk(jwkOf(1024)));
			assert.strictEqual(error.reason, "key");
			assert.include(error.detail, "at least 2048 bits, got 1024");
			assert.strictEqual((yield* JwtKey.fromJwk(jwkOf(2048))).alg, "RS256");
		}),
	);
});

describe("kid on import and strength failures", () => {
	it.effect("carries the kid when a key fails to import or is too weak", () =>
		Effect.gen(function* () {
			const weakJwk = Schema.decodeUnknownSync(Jwk)({
				...generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ format: "jwk" }),
				alg: "RS256",
				kid: "weak",
			});
			const weak = yield* Effect.flip(JwtKey.fromJwk(weakJwk));
			assert.include(weak.detail, "at least 2048 bits");
			assert.strictEqual(weak.kid, "weak");

			const offCurve = Schema.decodeUnknownSync(Jwk)({
				kty: "EC",
				crv: "P-256",
				alg: "ES256",
				kid: "bent",
				x: "AAAA",
				y: "AAAA",
			});
			const unimportable = yield* Effect.flip(JwtKey.fromJwk(offCurve));
			assert.include(unimportable.detail, "does not import");
			assert.strictEqual(unimportable.kid, "bent");

			const weakPem = yield* Effect.flip(
				JwtKey.fromPkcs8Pem(Redacted.make(rsaPair("pkcs8", 1024).privateKey), { alg: "RS256", kid: "signer" }),
			);
			assert.include(weakPem.detail, "at least 2048 bits");
			assert.strictEqual(weakPem.kid, "signer");
		}),
	);
});

describe("JwtKey.fromPkcs8Pem labels", () => {
	it.effect("refuses a SEC1 EC PRIVATE KEY block as key", () =>
		Effect.gen(function* () {
			const { privateKey } = generateKeyPairSync("ec", {
				namedCurve: "P-256",
				privateKeyEncoding: { type: "sec1", format: "pem" },
				publicKeyEncoding: { type: "spki", format: "pem" },
			});
			const error = yield* Effect.flip(JwtKey.fromPkcs8Pem(Redacted.make(privateKey), { alg: "ES256" }));
			assert.strictEqual(error.reason, "key");
			assert.include(error.detail, "EC PRIVATE KEY PEM block");
		}),
	);
});

describe("JwtKey.fromJwk", () => {
	const rsa = Schema.decodeUnknownSync(Jwk)({ kty: "RSA", n: firstActionsKey.n, e: firstActionsKey.e });

	it.effect("imports the first Actions JWKS key as an RS256 verification key", () =>
		Effect.gen(function* () {
			const key = yield* JwtKey.fromJwk(firstActionsKey);
			assert.strictEqual(key.alg, "RS256");
			assert.strictEqual(key.kid, firstActionsKey.kid);
			assert.strictEqual(key.key.type, "public");
			assert.deepStrictEqual(key.key.usages, ["verify"]);
		}),
	);

	it.effect("takes the algorithm from the option when the JWK names none", () =>
		Effect.gen(function* () {
			const key = yield* JwtKey.fromJwk(rsa, { alg: "RS256" });
			assert.strictEqual(key.alg, "RS256");
		}),
	);

	it.effect("rejects a JWK naming no algorithm with no option as key", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* reasonOf(JwtKey.fromJwk(rsa)), "key");
		}),
	);

	it.effect("rejects an alg outside RS256 and ES256 as unsupportedAlgorithm", () =>
		Effect.gen(function* () {
			for (const alg of ["HS256", "RS384", "none"]) {
				assert.strictEqual(yield* reasonOf(JwtKey.fromJwk({ ...rsa, alg })), "unsupportedAlgorithm", alg);
				assert.strictEqual(
					yield* reasonOf(JwtKey.fromJwk({ ...rsa, alg }, { alg: "RS256" })),
					"unsupportedAlgorithm",
					alg,
				);
			}
		}),
	);

	it.effect("rejects a JWK alg that differs from the option as algorithmMismatch", () =>
		Effect.gen(function* () {
			assert.strictEqual(
				yield* reasonOf(JwtKey.fromJwk({ ...rsa, alg: "RS256" }, { alg: "ES256" })),
				"algorithmMismatch",
			);
		}),
	);

	it.effect("rejects an algorithm the key type cannot carry as key", () =>
		Effect.gen(function* () {
			const { jwk: ec } = yield* JwtKey.generate("ES256");
			assert.strictEqual(yield* reasonOf(JwtKey.fromJwk({ ...rsa, alg: "ES256" })), "key");
			assert.strictEqual(yield* reasonOf(JwtKey.fromJwk(rsa, { alg: "ES256" })), "key");
			assert.strictEqual(yield* reasonOf(JwtKey.fromJwk({ ...ec, alg: "RS256" })), "key");
			assert.strictEqual(yield* reasonOf(JwtKey.fromJwk({ ...ec, crv: "P-384" })), "key");
			// the type check stands alone: a JWK carrying the other type's members is still refused
			const { n, e } = rsa;
			const { x, y } = ec;
			assert.isDefined(n);
			assert.isDefined(e);
			assert.isDefined(x);
			assert.isDefined(y);
			assert.strictEqual(yield* reasonOf(JwtKey.fromJwk({ ...ec, alg: "RS256", n, e })), "key");
			assert.strictEqual(yield* reasonOf(JwtKey.fromJwk({ ...rsa, alg: "ES256", crv: "P-256", x, y })), "key");
		}),
	);

	it.effect("rejects a key whose use is not sig as key", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* reasonOf(JwtKey.fromJwk({ ...firstActionsKey, use: "enc" })), "key");
			const key = yield* JwtKey.fromJwk({ ...firstActionsKey, use: "sig" });
			assert.strictEqual(key.alg, "RS256");
		}),
	);

	it.effect("rejects a key whose key_ops does not include verify as key", () =>
		Effect.gen(function* () {
			for (const keyOps of [["sign"], [], "verify", ["encrypt", "decrypt"]]) {
				assert.strictEqual(
					yield* reasonOf(JwtKey.fromJwk({ ...firstActionsKey, key_ops: keyOps })),
					"key",
					JSON.stringify(keyOps),
				);
			}
			const key = yield* JwtKey.fromJwk({ ...firstActionsKey, key_ops: ["sign", "verify"] });
			assert.strictEqual(key.alg, "RS256");
		}),
	);

	it.effect("rejects an RSA JWK with no modulus as key", () =>
		Effect.gen(function* () {
			const { n: _n, ...noModulus } = rsa;
			assert.strictEqual(yield* reasonOf(JwtKey.fromJwk(noModulus, { alg: "RS256" })), "key");
		}),
	);

	it.effect("imports only the public half of a private JWK", () =>
		Effect.gen(function* () {
			const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
			const exported = privateKey.export({ format: "jwk" });
			const jwk = Schema.decodeUnknownSync(Jwk)({ ...exported, alg: "RS256" });
			assert.isTrue(jwk.d !== undefined && Redacted.isRedacted(jwk.d));
			const key = yield* JwtKey.fromJwk(jwk);
			assert.strictEqual(key.key.type, "public");
			assert.deepStrictEqual(key.key.usages, ["verify"]);
		}),
	);
});

describe("JwtKey.generate", () => {
	it.effect("produces an ES256 pair whose jwk is a public P-256 key", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("ES256", { kid: "test" });
			assert.strictEqual(pair.jwk.crv, "P-256");
			assert.strictEqual(pair.jwk.kty, "EC");
			assert.strictEqual(pair.jwk.alg, "ES256");
			assert.strictEqual(pair.jwk.kid, "test");
			assert.isUndefined(pair.jwk.d);
			assert.strictEqual(pair.signing.alg, "ES256");
			assert.strictEqual(pair.verification.kid, "test");
			assert.isFalse(pair.signing.key.extractable);
			assert.isTrue(pair.verification.key.extractable);
		}),
	);

	it.effect("produces an RS256 pair whose jwk re-imports and verifies the signing key's signatures", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("RS256");
			assert.strictEqual(pair.jwk.kty, "RSA");
			assert.isUndefined(pair.jwk.kid);
			const signature = new Uint8Array(
				yield* Effect.promise(() => globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.signing.key, data)),
			);
			const reimported = yield* JwtKey.fromJwk(pair.jwk);
			assert.isTrue(
				yield* Effect.promise(() =>
					globalThis.crypto.subtle.verify("RSASSA-PKCS1-v1_5", reimported.key, signature, data),
				),
			);
			const spki = createPublicKey({ key: pair.jwk as never, format: "jwk" });
			assert.isTrue(verify("sha256", data, spki, signature));
		}),
	);
});

describe("JwtAlgorithm", () => {
	it("is the same union as the internal Algorithm (a type-level check; types:check fails on drift)", () => {
		const same: [Algorithm] extends [JwtAlgorithm] ? ([JwtAlgorithm] extends [Algorithm] ? true : never) : never = true;
		assert.isTrue(same);
	});
});
