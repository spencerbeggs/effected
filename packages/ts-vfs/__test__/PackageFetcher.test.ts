import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import type { RegistryEvent } from "../src/index.js";
import { FetchError, PackageFetcher, PackageNotFoundError, PackageSpec, RegistryObserver } from "../src/index.js";
import { MAX_TYPE_BYTES_PER_PACKAGE, MAX_TYPE_FILES_PER_PACKAGE } from "../src/internal/limits.js";

const zod = PackageSpec.make({ name: "zod", version: "3.23.8" });

/**
 * A mock HttpClient: the handler maps a URL to a web `Response`, or to
 * `"transport"` to simulate a connection failure, or `"hang"` to never
 * respond (for timeout tests).
 */
const clientLayer = (handler: (url: string) => Response | "transport" | "hang"): Layer.Layer<HttpClient.HttpClient> =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) => {
			const result = handler(url.toString());
			if (result === "transport") {
				return Effect.fail(
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.TransportError({ request, description: "connection refused" }),
					}),
				);
			}
			if (result === "hang") {
				return Effect.never;
			}
			return Effect.succeed(HttpClientResponse.fromWeb(request, result));
		}),
	);

const fetcherLayer = (handler: (url: string) => Response | "transport" | "hang") =>
	PackageFetcher.layer.pipe(Layer.provide(clientLayer(handler)));

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const text = (body: string, status = 200): Response => new Response(body, { status });

