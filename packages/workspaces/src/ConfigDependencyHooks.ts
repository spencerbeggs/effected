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
import { Run } from "@effected/commands";
import type { PartialReleaseAgeGate } from "@effected/npm";
import { CatalogAssemblyError } from "@effected/npm";
import { Context, Duration, Effect, Layer, Predicate, Result, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
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
 * The subprocess replay program {@link ConfigDependencyHooks.layerSubprocess}
 * hands to `node --input-type=module -e`.
 *
 * @remarks
 * A **static** string constant, deliberately: a bundler compiles a *computed*
 * dynamic `import()` into a context module that cannot resolve a runtime path
 * (`Cannot find module 'file:///…'`), so the computed import has to run in a
 * child process whose program text carries **no interpolated runtime value** —
 * the workspace root, the seed and the dependency names all arrive via argv
 * (`process.argv.slice(1)` under `-e`), never spliced into the script.
 *
 * The script mirrors this module's in-process semantics exactly so the two
 * layers are drop-in interchangeable: `pnpmfile.mjs` before `pnpmfile.cjs`
 * (pnpm 11's loader order), the `ERR_MODULE_NOT_FOUND`-for-the-candidate-itself
 * skip discrimination (`err.url` equality), the same hook-locator shapes, the
 * same tolerant threading of returned data (`configOf` / `finiteNumberOr` /
 * `stringArrayOr` clones below), and the same synchronous hook call. Only the
 * *mechanism* failures are reported: the script prints one final line of JSON —
 * `{ ok: true, config }` on success, `{ ok: false, name, message, stack? }`
 * naming the offending dependency on a load/replay failure — and exits through
 * the write callback so the payload is flushed even if a hook left the event
 * loop occupied. The final-line framing tolerates a hook's own `console.log`
 * noise on stdout.
 */
const REPLAY_SCRIPT = `
const [root, seedJson, ...names] = process.argv.slice(1);
const { pathToFileURL } = await import("node:url");
const { join } = await import("node:path");
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const finiteNumberOr = (value, fallback) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const stringArrayOr = (value, fallback) =>
	Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : fallback;
const configOf = (value, fallback) =>
	isObject(value)
		? {
				catalog: isObject(value.catalog) ? value.catalog : fallback.catalog,
				catalogs: isObject(value.catalogs) ? value.catalogs : fallback.catalogs,
				minimumReleaseAge: finiteNumberOr(value.minimumReleaseAge, fallback.minimumReleaseAge),
				minimumReleaseAgeExclude: stringArrayOr(value.minimumReleaseAgeExclude, fallback.minimumReleaseAgeExclude),
			}
		: fallback;
const failure = (name, cause) => ({
	ok: false,
	name,
	message: cause instanceof Error ? cause.message : String(cause),
	...(cause instanceof Error && typeof cause.stack === "string" ? { stack: cause.stack } : {}),
});
const replay = async () => {
	let catalog = {};
	const catalogs = {};
	for (const [name, entries] of Object.entries(JSON.parse(seedJson))) {
		if (name === "default") catalog = { ...entries };
		else catalogs[name] = { ...entries };
	}
	let config = { catalog, catalogs, minimumReleaseAge: undefined, minimumReleaseAgeExclude: undefined };
	for (const name of names) {
		let loaded;
		let found = false;
		for (const filename of ["pnpmfile.mjs", "pnpmfile.cjs"]) {
			const candidate = pathToFileURL(join(root, "node_modules", ".pnpm-config", name, filename)).href;
			try {
				loaded = await import(candidate);
				found = true;
				break;
			} catch (cause) {
				const url =
					isObject(cause) && cause.code === "ERR_MODULE_NOT_FOUND" && typeof cause.url === "string"
						? cause.url
						: undefined;
				if (url === candidate) continue;
				return failure(name, cause);
			}
		}
		if (!found) continue;
		let hook;
		for (const candidate of [loaded, isObject(loaded) ? loaded.default : undefined]) {
			if (!isObject(candidate)) continue;
			if (isObject(candidate.hooks) && typeof candidate.hooks.updateConfig === "function") {
				hook = candidate.hooks.updateConfig;
				break;
			}
			if (typeof candidate.updateConfig === "function") {
				hook = candidate.updateConfig;
				break;
			}
		}
		if (hook === undefined) continue;
		try {
			config = configOf(hook(config), config);
		} catch (cause) {
			return failure(name, cause);
		}
	}
	return { ok: true, config };
};
const payload = await replay();
process.stdout.write("\\n" + JSON.stringify(payload) + "\\n", () => process.exit(0));
`;

/**
 * The ceiling on one subprocess replay. A config dependency's `updateConfig`
 * reads and rewrites a config object — no install work, no network — so thirty
 * seconds is generous. Without a ceiling a pnpmfile that loops or awaits a
 * promise that never settles hangs `inject`, and through it the one memoized
 * {@link WorkspaceCatalogs} assemble pass every catalog read blocks on. Expiry
 * kills the child (`Run` scopes it) and surfaces as a `CommandFailedError`
 * through the same typed transport-failure path as any other mechanism failure.
 */
const REPLAY_TIMEOUT = Duration.seconds(30);

/**
 * The subprocess protocol payload — a single JSON line near the end of the
 * child's stdout, framed and parsed by `Run.jsonLine`, which scans lines from
 * the end for the first that decodes (so a hook logging after the payload —
 * e.g. from `process.on("exit", ...)` — cannot displace it). The `ok`
 * discriminant is what keeps an accidental log line from satisfying the
 * envelope. The envelope is strict (a payload without a usable
 * `ok` discriminant is a mechanism failure, typed); the `config` slice inside a
 * success stays `Unknown` because a hook's returned *data* is tolerantly
 * threaded (`configOf`), never fatal.
 */
const ReplayPayload = Schema.Union([
	Schema.Struct({ ok: Schema.Literal(true), config: Schema.Unknown }),
	Schema.Struct({
		ok: Schema.Literal(false),
		name: Schema.optionalKey(Schema.String),
		message: Schema.optionalKey(Schema.String),
		stack: Schema.optionalKey(Schema.String),
	}),
]);

/** Rebuild the subprocess's serialized failure as an `Error`, preserving the child-side stack when it carried one. */
const replayFailureCause = (payload: { readonly message?: string; readonly stack?: string }): Error => {
	const error = new Error(payload.message ?? "config dependency hook replay failed");
	if (payload.stack !== undefined) error.stack = payload.stack;
	return error;
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

	/**
	 * The subprocess layer: replays each config dependency's pnpmfile in a `node`
	 * child process instead of an in-process dynamic `import()`, with identical
	 * typed semantics to {@link ConfigDependencyHooks.layerLive} — the two are
	 * drop-in interchangeable.
	 *
	 * @remarks
	 * `layerLive` computes the `import()` path at runtime, and a bundler (rspack,
	 * for one) compiles a *computed* dynamic import into a context module that
	 * throws `Cannot find module 'file:///…'` at runtime — so in any bundled
	 * consumer, a GitHub Action above all, the in-process replay is unreachable.
	 * This layer keeps every computed load out of the bundle graph: the replay
	 * program is a **static** string constant passed via argv
	 * (`node --input-type=module -e <script> <root> <seed> <...names>`), and the
	 * child process performs the computed imports where no bundler rewrote them.
	 * A subprocess also keeps config-dependency code out of the consumer's own
	 * process.
	 *
	 * The contract's semantics are unchanged, not the downstream fail-open shape:
	 * an empty `configDependencies` returns the seed without spawning anything; a
	 * `..` path segment in a dependency name fails typed **before** any spawn; a
	 * missing pnpmfile (neither `.mjs` nor `.cjs`) is the one legitimate skip,
	 * discriminated inside the child by `err.url` equality exactly as
	 * `layerLive` discriminates in process; any other load failure — a syntax
	 * error, a throwing top level, an `ERR_MODULE_NOT_FOUND` for a module the
	 * pnpmfile itself imports — and a hook that throws when called are serialized
	 * back per-name and surface typed as a `hooks`-source `CatalogAssemblyError`
	 * naming that dependency. A hook's returned *data* stays tolerantly threaded
	 * (last well-formed write wins), never fatal. Spawn and transport failures —
	 * `node` absent, a non-zero exit without a result payload, unparseable
	 * output — fail typed too, never a defect and never a silent skip.
	 *
	 * Two bounds this layer imposes that `layerLive` cannot: the replay is
	 * given thirty seconds (a pnpmfile that loops or awaits forever fails typed
	 * instead of hanging the memoized assemble pass — a subprocess is killable,
	 * while `layerLive`'s in-process synchronous hook call is not interruptible
	 * by any means, so the asymmetry is inherent, not a parity violation), and
	 * the child's stdout is captured under `Run.jsonLine`'s 16 MiB default
	 * ceiling (a hook that logs more than that fails typed as `tooLarge`, where
	 * `layerLive` — which captures nothing — would succeed).
	 *
	 * Catalog folding and normalization stay in the **parent** (the same
	 * `@pnpm/catalogs`-derived path `layerLive` uses); the child returns only the
	 * raw threaded config slice, since the script cannot import kit code.
	 *
	 * Requires core's `ChildProcessSpawner`, resolved when the layer is built —
	 * the consumer provides it once at the edge (`@effect/platform-node`'s
	 * `NodeServices.layer`), the same discharge `@effected/git` uses. Wired by
	 * `WorkspaceCatalogs.layerWithConfigDependenciesSubprocess` /
	 * `Workspaces.layerWithConfigDependenciesSubprocess`.
	 */
	static readonly layerSubprocess: Layer.Layer<ConfigDependencyHooks, never, ChildProcessSpawner.ChildProcessSpawner> =
		Layer.effect(
			ConfigDependencyHooks,
			Effect.gen(function* () {
				const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
				return {
					inject: (root, configDependencies, seed) =>
						Effect.gen(function* () {
							const names = Object.keys(configDependencies);
							if (names.length === 0) return { catalogs: seed, releaseAge: {} };

							// Validate every name BEFORE spawning: a `..` segment would escape
							// `.pnpm-config` inside the child. Fails typed on the same
							// `hooks`-source path as layerLive — never a silent skip, and no
							// subprocess ever sees the malicious name.
							for (const name of names) {
								if (hasTraversalSegment(name)) {
									return yield* Effect.fail(
										new CatalogAssemblyError({
											source: "hooks",
											path: name,
											cause: new Error(`config dependency name has a '..' path segment: ${name}`),
										}),
									);
								}
							}

							// Root, seed and names travel via argv — never interpolated into the
							// script, and `ChildProcess.make` spawns without a shell. `Run.jsonLine`
							// owns the framing: scanning stdout lines from the end, the payload is
							// the last line that decodes under the envelope — tolerant of a hook's
							// own console noise before AND after it — parsed REGARDLESS of the
							// exit code, since the envelope's `ok` discriminates in-band. No valid
							// payload (a crash, a non-zero exit with no result, garbage output) is
							// a mechanism failure, typed, with the exit code and stderr carried as
							// context on the `CommandOutputError` cause.
							const command = ChildProcess.make("node", [
								"--input-type=module",
								"-e",
								REPLAY_SCRIPT,
								root,
								JSON.stringify(seed),
								...names,
							]);
							// The replay executes arbitrary config-dependency code; bound it, or a
							// spinning pnpmfile hangs catalog assembly for the whole program. On
							// expiry `Run` kills the child and fails with a `CommandFailedError`,
							// which the catch below maps onto the same typed `hooks` failure as
							// any other transport failure.
							const payload = yield* Run.jsonLine(command, ReplayPayload, { timeout: REPLAY_TIMEOUT }).pipe(
								Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
								Effect.catch((cause) => Effect.fail(new CatalogAssemblyError({ source: "hooks", path: root, cause }))),
							);

							// A serialized per-name failure: the child discriminated a real
							// load/replay failure from the legitimate missing-pnpmfile skip, so
							// this maps 1:1 onto layerLive's typed error, attribution intact.
							if (payload.ok === false) {
								return yield* Effect.fail(
									new CatalogAssemblyError({
										source: "hooks",
										path: payload.name ?? root,
										cause: replayFailureCause(payload),
									}),
								);
							}

							// The child returned the raw threaded config slice; fold and normalize
							// in the parent exactly as layerLive does, reading the slice tolerantly
							// against the seed (a hook's returned data is never fatal).
							const config = configOf(payload.config, seedToConfig(seed));
							return { catalogs: configToEntries(config), releaseAge: releaseAgeOf(config) };
						}),
				};
			}),
		);
}
