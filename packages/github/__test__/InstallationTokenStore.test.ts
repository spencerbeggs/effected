import { generateKeyPairSync } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Cause, DateTime, Duration, Effect, Exit, Layer, Option, Redacted, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import type { CachedTokenRequest } from "../src/GitHubApp.js";
import { GitHubApp, InstallationToken } from "../src/GitHubApp.js";
import { GitHubClient } from "../src/GitHubClient.js";
import type { InstallationTokenStoreShape } from "../src/InstallationTokenStore.js";
import { InstallationTokenStore } from "../src/InstallationTokenStore.js";
import { RetryPolicy } from "../src/Resilience.js";
import { scriptedFetch } from "./fixtures.js";

const NOW_MILLIS = 1_800_000_000_000;

const REQUEST: CachedTokenRequest = {
	appId: "Iv1.cache",
	privateKey: Redacted.make("unused: GitHubApp is a double here"),
	installationId: 42,
};

/** A GitHubApp double whose `token` mints `ghs_<n>` valid for `lifetime` from the current clock. */
const countingApp = (lifetime: Duration.Duration = Duration.minutes(60)) =>
	Effect.gen(function* () {
		const minted = yield* Ref.make(0);
		const layer = GitHubApp.layerTest({
			token: (request) =>
				Effect.gen(function* () {
					const n = yield* Ref.updateAndGet(minted, (count) => count + 1);
					const now = yield* DateTime.now;
					return InstallationToken.make({
						token: Redacted.make(`ghs_${n}`),
						expiresAt: DateTime.addDuration(now, lifetime),
						installationId: request.installationId ?? 0,
						permissions: { contents: "read" },
					});
				}),
		});
		return { minted, layer };
	});

/** A store that records every write and otherwise behaves like the memory store. */
const recordingStore = (seed: ReadonlyMap<number, string> = new Map()) =>
	Effect.gen(function* () {
		const entries = yield* Ref.make(new Map(seed));
		const writes = yield* Ref.make<ReadonlyArray<{ id: number; encoded: string; ttl: Duration.Duration }>>([]);
		const shape: InstallationTokenStoreShape = {
			get: (id) => Effect.map(Ref.get(entries), (map) => Option.fromUndefinedOr(map.get(id))),
			set: (id, encoded, ttl) =>
				Effect.andThen(
					Ref.update(entries, (map) => new Map(map).set(id, encoded)),
					Ref.update(writes, (all) => [...all, { id, encoded, ttl }]),
				),
		};
		return { entries, writes, layer: Layer.succeed(InstallationTokenStore, shape) };
	});

