import { Cause, Clock, Context, Duration, Effect, Layer, Option, Schema, Semaphore, Stream } from "effect";
import type { HttpClientResponse } from "effect/http";
import { HttpClient } from "effect/http";
import { isAlgorithm, unsupportedAlgorithm } from "./internal/algorithms.js";
import { concat, fatalUtf8 } from "./internal/bytes.js";
import { finiteMillis } from "./internal/duration.js";
import { isAcceptedIssuer, isLocalIssuer, protocolOf } from "./internal/issuer.js";
import { capped, kidLimit, quote } from "./internal/quote.js";
import type { Jwk } from "./Jwk.js";
import { Jwks } from "./Jwk.js";
import type { CachedJwks } from "./JwksStore.js";
import { JwksStore } from "./JwksStore.js";
import type { JoseHeader } from "./Jws.js";
import { JwtError } from "./JwtError.js";
import type { VerificationKey } from "./JwtKey.js";
import { JwtKey } from "./JwtKey.js";

/**
 * Options for {@link (JwksResolver:class).layerWith}.
 *
 * @public
 */
export interface JwksResolverOptions {
	/** How long a fetched key set is cached; 1 hour by default. */
	readonly ttl?: Duration.Input;
	/** The least time between two fetches for one issuer; 30 seconds by default. */
	readonly minRefetchInterval?: Duration.Input;
	/** The deadline for one fetch, discovery and JWKS together; 10 seconds by default. */
	readonly fetchTimeout?: Duration.Input;
	/**
	 * The JWKS URL for an issuer. By default it is discovered from
	 * `<issuer>/.well-known/openid-configuration`.
	 */
	readonly jwksUri?: (issuer: string) => string;
}

/**
 * The operations of a {@link (JwksResolver:class)}.
 *
 * @public
 */
export interface JwksResolverShape {
	/** The verification key `issuer` publishes for the token whose header is `header`. */
	readonly key: (issuer: string, header: JoseHeader) => Effect.Effect<VerificationKey, JwtError>;
}

/** The largest discovery document or JWKS read, in bytes. */
const maxBodyBytes = 1024 * 1024;

const Discovery = Schema.Struct({ issuer: Schema.String, jwks_uri: Schema.String });
const RawKeys = Schema.Struct({ keys: Schema.Array(Schema.Unknown) });

const fetchFailed = (detail: string, cause?: unknown) =>
	JwtError.of("jwksFetch", detail, cause === undefined ? undefined : { cause });

// Core's client reads a response body whole (`json`, `text`) with no limit,
// so the body is read from the stream and refused past `maxBodyBytes`.
const readCapped = (response: HttpClientResponse.HttpClientResponse, what: string): Effect.Effect<string, JwtError> => {
	const declared = Number(response.headers["content-length"]);
	if (Number.isFinite(declared) && declared > maxBodyBytes) {
		return Effect.fail(fetchFailed(`the ${what} is larger than ${maxBodyBytes} bytes`));
	}
	return Stream.runFoldEffect(
		Stream.mapError(response.stream, (cause) => fetchFailed(`the ${what} body could not be read`, cause)),
		() => ({ chunks: [] as Array<Uint8Array>, size: 0 }),
		(acc, chunk) => {
			const size = acc.size + chunk.byteLength;
			if (size > maxBodyBytes) return Effect.fail(fetchFailed(`the ${what} is larger than ${maxBodyBytes} bytes`));
			acc.chunks.push(chunk);
			return Effect.succeed({ chunks: acc.chunks, size });
		},
	).pipe(
		Effect.flatMap(({ chunks }) => {
			try {
				return Effect.succeed(fatalUtf8.decode(concat(chunks)));
			} catch (cause) {
				return Effect.fail(fetchFailed(`the ${what} is not UTF-8`, cause));
			}
		}),
	);
};

// A fetch-backed client follows redirects natively, and core offers no
// portable way to turn that off, so the response's final URL is checked
// instead: an https request must not end on plain http.
const checkFinalUrl = (
	response: HttpClientResponse.HttpClientResponse,
	requested: string,
	what: string,
): Effect.Effect<HttpClientResponse.HttpClientResponse, JwtError> => {
	if (response.url === "" || !requested.startsWith("https:")) return Effect.succeed(response);
	return protocolOf(response.url) === "https:"
		? Effect.succeed(response)
		: Effect.fail(fetchFailed(`the ${what} request was redirected off https`));
};

