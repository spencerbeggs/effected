import type { TsdoctorMetaOptions } from "./tsdoctor-config.js";

/**
 * A single TSDoc tag definition (parity with api-extractor's TSDoc config).
 *
 * @public
 */
export interface TsdocTagDefinition {
	readonly tagName: string;
	readonly syntaxKind: "block" | "inline" | "modifier";
	readonly allowMultiple?: boolean | undefined;
}

/**
 * An api-extractor message-suppression rule. messageId is exact-matched; pattern (regex or substring) is AND-matched against the text.
 *
 * @public
 */
export interface WarningSuppressionRule {
	readonly messageId: string;
	readonly pattern?: string | undefined;
}

/**
 * TSDoc / doc-warning configuration. suppressWarnings is doc functionality, so it lives here.
 *
 * @public
 */
export interface TsdocOptions {
	readonly suppressWarnings?: ReadonlyArray<WarningSuppressionRule> | undefined;
	readonly tagDefinitions?: ReadonlyArray<TsdocTagDefinition> | undefined;
}

/**
 * The `meta` field on defineBuild. Absent means no api-model generation.
 *
 * @public
 */
export interface MetaOptions {
	/** Directories to copy the canonical group's api-model into after `savvy build --target prod`. */
	readonly localPaths?: ReadonlyArray<string> | undefined;
	/**
	 * Forward-look the meta bundle's own `version` and workspace-sibling dep versions to their
	 * NEXT release version from pending changesets. `"auto"` (default) is `false` under CI
	 * (`CI`/`GITHUB_ACTIONS` set) and `true` locally, so a local bundle matches the CI release build.
	 */
	readonly optimistic?: "auto" | boolean | undefined;
	readonly tsdoc?: TsdocOptions | undefined;
	/**
	 * The CONFIG tier of the emitted `tsdoctor.json` sidecar (ranked over the package's and the
	 * workspace root's `tsdoctor.json` source files) and the optional build-time Open Graph image.
	 * The project tier is found through workspace discovery, which requires the workspace root's
	 * `package.json` to declare a `version`; without one, discovery fails silently and no `project`
	 * tier is emitted.
	 */
	readonly tsdoctor?: TsdoctorMetaOptions | undefined;
}

/**
 * Fully-resolved meta options (no optionals).
 *
 * @public
 */
export interface NormalizedMeta {
	readonly localPaths: ReadonlyArray<string>;
	readonly optimistic: boolean;
	readonly tsdoc: {
		readonly suppressWarnings: ReadonlyArray<WarningSuppressionRule>;
		readonly tagDefinitions: ReadonlyArray<TsdocTagDefinition>;
	};
	/** Passed through verbatim; `undefined` means no config tier (the source tiers still apply). */
	readonly tsdoctor: TsdoctorMetaOptions | undefined;
}

/** Resolve `"auto"` against the environment; explicit booleans pass through. */
function resolveOptimistic(
	value: MetaOptions["optimistic"],
	env: { CI?: string | undefined; GITHUB_ACTIONS?: string | undefined },
): boolean {
	if (value === true || value === false) return value;
	return !(env.CI || env.GITHUB_ACTIONS);
}

/**
 * Fill defaults so downstream code never branches on undefined.
 *
 * @public
 */
export function normalizeMetaOptions(
	meta: MetaOptions,
	env: { CI?: string | undefined; GITHUB_ACTIONS?: string | undefined } = process.env,
): NormalizedMeta {
	return {
		localPaths: meta.localPaths ?? [],
		optimistic: resolveOptimistic(meta.optimistic, env),
		tsdoc: {
			suppressWarnings: meta.tsdoc?.suppressWarnings ?? [],
			tagDefinitions: meta.tsdoc?.tagDefinitions ?? [],
		},
		tsdoctor: meta.tsdoctor,
	};
}
