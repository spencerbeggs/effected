import { assert, describe, it } from "@effect/vitest";
import { Cause, DateTime, Duration, Effect, Exit } from "effect";
import { Webhook } from "svix";
import { StandardWebhooks } from "../src/StandardWebhooks.js";
import { NOON, SVIX_SECRET } from "./fixtures/generate-vectors.js";
import { bytes, hmac, request } from "./helpers.js";

const KEY = Buffer.from(SVIX_SECRET.slice("whsec_".length), "base64");
const T = NOON / 1000;
const ID = "msg_2abcDEF345ghiJKL678mnoPQR";
const BODY = '{"type":"user.created","object":"event","data":{"id":"user_1"}}';

/** A v1 signature over exactly these signed-content parts, under `key`. */
const v1 = (parts: ReadonlyArray<string | Uint8Array>, key: Uint8Array = KEY) => `v1,${hmac(key, parts, "base64")}`;
const headers = (
	signature: string,
	options: { id?: string; t?: number | string; prefix?: "svix" | "webhook" } = {},
) => {
	const prefix = options.prefix ?? "svix";
	return {
		[`${prefix}-id`]: options.id ?? ID,
		[`${prefix}-timestamp`]: String(options.t ?? T),
		[`${prefix}-signature`]: signature,
	};
};
const good = (t: number = T) => v1([`${ID}.${t}.`, BODY], KEY);

const verify = (
	head: Record<string, string>,
	body: string | Uint8Array = BODY,
	receivedAt = NOON,
	secret = SVIX_SECRET,
) => StandardWebhooks.verify(request(head, typeof body === "string" ? bytes(body) : body, secret, receivedAt));
const reason = (head: Record<string, string>, body?: string | Uint8Array, receivedAt?: number) =>
	Effect.flip(verify(head, body, receivedAt)).pipe(Effect.map((error) => error.reason));

