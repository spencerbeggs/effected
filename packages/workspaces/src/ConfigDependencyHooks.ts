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
import type { PartialReleaseAgeGate } from "@effected/npm";
import { CatalogAssemblyError } from "@effected/npm";
import { Context, Effect, Layer, Predicate, Result } from "effect";
import type { CatalogEntries } from "./internal/catalogs.js";
import { normalize } from "./internal/catalogs.js";

/**
 * The pnpm config surface a `pnpmfile.cjs` `updateConfig` hook reads and
 * rewrites: the catalog slice, plus the release-age keys pnpm honours
 * (`minimumReleaseAge` in minutes, `minimumReleaseAgeExclude` as name patterns).
 * The catalog fields are always present; the release-age fields are `undefined`
 * until a hook sets them.
 */
interface HookConfig {
	catalog: Record<string, string>;
	catalogs: Record<string, Record<string, string>>;
	minimumReleaseAge: number | undefined;
	minimumReleaseAgeExclude: readonly string[] | undefined;
}

/**
 * The result of replaying a workspace's `configDependencies` hooks: the catalogs
 * the hooks yield, and the release-age gate contribution they leave on the
 * config (pnpm's `minimumReleaseAge` / `minimumReleaseAgeExclude`).
 *
 * @remarks
 * `releaseAge` is a `PartialReleaseAgeGate` — the age, the exclude list,
 * both, or neither, depending on what the replayed hooks set. It is deliberately
 * a *partial* contribution: a consumer folds it into an effective gate with
 * `ReleaseAgeGate.combine` alongside inline `pnpm-workspace.yaml` values. Hooks
 * that set no release-age keys contribute an empty gate (`{}`).
 *
 * @public
 */
export interface HookInjection {
	/** The catalogs the replayed hooks yield, as `catalog name → dependency → range`. */
	readonly catalogs: Readonly<Record<string, Readonly<Record<string, string>>>>;
	/** The release-age gate contribution the replayed hooks leave on the config. */
	readonly releaseAge: PartialReleaseAgeGate;
}

/**
 * The {@link ConfigDependencyHooks} service shape.
 *
 * @remarks
 * `inject` is given the workspace root, the manifest's `configDependencies`
 * (name → version+integrity), and the inline-catalog seed as a plain
 * `catalog name → dependency name → range` record, and produces a
 * {@link HookInjection}: the catalogs the replayed hooks yield **and** the
 * release-age gate contribution they leave on the config. The default (no-op)
 * implementation returns the seed catalogs unchanged, contributes an empty
 * release-age gate, and loads nothing.
 *
 * @public
 */
export interface ConfigDependencyHooksShape {
	/**
	 * Replay each config dependency's `updateConfig` hook over `seed`, in
	 * declaration order, and return both the resulting catalogs and the
	 * release-age gate contribution the hooks leave behind.
	 *
	 * @remarks
	 * The hooks are replayed once over a single threaded config object, exactly
	 * as pnpm does — so catalogs and the release-age keys
	 * (`minimumReleaseAge` / `minimumReleaseAgeExclude`) are both read off that
	 * one final object, and the config-dependency code executes only once. When
	 * two hooks both set a release-age key the **later hook wins** (it rewrites
	 * the threaded value); a hook that returns a malformed value for a key leaves
	 * the prior threaded value in place (tolerant threading, matching the catalog
	 * slice). A hook failing to load or replay fails typed with a
	 * `hooks`-source `CatalogAssemblyError`, never a silent skip.
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
	) => Effect.Effect<HookInjection, CatalogAssemblyError>;
}

/** Whether `value` is a non-null, non-array object. */
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The file URL a Node ESM `ERR_MODULE_NOT_FOUND` reports as unresolvable, or
 * `undefined` when the failure is anything else.
 *
 * @remarks
 * Node sets `err.url` (an own string property) to the offending module's URL.
 * For an absent *entry* module it is that entry's own URL; for a module the entry
 * `import`s that fails to resolve it is the **nested** module's URL. That
 * distinction is exactly what separates "this pnpmfile does not exist" (a
 * legitimate skip, `err.url` equal to the candidate) from "the pnpmfile's own
 * import failed to resolve" (a real error, `err.url` pointing elsewhere) — a
 * discrimination `err.code` alone cannot make, since both raise
 * `ERR_MODULE_NOT_FOUND`. Verified against Node's ESM loader: the entry-absent
 * case yields `err.url === pathToFileURL(candidate).href`; the nested case yields
 * the nested module's URL.
 */
const moduleNotFoundUrl = (cause: unknown): string | undefined =>
	isObject(cause) && cause.code === "ERR_MODULE_NOT_FOUND" && typeof cause.url === "string" ? cause.url : undefined;

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
	// The seed carries no release-age keys — only a replayed hook sets them.
	return { catalog, catalogs, minimumReleaseAge: undefined, minimumReleaseAgeExclude: undefined };
};

/** A finite number if `value` is one, else the prior threaded value — a garbage age is dropped, not fatal. */
const finiteNumberOr = (value: unknown, fallback: number | undefined): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** A string array if `value` is one, else the prior threaded value — a malformed exclude is dropped, not fatal. */
const stringArrayOr = (value: unknown, fallback: readonly string[] | undefined): readonly string[] | undefined =>
	Array.isArray(value) && value.every((entry) => typeof entry === "string") ? (value as readonly string[]) : fallback;

