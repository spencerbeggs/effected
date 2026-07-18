// Workspace discovery: read the `packages:` patterns, enumerate them, decode a
// WorkspacePackage per directory.
//
// This module also folds in v3's `PackageResolver` (file → owning package,
// longest-prefix) — that service existed only so ChangeDetector could depend on
// it, and it is a lookup over discovery output, not a concern of its own.
//
// It is also where `@effected/npm`'s `WorkspaceResolver` contract is
// implemented: `versionOf` is a lookup over the discovered package list.

import { GlobSet } from "@effected/glob";
import { DependencyResolutionError, WorkspaceResolver } from "@effected/npm";
import { Context, Duration, Effect, Exit, FileSystem, Layer, Option, Path, Schema } from "effect";
import type { EnumerationFailureKind } from "./internal/enumerate.js";
import { enumerate } from "./internal/enumerate.js";
import { readPatterns } from "./internal/patterns.js";
import { WorkspacePackage } from "./WorkspacePackage.js";
import type { WorkspaceRootNotFoundError } from "./WorkspaceRoot.js";
import { WorkspaceRoot } from "./WorkspaceRoot.js";

/**
 * Raised when a workspace member's `package.json` cannot be read, parsed, or
 * used — it is missing, malformed, or lacks a `name` or `version`.
 *
 * @remarks
 * `kind` is the discriminant a caller branches on; `cause` preserves the
 * originating failure rather than flattening it into a sentence.
 *
 * @public
 */
export class WorkspaceDiscoveryError extends Schema.TaggedErrorClass<WorkspaceDiscoveryError>()(
	"WorkspaceDiscoveryError",
	{
		/** The workspace root discovery was running against. */
		root: Schema.String,
		/** The file that failed. */
		path: Schema.String,
		/** What went wrong with it. */
		kind: Schema.Literals(["read", "invalidJson", "invalidShape", "invalidYaml", "missingName", "missingVersion"]),
		/** The originating failure, if there was one. */
		cause: Schema.Defect(),
	},
) {
	/** Renders the failing file and kind into a one-line message. */
	override get message(): string {
		return `Workspace discovery failed at ${this.path} (${this.kind})`;
	}
}

/**
 * Raised when a `packages:` pattern cannot be enumerated: its base directory is
 * absent (usually a typo), the descent exceeded its depth cap, or the visit
 * budget was exhausted.
 *
 * @public
 */
export class WorkspacePatternError extends Schema.TaggedErrorClass<WorkspacePatternError>()("WorkspacePatternError", {
	/** The workspace root the patterns were expanded against. */
	root: Schema.String,
	/** The offending pattern, verbatim. */
	pattern: Schema.String,
	/** Why it could not be enumerated. */
	kind: Schema.Literals(["missingBaseDir", "uncompilable", "depthExceeded", "budgetExceeded", "unreadableDirectory"]),
	/** A short, structured detail — the missing directory, or the bound exceeded. */
	detail: Schema.String,
}) {
	/** Renders the pattern and failure kind into a one-line message. */
	override get message(): string {
		return `Workspace pattern "${this.pattern}" could not be enumerated (${this.kind}: ${this.detail})`;
	}
}

/**
 * Raised when a workspace package is requested by a name no member carries.
 *
 * @remarks
 * `available` lists every known member, which is what makes the error
 * actionable — a typo is obvious next to the list it missed.
 *
 * @public
 */
export class PackageNotFoundError extends Schema.TaggedErrorClass<PackageNotFoundError>()("PackageNotFoundError", {
	/** The name that was requested. */
	name: Schema.String,
	/** Every workspace package name that does exist. */
	available: Schema.Array(Schema.String),
}) {
	/** Renders the requested name into a one-line message. */
	override get message(): string {
		return `No workspace package named "${this.name}"`;
	}
}

/**
 * Top-level facts about a workspace: where it is, what manages it, and the
 * patterns that define its membership.
 *
 * @public
 */
export class WorkspaceInfo extends Schema.Class<WorkspaceInfo>("WorkspaceInfo")({
	/** Absolute path to the workspace root. */
	root: Schema.String,
	/** The `packages:` patterns, verbatim. */
	patterns: Schema.Array(Schema.String),
}) {}

