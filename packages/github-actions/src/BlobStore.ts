import { SigV4 } from "@effected/crypto";
import type { Redacted } from "effect";
import { Context, Crypto, DateTime, Effect, Layer, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import type { ActionOutputs } from "./ActionOutputs.js";
import type { BlobEnvelopeError } from "./BlobEnvelope.js";
import { BlobEnvelope } from "./BlobEnvelope.js";
import { unstubbed } from "./internal/unstubbed.js";
import { Secret } from "./Secret.js";

/**
 * Raised when a blob cannot be stored or retrieved.
 *
 * @public
 */
export class BlobStoreError extends Schema.TaggedError<BlobStoreError>()("BlobStoreError", {
	/**
	 * `unreachable` — the store could not be contacted. `refused` — it answered,
	 * unhappily; `status` says how. `misconfigured` — the layer was built with
	 * settings the store cannot use, or a request could not be signed with them
	 * (no WebCrypto in the runtime, or key material it refuses). `invalidKey` —
	 * the caller's key cannot be stored at all, whatever the settings: on S3, a
	 * key with a `.` or `..` path segment, which no URL carries as signed.
	 * Nothing is sent.
	 */
	reason: Schema.Literals(["unreachable", "refused", "misconfigured", "invalidKey"]),
	/** The key involved. A stable identifier, never a value. */
	key: Schema.optionalKey(Schema.String),
	/** The HTTP status, when the store answered. */
	status: Schema.optionalKey(Schema.Number),
	/** What is wrong, when the reason alone does not say. */
	detail: Schema.optionalKey(Schema.String),
	/** The underlying failure, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		switch (this.reason) {
			case "unreachable":
				return `The blob store could not be reached${this.key === undefined ? "" : ` for "${this.key}"`}`;
			case "refused":
				return `The blob store refused "${this.key}"${this.status === undefined ? "" : ` with status ${this.status}`}${
					this.detail === undefined ? "" : `: ${this.detail}`
				}`;
			case "invalidKey":
				return `The blob store cannot hold the key "${this.key}"${this.detail === undefined ? "" : `: ${this.detail}`}`;
			default:
				return `The blob store is misconfigured${this.detail === undefined ? "" : `: ${this.detail}`}`;
		}
	}
}

/**
 * A stored value: the caller's metadata beside the bytes it describes.
 *
 * @public
 */
export interface StoredBlob<A> {
	/** The caller's own metadata, decoded through the caller's own schema. */
	readonly metadata: A;
	/** The payload, verbatim. */
	readonly body: Uint8Array;
}

/**
 * The members of the {@link BlobStore} service: `get`, `put` and `has` over
 * blobs that carry the caller's own metadata.
 *
 * @public
 */
export interface BlobStoreShape {
	/**
	 * Read a blob, or nothing if the key is absent.
	 *
	 * @remarks
	 * Fails with {@link BlobStoreError}, or a {@link BlobEnvelopeError} when the
	 * stored bytes are not a valid envelope for `schema`.
	 */
	readonly get: <A, I>(
		key: string,
		schema: Schema.Codec<A, I>,
	) => Effect.Effect<Option.Option<StoredBlob<A>>, BlobStoreError | BlobEnvelopeError>;
	/** Write a blob. */
	readonly put: <A, I>(
		key: string,
		blob: StoredBlob<A>,
		schema: Schema.Codec<A, I>,
	) => Effect.Effect<void, BlobStoreError | BlobEnvelopeError>;
	/** Whether a key is present, without transferring the body. */
	readonly has: (key: string) => Effect.Effect<boolean, BlobStoreError>;
}

/**
 * How to reach an S3-compatible object store.
 *
 * @public
 */
export interface S3Config {
	/** The bucket name. */
	readonly bucket: string;
	/** The bucket's region, used for SigV4 signing and the default AWS endpoint. */
	readonly region: string;
	/**
	 * A custom endpoint, e.g. `https://<account>.r2.cloudflarestorage.com`.
	 *
	 * @remarks
	 * Omitting it targets AWS itself. Addressing is always **path-style**
	 * (`<endpoint>/<bucket>/<key>`), which is what makes the same layer work
	 * against R2, MinIO and Spaces — virtual-host addressing needs per-bucket
	 * DNS that none of them provide the same way.
	 */
	readonly endpoint?: string | undefined;
	/** The access key id. */
	readonly accessKeyId: string;
	/** The secret access key, declassified once and masked in the runner log. */
	readonly secretAccessKey: Redacted.Redacted<string>;
	/** For temporary credentials. */
	readonly sessionToken?: Redacted.Redacted<string> | undefined;
	/** Prepended to every key, so one bucket can hold several caches. */
	readonly prefix?: string | undefined;
}

/**
 * Durable blob storage with a metadata channel.
 *
 * @remarks
 * `get`/`put`/`has` over `Uint8Array` **plus the caller's own metadata**, framed
 * by {@link BlobEnvelope}. The metadata channel is the reason this exists:
 * fields like a cache tag or a duration travel as schema-typed metadata, and a
 * format revision is detected in the blob rather than by prefixing keys.
 *
 * Deliberately no `list` and no `delete`: eviction belongs to the backend, and
 * both backends already have one.
 *
 * Backends: {@link BlobStore.layerS3}, `GitHubCacheBlobStore.layer` and the
 * in-memory {@link BlobStore.layerMemory}.
 *
 * @example
 * ```ts
 * import { BlobStore } from "@effected/github-actions";
 * import { Effect, Schema } from "effect";
 *
 * class Meta extends Schema.Class<Meta>("Meta")({ tag: Schema.String, durationMs: Schema.Number }) {}
 *
 * const program = Effect.gen(function* () {
 *   const store = yield* BlobStore;
 *   yield* store.put("build/1", { metadata: Meta.make({ tag: "x", durationMs: 12 }), body: bytes }, Meta);
 *   return yield* store.get("build/1", Meta);
 * });
 * ```
 *
 * @public
 */
export class BlobStore extends Context.Service<BlobStore, BlobStoreShape>()("@effected/github-actions/BlobStore") {
	/**
	 * An S3-compatible backend, signed with SigV4.
	 *
	 * @remarks
	 * No `@aws-sdk/*` dependency: signing is `@effected/crypto`'s `SigV4`, a
	 * specified algorithm over strings and HMACs. The SDK's weight is in
	 * credential management, retries and a service catalogue none of which this
	 * needs.
	 *
	 * Requires core `Crypto` for the SHA-256 digests signing takes, resolved
	 * once when the layer is built; `NodeServices.layer` supplies it. A request
	 * that cannot be signed fails as {@link BlobStoreError} `misconfigured`. A
	 * key with a `.` or `..` path segment fails as `invalidKey` before anything
	 * is signed or sent: every URL parser collapses such a segment, so the store
	 * would receive another path than the one signed.
	 *
	 * A parameterized layer factory mints a fresh layer per call and layers
	 * memoize by reference — bind it to a `const` rather than calling it at each
	 * composition site.
	 */
	static readonly layerS3 = (
		config: S3Config,
	): Layer.Layer<BlobStore, never, HttpClient.HttpClient | ActionOutputs | Crypto.Crypto> =>
		Layer.effect(BlobStore, makeS3(config));

	/** A test double. Unstubbed members die rather than reporting a miss. */
	static readonly makeTest = (overrides: Partial<BlobStoreShape> = {}): BlobStoreShape => ({
		get: () => dies("get"),
		put: () => dies("put"),
		has: () => dies("has"),
		...overrides,
	});

	/** {@link BlobStore.makeTest} behind `Layer.succeed`. */
	static readonly layerTest = (overrides: Partial<BlobStoreShape> = {}): Layer.Layer<BlobStore> =>
		Layer.succeed(BlobStore, BlobStore.makeTest(overrides));

	/**
	 * An in-memory backend.
	 *
	 * @remarks
	 * Not a stub: it runs the real {@link BlobEnvelope} framing, so a round trip
	 * through it exercises encode and decode exactly as a network backend would.
	 * A test that wants to prove its metadata survives storage should use this
	 * rather than a double whose `get` returns whatever its `put` was handed.
	 */
	static readonly layerMemory: Layer.Layer<BlobStore> = Layer.sync(BlobStore, () => {
		const entries = new Map<string, Uint8Array>();
		return {
			get: <A, I>(key: string, schema: Schema.Codec<A, I>) =>
				Effect.suspend(() => {
					const stored = entries.get(key);
					return stored === undefined
						? Effect.succeed(Option.none<StoredBlob<A>>())
						: Effect.map(Effect.fromResult(BlobEnvelope.decodeResult(stored, schema)), Option.some);
				}),
			put: <A, I>(key: string, blob: StoredBlob<A>, schema: Schema.Codec<A, I>) =>
				Effect.suspend(() =>
					Effect.map(Effect.fromResult(BlobEnvelope.encodeResult(blob.metadata, blob.body, schema)), (framed) => {
						entries.set(key, framed);
					}),
				),
			has: (key: string) => Effect.sync(() => entries.has(key)),
		};
	});
}

const dies = unstubbed("BlobStore.makeTest");

const makeS3 = (
	config: S3Config,
): Effect.Effect<BlobStoreShape, never, HttpClient.HttpClient | ActionOutputs | Crypto.Crypto> =>
	Effect.gen(function* () {
		// Trace context stays inside the process: the store is a third party, and
		// `b3`/`traceparent` would hand it this run's trace and span ids on every
		// request. The client span is still recorded locally.
		const http = HttpClient.transform(yield* HttpClient.HttpClient, (effect) =>
			Effect.provideService(effect, HttpClient.TracerPropagationEnabled, false),
		);
		// Resolved once, so every member's `R` stays `never`.
		const crypto = yield* Crypto.Crypto;
		// Trailing slashes stripped without a regex: the anchored `/\/+$/` form
		// backtracks quadratically on slash runs (CodeQL js/polynomial-redos).
		let endpoint = config.endpoint ?? `https://s3.${config.region}.amazonaws.com`;
		while (endpoint.endsWith("/")) {
			endpoint = endpoint.slice(0, -1);
		}
		const host = new URL(endpoint).host;

		// Registered with the runner's log filter ONCE, here, and never
		// declassified: the signer takes the `Redacted` values and unwraps them
		// only where it signs, so no plaintext is held by this module. Masking
		// per request would emit a workflow command per object.
		yield* Secret.mask(config.secretAccessKey);
		if (config.sessionToken !== undefined) {
			yield* Secret.mask(config.sessionToken);
		}
		const credentials = {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
			...(config.sessionToken === undefined ? {} : { sessionToken: config.sessionToken }),
			region: config.region,
			service: "s3",
		};

		const objectPath = (key: string): string =>
			[config.bucket, ...(config.prefix === undefined ? [] : [config.prefix]), key]
				.join("/")
				.replaceAll(/\/{2,}/g, "/");

		const unsignable = (key: string, cause: unknown): BlobStoreError =>
			new BlobStoreError({ reason: "misconfigured", key, detail: "the request could not be signed", cause });

		const request = (method: string, key: string, body: Uint8Array) =>
			Effect.gen(function* () {
				const path = objectPath(key);
				// The signing instant comes from `Clock`, so `TestClock` drives it.
				const now = yield* DateTime.now;
				const signed = yield* SigV4.sign({ method, path, host, body, now }, credentials).pipe(
					Effect.provideService(Crypto.Crypto, crypto),
					Effect.catchTags({
						// A path SigV4 refuses is the caller's key, not the layer's settings.
						SigV4PathError: (cause) =>
							Effect.fail(
								new BlobStoreError({
									reason: "invalidKey",
									key,
									detail: `the path has a "${cause.segment}" segment, which a URL collapses, so it cannot be sent as signed`,
									cause,
								}),
							),
						CryptoError: (cause) => Effect.fail(unsignable(key, cause)),
						PlatformError: (cause) => Effect.fail(unsignable(key, cause)),
					}),
				);
				// The URL carries the target exactly as it was signed, never re-encoded:
				// `!'()*` included, or the store answers SignatureDoesNotMatch. SigV4
				// has already refused a `.` or `..` segment, which a URL would collapse.
				const url = `${endpoint}${signed.path}${signed.query === "" ? "" : `?${signed.query}`}`;
				return { url, headers: signed.headers };
			});

		const send = (method: "GET" | "PUT" | "HEAD", key: string, body: Uint8Array) =>
			Effect.gen(function* () {
				const { url, headers } = yield* request(method, key, body);
				const base = HttpClientRequest.make(method)(url, { headers });
				const built = body.length === 0 ? base : HttpClientRequest.bodyUint8Array(base, body);
				return yield* http
					.execute(built)
					.pipe(Effect.mapError((cause) => new BlobStoreError({ reason: "unreachable", key, cause })));
			});

		/** Anything outside 2xx is the store refusing; a caller reads `404` first where a miss is an answer. */
		const accepted = (key: string, status: number): Effect.Effect<void, BlobStoreError> =>
			status < 200 || status >= 300 ? Effect.fail(new BlobStoreError({ reason: "refused", key, status })) : Effect.void;

		return {
			get: <A, I>(key: string, schema: Schema.Codec<A, I>) =>
				Effect.gen(function* () {
					const response = yield* send("GET", key, new Uint8Array(0));
					// A miss is not a failure: it is the answer the caller asked for.
					if (response.status === 404) {
						return Option.none<StoredBlob<A>>();
					}
					yield* accepted(key, response.status);
					const buffer = yield* response.arrayBuffer.pipe(
						Effect.mapError((cause) => new BlobStoreError({ reason: "unreachable", key, cause })),
					);
					return Option.some(yield* Effect.fromResult(BlobEnvelope.decodeResult(new Uint8Array(buffer), schema)));
				}),

			put: <A, I>(key: string, blob: StoredBlob<A>, schema: Schema.Codec<A, I>) =>
				Effect.gen(function* () {
					const framed = yield* Effect.fromResult(BlobEnvelope.encodeResult(blob.metadata, blob.body, schema));
					const response = yield* send("PUT", key, framed);
					yield* accepted(key, response.status);
				}),

			has: (key: string) =>
				Effect.gen(function* () {
					const response = yield* send("HEAD", key, new Uint8Array(0));
					if (response.status === 404) {
						return false;
					}
					yield* accepted(key, response.status);
					return true;
				}),
		} satisfies BlobStoreShape;
	});
