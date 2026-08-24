import { createHash } from "node:crypto";
import { BlobClient, BlockBlobClient } from "@azure/storage-blob";
import type { Schema } from "effect";
import { Effect, Layer, Option } from "effect";
import { HttpClient } from "effect/unstable/http";
import { ActionEnvironment } from "./ActionEnvironment.js";
import { BlobEnvelope } from "./BlobEnvelope.js";
import type { BlobStoreShape, StoredBlob } from "./BlobStore.js";
import { BlobStore, BlobStoreError } from "./BlobStore.js";
import type { DataBlobTransfer } from "./BlobTransfer.js";
import { BlobTransferError } from "./BlobTransfer.js";
import { resultsBackend } from "./internal/actionsResults.js";
import type { TwirpFailure } from "./internal/twirp.js";
import { CONFLICT, isOk, stringField, twirpCall } from "./internal/twirp.js";

/** The Twirp service the Actions cache protocol lives under. */
const SERVICE = "github.actions.results.api.v1.CacheService";

/**
 * The `version` every entry is filed under.
 *
 * @remarks
 * The cache protocol keys an entry on `(key, version)`, and `actions/cache`
 * derives the version from the *paths* it archives. A blob store has no paths —
 * the key is caller-supplied and the payload is opaque — so the version is a
 * constant, which is what makes any key map to a reproducible slot.
 *
 * It is deliberately **not** a format version: {@link BlobEnvelope} carries that
 * inside the blob, so a framing change is a clean miss rather than a key change
 * that strands every existing entry.
 */
const VERSION = createHash("sha256").update("blobstore|1.0").digest("hex");

/**
 * The Azure half, ~15 lines and duplicated on purpose.
 *
 * @remarks
 * `@azure/storage-blob` may be imported by this module, `ActionCache` and
 * `Artifact` and by nothing else. Hoisting these two calls into a shared
 * `internal/` helper is exactly how the import would leak into the graph of a
 * module that only sets an output — so the three modules each carry their own,
 * and `__test__/reachability.test.ts` measures that they are the only three.
 */
const azure: DataBlobTransfer = {
	uploadData: (url, data) =>
		Effect.tryPromise({
			try: () => new BlockBlobClient(url).uploadData(data),
			catch: (cause) => new BlobTransferError({ reason: "uploadFailed", cause }),
		}).pipe(Effect.asVoid),
	downloadToBuffer: (url) =>
		Effect.tryPromise({
			try: () => new BlobClient(url).downloadToBuffer(),
			catch: (cause) => new BlobTransferError({ reason: "downloadFailed", cause }),
		}).pipe(Effect.map((buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))),
};

const fromTwirp = (failure: TwirpFailure, key: string): BlobStoreError =>
	failure.kind === "status"
		? new BlobStoreError({
				reason: "refused",
				key,
				...(failure.status === undefined ? {} : { status: failure.status }),
			})
		: new BlobStoreError({
				reason: "unreachable",
				key,
				detail: `${failure.method} answered with something that is not a Twirp body`,
				...(failure.cause === undefined ? {} : { cause: failure.cause }),
			});