const getJson = <S extends Schema.Constraint & { readonly DecodingServices: never }>(
	client: HttpClient.HttpClient,
	url: string,
	schema: S,
	what: string,
): Effect.Effect<S["Type"], JwtError> =>
	client.get(url).pipe(
		Effect.mapError((cause) => fetchFailed(`the ${what} could not be fetched`, cause)),
		Effect.flatMap((response) => checkFinalUrl(response, url, what)),
		Effect.flatMap((response) => readCapped(response, what)),
		Effect.flatMap((text) =>
			Effect.mapError(Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text), (cause) =>
				fetchFailed(`the ${what} is not the expected JSON`, cause),
			),
		),
	);

// OIDC Discovery §4: the document lives under the issuer, and §4.3 requires
// its `issuer` to equal the one requested exactly.
const discoverJwksUri = (client: HttpClient.HttpClient, issuer: string): Effect.Effect<string, JwtError> =>
	Effect.gen(function* () {
		// Discovery over plain http would let a network attacker name any
		// jwks_uri, so the issuer is held to the same scheme rule.
		if (!isAcceptedIssuer(issuer)) {
			return yield* fetchFailed(`the issuer ${quote(issuer)} is not an https URL`);
		}
		const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
		const document = yield* getJson(client, url, Discovery, "discovery document");
		if (document.issuer !== issuer) {
			return yield* fetchFailed(`the discovery document names issuer ${quote(document.issuer)}, not the one requested`);
		}
		let jwksUri: URL;
		try {
			jwksUri = new URL(document.jwks_uri);
		} catch (cause) {
			return yield* fetchFailed("the discovered jwks_uri is not a URL", cause);
		}
		if (jwksUri.protocol !== "https:" && !(jwksUri.protocol === "http:" && isLocalIssuer(issuer))) {
			return yield* fetchFailed(`the discovered jwks_uri is not https: (${quote(jwksUri.protocol)})`);
		}
		return jwksUri.toString();
	});

const select = (jwks: Jwks, header: JoseHeader): Option.Option<Jwk> => {
	// A key naming a different algorithm is not a match for this token.
	const compatible = (key: Jwk) => key.alg === undefined || key.alg === header.alg;
	if (header.kid === undefined) {
		const [only] = jwks.keys;
		return jwks.keys.length === 1 && only !== undefined && compatible(only) ? Option.some(only) : Option.none();
	}
	return Option.fromUndefinedOr(jwks.keys.find((key) => key.kid === header.kid && compatible(key)));
};

// Static configuration: a bad value is a programming error, so it dies at
// layer construction with a message naming the option.
const positiveMillis = (name: string, input: Duration.Input): Effect.Effect<number> => {
	const millis = finiteMillis(input);
	return millis !== undefined && millis > 0
		? Effect.succeed(millis)
		: Effect.die(new Error(`JwksResolver: ${name} must be a finite, positive duration`));
};

