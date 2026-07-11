// Git-based change detection, with the v3 progressive-disclosure shape kept
// intact: changedFiles → changedPackages → affectedPackages, three depths of
// analysis on one service.
//
// It runs git through the `GitReader` contract rather than a platform
// `CommandExecutor`, so a test provides a deterministic fake and needs no
// repository on disk.

import { Context, Effect, Layer, Schema } from "effect";
import { DependencyGraph } from "./DependencyGraph.js";
import { GitCommandError, GitReader } from "./GitReader.js";
import type { WorkspaceDiscoveryFailure } from "./WorkspaceDiscovery.js";
import { WorkspaceDiscovery } from "./WorkspaceDiscovery.js";
import type { WorkspacePackage } from "./WorkspacePackage.js";

/**
 * Which git refs to compare, and whether to fold in the working tree.
 *
 * @example
 * ```ts
 * import { ChangeDetectionOptions } from "@effected/workspaces";
 *
 * ChangeDetectionOptions.make({});                       // HEAD~1...HEAD
 * ChangeDetectionOptions.make({ base: "origin/main" });  // against a branch
 * ```
 *
 * @public
 */
export class ChangeDetectionOptions extends Schema.Class<ChangeDetectionOptions>("ChangeDetectionOptions")({
	/**
	 * The ref to compare against.
	 *
	 * @defaultValue `"HEAD~1"`
	 */
	base: Schema.String.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed("HEAD~1")),
		Schema.withConstructorDefault(Effect.succeed("HEAD~1")),
	),
	/**
	 * The ref to compare to.
	 *
	 * @defaultValue `"HEAD"`
	 */
	head: Schema.String.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed("HEAD")),
		Schema.withConstructorDefault(Effect.succeed("HEAD")),
	),
	/**
	 * Whether to include staged, unstaged and untracked working-tree changes on
	 * top of the committed range.
	 *
	 * @defaultValue `false`
	 */
	includeUncommitted: Schema.Boolean.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(false)),
		Schema.withConstructorDefault(Effect.succeed(false)),
	),
}) {}

/**
 * Raised when change detection cannot proceed: git is unavailable, or the
 * workspace it should run against cannot be discovered.
 *
 * @remarks
 * A git command that merely *fails* surfaces as {@link GitCommandError}
 * directly. This error is the wrapper for the case where detection has no
 * ground to stand on.
 *
 * @public
 */
export class ChangeDetectionError extends Schema.TaggedErrorClass<ChangeDetectionError>()("ChangeDetectionError", {
	/** The operation that could not run. */
	operation: Schema.String,
	/** The originating failure. */
	cause: Schema.Defect(),
}) {
	/** Renders the failed operation into a one-line message. */
	override get message(): string {
		return `Change detection failed during ${this.operation}`;
	}
}

/**
 * Every failure the change-detection methods can surface.
 *
 * @public
 */
export type ChangeDetectionFailure = ChangeDetectionError | GitCommandError | WorkspaceDiscoveryFailure;

/**
 * The {@link ChangeDetector} service shape.
 *
 * @public
 */
export interface ChangeDetectorShape {
	/** The file paths (workspace-root-relative, as git reports them) changed in the range. */
	readonly changedFiles: (
		options?: ChangeDetectionOptions,
	) => Effect.Effect<ReadonlyArray<string>, ChangeDetectionFailure>;
	/** The workspace packages owning those files. */
	readonly changedPackages: (
		options?: ChangeDetectionOptions,
	) => Effect.Effect<ReadonlyArray<WorkspacePackage>, ChangeDetectionFailure>;
	/** Those packages plus every workspace package that transitively depends on one. */
	readonly affectedPackages: (
		options?: ChangeDetectionOptions,
	) => Effect.Effect<ReadonlyArray<WorkspacePackage>, ChangeDetectionFailure>;
}

/**
 * Detects which workspace packages a git range touches.
 *
 * @remarks
 * Three depths on one service, cheapest first — raw file paths, the packages
 * owning them, and the transitive blast radius through the dependency graph.
 *
 * @example
 * ```ts
 * import { ChangeDetectionOptions, ChangeDetector } from "@effected/workspaces";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const detector = yield* ChangeDetector;
 *   const affected = yield* detector.affectedPackages(
 *     ChangeDetectionOptions.make({ base: "origin/main" }),
 *   );
 *   return affected.map((pkg) => pkg.name);
 * });
 * ```
 *
 * @public
 */
