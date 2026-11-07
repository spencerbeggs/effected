/**
 * Default Node runtime embedded in the SEA (parity with the vitest-agent reference).
 *
 * @public
 */
export const DEFAULT_EXE_NODE_VERSION = "25.9.0";

/**
 * A resolved per-platform SEA target. `platform` uses the tsdown/\@tsdown/exe token (win, not win32).
 *
 * @public
 */
export interface ExeTarget {
	readonly platform: "darwin" | "linux" | "win";
	readonly arch: "arm64" | "x64";
	readonly nodeVersion: string;
}

/**
 * A target before nodeVersion defaulting (platform/arch only).
 *
 * @public
 */
export interface ExeTargetInput {
	readonly platform: "darwin" | "linux" | "win";
	readonly arch: "arm64" | "x64";
}

/**
 * SEA seaConfig overrides (subset; the rest are defaulted).
 *
 * @public
 */
export interface ExeSeaConfig {
	readonly disableExperimentalSEAWarning?: boolean | undefined;
	readonly useCodeCache?: boolean | undefined;
	readonly useSnapshot?: boolean | undefined;
}

/**
 * One SEA binary to compile.
 *
 * @public
 */
export interface ExeConfig {
	/** Output binary basename (no extension/suffix). */
	readonly fileName: string;
	/** Bin entry; defaults to ./src/bin.ts. */
	readonly entry?: string | undefined;
	/** Node runtime to embed; defaults to DEFAULT_EXE_NODE_VERSION. */
	readonly nodeVersion?: string | undefined;
	/** seaConfig overrides merged over the defaults. */
	readonly seaConfig?: ExeSeaConfig | undefined;
	/** Explicit targets; default inferred from the package os/cpu. */
	readonly targets?: ReadonlyArray<ExeTargetInput> | undefined;
}

/**
 * Fully-resolved SEA binary spec (no optionals).
 *
 * @public
 */
export interface NormalizedExe {
	readonly fileName: string;
	readonly entry: string;
	readonly targets: ReadonlyArray<ExeTarget>;
	readonly seaConfig: {
		readonly disableExperimentalSEAWarning: boolean;
		readonly useCodeCache: boolean;
		readonly useSnapshot: boolean;
	};
}

/**
 * The package's own os/cpu fields, used to infer a single platform target.
 *
 * @public
 */
export interface PkgOsCpu {
	readonly os: ReadonlyArray<string>;
	readonly cpu: ReadonlyArray<string>;
}

/** Map a package.json os value to the tsdown exe platform token. */
function platformToken(os: string): "darwin" | "linux" | "win" | undefined {
	if (os === "darwin") return "darwin";
	if (os === "linux") return "linux";
	if (os === "win32") return "win";
	return undefined;
}

/** Infer the default targets from the package's os/cpu (the zero-config, one-platform-per-package case). */
function inferTargets(pkg: PkgOsCpu): ReadonlyArray<ExeTargetInput> {
	const os = pkg.os[0];
	const cpu = pkg.cpu[0];
	if (os === undefined || cpu === undefined) return [];
	const platform = platformToken(os);
	if (platform === undefined || (cpu !== "arm64" && cpu !== "x64")) return [];
	return [{ platform, arch: cpu }];
}

/**
 * Normalize `exe` (object or array) into one fully-resolved spec per binary.
 *
 * Pure function; structural validation (missing fileName, empty targets) lives in the
 * config-validation layer.
 * @public
 */
export function normalizeExeOptions(
	exe: ExeConfig | ReadonlyArray<ExeConfig>,
	pkg: PkgOsCpu,
): ReadonlyArray<NormalizedExe> {
	const configs = Array.isArray(exe) ? exe : [exe];
	return configs.map((c) => {
		const nodeVersion = c.nodeVersion ?? DEFAULT_EXE_NODE_VERSION;
		const targetInputs = c.targets ?? inferTargets(pkg);
		return {
			fileName: c.fileName,
			entry: c.entry ?? "./src/bin.ts",
			targets: targetInputs.map((t: ExeTargetInput) => ({ platform: t.platform, arch: t.arch, nodeVersion })),
			seaConfig: {
				disableExperimentalSEAWarning: c.seaConfig?.disableExperimentalSEAWarning ?? true,
				useCodeCache: c.seaConfig?.useCodeCache ?? false,
				useSnapshot: c.seaConfig?.useSnapshot ?? false,
			},
		};
	});
}