const make = (options: JwksResolverOptions) =>
	Effect.gen(function* () {
		const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
		const store = yield* JwksStore;
		const ttlMillis = yield* positiveMillis("ttl", options.ttl ?? Duration.hours(1));
		const ttl = Duration.millis(ttlMillis);
		const minRefetchMillis = yield* positiveMillis(
			"minRefetchInterval",
			options.minRefetchInterval ?? Duration.seconds(30),
		);
		const fetchTimeoutMillis = yield* positiveMillis("fetchTimeout", options.fetchTimeout ?? Duration.seconds(10));
		// Per issuer, two separate clocks:
		// - `lastAttemptMillis` gates refetches and moves on every attempt, failed
		//   or not;
		// - `last` is the most recent *successful* fetch, aged by its own
		//   `fetchedAtMillis`. It serves misses from a store that lost it, and a
		//   failed refetch never touches it, so it cannot outlive the TTL.
		// Each issuer's entry is read and written only under that issuer's lock.
		const issuers = new Map<string, { readonly lastAttemptMillis: number; readonly last: CachedJwks | undefined }>();
		const locks = new Map<string, Semaphore.Semaphore>();
		const lockFor = (issuer: string) => {
			let lock = locks.get(issuer);
			if (lock === undefined) {
				lock = Semaphore.makeUnsafe(1);
				locks.set(issuer, lock);
			}
			return lock;
		};

		// A cache never fails a verification: a store that fails or dies is a
		// miss on read and ignored on write. Interruption still propagates.
		const swallow = <A>(effect: Effect.Effect<A>, fallback: A): Effect.Effect<A> =>
			Effect.catchCause(effect, (cause) =>
				Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.succeed(fallback),
			);
		// Freshness is checked here too, so a store that ignores `ttl` cannot
		// keep a revoked key trusted.
		const storedFor = (issuer: string, now: number) =>
			Effect.map(swallow(store.get(issuer), Option.none<CachedJwks>()), (cached) =>
				Option.filter(cached, (entry) => now - entry.fetchedAtMillis < ttlMillis),
			);

		const fetchJwks = (issuer: string) =>
			Effect.gen(function* () {
				const uri = options.jwksUri !== undefined ? options.jwksUri(issuer) : yield* discoverJwksUri(client, issuer);
				const raw = yield* getJson(client, uri, RawKeys, "JWKS");
				const jwks = yield* Effect.mapError(Schema.decodeUnknownEffect(Jwks)(raw), (cause) =>
					fetchFailed("the JWKS is not a key set", cause),
				);
				const dropped = raw.keys.length - jwks.keys.length;
				if (raw.keys.length > 0 && jwks.keys.length === 0) {
					return yield* fetchFailed(`the JWKS holds ${raw.keys.length} keys but no supported keys (RSA or P-256 EC)`);
				}
				yield* Effect.annotateCurrentSpan({ "jwt.jwks.keys": jwks.keys.length, "jwt.jwks.dropped": dropped });
				return jwks;
			}).pipe(
				Effect.timeoutOrElse({
					duration: Duration.millis(fetchTimeoutMillis),
					orElse: () => Effect.fail(fetchFailed(`the JWKS was not fetched within ${fetchTimeoutMillis} ms`)),
				}),
				Effect.withSpan("JwksResolver.fetch", { attributes: { "jwt.issuer": issuer } }),
			);

		const importFor = (jwk: Jwk, header: JoseHeader) =>
			isAlgorithm(header.alg) ? JwtKey.fromJwk(jwk, { alg: header.alg }) : JwtKey.fromJwk(jwk);

		// The header's `kid` is attacker-chosen and is read before any signature
		// check, so it is capped, in the detail and on the error alike.
		const unknownKid = (header: JoseHeader) =>
			JwtError.of(
				"unknownKid",
				header.kid === undefined
					? "the token names no kid and the JWKS does not hold exactly one matching key"
					: `the JWKS holds no ${header.alg} key with kid ${quote(header.kid, kidLimit)}`,
				header.kid === undefined ? undefined : { kid: capped(header.kid, kidLimit) },
			);

		// The resolver's own last successful fetch, if still inside its TTL. A
		// failed refetch never re-dates it, so it cannot outlive the TTL however
		// many refetches have failed since.
		const lastFor = (issuer: string, now: number): CachedJwks | undefined => {
			const last = issuers.get(issuer)?.last;
			return last !== undefined && now - last.fetchedAtMillis < ttlMillis ? last : undefined;
		};

		// Of the store and the resolver's own copy, each already TTL-checked,
		// only the newer is consulted: a lagging store (an edge-cached KV read)
		// must not shadow a rotation this resolver has already fetched, a store
		// that retains nothing must not hide the last fetch, and an older set
		// must never re-admit a key a newer one dropped. A miss in the newest
		// set goes to the refetch path, never to the older set.
		const matchIn = (
			stored: Option.Option<CachedJwks>,
			last: CachedJwks | undefined,
			header: JoseHeader,
		): Option.Option<Jwk> => {
			const fromStore = Option.getOrUndefined(stored);
			const newest =
				fromStore === undefined
					? last
					: last === undefined || fromStore.fetchedAtMillis > last.fetchedAtMillis
						? fromStore
						: last;
			return newest === undefined ? Option.none() : select(newest.jwks, header);
		};

		const refresh = (issuer: string, header: JoseHeader) =>
			Effect.gen(function* () {
				// Another fiber may have refreshed while this one waited for the lock.
				const now = yield* Clock.currentTimeMillis;
				const stored = yield* storedFor(issuer, now);
				const state = issuers.get(issuer);
				const last = lastFor(issuer, now);
				const match = matchIn(stored, last, header);
				if (Option.isSome(match)) return yield* importFor(match.value, header);

				const lastAttempt = Math.max(
					state?.lastAttemptMillis ?? Number.NEGATIVE_INFINITY,
					Option.isSome(stored) ? stored.value.fetchedAtMillis : Number.NEGATIVE_INFINITY,
				);
				if (now - lastAttempt < minRefetchMillis) {
					return yield* Option.isNone(stored) && last === undefined
						? fetchFailed("the JWKS could not be fetched, and the refetch interval has not passed")
						: unknownKid(header);
				}
				issuers.set(issuer, { lastAttemptMillis: now, last: state?.last });
				const jwks = yield* fetchJwks(issuer);
				const fetched: CachedJwks = { jwks, fetchedAtMillis: now };
				issuers.set(issuer, { lastAttemptMillis: now, last: fetched });
				yield* swallow(store.set(issuer, fetched, ttl), undefined);
				const fresh = select(jwks, header);
				return Option.isSome(fresh) ? yield* importFor(fresh.value, header) : yield* unknownKid(header);
			});

		const key = Effect.fn("JwksResolver.key")(function* (issuer: string, header: JoseHeader) {
			if (!isAlgorithm(header.alg)) return yield* unsupportedAlgorithm(header.alg);
			const now = yield* Clock.currentTimeMillis;
			const stored = yield* storedFor(issuer, now);
			// Read outside the lock, which is safe: the entry is an immutable
			// snapshot replaced whole, `last` only ever moves to a newer
			// successful fetch, and this read decides a match, never a write or a
			// refetch. A miss here is re-checked under the lock.
			const hit = matchIn(stored, lastFor(issuer, now), header);
			if (Option.isSome(hit)) return yield* importFor(hit.value, header);
			// One refresh per issuer at a time, so concurrent misses share a fetch.
			return yield* lockFor(issuer).withPermit(refresh(issuer, header));
		});

		return { key } satisfies JwksResolverShape;
	});

