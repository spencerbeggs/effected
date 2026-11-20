import { Effect, FileSystem, Path, Schema } from "effect";
import type { ActionConfig } from "../config/ActionConfig.js";
import { PersistPathError } from "./ActionErrors.js";

/**
 * Where an action's build is persisted, with every path absolute.
 *
 * @public
 */
export class ResolvedPersist extends Schema.Class<ResolvedPersist>("ResolvedPersist")({
	/** Whether the build is persisted at all. */
	enabled: Schema.Boolean,
	/** What the persist path was relative to. */
	base: Schema.Literals(["package", "workspace"]),
	/** The persisted action directory. */
	outputPath: Schema.String,
	/** Whether the package's own `dist/` is kept. */
	keepDist: Schema.Boolean,
	/** The scratch directory a build stages into. */
	stagingDir: Schema.String,
	/** Whether the act boilerplate is generated. */
	actTemplate: Schema.Boolean,
	/** The directory the act boilerplate is rooted at: the package under `"package"`, the workspace under `"workspace"`. */
	actRoot: Schema.String,
}) {}

const STAGING = ".action-staging";

const escapes = (relative: string, isAbsolute: boolean): boolean =>
	isAbsolute || relative === ".." || relative.startsWith("../");

/**
 * Resolves `[action.persistLocal]` against a package and its workspace root.
 *
 * @public
 */
export class PersistTarget {
	/** The staging directory's name, under the package. */
	static readonly STAGING = STAGING;

	/**
	 * Resolves the persist target, realpathing `cwd` and `root` as `ActionBundle.build` does.
	 *
	 * @remarks
	 * Fails with `PersistPathError` when the path leaves the workspace, when a workspace-based path lands inside the
	 * package, or when `dist = false` leaves nothing persisted.
	 *
	 * @param config - The action's config.
	 * @param options - The package directory and the workspace root.
	 */
	static readonly resolve = (
		config: ActionConfig,
		options: { readonly cwd: string; readonly root: string },
	): Effect.Effect<ResolvedPersist, PersistPathError, FileSystem.FileSystem | Path.Path> =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const { enabled, base, dist } = config.persistLocal;

			if (!dist && !enabled) {
				return yield* new PersistPathError({ path: config.persistLocal.path ?? "", reason: "dist-without-persist" });
			}

			const real = (requested: string) => {
				const resolved = path.resolve(requested);
				return fs.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved));
			};
			const cwd = yield* real(options.cwd);
			const root = yield* real(options.root);

			const fallback = base === "package" ? ".github/actions/local" : `.github/actions/${path.basename(cwd)}`;
			const configured = config.persistLocal.path ?? fallback;
			const outputPath = path.resolve(base === "package" ? cwd : root, configured);

			const fromRoot = path.relative(root, outputPath);
			if (escapes(fromRoot, path.isAbsolute(fromRoot))) {
				return yield* new PersistPathError({ path: outputPath, reason: "outside-workspace" });
			}
			if (base === "workspace") {
				const fromCwd = path.relative(cwd, outputPath);
				if (!escapes(fromCwd, path.isAbsolute(fromCwd))) {
					return yield* new PersistPathError({ path: outputPath, reason: "inside-package" });
				}
			}

			return ResolvedPersist.make({
				enabled,
				base,
				outputPath,
				keepDist: dist,
				stagingDir: path.join(cwd, STAGING),
				actTemplate: config.persistLocal.actTemplate ?? base === "package",
				actRoot: base === "package" ? cwd : root,
			});
		});
}
