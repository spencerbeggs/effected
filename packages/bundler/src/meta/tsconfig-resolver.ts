// packages/tsdown-plugins/src/meta/tsconfig-resolver.ts
import { existsSync } from "node:fs";
import * as nodePath from "node:path";
import { PortableTsconfig as PortableTsconfigFilter, TsconfigLoaderSync } from "@effected/tsconfig-json";
import { tsconfigSyncOptions } from "../tsconfig/sync-options.js";

/**
 * JSON schema URL for tsconfig.json files.
 * @internal
 */
const TSCONFIG_SCHEMA_URL = "https://json.schemastore.org/tsconfig";

/**
 * Compiler options with enum values converted to their string equivalents.
 *
 * @remarks
 * Open-ended record because TypeScript compiler options vary by version.
 *
 * @public
 */
export interface ResolvedCompilerOptions {
	[key: string]: unknown;
}

/**
 * Portable, JSON-serializable tsconfig.json (compilerOptions-only).
 *
 * @remarks
 * Designed for virtual TypeScript environments (shiki/Twoslash, API Extractor)
 * where file paths and emit settings are controlled externally. Holds no
 * machine-specific absolute paths and no emit/path/file-selection options.
 *
 * @public
 */
export interface PortableTsconfig {
	/** JSON schema for IDE support. */
	$schema: string;
	/** Compiler options with enum values converted to strings. */
	compilerOptions: ResolvedCompilerOptions;
}

/**
 * Resolves the package's effective compiler options (following `extends`) into a
 * portable, JSON-serializable tsconfig for the meta release bundle.
 *
 * @remarks
 * Resolves the package's own `<cwd>/tsconfig.json` (which extends the shared
 * `@savvy-web/bundler/ecma.json` base) via `@effected/tsconfig-json`'s
 * synchronous `TsconfigLoaderSync` (tsc-parity `extends` resolution) so the
 * result carries the full effective options (target/module/strict/jsx/lib),
 * then projects them through the kit's `PortableTsconfig.make` allow-list
 * filter to a portable, compilerOptions-only shape with no absolute paths or
 * emit/file-selection options.
 *
 * When the package has no own `tsconfig.json` (e.g. a minimal test fixture),
 * falls back to `fallbackConfigPath` — the build's already-resolved dts tsconfig,
 * which always exists during a build. If neither is present, returns a minimal
 * portable config carrying only the virtual-environment flags.
 *
 * @param cwd - Absolute package root.
 * @param fallbackConfigPath - Optional resolved tsconfig to use when the package has no own one.
 * @returns The portable tsconfig object.
 *
 * @public
 */
export function resolvePortableTsconfig(cwd: string, fallbackConfigPath?: string): PortableTsconfig {
	const ownConfig = nodePath.join(cwd, "tsconfig.json");
	const configPath = existsSync(ownConfig)
		? ownConfig
		: fallbackConfigPath !== undefined && existsSync(fallbackConfigPath)
			? fallbackConfigPath
			: undefined;
	if (configPath === undefined) {
		// No tsconfig to resolve from — emit a minimal portable config with just the virtual-env flags.
		return { $schema: TSCONFIG_SCHEMA_URL, compilerOptions: { composite: false, noEmit: true } };
	}
	try {
		const resolved = TsconfigLoaderSync.resolve(configPath, tsconfigSyncOptions);
		// `includeTypes: true` keeps `types` on the portable shape: it names `@types/*` packages
		// a downstream virtual TypeScript environment (shiki/Twoslash, API Extractor) must load,
		// not a filesystem path. `typeRoots` stays dropped because its entries are machine-specific
		// or relative to the config they came from, so they do not survive relocation.
		return PortableTsconfigFilter.make(resolved, { includeTypes: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot resolve portable tsconfig at ${configPath}: ${message}`, { cause: error });
	}
}
