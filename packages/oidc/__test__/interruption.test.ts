import { assert, layer } from "@effect/vitest";
import { JwksResolver, JwksStore } from "@effected/jwt";
import { TestIssuer } from "@effected/jwt/testing";
import { Effect, Fiber, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { IdTokenClaims, Oidc } from "../src/index.js";
import { CryptoLive } from "./crypto.js";

// Interrupting a verification must abort the key fetch it has in flight. The
// abort is core's: `HttpClient.make` gives every request its own
// `AbortController`, aborts it when the calling fiber is interrupted, and keeps
// it armed while the body is read. Neither Oidc nor `@effected/jwt`'s
// `JwksResolver` adds wiring of its own; these tests pin that nothing between
// `Oidc.verify` and core's client cuts that path. They run the REAL
// `FetchHttpClient` over a `fetch` that hangs on the issuer's discovery
// document and record the signal it was handed, which behaves like a real
// fetch: an abort rejects the request or errors the body stream.

const ISSUER = "https://accounts.example.com";

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
					controller.enqueue(new TextEncoder().encode('{"issuer":'));
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
		const issuer = yield* TestIssuer.make({ issuer: ISSUER });
		const token = yield* issuer.sign({ sub: "user-1", aud: "client-1" });
		const hang = hangingFetch(mode);
		const http = FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, hang.fetch)));
		const resolver = JwksResolver.layer.pipe(Layer.provide(Layer.merge(http, JwksStore.layerMemory)));
		const fiber = yield* Effect.forkChild(
			Oidc.verify(token, { issuer: ISSUER, audience: "client-1", claims: IdTokenClaims }).pipe(
				Effect.provide(resolver),
			),
		);
		yield* Effect.promise(() => hang.hung);
		const signal = hang.signal();
		const abortedBefore = signal?.aborted;
		yield* Fiber.interrupt(fiber);
		return { abortedBefore, abortedAfter: signal?.aborted };
	});

layer(CryptoLive, { buildPerTest: true })("interrupting Oidc.verify aborts its key fetch", (it) => {
	it.effect("a discovery request with no answer yet is aborted", () =>
		Effect.gen(function* () {
			const result = yield* drive("request");
			assert.strictEqual(result.abortedBefore, false);
			assert.strictEqual(result.abortedAfter, true);
		}),
	);

	it.effect("a discovery body that stops arriving is aborted with the read", () =>
		Effect.gen(function* () {
			const result = yield* drive("body");
			assert.strictEqual(result.abortedBefore, false);
			assert.strictEqual(result.abortedAfter, true);
		}),
	);
});
