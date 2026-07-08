/**
 * The {@link PackageJsonFile} service — the **only** IO module. It reads and
 * writes package.json over **core** `FileSystem` / `Path` (v4, no
 * `@effect/platform` peer), so the layer requires those services and the
 * consumer provides a platform implementation (`@effect/platform-node`) at the
 * edge. Merges v3's `PackageJsonReader` + `PackageJsonWriter`; resolution is
 * **not** fused into `write` (compose {@link Package.resolve} explicitly).
 *
 * @packageDocumentation
 */

import type { Cause } from "effect";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import type { PackageDecodeError, PackageFormatOptions } from "./Package.js";
import { Package } from "./Package.js";

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Schema-generated base class backing {@link PackageJsonReadError}. Not meant to
 * be referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const PackageJsonReadError_base: Schema.Class<
	PackageJsonReadError,
	Schema.TaggedStruct<"PackageJsonReadError", { readonly path: typeof Schema.String; readonly cause: Schema.Defect }>,
	Cause.YieldableError
> = Schema.TaggedErrorClass<PackageJsonReadError>()("PackageJsonReadError", {
	/** The path that could not be read. */
	path: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
});

/**
 * Indicates that a package.json file could not be read from the filesystem
 * (a filesystem error other than not-found).
 *
 * @public
 */
export class PackageJsonReadError extends PackageJsonReadError_base {
	override get message(): string {
		return `Failed to read package.json from "${this.path}"`;
	}
}

/**
 * Schema-generated base class backing {@link PackageJsonNotFoundError}. Not
 * meant to be referenced directly — named and exported only so API Extractor
 * can resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const PackageJsonNotFoundError_base: Schema.Class<
	PackageJsonNotFoundError,
	Schema.TaggedStruct<"PackageJsonNotFoundError", { readonly path: typeof Schema.String }>,
	Cause.YieldableError
> = Schema.TaggedErrorClass<PackageJsonNotFoundError>()("PackageJsonNotFoundError", {
	/** The path where package.json was expected. */
	path: Schema.String,
});

/**
 * Indicates that no package.json file exists at the expected path. Carries its
 * own tag for `catchTag` routing.
 *
 * @public
 */
export class PackageJsonNotFoundError extends PackageJsonNotFoundError_base {
	override get message(): string {
		return `package.json not found at "${this.path}"`;
	}
}

/**
 * Schema-generated base class backing {@link PackageJsonParseError}. Not meant
 * to be referenced directly — named and exported only so API Extractor can
 * resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const PackageJsonParseError_base: Schema.Class<
	PackageJsonParseError,
	Schema.TaggedStruct<"PackageJsonParseError", { readonly path: typeof Schema.String; readonly cause: Schema.Defect }>,
	Cause.YieldableError
> = Schema.TaggedErrorClass<PackageJsonParseError>()("PackageJsonParseError", {
	/** The path whose contents failed to parse as JSON. */
	path: Schema.String,
	/** The underlying `SyntaxError`, preserved structurally. */
	cause: Schema.Defect(),
});

/**
 * Indicates that a package.json file's contents are not valid JSON.
 *
 * @public
 */
export class PackageJsonParseError extends PackageJsonParseError_base {
	override get message(): string {
		return `Failed to parse package.json at "${this.path}"`;
	}
}

/**
 * Schema-generated base class backing {@link PackageJsonWriteError}. Not meant
 * to be referenced directly — named and exported only so API Extractor can
 * resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const PackageJsonWriteError_base: Schema.Class<
	PackageJsonWriteError,
	Schema.TaggedStruct<"PackageJsonWriteError", { readonly path: typeof Schema.String; readonly cause: Schema.Defect }>,
	Cause.YieldableError
> = Schema.TaggedErrorClass<PackageJsonWriteError>()("PackageJsonWriteError", {
	/** The path that could not be written. */
	path: Schema.String,
	/** The underlying filesystem failure, preserved structurally. Narrowed to the write failure only. */
	cause: Schema.Defect(),
});

