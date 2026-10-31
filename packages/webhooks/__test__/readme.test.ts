// The README's examples, compiled and run, so the published page cannot drift from the API.
import { createHmac } from "node:crypto";
import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { DateTime, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { Mac, SecureRandom } from "effect/crypto";
import { TestClock } from "effect/testing";
import type {
	SanityVerified,
	StandardWebhooksVerified,
	StripeVerified,
	WebhookRequest,
	WebhookVerificationError,
} from "../src/index.js";
import { GitHub, HmacHeader, Sanity, SharedSecret, StandardWebhooks, Stripe, Webhooks } from "../src/index.js";
import { bytes, hmac } from "./helpers.js";

// README: What to provide
export const MacLive: Layer.Layer<Mac.Mac> = Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));

// README: What to provide (Node)
export const NodeMacLive: Layer.Layer<Mac.Mac> = NodeCrypto.layerMac;

// README: Build a WebhookRequest
export const fromRequest = (request: Request, secret: Redacted.Redacted<string>): Effect.Effect<WebhookRequest> =>
	Effect.gen(function* () {
		const body = new Uint8Array(yield* Effect.promise(() => request.arrayBuffer()));
		const receivedAt = yield* DateTime.now;
		const delivery: WebhookRequest = {
			header: (name) => Option.fromNullishOr(request.headers.get(name)),
			body,
			receivedAt,
			secret,
		};
		return delivery;
	});

// README: GitHub
export const verifyGitHub = (delivery: WebhookRequest): Effect.Effect<void, WebhookVerificationError, Mac.Mac> =>
	GitHub.verify(delivery);

// README: Stripe
export const verifyStripe = (
	delivery: WebhookRequest,
): Effect.Effect<StripeVerified, WebhookVerificationError, Mac.Mac> =>
	Stripe.verify(delivery, { tolerance: "10 minutes" });

// README: Standard Webhooks
export const verifySvix = (
	delivery: WebhookRequest,
): Effect.Effect<StandardWebhooksVerified, WebhookVerificationError, Mac.Mac> => StandardWebhooks.verify(delivery);

// README: Sanity
export const verifySanity = (
	delivery: WebhookRequest,
): Effect.Effect<SanityVerified, WebhookVerificationError, Mac.Mac> => Sanity.verify(delivery);

// README: Linear
const LinearPayload = Schema.Struct({ action: Schema.String, webhookTimestamp: Schema.Number });

export const verifyLinear = (
	delivery: WebhookRequest,
): Effect.Effect<typeof LinearPayload.Type, WebhookVerificationError | Schema.SchemaError, Mac.Mac> =>
	Effect.gen(function* () {
		yield* HmacHeader.verify(delivery, { header: "linear-signature", encoding: "hex" });
		const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(LinearPayload))(
			new TextDecoder().decode(delivery.body),
		);
		yield* Webhooks.checkFreshness(payload.webhookTimestamp, delivery.receivedAt, Webhooks.DEFAULT_TOLERANCE);
		return payload;
	});

// README: A custom HMAC header
export const verifyCustom = (delivery: WebhookRequest): Effect.Effect<void, WebhookVerificationError, Mac.Mac> =>
	HmacHeader.verify(delivery, { header: "x-signature", encoding: "base64", algorithm: "SHA-512", prefix: "sha512=" });

// README: A shared secret
export const verifyCloudflare = (delivery: WebhookRequest): Effect.Effect<void, WebhookVerificationError, Mac.Mac> =>
	SharedSecret.verify(delivery, { header: "cf-webhook-auth" });

// README: Errors
export const statusFor = (error: WebhookVerificationError): 400 | 401 =>
	error.reason === "missing_signature" || error.reason === "bad_signature" ? 401 : 400;

/** 2026-10-19T12:00:00Z. */
const NOW = Date.parse("2026-10-19T12:00:00Z");

/** A delivery as it arrives, received now on the test clock. */
const deliver = (headers: Record<string, string>, body: string, secret: string) =>
	Effect.gen(function* () {
		yield* TestClock.setTime(NOW);
		return yield* fromRequest(
			new Request("https://hooks.test/in", { method: "POST", headers, body }),
			Redacted.make(secret),
		);
	});

const reasonOf = <A, R>(effect: Effect.Effect<A, WebhookVerificationError, R>) =>
	Effect.flip(effect).pipe(Effect.map((error) => error.reason));

