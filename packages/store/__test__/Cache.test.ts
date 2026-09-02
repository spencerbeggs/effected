import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { afterAll, assert, describe, it, layer } from "@effect/vitest";
import { Cause, Duration, Effect, Exit, Layer, Option, PubSub, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlError from "effect/unstable/sql/SqlError";
import type { CacheEvent } from "../src/index.js";
import { Cache, CacheError, Uint8ArrayFromUtf8 } from "../src/index.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const drainTags = (events: ReadonlyArray<CacheEvent>): ReadonlyArray<string> => events.map((event) => event.event._tag);

describe("Cache", () => {
	layer(Cache.layerTest())((it) => {
		it.effect("set and get round-trip a BLOB with tags and content type", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				const value = new Uint8Array(256).map((_, index) => index);
				yield* cache.set({ key: "blob", value, contentType: "application/x-bytes", tags: ["a", "b"] });
				const entry = yield* cache.get("blob");
				assert.isTrue(Option.isSome(entry));
				if (Option.isSome(entry)) {
					assert.strictEqual(entry.value.key, "blob");
					assert.deepStrictEqual(Array.from(entry.value.value), Array.from(value));
					assert.strictEqual(entry.value.contentType, "application/x-bytes");
					assert.deepStrictEqual([...entry.value.tags], ["a", "b"]);
					assert.strictEqual(entry.value.sizeBytes, 256);
					assert.strictEqual(entry.value.expiresAt, undefined);
				}
			}),
		);

		it.effect("get on an absent key is a miss", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				assert.isTrue(Option.isNone(yield* cache.get("absent")));
				assert.isFalse(yield* cache.has("absent"));
			}),
		);

		it.effect("a __proto__ key is ordinary data and pollutes nothing", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.set({ key: "__proto__", value: bytes("evil") });
				assert.isTrue(yield* cache.has("__proto__"));
				assert.strictEqual(({} as Record<string, unknown>).polluted, undefined);
				yield* cache.invalidate("__proto__");
			}),
		);

		it.effect("entries lists metadata without values", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.invalidateAll();
				yield* cache.set({ key: "m1", value: bytes("one"), tags: ["t"] });
				yield* cache.set({ key: "m2", value: bytes("two"), ttl: Duration.hours(1) });
				const metas = yield* cache.entries;
				const byKey = new Map(metas.map((meta) => [meta.key, meta]));
				assert.lengthOf(metas, 2);
				assert.deepStrictEqual([...(byKey.get("m1")?.tags ?? [])], ["t"]);
				assert.strictEqual(byKey.get("m1")?.sizeBytes, 3);
				assert.strictEqual(byKey.get("m1")?.expiresAt, undefined);
				assert.isTrue(byKey.get("m2")?.expiresAt !== undefined);
				assert.isFalse("value" in (byKey.get("m1") ?? {}));
				yield* cache.invalidateAll();
			}),
		);

		it.effect("ttl expiry is driven by the clock: live before, expired at the bound", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.set({ key: "ephemeral", value: bytes("x"), ttl: Duration.seconds(10) });
				assert.isTrue(Option.isSome(yield* cache.get("ephemeral")));
				yield* TestClock.adjust(Duration.seconds(10));
				assert.isTrue(Option.isNone(yield* cache.get("ephemeral")));
				// The expired row was deleted on read, not merely hidden.
				const metas = yield* cache.entries;
				assert.isFalse(metas.some((meta) => meta.key === "ephemeral"));
			}),
		);

		it.effect("has deletes an expired entry on read", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.set({ key: "hastest", value: bytes("x"), ttl: Duration.seconds(1) });
				assert.isTrue(yield* cache.has("hastest"));
				yield* TestClock.adjust(Duration.seconds(2));
				assert.isFalse(yield* cache.has("hastest"));
				const metas = yield* cache.entries;
				assert.isFalse(metas.some((meta) => meta.key === "hastest"));
			}),
		);

		it.effect("prune removes only expired entries and reports which", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.invalidateAll();
				yield* cache.set({ key: "stays", value: bytes("x") });
				yield* cache.set({ key: "short", value: bytes("x"), ttl: Duration.seconds(5) });
				yield* cache.set({ key: "long", value: bytes("x"), ttl: Duration.hours(1) });
				yield* TestClock.adjust(Duration.seconds(5));
				const result = yield* cache.prune();
				assert.deepStrictEqual(result, { count: 1, keys: ["short"] });
				assert.isTrue(yield* cache.has("stays"));
				assert.isTrue(yield* cache.has("long"));
				yield* cache.invalidateAll();
			}),
		);

		it.effect("invalidateByTag removes exactly the tagged entries", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.set({ key: "a", value: bytes("x"), tags: ["group1"] });
				yield* cache.set({ key: "b", value: bytes("x"), tags: ["group1", "group2"] });
				yield* cache.set({ key: "c", value: bytes("x"), tags: ["group2"] });
				const result = yield* cache.invalidateByTag("group1");
				assert.strictEqual(result.count, 2);
				assert.includeMembers([...result.keys], ["a", "b"]);
				assert.isFalse(yield* cache.has("a"));
				assert.isFalse(yield* cache.has("b"));
				assert.isTrue(yield* cache.has("c"));
				yield* cache.invalidateAll();
			}),
		);

		it.effect("a tag that is a substring of another tag matches nothing", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.set({ key: "sub", value: bytes("x"), tags: ["group1"] });
				const result = yield* cache.invalidateByTag("group");
				assert.strictEqual(result.count, 0);
				assert.isTrue(yield* cache.has("sub"));
				yield* cache.invalidateAll();
			}),
		);

		it.effect("hostile LIKE metacharacters in a tag match literally", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.set({ key: "meta", value: bytes("x"), tags: ["100%_\\done"] });
				yield* cache.set({ key: "decoy", value: bytes("x"), tags: ["100XY\\done"] });
				const result = yield* cache.invalidateByTag("100%_\\done");
				assert.deepStrictEqual(result, { count: 1, keys: ["meta"] });
				assert.isTrue(yield* cache.has("decoy"));
				yield* cache.invalidateAll();
			}),
		);

		it.effect("invalidate skips onRemoved for an absent key", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				const called = yield* Ref.make(false);
				yield* cache.invalidate("never-set", () => Ref.set(called, true));
				assert.isFalse(yield* Ref.get(called));
			}),
		);

		it.effect("a failing onRemoved rolls back the delete and preserves the caller's error type", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.set({ key: "kept", value: bytes("x") });
				const error = yield* Effect.flip(cache.invalidate("kept", () => Effect.fail("cleanup-failed" as const)));
				assert.strictEqual(error, "cleanup-failed");
				// The delete rolled back: the entry is still there.
				assert.isTrue(yield* cache.has("kept"));
				yield* cache.invalidate("kept");
			}),
		);

		it.effect("a throwing onRemoved stays a defect and still rolls back", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.set({ key: "boom", value: bytes("x") });
				const exit = yield* Effect.exit(
					cache.invalidate("boom", () =>
						Effect.sync(() => {
							throw new Error("programmer bug");
						}),
					),
				);
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					assert.isFalse(exit.cause.reasons.some(Cause.isFailReason));
					const die = exit.cause.reasons.find(Cause.isDieReason);
					assert.instanceOf(die?.defect, Error);
					assert.notInstanceOf(die?.defect, CacheError);
				}
				assert.isTrue(yield* cache.has("boom"));
				yield* cache.invalidate("boom");
			}),
		);

		it.effect("invalidateAll runs onRemoved inside the transaction with the result", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.invalidateAll();
				yield* cache.set({ key: "x1", value: bytes("x") });
				yield* cache.set({ key: "x2", value: bytes("x") });
				const seen = yield* Ref.make(0);
				const result = yield* cache.invalidateAll((r) => Ref.set(seen, r.count));
				assert.strictEqual(result.count, 2);
				assert.strictEqual(yield* Ref.get(seen), 2);
			}),
		);

		it.effect("events narrate set, hit, miss, expiry and invalidation", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				const subscription = yield* PubSub.subscribe(cache.events);
				yield* cache.set({ key: "evented", value: bytes("x"), ttl: Duration.seconds(1) });
				yield* cache.get("evented");
				yield* cache.get("missing");
				yield* TestClock.adjust(Duration.seconds(1));
				yield* cache.get("evented"); // expired on read
				const events = yield* PubSub.takeUpTo(subscription, Number.MAX_SAFE_INTEGER);
				assert.deepStrictEqual(drainTags(events), ["Set", "Hit", "Miss", "Expired", "Miss"]);
			}).pipe(Effect.scoped),
		);

		it.effect("a failing onRemoved suppresses the Invalidated event", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				yield* cache.set({ key: "silent", value: bytes("x") });
				const subscription = yield* PubSub.subscribe(cache.events);
				yield* Effect.flip(cache.invalidate("silent", () => Effect.fail("no")));
				yield* cache.invalidate("silent");
				const events = yield* PubSub.takeUpTo(subscription, Number.MAX_SAFE_INTEGER);
				// Only the SECOND (successful) invalidate emitted.
				assert.deepStrictEqual(drainTags(events), ["Invalidated"]);
			}).pipe(Effect.scoped),
		);

		it.effect("invalidating an absent key emits no event", () =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				const subscription = yield* PubSub.subscribe(cache.events);
				yield* cache.invalidate("ghost");
				const events = yield* PubSub.takeUpTo(subscription, Number.MAX_SAFE_INTEGER);
				assert.lengthOf(events, 0);
			}).pipe(Effect.scoped),
		);
	});

	describe("defaultTtl", () => {
		layer(Cache.layerTest({ defaultTtl: Duration.seconds(30) }))((it) => {
			it.effect("applies when set passes no ttl, and an explicit ttl overrides it", () =>
				Effect.gen(function* () {
					const cache = yield* Cache;
					yield* cache.set({ key: "defaulted", value: bytes("x") });
					yield* cache.set({ key: "overridden", value: bytes("x"), ttl: Duration.hours(2) });
					yield* TestClock.adjust(Duration.seconds(30));
					assert.isFalse(yield* cache.has("defaulted"));
					assert.isTrue(yield* cache.has("overridden"));
				}),
			);
		});
	});

	describe("maxEntries eviction", () => {
		layer(Cache.layerTest({ maxEntries: 2 }))((it) => {
			it.effect("evicts the oldest-written entries and says which", () =>
				Effect.gen(function* () {
					const cache = yield* Cache;
					const subscription = yield* PubSub.subscribe(cache.events);
					yield* cache.set({ key: "first", value: bytes("1") });
					yield* cache.set({ key: "second", value: bytes("2") });
					// Overwriting refreshes write order: "first" becomes newest.
					yield* cache.set({ key: "first", value: bytes("1b") });
					// The third distinct key evicts the oldest-WRITTEN entry: "second".
					yield* cache.set({ key: "third", value: bytes("3") });
					assert.isTrue(yield* cache.has("first"));
					assert.isFalse(yield* cache.has("second"));
					assert.isTrue(yield* cache.has("third"));
					const events = yield* PubSub.takeUpTo(subscription, Number.MAX_SAFE_INTEGER);
					const evicted = events.filter((event) => event.event._tag === "Evicted");
					assert.lengthOf(evicted, 1);
					assert.deepStrictEqual(evicted[0]?.event, { _tag: "Evicted", count: 1, keys: ["second"] });
				}).pipe(Effect.scoped),
			);
		});

		it.effect("a non-positive-integer maxEntries dies at construction", () =>
			Effect.gen(function* () {
				for (const bad of [0, -1, 2.5, Number.NaN]) {
					const badLayer = Cache.layerTest({ maxEntries: bad });
					const exit = yield* Effect.exit(
						Effect.provide(
							Effect.gen(function* () {
								return yield* Cache;
							}),
							badLayer,
						),
					);
					assert.isTrue(Exit.isFailure(exit), `maxEntries ${bad} should die`);
					if (Exit.isFailure(exit)) {
						assert.isFalse(exit.cause.reasons.some(Cause.isFailReason), `maxEntries ${bad} must not be typed`);
						assert.isTrue(exit.cause.reasons.some(Cause.isDieReason), `maxEntries ${bad} should be a defect`);
					}
				}
			}),
		);
	});

	describe("error wrapping", () => {
		// provideMerge keeps the SqlClient visible so the test can sabotage the
		// schema through the same connection the cache uses.
		layer(Layer.provideMerge(Cache.layer(), SqliteClient.layer({ filename: ":memory:" })))((it) => {
			it.effect("a hostile SQL-ish tag is inert data", () =>
				Effect.gen(function* () {
					const cache = yield* Cache;
					yield* cache.set({ key: "pre", value: bytes("x") });
					const result = yield* cache.invalidateByTag('"); DROP TABLE cache_entries; --');
					assert.strictEqual(result.count, 0);
					assert.isTrue(yield* cache.has("pre"));
				}),
			);

			it.effect("a SQL failure surfaces as CacheError with the structural cause", () =>
				Effect.gen(function* () {
					const cache = yield* Cache;
					const sql = yield* SqlClient.SqlClient;
					yield* sql`DROP TABLE cache_entries`;
					const error = yield* Effect.flip(cache.get("anything"));
					assert.instanceOf(error, CacheError);
					assert.strictEqual(error._tag, "CacheError");
					assert.strictEqual(error.operation, "get");
					assert.strictEqual(error.key, "anything");
					assert.isTrue(SqlError.isSqlError(error.cause));
				}),
			);
		});
	});
	describe("read-through", () => {
		const Payload = Schema.fromJsonString(Schema.Struct({ owner: Schema.String }));

		layer(Cache.layerTest())((it) => {
			it.effect("a miss runs onMiss, stores the value, and the next call hits without running it again", () =>
				Effect.gen(function* () {
					const runs = yield* Ref.make(0);
					const onMiss = Effect.as(
						Ref.update(runs, (n) => n + 1),
						{ owner: "fetched" },
					);

					const first = yield* Cache.throughVerbose("k", Payload, { tags: ["t"] })(onMiss);
					assert.isFalse(first.hit);
					assert.strictEqual(first.value.owner, "fetched");

					const second = yield* Cache.throughVerbose("k", Payload)(onMiss);
					assert.isTrue(second.hit);
					assert.strictEqual(second.value.owner, "fetched");
					// The decisive assertion: onMiss ran once, not twice.
					assert.strictEqual(yield* Ref.get(runs), 1);
				}),
			);

			it.effect("a hit does not run onMiss at all, proven by a dying miss path", () =>
				Effect.gen(function* () {
					yield* Cache.through("dying", Payload)(Effect.succeed({ owner: "seeded" }));
					const value = yield* Cache.through("dying", Payload)(Effect.die("onMiss must not run"));
					assert.strictEqual(value.owner, "seeded");
				}),
			);

			it.effect("an entry that cannot be decoded is a miss, not a failure, and is overwritten", () =>
				Effect.gen(function* () {
					const cache = yield* Cache;
					// The shape an older build might have written.
					yield* cache.set({ key: "stale", value: bytes('{"totallyDifferent":1}') });

					const result = yield* Cache.throughVerbose("stale", Payload)(Effect.succeed({ owner: "fresh" }));
					assert.isFalse(result.hit, "a decode failure reports as a miss");
					assert.strictEqual(result.value.owner, "fresh");

					// The stale bytes were replaced, so the next read is a clean hit.
					const after = yield* Cache.throughVerbose("stale", Payload)(Effect.die("must not refetch"));
					assert.isTrue(after.hit);
				}),
			);

			it.effect("bytes that are not valid UTF-8 are a miss, not a defect", () =>
				Effect.gen(function* () {
					const cache = yield* Cache;
					yield* cache.set({ key: "binary", value: new Uint8Array([0xff, 0xfe, 0xfd]) });
					const result = yield* Cache.throughVerbose("binary", Payload)(Effect.succeed({ owner: "fresh" }));
					assert.isFalse(result.hit);
					assert.strictEqual(result.value.owner, "fresh");
				}),
			);

			it.effect("onMiss's own error passes through unwrapped", () =>
				Effect.gen(function* () {
					class Boom extends Schema.TaggedError<Boom>()("Boom", {}) {}
					const error = yield* Effect.flip(Cache.through("err", Payload)(Effect.fail(new Boom())));
					assert.strictEqual(error._tag, "Boom");
				}),
			);

			it.effect("a stored entry expires, and the next read-through refetches", () =>
				Effect.gen(function* () {
					const runs = yield* Ref.make(0);
					const onMiss = Effect.as(
						Ref.update(runs, (n) => n + 1),
						{ owner: "v" },
					);
					yield* Cache.through("ttl", Payload, { ttl: Duration.seconds(10) })(onMiss);
					yield* TestClock.adjust(Duration.seconds(11));
					const again = yield* Cache.throughVerbose("ttl", Payload)(onMiss);
					assert.isFalse(again.hit);
					assert.strictEqual(yield* Ref.get(runs), 2);
				}),
			);
		});

		// SqlClient has to be in scope to break the table underneath the cache.
		layer(Layer.provideMerge(Cache.layer(), SqliteClient.layer({ filename: ":memory:" })))((it) => {
			it.effect("a broken cache surfaces CacheError rather than silently falling through", () =>
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient;
					yield* sql`DROP TABLE cache_entries`;
					const error = yield* Effect.flip(Cache.through("k", Payload)(Effect.succeed({ owner: "x" })));
					assert.instanceOf(error, CacheError);
				}),
			);
		});
	});

	describe("Uint8ArrayFromUtf8", () => {
		it.effect("round-trips text through bytes", () =>
			Effect.gen(function* () {
				const encoded = yield* Schema.encodeEffect(Uint8ArrayFromUtf8)(bytes("héllo ✓"));
				assert.strictEqual(encoded, "héllo ✓");
				const decoded = yield* Schema.decodeUnknownEffect(Uint8ArrayFromUtf8)("héllo ✓");
				assert.deepStrictEqual(Array.from(decoded), Array.from(bytes("héllo ✓")));
			}),
		);

		it.effect("fails on malformed UTF-8 rather than substituting replacement characters", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Schema.encodeEffect(Uint8ArrayFromUtf8)(new Uint8Array([0xff, 0xfe])));
				assert.include(String(error), "UTF-8");
			}),
		);
	});

	describe("sqlite driver options", () => {
		const dir = mkdtempSync(join(tmpdir(), "effected-cache-sqlite-options-"));
		afterAll(() => {
			rmSync(dir, { recursive: true, force: true });
		});

		it.effect("client passthrough reaches the driver: disableWAL leaves no WAL file", () =>
			Effect.gen(function* () {
				// The WAL file only exists while the database is open, so the
				// probe runs inside the provided program, not after it.
				const walExistsAfterSet = (filename: string, client?: { readonly disableWAL?: boolean }) =>
					Effect.provide(
						Effect.gen(function* () {
							const cache = yield* Cache;
							yield* cache.set({ key: "k", value: bytes("v") });
							return existsSync(`${filename}-wal`);
						}),
						Cache.layerSqlite({ filename, ...(client !== undefined ? { client } : {}) }),
					);
				assert.isTrue(yield* walExistsAfterSet(join(dir, "wal-default.db")));
				assert.isFalse(yield* walExistsAfterSet(join(dir, "wal-disabled.db"), { disableWAL: true }));
			}),
		);

		// The `Omit` on `client` binds only TypeScript callers; a JavaScript (or
		// any-typed) caller can still pass the name transforms, which rewrite the
		// cache's own snake_case result names (`expires_at`, `size_bytes`, …) and
		// break `get`. The layer must strip them at runtime; this fails if either
		// transform leaks through to the driver.
		it.effect("name-transform client options are stripped at runtime", () =>
			Effect.gen(function* () {
				const camelize = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
				const cacheLayer = Cache.layerSqlite({
					filename: join(dir, "transforms-stripped.db"),
					client: { transformResultNames: camelize, transformQueryNames: camelize } as never,
				});
				const entry = yield* Effect.provide(
					Effect.gen(function* () {
						const cache = yield* Cache;
						yield* cache.set({ key: "k", value: bytes("v") });
						return yield* cache.get("k");
					}),
					cacheLayer,
				);
				assert.isTrue(Option.isSome(entry));
				if (Option.isSome(entry)) {
					assert.deepStrictEqual(Array.from(entry.value.value), Array.from(bytes("v")));
					assert.strictEqual(entry.value.sizeBytes, 1);
				}
			}),
		);

		// The ordering mechanism (finalizer before the driver's close) is shared
		// with Store via internal/sqlite.ts, where the Store suite carries the
		// no-checkpoint control; this pins the Cache wiring end to end.
		it.effect("checkpointOnClose truncates the WAL before the client closes", () =>
			Effect.gen(function* () {
				const filename = join(dir, "checkpointed.db");
				let second: DatabaseSync | undefined;
				// The WAL is read before `second` closes — closing the last connection
				// would itself checkpoint — and `ensuring` closes `second` on every
				// exit path, including a failure inside the provided effect.
				const walSize = yield* Effect.provide(
					Effect.gen(function* () {
						const cache = yield* Cache;
						yield* cache.set({ key: "k", value: bytes("v") });
						second = new DatabaseSync(filename);
						second.prepare("SELECT count(*) AS n FROM cache_entries").get();
					}),
					Cache.layerSqlite({ filename, checkpointOnClose: true }),
				).pipe(
					Effect.flatMap(() => Effect.sync(() => statSync(`${filename}-wal`).size)),
					Effect.ensuring(Effect.sync(() => second?.close())),
				);
				assert.strictEqual(walSize, 0);
			}),
		);
	});
});