describe("GitHubApp.cachedToken", () => {
	it.effect("mints once, then serves the stored token", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const app = yield* countingApp();
			const run = GitHubApp.cachedToken(REQUEST).pipe(
				Effect.provide(Layer.mergeAll(app.layer, InstallationTokenStore.layerMemory)),
			);
			// One store across both calls: layerMemory is memoized by reference only
			// within one provide, so share it explicitly.
			const both = yield* Effect.provide(
				Effect.all([GitHubApp.cachedToken(REQUEST), GitHubApp.cachedToken(REQUEST)]),
				Layer.mergeAll(app.layer, InstallationTokenStore.layerMemory),
			);
			assert.strictEqual(both[0].source, "minted");
			assert.strictEqual(both[1].source, "cached");
			assert.strictEqual(Redacted.value(both[1].token.token), "ghs_1");
			assert.strictEqual(yield* Ref.get(app.minted), 1);
			// A fresh store is a fresh cache.
			assert.strictEqual((yield* run).source, "minted");
		}),
	);

	it.effect("mints again once the clock passes expiry minus the margin", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const app = yield* countingApp();
			const store = yield* recordingStore();
			yield* Effect.provide(
				Effect.gen(function* () {
					assert.strictEqual((yield* GitHubApp.cachedToken(REQUEST)).source, "minted");
					// 60 min lifetime, 5 min default margin: still cached at +54 min.
					yield* TestClock.adjust(Duration.minutes(54));
					assert.strictEqual((yield* GitHubApp.cachedToken(REQUEST)).source, "cached");
					yield* TestClock.adjust(Duration.minutes(2));
					const again = yield* GitHubApp.cachedToken(REQUEST);
					assert.strictEqual(again.source, "minted");
					assert.strictEqual(Redacted.value(again.token.token), "ghs_2");
				}),
				Layer.mergeAll(app.layer, store.layer),
			);
		}),
	);

	it.effect("treats a stored value that does not decode as a miss and overwrites it", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const app = yield* countingApp();
			const store = yield* recordingStore(new Map([[42, "not json"]]));
			const result = yield* Effect.provide(GitHubApp.cachedToken(REQUEST), Layer.mergeAll(app.layer, store.layer));
			assert.strictEqual(result.source, "minted");
			const overwritten = (yield* Ref.get(store.entries)).get(42) ?? "";
			const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(InstallationToken))(overwritten);
			assert.strictEqual(Redacted.value(decoded.token), "ghs_1");
		}),
	);

	it.effect("stores the token for expiresAt minus margin minus now, keyed by installation id", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const app = yield* countingApp();
			const store = yield* recordingStore();
			yield* Effect.provide(
				GitHubApp.cachedToken({ ...REQUEST, margin: Duration.minutes(10) }),
				Layer.mergeAll(app.layer, store.layer),
			);
			const writes = yield* Ref.get(store.writes);
			assert.lengthOf(writes, 1);
			assert.strictEqual(writes[0]?.id, 42);
			assert.strictEqual(Duration.toMillis(writes[0]?.ttl ?? Duration.zero), Duration.toMillis(Duration.minutes(50)));
		}),
	);

	it.effect("skips the write when the token would expire within the margin", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const app = yield* countingApp(Duration.minutes(3));
			const store = yield* recordingStore();
			const result = yield* Effect.provide(GitHubApp.cachedToken(REQUEST), Layer.mergeAll(app.layer, store.layer));
			assert.strictEqual(result.source, "minted");
			assert.lengthOf(yield* Ref.get(store.writes), 0, "no zero or negative TTL reaches the store");
		}),
	);

	it.effect("refuses a negative or infinite margin", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const app = yield* countingApp();
			for (const margin of [Duration.minutes(-1), Duration.infinity]) {
				const error = yield* Effect.flip(
					Effect.provide(
						GitHubApp.cachedToken({ ...REQUEST, margin }),
						Layer.mergeAll(app.layer, InstallationTokenStore.layerMemory),
					),
				);
				assert.strictEqual(error._tag, "GitHubAppError");
			}
			assert.strictEqual(yield* Ref.get(app.minted), 0, "nothing is minted on a refused margin");
		}),
	);

	it.effect("refuses a non-finite raw-number margin rather than reading NaN as zero", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const app = yield* countingApp();
			for (const margin of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
				const error = yield* Effect.flip(
					Effect.provide(
						GitHubApp.cachedToken({ ...REQUEST, margin }),
						Layer.mergeAll(app.layer, InstallationTokenStore.layerMemory),
					),
				);
				assert.strictEqual(error._tag, "GitHubAppError", String(margin));
			}
			assert.strictEqual(yield* Ref.get(app.minted), 0, "nothing is minted on a refused margin");
			// control: a finite raw number of milliseconds is a margin
			yield* Effect.provide(
				GitHubApp.cachedToken({ ...REQUEST, margin: 1_000 }),
				Layer.mergeAll(app.layer, InstallationTokenStore.layerMemory),
			);
			assert.strictEqual(yield* Ref.get(app.minted), 1);
		}),
	);

	it.effect("never fails on a store that dies: a dying get is a miss, a dying set is ignored", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const app = yield* countingApp();
			// The test double with nothing stubbed: both members die.
			const dying = InstallationTokenStore.layerTest();
			const result = yield* Effect.provide(GitHubApp.cachedToken(REQUEST), Layer.mergeAll(app.layer, dying));
			assert.strictEqual(result.source, "minted");
			assert.strictEqual(Redacted.value(result.token.token), "ghs_1");
		}),
	);

	it.effect("lets interruption from the store propagate", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const app = yield* countingApp();
			const interrupting = Layer.succeed(InstallationTokenStore, {
				get: () => Effect.interrupt,
				set: () => Effect.void,
			});
			const exit = yield* Effect.exit(
				Effect.provide(GitHubApp.cachedToken(REQUEST), Layer.mergeAll(app.layer, interrupting)),
			);
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
			assert.strictEqual(yield* Ref.get(app.minted), 0);
		}),
	);
});

describe("GitHubApp.cachedClientLayer", () => {
	const { privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	});

	it.effect("authenticates with the cached token and never revokes it, even on release", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const script = scriptedFetch([
				{
					status: 201,
					body: { token: "ghs_cached", expires_at: "2099-01-01T00:00:00Z", permissions: { contents: "read" } },
				},
				{ status: 200, body: { default_branch: "main" } },
				{ status: 200, body: { default_branch: "main" } },
			]);
			const request = { appId: "Iv1.cache", privateKey: Redacted.make(privateKey), installationId: 42 };
			const options = { fetch: script.fetch, retry: RetryPolicy.none };
			const appLayer = GitHubApp.layerWith(options);
			const shared = Layer.mergeAll(appLayer, InstallationTokenStore.layerMemory);
			const call = Effect.flatMap(GitHubClient, (client) =>
				client.request("GET /repos/{owner}/{repo}", { owner: "o", repo: "r" }),
			);
			yield* Effect.provide(
				Effect.gen(function* () {
					// Two request scopes over one store: the second reuses the token.
					yield* Effect.provide(call, GitHubApp.cachedClientLayer(request, options));
					yield* Effect.provide(call, GitHubApp.cachedClientLayer(request, options));
				}),
				shared,
			);
			assert.strictEqual(script.count(), 3, "one mint, two requests, and no revoke");
			assert.include(script.calls[0]?.url ?? "", "/app/installations/42/access_tokens");
			for (const call of script.calls.slice(1)) {
				assert.strictEqual(call.headers.authorization, "token ghs_cached");
				assert.notStrictEqual(call.method, "DELETE");
			}
		}),
	);
});

describe("InstallationTokenStore.layerMemory", () => {
	it.effect("expires an entry once its TTL passes on Clock", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			yield* Effect.provide(
				Effect.gen(function* () {
					const store = yield* InstallationTokenStore;
					yield* store.set(1, "encoded", Duration.minutes(1));
					assert.deepStrictEqual(yield* store.get(1), Option.some("encoded"));
					assert.isTrue(Option.isNone(yield* store.get(2)), "keyed by installation id");
					yield* TestClock.adjust(Duration.minutes(1));
					assert.isTrue(Option.isNone(yield* store.get(1)), "gone at its TTL");
				}),
				InstallationTokenStore.layerMemory,
			);
		}),
	);
});