/**
 * Resolves the verification key for a token from its issuer's JWKS.
 *
 * @remarks
 * The key set is found by OIDC discovery (the discovery document's `issuer`
 * must equal the requested issuer exactly, and its `jwks_uri` must be
 * `https:` unless the issuer is `http://localhost` or `http://127.0.0.1`,
 * as must the issuer itself and the final URL after any redirect) or
 * by {@link JwksResolverOptions.jwksUri}, and cached in the
 * {@link JwksStore}. A token whose `kid` the cached set lacks triggers one
 * refetch, at most once per `minRefetchInterval` per issuer, so a key
 * rotation is picked up while a flood of made-up `kid`s is not; concurrent
 * misses share that fetch. A header without `kid` matches only a single-key
 * set, and a key naming a different `alg` never matches.
 *
 * Failures: no matching key is `unknownKid`; a matching key that does not
 * import is `key`; an unreachable, slow (over `fetchTimeout`, 10 seconds by
 * default), oversized (over 1 MiB) or malformed
 * document, a discovery mismatch, or a set whose every key is unsupported is
 * `jwksFetch`. A cached set, and the resolver's own copy of the last fetch,
 * are trusted only within `ttl`, so a key the issuer removes stops verifying
 * once the TTL passes. `ttl`, `minRefetchInterval` and `fetchTimeout` must be
 * finite and positive; anything else is a defect when the layer is built.
 *
 * @public
 */
export class JwksResolver extends Context.Service<JwksResolver, JwksResolverShape>()("@effected/jwt/JwksResolver") {
	/** A resolver with the given options, over an `HttpClient` and a {@link JwksStore}. */
	static readonly layerWith = (
		options: JwksResolverOptions,
	): Layer.Layer<JwksResolver, never, HttpClient.HttpClient | JwksStore> => Layer.effect(JwksResolver, make(options));

	/** A resolver with the default options: discovery, a 1 hour TTL and a 30 second refetch interval. */
	static readonly layer: Layer.Layer<JwksResolver, never, HttpClient.HttpClient | JwksStore> = Layer.effect(
		this,
		make({}),
	);

	/**
	 * A key resolver for `issuer`, for `Jws.verify` and `Jwt.verify`'s `key`.
	 *
	 * @remarks
	 * Always pass the issuer you expect, never one read from the token: the
	 * issuer chooses which keys are trusted.
	 */
	static readonly forIssuer =
		(issuer: string) =>
		(header: JoseHeader): Effect.Effect<VerificationKey, JwtError, JwksResolver> =>
			Effect.flatMap(Effect.service(JwksResolver), (resolver) => resolver.key(issuer, header));
}
