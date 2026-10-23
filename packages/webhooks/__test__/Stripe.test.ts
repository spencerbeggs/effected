import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import StripeSdk from "stripe";
import { Stripe } from "../src/Stripe.js";
import { NOON, STRIPE_SECRET } from "./fixtures/generate-vectors.js";
import { bytes, hmac, request } from "./helpers.js";

const T = NOON / 1000;
const BODY = '{"id":"evt_1","object":"event","type":"charge.refunded","livemode":false}';

const sig = (parts: ReadonlyArray<string | Uint8Array>, key: string | Uint8Array = STRIPE_SECRET) =>
	hmac(key, parts, "hex");
const good = (t: number = T) => sig([`${t}.`, BODY]);
const header = (value: string) => ({ "stripe-signature": value });

const verify = (head: Record<string, string>, body: string = BODY, receivedAt = NOON) =>
	Stripe.verify(request(head, bytes(body), STRIPE_SECRET, receivedAt));
const reason = (head: Record<string, string>, body?: string, receivedAt?: number) =>
	Effect.flip(verify(head, body, receivedAt)).pipe(Effect.map((error) => error.reason));

describe("Stripe.verify", () => {
	it.effect("returns the signed timestamp", () =>
		Effect.gen(function* () {
			const verified = yield* verify(header(`t=${T},v1=${good()}`));
			assert.strictEqual(DateTime.toEpochMillis(verified.timestamp), NOON);
		}),
	);

	it.effect("accepts stripe's own generateTestHeaderString, and stripe's constructEvent accepts the oracle here", () =>
		Effect.gen(function* () {
			const signed = StripeSdk.webhooks.generateTestHeaderString({
				payload: BODY,
				secret: STRIPE_SECRET,
				timestamp: T,
			});
			yield* verify(header(signed));
			const ours = `t=${T},v1=${good()}`;
			assert.strictEqual(
				StripeSdk.webhooks.constructEvent(BODY, ours, STRIPE_SECRET, 300, undefined, NOON).id,
				"evt_1",
			);
			assert.throws(() => StripeSdk.webhooks.constructEvent(`${BODY} `, ours, STRIPE_SECRET, 300, undefined, NOON));
		}),
	);

	describe("every part of the signed content wrong in exactly one way is bad_signature", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["the timestamp, by one second", sig([`${T + 1}.`, BODY])],
			["the body, by one byte", sig([`${T}.`, BODY.replace("evt_1", "evt_2")])],
			["the separator", sig([`${T}`, BODY])],
			[
				"the key: the base64-decoded secret instead of the literal string",
				sig([`${T}.`, BODY], Buffer.from(STRIPE_SECRET.slice(6), "base64")),
			],
			["the key: the secret without its whsec_ prefix", sig([`${T}.`, BODY], STRIPE_SECRET.slice(6))],
			["the encoding: upper-case hex", good().toUpperCase()],
		];
		for (const [part, signature] of cases) {
			it.effect(part, () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* reason(header(`t=${T},v1=${signature}`)), "bad_signature");
				}),
			);
		}
		it.effect("control: the unmutated signature verifies", () =>
			Effect.gen(function* () {
				yield* verify(header(`t=${T},v1=${good()}`));
			}),
		);
	});

	it.effect("takes the last valid t, accepts any v1, and ignores v0 and unknown keys", () =>
		Effect.gen(function* () {
			const old = sig([`${T}.`, BODY], "whsec_rotated_out");
			yield* verify(header(`t=1,t=${T},v1=${old},v1=${good()}`));
			yield* verify(header(` t = ${T} , v0=${good()}, x=1, v1=${good()}`));
			assert.strictEqual(yield* reason(header(`t=${T},v0=${good()}`)), "bad_signature");
			assert.strictEqual(yield* reason(header(`t=${T},t=1,v1=${good()}`)), "bad_signature");
			// An invalid later t does not displace a valid earlier one.
			yield* verify(header(`t=${T},t=soon,v1=${good()}`));
		}),
	);

	it.effect("answers missing_signature without the header and bad_signature without a t or a v1", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* reason({}), "missing_signature");
			assert.strictEqual(yield* reason(header("")), "missing_signature");
			assert.strictEqual(yield* reason(header(`v1=${good()}`)), "bad_signature");
			assert.strictEqual(yield* reason(header(`t=${T}`)), "bad_signature");
			assert.strictEqual(yield* reason(header("garbage")), "bad_signature");
		}),
	);

	it.effect("is stale beyond five minutes either side and checks the signature first", () =>
		Effect.gen(function* () {
			for (const t of [T - 5 * 60 - 1, T + 5 * 60 + 1]) {
				assert.strictEqual(yield* reason(header(`t=${t},v1=${good(t)}`)), "stale_timestamp", String(t));
			}
			for (const t of [T - 5 * 60, T + 5 * 60]) yield* verify(header(`t=${t},v1=${good(t)}`));
			const t = T - 60 * 60;
			assert.strictEqual(yield* reason(header(`t=${t},v1=${sig([`${t}.`, BODY], "nope")}`)), "bad_signature");
		}),
	);
});
