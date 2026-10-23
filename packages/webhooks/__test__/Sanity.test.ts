import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import { Sanity } from "../src/Sanity.js";
import { NOON, SANITY_SECRET } from "./fixtures/generate-vectors.js";
import { bytes, hmac, request } from "./helpers.js";

const BODY = '{"_id":"post-1","_type":"post"}';

const sig = (parts: ReadonlyArray<string | Uint8Array>, key: string = SANITY_SECRET) => hmac(key, parts, "base64url");
const good = (t: number = NOON) => sig([`${t}.`, BODY]);
const header = (value: string) => ({ "sanity-webhook-signature": value });

const verify = (head: Record<string, string>, body: string = BODY, receivedAt = NOON) =>
	Sanity.verify(request(head, bytes(body), SANITY_SECRET, receivedAt));
const reason = (head: Record<string, string>, body?: string, receivedAt?: number) =>
	Effect.flip(verify(head, body, receivedAt)).pipe(Effect.map((error) => error.reason));

describe("Sanity.verify", () => {
	it.effect("returns the signed timestamp, read as milliseconds", () =>
		Effect.gen(function* () {
			const verified = yield* verify(header(`t=${NOON},v1=${good()}`));
			assert.strictEqual(DateTime.toEpochMillis(verified.timestamp), NOON);
		}),
	);

	it.effect("accepts a comma, a space or both between t and v1", () =>
		Effect.gen(function* () {
			for (const gap of [",", " ", ", "]) yield* verify(header(`t=${NOON}${gap}v1=${good()}`));
		}),
	);

	describe("every part of the signed content wrong in exactly one way is bad_signature", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["the timestamp, by one millisecond", sig([`${NOON + 1}.`, BODY])],
			["the timestamp, in seconds instead of milliseconds", sig([`${NOON / 1000}.`, BODY])],
			["the body, by one byte", sig([`${NOON}.`, BODY.replace("post-1", "post-2")])],
			["the separator", sig([`${NOON}`, BODY])],
			["the key", sig([`${NOON}.`, BODY], "not-the-secret")],
			["the encoding: padded base64url", `${good()}=`],
			["the encoding: standard base64", hmac(SANITY_SECRET, [`${NOON}.`, BODY], "base64")],
		];
		for (const [part, signature] of cases) {
			it.effect(part, () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* reason(header(`t=${NOON},v1=${signature}`)), "bad_signature");
				}),
			);
		}
		it.effect("control: the unmutated signature verifies", () =>
			Effect.gen(function* () {
				yield* verify(header(`t=${NOON},v1=${good()}`));
			}),
		);
	});

	it.effect("answers missing_signature without the header and bad_signature for any other grammar", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* reason({}), "missing_signature");
			assert.strictEqual(yield* reason(header("")), "missing_signature");
			for (const value of [
				`v1=${good()}`,
				`t=${NOON}`,
				`t=${NOON},v1=${good()},v1=${good()}`,
				`v1=${good()},t=${NOON}`,
				`t=soon,v1=${good()}`,
			]) {
				assert.strictEqual(yield* reason(header(value)), "bad_signature", value);
			}
		}),
	);

	it.effect("is stale beyond five minutes either side, checks the signature first, and survives an absurd t", () =>
		Effect.gen(function* () {
			for (const t of [NOON - 300_001, NOON + 300_001]) {
				assert.strictEqual(yield* reason(header(`t=${t},v1=${good(t)}`)), "stale_timestamp", String(t));
			}
			for (const t of [NOON - 300_000, NOON + 300_000]) yield* verify(header(`t=${t},v1=${good(t)}`));
			const t = NOON - 3_600_000;
			assert.strictEqual(yield* reason(header(`t=${t},v1=${sig([`${t}.`, BODY], "nope")}`)), "bad_signature");
			const absurd = "9".repeat(40);
			assert.strictEqual(yield* reason(header(`t=${absurd},v1=${sig([`${absurd}.`, BODY])}`)), "stale_timestamp");
		}),
	);
});
