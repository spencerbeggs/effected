import type { Option, PlatformError } from "effect";
import { Effect, FileSystem, Path, Schema } from "effect";
import { sameBytes, walk } from "./tree.js";

/**
 * One way a committed build differs from a fresh one.
 *
 * @remarks
 * `path` is relative to the target directory and `/`-separated. `missing` is in the build and not in the target,
 * `extra` is in the target and not in the build.
 *
 * @public
 */
export class DriftEntry extends Schema.Class<DriftEntry>("DriftEntry")({
	/** Which copy differs: the package's own `dist` or the persisted action directory. */
	target: Schema.Literals(["dist", "persisted"]),
	/** The file, relative to the target directory. */
	path: Schema.String,
	/** How it differs. */
	kind: Schema.Literals(["changed", "missing", "extra"]),
}) {}

/**
 * What {@link ActionCheck.compare} takes.
 *
 * @public
 */
export interface ActionCheckCompareOptions {
	/** The action's own `action.yml`, when it has one. */
	readonly stagedActionYml: Option.Option<string>;
	/** The freshly built bundles. */
	readonly stagedDist: string;
	/** The directory to compare against: the package `dist` for `"dist"`, the persisted action directory for `"persisted"`. */
	readonly targetDir: string;
	/** Which copy `targetDir` is. */
	readonly target: "dist" | "persisted";
	/** Whether `action.yml` is part of the comparison. */
	readonly includeActionYml: boolean;
}

const slash = (value: string): string => value.split("\\").join("/");

/**
 * Compares a fresh build against a committed copy of it.
 *
 * @public
 */
export class ActionCheck {
	private constructor() {}

	/**
	 * Lists every file where the target differs from the build, sorted by path.
	 *
	 * @remarks
	 * A `"persisted"` target holds the bundles under `dist/` beside `action.yml`, as {@link PersistLocal} lays them out,
	 * so its entries read `dist/main.js`; a `"dist"` target holds them at its root. Nothing else in a persisted directory
	 * is compared. A target directory that does not exist reports every file as `missing`.
	 */
	static readonly compare: (
		options: ActionCheckCompareOptions,
	) => Effect.Effect<ReadonlyArray<DriftEntry>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =
		Effect.fn("ActionCheck.compare")(function* (options: ActionCheckCompareOptions) {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const { target, targetDir } = options;
			const drift: Array<DriftEntry> = [];
			const note = (file: string, kind: DriftEntry["kind"]) =>
				drift.push(DriftEntry.make({ target, path: slash(file), kind }));

			const compareFile = Effect.fnUntraced(function* (built: string, committed: string, label: string) {
				if (!(yield* fs.exists(committed))) return note(label, "missing");
				if (!sameBytes(yield* fs.readFile(built), yield* fs.readFile(committed))) note(label, "changed");
			});

			const distTarget = target === "persisted" ? path.join(targetDir, "dist") : targetDir;
			const prefix = target === "persisted" ? "dist/" : "";
			const built = yield* walk(options.stagedDist, options.stagedDist);
			for (const file of built) {
				yield* compareFile(path.join(options.stagedDist, file), path.join(distTarget, file), prefix + slash(file));
			}
			const builtSet = new Set(built);
			for (const file of yield* walk(distTarget, distTarget)) {
				if (!builtSet.has(file)) note(prefix + slash(file), "extra");
			}

			if (options.includeActionYml) {
				const committed = path.join(targetDir, "action.yml");
				if (options.stagedActionYml._tag === "Some") {
					yield* compareFile(options.stagedActionYml.value, committed, "action.yml");
				} else if (yield* fs.exists(committed)) {
					note("action.yml", "extra");
				}
			}

			return drift.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		});
}
