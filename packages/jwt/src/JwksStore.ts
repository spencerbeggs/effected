import { Clock, Context, Duration, Effect, Layer, Option, Ref } from "effect";
import type { Jwks } from "./Jwk.js";

/**
 * A JWKS as fetched, with the time it was fetched.
 *
 * @public
 */
export interface CachedJwks {
	/** The decoded key set (supported keys only). */
	readonly jwks: Jwks;
	/** When it was fetched, in milliseconds since the epoch on `Clock`. */
	readonly fetchedAtMillis: number;
}

/**
 * The operations of a {@link JwksStore}.
 *
 * @public
 */
export interface JwksStoreShape {
	/** The cached key set for `issuer`, if one is held and unexpired. */
	readonly get: (issuer: string) => Effect.Effect<Option.Option<CachedJwks>>;
	/** Hold `value` for `issuer` for `ttl`. */
	readonly set: (issuer: string, value: CachedJwks, ttl: Duration.Duration) => Effect.Effect<void>;
}

/**
 * Where {@link (JwksResolver:class)} caches each issuer's key set.
 *
 * @remarks
 * {@link JwksStore.layerMemory} keeps it in process. A Cloudflare Worker,
 * whose isolates do not share memory, backs it with KV or the Cache API
 * instead. A store's own failures must be swallowed by the store (a miss on
 * `get`, a no-op on `set`): a cache must never fail a verification. The
 * resolver also guards against a store that fails or dies anyway.
 *
 * @public
 */
export class JwksStore extends Context.Service<JwksStore, JwksStoreShape>()("@effected/jwt/JwksStore") {
	/** An in-process store over a `Ref`, expiring entries against `Clock`. */
	static readonly layerMemory: Layer.Layer<JwksStore> = Layer.effect(
		this,
		Effect.map(
			Ref.make(new Map<string, { readonly value: CachedJwks; readonly expiresAtMillis: number }>()),
			(entries): JwksStoreShape => ({
				get: (issuer) =>
					Effect.gen(function* () {
						const now = yield* Clock.currentTimeMillis;
						const entry = (yield* Ref.get(entries)).get(issuer);
						return entry !== undefined && now < entry.expiresAtMillis ? Option.some(entry.value) : Option.none();
					}),
				set: (issuer, value, ttl) =>
					Effect.gen(function* () {
						const now = yield* Clock.currentTimeMillis;
						const expiresAtMillis = now + Duration.toMillis(ttl);
						yield* Ref.update(entries, (map) => new Map(map).set(issuer, { value, expiresAtMillis }));
					}),
			}),
		),
	);
}
