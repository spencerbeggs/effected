import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TargetResolution } from "./config.js";

/**
 * Write the target-to-group binding to dist/prod/targets.json for the release action to consume. Returns the path.
 *
 * @public
 */
export function writeTargetsBinding(cwd: string, resolution: TargetResolution): string {
	const dir = join(cwd, "dist", "prod");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "targets.json");
	writeFileSync(path, `${JSON.stringify(resolution, null, "\t")}\n`, "utf-8");
	return path;
}