export class ChangeDetector extends Context.Service<ChangeDetector, ChangeDetectorShape>()(
	"@effected/workspaces/ChangeDetector",
) {
	/** Builds the service over {@link GitReader} and {@link WorkspaceDiscovery}. */
	static readonly make: Effect.Effect<ChangeDetectorShape, never, GitReader | WorkspaceDiscovery> = Effect.gen(
		function* () {
			const git = yield* GitReader;
			const discovery = yield* WorkspaceDiscovery;

			const lines = (cwd: string, args: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, GitCommandError> =>
				git.run(cwd, args).pipe(
					Effect.map((output) =>
						output
							.split("\n")
							.map((line) => line.trim())
							.filter((line) => line.length > 0),
					),
				);

			/** The changed files of the range, plus the working tree when asked. */
			const filesOf = (
				root: string,
				options: ChangeDetectionOptions,
			): Effect.Effect<ReadonlyArray<string>, ChangeDetectionFailure> =>
				Effect.gen(function* () {
					const available = yield* git.available(root);
					if (!available) {
						return yield* Effect.fail(
							new GitCommandError({
								kind: "unavailable",
								args: ["rev-parse", "--git-dir"],
								cwd: root,
								stderr: "",
							}),
						);
					}

					const committed = yield* lines(root, ["diff", "--name-only", `${options.base}...${options.head}`]);
					if (!options.includeUncommitted) return [...committed].sort();

					const unstaged = yield* lines(root, ["diff", "--name-only"]);
					const staged = yield* lines(root, ["diff", "--name-only", "--cached"]);
					const untracked = yield* lines(root, ["ls-files", "--others", "--exclude-standard"]);
					return [...new Set([...committed, ...unstaged, ...staged, ...untracked])].sort();
				});

			/**
			 * git reports paths relative to the repository root; discovery indexes
			 * packages by absolute path. The workspace root is the bridge — and it is
			 * the workspace root, not the git root, because a workspace nested inside
			 * a larger repository is legitimate.
			 */
			const rootOf = (): Effect.Effect<string, WorkspaceDiscoveryFailure> =>
				discovery.info().pipe(Effect.map((info) => info.root));

			const packagesOf = (
				options: ChangeDetectionOptions,
			): Effect.Effect<ReadonlyArray<WorkspacePackage>, ChangeDetectionFailure> =>
				Effect.gen(function* () {
					const root = yield* rootOf();
					const files = yield* filesOf(root, options);
					const absolute = files.map((file) => (file.startsWith("/") ? file : `${root}/${file}`));
					return yield* discovery.resolveFiles(absolute);
				});

			return {
				changedFiles: Effect.fn("ChangeDetector.changedFiles")(function* (options?: ChangeDetectionOptions) {
					const root = yield* rootOf();
					const files = yield* filesOf(root, options ?? ChangeDetectionOptions.make({}));
					yield* Effect.logDebug("Changed files detected").pipe(
						Effect.annotateLogs("workspace.files.count", files.length),
					);
					return files;
				}),

				changedPackages: Effect.fn("ChangeDetector.changedPackages")(function* (options?: ChangeDetectionOptions) {
					const packages = yield* packagesOf(options ?? ChangeDetectionOptions.make({}));
					yield* Effect.logDebug("Changed packages detected").pipe(
						Effect.annotateLogs("workspace.packages.count", packages.length),
					);
					return packages;
				}),

				affectedPackages: Effect.fn("ChangeDetector.affectedPackages")(function* (options?: ChangeDetectionOptions) {
					const changed = yield* packagesOf(options ?? ChangeDetectionOptions.make({}));
					const all = yield* discovery.listPackages();
					const graph = DependencyGraph.make({ packages: all });
					const names = yield* graph.affectedBy(changed.map((pkg) => pkg.name));
					const byName = new Map(all.map((pkg) => [pkg.name, pkg]));
					const affected = names
						.map((name) => byName.get(name))
						.filter((pkg): pkg is WorkspacePackage => pkg !== undefined);
					yield* Effect.logDebug("Affected packages detected").pipe(
						Effect.annotateLogs("workspace.packages.count", affected.length),
					);
					return affected;
				}),
			};
		},
	);

	/** The live layer. */
	static readonly layer: Layer.Layer<ChangeDetector, never, GitReader | WorkspaceDiscovery> = Layer.effect(
		ChangeDetector,
		ChangeDetector.make,
	);
}
