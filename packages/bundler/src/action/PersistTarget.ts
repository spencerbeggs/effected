import { Effect, FileSystem, Option, Path, Schema } from "effect";
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
	/** The real workspace root, which every file a persist writes must stay inside. */
	root: Schema.String,
}) {}

const STAGING = ".action-staging";

/**
 * Whether `child` is `parent` or lies below it, by the platform's own rules: `resolveWithin` refuses a relative path
 * that climbs out with `..` and its separator, and an absolute one such as another drive's.
 *
 * @internal
 */
export const within = (path: Path.Path, parent: string, child: string): boolean =>
	Option.isSome(path.resolveWithin(parent, path.relative(parent, child)));

/**
 * Resolves `[action.persistLocal]` against a package and its workspace root.
 *
 * @public
 */
export class PersistTarget {
	/** The staging directory's name, under the package. */
	static readonly STAGING = STAGING;

	/**
	 * Resolves the persist target, realpathing `cwd` and `root` as `ActionBundle.build` does, and the output path's
	 * deepest existing ancestor, so the returned `outputPath` is the real directory a persist writes to.
	 *
	 * @remarks
	 * Fails with `PersistPathError` when the path leaves the workspace, when a workspace-based path lands inside the
	 * package, when a package-based path lands in its `dist` or its staging directory, when it is, or contains, the
	 * package (which includes the workspace root), when it is or lies inside another package (any directory below the
	 * root holding a `package.json`), or when `dist = false` leaves nothing persisted.
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
			const lexical = path.resolve(base === "package" ? cwd : root, configured);
			// Every check runs on the real path: an existing ancestor that is a symlink would carry the writes wherever it
			// points, so the deepest existing ancestor is realpathed and the missing tail put back on it.
			let existing = lexical;
			const tail: Array<string> = [];
			while (
				existing !== path.dirname(existing) &&
				!(yield* fs.exists(existing).pipe(Effect.orElseSucceed(() => false)))
			) {
				tail.unshift(path.basename(existing));
				existing = path.dirname(existing);
			}
			const outputPath = path.join(yield* real(existing), ...tail);

			if (!within(path, root, outputPath)) {
				return yield* new PersistPathError({ path: outputPath, reason: "outside-workspace" });
			}
			if (base === "workspace" && within(path, cwd, outputPath)) {
				return yield* new PersistPathError({ path: outputPath, reason: "inside-package" });
			}
			if (base === "package") {
				// The build's own dist is cleaned and the staging directory removed, so a persist there is lost or recursive.
				for (const owned of ["dist", STAGING]) {
					if (within(path, path.join(cwd, owned), outputPath)) {
						return yield* new PersistPathError({ path: outputPath, reason: "inside-package" });
					}
				}
			}
			if (within(path, outputPath, cwd)) {
				return yield* new PersistPathError({ path: outputPath, reason: "contains-package" });
			}
			// Any directory strictly below the root, up to the output path itself, that holds a `package.json` is a
			// package a persist would overwrite. The package being built is an ancestor only under base = "package",
			// where its own dist and staging are already refused, so it is skipped.
			for (let dir = outputPath; dir !== root && dir !== path.dirname(dir); dir = path.dirname(dir)) {
				if (dir === cwd) break;
				const found = yield* fs.exists(path.join(dir, "package.json")).pipe(Effect.orElseSucceed(() => false));
				if (found) {
					return yield* new PersistPathError({ path: outputPath, reason: "inside-other-package", packageDir: dir });
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
				root,
			});
		});
}
