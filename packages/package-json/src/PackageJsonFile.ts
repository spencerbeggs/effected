// The `PackageJsonFile` service — the only IO module. It reads and writes
// package.json over core `FileSystem` / `Path` (v4, no `@effect/platform`
// peer), so the layer requires those services and the consumer provides a
// platform implementation (`@effect/platform-node`) at the edge. Merges v3's
// `PackageJsonReader` + `PackageJsonWriter`; resolution is not fused into
// `write` (compose `Package.resolve` explicitly).

import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import type { PackageDecodeError, PackageFormatOptions } from "./Package.js";
import { Package } from "./Package.js";

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Indicates that a package.json file could not be read from the filesystem
 * (a filesystem error other than not-found).
 *
 * @public
 */
export class PackageJsonReadError extends Schema.TaggedErrorClass<PackageJsonReadError>()("PackageJsonReadError", {
	/** The path that could not be read. */
	path: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Failed to read package.json from "${this.path}"`;
	}
}

/**
 * Indicates that no package.json file exists at the expected path. Carries its
 * own tag for `catchTag` routing.
 *
 * @public
 */
export class PackageJsonNotFoundError extends Schema.TaggedErrorClass<PackageJsonNotFoundError>()(
	"PackageJsonNotFoundError",
	{
		/** The path where package.json was expected. */
		path: Schema.String,
	},
) {
	override get message(): string {
		return `package.json not found at "${this.path}"`;
	}
}

/**
 * Indicates that a package.json file's contents are not valid JSON.
 *
 * @public
 */
export class PackageJsonParseError extends Schema.TaggedErrorClass<PackageJsonParseError>()("PackageJsonParseError", {
	/** The path whose contents failed to parse as JSON. */
	path: Schema.String,
	/** The underlying `SyntaxError`, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Failed to parse package.json at "${this.path}"`;
	}
}

/**
 * Indicates that a package.json file could not be written to the filesystem.
 * Narrowed to the filesystem-write failure only — never a resolution or encode
 * error.
 *
 * @public
 */
export class PackageJsonWriteError extends Schema.TaggedErrorClass<PackageJsonWriteError>()("PackageJsonWriteError", {
	/** The path that could not be written. */
	path: Schema.String,
	/** The underlying filesystem failure, preserved structurally. Narrowed to the write failure only. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Failed to write package.json to "${this.path}"`;
	}
}

/**
 * The shape of the {@link PackageJsonFile} service — the value produced by
 * {@link PackageJsonFile.make} and carried by its layer.
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
 * Reads and writes package.json over core `FileSystem` / `Path`. The layer
 * requires those services; provide `@effect/platform-node`'s `NodeFileSystem` /
 * `NodePath` (or a bun equivalent) at the application boundary.
 *
 * @example
 * ```ts
 * import { PackageJsonFile } from "@effected/package-json";
 * import { NodeFileSystem, NodePath } from "@effect/platform-node";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const files = yield* PackageJsonFile;
 *   const pkg = yield* files.read("./package.json");
 *   console.log(pkg.name);
 * }).pipe(Effect.provide(PackageJsonFile.layer), Effect.provide(NodeFileSystem.layer), Effect.provide(NodePath.layer));
 * ```
 *
 * @public
 */
export class PackageJsonFile extends Context.Service<PackageJsonFile, PackageJsonFileShape>()(
	"@effected/package-json/PackageJsonFile",
) {
	/** Build the service implementation from `FileSystem` / `Path` in context; use {@link PackageJsonFile.layer} to provide it. */
	static readonly make: Effect.Effect<PackageJsonFileShape, never, FileSystem.FileSystem | Path.Path> = Effect.gen(
		function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;

			const read = Effect.fn("PackageJsonFile.read")(function* (target: string) {
				// Read directly — no `exists` pre-check (that TOCTOU race reports a
				// file deleted between the two calls as PackageJsonReadError). The
				// core FileSystem fails with a PlatformError whose `reason._tag` is
				// "NotFound" for a missing file; route only that to NotFound.
				const content = yield* fs
					.readFileString(target)
					.pipe(
						Effect.mapError((cause) =>
							cause.reason._tag === "NotFound"
								? new PackageJsonNotFoundError({ path: target })
								: new PackageJsonReadError({ path: target, cause }),
						),
					);
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
