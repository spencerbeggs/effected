import type { ExeTarget } from "./config.js";

/**
 * The exact filename `@tsdown/exe` emits for a SEA target, mirroring tsdown's
 * `resolveOutputFileName`: base fileName + `-<platform>-<arch>` + `.exe` on win.
 * Single source of truth so the manifest value never drifts from the on-disk file.
 *
 * @public
 */
export function computeExeFileName(fileName: string, target: ExeTarget): string {
	const suffix = `-${target.platform}-${target.arch}`;
	const ext = target.platform === "win" ? ".exe" : "";
	return `${fileName}${suffix}${ext}`;
}