describe("README examples", () => {
	for (const [name, live] of [
		["WebCrypto", MacLive],
		["NodeCrypto", NodeMacLive],
	] as const) {
		layer(live)(`on ${name}`, (it) => {
			it.effect("verifies a GitHub delivery", () =>
				Effect.gen(function* () {
					const body = '{"action":"opened"}';
					const signature = `sha256=${hmac("gh-secret", [body], "hex")}`;
					yield* verifyGitHub(yield* deliver({ "X-Hub-Signature-256": signature }, body, "gh-secret"));
					const tampered = yield* deliver({ "x-hub-signature-256": signature }, `${body} `, "gh-secret");
					assert.strictEqual(yield* reasonOf(verifyGitHub(tampered)), "bad_signature");
				}),
			);

			it.effect("verifies a Stripe delivery inside a ten-minute tolerance", () =>
				Effect.gen(function* () {
					const body = '{"id":"evt_1"}';
					const secret = "whsec_stripe_test";
					const signed = (t: number) => `t=${t},v1=${hmac(secret, [`${t}.`, body], "hex")}`;
					const nineAgo = NOW / 1000 - 540;
					const { timestamp } = yield* verifyStripe(
						yield* deliver({ "stripe-signature": signed(nineAgo) }, body, secret),
					);
					assert.strictEqual(DateTime.toEpochMillis(timestamp), nineAgo * 1000);
					const elevenAgo = yield* deliver({ "stripe-signature": signed(NOW / 1000 - 660) }, body, secret);
					assert.strictEqual(yield* reasonOf(verifyStripe(elevenAgo)), "stale_timestamp");
				}),
			);

			it.effect("verifies a Standard Webhooks delivery and returns its id", () =>
				Effect.gen(function* () {
					const key = bytes("effected-readme-svix-key");
					const secret = `whsec_${Buffer.from(key).toString("base64")}`;
					const body = '{"type":"user.created"}';
					const t = String(NOW / 1000);
					const signature = `v1,${hmac(key, [`msg_1.${t}.`, body], "base64")}`;
					const verified = yield* verifySvix(
						yield* deliver({ "svix-id": "msg_1", "svix-timestamp": t, "svix-signature": signature }, body, secret),
					);
					assert.strictEqual(verified.id, "msg_1");
					const noId = yield* deliver({ "svix-timestamp": t, "svix-signature": signature }, body, secret);
					assert.strictEqual(yield* reasonOf(verifySvix(noId)), "malformed");
				}),
			);

			it.effect("verifies a Sanity delivery", () =>
				Effect.gen(function* () {
					const body = '{"_id":"doc"}';
					const t = String(NOW);
					const signature = `t=${t},v1=${hmac("sanity-secret", [`${t}.`, body], "base64url")}`;
					const { timestamp } = yield* verifySanity(
						yield* deliver({ "sanity-webhook-signature": signature }, body, "sanity-secret"),
					);
					assert.strictEqual(DateTime.toEpochMillis(timestamp), NOW);
				}),
			);

			it.effect("verifies a Linear delivery, then its body timestamp", () =>
				Effect.gen(function* () {
					const sign = (body: string) => ({ "linear-signature": hmac("linear-secret", [body], "hex") });
					const fresh = JSON.stringify({ action: "create", webhookTimestamp: NOW - 1000 });
					const payload = yield* verifyLinear(yield* deliver(sign(fresh), fresh, "linear-secret"));
					assert.strictEqual(payload.action, "create");
					const stale = JSON.stringify({ action: "create", webhookTimestamp: NOW - 600_000 });
					const error = yield* Effect.flip(verifyLinear(yield* deliver(sign(stale), stale, "linear-secret")));
					assert.isTrue(error._tag === "WebhookVerificationError" && error.reason === "stale_timestamp");
				}),
			);

			it.effect("verifies a custom prefixed SHA-512 base64 header", () =>
				Effect.gen(function* () {
					const body = "payload";
					// node:crypto's SHA-512, independent of the code under test.
					const mac = createHmac("sha512", "custom-secret").update(body).digest("base64");
					yield* verifyCustom(yield* deliver({ "x-signature": `sha512=${mac}` }, body, "custom-secret"));
					const noPrefix = yield* deliver({ "x-signature": mac }, body, "custom-secret");
					assert.strictEqual(yield* reasonOf(verifyCustom(noPrefix)), "bad_signature");
				}),
			);

			it.effect("dies, rather than failing, on an empty HMAC secret", () =>
				Effect.gen(function* () {
					const delivery = yield* deliver({ "x-hub-signature-256": `sha256=${"0".repeat(64)}` }, "{}", "");
					const exit = yield* Effect.exit(verifyGitHub(delivery));
					assert.isTrue(Exit.hasDies(exit));
				}),
			);

			it.effect("compares a shared secret header exactly", () =>
				Effect.gen(function* () {
					yield* verifyCloudflare(yield* deliver({ "cf-webhook-auth": "cf-secret" }, "{}", "cf-secret"));
					const wrong = yield* deliver({ "cf-webhook-auth": "cf-secreT" }, "{}", "cf-secret");
					assert.strictEqual(yield* reasonOf(verifyCloudflare(wrong)), "bad_signature");
					// A fetch Request trims header values itself; a plain-data adapter that does not is compared verbatim.
					const padded: WebhookRequest = { ...wrong, header: () => Option.some(" cf-secret") };
					assert.strictEqual(yield* reasonOf(verifyCloudflare(padded)), "bad_signature");
					const absent = yield* deliver({}, "{}", "cf-secret");
					const error = yield* Effect.flip(verifyCloudflare(absent));
					assert.strictEqual(error.reason, "missing_signature");
					assert.strictEqual(statusFor(error), 401);
				}),
			);
		});
	}

	it("maps reasons to HTTP statuses", () => {
		const of = (reason: WebhookVerificationError["reason"]) => statusFor({ reason } as WebhookVerificationError);
		assert.deepStrictEqual(
			(["missing_signature", "bad_signature", "malformed", "stale_timestamp"] as const).map(of),
			[401, 401, 400, 400],
		);
	});
});
