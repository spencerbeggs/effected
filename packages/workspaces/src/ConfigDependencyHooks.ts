// The opt-in pnpmfile `configDependencies` hook-replay seam.
//
// pnpm's config dependencies (declared under `configDependencies:` in
// `pnpm-workspace.yaml`) install to `node_modules/.pnpm-config/<name>` and may
// ship a `pnpmfile.cjs` whose `updateConfig` hook mutates the resolved config —
// catalogs included. This service replays those hooks over an inline-catalog
// seed so hook-injected catalogs land in assembly.
//
// This executes arbitrary code loaded from a config dependency, so it is **never**
// wired by the default `WorkspaceCatalogs.layer`. It is loaded IN PROCESS via a
// dynamic `import()` — no subprocess is spawned — and lives behind an opt-in,
// Node-coupled layer, the same shape as the other Node-only overlays in this
// package. `layerNoop` returns the seed untouched and is the safe default for
// tests and consumers who want the topology without the execution.
//
// `internal/catalogs.ts` stays the only `@pnpm/catalogs.*` importer: the shape
// hooks operate on is the plain `catalog name → dependency → range` record, and
// the only normalization borrowed here is the prototype-safe `normalize`.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Context, Effect, Layer, Predicate, Result } from "effect";
import { CatalogAssemblyError } from "./CatalogAssemblyError.js";
import type { CatalogEntries } from "./internal/catalogs.js";
import { normalize } from "./internal/catalogs.js";

/** The pnpm config surface a `pnpmfile.cjs` `updateConfig` hook reads and rewrites — the catalog slice. */
interface HookConfig {
	catalog: Record<string, string>;
	catalogs: Record<string, Record<string, string>>;
}

/**
 * The {@link ConfigDependencyHooks} service shape.
 *
 * @remarks
 * `inject` is given the workspace root, the manifest's `configDependencies`
 * (name → version+integrity), and the inline-catalog seed as a plain
 * `catalog name → dependency name → range` record, and produces the catalogs the
 * replayed hooks yield. The default (no-op) implementation returns the seed
 * unchanged and loads nothing.
 *
 * @public
 */
export interface ConfigDependencyHooksShape {
	/**
	 * Replay each config dependency's `updateConfig` hook over `seed`, in
	 * declaration order, and return the resulting catalogs.
	 *
	 * @param root - The workspace root; config dependencies resolve under
	 *   `<root>/node_modules/.pnpm-config/<name>`.
	 * @param configDependencies - The `configDependencies` map (name →
	 *   version+integrity) declared in `pnpm-workspace.yaml`.
	 * @param seed - The inline catalogs, as `catalog name → dependency → range`.
	 */
	readonly inject: (
		root: string,
		configDependencies: Readonly<Record<string, string>>,
		seed: Readonly<Record<string, Readonly<Record<string, string>>>>,
	) => Effect.Effect<Readonly<Record<string, Readonly<Record<string, string>>>>, CatalogAssemblyError>;
}

/** Whether `value` is a non-null, non-array object. */
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether a dynamic-`import()` failure is Node's "module not found"
 * (`ERR_MODULE_NOT_FOUND`) — the case of a config dependency that ships no
 * `pnpmfile.cjs`, the one legitimate skip. Any other load failure (a syntax
 * error, a throwing top-level, a permission error on a present file) has no such
 * code and must surface typed.
 */
const isModuleNotFound = (cause: unknown): boolean => isObject(cause) && cause.code === "ERR_MODULE_NOT_FOUND";

/**
 * Whether a config-dependency `name` carries a `..` path segment. A scoped name
 * legitimately contains `/` (`@scope/pkg`), so only a `..` *segment* is rejected —
 * it would traverse out of `.pnpm-config` and feed an attacker-chosen path to the
 * dynamic `import()` below.
 */
const hasTraversalSegment = (name: string): boolean => name.split(/[/\\]/).includes("..");

/** Turn the seed record into the pnpm hook config, with the default catalog split out under `catalog`. */
const seedToConfig = (seed: Readonly<Record<string, Readonly<Record<string, string>>>>): HookConfig => {
	const catalogs: Record<string, Record<string, string>> = {};
	let catalog: Record<string, string> = {};
	for (const [name, entries] of Object.entries(seed)) {
		if (name === "default") catalog = { ...entries };
		else catalogs[name] = { ...entries };
	}
	return { catalog, catalogs };
};

/** Read the catalog slice back out of whatever a hook returned, falling back to the prior config. */
const configOf = (value: unknown, fallback: HookConfig): HookConfig => {
	if (!isObject(value)) return fallback;
	return {
		catalog: isObject(value.catalog) ? (value.catalog as Record<string, string>) : fallback.catalog,
		catalogs: isObject(value.catalogs) ? (value.catalogs as Record<string, Record<string, string>>) : fallback.catalogs,
	};
};

/** Fold the hook config back into the normalized `catalog name → dependency → range` record. */
const configToEntries = (config: HookConfig): CatalogEntries => {
	const raw: Record<string, unknown> = { ...config.catalogs };
	if (Object.keys(config.catalog).length > 0) {
		raw.default = { ...(isObject(raw.default) ? raw.default : {}), ...config.catalog };
	}
	return normalize(raw);
};