/**
 * Indicates that a package.json file could not be written to the filesystem.
 * Narrowed to the filesystem-write failure only — never a resolution or encode
 * error.
 *
 * @public
 */
export class PackageJsonWriteError extends PackageJsonWriteError_base {
	override get message(): string {
		return `Failed to write package.json to "${this.path}"`;
	}
}

/**
 * The shape of the {@link PackageJsonFile} service. Not meant to be referenced
 * directly — exported only because it appears in {@link PackageJsonFile_base}'s
 * public type, which API Extractor must resolve.
 *
 * @public
 */
export interface PackageJsonFileShape {
	/**
	 * Read and decode a package.json file. Fails with `PackageJsonNotFoundError`
	 * (ENOENT), `PackageJsonReadError` (other fs errors), `PackageJsonParseError`
	 * (invalid JSON) or `PackageDecodeError` (schema decode).
	 */
	readonly read: (
		path: string,
	) => Effect.Effect<
		Package,
		PackageJsonReadError | PackageJsonNotFoundError | PackageJsonParseError | PackageDecodeError
	>;
	/** Serialize and write a package.json file. Fails with `PackageJsonWriteError`. */
	readonly write: (
		path: string,
		pkg: Package,
		options?: PackageFormatOptions,
	) => Effect.Effect<void, PackageJsonWriteError>;
}

/**
 * Service-key base backing {@link PackageJsonFile}. Not meant to be referenced
 * directly — named and exported only so API Extractor can resolve the heritage
 * clause of the class it backs.
 *
 * @public
 */
export const PackageJsonFile_base: Context.ServiceClass<
	PackageJsonFile,
	"@effected/package-json/PackageJsonFile",
	PackageJsonFileShape
> = Context.Service<PackageJsonFile, PackageJsonFileShape>()("@effected/package-json/PackageJsonFile");

/**
 * Reads and writes package.json over core `FileSystem` / `Path`. The layer
 * requires those services; provide `@effect/platform-node`'s `NodeFileSystem` /
 * `NodePath` (or a bun equivalent) at the application boundary.
 *
 * @public
 */
export class PackageJsonFile extends PackageJsonFile_base {
	static readonly make: Effect.Effect<PackageJsonFileShape, never, FileSystem.FileSystem | Path.Path> = Effect.gen(
		function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;

			const read = Effect.fn("PackageJsonFile.read")(function* (target: string) {
				const exists = yield* fs
					.exists(target)
					.pipe(Effect.mapError((cause) => new PackageJsonReadError({ path: target, cause })));
				if (!exists) {
					return yield* new PackageJsonNotFoundError({ path: target });
				}
				const content = yield* fs
					.readFileString(target)
					.pipe(Effect.mapError((cause) => new PackageJsonReadError({ path: target, cause })));
				const json = yield* Effect.try({
					try: () => JSON.parse(content) as unknown,
					catch: (cause) => new PackageJsonParseError({ path: target, cause }),
				});
				return yield* Package.decode(json);
			});

			const write = Effect.fn("PackageJsonFile.write")(function* (
				target: string,
				pkg: Package,
				options?: PackageFormatOptions,
			) {
				const json = pkg.toJsonString(options);
				const directory = path.dirname(target);
				yield* fs
					.makeDirectory(directory, { recursive: true })
					.pipe(Effect.mapError((cause) => new PackageJsonWriteError({ path: target, cause })));
				yield* fs
					.writeFileString(target, json)
					.pipe(Effect.mapError((cause) => new PackageJsonWriteError({ path: target, cause })));
			});

			return { read, write };
		},
	);

	/**
	 * The live layer. Requires core `FileSystem` / `Path`, provided by the
	 * consumer's platform implementation at the edge.
	 */
	static readonly layer: Layer.Layer<PackageJsonFile, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
		PackageJsonFile,
		PackageJsonFile.make,
	);
}