describe("StandardWebhooks.verify", () => {
	it.effect("returns the message id and the signed timestamp", () =>
		Effect.gen(function* () {
			const verified = yield* verify(headers(good()));
			assert.strictEqual(verified.id, ID);
			assert.strictEqual(DateTime.toEpochMillis(verified.timestamp), NOON);
		}),
	);

	it.effect("accepts what svix's own Webhook.sign produces, and a secret without the whsec_ prefix", () =>
		Effect.gen(function* () {
			const signed = new Webhook(SVIX_SECRET).sign(ID, new Date(NOON), BODY);
			assert.strictEqual((yield* verify(headers(signed))).id, ID);
			const bare = KEY.toString("base64");
			const bareSigned = new Webhook(bare).sign(ID, new Date(NOON), BODY);
			assert.strictEqual((yield* verify(headers(bareSigned), BODY, NOON, bare)).id, ID);
		}),
	);

	it("signs headers svix's own Webhook.verify accepts, so the oracle here agrees with svix", () => {
		// Webhook.verify judges the timestamp against the wall clock, so this direction signs at now.
		const now = Math.floor(Date.now() / 1000);
		const webhook = new Webhook(SVIX_SECRET);
		assert.doesNotThrow(() => webhook.verify(BODY, headers(good(now), { t: now })));
		assert.throws(() => webhook.verify(`${BODY} `, headers(good(now), { t: now })));
	});

	describe("every part of the signed content wrong in exactly one way is bad_signature", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["the id", v1([`msg_other.${T}.`, BODY])],
			["the timestamp, by one second", v1([`${ID}.${T + 1}.`, BODY])],
			["the body, by one byte", v1([`${ID}.${T}.`, BODY.replace("user_1", "user_2")])],
			["the first separator", v1([`${ID}${T}.`, BODY])],
			["the second separator", v1([`${ID}.${T}`, BODY])],
			["the order of id and timestamp", v1([`${T}.${ID}.`, BODY])],
			["the key: the secret string instead of its decoded bytes", v1([`${ID}.${T}.`, BODY], bytes(SVIX_SECRET))],
			["the key: a different key", v1([`${ID}.${T}.`, BODY], bytes("not-the-key"))],
			["the encoding: base64url instead of base64", `v1,${hmac(KEY, [`${ID}.${T}.`, BODY], "base64url")}`],
			["the version: v1a instead of v1", good().replace(/^v1,/, "v1a,")],
		];
		for (const [part, signature] of cases) {
			it.effect(part, () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* reason(headers(signature)), "bad_signature");
				}),
			);
		}
		it.effect("control: the unmutated signature verifies", () =>
			Effect.gen(function* () {
				assert.strictEqual((yield* verify(headers(good()))).id, ID);
			}),
		);
	});

	it.effect("accepts any v1 in a rotation list and ignores other versions and malformed entries", () =>
		Effect.gen(function* () {
			const old = v1([`${ID}.${T}.`, BODY], bytes("rotated-out"));
			assert.strictEqual((yield* verify(headers(`${old} v1a,abcd nocomma ${good()}`))).id, ID);
			assert.strictEqual(yield* reason(headers(`${old} v2,abcd`)), "bad_signature");
			for (const header of ["garbage", "v1", "v2,abc", good().replace(",", "=")]) {
				assert.strictEqual(yield* reason(headers(header)), "bad_signature", header);
			}
		}),
	);

	it.effect("reads each header under svix- first and falls back to webhook- per header", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* verify(headers(good(), { prefix: "webhook" }))).id, ID);
			const both = {
				...headers(v1([`msg_unbranded.${T}.`, BODY]), { prefix: "webhook", id: "msg_unbranded" }),
				...headers(good()),
			};
			assert.strictEqual((yield* verify(both)).id, ID);
			// Mixed: the id from svix-, the timestamp and signature from webhook-.
			const mixed = { "svix-id": ID, "webhook-timestamp": String(T), "webhook-signature": good() };
			assert.strictEqual((yield* verify(mixed)).id, ID);
			// An empty svix- value is absent, so the webhook- value is read.
			assert.strictEqual((yield* verify({ ...headers(good(), { prefix: "webhook" }), "svix-signature": "" })).id, ID);
		}),
	);

	it.effect("answers missing_signature without a signature, malformed without an id or a Unix-seconds timestamp", () =>
		Effect.gen(function* () {
			const { "svix-signature": _s, ...noSignature } = headers(good());
			assert.strictEqual(yield* reason(noSignature), "missing_signature");
			assert.strictEqual(yield* reason({ ...headers(good()), "svix-signature": "" }), "missing_signature");
			const { "svix-id": _i, ...noId } = headers(good());
			assert.strictEqual(yield* reason(noId), "malformed");
			const { "svix-timestamp": _t, ...noTimestamp } = headers(good());
			assert.strictEqual(yield* reason(noTimestamp), "malformed");
			for (const t of ["soon", "-1", "1.5", "1".repeat(16)]) {
				assert.strictEqual(yield* reason(headers(good(), { t })), "malformed", t);
			}
		}),
	);

	it.effect("signs over the timestamp as an integer, so a zero-padded header still verifies", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* verify(headers(good(), { t: `0${T}` }))).id, ID);
		}),
	);

	it.effect("is stale six minutes either side, fresh at exactly five, and honours a custom tolerance", () =>
		Effect.gen(function* () {
			for (const t of [T - 6 * 60, T + 6 * 60, T - 5 * 60 - 1]) {
				assert.strictEqual(yield* reason(headers(good(t), { t })), "stale_timestamp", String(t));
			}
			for (const t of [T - 5 * 60, T + 5 * 60]) {
				assert.strictEqual((yield* verify(headers(good(t), { t }))).id, ID);
			}
			const t = T - 6 * 60;
			const wide = yield* StandardWebhooks.verify(request(headers(good(t), { t }), bytes(BODY), SVIX_SECRET, NOON), {
				tolerance: Duration.minutes(10),
			});
			assert.strictEqual(wide.id, ID);
		}),
	);

	it.effect("checks the signature before the timestamp: a stale forgery is bad_signature", () =>
		Effect.gen(function* () {
			const t = T - 60 * 60;
			assert.strictEqual(yield* reason(headers(v1([`${ID}.${t}.`, BODY], bytes("nope")), { t })), "bad_signature");
			assert.strictEqual(yield* reason(headers(good(t), { t })), "stale_timestamp");
		}),
	);

	it.effect("judges staleness against receivedAt, so a month-old delivery reprocessed later still verifies", () =>
		Effect.gen(function* () {
			const old = T - 30 * 24 * 60 * 60;
			assert.strictEqual((yield* verify(headers(good(old), { t: old }), BODY, old * 1000)).id, ID);
		}),
	);

	it.effect("signs over the raw bytes, not their UTF-8 decoding", () =>
		Effect.gen(function* () {
			const raw = new Uint8Array([...bytes('{"id":"caf'), 0xe9, ...bytes('"}')]);
			const signature = v1([`${ID}.${T}.`, raw]);
			assert.strictEqual((yield* verify(headers(signature), raw)).id, ID);
			assert.strictEqual(yield* reason(headers(signature), bytes(new TextDecoder().decode(raw))), "bad_signature");
		}),
	);

	it.effect("dies, as a wiring defect that never echoes the secret, when the secret is not strict base64", () =>
		Effect.gen(function* () {
			for (const secret of ["whsec_", "whsec_not base64!", "whsec_abc", "whsec_====", "plain-text-secret"]) {
				const exit = yield* Effect.exit(verify(headers(good()), BODY, NOON, secret));
				assert.isTrue(Exit.isFailure(exit), secret);
				if (Exit.isFailure(exit)) {
					assert.isTrue(Cause.hasDies(exit.cause), secret);
					assert.isFalse(Cause.hasFails(exit.cause), secret);
					assert.notInclude(Cause.pretty(exit.cause), secret.slice("whsec_".length) || "\u0000", secret);
				}
			}
		}),
	);

	it.effect("carries the preset on the error", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(verify({}));
			assert.strictEqual(error._tag, "WebhookVerificationError");
			assert.strictEqual(error.preset, "StandardWebhooks");
		}),
	);
});
