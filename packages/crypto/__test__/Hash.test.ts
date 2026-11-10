import { createHash } from "node:crypto";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, layer } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import { Digest, WebCrypto } from "effect/crypto";
import type { HashAlgorithm, HashMessage } from "../src/Hash.js";
import { Hash } from "../src/Hash.js";

const hexOf = (value: Uint8Array): string => Buffer.from(value).toString("hex");

/** `node:crypto`'s name for each algorithm. */
const nodeNames: Readonly<Record<HashAlgorithm, string>> = {
	MD5: "md5",
	"SHA-1": "sha1",
	"SHA-256": "sha256",
	"SHA-384": "sha384",
	"SHA-512": "sha512",
};

const algorithms = Object.keys(nodeNames) as ReadonlyArray<HashAlgorithm>;

/**
 * The oracle: `createHash(...).update(part)` once per part, strings passed as
 * strings so Node's own UTF-8 encoder (not ours) decides their bytes.
 */
const oracle = (algorithm: HashAlgorithm, message: HashMessage): Buffer => {
	const hash = createHash(nodeNames[algorithm]);
	const parts = typeof message === "string" || message instanceof Uint8Array ? [message] : message;
	for (const part of parts) {
		if (typeof part === "string") hash.update(part, "utf8");
		else hash.update(part);
	}
	return hash.digest();
};

interface Fixture {
	readonly name: string;
	readonly message: HashMessage;
}

const fixtures: ReadonlyArray<Fixture> = [
	{ name: "an ASCII string", message: "abc" },
	{ name: "the empty string", message: "" },
	{ name: "empty bytes", message: new Uint8Array(0) },
	{ name: "an empty part list", message: [] },
	{ name: "a list of empty parts", message: ["", new Uint8Array(0), ""] },
	{ name: "a lone high surrogate", message: "\uD800" },
	{ name: "a lone low surrogate between letters", message: "a\uDC00b" },
	{ name: "a surrogate pair split across two parts", message: ["\uD83D", "\uDE00"] },
	{ name: "a whole surrogate pair in one part", message: ["😀"] },
	{ name: "high and zero bytes", message: new Uint8Array([0xff, 0x00, 0x80, 0x7f]) },
	{
		name: "mixed strings and bytes",
		message: ["prefix.", new Uint8Array([1, 2, 3]), "ключ", new Uint8Array(0), "délivery"],
	},
];

/** The WebCrypto layer, as a Worker would run it, and the `node:crypto` family. */
const families: ReadonlyArray<readonly [string, Layer.Layer<Digest.Digest>]> = [
	["Digest.layerWebCrypto", Digest.layerWebCrypto],
	["NodeCrypto.layerDigest", NodeCrypto.layerDigest],
];

for (const [family, live] of families) {
	layer(live)(`Hash.digest on ${family}: byte-identical to node:crypto createHash`, (it) => {
		for (const algorithm of algorithms) {
			for (const fixture of fixtures) {
				it.effect(`${algorithm}: ${fixture.name}, in every encoding`, () =>
					Effect.gen(function* () {
						const expected = oracle(algorithm, fixture.message);
						const options = { algorithm, message: fixture.message } as const;
						const raw = yield* Hash.digest(options);
						assert.instanceOf(raw, Uint8Array);
						assert.strictEqual(hexOf(raw), expected.toString("hex"));
						assert.strictEqual(hexOf(yield* Hash.digest({ ...options, encoding: "bytes" })), expected.toString("hex"));
						assert.strictEqual(yield* Hash.digest({ ...options, encoding: "hex" }), expected.toString("hex"));
						assert.strictEqual(yield* Hash.digest({ ...options, encoding: "base64" }), expected.toString("base64"));
						const base64url = yield* Hash.digest({ ...options, encoding: "base64url" });
						assert.strictEqual(base64url, expected.toString("base64url"));
						assert.notInclude(base64url, "=", "base64url is unpadded");
					}),
				);
			}
		}

		it.effect("encodes a lone surrogate as EF BF BD, as node:crypto does", () =>
			Effect.gen(function* () {
				const replacement = new Uint8Array([0xef, 0xbf, 0xbd]);
				const lone = yield* Hash.digest({ algorithm: "SHA-256", message: "\uD800", encoding: "hex" });
				assert.strictEqual(lone, yield* Hash.digest({ algorithm: "SHA-256", message: replacement, encoding: "hex" }));
				assert.strictEqual(lone, createHash("sha256").update(Buffer.from(replacement)).digest("hex"));
				// A pair split across parts is two lone surrogates, not the joined code point.
				const split = yield* Hash.digest({ algorithm: "SHA-256", message: ["\uD83D", "\uDE00"], encoding: "hex" });
				const joined = yield* Hash.digest({ algorithm: "SHA-256", message: "😀", encoding: "hex" });
				assert.notStrictEqual(split, joined);
				assert.strictEqual(
					split,
					yield* Hash.digest({ algorithm: "SHA-256", message: [replacement, replacement], encoding: "hex" }),
				);
			}),
		);

		it.effect("hashes a part list as the concatenation of its parts", () =>
			Effect.gen(function* () {
				const parts = yield* Hash.digest({ algorithm: "SHA-512", message: ["ab", "c"], encoding: "hex" });
				assert.strictEqual(parts, yield* Hash.digest({ algorithm: "SHA-512", message: "abc", encoding: "hex" }));
				// Order is part of the message.
				assert.notStrictEqual(
					parts,
					yield* Hash.digest({ algorithm: "SHA-512", message: ["c", "ab"], encoding: "hex" }),
				);
			}),
		);
	});
}