describe("Cache.degrading", () => {
	// The case the combinator exists for, and the one a failure-only catch
	// misses: SqliteClient reports a filename whose parent directory does not
	// exist as a DEFECT, not a typed failure.
	const unopenable = Cache.layerSqlite({ filename: join(tmpdir(), "effected-store-no-such-dir-xyz", "cache.db") });

	it.effect("substitutes a working cache when construction fails as a defect", () =>
		Effect.gen(function* () {
			const cache = yield* Cache;
			assert.isTrue(cache.degraded);

			// Reads miss, writes are discarded, and nothing fails.
			yield* cache.set({ key: "k", value: bytes("v") });
			assert.isTrue(Option.isNone(yield* cache.get("k")));
			assert.isFalse(yield* cache.has("k"));
			assert.deepStrictEqual(yield* cache.entries, []);
		}).pipe(Effect.provide(Cache.degrading(unopenable))),
	);

	it.effect("reports nothing removed rather than failing on every removal form", () =>
		Effect.gen(function* () {
			const cache = yield* Cache;
			yield* cache.invalidate("k");
			assert.deepStrictEqual(yield* cache.invalidateByTag("t"), { count: 0, keys: [] });
			assert.deepStrictEqual(yield* cache.invalidateAll(), { count: 0, keys: [] });
			assert.deepStrictEqual(yield* cache.prune(), { count: 0, keys: [] });
		}).pipe(Effect.provide(Cache.degrading(unopenable))),
	);

	it.effect("leaves a working cache untouched and reports degraded false", () =>
		Effect.gen(function* () {
			const cache = yield* Cache;
			assert.isFalse(cache.degraded);
			yield* cache.set({ key: "k", value: bytes("v") });
			const entry = yield* cache.get("k");
			assert.isTrue(Option.isSome(entry));
		}).pipe(Effect.provide(Cache.degrading(Cache.layerTest()))),
	);

	// Interruption is the caller shutting down, not a broken cache. A
	// hand-written Layer.catchCause swallows it and hands back a working cache
	// for a fiber that was meant to stop — the half this combinator exists to
	// get right.
	it.effect("propagates interruption instead of degrading", () =>
		Effect.gen(function* () {
			const interrupted: Layer.Layer<Cache> = Layer.effect(Cache, Effect.interrupt);
			const exit = yield* Effect.exit(Effect.provide(Effect.succeed("unreachable"), Cache.degrading(interrupted)));
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause));
		}),
	);

	// Re-raising with Effect.interrupt would report THIS fiber as the
	// interruptor and lose the one that actually cancelled the work. Layer has
	// no failCause on this release line, so the cause is rebuilt by hand from
	// the original's interruptors; this pins that it survives.
	it.effect("preserves the interrupting fiber rather than minting a fresh interrupt", () =>
		Effect.gen(function* () {
			const interruptedBy = 4242;
			const interrupted: Layer.Layer<Cache> = Layer.effectContext(Effect.failCause(Cause.interrupt(interruptedBy)));
			const exit = yield* Effect.exit(Effect.provide(Effect.void, Cache.degrading(interrupted)));
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) assert.isTrue(Cause.interruptors(exit.cause).has(interruptedBy));
		}),
	);

	it.effect("degrades on a typed failure as well as a defect", () =>
		Effect.gen(function* () {
			const cache = yield* Cache;
			assert.isTrue(cache.degraded);
		}).pipe(
			Effect.provide(
				Cache.degrading(Layer.effect(Cache, Effect.fail(new CacheError({ operation: "setup", cause: "boom" })))),
			),
		),
	);
});
