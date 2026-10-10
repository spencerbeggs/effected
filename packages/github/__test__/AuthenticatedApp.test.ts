import { generateKeyPairSync } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Redacted, Stream } from "effect";
import { TestClock } from "effect/testing";
import { AppInfo, AuthenticatedApp, DeliveryAttempt } from "../src/AuthenticatedApp.js";
import { GitHubApp } from "../src/GitHubApp.js";
import { RetryPolicy } from "../src/Resilience.js";
import { PageOptions } from "../src/Rest.js";
import type { Reply } from "./fixtures.js";
import { linkNext, scriptedFetch } from "./fixtures.js";
import { harness } from "./harness.js";

const drive = <A, E>(replies: ReadonlyArray<Reply>, use: (app: AuthenticatedApp["Service"]) => Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		const { script, base } = harness(replies);
		const value = yield* Effect.provide(
			Effect.flatMap(AuthenticatedApp, use),
			AuthenticatedApp.layer.pipe(Layer.provide(base)),
		);
		return { value, script };
	});

/** A delivery as GitHub's `hook-delivery-item` schema describes it. */
const wireDelivery = (overrides: Record<string, unknown> = {}) => ({
	id: 12345678,
	guid: "0b989ba4-242f-11e5-81e1-c7b6966d2516",
	delivered_at: "2019-06-03T00:57:16Z",
	redelivery: false,
	duration: 0.27,
	status: "OK",
	status_code: 200,
	event: "issues",
	action: "opened",
	installation_id: 123,
	repository_id: 456,
	throttled_at: null,
	...overrides,
});

describe("AuthenticatedApp.get", () => {
	it.effect("reads GET /app into AppInfo", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[
					{
						status: 200,
						body: {
							id: 1,
							slug: "octoapp",
							client_id: "Iv1.ab1112223334445c",
							node_id: "MDExOkludGVncmF0aW9uMQ==",
							owner: { login: "github", id: 1 },
							name: "Octocat App",
							description: "",
							external_url: "https://example.com",
							html_url: "https://github.com/apps/octoapp",
							created_at: "2017-07-08T16:18:44-04:00",
							updated_at: "2017-07-08T16:18:44-04:00",
							permissions: {},
							events: [],
						},
					},
				],
				(app) => app.get(),
			);
			assert.deepStrictEqual(
				value,
				AppInfo.make({
					id: 1,
					slug: "octoapp",
					name: "Octocat App",
					nodeId: "MDExOkludGVncmF0aW9uMQ==",
					clientId: "Iv1.ab1112223334445c",
					htmlUrl: "https://github.com/apps/octoapp",
				}),
			);
			assert.deepStrictEqual([script.calls[0]?.method, script.calls[0]?.path], ["GET", "/app"]);
		}),
	);

	it.effect("fails with a typed decode error on a malformed app", () =>
		Effect.gen(function* () {
			const { value } = yield* drive([{ status: 200, body: { id: 1, slug: "x" } }], (app) => Effect.flip(app.get()));
			assert.deepStrictEqual([value.kind, value.operation], ["decode", "AuthenticatedApp.get"]);
		}),
	);
});

