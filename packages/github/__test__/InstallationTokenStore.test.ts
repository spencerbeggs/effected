import { generateKeyPairSync } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Cause, DateTime, Duration, Effect, Exit, Fiber, Latch, Layer, Option, Redacted, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import type { CachedTokenRequest } from "../src/GitHubApp.js";
import { GitHubApp, GitHubAppError, InstallationToken } from "../src/GitHubApp.js";
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

/** A store whose `get` always misses and whose `set` is a no-op, counting both. */
const coldStore = () =>
	Effect.gen(function* () {
		const gets = yield* Ref.make(0);
		const sets = yield* Ref.make(0);
		const layer = Layer.succeed(InstallationTokenStore, {
			get: () =>
				Effect.as(
					Ref.update(gets, (n) => n + 1),
					Option.none<string>(),
				),
			set: () => Ref.update(sets, (n) => n + 1),
		});
		return { gets, sets, layer };
	});

/**
 * A GitHubApp double whose `token` counts its calls, opens `entered` on the
 * first, then holds every call at `gate` and answers with `outcome` once it
 * opens.
 */
const gatedApp = (outcome: Effect.Effect<InstallationToken, GitHubAppError>) =>
	Effect.gen(function* () {
		const minted = yield* Ref.make(0);
		const entered = yield* Latch.make(false);
		const gate = yield* Latch.make(false);
		const layer = GitHubApp.layerTest({
			token: () =>
				Effect.gen(function* () {
					yield* Ref.update(minted, (n) => n + 1);
					yield* Latch.open(entered);
					yield* gate.await;
					return yield* outcome;
				}),
		});
		return { minted, entered, gate, layer };
	});

const freshToken = (text: string, installationId = REQUEST.installationId) =>
	Effect.map(DateTime.now, (now) =>
		InstallationToken.make({
			token: Redacted.make(text),
			expiresAt: DateTime.addDuration(now, Duration.minutes(60)),
			installationId,
			permissions: { contents: "read" },
		}),
	);

/** Yield to the scheduler until `condition` holds, or fail after `limit` yields. */
const yieldUntil = (condition: Effect.Effect<boolean>, limit = 100) =>
	Effect.gen(function* () {
		for (let i = 0; i < limit; i++) {
			if (yield* condition) return;
			yield* Effect.yieldNow;
		}
		assert.fail(`condition did not hold within ${limit} yields`);
	});