/**
 * Every failure `WorkspaceDiscovery.getPackage` can surface: the discovery
 * failures plus a name that matches no member.
 *
 * @public
 */
export type WorkspaceLookupFailure =
	| WorkspaceRootNotFoundError
	| WorkspaceDiscoveryError
	| WorkspacePatternError
	| PackageNotFoundError;

/**
 * The error channel of the discovery methods that do not look a package up by
 * name — everything except `getPackage`.
 *
 * @public
 */
export type WorkspaceDiscoveryFailure = Exclude<WorkspaceLookupFailure, PackageNotFoundError>;

/** The enumeration failure kinds map straight onto the pattern-error kinds. */
const patternKindOf = (
	kind: EnumerationFailureKind,
): "missingBaseDir" | "depthExceeded" | "budgetExceeded" | "unreadableDirectory" => kind;

/**
 * Options for the {@link WorkspaceDiscovery} layer.
 *
 * @public
 */
export interface WorkspaceDiscoveryOptions {
	/**
	 * The directory the workspace root is resolved from.
	 *
	 * @defaultValue `process.cwd()`, read lazily on first use — so a
	 *   `process.chdir` between providing the layer and the first call is
	 *   honoured.
	 */
	readonly cwd?: string;
	/** Descent cap for segment-crossing patterns. Defaults to 32. */
	readonly maxDepth?: number;
}

/**
 * The {@link WorkspaceDiscovery} service shape.
 *
 * @public
 */
export interface WorkspaceDiscoveryShape {
	/** Facts about the resolved workspace. */
	readonly info: () => Effect.Effect<WorkspaceInfo, WorkspaceDiscoveryFailure>;
	/** Every workspace package, root first, then the rest sorted by relative path. */
	readonly listPackages: () => Effect.Effect<ReadonlyArray<WorkspacePackage>, WorkspaceDiscoveryFailure>;
	/** The discovered packages keyed by their root-relative importer path. */
	readonly importerMap: () => Effect.Effect<ReadonlyMap<string, WorkspacePackage>, WorkspaceDiscoveryFailure>;
	/** A single package by name. */
	readonly getPackage: (name: string) => Effect.Effect<WorkspacePackage, WorkspaceLookupFailure>;
	/** The package owning an absolute file path, by longest-prefix match. */
	readonly resolveFile: (filePath: string) => Effect.Effect<Option.Option<WorkspacePackage>, WorkspaceDiscoveryFailure>;
	/** The distinct packages owning any of `filePaths`. */
	readonly resolveFiles: (
		filePaths: ReadonlyArray<string>,
	) => Effect.Effect<ReadonlyArray<WorkspacePackage>, WorkspaceDiscoveryFailure>;
	/** Drop the memoized discovery so the next call re-reads the filesystem. */
	readonly refresh: () => Effect.Effect<void>;
}

/**
 * Discovers the packages of a workspace.
 *
 * @remarks
 * Layer construction is O(1): the root walk, pattern read, enumeration and
 * per-package decode all happen on the first method call and are memoized for
 * the lifetime of the layer. A Vitest reporter that builds the layer per call
 * site and never queries it pays nothing.
 *
 * The memo is **success-only**. `Effect.cached` memoizes the first `Exit`,
 * *including an interrupt* — an init interrupted by an unrelated timeout would
 * otherwise brick the layer permanently with a cause outside its declared error
 * channel. A failure or interrupt is therefore retried on the next call, which
 * is a deliberate behaviour change from the v3 library.
 *
 * @example
 * ```ts
 * import { WorkspaceDiscovery } from "@effected/workspaces";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* WorkspaceDiscovery;
 *   const packages = yield* discovery.listPackages();
 *   return packages.map((p) => p.name);
 * });
 * ```
 *
 * @public
 */