/**
 * Read the catalog slice and the release-age keys back out of whatever a hook
 * returned, threading the prior config as the fallback.
 *
 * @remarks
 * Tolerant by design, matching this seam's discipline: a hook's returned *data*
 * is normalized, never a typed failure (only a load/replay *mechanism* failure
 * raises `CatalogAssemblyError`). A hook that omits a key, or returns a
 * malformed value for it, leaves the prior threaded value in place; a hook that
 * sets a well-formed key rewrites it — so across hooks the **last well-formed
 * write wins**, exactly as pnpm's single mutable config object behaves.
 */
const configOf = (value: unknown, fallback: HookConfig): HookConfig => {
	if (!isObject(value)) return fallback;
	return {
		catalog: isObject(value.catalog) ? (value.catalog as Record<string, string>) : fallback.catalog,
		catalogs: isObject(value.catalogs) ? (value.catalogs as Record<string, Record<string, string>>) : fallback.catalogs,
		minimumReleaseAge: finiteNumberOr(value.minimumReleaseAge, fallback.minimumReleaseAge),
		minimumReleaseAgeExclude: stringArrayOr(value.minimumReleaseAgeExclude, fallback.minimumReleaseAgeExclude),
	};
};

/**
 * Project the threaded config's release-age keys into a partial gate
 * contribution, omitting a key the hooks never set (never an explicit
 * `undefined` — the fields are `optionalKey`).
 */
const releaseAgeOf = (config: HookConfig): PartialReleaseAgeGate => ({
	...(config.minimumReleaseAge !== undefined ? { ageMinutes: config.minimumReleaseAge } : {}),
	...(config.minimumReleaseAgeExclude !== undefined ? { exclude: config.minimumReleaseAgeExclude } : {}),
});

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
		inject: (_root, _configDependencies, seed) => Effect.succeed({ catalogs: seed, releaseAge: {} }),
	});

	/**
	 * The live layer: dynamically imports each config dependency's `pnpmfile.cjs`
	 * (in process, no subprocess) and replays its `updateConfig` hook over the
	 * seed, in declaration order. A dependency without a `pnpmfile.cjs` contributes
	 * nothing; a dependency whose file fails to load or replay fails typed with a
	 * `hooks`-source `CatalogAssemblyError`, never a silent skip.
	 *
	 * @remarks
	 * Runtime-coupled by design, not node-exclusive. The `import()` below loads
	 * **and executes** a config dependency's pnpmfile in-process — code execution,
	 * not IO, so no `FileSystem` / `Path` service abstracts it. The `node:path` and
	 * `node:url` imports (`join`, `pathToFileURL`) exist only to build the URL that
	 * `import()` consumes; node and bun both implement those builtins and dynamic
	 * import, so this layer runs on either runtime. Only ever wired by
	 * `WorkspaceCatalogs.layerWithConfigDependencies`.
	 */
	static readonly layerLive: Layer.Layer<ConfigDependencyHooks> = Layer.succeed(ConfigDependencyHooks, {
		inject: (root, configDependencies, seed) =>
			Effect.gen(function* () {
				const names = Object.keys(configDependencies);
				if (names.length === 0) return { catalogs: seed, releaseAge: {} };

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
					// Load the pnpmfile via a dynamic `import()`, trying `pnpmfile.mjs`
					// FIRST (pnpm 11 ships the config-dependency pnpmfile as an ES module —
					// a pnpm-11-native config dep may carry ONLY `.mjs`) and falling back to
					// `pnpmfile.cjs` (legacy). `import()` loads both, and preferring `.mjs`
					// matches the file pnpm 11 itself loads. NO existsSync precheck — it
					// returns false for an existing-but-inaccessible file and would silently
					// skip a real hook.
					let loaded: unknown;
					let found = false;
					for (const filename of ["pnpmfile.mjs", "pnpmfile.cjs"] as const) {
						const candidatePath = join(root, "node_modules", ".pnpm-config", name, filename);
						const candidateUrl = pathToFileURL(candidatePath).href;
						const result = yield* Effect.result(
							Effect.tryPromise({
								try: () => import(candidateUrl) as Promise<unknown>,
								catch: (cause) => cause,
							}),
						);
						if (Result.isSuccess(result)) {
							loaded = result.success;
							found = true;
							break;
						}
						// An ERR_MODULE_NOT_FOUND whose missing module IS this candidate means
						// the file simply is not there — try the next candidate. Any OTHER
						// failure (a syntax error, a throwing top-level, or an
						// ERR_MODULE_NOT_FOUND for a module the pnpmfile itself imports) is a
						// real error and must surface typed, never a silent skip.
						if (moduleNotFoundUrl(result.failure) === candidateUrl) continue;
						return yield* Effect.fail(new CatalogAssemblyError({ source: "hooks", path: name, cause: result.failure }));
					}
					// Neither `pnpmfile.mjs` nor `pnpmfile.cjs` exists — a config dependency
					// that ships no pnpmfile, the one legitimate skip.
					if (!found) continue;

					const updateConfig = updateConfigOf(loaded);
					if (updateConfig === undefined) continue;

					const currentConfig = config;
					config = yield* Effect.try({
						try: () => configOf(updateConfig(currentConfig), currentConfig),
						catch: (cause) => new CatalogAssemblyError({ source: "hooks", path: name, cause }),
					});
				}
				return { catalogs: configToEntries(config), releaseAge: releaseAgeOf(config) };
			}),
	});
}
