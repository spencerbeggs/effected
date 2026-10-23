import { createHmac } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { HmacHeaderOptions } from "../src/HmacHeader.js";
import { HmacHeader } from "../src/HmacHeader.js";
import { LINEAR_SECRET, NOON } from "./fixtures/generate-vectors.js";
import { bytes, hmac, request } from "./helpers.js";

const BODY = '{"type":"Issue","action":"update","webhookTimestamp":1792411200000}';
const linear: HmacHeaderOptions = { header: "linear-signature", encoding: "hex" };
const good = hmac(LINEAR_SECRET, [BODY], "hex");

const verify = (head: Record<string, string>, options: HmacHeaderOptions = linear, body: string = BODY) =>
	HmacHeader.verify(request(head, bytes(body), LINEAR_SECRET, NOON), options);
const reason = (head: Record<string, string>, options?: HmacHeaderOptions, body?: string) =>
	Effect.flip(verify(head, options, body)).pipe(Effect.map((error) => error.reason));

describe("HmacHeader.verify", () => {
	it.effect("verifies Linear's bare hex, in either case and with surrounding whitespace", () =>
		Effect.gen(function* () {
			yield* verify({ "linear-signature": good });
			yield* verify({ "linear-signature": ` ${good.toUpperCase()} ` });
		}),
	);

	it.effect("verifies base64 behind a prefix, and SHA-512", () =>
		Effect.gen(function* () {
			const base64 = hmac(LINEAR_SECRET, [BODY], "base64");
			yield* verify({ "x-sig": `sig=${base64}` }, { header: "x-sig", encoding: "base64", prefix: "sig=" });
			const sha512 = createHmac("sha512", LINEAR_SECRET).update(BODY).digest("hex");
			yield* verify({ "x-sig": sha512 }, { header: "x-sig", encoding: "hex", algorithm: "SHA-512" });
		}),
	);

	it.effect("accepts a non-canonical base64 spelling of the right MAC, since the signature is compared as bytes", () =>
		Effect.gen(function* () {
			// A SHA-256 MAC is 32 bytes, so its base64 ends in one "=" and the
			// character before it carries two unused bits. Setting one spells the
			// same bytes differently: a string compare refused it, a byte compare
			// accepts it.
			const base64 = hmac(LINEAR_SECRET, [BODY], "base64");
			const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
			const last = base64.length - 2;
			const variant = `${base64.slice(0, last)}${ALPHABET[ALPHABET.indexOf(base64[last] ?? "") ^ 1]}=`;
			assert.notStrictEqual(variant, base64, "the fixture must differ from the canonical spelling");
			yield* verify({ "x-sig": `sig=${variant}` }, { header: "x-sig", encoding: "base64", prefix: "sig=" });
		}),
	);

	describe("every part wrong in exactly one way is bad_signature", () => {
		const prefixed: HmacHeaderOptions = { header: "x-sig", encoding: "base64", prefix: "sig=" };
		const base64 = hmac(LINEAR_SECRET, [BODY], "base64");
		const cases: ReadonlyArray<readonly [string, Record<string, string>, HmacHeaderOptions]> = [
			["the body, by one byte", { "linear-signature": hmac(LINEAR_SECRET, [`${BODY} `], "hex") }, linear],
			["the key", { "linear-signature": hmac("nope", [BODY], "hex") }, linear],
			["the encoding: base64 where hex is configured", { "linear-signature": base64 }, linear],
			[
				"the algorithm: SHA-256 where SHA-512 is configured",
				{ "linear-signature": good },
				{ ...linear, algorithm: "SHA-512" },
			],
			["the prefix: missing", { "x-sig": base64 }, prefixed],
			["the prefix: wrong", { "x-sig": `sha=${base64}` }, prefixed],
			["the base64: not base64 at all", { "x-sig": "sig=%%%not-base64%%%" }, prefixed],
			// Core's base64 decoder requires padding, so an unpadded spelling does
			// not decode and is refused like any other undecodable signature.
			["the base64: unpadded", { "x-sig": `sig=${base64.replace(/=+$/, "")}` }, prefixed],
			["the hex: not hex at all", { "linear-signature": "zz".repeat(32) }, linear],
		];
		for (const [part, head, options] of cases) {
			it.effect(part, () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* reason(head, options), "bad_signature");
				}),
			);
		}
	});

	it.effect("answers missing_signature without the named header", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* reason({}), "missing_signature");
			assert.strictEqual(yield* reason({ "linear-signature": "   " }), "missing_signature");
			const error = yield* Effect.flip(verify({}));
			assert.strictEqual(error.preset, "HmacHeader");
		}),
	);
});
