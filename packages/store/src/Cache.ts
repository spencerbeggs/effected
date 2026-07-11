import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import type { Duration } from "effect";
import { Context, DateTime, Effect, Layer, Option, PubSub, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlError from "effect/unstable/sql/SqlError";
import type { MigratorMigration } from "./internal/migrator.js";
import { ensureLedger, runPending } from "./internal/migrator.js";

/**
 * A stored cache entry: its key, value and bookkeeping fields.
 *
 * @public
 */
export class CacheEntry extends Schema.Class<CacheEntry>("CacheEntry")({
	/** The entry's key. */
	key: Schema.String,
	/** The stored bytes. */
	value: Schema.Uint8Array,
	/** The value's MIME type; defaults to `application/octet-stream` on `set`. */
	contentType: Schema.String,
	/** The tags the entry carries, for bulk invalidation. */
	tags: Schema.Array(Schema.String),
	/** When the entry was written. */
	created: Schema.DateTimeUtc,
	/** When the entry expires; absent = never. */
	expiresAt: Schema.optionalKey(Schema.DateTimeUtc),
	/** The stored value's size in bytes. */
	sizeBytes: Schema.Number,
}) {}

/**
 * Metadata for a cache entry, without its stored value.
 *
 * @remarks
 * Returned by {@link CacheShape.entries} so listing a cache never loads BLOBs.
 * Unlike v3, the timestamps are structured `DateTime.Utc` values, not raw ISO
 * strings.
 *
 * @public
 */
export interface CacheEntryMeta {
	/** The entry's key. */
	readonly key: string;
	/** The value's MIME type. */
	readonly contentType: string;
	/** The tags the entry carries. */
	readonly tags: ReadonlyArray<string>;
	/** When the entry was written. */
	readonly created: DateTime.Utc;
	/** When the entry expires; absent = never. */
	readonly expiresAt?: DateTime.Utc;
	/** The stored value's size in bytes. */
	readonly sizeBytes: number;
}

/**
 * Result of a bulk cache-removal operation: how many entries were removed and
 * which keys they were.
 *
 * @remarks
 * Returned by {@link CacheShape.invalidateByTag}, {@link CacheShape.invalidateAll}
 * and {@link CacheShape.prune}. v3's `PruneResult` alias is not ported.
 *
 * @public
 */
export interface CacheRemovalResult {
	/** How many entries were removed. */
	readonly count: number;
	/** The removed keys. */
	readonly keys: ReadonlyArray<string>;
}

/**
 * Discriminated union of cache lifecycle events published on
 * {@link CacheShape.events}.
 *
 * @remarks
 * `Evicted` is new in v4: it reports entries removed by the
 * {@link CacheOptions.maxEntries} eviction policy during a `set`.
 *
 * @public
 */
export const CacheEventPayload = Schema.Union([
	/** A `get` found a live entry. */
	Schema.TaggedStruct("Hit", { key: Schema.String }),
	/** A `get` found nothing (or only an expired entry). */
	Schema.TaggedStruct("Miss", { key: Schema.String }),
	/** A `set` wrote an entry. */
	Schema.TaggedStruct("Set", {
		key: Schema.String,
		sizeBytes: Schema.Number,
		tags: Schema.Array(Schema.String),
	}),
	/** A read deleted an entry past its `expiresAt`. */
	Schema.TaggedStruct("Expired", { key: Schema.String }),
	/** A `set` evicted the oldest-written entries to hold `maxEntries`. */
	Schema.TaggedStruct("Evicted", { count: Schema.Number, keys: Schema.Array(Schema.String) }),
	/** An `invalidate` removed an entry. */
	Schema.TaggedStruct("Invalidated", { key: Schema.String }),
	/** An `invalidateByTag` removed every entry carrying a tag. */
	Schema.TaggedStruct("InvalidatedByTag", {
		tag: Schema.String,
		count: Schema.Number,
		keys: Schema.Array(Schema.String),
	}),
	/** An `invalidateAll` emptied the cache. */
	Schema.TaggedStruct("InvalidatedAll", { count: Schema.Number, keys: Schema.Array(Schema.String) }),
	/** A `prune` swept the expired entries. */
	Schema.TaggedStruct("Pruned", { count: Schema.Number, keys: Schema.Array(Schema.String) }),
]);

/**
 * The decoded form of {@link (CacheEventPayload:variable)}: a tagged union a
 * subscriber narrows with `switch (payload._tag)`.
 *
 * @public
 */
export type CacheEventPayload = typeof CacheEventPayload.Type;

/**
 * A published cache event: the payload plus the instant it occurred.
 *
 * @public
 */
export class CacheEvent extends Schema.Class<CacheEvent>("CacheEvent")({
	/** When the event occurred. */
	timestamp: Schema.DateTimeUtc,
	/** What happened. */
	event: CacheEventPayload,
}) {}

/**
 * Raised when a cache operation's SQL fails.
 *
 * @remarks
 * `cause` carries the underlying `SqlError` structurally; v3 flattened it to a
 * `reason` string. Defects — a throwing `onRemoved` callback, a programmer
 * error inside the engine — are NOT laundered into this error; they propagate
 * as defects (the v3 `catchAllDefect` round-trip is deliberately not ported).
 *
 * @public
 */
export class CacheError extends Schema.TaggedErrorClass<CacheError>()("CacheError", {
	/** The cache operation that failed. */
	operation: Schema.Literals([
		"setup",
		"get",
		"set",
		"has",
		"entries",
		"invalidate",
		"invalidateByTag",
		"invalidateAll",
		"prune",
	]),
	/** The cache key involved, when the operation has one. */
	key: Schema.optionalKey(Schema.String),
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		const keyPart = this.key !== undefined ? ` for key "${this.key}"` : "";
		return `Cache ${this.operation} failed${keyPart}`;
	}
}

/**
 * The service shape {@link Cache} provides.
 *
 * @public
 */
export interface CacheShape {
	/**
	 * Look up a live entry.
	 *
	 * @remarks
	 * An entry at or past its `expiresAt` is deleted on read (`Expired` then
	 * `Miss` events) and reported as `Option.none()`.
	 */
	readonly get: (key: string) => Effect.Effect<Option.Option<CacheEntry>, CacheError>;
	/**
	 * Write an entry, replacing any existing value under the same key.
	 *
	 * @remarks
	 * `ttl` overrides the layer's {@link CacheOptions.defaultTtl}; with neither,
	 * the entry never expires. When {@link CacheOptions.maxEntries} is set, the
	 * oldest-written entries are evicted in the same transaction (`Evicted`
	 * event) until the bound holds.
	 */
	readonly set: (params: {
		readonly key: string;
		readonly value: Uint8Array;
		readonly contentType?: string;
		readonly tags?: ReadonlyArray<string>;
		readonly ttl?: Duration.Duration;
	}) => Effect.Effect<void, CacheError>;
	/**
	 * Report whether a live entry exists.
	 *
	 * @remarks
	 * An expired entry is deleted on read (`Expired` event) and reported as
	 * `false`. No `Hit`/`Miss` events — `has` is a presence check, not a
	 * retrieval.
	 */
	readonly has: (key: string) => Effect.Effect<boolean, CacheError>;
	/** List every entry's metadata without loading values. */
	readonly entries: Effect.Effect<ReadonlyArray<CacheEntryMeta>, CacheError>;
	/**
	 * Remove a single entry by key.
	 *
	 * @remarks
	 * When `onRemoved` is supplied it runs inside the same transaction as the
	 * delete, before it commits, and only when an entry was actually removed.
	 * A failing callback rolls the delete back and suppresses the
	 * `Invalidated` event; the callback's error type survives in the channel
	 * (`CacheError | E`). A callback that throws is a programmer bug and stays
	 * a defect.
	 */
	readonly invalidate: <E = never, R = never>(
		key: string,
		onRemoved?: () => Effect.Effect<void, E, R>,
	) => Effect.Effect<void, CacheError | E, R>;
	/**
	 * Remove every entry carrying `tag`.
	 *
	 * @remarks
	 * `onRemoved` runs inside the delete transaction with the
	 * {@link CacheRemovalResult}; a failing callback rolls the delete back and
	 * suppresses the `InvalidatedByTag` event.
	 */
	readonly invalidateByTag: <E = never, R = never>(
		tag: string,
		onRemoved?: (result: CacheRemovalResult) => Effect.Effect<void, E, R>,
	) => Effect.Effect<CacheRemovalResult, CacheError | E, R>;
	/**
	 * Remove every entry in the cache.
	 *
	 * @remarks
	 * `onRemoved` runs inside the delete transaction with the
	 * {@link CacheRemovalResult}; a failing callback rolls the delete back and
	 * suppresses the `InvalidatedAll` event.
	 */
	readonly invalidateAll: <E = never, R = never>(
		onRemoved?: (result: CacheRemovalResult) => Effect.Effect<void, E, R>,
	) => Effect.Effect<CacheRemovalResult, CacheError | E, R>;
	/**
	 * Remove every entry at or past its `expiresAt`.
	 *
	 * @remarks
	 * `onRemoved` runs inside the delete transaction with the
	 * {@link CacheRemovalResult}; a failing callback rolls the delete back and
	 * suppresses the `Pruned` event.
	 */
	readonly prune: <E = never, R = never>(
		onRemoved?: (result: CacheRemovalResult) => Effect.Effect<void, E, R>,
	) => Effect.Effect<CacheRemovalResult, CacheError | E, R>;
	/**
	 * The hub every {@link CacheEvent} is published to.
	 *
	 * @remarks
	 * Unbounded on purpose: a slow subscriber must never backpressure a cache
	 * write. Events are a consumer hook, not the package's telemetry — every
	 * public fallible method is also a named span.
	 */
	readonly events: PubSub.PubSub<CacheEvent>;
}

/**
 * Options for the {@link Cache} layers.
 *
 * @public
 */
export interface CacheOptions {
	/** TTL applied when {@link CacheShape.set} passes none; absent = no expiry. */
	readonly defaultTtl?: Duration.Duration;
	/**
	 * Bound on the entry count, enforced at `set`.
	 *
	 * @remarks
	 * Must be a positive integer — anything else (including `NaN` and
	 * fractions) is developer wiring and dies at layer construction. Eviction
	 * is least-recently-*written*: the oldest-written entries go first,
	 * deterministic and index-free. Not LRU-read.
	 */
	readonly maxEntries?: number;
}

/**
 * Options for {@link Cache.layerSqlite}.
 *
 * @public
 */
export interface CacheSqliteOptions extends CacheOptions {
	/**
	 * The SQLite database file path.
	 *
	 * @remarks
	 * The parent directory must exist — a missing directory is a wiring defect
	 * from the driver, not a typed failure.
	 */
	readonly filename: string;
}

const CACHE_LEDGER_TABLE = "_cache_migrations";

/**
 * The cache's own fixed schema, versioned through the same ledger engine that
 * backs `Store` — "a Store with a fixed schema" made literal. A separate
 * ledger table means a Cache and a Store can share one database file without
 * migration-id collisions.
 */
const cacheMigrations: ReadonlyArray<MigratorMigration> = [
	{
		id: 1,
		name: "create-cache-entries",
		up: (sql) =>
			Effect.gen(function* () {
				yield* sql`
					CREATE TABLE IF NOT EXISTS cache_entries (
						key TEXT PRIMARY KEY,
						value BLOB NOT NULL,
						content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
						tags TEXT NOT NULL DEFAULT '[]',
						created TEXT NOT NULL,
						expires_at TEXT,
						size_bytes INTEGER NOT NULL
					)
				`;
				yield* sql`
					CREATE INDEX IF NOT EXISTS idx_cache_expires
					ON cache_entries (expires_at)
					WHERE expires_at IS NOT NULL
				`;
			}),
	},
];

type CacheOperation = typeof CacheError.fields.operation.Type;

interface CacheRow {
	readonly key: string;
	readonly value: Uint8Array;
	readonly content_type: string;
	readonly tags: string;
	readonly created: string;
	readonly expires_at: string | null;
	readonly size_bytes: number;
}

const cacheError = (operation: CacheOperation, cause: unknown, key?: string): CacheError =>
	new CacheError({ operation, ...(key !== undefined ? { key } : {}), cause });

/** Map the operation's own SQL failures into `CacheError`; defects propagate. */
const wrap =
	(operation: CacheOperation, key?: string) =>
	<A, R>(effect: Effect.Effect<A, SqlError.SqlError, R>): Effect.Effect<A, CacheError, R> =>
		Effect.mapError(effect, (cause) => cacheError(operation, cause, key));

/**
 * Map SQL failures to `CacheError` while leaving any other error in the
 * channel untouched — used by the callback-bearing mutations so a consumer's
 * `onRemoved` error type survives instead of being collapsed.
 */
const mapSqlError =
	(operation: CacheOperation, key?: string) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, CacheError | Exclude<E, SqlError.SqlError>, R> =>
		effect.pipe(
			Effect.catchIf(
				(e): e is Extract<E, SqlError.SqlError> => SqlError.isSqlError(e),
				(e) => Effect.fail(cacheError(operation, e, key)),
			),
			// `Exclude` over an unconstrained generic can't be simplified by the
			// compiler; the runtime above guarantees SqlError is gone.
		) as Effect.Effect<A, CacheError | Exclude<E, SqlError.SqlError>, R>;

/**
 * Tags round-trip through JSON text. A corrupted column degrades to an empty
 * tag list rather than throwing — cache metadata is not worth a defect.
 */
const decodeTags = (raw: string): ReadonlyArray<string> => {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
	} catch {
		return [];
	}
};

