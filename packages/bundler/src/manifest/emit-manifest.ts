// packages/bundler/src/manifest/emit-manifest.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DependencySpecifier } from "@effected/npm";
import type { Plugin } from "rolldown";
import type { ManifestLike } from "../catalog/resolve-catalogs.js";
import { resolveManifest } from "../catalog/resolve-catalogs.js";
import type { DualExports, ExeRewrite, Json } from "./transform.js";
import { defaultManifestTransform, transformManifest } from "./transform.js";

/** @public */
export interface TargetGroupRef {
	readonly id: string; // "dev", "npm", "github", or any custom prod variant id
	/** The package.json name this group's manifest carries (the declarative rename). */
	readonly name: string;
	readonly isProd: boolean;
}

/** @public */
export interface BuildEmittedManifestOptions {
	readonly pkg: Json;
	readonly targetGroup: TargetGroupRef;
	readonly devManifest: "preserve" | "resolve";
	/** Top-level keys deleted from the emitted manifest, after the standard stripping. */
	readonly drop?: ReadonlyArray<string> | undefined;
	/** Which exports emit dual import/require conditions. boolean (uniform) or a Set of export keys (per-entry). */
	readonly dual?: DualExports | undefined;
	/** Export keys built into a `<key>/index.*` subdir (e.g. an RSPress `./runtime`). */
	readonly subdirExports?: ReadonlySet<string> | undefined;
	/** When set, rewrite exports/bin values equal to the exe source to the SEA path and add it to `files`. */
	readonly exeRewrite?: ExeRewrite | undefined;
	/** Whether the dts pass ran; `false` omits `types` conditions from the emitted manifest (issue #198). Defaults to `true`. */
	readonly emitDts?: boolean | undefined;
}

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

const isCatalogOrWorkspaceSpec = (spec: unknown): boolean =>
	typeof spec === "string" && (DependencySpecifier.isCatalog(spec) || DependencySpecifier.isWorkspace(spec));

/**
 * Whether any of `pkg`'s four dependency fields carries at least one `catalog:`/`workspace:`
 * specifier. `resolveManifest` returns a manifest with none of these unchanged, so callers can
 * skip the CatalogResolver + pnpm-workspace + lockfile assembly entirely when this is false.
 *
 * @public
 */
export function manifestNeedsCatalogResolution(pkg: Json): boolean {
	return DEPENDENCY_FIELDS.some((field) => {
		const deps = pkg[field];
		return typeof deps === "object" && deps !== null && Object.values(deps).some(isCatalogOrWorkspaceSpec);
	});
}

/**
 * Compute the final manifest bytes for a TargetGroup (catalog resolution + standard transforms).
 *
 * @public
 */
export async function buildEmittedManifest(options: BuildEmittedManifestOptions): Promise<Json> {
	const { pkg, targetGroup, devManifest, drop } = options;
	const shouldResolve = (targetGroup.isProd || devManifest === "resolve") && manifestNeedsCatalogResolution(pkg);
	let base: Json = pkg;
	if (shouldResolve) {
		// resolveManifest delegates to @effected/workspaces' resolvers (returns a Promise)
		// and discovers the workspace from process.cwd(). ManifestLike and Json are
		// structurally compatible records, so the casts are safe at this boundary.
		base = (await resolveManifest(pkg as unknown as ManifestLike)) as unknown as Json;
	}
	// Apply the declarative rename so the drop step and the emitted manifest both see it.
	base = { ...base, name: targetGroup.name };
	return transformManifest(base, {
		transform: drop ? (p) => defaultManifestTransform({ pkg: p }, { drop }) : undefined,
		dual: options.dual ?? false,
		subdirExports: options.subdirExports,
		exeRewrite: options.exeRewrite,
		emitDts: options.emitDts ?? true,
	});
}

/** @public */
export interface EmitManifestOptions {
	readonly targetGroup: TargetGroupRef;
	readonly devManifest?: "preserve" | "resolve" | undefined;
	/** Top-level keys deleted from the emitted manifest, after the standard stripping. */
	readonly drop?: ReadonlyArray<string> | undefined;
	/** Source package dir to read package.json/LICENSE/README from. */
	readonly sourceDir: string;
	/** Which exports emit dual import/require conditions. boolean (uniform) or a Set of export keys (per-entry). */
	readonly dual?: DualExports | undefined;
	/** Export keys built into a `<key>/index.*` subdir (e.g. an RSPress `./runtime`). */
	readonly subdirExports?: ReadonlySet<string> | undefined;
	/** When set, rewrite exports/bin values equal to the exe source to the SEA path and add it to `files`. */
	readonly exeRewrite?: ExeRewrite | undefined;
	/** Whether the dts pass ran; `false` omits `types` conditions from the emitted manifest (issue #198). Defaults to `true`. */
	readonly emitDts?: boolean | undefined;
}

/**
 * Rolldown plugin: emit the transformed package.json + LICENSE/README into the output pkg/ root.
 *
 * @public
 */
export function emitManifest(options: EmitManifestOptions): Plugin {
	const sourceDir = options.sourceDir;
	return {
		name: "savvy:emit-manifest",
		async generateBundle() {
			const pkg = JSON.parse(await readFile(join(sourceDir, "package.json"), "utf-8")) as Json;
			const manifest = await buildEmittedManifest({
				pkg,
				targetGroup: options.targetGroup,
				devManifest: options.devManifest ?? "preserve",
				drop: options.drop,
				dual: options.dual,
				subdirExports: options.subdirExports,
				exeRewrite: options.exeRewrite,
				emitDts: options.emitDts,
			});
			this.emitFile({
				type: "asset",
				fileName: "package.json",
				source: `${JSON.stringify(manifest, null, "\t")}\n`,
			});
			for (const name of ["LICENSE", "README.md"]) {
				try {
					const content = await readFile(join(sourceDir, name), "utf-8");
					this.emitFile({ type: "asset", fileName: name, source: content });
				} catch {
					// optional file absent — skip
				}
			}
		},
	};
}
