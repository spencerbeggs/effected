/**
 * SQLite-backed state and cache for Effect: `Store`, a migrated SQL client with a
 * user-defined migration ledger, and `Cache`, a key-to-bytes cache with TTL,
 * tags, an entry bound and a `CacheEvent` PubSub. Both come as driver-agnostic
 * layers over `SqlClient`, SQLite file layers, and in-memory test layers.
 *
 * @packageDocumentation
 */

export { Uint8ArrayFromUtf8 } from "./Bytes.js";
export {
	Cache,
	CacheEntry,
	type CacheEntryMeta,
	CacheError,
	CacheEvent,
	CacheEventPayload,
	type CacheHit,
	type CacheOptions,
	type CacheRemovalResult,
	type CacheShape,
	type CacheSqliteOptions,
	type CacheThroughOptions,
} from "./Cache.js";
export {
	Store,
	StoreError,
	type StoreMigration,
	StoreMigrationError,
	type StoreMigrationResult,
	StoreMigrationStatus,
	type StoreOptions,
	type StoreShape,
	type StoreSqliteOptions,
} from "./Store.js";
