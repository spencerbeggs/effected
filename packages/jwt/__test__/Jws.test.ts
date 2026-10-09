import { createHmac, createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";
import { Jwk } from "../src/Jwk.js";
import { Jws } from "../src/Jws.js";
import { JwtError } from "../src/JwtError.js";
import { JwtKey } from "../src/JwtKey.js";

const segment = (value: unknown): string => Base64Url.encode(JSON.stringify(value));

const parts = (token: string): [string, string, string] => {
	const [h = "", p = "", s = ""] = token.split(".");
	return [h, p, s];
};

const reasonOf = <A, R>(effect: Effect.Effect<A, { readonly reason: string }, R>) =>
	Effect.map(Effect.flip(effect), (error) => error.reason);

describe("Jws round trips", () => {
	for (const alg of ["RS256", "ES256"] as const) {
		it.effect(`signs and verifies ${alg}`, () =>
			Effect.gen(function* () {
				const pair = yield* JwtKey.generate(alg, { kid: "k1" });
				const token = yield* Jws.sign({ sub: "octocat", n: 1 }, pair.signing);
				const verified = yield* Jws.verify(token, pair.verification);
				assert.deepStrictEqual(verified.payload, { sub: "octocat", n: 1 });
				assert.strictEqual(verified.header.alg, alg);
				assert.strictEqual(verified.header.typ, "JWT");
				assert.strictEqual(verified.header.kid, "k1");
			}),
		);
	}

	it.effect("verifies through a key resolver handed the decoded header", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("ES256", { kid: "rotating" });
			const token = yield* Jws.sign({ sub: "x" }, pair.signing);
			const seen: Array<string | undefined> = [];
			const verified = yield* Jws.verify(token, (header) => {
				seen.push(header.kid);
				return Effect.succeed(pair.verification);
			});
			assert.deepStrictEqual(seen, ["rotating"]);
			assert.deepStrictEqual(verified.payload, { sub: "x" });
		}),
	);
});

describe("Jws node:crypto interop", () => {
	it.effect("ES256 signatures are raw r||s: node verifies ours, and we verify node's", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("ES256");
			const token = yield* Jws.sign({ sub: "x" }, pair.signing);
			const [h, p, s] = parts(token);
			const signature = Result.getOrThrow(Base64Url.decode(s));
			assert.strictEqual(signature.byteLength, 64);
			const nodeKey = createPublicKey({ key: pair.jwk as never, format: "jwk" });
			assert.isTrue(
				nodeVerify("sha256", Buffer.from(`${h}.${p}`), { key: nodeKey, dsaEncoding: "ieee-p1363" }, signature),
			);

			const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
			const input = `${segment({ alg: "ES256", typ: "JWT" })}.${segment({ sub: "node" })}`;
			const nodeSignature = nodeSign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" });
			const verification = yield* JwtKey.fromJwk(Schema.decodeUnknownSync(Jwk)(publicKey.export({ format: "jwk" })), {
				alg: "ES256",
			});
			const verified = yield* Jws.verify(`${input}.${Base64Url.encode(nodeSignature)}`, verification);
			assert.deepStrictEqual(verified.payload, { sub: "node" });
			// control: node's default DER encoding is not a JWS signature
			const der = nodeSign("sha256", Buffer.from(input), privateKey);
			assert.strictEqual(
				yield* reasonOf(Jws.verify(`${input}.${Base64Url.encode(der)}`, verification)),
				"badSignature",
			);
		}),
	);

	it.effect("RS256: node verifies ours, and we verify node's", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("RS256");
			const token = yield* Jws.sign({ sub: "x" }, pair.signing);
			const [h, p, s] = parts(token);
			const nodeKey = createPublicKey({ key: pair.jwk as never, format: "jwk" });
			assert.isTrue(nodeVerify("sha256", Buffer.from(`${h}.${p}`), nodeKey, Result.getOrThrow(Base64Url.decode(s))));

			const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
			const input = `${segment({ alg: "RS256" })}.${segment({ sub: "node" })}`;
			const verification = yield* JwtKey.fromJwk(Schema.decodeUnknownSync(Jwk)(publicKey.export({ format: "jwk" })), {
				alg: "RS256",
			});
			const signature = nodeSign("sha256", Buffer.from(input), privateKey);
			const verified = yield* Jws.verify(`${input}.${Base64Url.encode(signature)}`, verification);
			assert.deepStrictEqual(verified.payload, { sub: "node" });
		}),
	);
});

