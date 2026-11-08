import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import type { S3ClientShape } from "../src/S3Client.js";
import { S3Client } from "../src/S3Client.js";
import { CryptoLive, r2Options } from "./utils/fake-s3.js";

// Interrupting a call must abort the fetch it has in flight. The abort is
// core's: `HttpClient.make` gives every request its own `AbortController`,
// aborts it when the calling fiber is interrupted, and keeps it armed while the
// body is read. S3Client adds no wiring of its own; these tests pin that
// nothing between a method and core's client cuts that path. They run the REAL
// `FetchHttpClient` over a `fetch` that hangs and record the signal it was
// handed, which behaves like a real fetch: an abort rejects the request or
// errors the body stream.

type HangMode = "request" | "body";

/** A `fetch` that hangs at `mode`; `hung` settles once it is hanging. */
const hangingFetch = (mode: HangMode) => {
	let signal: AbortSignal | undefined;
	let arrive: () => void = () => {};
	const hung = new Promise<void>((resolve) => {
		arrive = resolve;
	});
	const fetch = ((_input: string | URL | Request, init?: RequestInit) =>
		new Promise<Response>((resolve, reject) => {
			signal = init?.signal ?? undefined;
			signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
			if (mode === "request") {
				arrive();
				return;
			}
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("partial object"));
					signal?.addEventListener("abort", () => controller.error(signal?.reason), { once: true });
				},
				// Reached once the reader asks past the first chunk: the body stalls here.
				pull() {
					arrive();
					return new Promise<void>(() => {});
				},
			});
			resolve(new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } }));
		})) as typeof globalThis.fetch;
	return { fetch, hung, signal: () => signal };
};

const drive = (mode: HangMode, call: (s3: S3ClientShape) => Effect.Effect<unknown, unknown>) =>
	Effect.gen(function* () {
		const hang = hangingFetch(mode);
		const http = FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, hang.fetch)));
		const s3 = yield* S3Client.make(r2Options()).pipe(Effect.provide(Layer.merge(http, CryptoLive)));
		const fiber = yield* Effect.forkChild(call(s3));
		yield* Effect.promise(() => hang.hung);
		const signal = hang.signal();
		const abortedBefore = signal?.aborted;
		yield* Fiber.interrupt(fiber);
		return { abortedBefore, abortedAfter: signal?.aborted };
	});

describe("interrupting a call aborts its fetch", () => {
	it.effect("a get with no answer yet is aborted", () =>
		Effect.gen(function* () {
			const result = yield* drive("request", (s3) => s3.get("a.txt"));
			assert.strictEqual(result.abortedBefore, false);
			assert.strictEqual(result.abortedAfter, true);
		}),
	);

	it.effect("a get whose body stops arriving is aborted with the read", () =>
		Effect.gen(function* () {
			const result = yield* drive("body", (s3) => s3.get("a.txt"));
			assert.strictEqual(result.abortedBefore, false);
			assert.strictEqual(result.abortedAfter, true);
		}),
	);

	it.effect("a put with no answer yet is aborted", () =>
		Effect.gen(function* () {
			const result = yield* drive("request", (s3) => s3.put("a.txt", new TextEncoder().encode("hello")));
			assert.strictEqual(result.abortedBefore, false);
			assert.strictEqual(result.abortedAfter, true);
		}),
	);
});