describe("AuthenticatedApp.deliveries", () => {
	it.effect("decodes each delivery, ids narrowed and nulls kept", () =>
		Effect.gen(function* () {
			const { value } = yield* drive(
				[{ status: 200, body: [wireDelivery(), wireDelivery({ id: 2, action: null, installation_id: null })] }],
				(app) => Stream.runCollect(app.deliveries()),
			);
			assert.deepStrictEqual(
				value[0],
				DeliveryAttempt.make({
					id: 12345678,
					guid: "0b989ba4-242f-11e5-81e1-c7b6966d2516",
					deliveredAt: "2019-06-03T00:57:16Z",
					redelivery: false,
					duration: 0.27,
					status: "OK",
					statusCode: 200,
					event: "issues",
					action: "opened",
					installationId: 123,
					repositoryId: 456,
					throttledAt: null,
				}),
			);
			assert.isNull(value[1]?.action);
			assert.isNull(value[1]?.installationId);
		}),
	);

	it.effect("is lazy: stopping early fetches no further page", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[
					{
						status: 200,
						body: [wireDelivery({ id: 3 }), wireDelivery({ id: 2 })],
						headers: linkNext("https://api.github.com/app/hook/deliveries?cursor=v1_2"),
					},
					{ status: 200, body: [wireDelivery({ id: 1 })] },
				],
				(app) => Stream.runCollect(app.deliveries().pipe(Stream.takeWhile((delivery) => delivery.id > 2))),
			);
			assert.deepStrictEqual(
				value.map((delivery) => delivery.id),
				[3],
			);
			assert.lengthOf(script.calls, 1);
		}),
	);

	it.effect("follows the cursor Link header to the next page", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[
					{
						status: 200,
						body: [wireDelivery({ id: 2 })],
						headers: linkNext("https://api.github.com/app/hook/deliveries?per_page=1&cursor=v1_2"),
					},
					{ status: 200, body: [wireDelivery({ id: 1 })] },
				],
				(app) => Stream.runCollect(app.deliveries({ status: "failure", page: PageOptions.make({ perPage: 1 }) })),
			);
			assert.deepStrictEqual(
				value.map((delivery) => delivery.id),
				[2, 1],
			);
			assert.strictEqual(script.queryOf(0).get("status"), "failure");
			assert.strictEqual(script.queryOf(1).get("cursor"), "v1_2");
		}),
	);

	it.effect("refuses an id beyond 2^53 rather than rounding it", () =>
		Effect.gen(function* () {
			const { value } = yield* drive([{ status: 200, body: [wireDelivery({ id: 2 ** 53 + 2 })] }], (app) =>
				Effect.flip(Stream.runCollect(app.deliveries())),
			);
			assert.deepStrictEqual([value.kind, value.operation], ["decode", "AuthenticatedApp.deliveries"]);
		}),
	);
});

describe("AuthenticatedApp writes and single reads", () => {
	it.effect("delivery reads one attempt, dropping the payloads", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[
					{
						status: 200,
						body: {
							...wireDelivery({ id: 9 }),
							url: "https://www.example.com",
							request: { headers: {}, payload: {} },
							response: { headers: {}, payload: "ok" },
						},
					},
				],
				(app) => app.delivery(9),
			);
			assert.strictEqual(value.id, 9);
			assert.notProperty(value, "request");
			assert.strictEqual(script.calls[0]?.path, "/app/hook/deliveries/9");
		}),
	);

	it.effect("redeliver posts an attempt", () =>
		Effect.gen(function* () {
			const { script } = yield* drive([{ status: 202, body: {} }], (app) => app.redeliver(9));
			assert.deepStrictEqual(
				[script.calls[0]?.method, script.calls[0]?.path],
				["POST", "/app/hook/deliveries/9/attempts"],
			);
		}),
	);

	it.effect("uninstall deletes the installation", () =>
		Effect.gen(function* () {
			const { script } = yield* drive([{ status: 204 }], (app) => app.uninstall(42));
			assert.deepStrictEqual([script.calls[0]?.method, script.calls[0]?.path], ["DELETE", "/app/installations/42"]);
		}),
	);

	it.effect("uninstall of a missing installation is notFound", () =>
		Effect.gen(function* () {
			const { value } = yield* drive([{ status: 404, body: { message: "Not Found" } }], (app) =>
				Effect.flip(app.uninstall(42)),
			);
			assert.strictEqual(value.kind, "notFound");
		}),
	);
});

describe("AuthenticatedApp over GitHubApp.appClientLayer", () => {
	it.effect("authenticates with an App JWT", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(1_800_000_000_000);
			const { privateKey } = generateKeyPairSync("rsa", {
				modulusLength: 2048,
				privateKeyEncoding: { type: "pkcs1", format: "pem" },
				publicKeyEncoding: { type: "spki", format: "pem" },
			});
			const script = scriptedFetch([{ status: 202, body: {} }]);
			yield* Effect.provide(
				Effect.flatMap(AuthenticatedApp, (app) => app.redeliver(1)),
				AuthenticatedApp.layer.pipe(
					Layer.provide(
						GitHubApp.appClientLayer(
							{ appId: "Iv1.app", privateKey: Redacted.make(privateKey) },
							{ fetch: script.fetch, retry: RetryPolicy.none },
						),
					),
				),
			);
			assert.match(script.calls[0]?.headers.authorization ?? "", /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
		}),
	);
});

describe("AuthenticatedApp.makeTest", () => {
	it("dies naming an unstubbed member", () => {
		assert.throws(() => AuthenticatedApp.makeTest().uninstall(1), /uninstall/);
	});
});
