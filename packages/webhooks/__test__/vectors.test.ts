import { readFileSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { GitHub } from "../src/GitHub.js";
import { HmacHeader } from "../src/HmacHeader.js";
import { Sanity } from "../src/Sanity.js";
import { StandardWebhooks } from "../src/StandardWebhooks.js";
import { Stripe } from "../src/Stripe.js";
import type { WebhookRequest } from "../src/WebhookRequest.js";
import type { WebhookVerificationError } from "../src/WebhookVerificationError.js";
import type { Vector } from "./fixtures/generate-vectors.js";
import { generateVectors } from "./fixtures/generate-vectors.js";
import { request } from "./helpers.js";

const committed: ReadonlyArray<Vector> = JSON.parse(
	readFileSync(new URL("./fixtures/vectors.json", import.meta.url), "utf-8"),
);

const verifiers: Record<
	Vector["preset"],
	(request: WebhookRequest) => Effect.Effect<unknown, WebhookVerificationError>
> = {
	StandardWebhooks: (r) => StandardWebhooks.verify(r),
	GitHub: (r) => GitHub.verify(r),
	Stripe: (r) => Stripe.verify(r),
	Sanity: (r) => Sanity.verify(r),
	HmacHeader: (r) => HmacHeader.verify(r, { header: "linear-signature", encoding: "hex" }),
};

const toRequest = (vector: Vector, body: Uint8Array = new Uint8Array(Buffer.from(vector.body, "base64"))) =>
	request(vector.headers, body, vector.secret, vector.receivedAt);

describe("committed vectors", () => {
	it("are exactly what the generator produces from the vendor libraries", () => {
		assert.deepStrictEqual(committed, generateVectors());
		assert.strictEqual(committed.length, 8);
	});

	for (const vector of committed) {
		it.effect(`${vector.preset}: ${vector.name} verifies`, () =>
			Effect.gen(function* () {
				yield* verifiers[vector.preset](toRequest(vector));
			}),
		);

		it.effect(`${vector.preset}: ${vector.name} fails as bad_signature with any one body byte flipped`, () =>
			Effect.gen(function* () {
				const body = new Uint8Array(Buffer.from(vector.body, "base64"));
				for (const index of [0, Math.floor(body.length / 2), body.length - 1]) {
					const flipped = new Uint8Array(body);
					flipped[index] = (flipped[index] ?? 0) ^ 0x01;
					const error = yield* Effect.flip(verifiers[vector.preset](toRequest(vector, flipped)));
					assert.strictEqual(error.reason, "bad_signature", `byte ${index}`);
				}
			}),
		);
	}
});
