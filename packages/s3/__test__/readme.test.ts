// The README's quick start, compiled and run against the fake store, so the page cannot drift from the API.
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { Digest, Mac, SecureRandom } from "effect/crypto";
import { FetchHttpClient } from "effect/http";
import { S3Client } from "../src/index.js";
import { fakeS3 } from "./utils/fake-s3.js";

// README: Quick start (composed but never run: it would reach the network).
const Archive = S3Client.layer({
	bucket: "build-webhooks",
	region: "auto",
	endpoint: "https://account.r2.cloudflarestorage.com",
	credentials: {
		accessKeyId: Redacted.make("<access key id>"),
		secretAccessKey: Redacted.make("<secret access key>"),
	},
});

export const AppLayer: Layer.Layer<S3Client> = Archive.pipe(
	Layer.provide(FetchHttpClient.layer),
	Layer.provide(Digest.layerWebCrypto),
	Layer.provide(Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))),
);

const archive = (key: string, json: string) =>
	Effect.gen(function* () {
		const s3 = yield* S3Client;
		return yield* s3.put(key, json, { ifNoneMatch: "*", contentType: "application/json" }).pipe(
			Effect.as("created" as const),
			Effect.catchTag("S3PreconditionFailed", () => Effect.succeed("exists" as const)),
		);
	});

describe("README", () => {
	it.effect("the quick start's archive writes once and reports a redelivery", () => {
		const store = fakeS3();
		return Effect.gen(function* () {
			assert.strictEqual(yield* archive("raw/2026/11/06/delivery-1.json", "{}"), "created");
			assert.strictEqual(yield* archive("raw/2026/11/06/delivery-1.json", '{"again":true}'), "exists");
			assert.strictEqual(new TextDecoder().decode(store.objects.get("raw/2026/11/06/delivery-1.json")?.body), "{}");
		}).pipe(Effect.provide(store.layer()));
	});
});