const make = (
	transfer: DataBlobTransfer,
): Effect.Effect<BlobStoreShape, never, HttpClient.HttpClient | ActionEnvironment> =>
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient;
		// Resolved once, at construction, so every member's `R` is `never` — the
		// same fix `ActionEnvironment.payload` got, for the same reason.
		const env = yield* ActionEnvironment;

		const backend = resultsBackend(env).pipe(
			Effect.mapError(
				(name) =>
					new BlobStoreError({
						reason: "misconfigured",
						detail: `${name} is not set — the Actions results backend is only reachable from a \`uses:\` step, never from \`run:\``,
					}),
			),
		);

		const call = (method: string, body: Record<string, unknown>, key: string) =>
			Effect.gen(function* () {
				const { baseUrl, token } = yield* backend;
				return yield* twirpCall<unknown>({ http, baseUrl, service: SERVICE, token, method, body }).pipe(
					Effect.mapError((failure) => fromTwirp(failure, key)),
				);
			});

		/** The signed download url for a key, or nothing — a miss is not a failure. */
		const download = (key: string) =>
			Effect.map(call("GetCacheEntryDownloadURL", { key, restore_keys: [], version: VERSION }, key), (answer) =>
				answer === CONFLICT || !isOk(answer)
					? Option.none<string>()
					: Option.fromNullishOr(stringField(answer, "signedDownloadUrl")),
			);

		const moved = (key: string) =>
			Effect.mapError((cause: BlobTransferError) => new BlobStoreError({ reason: "unreachable", key, cause }));

		return {
			get: <A, I>(key: string, schema: Schema.Codec<A, I>) =>
				Effect.gen(function* () {
					const url = yield* download(key);
					if (Option.isNone(url)) {
						return Option.none<StoredBlob<A>>();
					}
					const bytes = yield* transfer.downloadToBuffer(url.value).pipe(moved(key));
					return Option.some(yield* Effect.fromResult(BlobEnvelope.decodeResult(bytes, schema)));
				}),

			put: <A, I>(key: string, blob: StoredBlob<A>, schema: Schema.Codec<A, I>) =>
				Effect.gen(function* () {
					const framed = yield* Effect.fromResult(BlobEnvelope.encodeResult(blob.metadata, blob.body, schema));
					const created = yield* call("CreateCacheEntry", { key, version: VERSION }, key);
					// A conflict means another job wrote this key first. The entry is
					// immutable, so the write has already happened and the caller got
					// what it asked for.
					if (created === CONFLICT) {
						return;
					}
					const url = stringField(created, "signedUploadUrl");
					if (!isOk(created) || url === undefined) {
						return yield* Effect.fail(
							new BlobStoreError({ reason: "refused", key, detail: "CreateCacheEntry returned no upload url" }),
						);
					}
					yield* transfer.uploadData(url, framed).pipe(moved(key));
					const finalized = yield* call(
						"FinalizeCacheEntryUpload",
						{ key, version: VERSION, size_bytes: String(framed.byteLength) },
						key,
					);
					// Not folded in with the create: an unfinalized upload leaves bytes
					// in Azure that no lookup will ever find, so it is a failure even
					// though every byte arrived.
					if (finalized === CONFLICT || !isOk(finalized)) {
						return yield* Effect.fail(
							new BlobStoreError({
								reason: "refused",
								key,
								detail: "FinalizeCacheEntryUpload did not confirm the upload",
							}),
						);
					}
				}),

			has: (key: string) => Effect.map(download(key), Option.isSome),
		} satisfies BlobStoreShape;
	});

/**
 * The {@link BlobStore} backend that stores blobs in the runner's own Actions
 * cache.
 *
 * @remarks
 * The Actions cache is reachable over a Twirp v2 protocol at
 * `ACTIONS_RESULTS_URL`, which answers a `CreateCacheEntry` /
 * `GetCacheEntryDownloadURL` RPC with a **pre-signed Azure blob url** — which is
 * why this backend lives in its own module rather than beside the S3 one, and
 * why the spec's "Azure is confined to the cache and the artifact service" is
 * three modules rather than two.
 *
 * **Only reachable from a `uses:` step.** The runner injects
 * `ACTIONS_RESULTS_URL` and `ACTIONS_RUNTIME_TOKEN` into action execution
 * contexts and not into `run:` shell steps, so a program that works when
 * invoked from a bundled action fails as `misconfigured` when the same code is
 * run by `node ./main.js` in a workflow step. The failure names the variable
 * for exactly that reason.
 *
 * The layer statics live here rather than on {@link BlobStore} because a static
 * belongs to the module that owns the dependency it needs: putting
 * `BlobStore.layerGitHubCache` on the service class would make `@azure/storage-blob`
 * reachable from every module that reads a blob.
 *
 * @example
 * ```ts
 * import { GitHubCacheBlobStore } from "@effected/github-actions";
 *
 * const layer = GitHubCacheBlobStore.layer;
 * ```
 *
 * @public
 */
export class GitHubCacheBlobStore {
	private constructor() {}

	/** The backend, over the real Azure client. */
	static readonly layer: Layer.Layer<BlobStore, never, HttpClient.HttpClient | ActionEnvironment> = Layer.effect(
		BlobStore,
		make(azure),
	);

	/**
	 * The backend, over a supplied transport.
	 *
	 * @remarks
	 * The Twirp protocol — the RPC sequence, the conflict handling, the retry
	 * policy, the framing — is what this package owns and what a test needs to
	 * exercise; the Azure client is a pre-signed `PUT` that owns none of it. This
	 * is also the seam an integration test uses to point the same protocol at a
	 * local blob endpoint.
	 *
	 * A parameterized layer factory mints a fresh layer per call and layers
	 * memoize by reference — bind it to a `const` rather than calling it at each
	 * composition site.
	 */
	static readonly layerWith = (
		transfer: DataBlobTransfer,
	): Layer.Layer<BlobStore, never, HttpClient.HttpClient | ActionEnvironment> =>
		Layer.effect(BlobStore, make(transfer));
}
