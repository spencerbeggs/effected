import { createHash } from "node:crypto";
import { BlobClient, BlockBlobClient } from "@azure/storage-blob";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { ActionEnvironment } from "./ActionEnvironment.js";
import type { FileBlobTransfer } from "./BlobTransfer.js";
import { BlobTransferError } from "./BlobTransfer.js";
import type { CacheKey } from "./CacheKey.js";
import { resultsBackend } from "./internal/actionsResults.js";
import type { TwirpFailure } from "./internal/twirp.js";
import { CONFLICT, isOk, stringField, twirpCall } from "./internal/twirp.js";

/**
 * Raised when the runner's cache cannot be read or written.
 *
 * @public
 */
export class ActionCacheError extends Schema.TaggedErrorClass<ActionCacheError>()("ActionCacheError", {
	/**
	 * `misconfigured` — the results backend is not reachable from here (see
	 * {@link ActionCache}). `unreachable` — it could not be contacted, or
	 * answered with something that is not a Twirp body. `refused` — it answered,
	 * unhappily. `archiveFailed` — `tar` would not pack or unpack the paths.
	 * `transferFailed` — the archive itself did not move.
	 */
	reason: Schema.Literals(["misconfigured", "unreachable", "refused", "archiveFailed", "transferFailed"]),
	/** The cache key involved. A stable identifier, never a value. */
	key: Schema.optionalKey(Schema.String),
	/** The HTTP status, when the backend answered. */
	status: Schema.optionalKey(Schema.Number),
	/** What went wrong, when the reason alone does not say. */
	detail: Schema.optionalKey(Schema.String),
	/** `tar`'s own complaint, which is the only useful part of an archive failure. */
	stderr: Schema.optionalKey(Schema.String),
	/** The underlying failure, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const about = this.key === undefined ? "" : ` for "${this.key}"`;
		const detail = this.detail === undefined ? "" : `: ${this.detail}`;
		switch (this.reason) {
			case "misconfigured":
				return `The Actions cache is not reachable from here${detail}`;
			case "unreachable":
				return `The Actions cache could not be reached${about}${detail}`;
			case "refused":
				return `The Actions cache refused the request${about}${this.status === undefined ? "" : ` with status ${this.status}`}${detail}`;
			case "archiveFailed":
				return `The cache archive could not be built or extracted${about}${this.stderr === undefined ? "" : `: ${this.stderr}`}`;
			default:
				return `The cache archive did not transfer${about}`;
		}
	}
}

/**
 * The {@link ActionCache} service shape.
 *
 * @public
 */
export interface ActionCacheShape {
	/**
	 * Archive `paths` and store them under `key`.
	 *
	 * @remarks
	 * A key that already exists is a **success**: cache entries are immutable, so
	 * another job having written it first is the outcome the caller wanted.
	 */
	readonly save: (paths: ReadonlyArray<string>, key: string | CacheKey) => Effect.Effect<void, ActionCacheError>;
	/**
	 * Restore `paths` from the first entry that matches, and answer with the key
	 * that matched.
	 *
	 * @remarks
	 * `Option.none()` is a miss, not a failure — a cold cache is the normal state
	 * of a new branch. Passing a {@link CacheKey} supplies its restore-key ladder
	 * automatically; passing a `string` and no ladder means "this key or nothing".
	 */
	readonly restore: (
		paths: ReadonlyArray<string>,
		key: string | CacheKey,
		restoreKeys?: ReadonlyArray<string>,
	) => Effect.Effect<Option.Option<string>, ActionCacheError>;
}

/** The Twirp service the Actions cache protocol lives under. */
const SERVICE = "github.actions.results.api.v1.CacheService";

/**
 * The entry version, byte-compatible with `actions/cache`.
 *
 * @remarks
 * A cache entry is keyed on `(key, version)`, and the version is a digest of
 * the archived paths plus the compression method. **The paths are not sorted**,
 * because upstream does not sort them: sorting here would compute a version no
 * other cache step in the workflow agrees with, and the entry a sibling step
 * wrote would simply never be found.
 */
const versionOf = (paths: ReadonlyArray<string>): string =>
	createHash("sha256")
		.update([...paths, "gzip", "1.0"].join("|"))
		.digest("hex");

/**
 * The Azure half, duplicated on purpose.
 *
 * @remarks
 * `@azure/storage-blob` may be imported here, by `Artifact` and by
 * `BlobStore.githubCache`, and nowhere else — hoisting these two calls into a
 * shared `internal/` helper is exactly how a heavy import leaks into the graph
 * of a module that only sets an output. `__test__/reachability.test.ts`
 * measures that these are the only three.
 */
const azure: FileBlobTransfer = {
	uploadFile: (url, file) =>
		Effect.tryPromise({
			try: () =>
				new BlockBlobClient(url).uploadFile(file, {
					// The block size and concurrency `actions/cache` itself uses: a
					// multi-gigabyte toolchain cache is the normal case, not the
					// exceptional one.
					blockSize: 64 * 1024 * 1024,
					concurrency: 8,
					maxSingleShotSize: 128 * 1024 * 1024,
				}),
			catch: (cause) => new BlobTransferError({ reason: "uploadFailed", cause }),
		}).pipe(Effect.asVoid),
	downloadToFile: (url, file) =>
		Effect.tryPromise({
			try: () => new BlobClient(url).downloadToFile(file),
			catch: (cause) => new BlobTransferError({ reason: "downloadFailed", cause }),
		}).pipe(Effect.asVoid),
};

const fromTwirp = (failure: TwirpFailure, key: string): ActionCacheError =>
	failure.kind === "status"
		? new ActionCacheError({
				reason: "refused",
				key,
				detail: failure.method,
				...(failure.status === undefined ? {} : { status: failure.status }),
			})
		: new ActionCacheError({
				reason: "unreachable",
				key,
				detail: `${failure.method} did not answer with a Twirp body`,
				...(failure.cause === undefined ? {} : { cause: failure.cause }),
			});

/** The primary key and the ladder to fall back through. */
const ladder = (key: string | CacheKey, restoreKeys: ReadonlyArray<string> | undefined) =>
	typeof key === "string"
		? { primary: key, fallbacks: restoreKeys ?? [] }
		: { primary: key.key, fallbacks: restoreKeys ?? key.restoreKeys };

const make = (
	transfer: FileBlobTransfer,
): Effect.Effect<
	ActionCacheShape,
	never,
	| ActionEnvironment
	| HttpClient.HttpClient
	| FileSystem.FileSystem
	| Path.Path
	| ChildProcessSpawner.ChildProcessSpawner
> =>
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		// Resolved once, at construction, so every member's `R` is `never`.
		const env = yield* ActionEnvironment;
		const windows = yield* Effect.map(env.getOptional("RUNNER_OS"), (found) =>
			Option.match(found, { onNone: () => false, onSome: (os) => os.toLowerCase() === "windows" }),
		);

		const backend = resultsBackend(env).pipe(
			Effect.mapError(
				(name) =>
					new ActionCacheError({
						reason: "misconfigured",
						detail: `${name} is not set — the Actions cache is only reachable from a \`uses:\` step, never from \`run:\``,
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

		/**
		 * Run `tar`, keeping its stderr.
		 *
		 * @remarks
		 * On Windows, extraction runs with `-k` so a file another process holds
		 * open is skipped rather than failing the whole restore — and `tar` then
		 * exits 1 to say so, which is a warning rather than an error. Exit 2 and
		 * above stays a failure on every platform.
		 */
		const tar = (args: ReadonlyArray<string>, key: string, tolerateWarnings: boolean) =>
			Effect.gen(function* () {
				const command = ChildProcess.make("tar", [...args]);
				const output = yield* spawner
					.string(command, { includeStderr: true })
					.pipe(Effect.mapError((cause) => new ActionCacheError({ reason: "archiveFailed", key, cause })));
				const code = yield* spawner
					.exitCode(command)
					.pipe(Effect.mapError((cause) => new ActionCacheError({ reason: "archiveFailed", key, cause })));
				if (code !== 0 && !(tolerateWarnings && code === 1)) {
					return yield* Effect.fail(new ActionCacheError({ reason: "archiveFailed", key, stderr: output.trim() }));
				}
			});

		/** A scratch archive path, removed on every exit path. */
		const withArchive = <A>(
			key: string,
			use: (archive: string) => Effect.Effect<A, ActionCacheError>,
		): Effect.Effect<A, ActionCacheError> =>
			Effect.acquireUseRelease(
				fs
					.makeTempDirectory({ prefix: "effected-cache-" })
					.pipe(Effect.mapError((cause) => new ActionCacheError({ reason: "archiveFailed", key, cause }))),
				(directory) => use(path.join(directory, "cache.tar.gz")),
				(directory) => Effect.ignore(fs.remove(directory, { recursive: true, force: true })),
			);

		const moved = (key: string) =>
			Effect.mapError((cause: BlobTransferError) => new ActionCacheError({ reason: "transferFailed", key, cause }));

		return {
			save: Effect.fn("ActionCache.save")(function* (paths: ReadonlyArray<string>, key: string | CacheKey) {
				const { primary } = ladder(key, undefined);
				yield* Effect.annotateCurrentSpan({ key: primary });
				const version = versionOf(paths);
				if (paths.length === 0) {
					return yield* Effect.fail(
						new ActionCacheError({ reason: "archiveFailed", key: primary, detail: "no paths were given to cache" }),
					);
				}
				yield* withArchive(primary, (archive) =>
					Effect.gen(function* () {
						// `-P` keeps leading separators, so an absolute path is stored
						// verbatim and restored where it came from rather than under the
						// working directory of whichever step happens to restore it.
						yield* tar(["czPf", archive, ...paths], primary, false);
						const size = yield* fs
							.stat(archive)
							.pipe(Effect.mapError((cause) => new ActionCacheError({ reason: "archiveFailed", key: primary, cause })));

						const created = yield* call("CreateCacheEntry", { key: primary, version }, primary);
						// A conflict means another job saved this key first. Entries are
						// immutable, so the cache holds what the caller wanted.
						if (created === CONFLICT) {
							return;
						}
						const url = stringField(created, "signedUploadUrl");
						if (!isOk(created) || url === undefined) {
							return yield* Effect.fail(
								new ActionCacheError({
									reason: "refused",
									key: primary,
									detail: "CreateCacheEntry returned no upload url",
								}),
							);
						}
						yield* transfer.uploadFile(url, archive).pipe(moved(primary));

						const finalized = yield* call(
							"FinalizeCacheEntryUpload",
							{ key: primary, version, size_bytes: String(size.size) },
							primary,
						);
						// An unfinalized upload leaves an archive in Azure that no lookup
						// can reach — a silent no-op that reads as a successful save.
						if (finalized === CONFLICT || !isOk(finalized)) {
							return yield* Effect.fail(
								new ActionCacheError({
									reason: "refused",
									key: primary,
									detail: "FinalizeCacheEntryUpload did not confirm the upload",
								}),
							);
						}
					}),
				);
			}),

			restore: Effect.fn("ActionCache.restore")(function* (
				paths: ReadonlyArray<string>,
				key: string | CacheKey,
				restoreKeys?: ReadonlyArray<string>,
			) {
				const { primary, fallbacks } = ladder(key, restoreKeys);
				yield* Effect.annotateCurrentSpan({ key: primary });
				const version = versionOf(paths);
				const found = yield* call(
					"GetCacheEntryDownloadURL",
					{ key: primary, restore_keys: [...fallbacks], version },
					primary,
				);
				if (found === CONFLICT || !isOk(found)) {
					return Option.none<string>();
				}
				const url = stringField(found, "signedDownloadUrl");
				if (url === undefined) {
					return Option.none<string>();
				}
				yield* withArchive(primary, (archive) =>
					Effect.gen(function* () {
						yield* transfer.downloadToFile(url, archive).pipe(moved(primary));
						yield* tar([windows ? "xzPkf" : "xzPf", archive], primary, windows);
					}),
				);
				// The matched key is what the caller branches on: a hit on a restore
				// key is a partial hit, and re-saving under the primary key is the
				// whole point of knowing the difference.
				return Option.some(stringField(found, "matchedKey") ?? primary);
			}),
		} satisfies ActionCacheShape;
	});

const unimplemented = (member: string): never => {
	throw new Error(`ActionCache.makeTest: ${member}() was called but not stubbed — pass a \`${member}\` override.`);
};

/**
 * The runner's own cache: archive a set of paths under a key, and get them back
 * in a later job.
 *
 * @remarks
 * Speaks the Actions cache **Twirp v2** protocol at `ACTIONS_RESULTS_URL`,
 * which answers with a pre-signed Azure blob url for the archive itself. No
 * `@actions/cache` dependency — that package alone brings a dependency tree
 * larger than this one.
 *
 * **Only reachable from a `uses:` step.** The runner injects
 * `ACTIONS_RESULTS_URL` and `ACTIONS_RUNTIME_TOKEN` into action execution
 * contexts and not into `run:` shell steps, so the identical code fails as
 * `misconfigured` when a workflow invokes it with `node ./main.js`. The failure
 * names the absent variable, because nothing else distinguishes the two cases.
 *
 * @example
 * ```ts
 * import { ActionCache, CacheKey } from "@effected/github-actions";
 * import { Effect, Option } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const cache = yield* ActionCache;
 *   const key = CacheKey.of("Linux", "pnpm-store", "abc123");
 *   const hit = yield* cache.restore(["~/.pnpm-store"], key);
 *   if (Option.isNone(hit)) {
 *     yield* cache.save(["~/.pnpm-store"], key);
 *   }
 * });
 * ```
 *
 * @public
 */
export class ActionCache extends Context.Service<ActionCache, ActionCacheShape>()(
	"@effected/github-actions/ActionCache",
) {
	/** The cache, over the real Azure client and the real `tar`. */
	static readonly layer: Layer.Layer<
		ActionCache,
		never,
		| ActionEnvironment
		| HttpClient.HttpClient
		| FileSystem.FileSystem
		| Path.Path
		| ChildProcessSpawner.ChildProcessSpawner
	> = Layer.effect(this, make(azure));

	/**
	 * The cache, over a supplied transport.
	 *
	 * @remarks
	 * The protocol, the version derivation, the conflict handling and the archive
	 * are what this package owns; the pre-signed `PUT` is not. Supplying the
	 * transport is what lets a test exercise all of the first group without the
	 * second, and what an integration test uses to point the same protocol at a
	 * local blob endpoint.
	 *
	 * A parameterized layer factory mints a fresh layer per call and layers
	 * memoize by reference — bind it to a `const` rather than calling it at each
	 * composition site.
	 */
	static readonly layerWith = (
		transfer: FileBlobTransfer,
	): Layer.Layer<
		ActionCache,
		never,
		| ActionEnvironment
		| HttpClient.HttpClient
		| FileSystem.FileSystem
		| Path.Path
		| ChildProcessSpawner.ChildProcessSpawner
	> => Layer.effect(ActionCache, make(transfer));

	/** A test double. Unstubbed members die rather than reporting a miss. */
	static readonly makeTest = (overrides: Partial<ActionCacheShape> = {}): ActionCacheShape => ({
		save: () => Effect.sync(() => unimplemented("save")),
		restore: () => Effect.sync(() => unimplemented("restore")),
		...overrides,
	});

	/** {@link ActionCache.makeTest} behind `Layer.succeed`. */
	static readonly layerTest = (overrides: Partial<ActionCacheShape> = {}): Layer.Layer<ActionCache> =>
		Layer.succeed(ActionCache, ActionCache.makeTest(overrides));
}
