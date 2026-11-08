import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { NpmRegistry } from "../src/NpmRegistry.js";

// Interrupting a registry read must abort the fetch it has in flight. The
// abort is core's: `HttpClient.make` gives every request its own
// `AbortController`, aborts it when the calling fiber is interrupted, and keeps
// it armed while the body is read. NpmRegistry adds no wiring of its own; these
// tests pin that nothing between the method and core's client cuts that path.
// They run the REAL `FetchHttpClient` over a `fetch` that hangs and record the
// signal it was handed, which behaves like a real fetch: an abort rejects the
// request or errors the body stream.

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
					controller.enqueue(new TextEncoder().encode('{"name":"pkg",'));
					signal?.addEventListener("abort", () => controller.error(signal?.reason), { once: true });
				},
				// Reached once the reader asks past the first chunk: the body stalls here.
				pull() {
					arrive();
					return new Promise<void>(() => {});
				},
			});
			resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
		})) as typeof globalThis.fetch;
	return { fetch, hung, signal: () => signal };
};

const drive = (mode: HangMode) =>
	Effect.gen(function* () {
		const hang = hangingFetch(mode);
		const http = FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, hang.fetch)));
		const registry = yield* Effect.provide(
			Effect.gen(function* () {
				return yield* NpmRegistry;
			}),
			NpmRegistry.layer.pipe(Layer.provide(http)),
		);
		const fiber = yield* Effect.forkChild(registry.version("pkg", "1.1.0"));
		yield* Effect.promise(() => hang.hung);
		const signal = hang.signal();
		const abortedBefore = signal?.aborted;
		yield* Fiber.interrupt(fiber);
		return { abortedBefore, abortedAfter: signal?.aborted };
	});

describe("interrupting a registry read aborts its fetch", () => {
	it.effect("a request with no answer yet is aborted", () =>
		Effect.gen(function* () {
			const result = yield* drive("request");
			assert.strictEqual(result.abortedBefore, false);
			assert.strictEqual(result.abortedAfter, true);
		}),
	);

	it.effect("a body that stops arriving is aborted with the read", () =>
		Effect.gen(function* () {
			const result = yield* drive("body");
			assert.strictEqual(result.abortedBefore, false);
			assert.strictEqual(result.abortedAfter, true);
		}),
	);
});
