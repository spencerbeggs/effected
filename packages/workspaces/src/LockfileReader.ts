// The IO half of `@effected/lockfiles`.
//
// The extraction drew the seam at `content: string`: lockfiles is pure and
// parses text, workspaces finds the root, detects the manager, reads the file
// and — for pnpm — supplies the importer-path → name map that the pure
// `Lockfile.withImporterNames` second stage needs. That map is built here
// because building it requires reading every workspace `package.json`, which is
// IO, which is precisely what a pure package cannot do.

import type {
	Lockfile,
	LockfileFormat,
	LockfileFramingError,
	LockfileParseError,
	ResolvedPackage,
} from "@effected/lockfiles";
import { LockfileIntegrity, Lockfile as LockfileModel, filenameFor } from "@effected/lockfiles";
import { Context, Duration, Effect, Exit, FileSystem, Layer, Option, Path, Schema } from "effect";
import type { PackageManagerDetectionFailure } from "./PackageManagerName.js";
import { PackageManagerDetector } from "./PackageManagerName.js";
import type { WorkspaceDiscoveryFailure } from "./WorkspaceDiscovery.js";
import { WorkspaceDiscovery } from "./WorkspaceDiscovery.js";
import type { WorkspaceRootNotFoundError } from "./WorkspaceRoot.js";
import { WorkspaceRoot } from "./WorkspaceRoot.js";

/**
 * Raised when the workspace's lockfile cannot be read off disk.
 *
 * @remarks
 * Parse failures are `@effected/lockfiles`' `LockfileParseError`, not this —
 * this is strictly the IO half.
 *
 * @public
 */
export class LockfileReadError extends Schema.TaggedErrorClass<LockfileReadError>()("LockfileReadError", {
	/** Absolute path to the lockfile that could not be read. */
	lockfilePath: Schema.String,
	/** The format the detected package manager implies. */
	format: Schema.Literals(["bun", "npm", "pnpm", "yarn"]),
	/** The originating failure. */
	cause: Schema.Defect(),
}) {
	/** Renders the unreadable path into a one-line message. */
	override get message(): string {
		return `Cannot read ${this.format} lockfile at ${this.lockfilePath}`;
	}
}

/**
 * Every failure the lockfile methods can surface — the exported init-error
 * union the review named best-in-class DX.
 *
 * @remarks
 * Layer construction does no IO, so every member surfaces from the *methods*
 * rather than from `Layer.build`: the root cannot be found, no package manager
 * can be attributed to it (or its manifest is corrupt), its lockfile cannot be
 * read, the lockfile is malformed, or the lockfile's YAML stream carries no
 * lockfile document.
 *
 * @public
 */
export type LockfileReadFailure =
	| WorkspaceRootNotFoundError
	| PackageManagerDetectionFailure
	| LockfileReadError
	| LockfileParseError
	| LockfileFramingError;

/**
 * The {@link LockfileReader} service shape.
 *
 * @public
 */
export interface LockfileReaderShape {
	/** The parsed lockfile, with pnpm importer paths already resolved to real names. */
	readonly read: () => Effect.Effect<Lockfile, LockfileReadFailure>;
	/**
	 * The lockfile's record of a package, when it records one.
	 *
	 * @remarks
	 * A name can resolve at **several versions** in one lockfile (two members
	 * depending on different majors of the same package). This returns the
	 * **first** entry in lockfile order and does not attempt to rank them — there
	 * is no single "the" version to return, and picking the highest semver would
	 * imply a resolution decision this reader is not entitled to make. Callers
	 * that must see every resolution should read `lockfile.packagesNamed(name)`
	 * off `read()` directly.
	 */
	readonly resolvedVersion: (packageName: string) => Effect.Effect<Option.Option<ResolvedPackage>, LockfileReadFailure>;
	/**
	 * Whether the lockfile agrees with the workspace manifests on disk — the
	 * pure `LockfileIntegrity.compare`, fed the manifests this package reads.
	 */
	readonly integrity: () => Effect.Effect<LockfileIntegrity, LockfileReadFailure | WorkspaceDiscoveryFailure>;
	/** Drop the memoized read so the next call re-reads the lockfile. */
	readonly refresh: () => Effect.Effect<void>;
}

/**
 * Options for the {@link LockfileReader} layer.
 *
 * @public
 */
export interface LockfileReaderOptions {
	/**
	 * The directory the workspace root is resolved from.
	 *
	 * @defaultValue `process.cwd()`, read lazily on first use.
	 */
	readonly cwd?: string;
}

/**
 * Reads and parses the workspace's lockfile.
 *
 * @remarks
 * Layer construction is O(1). The root walk, package-manager detection, file
 * read, parse and pnpm name resolution all happen on the first method call and
 * are memoized success-only for the lifetime of the layer.
 *
 * @example
 * ```ts
 * import { LockfileReader } from "@effected/workspaces";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const reader = yield* LockfileReader;
 *   const lockfile = yield* reader.read();
 *   return lockfile.packages.length;
 * });
 * ```
 *
 * @public
 */