/** The `updateConfig` hook a loaded `pnpmfile.cjs` exposes, however it is exported. */
type UpdateConfig = (config: HookConfig) => unknown;

/** Locate the `updateConfig` hook across the CJS/ESM export shapes a `pnpmfile.cjs` can present. */
const updateConfigOf = (mod: unknown): UpdateConfig | undefined => {
	for (const candidate of [mod, isObject(mod) ? mod.default : undefined]) {
		if (!isObject(candidate)) continue;
		const hooks = candidate.hooks;
		if (isObject(hooks) && Predicate.isFunction(hooks.updateConfig)) return hooks.updateConfig as UpdateConfig;
		if (Predicate.isFunction(candidate.updateConfig)) return candidate.updateConfig as UpdateConfig;
	}
	return undefined;
};

/**
 * Replays a workspace's `configDependencies` `updateConfig` hooks over the inline
 * catalogs — the opt-in seam that lets hook-injected catalogs participate in
 * assembly.
 *
 * @remarks
 * A contract-only service: it declares the shape and ships two layers, never a
 * baked-in default. {@link ConfigDependencyHooks.layerNoop} executes no
 * config-dependency code (it returns the seed untouched) and is what the default
 * {@link WorkspaceCatalogs} layer wires; {@link ConfigDependencyHooks.layerLive}
 * dynamically imports each `pnpmfile.cjs` and replays it, and is wired only by the
 * explicit `WorkspaceCatalogs.layerWithConfigDependencies` opt-in.
 *
 * @public
 */
export class ConfigDependencyHooks extends Context.Service<ConfigDependencyHooks, ConfigDependencyHooksShape>()(
	"@effected/workspaces/ConfigDependencyHooks",
) {
	/**
	 * The no-op layer: `inject` returns the seed unchanged and never touches a
	 * config dependency. The default {@link WorkspaceCatalogs} layer wires this, so
	 * the default catalog path provably executes no config-dependency code.
	 */
	static readonly layerNoop: Layer.Layer<ConfigDependencyHooks> = Layer.succeed(ConfigDependencyHooks, {
		inject: (_root, _configDependencies, seed) => Effect.succeed(seed),
	});

	/**
	 * The live layer: dynamically imports each config dependency's `pnpmfile.cjs`
	 * (in process, no subprocess) and replays its `updateConfig` hook over the
	 * seed, in declaration order. A dependency without a `pnpmfile.cjs` contributes
	 * nothing; a dependency whose file fails to load or replay fails typed with a
	 * `hooks`-source {@link CatalogAssemblyError}, never a silent skip.
	 *
	 * @remarks
	 * Node-coupled by design — the `node:fs` / `node:path` / `node:url` imports are
	 * the sanctioned Node-only overlay, matching the other seams here. Only ever
	 * wired by `WorkspaceCatalogs.layerWithConfigDependencies`.
	 */
	static readonly layerLive: Layer.Layer<ConfigDependencyHooks> = Layer.succeed(ConfigDependencyHooks, {
		inject: (root, configDependencies, seed) =>
			Effect.gen(function* () {
				const names = Object.keys(configDependencies);
				if (names.length === 0) return seed;

				let config = seedToConfig(seed);
				for (const name of names) {
					// Validate the name BEFORE building the path it feeds to `import()`: a
					// `..` segment would escape `.pnpm-config`. Fails typed, on the same
					// `hooks`-source path as a load/replay failure — never a silent skip.
					if (hasTraversalSegment(name)) {
						return yield* Effect.fail(
							new CatalogAssemblyError({
								source: "hooks",
								path: name,
								cause: new Error(`config dependency name has a '..' path segment: ${name}`),
							}),
						);
					}
					const pnpmfilePath = join(root, "node_modules", ".pnpm-config", name, "pnpmfile.cjs");
					// Attempt the dynamic import directly — NO existsSync precheck, which
					// returns false for an existing-but-inaccessible file and would silently
					// skip its hook. A genuine ERR_MODULE_NOT_FOUND means the dependency ships
					// no pnpmfile (the legitimate skip); any OTHER load failure IS a failure.
					const loaded = yield* Effect.result(
						Effect.tryPromise({
							try: () => import(pathToFileURL(pnpmfilePath).href) as Promise<unknown>,
							catch: (cause) => cause,
						}),
					);
					if (Result.isFailure(loaded)) {
						if (isModuleNotFound(loaded.failure)) continue;
						return yield* Effect.fail(new CatalogAssemblyError({ source: "hooks", path: name, cause: loaded.failure }));
					}
					const updateConfig = updateConfigOf(loaded.success);
					if (updateConfig === undefined) continue;

					const currentConfig = config;
					config = yield* Effect.try({
						try: () => configOf(updateConfig(currentConfig), currentConfig),
						catch: (cause) => new CatalogAssemblyError({ source: "hooks", path: name, cause }),
					});
				}
				return configToEntries(config);
			}),
	});
}