describe("Jws.verify refusals", () => {
	it.effect("a flipped signature byte is badSignature", () =>
		Effect.gen(function* () {
			for (const alg of ["RS256", "ES256"] as const) {
				const pair = yield* JwtKey.generate(alg);
				const [h, p, s] = parts(yield* Jws.sign({ sub: "x" }, pair.signing));
				const signature = Result.getOrThrow(Base64Url.decode(s));
				signature[10] = (signature[10] ?? 0) ^ 0x01;
				const tampered = `${h}.${p}.${Base64Url.encode(signature)}`;
				assert.strictEqual(yield* reasonOf(Jws.verify(tampered, pair.verification)), "badSignature", alg);
			}
		}),
	);

	it.effect("a swapped payload segment is badSignature", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("RS256");
			const [h, , s] = parts(yield* Jws.sign({ sub: "alice" }, pair.signing));
			const swapped = `${h}.${segment({ sub: "mallory" })}.${s}`;
			assert.strictEqual(yield* reasonOf(Jws.verify(swapped, pair.verification)), "badSignature");
		}),
	);

	it.effect(
		"Review Focus 1: an HS256 token keyed with the RSA public key is unsupportedAlgorithm, no key resolved",
		() =>
			Effect.gen(function* () {
				const pair = yield* JwtKey.generate("RS256");
				const spki = new Uint8Array(
					yield* Effect.promise(() => globalThis.crypto.subtle.exportKey("spki", pair.verification.key)),
				);
				const pem = createPublicKey({ key: Buffer.from(spki), format: "der", type: "spki" })
					.export({ format: "pem", type: "spki" })
					.toString();
				const input = `${segment({ alg: "HS256", typ: "JWT" })}.${segment({ sub: "admin" })}`;
				let resolutions = 0;
				const resolver = () => {
					resolutions += 1;
					return Effect.succeed(pair.verification);
				};
				for (const secret of [Buffer.from(spki), Buffer.from(pem)]) {
					const mac = createHmac("sha256", secret).update(input).digest();
					const token = `${input}.${Base64Url.encode(mac)}`;
					assert.strictEqual(yield* reasonOf(Jws.verify(token, pair.verification)), "unsupportedAlgorithm");
					assert.strictEqual(yield* reasonOf(Jws.verify(token, resolver)), "unsupportedAlgorithm");
				}
				assert.strictEqual(resolutions, 0, "the key resolver must never be called for an unsupported alg");
			}),
	);

	it.effect("any header alg outside RS256 and ES256 is unsupportedAlgorithm without resolving a key", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("RS256");
			let resolutions = 0;
			const resolver = () => {
				resolutions += 1;
				return Effect.succeed(pair.verification);
			};
			for (const alg of ["none", "HS256", "RS384", "PS256", "EdDSA", "rs256", ""]) {
				const token = `${segment({ alg })}.${segment({ sub: "x" })}.AA`;
				assert.strictEqual(yield* reasonOf(Jws.verify(token, resolver)), "unsupportedAlgorithm", alg);
			}
			assert.strictEqual(resolutions, 0);
		}),
	);

	it.effect("alg none with an empty-but-present signature is unsupportedAlgorithm", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("RS256");
			const input = `${segment({ alg: "none" })}.${segment({ sub: "admin" })}`;
			// the codec refuses an empty segment before any header is read
			assert.strictEqual(yield* reasonOf(Jws.verify(`${input}.`, pair.verification)), "malformed");
			// with a present, well-formed signature segment the header is reached and none is refused
			let resolved = false;
			const reason = yield* reasonOf(
				Jws.verify(`${input}.AA`, () => {
					resolved = true;
					return Effect.succeed(pair.verification);
				}),
			);
			assert.strictEqual(reason, "unsupportedAlgorithm");
			assert.isFalse(resolved, "the key must not be resolved for alg none");
		}),
	);

	it.effect("a header alg of RS256 against an ES256 key is algorithmMismatch", () =>
		Effect.gen(function* () {
			const rsa = yield* JwtKey.generate("RS256");
			const ec = yield* JwtKey.generate("ES256");
			const token = yield* Jws.sign({ sub: "x" }, rsa.signing);
			const error = yield* Effect.flip(Jws.verify(token, ec.verification));
			assert.strictEqual(error.reason, "algorithmMismatch");
		}),
	);

	it.effect("a header that is not a JSON object, or lacks a string alg, is malformed", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("RS256");
			const payload = segment({ sub: "x" });
			const headers: ReadonlyArray<unknown> = [
				null,
				["RS256"],
				"RS256",
				42,
				{},
				{ alg: 256 },
				{ alg: null },
				JSON.parse('{"__proto__":{"alg":"RS256"}}'),
			];
			for (const header of headers) {
				const token = `${segment(header)}.${payload}.AA`;
				assert.strictEqual(yield* reasonOf(Jws.verify(token, pair.verification)), "malformed", JSON.stringify(header));
			}
		}),
	);

	it.effect("a header carrying crit is malformed", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("RS256");
			const token = `${segment({ alg: "RS256", crit: ["exp"], exp: 1 })}.${segment({ sub: "x" })}.AA`;
			assert.strictEqual(yield* reasonOf(Jws.verify(token, pair.verification)), "malformed");
		}),
	);

	it.effect("a key resolver's failure passes through unchanged", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("RS256", { kid: "a" });
			const token = yield* Jws.sign({ sub: "x" }, pair.signing);
			const error = yield* Effect.flip(
				Jws.verify(token, () => Effect.fail(JwtError.of("unknownKid", "no such key", { kid: "a" }))),
			);
			assert.strictEqual(error.reason, "unknownKid");
			assert.strictEqual(error.kid, "a");
		}),
	);
});