export class LockfileReader extends Context.Service<LockfileReader, LockfileReaderShape>()(
	"@effected/workspaces/LockfileReader",
) {
	/** Builds the service. */
	static readonly make = (
		options?: LockfileReaderOptions,
	): Effect.Effect<
		LockfileReaderShape,
		never,
		WorkspaceRoot | PackageManagerDetector | WorkspaceDiscovery | FileSystem.FileSystem | Path.Path
	> =>
		Effect.gen(function* () {
			const roots = yield* WorkspaceRoot;
			const detector = yield* PackageManagerDetector;
			const discovery = yield* WorkspaceDiscovery;
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;

			const init: Effect.Effect<Lockfile, LockfileReadFailure> = Effect.gen(function* () {
				const root = yield* Effect.suspend(() => roots.find(options?.cwd ?? process.cwd()));
				const detected = yield* detector.detect(root);
				// `PackageManagerName` and `LockfileFormat` are the same four literals;
				// the assignment is what makes the two concepts interoperate for free.
				const format: LockfileFormat = detected.name;
				const lockfilePath = path.join(root, filenameFor(format));

				const content = yield* fs
					.readFileString(lockfilePath)
					.pipe(Effect.mapError((cause) => new LockfileReadError({ lockfilePath, format, cause })));

				// `Lockfile.parse` owns YAML-stream framing as of `@effected/lockfiles`
				// #58: `pnpm-lock.yaml` is a stream, and pnpm's writer always emits the
				// config-dependencies document as a PREFIX, so the real lockfile is
				// deterministically the last one. This reader used to select the document
				// itself; the pure package now does it correctly, and a stream carrying no
				// lockfile document fails typed as a `LockfileFramingError`.
				const lockfile = yield* LockfileModel.parse(content, { format });
				if (format !== "pnpm") return lockfile;

				// The pure second stage. pnpm names workspace packages by IMPORTER PATH;
				// only reading each `package.json` turns those into real names, and that
				// read is IO — which is exactly why the stage lives here and not in the
				// pure package.
				//
				// Bounded at concurrency 10, matching `WorkspaceDiscovery`'s per-package
				// read: a large workspace should not serialize one read per member.
				const importers = lockfile.packages.filter(
					(pkg): pkg is typeof pkg & { readonly relativePath: string } =>
						pkg.isWorkspace && pkg.relativePath !== undefined,
				);
				const resolved = yield* Effect.forEach(
					importers,
					(pkg) =>
						readName(path.join(root, pkg.relativePath, "package.json")).pipe(
							Effect.map((name) => [pkg.relativePath, name] as const),
						),
					{ concurrency: 10 },
				);
				const names = new Map<string, string>();
				for (const [relativePath, name] of resolved) {
					if (Option.isSome(name)) names.set(relativePath, name.value);
				}
				return lockfile.withImporterNames(names);
			});

			/** A workspace member's name, or none — an unreadable manifest is a miss, not a failure. */
			const readName = (manifestPath: string): Effect.Effect<Option.Option<string>> =>
				Effect.gen(function* () {
					const content = yield* fs.readFileString(manifestPath).pipe(Effect.orElseSucceed(() => ""));
					if (content === "") return Option.none<string>();
					// `JSON.parse` returns `undefined` for nothing: a manifest of `null`
					// parses to `null`, and reading `.name` off it would throw a TypeError
					// as an unhandled DEFECT. Narrow to a plain object before touching it.
					const parsed = yield* Effect.try({
						try: () => JSON.parse(content) as unknown,
						catch: () => undefined,
					}).pipe(Effect.orElseSucceed(() => undefined as unknown));
					if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return Option.none<string>();
					const name = (parsed as Record<string, unknown>).name;
					return typeof name === "string" && name.length > 0 ? Option.some(name) : Option.none<string>();
				});

			const [resolveOnce, invalidate] = yield* Effect.cachedInvalidateWithTTL(init, Duration.infinity);
			const memo = Effect.onExit(resolveOnce, (exit) => (Exit.isSuccess(exit) ? Effect.void : invalidate));

			return {
				read: Effect.fn("LockfileReader.read")(function* () {
					return yield* memo;
				}),

				resolvedVersion: Effect.fn("LockfileReader.resolvedVersion")(function* (packageName: string) {
					const lockfile = yield* memo;
					const matches = lockfile.packagesNamed(packageName);
					return Option.fromUndefinedOr(matches[0]);
				}),

				integrity: Effect.fn("LockfileReader.integrity")(function* () {
					const lockfile = yield* memo;
					const packages = yield* discovery.listPackages();
					return LockfileIntegrity.compare(
						lockfile,
						packages.map((pkg) => pkg.toWorkspaceManifest()),
					);
				}),

				refresh: () => invalidate,
			};
		});

	/**
	 * The live layer.
	 *
	 * @remarks
	 * Parameterized, so it mints a fresh reference per call — bind it to a
	 * `const` and reuse it.
	 */
	static readonly layer = (
		options?: LockfileReaderOptions,
	): Layer.Layer<
		LockfileReader,
		never,
		WorkspaceRoot | PackageManagerDetector | WorkspaceDiscovery | FileSystem.FileSystem | Path.Path
	> => Layer.effect(LockfileReader, LockfileReader.make(options));
}