export class WorkspaceDiscovery extends Context.Service<WorkspaceDiscovery, WorkspaceDiscoveryShape>()(
	"@effected/workspaces/WorkspaceDiscovery",
) {
	/**
	 * Builds the service. Root resolution is one explicit concern: `cwd` is an
	 * option here, never an ambient `process.cwd()` read inside a method.
	 */
	static readonly make = (
		options?: WorkspaceDiscoveryOptions,
	): Effect.Effect<WorkspaceDiscoveryShape, never, WorkspaceRoot | FileSystem.FileSystem | Path.Path> =>
		Effect.gen(function* () {
			const roots = yield* WorkspaceRoot;
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;

			/** Read one `package.json` into the tolerant discovery projection. */
			const readPackage = (
				root: string,
				directory: string,
				relativePath: string,
			): Effect.Effect<WorkspacePackage, WorkspaceDiscoveryError> =>
				Effect.gen(function* () {
					const packageJsonPath = path.join(directory, "package.json");
					const content = yield* fs
						.readFileString(packageJsonPath)
						.pipe(
							Effect.mapError(
								(cause) => new WorkspaceDiscoveryError({ root, path: packageJsonPath, kind: "read", cause }),
							),
						);
					const parsed = yield* Effect.try({
						try: () => JSON.parse(content) as unknown,
						catch: (cause) => new WorkspaceDiscoveryError({ root, path: packageJsonPath, kind: "invalidJson", cause }),
					});

					// `JSON.parse` never returns `undefined`, so a guard on `undefined`
					// alone does not cover a manifest whose entire content is `null`, `42`
					// or `"x"` — all of which parse fine. Reading `.name` off `null` would
					// throw a TypeError, i.e. malformed input escaping as a DEFECT.
					//
					// This is `invalidShape`, NOT `invalidJson`: the text is perfectly valid
					// JSON. What is wrong is that it does not denote an object.
					if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
						return yield* Effect.fail(
							new WorkspaceDiscoveryError({
								root,
								path: packageJsonPath,
								kind: "invalidShape",
								cause: new Error("package.json is not a JSON object"),
							}),
						);
					}
					const raw = parsed as Record<string, unknown>;

					const name = raw.name;
					if (typeof name !== "string" || name.length === 0) {
						return yield* Effect.fail(
							new WorkspaceDiscoveryError({
								root,
								path: packageJsonPath,
								kind: "missingName",
								cause: undefined,
							}),
						);
					}
					const version = raw.version;
					if (typeof version !== "string" || version.length === 0) {
						return yield* Effect.fail(
							new WorkspaceDiscoveryError({
								root,
								path: packageJsonPath,
								kind: "missingVersion",
								cause: undefined,
							}),
						);
					}

					// The tolerant projection: decoded through the schema, so a malformed
					// dependency map fails typed rather than corrupting the model — but
					// never through package-json's strict semver `Package`, which would
					// fail discovery for the whole repo over one odd version string.
					return yield* Schema.decodeUnknownEffect(WorkspacePackage)({
						name,
						version,
						path: directory,
						packageJsonPath,
						relativePath,
						// The as-read record rides along so consumers reach fields outside
						// the discovery slice without a second file read.
						manifestRecord: raw,
						...(typeof raw.private === "boolean" ? { private: raw.private } : {}),
						...(isStringRecord(raw.dependencies) ? { dependencies: raw.dependencies } : {}),
						...(isStringRecord(raw.devDependencies) ? { devDependencies: raw.devDependencies } : {}),
						...(isStringRecord(raw.peerDependencies) ? { peerDependencies: raw.peerDependencies } : {}),
						...(isStringRecord(raw.optionalDependencies) ? { optionalDependencies: raw.optionalDependencies } : {}),
						...(raw.publishConfig !== undefined && raw.publishConfig !== null
							? { publishConfig: raw.publishConfig }
							: {}),
					}).pipe(
						Effect.catchTag(
							"SchemaError",
							// A well-formed JSON document whose SHAPE the schema rejects — not a
							// syntax error. A consumer branching on `kind` must be able to tell
							// "this file is not JSON" from "this file is JSON I cannot use".
							(cause) => new WorkspaceDiscoveryError({ root, path: packageJsonPath, kind: "invalidShape", cause }),
						),
					);
				});

			const discover: Effect.Effect<
				{ readonly info: WorkspaceInfo; readonly packages: ReadonlyArray<WorkspacePackage> },
				WorkspaceDiscoveryFailure
			> = Effect.gen(function* () {
				// `Effect.suspend` so the ambient cwd is read at first use, not at
				// layer construction.
				const root = yield* Effect.suspend(() => roots.find(options?.cwd ?? process.cwd()));

				const patterns = yield* readPatterns(root).pipe(
					Effect.mapError(
						(failure) =>
							new WorkspaceDiscoveryError({
								root,
								path: failure.path,
								kind: failure.kind,
								cause: failure.cause,
							}),
					),
				);

				const globs = yield* GlobSet.compile(patterns).pipe(
					Effect.mapError(
						(error) =>
							new WorkspacePatternError({
								root,
								pattern: error.pattern,
								kind: "uncompilable",
								detail: error.message,
							}),
					),
				);

				const directories = yield* enumerate(root, globs, { maxDepth: options?.maxDepth ?? 32 }).pipe(
					Effect.mapError(
						(failure) =>
							new WorkspacePatternError({
								root,
								pattern: failure.pattern,
								kind: patternKindOf(failure.kind),
								detail: failure.detail,
							}),
					),
				);

				const members = yield* Effect.forEach(
					directories.filter((entry) => entry.relativePath !== "." && entry.path !== root),
					(entry) => readPackage(root, entry.path, entry.relativePath),
					{ concurrency: 10 },
				);

				const rootPackage = yield* readPackage(root, root, ".");
				const packages = [rootPackage, ...members];

				yield* Effect.logDebug("Workspace packages discovered").pipe(
					Effect.annotateLogs({ "workspace.root": root, "workspace.packages.count": packages.length }),
				);

				return { info: WorkspaceInfo.make({ root, patterns }), packages };
			}).pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(Path.Path, path));

			// Success-only memoization. See the class remarks: a bare `Effect.cached`
			// would memoize an interrupt and permanently brick the layer.
			const [resolveOnce, invalidate] = yield* Effect.cachedInvalidateWithTTL(discover, Duration.infinity);
			const memo = Effect.onExit(resolveOnce, (exit) => (Exit.isSuccess(exit) ? Effect.void : invalidate));

			const packages = memo.pipe(Effect.map((state) => state.packages));

			/**
			 * The longest-prefix index, built once per package list.
			 *
			 * Keyed on the package array's identity: the memo hands back the *same*
			 * array on every call, so this is a hit for the whole life of the memo, and
			 * `refresh()` produces a fresh array — a cache miss — which is exactly the
			 * invalidation we want. No staleness is representable.
			 */
			const ownerIndexes = new WeakMap<
				ReadonlyArray<WorkspacePackage>,
				ReadonlyArray<{ readonly prefix: string; readonly package: WorkspacePackage }>
			>();

			const owners = (
				all: ReadonlyArray<WorkspacePackage>,
			): ReadonlyArray<{ readonly prefix: string; readonly package: WorkspacePackage }> => {
				const cached = ownerIndexes.get(all);
				if (cached !== undefined) return cached;
				const index = all
					.map((pkg) => ({
						prefix: pkg.path.endsWith(path.sep) ? pkg.path : pkg.path + path.sep,
						package: pkg,
					}))
					.sort((a, b) => b.prefix.length - a.prefix.length);
				ownerIndexes.set(all, index);
				return index;
			};

			const ownerOf = (
				filePath: string,
				index: ReadonlyArray<{ readonly prefix: string; readonly package: WorkspacePackage }>,
			): Option.Option<WorkspacePackage> => {
				for (const entry of index) {
					if (filePath.startsWith(entry.prefix)) return Option.some(entry.package);
				}
				return Option.none();
			};

			return {
				info: Effect.fn("WorkspaceDiscovery.info")(function* () {
					const state = yield* memo;
					return state.info;
				}),

				listPackages: Effect.fn("WorkspaceDiscovery.listPackages")(function* () {
					return yield* packages;
				}),

				importerMap: Effect.fn("WorkspaceDiscovery.importerMap")(function* () {
					const all = yield* packages;
					return new Map(all.map((pkg) => [pkg.relativePath, pkg]));
				}),

				getPackage: Effect.fn("WorkspaceDiscovery.getPackage")(function* (name: string) {
					const all = yield* packages;
					const found = all.find((pkg) => pkg.name === name);
					if (found !== undefined) return found;
					return yield* Effect.fail(new PackageNotFoundError({ name, available: all.map((pkg) => pkg.name) }));
				}),

				resolveFile: Effect.fn("WorkspaceDiscovery.resolveFile")(function* (filePath: string) {
					const all = yield* packages;
					return ownerOf(filePath, owners(all));
				}),

				resolveFiles: Effect.fn("WorkspaceDiscovery.resolveFiles")(function* (filePaths: ReadonlyArray<string>) {
					const all = yield* packages;
					const index = owners(all);
					const seen = new Map<string, WorkspacePackage>();
					for (const filePath of filePaths) {
						const owner = ownerOf(filePath, index);
						if (Option.isSome(owner)) seen.set(owner.value.name, owner.value);
					}
					return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
				}),

				refresh: () => invalidate,
			};
		});

	/**
	 * The live layer.
	 *
	 * @remarks
	 * A parameterized layer factory mints a **fresh reference per call**, and
	 * layers memoize by reference — bind the result to a `const` and reuse it
	 * rather than calling `layer(...)` at each composition site.
	 */
	static readonly layer = (
		options?: WorkspaceDiscoveryOptions,
	): Layer.Layer<WorkspaceDiscovery, never, WorkspaceRoot | FileSystem.FileSystem | Path.Path> =>
		Layer.effect(WorkspaceDiscovery, WorkspaceDiscovery.make(options));

	/**
	 * An in-memory test double of the service shape, with every method
	 * defaulted so a test stubs only what it exercises.
	 *
	 * @remarks
	 * The defaults model an **empty workspace**, and the derived methods run
	 * over the *effective* `listPackages` — the override when one is supplied —
	 * so stubbing only `listPackages` yields a consistent double:
	 *
	 * - `listPackages` — succeeds with `[]`.
	 * - `importerMap` — derived: the packages keyed by `relativePath`.
	 * - `getPackage` — derived: a name lookup that fails with the service's own
	 *   typed {@link PackageNotFoundError} on a miss, exactly as the live
	 *   implementation does.
	 * - `resolveFile` / `resolveFiles` — derived: longest-prefix ownership over
	 *   `pkg.path`, POSIX-terminated (`"/"`); supply a win32 double explicitly
	 *   if your fixture paths are win32.
	 * - `refresh` — a no-op (`Effect.void`); there is nothing memoized to drop.
	 * - `info` — **dies** with an explanatory defect. No honest default exists
	 *   (a fabricated root path would leak into consumer path logic), so an
	 *   unstubbed `info()` call is a test-wiring mistake and fails loudly as a
	 *   defect rather than succeeding with a lie or failing with a dishonest
	 *   typed error.
	 *
	 * @example
	 * ```ts
	 * import { WorkspaceDiscovery, WorkspacePackage } from "@effected/workspaces";
	 * import { Effect } from "effect";
	 *
	 * const double = WorkspaceDiscovery.makeTest({
	 *   listPackages: () =>
	 *     Effect.succeed([
	 *       WorkspacePackage.make({
	 *         name: "@my-org/utils",
	 *         version: "1.0.0",
	 *         path: "/repo/packages/utils",
	 *         packageJsonPath: "/repo/packages/utils/package.json",
	 *         relativePath: "packages/utils",
	 *       }),
	 *     ]),
	 * });
	 * // `getPackage`, `importerMap`, `resolveFile(s)` now answer consistently.
	 * ```
	 */
	static readonly makeTest = (overrides: Partial<WorkspaceDiscoveryShape> = {}): WorkspaceDiscoveryShape => {
		const listPackages = overrides.listPackages ?? (() => Effect.succeed([]));

		// POSIX-terminated longest-prefix ownership, mirroring the live
		// `resolveFile` semantics minus the platform `Path` service.
		const ownerOf = (filePath: string, all: ReadonlyArray<WorkspacePackage>): Option.Option<WorkspacePackage> => {
			let best: WorkspacePackage | undefined;
			let bestLength = 0;
			for (const pkg of all) {
				const prefix = pkg.path.endsWith("/") ? pkg.path : `${pkg.path}/`;
				if (filePath.startsWith(prefix) && prefix.length > bestLength) {
					best = pkg;
					bestLength = prefix.length;
				}
			}
			return Option.fromUndefinedOr(best);
		};

		return {
			listPackages,
			info: () =>
				Effect.die(
					new Error(
						"WorkspaceDiscovery.makeTest: info() was called but not stubbed — no honest default WorkspaceInfo exists for a test double; pass an `info` override.",
					),
				),
			importerMap: () => Effect.map(listPackages(), (all) => new Map(all.map((pkg) => [pkg.relativePath, pkg]))),
			getPackage: (name: string) =>
				Effect.flatMap(listPackages(), (all) => {
					const found = all.find((pkg) => pkg.name === name);
					return found !== undefined
						? Effect.succeed(found)
						: Effect.fail(new PackageNotFoundError({ name, available: all.map((pkg) => pkg.name) }));
				}),
			resolveFile: (filePath: string) => Effect.map(listPackages(), (all) => ownerOf(filePath, all)),
			resolveFiles: (filePaths: ReadonlyArray<string>) =>
				Effect.map(listPackages(), (all) => {
					const seen = new Map<string, WorkspacePackage>();
					for (const filePath of filePaths) {
						const owner = ownerOf(filePath, all);
						if (Option.isSome(owner)) seen.set(owner.value.name, owner.value);
					}
					return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
				}),
			refresh: () => Effect.void,
			...overrides,
		};
	};

	/**
	 * The test layer: {@link WorkspaceDiscovery.makeTest} behind
	 * `Layer.succeed`, so a suite provides only the methods it exercises.
	 *
	 * @remarks
	 * A parameterized layer factory mints a **fresh reference per call**, and
	 * layers memoize by reference — bind the result to a `const` and reuse it
	 * rather than calling `layerTest(...)` at each composition site.
	 *
	 * @example
	 * ```ts
	 * import { WorkspaceDiscovery } from "@effected/workspaces";
	 * import { Effect } from "effect";
	 *
	 * const TestDiscovery = WorkspaceDiscovery.layerTest({
	 *   listPackages: () => Effect.succeed([]),
	 * });
	 * // program.pipe(Effect.provide(TestDiscovery))
	 * ```
	 */
	static readonly layerTest = (overrides: Partial<WorkspaceDiscoveryShape> = {}): Layer.Layer<WorkspaceDiscovery> =>
		Layer.succeed(WorkspaceDiscovery, WorkspaceDiscovery.makeTest(overrides));

	/**
	 * The real implementation of `@effected/npm`'s `WorkspaceResolver` contract
	 * — the one `@effected/package-json` declares but cannot fill.
	 *
	 * @remarks
	 * `versionOf` returns `Option.none()` for a name that is not a workspace
	 * member, per the contract's convention; the `DependencyResolutionError`
	 * channel is reserved for a failure of the resolution *mechanism* (an
	 * unfindable root, an unreadable manifest), never an ordinary miss.
	 *
	 * @example
	 * ```ts
	 * import { Package } from "@effected/package-json";
	 * import { WorkspaceDiscovery } from "@effected/workspaces";
	 * import { Layer } from "effect";
	 *
	 * const resolvers = WorkspaceDiscovery.workspaceResolver.pipe(
	 *   Layer.provide(WorkspaceDiscovery.layer()),
	 * );
	 * // `Package.resolve` now resolves `workspace:*` for real.
	 * ```
	 */
	static readonly workspaceResolver: Layer.Layer<WorkspaceResolver, never, WorkspaceDiscovery> = Layer.effect(
		WorkspaceResolver,
		Effect.gen(function* () {
			const discovery = yield* WorkspaceDiscovery;
			return {
				versionOf: (packageName: string) =>
					discovery.listPackages().pipe(
						Effect.map((all) => Option.fromUndefinedOr(all.find((pkg) => pkg.name === packageName)?.version)),
						Effect.mapError((cause) => new DependencyResolutionError({ specifier: `workspace:${packageName}`, cause })),
					),
			};
		}),
	);
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
	value !== null &&
	typeof value === "object" &&
	!Array.isArray(value) &&
	Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string");
