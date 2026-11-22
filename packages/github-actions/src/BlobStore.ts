import { Context, Effect, Layer, Option, Schema } from "effect";
import type { BlobEnvelopeError } from "./BlobEnvelope.js";
import { BlobEnvelope } from "./BlobEnvelope.js";
import { unstubbed } from "./internal/unstubbed.js";

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
 * Backends: `S3BlobStore.layer`, `GitHubCacheBlobStore.layer` and the
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
