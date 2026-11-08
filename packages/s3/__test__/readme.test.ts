// The README's quick start, compiled and run against the fake store, so the page cannot drift from the API.
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Redacted, Schedule } from "effect";
import { Digest, Mac, SecureRandom } from "effect/crypto";
import { FetchHttpClient } from "effect/http";
import { S3Client } from "../src/index.js";
import { fakeS3, xmlError } from "./utils/fake-s3.js";

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
			Effect.retry({
				while: (error) => error._tag === "S3ConditionalConflict",
				schedule: Schedule.exponential("100 millis"),
				times: 3,
			}),
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

	// Live clock: the fake signs through WebCrypto, real async work a virtual clock cannot drive.
	it.live("the quick start's archive backs off, then retries a racing write that answered 409", () => {
		let conflicts = 1;
		const puts: Array<number> = [];
		const store = fakeS3((request) => {
			if (request.method !== "PUT") return undefined;
			puts.push(performance.now());
			if (conflicts === 0) return undefined;
			conflicts--;
			return xmlError(409, "ConditionalRequestConflict", "A conflicting operation occurred. Retry the request.");
		});
		return Effect.gen(function* () {
			assert.strictEqual(yield* archive("raw/2026/11/06/delivery-2.json", "{}"), "created");
			// The conflict was answered, then the retry was sent and won.
			assert.lengthOf(store.seen, 2);
			assert.strictEqual(conflicts, 0);
			// The retry waited for the schedule's first delay: the write still in flight had time to land.
			const [first = 0, second = 0] = puts;
			assert.isAtLeast(second - first, 95);
			assert.strictEqual(new TextDecoder().decode(store.objects.get("raw/2026/11/06/delivery-2.json")?.body), "{}");
		}).pipe(Effect.provide(store.layer()));
	});
});
