// packages/bundler/src/manifest/emit-manifest.ts
import { DependencySpecifier } from "@effected/npm";
import type { Context } from "effect";
import { Effect, FileSystem, Path } from "effect";
import type { Plugin } from "rolldown";
import type { ManifestLike, ResolveManifestError } from "../catalog/resolve-catalogs.js";
import { resolveManifest } from "../catalog/resolve-catalogs.js";
import type { ConfigValidationError } from "../errors.js";
import { stripBuiltCondition } from "./built-condition.js";
import { applyManifestSet, validateManifestSet } from "./manifest-set.js";
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
	/** The package directory. Catalog and workspace specifiers resolve against the workspace found from here. */
	readonly cwd: string;
	readonly targetGroup: TargetGroupRef;
	readonly devManifest: "preserve" | "resolve";
	/** Top-level keys deleted from the emitted manifest, after the standard stripping. */
	readonly drop?: ReadonlyArray<string> | undefined;
	/** Top-level string keys written over the emitted manifest after `drop`; `name` is carried by `targetGroup`. */
	readonly set?: Readonly<Record<string, string>> | undefined;
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
export const buildEmittedManifest: (
	options: BuildEmittedManifestOptions,
) => Effect.Effect<Json, ConfigValidationError | ResolveManifestError, FileSystem.FileSystem | Path.Path> =
	Effect.fnUntraced(function* (options: BuildEmittedManifestOptions) {
		const { cwd, targetGroup, devManifest, drop, set } = options;
		// The config path validates first; a direct caller gets the same refusal rather than a key the config refuses.
		// A refusal is a typed failure here, where the synchronous validator throws it.
		if (set !== undefined) {
			yield* Effect.try({
				try: () => validateManifestSet(set, drop ?? []),
				// `validateManifestSet` throws nothing else.
				catch: (error) => error as ConfigValidationError,
			});
		}
		// The built-output link condition is a workspace-only route and never publishes.
		const pkg = stripBuiltCondition(options.pkg);
		const shouldResolve = (targetGroup.isProd || devManifest === "resolve") && manifestNeedsCatalogResolution(pkg);
		let base: Json = pkg;
		if (shouldResolve) {
			// resolveManifest delegates to @effected/workspaces' resolvers and discovers the workspace from cwd.
			// ManifestLike and Json are structurally compatible records, so the casts are safe at this boundary.
			base = (yield* resolveManifest(pkg as unknown as ManifestLike, cwd)) as unknown as Json;
		}
		// Apply the declarative rename so the drop step and the emitted manifest both see it.
		base = { ...base, name: targetGroup.name };
		return transformManifest(base, {
			// `set` applies whether or not a drop list was passed; the standard stripping still runs only with one.
			transform:
				drop !== undefined || set !== undefined
					? (p) => applyManifestSet(drop !== undefined ? defaultManifestTransform({ pkg: p }, { drop }) : p, set)
					: undefined,
			dual: options.dual ?? false,
			subdirExports: options.subdirExports,
			exeRewrite: options.exeRewrite,
			emitDts: options.emitDts ?? true,
		});
	});

/** @public */
export interface EmitManifestOptions {
	readonly targetGroup: TargetGroupRef;
	readonly devManifest?: "preserve" | "resolve" | undefined;
	/** Top-level keys deleted from the emitted manifest, after the standard stripping. */
	readonly drop?: ReadonlyArray<string> | undefined;
	/** Top-level string keys written over the emitted manifest after `drop`; `name` is carried by `targetGroup`. */
	readonly set?: Readonly<Record<string, string>> | undefined;
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
 * @remarks
 * rolldown calls `generateBundle` as a plain async hook, so the plugin captures the `FileSystem` and `Path` it is
 * built under and runs its reads with them.
 *
 * @public
 */
export const emitManifest = (
	options: EmitManifestOptions,
): Effect.Effect<Plugin, never, FileSystem.FileSystem | Path.Path> =>
	Effect.map(Effect.context<FileSystem.FileSystem | Path.Path>(), (services) => emitManifestWith(options, services));

const emitManifestWith = (
	options: EmitManifestOptions,
	services: Context.Context<FileSystem.FileSystem | Path.Path>,
): Plugin => {
	const run = Effect.runPromiseWith(services);
	const sourceDir = options.sourceDir;
	return {
		name: "savvy:emit-manifest",
		async generateBundle() {
			const { manifest, extras } = await run(
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const { join } = yield* Path.Path;
					// A malformed source manifest throws, as the plain `JSON.parse` did.
					const pkg = JSON.parse(yield* fs.readFileString(join(sourceDir, "package.json"))) as Json;
					const manifest = yield* buildEmittedManifest({
						pkg,
						cwd: sourceDir,
						targetGroup: options.targetGroup,
						devManifest: options.devManifest ?? "preserve",
						drop: options.drop,
						set: options.set,
						dual: options.dual,
						subdirExports: options.subdirExports,
						exeRewrite: options.exeRewrite,
						emitDts: options.emitDts,
					});
					const extras: Array<{ readonly name: string; readonly content: string }> = [];
					for (const name of ["LICENSE", "README.md"]) {
						// optional file absent — skip
						const content = yield* fs.readFileString(join(sourceDir, name)).pipe(Effect.option);
						if (content._tag === "Some") extras.push({ name, content: content.value });
					}
					return { manifest, extras };
				}),
			);
			this.emitFile({
				type: "asset",
				fileName: "package.json",
				source: `${JSON.stringify(manifest, null, "\t")}\n`,
			});
			for (const { name, content } of extras) this.emitFile({ type: "asset", fileName: name, source: content });
		},
	};
};
