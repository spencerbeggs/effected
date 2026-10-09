import { Context, Effect, FileSystem, Layer, Option, Path, Random } from "effect";
import { ImageBackendError } from "./ImageBackendError.js";

/**
 * Bytes and media type a backend holds for one key.
 *
 * @public
 */
export interface StoredImage {
	readonly value: Uint8Array;
	readonly contentType: string;
}

/**
 * What {@link ImageBackendShape.set} writes.
 *
 * @public
 */
export interface ImageBackendSetParams {
	readonly key: string;
	readonly value: Uint8Array;
	readonly contentType?: string;
	readonly tags?: ReadonlyArray<string>;
}

/**
 * The port an image cache stores through.
 *
 * @remarks
 * `@effected/store`'s `Cache` satisfies this shape structurally.
 *
 * @public
 */
export interface ImageBackendShape {
	readonly get: (key: string) => Effect.Effect<Option.Option<StoredImage>, ImageBackendError>;
	readonly set: (params: ImageBackendSetParams) => Effect.Effect<void, ImageBackendError>;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/avif": "avif",
};
const CONTENT_TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]));
const DIGEST = /^[0-9a-f]{64}$/;

const assertDigest = (key: string): Effect.Effect<void> =>
	DIGEST.test(key)
		? Effect.void
		: Effect.die(new TypeError(`image backend key ${JSON.stringify(key)} is not a 64-char hex digest`));

/**
 * The storage port behind `ImageCache`.
 *
 * @public
 */
export class ImageBackend extends Context.Service<ImageBackend, ImageBackendShape>()("@effected/images/ImageBackend") {
	/**
	 * A backend over one directory: `<directory>/<key>.<ext>`.
	 *
	 * @remarks
	 * Writes go to a temp file in the same directory and are renamed into place, so a failed or interrupted write
	 * never leaves a file that reads as a hit. Tags are accepted and ignored — a directory has no tag index. Keys must
	 * be 64-char lowercase hex digests (as `ImageCacheKey` produces); anything else is a defect, so a key can never
	 * name a path outside the directory. No expiry or eviction.
	 *
	 * Each call mints a fresh layer; bind the result to a `const` or the backend builds twice.
	 */
	static layerDirectory(options: {
		readonly directory: string;
	}): Layer.Layer<ImageBackend, never, FileSystem.FileSystem | Path.Path> {
		return Layer.effect(
			ImageBackend,
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const fileFor = (key: string, ext: string) => path.join(options.directory, `${key}.${ext}`);

				const get = (key: string): Effect.Effect<Option.Option<StoredImage>, ImageBackendError> =>
					Effect.gen(function* () {
						yield* assertDigest(key);
						for (const [ext, contentType] of Object.entries(CONTENT_TYPES)) {
							const bytes = yield* fs.readFile(fileFor(key, ext)).pipe(
								Effect.map(Option.some),
								Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
								Effect.mapError((cause) => new ImageBackendError({ operation: "get", key, cause })),
							);
							if (Option.isSome(bytes)) return Option.some({ value: bytes.value, contentType });
						}
						return Option.none();
					}).pipe(Effect.withSpan("ImageBackend.get"));

				const set = (params: ImageBackendSetParams): Effect.Effect<void, ImageBackendError> =>
					Effect.gen(function* () {
						yield* assertDigest(params.key);
						const ext =
							params.contentType !== undefined && Object.hasOwn(EXTENSIONS, params.contentType)
								? EXTENSIONS[params.contentType]
								: undefined;
						if (ext === undefined) {
							return yield* new ImageBackendError({
								operation: "set",
								key: params.key,
								cause: new Error(`unsupported content type ${JSON.stringify(params.contentType ?? null)}`),
							});
						}
						const target = fileFor(params.key, ext);
						const suffix = yield* Random.nextIntBetween(0, 0x7fffffff);
						const temp = path.join(options.directory, `.${params.key}.${suffix.toString(36)}.tmp`);
						// Stale other-format files are removed BEFORE the rename. Removing them after would let two concurrent
						// writers of different formats each delete the other's freshly renamed file, leaving no hit at all.
						// Removing first can at worst leave two complete files, and get's fixed extension order picks one.
						const write = Effect.gen(function* () {
							yield* fs.makeDirectory(options.directory, { recursive: true });
							yield* fs.writeFile(temp, params.value);
							for (const other of Object.keys(CONTENT_TYPES)) {
								if (other !== ext) yield* fs.remove(fileFor(params.key, other), { force: true });
							}
							yield* fs.rename(temp, target);
						});
						yield* write.pipe(
							Effect.onError(() => fs.remove(temp, { force: true }).pipe(Effect.ignore)),
							Effect.mapError((cause) => new ImageBackendError({ operation: "set", key: params.key, cause })),
						);
					}).pipe(Effect.withSpan("ImageBackend.set"));

				return { get, set };
			}),
		);
	}
}
