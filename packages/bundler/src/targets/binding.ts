import type { PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";
import type { TargetResolution } from "./config.js";

/**
 * Write the target-to-group binding to dist/prod/targets.json for the release action to consume. Returns the path.
 *
 * @public
 */
export const writeTargetsBinding: (
	cwd: string,
	resolution: TargetResolution,
) => Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> = Effect.fnUntraced(
	function* (cwd, resolution) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const dir = path.join(cwd, "dist", "prod");
		yield* fs.makeDirectory(dir, { recursive: true });
		const file = path.join(dir, "targets.json");
		yield* fs.writeFileString(file, `${JSON.stringify(resolution, null, "\t")}\n`);
		return file;
	},
);