describe("PackageFetcher", () => {
	it.effect("getVersions decodes versions and tags", () =>
		Effect.gen(function* () {
			const fetcher = yield* PackageFetcher;
			const meta = yield* fetcher.getVersions("zod");
			assert.deepStrictEqual([...meta.versions], ["3.23.8", "3.22.4"]);
			assert.strictEqual(meta.tags.latest, "3.23.8");
		}).pipe(Effect.provide(fetcherLayer(() => json({ versions: ["3.23.8", "3.22.4"], tags: { latest: "3.23.8" } })))),
	);

	it.effect("a non-2xx response fails typed with the status and emits FetchFailed", () =>
		Effect.gen(function* () {
			const events: Array<RegistryEvent> = [];
			const fetcher = yield* PackageFetcher;
			const error = yield* Effect.flip(
				fetcher.getVersions("zod").pipe(Effect.provide(RegistryObserver.layerCallback((event) => events.push(event)))),
			);
			assert.instanceOf(error, FetchError);
			if (error instanceof FetchError) {
				assert.strictEqual(error.kind, "status");
				assert.strictEqual(error.status, 500);
			}
			assert.strictEqual(events.length, 1);
			const failed = events[0];
			if (failed?._tag === "FetchFailed") {
				assert.strictEqual(failed.status, 500);
				assert.strictEqual(failed.bodySnippet, "upstream exploded");
			} else {
				assert.fail("expected a FetchFailed event");
			}
		}).pipe(Effect.provide(fetcherLayer(() => text("upstream exploded", 500)))),
	);

	it.effect("a 404 on a pinned-package endpoint promotes to PackageNotFoundError", () =>
		Effect.gen(function* () {
			const fetcher = yield* PackageFetcher;
			const error = yield* Effect.flip(fetcher.getPackageJson(zod));
			assert.instanceOf(error, PackageNotFoundError);
			if (error instanceof PackageNotFoundError) {
				assert.strictEqual(error.name, "zod");
				assert.strictEqual(error.version, "3.23.8");
			}
		}).pipe(Effect.provide(fetcherLayer(() => text("Couldn't find the requested release version 3.23.8.", 404)))),
	);

	it.effect("a schema-invalid response fails as FetchError kind schema", () =>
		Effect.gen(function* () {
			const fetcher = yield* PackageFetcher;
			const error = yield* Effect.flip(fetcher.getVersions("zod"));
			assert.instanceOf(error, FetchError);
			if (error instanceof FetchError) {
				assert.strictEqual(error.kind, "schema");
			}
		}).pipe(Effect.provide(fetcherLayer(() => json({ nope: true })))),
	);

	it.effect("transport failures are retried; status failures are not", () =>
		Effect.gen(function* () {
			let transportAttempts = 0;
			let statusAttempts = 0;
			const transportFetcher = fetcherLayer(() => {
				transportAttempts += 1;
				return "transport";
			});
			const statusFetcher = fetcherLayer(() => {
				statusAttempts += 1;
				return text("nope", 500);
			});

			const transportFiber = yield* Effect.gen(function* () {
				const fetcher = yield* PackageFetcher;
				return yield* Effect.flip(fetcher.getVersions("zod"));
			}).pipe(Effect.provide(transportFetcher), Effect.forkChild);
			yield* TestClock.adjust(Duration.seconds(5));
			const transportError = yield* Fiber.join(transportFiber);
			assert.instanceOf(transportError, FetchError);
			if (transportError instanceof FetchError) assert.strictEqual(transportError.kind, "transport");
			assert.strictEqual(transportAttempts, 4);

			const statusError = yield* Effect.gen(function* () {
				const fetcher = yield* PackageFetcher;
				return yield* Effect.flip(fetcher.getVersions("zod"));
			}).pipe(Effect.provide(statusFetcher));
			assert.strictEqual(statusAttempts, 1);
			assert.instanceOf(statusError, FetchError);
		}),
	);

	it.effect("requests time out after 30 seconds and surface as transport failures", () =>
		Effect.gen(function* () {
			const fiber = yield* Effect.gen(function* () {
				const fetcher = yield* PackageFetcher;
				return yield* Effect.flip(fetcher.getVersions("zod"));
			}).pipe(Effect.provide(fetcherLayer(() => "hang")), Effect.forkChild);
			// One initial attempt plus 3 retries, with exponential pauses between.
			yield* TestClock.adjust(Duration.minutes(3));
			const error = yield* Fiber.join(fiber);
			assert.instanceOf(error, FetchError);
			if (error instanceof FetchError) assert.strictEqual(error.kind, "transport");
		}),
	);

	it.effect("getFileTree strips leading slashes from tree paths", () =>
		Effect.gen(function* () {
			const fetcher = yield* PackageFetcher;
			const tree = yield* fetcher.getFileTree(zod);
			assert.deepStrictEqual([...tree], ["package.json", "index.d.ts", "lib/index.js"]);
		}).pipe(
			Effect.provide(
				fetcherLayer(() =>
					json({
						default: "/lib/index.js",
						files: [{ name: "/package.json" }, { name: "/index.d.ts" }, { name: "/lib/index.js" }],
					}),
				),
			),
		),
	);

	it.effect("getTypeFiles downloads exactly the declaration files", () =>
		Effect.gen(function* () {
			const fetcher = yield* PackageFetcher;
			const files = yield* fetcher.getTypeFiles(zod);
			assert.deepStrictEqual([...files.keys()].toSorted(), ["index.d.ts", "lib/deep.d.mts"]);
			assert.strictEqual(files.get("index.d.ts"), "content:index.d.ts");
		}).pipe(
			Effect.provide(
				fetcherLayer((url) => {
					if (url.includes("/flat")) {
						return json({
							default: null,
							files: [
								{ name: "/package.json" },
								{ name: "/index.d.ts" },
								{ name: "/lib/deep.d.mts" },
								{ name: "/lib/index.js" },
							],
						});
					}
					return text(`content:${url.split("@3.23.8/")[1] ?? ""}`);
				}),
			),
		),
	);

	it.effect("getTypeFiles rejects a tree over the file budget as a typed body failure", () =>
		Effect.gen(function* () {
			const fetcher = yield* PackageFetcher;
			const error = yield* Effect.flip(fetcher.getTypeFiles(zod));
			assert.instanceOf(error, FetchError);
			if (error instanceof FetchError) assert.strictEqual(error.kind, "body");
		}).pipe(
			Effect.provide(
				fetcherLayer(() =>
					json({
						default: null,
						files: Array.from({ length: MAX_TYPE_FILES_PER_PACKAGE + 1 }, (_, index) => ({
							name: `/f${index}.d.ts`,
						})),
					}),
				),
			),
		),
	);

	it.effect("getTypeFiles enforces the byte budget as downloads accumulate", () =>
		Effect.gen(function* () {
			const fetcher = yield* PackageFetcher;
			const error = yield* Effect.flip(fetcher.getTypeFiles(zod));
			assert.instanceOf(error, FetchError);
			if (error instanceof FetchError) assert.strictEqual(error.kind, "body");
		}).pipe(
			Effect.provide(
				fetcherLayer((url) => {
					if (url.includes("/flat")) {
						// No declared size, so the pre-check passes and the
						// post-download backstop must catch it.
						return json({ default: null, files: [{ name: "/huge.d.ts" }] });
					}
					// One declaration file over the 64 MiB budget.
					return text("x".repeat(MAX_TYPE_BYTES_PER_PACKAGE + 1));
				}),
			),
		),
	);

	it.effect("the byte budget is cumulative: individually-valid files whose sum exceeds it fail", () =>
		Effect.gen(function* () {
			const fetcher = yield* PackageFetcher;
			const error = yield* Effect.flip(fetcher.getTypeFiles(zod));
			assert.instanceOf(error, FetchError);
			if (error instanceof FetchError) assert.strictEqual(error.kind, "body");
		}).pipe(
			Effect.provide(
				fetcherLayer((url) => {
					if (url.includes("/flat")) {
						// Three files, each well under the budget, summing past it —
						// exercises the Ref accounting under concurrency, not the
						// single-file case. Sizes deliberately undeclared so the
						// pre-check cannot short-circuit.
						return json({
							default: null,
							files: [{ name: "/a.d.ts" }, { name: "/b.d.ts" }, { name: "/c.d.ts" }],
						});
					}
					return text("x".repeat(Math.floor(MAX_TYPE_BYTES_PER_PACKAGE / 2) + 1));
				}),
			),
		),
	);

	it.effect("declared tree sizes over the budget are rejected before any download", () =>
		Effect.gen(function* () {
			let downloads = 0;
			const error = yield* Effect.gen(function* () {
				const fetcher = yield* PackageFetcher;
				return yield* Effect.flip(fetcher.getTypeFiles(zod));
			}).pipe(
				Effect.provide(
					fetcherLayer((url) => {
						if (url.includes("/flat")) {
							return json({
								default: null,
								files: [
									{ name: "/a.d.ts", size: MAX_TYPE_BYTES_PER_PACKAGE },
									{ name: "/b.d.ts", size: 2 },
								],
							});
						}
						downloads += 1;
						return text("tiny");
					}),
				),
			);
			assert.instanceOf(error, FetchError);
			if (error instanceof FetchError) assert.strictEqual(error.kind, "body");
			assert.strictEqual(downloads, 0);
		}),
	);
});