const toEntry = (row: CacheRow): CacheEntry =>
	CacheEntry.make({
		key: row.key,
		value: row.value instanceof Uint8Array ? row.value : new Uint8Array(row.value as ArrayBufferLike),
		contentType: row.content_type,
		tags: decodeTags(row.tags),
		created: DateTime.makeUnsafe(row.created),
		...(row.expires_at !== null ? { expiresAt: DateTime.makeUnsafe(row.expires_at) } : {}),
		sizeBytes: row.size_bytes,
	});

const make = (options: CacheOptions): Effect.Effect<CacheShape, CacheError, SqlClient.SqlClient> =>
	Effect.gen(function* () {
		const maxEntries = options.maxEntries;
		if (maxEntries !== undefined && (!Number.isInteger(maxEntries) || maxEntries < 1)) {
			return yield* Effect.die(new Error(`Cache.layer: maxEntries must be a positive integer, received ${maxEntries}`));
		}
		const sql = yield* SqlClient.SqlClient;
		const pubsub = yield* PubSub.unbounded<CacheEvent>();

		yield* ensureLedger(sql, CACHE_LEDGER_TABLE).pipe(Effect.mapError((failure) => cacheError("setup", failure.cause)));
		yield* runPending(sql, CACHE_LEDGER_TABLE, cacheMigrations).pipe(
			Effect.mapError((failure) => cacheError("setup", failure.cause)),
		);

		const emit = (event: CacheEventPayload): Effect.Effect<void> =>
			Effect.gen(function* () {
				const now = yield* DateTime.now;
				yield* PubSub.publish(pubsub, CacheEvent.make({ timestamp: now, event }));
			});

		/** Delete an entry that a read found expired, and say so. */
		const expire = (key: string): Effect.Effect<void, SqlError.SqlError> =>
			Effect.gen(function* () {
				yield* sql`DELETE FROM cache_entries WHERE key = ${key}`;
				yield* emit({ _tag: "Expired", key });
			});

		const isExpired = (expiresAt: string | null, now: DateTime.Utc): boolean =>
			expiresAt !== null && DateTime.isLessThanOrEqualTo(DateTime.makeUnsafe(expiresAt), now);

		const get = Effect.fn("Cache.get")(function* (key: string) {
			return yield* wrap(
				"get",
				key,
			)(
				Effect.gen(function* () {
					const rows = yield* sql<CacheRow>`
						SELECT key, value, content_type, tags, created, expires_at, size_bytes
						FROM cache_entries
						WHERE key = ${key}
					`;
					const row = rows[0];
					if (row === undefined) {
						yield* emit({ _tag: "Miss", key });
						return Option.none<CacheEntry>();
					}
					const now = yield* DateTime.now;
					if (isExpired(row.expires_at, now)) {
						yield* expire(key);
						yield* emit({ _tag: "Miss", key });
						return Option.none<CacheEntry>();
					}
					yield* emit({ _tag: "Hit", key });
					return Option.some(toEntry(row));
				}),
			);
		});

		const set = Effect.fn("Cache.set")(function* (params: {
			readonly key: string;
			readonly value: Uint8Array;
			readonly contentType?: string;
			readonly tags?: ReadonlyArray<string>;
			readonly ttl?: Duration.Duration;
		}) {
			return yield* wrap(
				"set",
				params.key,
			)(
				Effect.gen(function* () {
					const now = yield* DateTime.now;
					const created = DateTime.formatIso(now);
					const contentType = params.contentType ?? "application/octet-stream";
					const tags = params.tags ?? [];
					const sizeBytes = params.value.length;
					const ttl = params.ttl ?? options.defaultTtl;
					const expiresAt = ttl !== undefined ? DateTime.formatIso(DateTime.addDuration(now, ttl)) : null;

					const evicted = yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* sql`
								INSERT OR REPLACE INTO cache_entries
									(key, value, content_type, tags, created, expires_at, size_bytes)
								VALUES
									(${params.key}, ${params.value}, ${contentType}, ${JSON.stringify(tags)}, ${created}, ${expiresAt}, ${sizeBytes})
							`;
							if (maxEntries === undefined) {
								return [] as ReadonlyArray<string>;
							}
							// Least-recently-WRITTEN eviction: INSERT OR REPLACE re-mints the
							// rowid, so ascending rowid is exactly write order.
							const excess = yield* sql<{ key: string }>`
								SELECT key FROM cache_entries
								ORDER BY rowid DESC
								LIMIT -1 OFFSET ${maxEntries}
							`;
							if (excess.length === 0) {
								return [] as ReadonlyArray<string>;
							}
							const keys = excess.map((row) => row.key);
							yield* sql`DELETE FROM cache_entries WHERE ${sql.in("key", keys)}`;
							return keys;
						}),
					);

					yield* emit({ _tag: "Set", key: params.key, sizeBytes, tags });
					if (evicted.length > 0) {
						yield* emit({ _tag: "Evicted", count: evicted.length, keys: evicted });
					}
				}),
			);
		});

		const has = Effect.fn("Cache.has")(function* (key: string) {
			return yield* wrap(
				"has",
				key,
			)(
				Effect.gen(function* () {
					const rows = yield* sql<{ key: string; expires_at: string | null }>`
						SELECT key, expires_at FROM cache_entries WHERE key = ${key}
					`;
					const row = rows[0];
					if (row === undefined) {
						return false;
					}
					const now = yield* DateTime.now;
					if (isExpired(row.expires_at, now)) {
						yield* expire(key);
						return false;
					}
					return true;
				}),
			);
		});

		const entries = Effect.gen(function* () {
			const rows = yield* sql<Omit<CacheRow, "value">>`
				SELECT key, content_type, tags, created, expires_at, size_bytes
				FROM cache_entries
			`;
			return rows.map(
				(row): CacheEntryMeta => ({
					key: row.key,
					contentType: row.content_type,
					tags: decodeTags(row.tags),
					created: DateTime.makeUnsafe(row.created),
					...(row.expires_at !== null ? { expiresAt: DateTime.makeUnsafe(row.expires_at) } : {}),
					sizeBytes: row.size_bytes,
				}),
			);
		}).pipe(wrap("entries"), Effect.withSpan("Cache.entries"));

		const invalidate = <E = never, R = never>(
			key: string,
			onRemoved?: () => Effect.Effect<void, E, R>,
		): Effect.Effect<void, CacheError | E, R> =>
			sql
				.withTransaction(
					Effect.gen(function* () {
						const removed = yield* sql<{ key: string }>`
							DELETE FROM cache_entries WHERE key = ${key} RETURNING key
						`;
						// Only run the cleanup callback when an entry was actually
						// removed, so `invalidate(key, cleanup)` does not fire cleanup
						// for an absent key.
						if (onRemoved !== undefined && removed.length > 0) {
							yield* onRemoved();
						}
						return removed.length > 0;
					}),
				)
				.pipe(
					Effect.tap((removed) => (removed ? emit({ _tag: "Invalidated", key }) : Effect.void)),
					Effect.asVoid,
					mapSqlError("invalidate", key),
					Effect.withSpan("Cache.invalidate"),
				);

		const invalidateByTag = <E = never, R = never>(
			tag: string,
			onRemoved?: (result: CacheRemovalResult) => Effect.Effect<void, E, R>,
		): Effect.Effect<CacheRemovalResult, CacheError | E, R> =>
			sql
				.withTransaction(
					Effect.gen(function* () {
						// The tags column stores JSON text, so match the JSON encoding of
						// the tag (quotes included — they anchor whole-tag matches), with
						// LIKE metacharacters escaped. v3 matched the RAW tag against the
						// JSON column, so a tag containing a backslash or quote never
						// matched its own entry.
						const escaped = JSON.stringify(tag).replace(/[%_\\]/g, "\\$&");
						const pattern = `%${escaped}%`;
						const removed = yield* sql<{ key: string }>`
							DELETE FROM cache_entries WHERE tags LIKE ${pattern} ESCAPE '\\' RETURNING key
						`;
						const keys = removed.map((row) => row.key);
						const result: CacheRemovalResult = { count: keys.length, keys };
						if (onRemoved !== undefined) {
							yield* onRemoved(result);
						}
						return result;
					}),
				)
				.pipe(
					Effect.tap((result) => emit({ _tag: "InvalidatedByTag", tag, count: result.count, keys: result.keys })),
					mapSqlError("invalidateByTag"),
					Effect.withSpan("Cache.invalidateByTag"),
				);

		const invalidateAll = <E = never, R = never>(
			onRemoved?: (result: CacheRemovalResult) => Effect.Effect<void, E, R>,
		): Effect.Effect<CacheRemovalResult, CacheError | E, R> =>
			sql
				.withTransaction(
					Effect.gen(function* () {
						const removed = yield* sql<{ key: string }>`DELETE FROM cache_entries RETURNING key`;
						const keys = removed.map((row) => row.key);
						const result: CacheRemovalResult = { count: keys.length, keys };
						if (onRemoved !== undefined) {
							yield* onRemoved(result);
						}
						return result;
					}),
				)
				.pipe(
					Effect.tap((result) => emit({ _tag: "InvalidatedAll", count: result.count, keys: result.keys })),
					mapSqlError("invalidateAll"),
					Effect.withSpan("Cache.invalidateAll"),
				);

		const prune = <E = never, R = never>(
			onRemoved?: (result: CacheRemovalResult) => Effect.Effect<void, E, R>,
		): Effect.Effect<CacheRemovalResult, CacheError | E, R> =>
			sql
				.withTransaction(
					Effect.gen(function* () {
						const now = yield* DateTime.now;
						const nowIso = DateTime.formatIso(now);
						const removed = yield* sql<{ key: string }>`
							DELETE FROM cache_entries
							WHERE expires_at IS NOT NULL AND expires_at <= ${nowIso}
							RETURNING key
						`;
						const keys = removed.map((row) => row.key);
						const result: CacheRemovalResult = { count: keys.length, keys };
						if (onRemoved !== undefined) {
							yield* onRemoved(result);
						}
						return result;
					}),
				)
				.pipe(
					Effect.tap((result) => emit({ _tag: "Pruned", count: result.count, keys: result.keys })),
					mapSqlError("prune"),
					Effect.withSpan("Cache.prune"),
				);

		return {
			get,
			set,
			has,
			entries,
			invalidate,
			invalidateByTag,
			invalidateAll,
			prune,
			events: pubsub,
		} satisfies CacheShape;
	});

