import { NodeCrypto } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SharedSecret } from "../src/SharedSecret.js";
import { bytes, request } from "./helpers.js";

const SECRET = "cf-webhook-shared-secret";
const options = { header: "cf-webhook-auth" } as const;
const verify = (head: Record<string, string>) => SharedSecret.verify(request(head, bytes("{}"), SECRET, 0), options);
const reason = (head: Record<string, string>) =>
	Effect.flip(verify(head)).pipe(
		Effect.map((error) => (error._tag === "WebhookVerificationError" ? error.reason : error._tag)),
	);

layer(NodeCrypto.layer)("SharedSecret.verify", (it) => {
	it.effect("accepts the secret itself in the named header", () =>
		Effect.gen(function* () {
			yield* verify({ "cf-webhook-auth": SECRET });
		}),
	);

	it.effect("answers bad_signature for a wrong, prefix or extended secret, and missing_signature for none", () =>
		Effect.gen(function* () {
			for (const value of ["wrong", SECRET.slice(0, -1), `${SECRET}x`, SECRET.toUpperCase()]) {
				assert.strictEqual(yield* reason({ "cf-webhook-auth": value }), "bad_signature", value);
			}
			assert.strictEqual(yield* reason({}), "missing_signature");
			assert.strictEqual(yield* reason({ "cf-webhook-auth": "" }), "missing_signature");
			assert.strictEqual(yield* reason({ "x-other": SECRET }), "missing_signature");
		}),
	);
});
