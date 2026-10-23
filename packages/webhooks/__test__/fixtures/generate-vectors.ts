// Regenerates vectors.json from the vendors' own libraries and node:crypto,
// never from the code under test. Run from the package root:
//   node __test__/fixtures/generate-vectors.ts
// webhook-vectors.test.ts asserts the committed file equals what this produces.

import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import Stripe from "stripe";
import { Webhook } from "svix";

/** One delivery that must verify. `body` is base64 so a non-UTF-8 byte survives JSON. */
export interface Vector {
	readonly preset: "StandardWebhooks" | "GitHub" | "Stripe" | "Sanity" | "HmacHeader";
	readonly name: string;
	readonly oracle: string;
	readonly secret: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
	readonly receivedAt: number;
}

/** 2026-10-19T12:00:00Z, the arrival time of every vector. */
export const NOON = Date.parse("2026-10-19T12:00:00Z");
const T = NOON / 1000;

const SVIX_KEY = Buffer.from("effected-svix-test-key-0123456789", "utf8");
export const SVIX_SECRET = `whsec_${SVIX_KEY.toString("base64")}`;
export const STRIPE_SECRET = "whsec_effected_stripe_test_secret";
export const GITHUB_SECRET = "effected-github-test-secret";
export const SANITY_SECRET = "effected-sanity-test-secret";
export const LINEAR_SECRET = "lin_wh_effected_test_secret";

const MESSAGE_ID = "msg_2abcDEF345ghiJKL678mnoPQR";
const JSON_BODY = '{"type":"user.created","object":"event","data":{"id":"user_1"}}';
const STRIPE_BODY = '{"id":"evt_1","object":"event","type":"charge.refunded","livemode":false}';
/** JSON whose string holds a lone 0xE9 (Latin-1 é), which is not valid UTF-8. */
const RAW_BODY = Buffer.concat([Buffer.from('{"data":{"id":"caf'), Buffer.from([0xe9]), Buffer.from('"}}')]);

export const generateVectors = (): ReadonlyArray<Vector> => {
	const svix = new Webhook(SVIX_SECRET);
	const svixSigned = svix.sign(MESSAGE_ID, new Date(NOON), JSON_BODY);
	// Not svix: standardwebhooks UTF-8-decodes a Buffer payload before signing (payload.toString()), so it cannot
	// sign raw bytes. The sender signs the bytes it sends, so node:crypto is the oracle here.
	const svixRaw = `v1,${createHmac("sha256", SVIX_KEY)
		.update(Buffer.concat([Buffer.from(`${MESSAGE_ID}.${T}.`), RAW_BODY]))
		.digest("base64")}`;
	const svixOld = new Webhook(Buffer.from("rotated-out-key").toString("base64")).sign(
		MESSAGE_ID,
		new Date(NOON),
		JSON_BODY,
	);
	const github = createHmac("sha256", GITHUB_SECRET).update(JSON_BODY).digest("hex");
	const sanity = createHmac("sha256", SANITY_SECRET).update(`${NOON}.`).update(JSON_BODY).digest("base64url");
	const linear = createHmac("sha256", LINEAR_SECRET).update(JSON_BODY).digest("hex");
	const base64 = (text: string | Buffer) => Buffer.from(text).toString("base64");
	return [
		{
			preset: "StandardWebhooks",
			name: "svix-branded headers",
			oracle: "svix Webhook.sign",
			secret: SVIX_SECRET,
			headers: { "svix-id": MESSAGE_ID, "svix-timestamp": String(T), "svix-signature": svixSigned },
			body: base64(JSON_BODY),
			receivedAt: NOON,
		},
		{
			preset: "StandardWebhooks",
			name: "unbranded webhook- headers",
			oracle: "svix Webhook.sign",
			secret: SVIX_SECRET,
			headers: { "webhook-id": MESSAGE_ID, "webhook-timestamp": String(T), "webhook-signature": svixSigned },
			body: base64(JSON_BODY),
			receivedAt: NOON,
		},
		{
			preset: "StandardWebhooks",
			name: "a rotation list with a v1a and a rotated-out key before the match",
			oracle: "svix Webhook.sign",
			secret: SVIX_SECRET,
			headers: {
				"svix-id": MESSAGE_ID,
				"svix-timestamp": String(T),
				"svix-signature": `${svixOld} v1a,abcd ${svixSigned}`,
			},
			body: base64(JSON_BODY),
			receivedAt: NOON,
		},
		{
			preset: "StandardWebhooks",
			name: "a body that is not UTF-8",
			oracle: "node:crypto createHmac",
			secret: SVIX_SECRET,
			headers: { "svix-id": MESSAGE_ID, "svix-timestamp": String(T), "svix-signature": svixRaw },
			body: base64(RAW_BODY),
			receivedAt: NOON,
		},
		{
			preset: "Stripe",
			name: "one v1",
			oracle: "stripe webhooks.generateTestHeaderString",
			secret: STRIPE_SECRET,
			headers: {
				"stripe-signature": Stripe.webhooks.generateTestHeaderString({
					payload: STRIPE_BODY,
					secret: STRIPE_SECRET,
					timestamp: T,
				}),
			},
			body: base64(STRIPE_BODY),
			receivedAt: NOON,
		},
		{
			preset: "GitHub",
			name: "x-hub-signature-256",
			oracle: "node:crypto createHmac",
			secret: GITHUB_SECRET,
			headers: { "x-hub-signature-256": `sha256=${github}` },
			body: base64(JSON_BODY),
			receivedAt: NOON,
		},
		{
			preset: "Sanity",
			name: "t in milliseconds, unpadded base64url",
			oracle: "node:crypto createHmac",
			secret: SANITY_SECRET,
			headers: { "sanity-webhook-signature": `t=${NOON},v1=${sanity}` },
			body: base64(JSON_BODY),
			receivedAt: NOON,
		},
		{
			preset: "HmacHeader",
			name: "Linear's bare hex linear-signature",
			oracle: "node:crypto createHmac",
			secret: LINEAR_SECRET,
			headers: { "linear-signature": linear },
			body: base64(JSON_BODY),
			receivedAt: NOON,
		},
	];
};

if (import.meta.url === `file://${process.argv[1]}`) {
	writeFileSync(
		new URL("./vectors.json", import.meta.url),
		`${JSON.stringify(generateVectors(), null, "\t")}\n`,
	);
}