/**
 * A key → `Uint8Array` cache with TTL, tags, an eviction policy and a
 * {@link CacheEvent} PubSub.
 *
 * @remarks
 * Expiry reads the clock through `DateTime.now`, so tests drive it with
 * `TestClock.adjust`. The layer statics are parameterized factories: call each
 * once and bind the result to a `const`, or memoization by reference is lost
 * and the database is opened twice.
 *
 * @example
 * ```ts
 * const CacheLayer = Cache.layerSqlite({ filename: "/tmp/app/cache.db", maxEntries: 1000 });
 * ```
 *
 * @public
 */
export class Cache extends Context.Service<Cache, CacheShape>()("@effected/store/Cache") {
	/**
	 * The driver-agnostic layer: requires an abstract `SqlClient`, so any
	 * Effect SQL driver satisfies it.
	 */
	static layer(options?: CacheOptions): Layer.Layer<Cache, CacheError, SqlClient.SqlClient> {
		return Layer.effect(Cache, make(options ?? {}));
	}

	/** The batteries-included layer over `@effect/sql-sqlite-node`. */
	static layerSqlite(options: CacheSqliteOptions): Layer.Layer<Cache, CacheError> {
		return Layer.provide(Cache.layer(options), SqliteClient.layer({ filename: options.filename }));
	}

	/** An in-memory (`:memory:`) layer for tests. */
	static layerTest(options?: CacheOptions): Layer.Layer<Cache, CacheError> {
		return Cache.layerSqlite({ ...(options ?? {}), filename: ":memory:" });
	}
}
