import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import type { Duration } from "effect";
import { Cause, Context, DateTime, Effect, Layer, Option, PubSub, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlError from "effect/unstable/sql/SqlError";
import { bytesToUtf8, utf8ToBytes } from "./Bytes.js";
import type { MigratorMigration } from "./internal/migrator.js";
import { ensureLedger, runPending } from "./internal/migrator.js";
import { walCheckpointOnClose } from "./internal/sqlite.js";

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
export class CacheError extends Schema.TaggedError<CacheError>()("CacheError", {
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
 * Options for {@link Cache.through} and {@link Cache.throughVerbose}.
 *
 * @public
 */
export interface CacheThroughOptions {
	/** Overrides the layer's `defaultTtl`; with neither, the entry never expires. */
	readonly ttl?: Duration.Duration;
	/** Tags for bulk invalidation through `invalidateByTag`. */
	readonly tags?: ReadonlyArray<string>;
	/** The value's MIME type. Defaults to `application/octet-stream` on write. */
	readonly contentType?: string;
}

/**
 * What {@link Cache.throughVerbose} returns: the value, and where it came from.
 *
 * @public
 */
export interface CacheHit<A> {
	/** The cached or freshly computed value. */
	readonly value: A;
	/** `true` when the value came off the cache without running `onMiss`. */
	readonly hit: boolean;
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
	/**
	 * Whether this is the degrade-to-miss fallback rather than a live cache.
	 *
	 * @remarks
	 * `false` for every real cache; `true` only for the fallback
	 * {@link Cache.degrading} substitutes when construction fails. Without it a
	 * cold cache and a broken one are indistinguishable — every `get` misses
	 * either way — so a consumer that wants to report degradation (or skip work
	 * that is only worth doing when results can be cached) has no way to tell.
	 *
	 * It is a plain field rather than a {@link (CacheEventPayload:variable)}
	 * member because degradation is decided once, at construction, before any
	 * subscriber exists: an event published then would reach nobody, since the
	 * `events` hub does not replay.
	 */
	readonly degraded: boolean;
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
	/**
	 * Remaining driver options, passed through to `SqliteClient.layer`.
	 *
	 * @remarks
	 * `filename` is owned by this layer and cannot be overridden here. The two
	 * name-transform options (`transformResultNames`, `transformQueryNames`)
	 * are deliberately excluded: every cache query is package-internal and
	 * reads snake_case columns, so a name transform silently breaks the whole
	 * surface. Consumers who need one wire their own client under the abstract
	 * {@link Cache.layer}.
	 */
	readonly client?: Omit<SqliteClient.SqliteClientConfig, "filename" | "transformResultNames" | "transformQueryNames">;
	/**
	 * Register a `PRAGMA wal_checkpoint(TRUNCATE)` finalizer that runs before
	 * the driver closes the connection.
	 *
	 * @remarks
	 * Useful when another process may open the database file after this scope
	 * closes: the WAL is folded into the main file eagerly rather than on the
	 * next open. The checkpoint is best-effort — a failure is ignored so a
	 * clean shutdown never turns into a failed one. SQLite-specific by nature,
	 * so the option lives here and not on the driver-agnostic
	 * {@link Cache.layer}; {@link Cache.layerTest} (`:memory:`) has no WAL and
	 * never checkpoints.
	 */
	readonly checkpointOnClose?: boolean;
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
			degraded: false,
		} satisfies CacheShape;
	});

/**
 * The degrade-to-miss fallback {@link Cache.degrading} substitutes when the
 * real cache cannot be constructed: every read misses, every write is
 * discarded, every removal reports nothing removed, and no operation can fail.
 *
 * The construction failure is logged once, at warning level, with the cause
 * attached — a silently degraded cache is a build that gets mysteriously
 * slower with nothing to point at.
 */
/**
 * Re-raise an interrupt without degrading, preserving the interrupting fiber
 * rather than minting a fresh interrupt.
 *
 * `Layer` has no `failCause` on this release line, so the only way to fail a
 * layer is an effect inside one. `Effect.interrupt` would be the obvious
 * spelling and is the wrong one: it reports THIS fiber as the interruptor, so
 * the fiber that actually cancelled the build is lost from the cause. Rebuilding
 * the interrupt from {@link Cause.interruptors} keeps it, and stays
 * `Cause<never>` so the combinator's `never` error channel survives.
 *
 * `interruptors` is a set, and this keeps the first of it: with more than one
 * interrupting fiber the rest are dropped, and an interrupt cause recording no
 * interruptor at all yields `undefined`, which reproduces the same empty
 * attribution the fresh form gives. Preserving the whole set would need a
 * multi-interruptor cause constructor that this release line does not offer.
 */
const propagateInterrupt = <A, E>(cause: Cause.Cause<E>): Layer.Layer<A> => {
	const [interruptor] = Cause.interruptors(cause);
	return Layer.effectContext(Effect.failCause(Cause.interrupt(interruptor)));
};

const makeDegraded = (cause: Cause.Cause<unknown>): Effect.Effect<CacheShape> =>
	Effect.gen(function* () {
		yield* Effect.logWarning("Cache construction failed; degrading to a no-op cache").pipe(
			Effect.annotateLogs({ cause: Cause.pretty(cause) }),
		);
		const pubsub = yield* PubSub.unbounded<CacheEvent>();
		const nothingRemoved: CacheRemovalResult = { count: 0, keys: [] };
		return {
			get: () => Effect.succeedNone,
			set: () => Effect.void,
			has: () => Effect.succeed(false),
			entries: Effect.succeed([]),
			// The `onRemoved` callbacks are deliberately NOT run: they exist to
			// react to entries leaving the cache, and nothing ever entered this
			// one. Running them would report removals that never happened.
			invalidate: () => Effect.void,
			invalidateByTag: () => Effect.succeed(nothingRemoved),
			invalidateAll: () => Effect.succeed(nothingRemoved),
			prune: () => Effect.succeed(nothingRemoved),
			events: pubsub,
			degraded: true,
		} satisfies CacheShape;
	});

/**
 * A key → `Uint8Array` cache with TTL, tags, an eviction policy and a
 * {@link CacheEvent} PubSub.
 *
 * @remarks
 * Expiry reads the clock through `DateTime.now`, so tests drive it with
 * `TestClock.adjust`. **Provide `TestClock.layer()` outside the `Effect.provide`
 * that supplies this cache, not beneath it** — underneath, the test body has no
 * `TestClock` in its own context and `TestClock.adjust` dies as a defect, so
 * nothing you try to expire ever expires. The layer statics are parameterized factories: call each
 * once and bind the result to a `const`, or memoization by reference is lost
 * and the database is opened twice.
 *
 * @example
 * ```ts
 * const CacheLayer = Cache.layerSqlite({ filename: "cache.db", maxEntries: 1000 });
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
		// `filename` last: the layer owns it, whatever the passthrough says. The
		// name transforms are stripped at runtime too — the `Omit` on `client`
		// binds only TypeScript callers, and a leaked transform rewrites the
		// cache's own snake_case result names, silently breaking reads.
		const {
			filename: _filename,
			transformResultNames: _transformResultNames,
			transformQueryNames: _transformQueryNames,
			...passthrough
		} = (options.client ?? {}) as Partial<SqliteClient.SqliteClientConfig>;
		const client = SqliteClient.layer({ ...passthrough, filename: options.filename });
		const cache = Layer.provide(Cache.layer(options), client);
		return options.checkpointOnClose === true
			? Layer.merge(cache, Layer.provide(walCheckpointOnClose(), client))
			: cache;
	}

	/** An in-memory (`:memory:`) layer for tests. */
	static layerTest(options?: CacheOptions): Layer.Layer<Cache, CacheError> {
		return Cache.layerSqlite({ ...(options ?? {}), filename: ":memory:" });
	}

	/**
	 * Wrap any `Cache` layer so that a **construction** failure yields a
	 * working, empty cache instead of failing the layer — reads miss, writes
	 * are discarded, and {@link CacheShape.degraded} reads `true`.
	 *
	 * @remarks
	 * **Opt-in on purpose.** A consumer that wants a cache problem to be fatal,
	 * or that wants the narrower per-operation posture
	 * (`Effect.orElseSucceed(() => Option.none())` on `get`, layer left fatal),
	 * keeps exactly that by not calling this. The plain constructors' typed
	 * error channels are unchanged.
	 *
	 * **Why this exists at layer level.** The same posture written inside each
	 * service method holds only while the layer is built inside those methods.
	 * Hoisting construction to the runtime — an ordinary performance fix, since
	 * building the driver per call is wasteful — moves the failure to runtime
	 * build time, where it aborts the whole program. Nothing about that change
	 * looks like a behavior change, and a test suite that never fails
	 * construction cannot catch it; the only signal is the layer's error
	 * channel widening.
	 *
	 * **It catches failures and defects, and deliberately not interruption.**
	 * Defects matter here specifically: `SqliteClient.layer` reports driver
	 * construction failures — a `filename` whose parent directory does not
	 * exist, the common case — as **defects, not typed failures**, so a
	 * failure-only catch would miss the very case this exists for. Interruption
	 * is not a broken cache: it is the caller shutting down, and swallowing it
	 * would substitute a working cache for a fiber that was meant to stop.
	 * A hand-written `Layer.catchCause` gets the defect half right and this
	 * half wrong.
	 *
	 * The two cases are not disjoint, and interruption wins when they overlap.
	 * A cause carrying **both** — parallel layer construction where one branch
	 * fails and another is interrupted — takes the interrupt path, and the
	 * failure half is not reported. That is the right posture, since a
	 * shutting-down fiber must not be handed a working cache, but it is lossy:
	 * the failure that also occurred is not in the re-raised cause.
	 *
	 * @example
	 * ```ts
	 * import { Cache } from "@effected/store";
	 *
	 * const CacheLayer = Cache.degrading(Cache.layerSqlite({ filename: "cache.db" }));
	 * ```
	 */
	static degrading<E, R>(self: Layer.Layer<Cache, E, R>): Layer.Layer<Cache, never, R> {
		return self.pipe(
			Layer.catchCause((cause) =>
				Cause.hasInterrupts(cause) ? propagateInterrupt(cause) : Layer.effect(Cache, makeDegraded(cause)),
			),
		);
	}

	/**
	 * Read through the cache: return the stored value, or run `onMiss`, store
	 * its result and return that.
	 *
	 * @remarks
	 * `get` → decode → on miss run `onMiss` → encode → `set` is the entire
	 * reason to have a cache, and it was roughly twenty-five lines every
	 * consumer wrote for themselves. `schema` encodes to `string`; the last
	 * step to bytes is {@link Uint8ArrayFromUtf8}, so the encoding decision
	 * lives in one audited place here rather than one per consumer.
	 *
	 * **A stored value that fails to decode is a miss, not a failure.** Those
	 * bytes were written by an older build of the caller's own program: the
	 * user did not cause it, cannot fix it without knowing the cache exists,
	 * and everything in here is re-derivable by definition. Failing would
	 * strand them behind a cache they cannot see. The stale entry is
	 * overwritten by the fresh one on the way out.
	 *
	 * **`CacheError` is surfaced, not swallowed.** A cache is additive and a
	 * caller may reasonably want to push through a broken one — but that is
	 * the caller's call to make, with `Effect.catchTag("CacheError", …)`,
	 * because a database that cannot be read is a real and reportable
	 * condition. This package does not decide it for them by hiding it.
	 *
	 * Use {@link Cache.throughVerbose} when the caller needs to know whether
	 * the value was a hit.
	 *
	 * @example
	 * ```ts
	 * const program = Effect.gen(function* () {
	 *   const members = yield* Cache.through("team:platform", Schema.fromJsonString(Members), {
	 *     ttl: "1 hour",
	 *     tags: ["team"],
	 *   })(fetchMembersFromApi);
	 *   return members;
	 * });
	 * ```
	 */
	static through<A, I extends string>(
		key: string,
		schema: Schema.Codec<A, I>,
		options?: CacheThroughOptions,
	): <E, R>(onMiss: Effect.Effect<A, E, R>) => Effect.Effect<A, E | CacheError, R | Cache> {
		return (onMiss) => Effect.map(Cache.throughVerbose(key, schema, options)(onMiss), (result) => result.value);
	}

	/**
	 * {@link Cache.through}, reporting whether the value came from the cache.
	 *
	 * @remarks
	 * The `CacheEvent` PubSub is the right channel for telemetry and the wrong
	 * one for "annotate this line of output as cached" — a caller should not
	 * have to subscribe to a hub and correlate by key for a fact the
	 * read-through already knew and threw away. A decode miss reports
	 * `hit: false`, because the caller refetched.
	 */
	static throughVerbose<A, I extends string>(
		key: string,
		schema: Schema.Codec<A, I>,
		options?: CacheThroughOptions,
	): <E, R>(onMiss: Effect.Effect<A, E, R>) => Effect.Effect<CacheHit<A>, E | CacheError, R | Cache> {
		return <E, R>(onMiss: Effect.Effect<A, E, R>) =>
			Effect.gen(function* () {
				const cache = yield* Cache;
				const stored = yield* cache.get(key);

				if (Option.isSome(stored)) {
					const text = bytesToUtf8(stored.value.value);
					if (Option.isSome(text)) {
						// A decode failure here is an older build's value, not a fault:
						// fall through to `onMiss` and overwrite it below.
						const decoded = yield* Effect.result(Schema.decodeUnknownEffect(schema)(text.value));
						if (decoded._tag === "Success") return { value: decoded.success, hit: true } satisfies CacheHit<A>;
					}
				}

				const value = yield* onMiss;
				const encoded = yield* Schema.encodeEffect(schema)(value).pipe(
					Effect.catchTag("SchemaError", (cause) => Effect.fail(new CacheError({ operation: "set", key, cause }))),
				);
				yield* cache.set({
					key,
					value: utf8ToBytes(encoded),
					...(options?.ttl !== undefined && { ttl: options.ttl }),
					...(options?.tags !== undefined && { tags: options.tags }),
					...(options?.contentType !== undefined && { contentType: options.contentType }),
				});
				return { value, hit: false } satisfies CacheHit<A>;
			});
	}
}