describe("GitHubApp.cachedToken single-flight", () => {
	const N = 4;

	it.effect("collapses N overlapping misses for one installation into one mint", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const app = yield* gatedApp(freshToken("ghs_1"));
			const store = yield* coldStore();
			const layers = Layer.mergeAll(app.layer, store.layer);
			const fiber = yield* Effect.forkChild(
				Effect.provide(
					Effect.all(
						Array.from({ length: N }, () => GitHubApp.cachedToken(REQUEST)),
						{ concurrency: "unbounded" },
					),
					layers,
				),
			);
			// Overlap, proven: every caller has read the store and missed while the
			// leader's mint is still held at the gate.
			yield* app.entered.await;
			yield* yieldUntil(Effect.map(Ref.get(store.gets), (n) => n === N));
			assert.strictEqual(yield* Ref.get(app.minted), 1, "one mint entered while all N calls were pending");
			yield* Latch.open(app.gate);
			const results = yield* Fiber.join(fiber);
			assert.lengthOf(results, N);
			assert.strictEqual(yield* Ref.get(app.minted), 1, "the gate opened one mint, not N");
			assert.deepStrictEqual(results.map((result) => result.source).sort(), ["joined", "joined", "joined", "minted"]);
			for (const result of results) assert.strictEqual(Redacted.value(result.token.token), "ghs_1");
			assert.strictEqual(yield* Ref.get(store.sets), 1, "one write for one mint");
		}),
	);

	it.effect("fails every waiter with the leader's error and releases the key for the next call", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const failure = GitHubAppError.of("token", "GitHub said no");
			const app = yield* gatedApp(Effect.fail(failure));
			const store = yield* coldStore();
			const layers = Layer.mergeAll(app.layer, store.layer);
			const fiber = yield* Effect.forkChild(
				Effect.all(
					Array.from({ length: N }, () => Effect.flip(Effect.provide(GitHubApp.cachedToken(REQUEST), layers))),
					{ concurrency: "unbounded" },
				),
			);
			yield* app.entered.await;
			yield* yieldUntil(Effect.map(Ref.get(store.gets), (n) => n === N));
			yield* Latch.open(app.gate);
			const errors = yield* Fiber.join(fiber);
			assert.lengthOf(errors, N);
			for (const error of errors) {
				assert.strictEqual(error, failure, "every waiter sees the leader's error, the same value");
			}
			assert.strictEqual(yield* Ref.get(app.minted), 1);
			// The key was released: a later call mints again (and fails again, the
			// double is scripted to), rather than joining a settled flight.
			const again = yield* Effect.flip(Effect.provide(GitHubApp.cachedToken(REQUEST), layers));
			assert.strictEqual(again, failure);
			assert.strictEqual(yield* Ref.get(app.minted), 2, "the second round minted");
			assert.strictEqual(yield* Ref.get(store.sets), 0, "a failed mint writes nothing");
		}),
	);

	it.effect("keeps flights per installation: two installations mint twice", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const minted = yield* Ref.make(0);
			const gate = yield* Latch.make(false);
			const app = GitHubApp.layerTest({
				token: (request) =>
					Effect.gen(function* () {
						yield* Ref.update(minted, (n) => n + 1);
						yield* gate.await;
						return yield* freshToken(`ghs_${request.installationId}`, request.installationId);
					}),
			});
			const store = yield* coldStore();
			const layers = Layer.mergeAll(app, store.layer);
			const requests = [REQUEST, REQUEST, { ...REQUEST, installationId: 43 }, { ...REQUEST, installationId: 43 }];
			const fiber = yield* Effect.forkChild(
				Effect.provide(
					Effect.all(
						requests.map((request) => GitHubApp.cachedToken(request)),
						{ concurrency: "unbounded" },
					),
					layers,
				),
			);
			yield* yieldUntil(Effect.map(Ref.get(store.gets), (n) => n === requests.length));
			// Both flights are forked detached, so they enter a tick after the misses.
			yield* yieldUntil(Effect.map(Ref.get(minted), (n) => n === 2));
			assert.strictEqual(yield* Ref.get(minted), 2, "one flight per installation while all four are pending");
			yield* Latch.open(gate);
			const results = yield* Fiber.join(fiber);
			assert.deepStrictEqual(
				results.map((result) => [result.token.installationId, result.source]),
				[
					[42, "minted"],
					[42, "joined"],
					[43, "minted"],
					[43, "joined"],
				],
			);
			assert.strictEqual(Redacted.value(results[1]?.token.token ?? Redacted.make("")), "ghs_42");
			assert.strictEqual(Redacted.value(results[3]?.token.token ?? Redacted.make("")), "ghs_43");
		}),
	);

	it.effect("interrupting the leader does not strand the waiters: the mint completes for them", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const app = yield* gatedApp(freshToken("ghs_1"));
			const store = yield* coldStore();
			const layers = Layer.mergeAll(app.layer, store.layer);
			const leader = yield* Effect.forkChild(Effect.provide(GitHubApp.cachedToken(REQUEST), layers));
			yield* app.entered.await;
			const waiters = yield* Effect.forkChild(
				Effect.all(
					Array.from({ length: N - 1 }, () => Effect.provide(GitHubApp.cachedToken(REQUEST), layers)),
					{ concurrency: "unbounded" },
				),
			);
			yield* yieldUntil(Effect.map(Ref.get(store.gets), (n) => n === N));
			yield* Fiber.interrupt(leader);
			const leaderExit = yield* Fiber.await(leader);
			assert.isTrue(
				Exit.isFailure(leaderExit) && Cause.hasInterruptsOnly(leaderExit.cause),
				"the leader is interrupted",
			);
			yield* Latch.open(app.gate);
			const results = yield* Fiber.join(waiters);
			assert.lengthOf(results, N - 1);
			for (const result of results) {
				assert.strictEqual(result.source, "joined");
				assert.strictEqual(Redacted.value(result.token.token), "ghs_1");
			}
			assert.strictEqual(yield* Ref.get(app.minted), 1, "the waiters did not have to re-mint");
			assert.strictEqual(yield* Ref.get(store.sets), 1, "the detached mint still wrote the store");
		}),
	);

	it.effect("a leader interrupted as its store miss resolves leaves no key behind: the next miss still mints", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const app = yield* gatedApp(freshToken("ghs_1"));
			// A store whose miss interrupts the leader on the way back, so the interrupt is
			// pending exactly when the leader would register its key and fork the mint.
			const leaderRef = yield* Ref.make(Option.none<Fiber.Fiber<unknown, unknown>>());
			const gets = yield* Ref.make(0);
			const store = Layer.succeed(InstallationTokenStore, {
				get: () =>
					Effect.gen(function* () {
						const n = yield* Ref.updateAndGet(gets, (count) => count + 1);
						if (n === 1) {
							const leader = yield* Ref.get(leaderRef);
							if (Option.isSome(leader)) yield* Effect.forkDetach(Fiber.interrupt(leader.value));
						}
						return Option.none<string>();
					}),
				set: () => Effect.void,
			});
			const layers = Layer.mergeAll(app.layer, store);
			const leader = yield* Effect.forkChild(Effect.provide(GitHubApp.cachedToken(REQUEST), layers));
			yield* Ref.set(leaderRef, Option.some(leader));
			const leaderExit = yield* Fiber.await(leader);
			assert.isTrue(
				Exit.isFailure(leaderExit) && Cause.hasInterruptsOnly(leaderExit.cause),
				"the leader is interrupted",
			);
			// Whether the leader died before or after registering, nothing may be left
			// in flight without a mint behind it: a fresh miss must complete. The runtime
			// processes this interrupt before the generator resumes, so the set-then-fork
			// gap itself is not reached here; the gap is closed by the uninterruptible
			// step in makeCachedToken, and this pins the invariant that step protects.
			yield* Latch.open(app.gate);
			const next = yield* Effect.provide(GitHubApp.cachedToken(REQUEST), layers).pipe(
				Effect.timeoutOption(Duration.seconds(5)),
			);
			assert.isTrue(Option.isSome(next), "the next miss hung on a stranded key");
			if (Option.isSome(next)) assert.strictEqual(Redacted.value(next.value.token.token), "ghs_1");
			assert.isAtLeast(yield* Ref.get(app.minted), 1);
		}),
	);

	it.effect("a stubbed cachedToken on the double is honoured", () =>
		Effect.gen(function* () {
			const token = yield* freshToken("ghs_stub");
			const result = yield* Effect.provide(
				GitHubApp.cachedToken(REQUEST),
				Layer.mergeAll(
					GitHubApp.layerTest({ cachedToken: () => Effect.succeed({ token, source: "cached" }) }),
					InstallationTokenStore.layerTest(),
				),
			);
			assert.strictEqual(result.source, "cached");
			assert.strictEqual(Redacted.value(result.token.token), "ghs_stub");
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
