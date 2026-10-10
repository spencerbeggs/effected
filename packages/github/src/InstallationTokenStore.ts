import { Clock, Context, Duration, Effect, Layer, Option, Ref } from "effect";

/**
 * The operations of an {@link InstallationTokenStore}.
 *
 * @public
 */
export interface InstallationTokenStoreShape {
	/**
	 * The encoded installation token stored for `installationId`, if one is held
	 * and unexpired.
	 */
	readonly get: (installationId: number) => Effect.Effect<Option.Option<string>>;
	/** Hold `encoded` for `installationId` for `ttl`. */
	readonly set: (installationId: number, encoded: string, ttl: Duration.Duration) => Effect.Effect<void>;
}

/**
 * Where `GitHubApp.cachedToken` keeps installation tokens between request
 * scopes.
 *
 * @remarks
 * Entries are keyed by installation id, never by token text. The value is an
 * `InstallationToken` encoded as JSON, and it **contains the raw token**, so
 * encrypting it at rest is the store's job, not the caller's.
 *
 * {@link InstallationTokenStore.layerMemory} keeps tokens in process. A
 * Cloudflare Worker, whose isolates do not share memory, backs the store with
 * KV, a Durable Object or D1 instead. A store's own failures should be
 * swallowed by the store (a miss on `get`, a no-op on `set`): a cache must
 * never fail the call it serves. `cachedToken` also guards against a store
 * that fails or dies anyway; only interruption propagates.
 *
 * This module imports nothing but `effect`, so a store implementation never
 * links the JWT signer.
 *
 * @public
 */
export class InstallationTokenStore extends Context.Service<InstallationTokenStore, InstallationTokenStoreShape>()(
	"@effected/github/InstallationTokenStore",
) {
	/** An in-process store over a `Ref`, expiring entries against `Clock`. */
	static readonly layerMemory: Layer.Layer<InstallationTokenStore> = Layer.effect(
		this,
		Effect.map(
			Ref.make(new Map<number, { readonly encoded: string; readonly expiresAtMillis: number }>()),
			(entries): InstallationTokenStoreShape => ({
				get: (installationId) =>
					Effect.gen(function* () {
						const now = yield* Clock.currentTimeMillis;
						const entry = (yield* Ref.get(entries)).get(installationId);
						return entry !== undefined && now < entry.expiresAtMillis ? Option.some(entry.encoded) : Option.none();
					}),
				set: (installationId, encoded, ttl) =>
					Effect.gen(function* () {
						const now = yield* Clock.currentTimeMillis;
						const expiresAtMillis = now + Duration.toMillis(ttl);
						yield* Ref.update(entries, (map) => new Map(map).set(installationId, { encoded, expiresAtMillis }));
					}),
			}),
		),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<InstallationTokenStoreShape> = {}): InstallationTokenStoreShape => ({
		get:
			overrides.get ??
			(() => Effect.die(new Error("InstallationTokenStore.makeTest: get() was called but not stubbed"))),
		set:
			overrides.set ??
			(() => Effect.die(new Error("InstallationTokenStore.makeTest: set() was called but not stubbed"))),
	});

	/** {@link InstallationTokenStore.makeTest} behind a `Layer`. */
	static readonly layerTest = (
		overrides: Partial<InstallationTokenStoreShape> = {},
	): Layer.Layer<InstallationTokenStore> =>
		Layer.succeed(InstallationTokenStore, InstallationTokenStore.makeTest(overrides));
}
