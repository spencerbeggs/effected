// The IO half of `@effected/lockfiles`.
//
// The extraction drew the seam at `content: string`: lockfiles is pure and
// parses text, workspaces finds the root, detects the manager, reads the file
// and — for pnpm — supplies the importer-path → name map that the pure
// `Lockfile.withImporterNames` second stage needs. That map is built here
// because building it requires reading every workspace `package.json`, which is
// IO, which is precisely what a pure package cannot do.

import type { Lockfile, LockfileFormat, LockfileParseError, ResolvedPackage } from "@effected/lockfiles";
import { LockfileIntegrity, Lockfile as LockfileModel, filenameFor } from "@effected/lockfiles";
import { Context, Duration, Effect, Exit, FileSystem, Layer, Option, Path, Schema } from "effect";
import { documentsOf } from "./internal/documents.js";
import type { PackageManagerDetectionError } from "./PackageManagerName.js";
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
 * Layer construction does no IO, so all four members surface from the *methods*
 * rather than from `Layer.build`: the root cannot be found, no package manager
 * can be attributed to it, its lockfile cannot be read, or the lockfile is
 * malformed.
 *
 * @public
 */
export type LockfileReadFailure =
	| WorkspaceRootNotFoundError
	| PackageManagerDetectionError
	| LockfileReadError
	| LockfileParseError;

/**
 * The {@link LockfileReader} service shape.
 *
 * @public
 */
export interface LockfileReaderShape {
	/** The parsed lockfile, with pnpm importer paths already resolved to real names. */
	readonly read: () => Effect.Effect<Lockfile, LockfileReadFailure>;
	/** The lockfile's record of a package, when it records one. */
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
 * Parse lockfile text, selecting the right YAML document first.
 *
 * pnpm 11 writes `pnpm-lock.yaml` as **two** documents when the workspace uses
 * `configDependencies` — a lockfile for the config dependencies, then the real
 * one — and a single-document parse silently returns the wrong one: a handful of
 * packages, no workspace importers, and no catalogs. It looks like an empty
 * workspace rather than a parse failure, which is the worst possible shape for a
 * bug.
 *
 * Every document is parsed and the richest result wins: most workspace packages,
 * then most packages overall. That is stable under document reordering, which
 * relying on "the last one" would not be. A single-document lockfile takes the
 * same path with one candidate and behaves identically.
 */
const parseLockfileText = (content: string, format: LockfileFormat): Effect.Effect<Lockfile, LockfileParseError> =>
	Effect.gen(function* () {
		if (format !== "pnpm") return yield* LockfileModel.parse(content, { format });

		const documents = documentsOf(content);
		if (documents.length === 1) return yield* LockfileModel.parse(documents[0], { format });

		// A document that does not parse is not a failure while another does — only
		// an all-documents failure is, and it surfaces as the LAST document's error.
		const parsed = yield* Effect.forEach(documents, (document) =>
			Effect.result(LockfileModel.parse(document, { format })),
		);
		const candidates = parsed.filter((result) => result._tag === "Success").map((result) => result.success);
		if (candidates.length === 0) return yield* LockfileModel.parse(documents[documents.length - 1], { format });

		const score = (lockfile: Lockfile): number =>
			lockfile.packages.filter((pkg) => pkg.isWorkspace).length * 1_000_000 + lockfile.packages.length;

		return candidates.reduce((best, candidate) => (score(candidate) > score(best) ? candidate : best));
	});

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

				const lockfile = yield* parseLockfileText(content, format);
				if (format !== "pnpm") return lockfile;

				// The pure second stage. pnpm names workspace packages by IMPORTER PATH;
				// only reading each `package.json` turns those into real names, and that
				// read is IO — which is exactly why the stage lives here and not in the
				// pure package.
				const names = new Map<string, string>();
				for (const pkg of lockfile.packages) {
					if (!pkg.isWorkspace || pkg.relativePath === undefined) continue;
					const manifestPath = path.join(root, pkg.relativePath, "package.json");
					const name = yield* readName(manifestPath);
					if (Option.isSome(name)) names.set(pkg.relativePath, name.value);
				}
				return lockfile.withImporterNames(names);
			});

			/** A workspace member's name, or none — an unreadable manifest is a miss, not a failure. */
			const readName = (manifestPath: string): Effect.Effect<Option.Option<string>> =>
				Effect.gen(function* () {
					const content = yield* fs.readFileString(manifestPath).pipe(Effect.orElseSucceed(() => ""));
					if (content === "") return Option.none<string>();
					const parsed = yield* Effect.try({
						try: () => JSON.parse(content) as Record<string, unknown>,
						catch: () => undefined,
					}).pipe(Effect.orElseSucceed(() => ({}) as Record<string, unknown>));
					const name = parsed.name;
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
