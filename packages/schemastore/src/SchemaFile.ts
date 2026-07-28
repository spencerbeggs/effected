// The `SchemaFile` service — the package's only IO module. It reads and
// writes emitted schema documents over core `FileSystem` / `Path` (v4, no
// platform package), so the layer requires those services and the consumer
// provides a platform implementation (`@effect/platform-node`) at the edge.
// Mirrors `@effected/package-json`'s `PackageJsonFile` pattern.

import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import type { CanonicalJsonError, CanonicalJsonOptions } from "./CanonicalJson.js";
import type { StoreDocument } from "./StoreDocument.js";

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Indicates that a schema file could not be read from the filesystem (a
 * filesystem error other than not-found).
 *
 * @public
 */
export class SchemaFileReadError extends Schema.TaggedErrorClass<SchemaFileReadError>()("SchemaFileReadError", {
	/** The path that could not be read. */
	path: Schema.String,
	/** The underlying filesystem failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Failed to read schema file from "${this.path}"`;
	}
}

/**
 * Indicates that no schema file exists at the expected path. Carries its
 * own tag for `catchTag` routing.
 *
 * @public
 */
export class SchemaFileNotFoundError extends Schema.TaggedErrorClass<SchemaFileNotFoundError>()(
	"SchemaFileNotFoundError",
	{
		/** The path where the schema file was expected. */
		path: Schema.String,
	},
) {
	override get message(): string {
		return `Schema file not found at "${this.path}"`;
	}
}

/**
 * Indicates that a schema file could not be written to the filesystem.
 * Narrowed to the filesystem failure only — a serialization failure
 * surfaces as its own `CanonicalJsonError`, never wrapped here.
 *
 * @public
 */
export class SchemaFileWriteError extends Schema.TaggedErrorClass<SchemaFileWriteError>()("SchemaFileWriteError", {
	/** The path that could not be written. */
	path: Schema.String,
	/** The underlying filesystem failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Failed to write schema file to "${this.path}"`;
	}
}

/**
 * What {@link SchemaFileShape.write} did: `"written"` when the file's
 * content changed (or the file was created), `"unchanged"` when the
 * on-disk bytes already matched — reported as a value so the caller
 * decides what to surface, never a log.
 *
 * @public
 */
export type WriteOutcome = "written" | "unchanged";

/**
 * The shape of the {@link SchemaFile} service — the value produced by
 * {@link SchemaFile.make} and carried by its layer.
 *
 * @public
 */
export interface SchemaFileShape {
	/**
	 * Read a schema file's exact text (the drift-test read side: compare it
	 * against `StoreDocument.serializeResult`). Fails with
	 * `SchemaFileNotFoundError` (ENOENT) or `SchemaFileReadError` (other
	 * filesystem errors).
	 */
	readonly read: (path: string) => Effect.Effect<string, SchemaFileReadError | SchemaFileNotFoundError>;
	/**
	 * Serialize a document to canonical JSON and write it **only if the
	 * on-disk content differs** (a missing file counts as different),
	 * creating parent directories as needed. Answers the
	 * {@link WriteOutcome} as a value. Fails with a `CanonicalJsonError`
	 * (the document does not serialize), `SchemaFileReadError` (the
	 * existing content could not be read for comparison) or
	 * `SchemaFileWriteError` (the filesystem write failed).
	 */
	readonly write: (
		path: string,
		document: StoreDocument,
		options?: CanonicalJsonOptions,
	) => Effect.Effect<WriteOutcome, CanonicalJsonError | SchemaFileReadError | SchemaFileWriteError>;
}

/**
 * Reads and writes emitted schema documents over core `FileSystem` /
 * `Path` — the package's one IO surface. The layer requires those
 * services; provide `@effect/platform-node`'s `NodeFileSystem` / `NodePath`
 * (or a bun equivalent) at the application boundary.
 *
 * `write` is write-if-changed: serialization goes through the owned
 * `CanonicalJson` (equal documents serialize to equal bytes), so an
 * unchanged document never touches the file — a generator committed to a
 * repo does not churn mtimes, and its CI drift check is `read` + compare.
 *
 * @example
 * ```ts
 * import { SchemaFile, StoreDocument } from "@effected/schemastore";
 * import { NodeFileSystem, NodePath } from "@effect/platform-node";
 * import { Effect, Layer, Schema } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const files = yield* SchemaFile;
 *   const document = yield* StoreDocument.fromSchema(Schema.Struct({ name: Schema.String }), {
 *     $id: "https://example.com/config.schema.json",
 *   });
 *   return yield* files.write("schemas/config.schema.json", document);
 * }).pipe(
 *   Effect.provide(SchemaFile.layer),
 *   Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
 * );
 * ```
 *
 * @public
 */
export class SchemaFile extends Context.Service<SchemaFile, SchemaFileShape>()("@effected/schemastore/SchemaFile") {
	/** Build the service implementation from `FileSystem` / `Path` in context; use {@link SchemaFile.layer} to provide it. */
	static readonly make: Effect.Effect<SchemaFileShape, never, FileSystem.FileSystem | Path.Path> = Effect.gen(
		function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;

			const read = Effect.fn("SchemaFile.read")(function* (target: string) {
				// Read directly — no `exists` pre-check (that TOCTOU race reports
				// a file deleted between the two calls as SchemaFileReadError).
				// The core FileSystem fails with a PlatformError whose
				// `reason._tag` is "NotFound" for a missing file; route only
				// that to NotFound.
				return yield* fs
					.readFileString(target)
					.pipe(
						Effect.mapError((cause) =>
							cause.reason._tag === "NotFound"
								? SchemaFileNotFoundError.make({ path: target })
								: SchemaFileReadError.make({ path: target, cause }),
						),
					);
			});

			const write = Effect.fn("SchemaFile.write")(function* (
				target: string,
				document: StoreDocument,
				options?: CanonicalJsonOptions,
			) {
				const text = yield* Effect.fromResult(document.serializeResult(options));
				// A missing file is simply "different" (proceed to write); any
				// other read failure is surfaced — if the content cannot be
				// compared, silently overwriting would defeat the contract.
				const existing = yield* fs
					.readFileString(target)
					.pipe(
						Effect.catch(
							(cause): Effect.Effect<string | undefined, SchemaFileReadError> =>
								cause.reason._tag === "NotFound"
									? Effect.succeed(undefined)
									: Effect.fail(SchemaFileReadError.make({ path: target, cause })),
						),
					);
				if (existing === text) {
					return "unchanged" as const;
				}
				yield* fs
					.makeDirectory(path.dirname(target), { recursive: true })
					.pipe(Effect.mapError((cause) => SchemaFileWriteError.make({ path: target, cause })));
				yield* fs
					.writeFileString(target, text)
					.pipe(Effect.mapError((cause) => SchemaFileWriteError.make({ path: target, cause })));
				return "written" as const;
			});

			return { read, write };
		},
	);

	/**
	 * The live layer. Requires core `FileSystem` / `Path`, provided by the
	 * consumer's platform implementation at the edge.
	 */
	static readonly layer: Layer.Layer<SchemaFile, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
		SchemaFile,
		SchemaFile.make,
	);
}