// The three archive keys savvy-web/build's intake derives, pinned as the
// literals its own suite carries (cross-checked there against `shasum -a 256`).
const GOLDEN_BODY = new TextEncoder().encode('{"golden":"délivery"}');
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

layer(Digest.layerWebCrypto)("Hash.digest: savvy-web/build intake archive keys", (it) => {
	it.effect("Cloudflare: sha256(body)", () =>
		Effect.gen(function* () {
			const hex = yield* Hash.digest({ algorithm: "SHA-256", message: GOLDEN_BODY, encoding: "hex" });
			assert.strictEqual(`cf_${hex}`, "cf_ce0cdd964631fc049ea69a693847a5e7a9f6802a3696581be7e696663e179255");
		}),
	);

	it.effect("Coolify: sha256(window + '.' + body)", () =>
		Effect.gen(function* () {
			const window = Math.floor(1_760_875_200_000 / DEDUP_WINDOW_MS);
			const hex = yield* Hash.digest({ algorithm: "SHA-256", message: [`${window}.`, GOLDEN_BODY], encoding: "hex" });
			assert.strictEqual(`coolify_${hex}`, "coolify_ff39c0e6c75210596fc95e6bf803dedb2bc92114cc40ef6889891066fbbdd0fc");
		}),
	);

	it.effect("Sanity: sha256(utf8(key)) for an unsafe idempotency key", () =>
		Effect.gen(function* () {
			const ascii = yield* Hash.digest({ algorithm: "SHA-256", message: "has spaces/and#marks", encoding: "hex" });
			assert.strictEqual(`sanity_${ascii}`, "sanity_f47c71bca90273231f5ca90d08e32972c0c4bf34197e6583f16faf114b61ac11");
			const cyrillic = yield* Hash.digest({ algorithm: "SHA-256", message: "ключ идемпотентности", encoding: "hex" });
			assert.strictEqual(
				`sanity_${cyrillic}`,
				"sanity_202c40196c42447929375588410a2ff1da4ffcdc801dc6d618501f752f4d5808",
			);
		}),
	);
});

/** A `Digest` layer over a `Crypto` object with no `subtle`, as an insecure browser context has. */
// `Layer.fresh`: the suite's memo map may already hold `Digest.layerWebCrypto`
// built over the real `crypto`, and would hand that instance back instead.
const NoSubtle = Layer.fresh(Digest.layerWebCrypto).pipe(
	Layer.provide(WebCrypto.layer({} as typeof globalThis.crypto)),
);

describe("Hash.digest defects", () => {
	layer(Digest.layerWebCrypto)("an algorithm outside HashAlgorithm", (it) => {
		for (const name of ["SHA-224", "constructor", "toString", "sha256"]) {
			it.effect(`dies on ${JSON.stringify(name)}, never reaching Object.prototype`, () =>
				Effect.gen(function* () {
					const exit = yield* Effect.exit(Hash.digest({ algorithm: name as HashAlgorithm, message: "abc" }));
					if (Exit.isFailure(exit)) {
						assert.isTrue(Cause.hasDies(exit.cause));
						assert.isFalse(Cause.hasFails(exit.cause));
						assert.include(Cause.pretty(exit.cause), `unsupported algorithm ${JSON.stringify(name)}`);
					} else {
						assert.fail(`expected a defect for ${name}, but the digest succeeded`);
					}
				}),
			);
		}
	});

	layer(NoSubtle)("without crypto.subtle", (it) => {
		it.effect("a SHA digest dies rather than failing", () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(Hash.digest({ algorithm: "SHA-256", message: "abc" }));
				if (Exit.isFailure(exit)) {
					assert.isTrue(Cause.hasDies(exit.cause));
					assert.isFalse(Cause.hasFails(exit.cause));
				} else {
					assert.fail("expected a defect, but the digest succeeded");
				}
			}),
		);

		it.effect("MD5 keeps working on its pure implementation", () =>
			Effect.gen(function* () {
				assert.strictEqual(
					yield* Hash.digest({ algorithm: "MD5", message: "abc", encoding: "hex" }),
					createHash("md5").update("abc").digest("hex"),
				);
			}),
		);
	});
});