describe("Jws.sign", () => {
	it.effect("emits the key's algorithm whatever alg the caller passes", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("RS256");
			for (const alg of ["none", "HS256", "ES256"]) {
				const token = yield* Jws.sign({ sub: "x" }, pair.signing, { alg, typ: "at+jwt", custom: 1 });
				const decoded = Result.getOrThrow(Jws.decodeUnverified(token));
				assert.strictEqual(decoded.header.alg, "RS256");
				assert.strictEqual(decoded.header.typ, "at+jwt");
				assert.strictEqual(decoded.header.custom, 1);
				yield* Jws.verify(token, pair.verification);
			}
		}),
	);

	it.effect("keeps a caller kid when the key has none, and the key's kid otherwise", () =>
		Effect.gen(function* () {
			const bare = yield* JwtKey.generate("ES256");
			const named = yield* JwtKey.generate("ES256", { kid: "key" });
			const kidOf = (token: string) => Result.getOrThrow(Jws.decodeUnverified(token)).header.kid;
			assert.strictEqual(kidOf(yield* Jws.sign({}, bare.signing, { kid: "caller" })), "caller");
			assert.strictEqual(kidOf(yield* Jws.sign({}, named.signing, { kid: "caller" })), "key");
			assert.isUndefined(kidOf(yield* Jws.sign({}, bare.signing)));
		}),
	);

	it.effect("fails a payload JSON cannot represent as malformed, not a defect", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("ES256");
			assert.strictEqual(yield* reasonOf(Jws.sign({ iat: 1n }, pair.signing)), "malformed");
		}),
	);

	it.effect("refuses to emit a header verify would refuse", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("ES256");
			assert.strictEqual(yield* reasonOf(Jws.sign({}, pair.signing, { crit: ["b64"] })), "malformed");
			assert.strictEqual(yield* reasonOf(Jws.sign({}, pair.signing, { typ: 1 })), "malformed");
		}),
	);
});

describe("Jws.decodeUnverified", () => {
	it.effect("reads header and payload without a key, and refuses what verify's codec refuses", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("RS256", { kid: "route" });
			const token = yield* Jws.sign({ iss: "https://issuer" }, pair.signing);
			const decoded = Result.getOrThrow(Jws.decodeUnverified(token));
			assert.strictEqual(decoded.header.kid, "route");
			assert.deepStrictEqual(decoded.payload, { iss: "https://issuer" });
			const broken = Jws.decodeUnverified(`${segment(null)}.${segment({})}.AA`);
			assert.isTrue(Result.isFailure(broken) && broken.failure.reason === "malformed");
		}),
	);
});

describe("Jws documented edges", () => {
	// P-256 group order.
	const n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
	const toBig = (bytes: Uint8Array): bigint => BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
	const toBytes32 = (value: bigint): Uint8Array =>
		Uint8Array.from(Buffer.from(value.toString(16).padStart(64, "0"), "hex"));

	it.effect("an ES256 signature is malleable: (r, n - s) also verifies, so a token string is not an identifier", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("ES256");
			const token = yield* Jws.sign({ jti: "once" }, pair.signing);
			const [h, p, s] = parts(token);
			const signature = Result.getOrThrow(Base64Url.decode(s));
			const flipped = new Uint8Array(64);
			flipped.set(signature.subarray(0, 32), 0);
			flipped.set(toBytes32(n - toBig(signature.subarray(32))), 32);
			const respelled = `${h}.${p}.${Base64Url.encode(flipped)}`;
			assert.notStrictEqual(respelled, token);
			// Documented and expected (see Jws.verify remarks): both spellings verify.
			assert.deepStrictEqual((yield* Jws.verify(respelled, pair.verification)).payload, { jti: "once" });
			assert.deepStrictEqual((yield* Jws.verify(token, pair.verification)).payload, { jti: "once" });
		}),
	);

	it.effect("accepts a structurally identical key object, as a second package copy would build", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("RS256", { kid: "copy" });
			const token = yield* Jws.sign({ sub: "x" }, pair.signing);
			const foreign = { alg: pair.verification.alg, kid: pair.verification.kid, key: pair.verification.key };
			assert.deepStrictEqual((yield* Jws.verify(token, foreign)).payload, { sub: "x" });
		}),
	);

	it.effect("quotes and caps an attacker-supplied alg in the error detail", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("RS256");
			const alg = `\u001b[31m${"A".repeat(10_000)}\n`;
			const token = `${segment({ alg })}.${segment({ sub: "x" })}.AA`;
			const error = yield* Effect.flip(Jws.verify(token, pair.verification));
			assert.strictEqual(error.reason, "unsupportedAlgorithm");
			assert.isBelow(error.detail.length, 120);
			assert.isBelow(error.message.length, 160);
			assert.notInclude(error.detail, "\u001b");
			assert.notInclude(error.detail, "\n");
		}),
	);
});
