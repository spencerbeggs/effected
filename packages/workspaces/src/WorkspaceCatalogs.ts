// pnpm catalogs: the `CatalogSet` value, the service that assembles it for a
// workspace, and the real implementation of `@effected/npm`'s `CatalogResolver`
// contract.
//
// Assembly precedence follows pnpm: lockfile-recorded catalogs first, then the
// inline `pnpm-workspace.yaml` catalogs, which win.

import type { Lockfile } from "@effected/lockfiles";
import {
	CatalogAssemblyError,
	CatalogResolver,
	DependencyResolutionError,
	PartialReleaseAgeGate,
	ReleaseAgeGate,
} from "@effected/npm";
import { Yaml } from "@effected/yaml";
import { Context, Duration, Effect, Exit, FileSystem, Layer, Option, Path, PlatformError, Schema } from "effect";
import { ConfigDependencyHooks } from "./ConfigDependencyHooks.js";
import type { Catalogs } from "./internal/catalogs.js";
import { inlineCatalogs, merge, normalize, rangeOf } from "./internal/catalogs.js";
import type { LockfileReadFailure } from "./LockfileReader.js";
import { LockfileReader } from "./LockfileReader.js";
import type { WorkspaceRootNotFoundError } from "./WorkspaceRoot.js";
import { WorkspaceRoot } from "./WorkspaceRoot.js";

/**
 * An immutable, fully-normalized catalog collection — the one catalog
 * resolution semantic in the package.
 *
 * @remarks
 * `entries` is catalog name → dependency → range, with pnpm's unnamed
 * top-level `catalog:` block normalized under the key `"default"`. Lockfile
 * catalog entries, which pnpm records as `{ specifier, version }`, are
 * normalized to their `specifier` — the declared range, which is what a catalog
 * resolves to.
 *
 * @public
 */
export class CatalogSet extends Schema.Class<CatalogSet>("CatalogSet")({
	/** Catalog name → dependency name → version range. */
	entries: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)),
}) {
	/** The empty set — a workspace with no catalogs. */
	static empty(): CatalogSet {
		return CatalogSet.make({ entries: {} });
	}

	/** Wrap a pnpm `Catalogs` map, dropping unusable entries. */
	static fromCatalogs(catalogs: unknown): CatalogSet {
		return CatalogSet.make({ entries: normalize(catalogs) });
	}

	/**
	 * The `catalog:` and `catalogs:` blocks of a `pnpm-workspace.yaml` document.
	 *
	 * @param text - The raw YAML text.
	 */
	static readonly fromWorkspaceYaml = Effect.fn("CatalogSet.fromWorkspaceYaml")(function* (text: string) {
		const document = yield* Yaml.parse(text).pipe(
			Effect.mapError((cause) => new CatalogAssemblyError({ source: "manifest", path: "pnpm-workspace.yaml", cause })),
		);
		return CatalogSet.fromCatalogs(inlineCatalogs(catalogBlocksOf(document)));
	});

	/**
	 * The `catalogs:` section of a pnpm lockfile, whose entries are either a bare
	 * range or a `{ specifier, version }` pair.
	 */
	static fromLockfileCatalogs(raw: unknown): CatalogSet {
		return CatalogSet.make({ entries: normalize(raw) });
	}

	/**
	 * The catalog set a parsed lockfile records, PM-aware.
	 *
	 * @remarks
	 * Both pnpm and bun record catalogs in the lockfile, in different shapes:
	 * pnpm under `extension.catalogs`, bun under `extension.catalog` /
	 * `extension.catalogs`. Assembly reads whichever the parsed lockfile carries
	 * rather than assuming the pnpm extension. A lockfile with no extension, or a
	 * pnpm one with no catalogs, yields the empty set.
	 *
	 * @param lockfile - A parsed lockfile from `@effected/lockfiles`.
	 */
	static fromLockfile(lockfile: Lockfile): CatalogSet {
		const ext = lockfile.extension;
		if (ext === undefined) return CatalogSet.empty();
		if (ext._tag === "pnpm") {
			return ext.catalogs !== undefined ? CatalogSet.fromLockfileCatalogs(ext.catalogs) : CatalogSet.empty();
		}
		return CatalogSet.fromBunBlocks({ catalog: ext.catalog, catalogs: ext.catalogs });
	}

	/**
	 * A catalog set from bun's `{ catalog, catalogs }` blocks — used for the
	 * `bun.lock` extension and for the root `package.json` `workspaces` block. The
	 * unnamed default catalog normalizes under `"default"`. Tolerant: unusable
	 * values are dropped, never fatal.
	 *
	 * @param blocks - The `catalog` (default) and `catalogs` (named) blocks.
	 */
	static fromBunBlocks(blocks: { readonly catalog?: unknown; readonly catalogs?: unknown }): CatalogSet {
		const raw: Record<string, unknown> = {};
		if (isObject(blocks.catalogs)) Object.assign(raw, blocks.catalogs);
		if (isObject(blocks.catalog)) {
			raw.default = { ...(isObject(raw.default) ? raw.default : {}), ...blocks.catalog };
		}
		return CatalogSet.fromCatalogs(raw);
	}

	/**
	 * The `catalog` / `catalogs` blocks of a root `package.json` `workspaces` field
	 * — bun's package.json analogue of pnpm's `pnpm-workspace.yaml` blocks.
	 *
	 * @remarks
	 * **Hard-fail by design**, preserving the semantics catalog output is
	 * load-bearing for: a present-but-malformed `workspaces` shape (a number, a
	 * string, an object with a malformed `packages` / `catalog` / `catalogs`), or
	 * the default catalog declared twice — once as `workspaces.catalog` and again
	 * as `workspaces.catalogs.default` — fails with `CatalogAssemblyError`
	 * naming what was wrong. An absent `workspaces` field, one explicitly `null`,
	 * or the plain array form (npm/yarn patterns, which carry no catalogs) yields
	 * the empty set. Presence is checked structurally, so an explicitly-declared
	 * empty `catalog: {}` still counts as a declaration.
	 *
	 * @param text - The raw root `package.json` text.
	 */
	static readonly fromManifestWorkspaces = Effect.fn("CatalogSet.fromManifestWorkspaces")(function* (text: string) {
		const manifest = yield* Effect.try({
			try: () => JSON.parse(text) as unknown,
			catch: (cause) => new CatalogAssemblyError({ source: "manifest", path: "package.json", cause }),
		});
		if (!isObject(manifest)) {
			return yield* Effect.fail(
				new CatalogAssemblyError({
					source: "manifest",
					path: "package.json",
					cause: new Error("package.json is not a JSON object"),
				}),
			);
		}
		const blocks = yield* manifestCatalogBlocks(manifest.workspaces);
		return CatalogSet.fromBunBlocks(blocks);
	});

	/** Merge sets. Later sets win per dependency within a catalog. */
	static merge(...sets: ReadonlyArray<CatalogSet>): CatalogSet {
		return CatalogSet.fromCatalogs(merge(...sets.map((set) => set.entries as Catalogs)));
	}

	/** Whether any catalog declares anything. */
	get isEmpty(): boolean {
		return Object.keys(this.entries).length === 0;
	}

	/**
	 * The range a `catalog:` specifier resolves to.
	 *
	 * @remarks
	 * Total: an unmatched dependency, an unknown catalog name, or a non-catalog
	 * specifier all yield `Option.none()`. A *malformed* catalog — one pnpm
	 * itself rejects — also yields `Option.none()` here; the fallible surface is
	 * {@link WorkspaceCatalogs}, which fails typed on assembly instead.
	 *
	 * @param dependency - The package name being resolved.
	 * @param specifier - The declared specifier, e.g. `catalog:` or `catalog:build`.
	 */
	resolveSpecifier(dependency: string, specifier: string): Option.Option<string> {
		const resolved = rangeOf(this.entries as Catalogs, dependency, specifier);
		return typeof resolved === "string" ? Option.some(resolved) : Option.none();
	}

	/**
	 * The range `dependency` carries in a named catalog, or in the default
	 * catalog when `catalog` is `Option.none()`.
	 *
	 * @remarks
	 * The shape `@effected/npm`'s `CatalogResolver` contract asks for.
	 */
	rangeOf(dependency: string, catalog: Option.Option<string>): Option.Option<string> {
		const name = Option.getOrElse(catalog, () => "default");
		return Option.fromUndefinedOr(this.entries[name]?.[dependency]);
	}
}

/** Whether `value` is a non-null, non-array object. */
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether every value in an object is a string — a usable `dependency → range` catalog. */
const isStringRecord = (value: unknown): value is Record<string, string> =>
	isObject(value) && Object.values(value).every((entry) => typeof entry === "string");

/** The `catalog` / `catalogs` blocks of a parsed pnpm-workspace document. */
const catalogBlocksOf = (
	document: unknown,
): {
	readonly catalog?: Record<string, string> | undefined;
	readonly catalogs?: Record<string, Record<string, string>> | undefined;
} => {
	if (document === null || typeof document !== "object") return {};
	const raw = document as Record<string, unknown>;
	return {
		catalog: raw.catalog as Record<string, string> | undefined,
		catalogs: raw.catalogs as Record<string, Record<string, string>> | undefined,
	};
};

/** The `configDependencies` map (name → version+integrity) of a parsed pnpm-workspace document. */
const configDependenciesOf = (document: unknown): Record<string, string> => {
	if (!isObject(document) || !isObject(document.configDependencies)) return {};
	const out: Record<string, string> = {};
	for (const [name, spec] of Object.entries(document.configDependencies)) {
		if (typeof spec === "string") out[name] = spec;
	}
	return out;
};

/**
 * The inline release-age gate contribution of a parsed `pnpm-workspace.yaml`
 * document — pnpm's top-level `minimumReleaseAge` (minutes) and
 * `minimumReleaseAgeExclude` (name patterns) keys, mapped onto
 * `@effected/npm`'s `PartialReleaseAgeGate` field names
 * (`ageMinutes` / `exclude`).
 *
 * @remarks
 * **Hard-fail by design**, the same posture as the live catalog-block reader:
 * a present-but-malformed value (a non-numeric `minimumReleaseAge`, a
 * `minimumReleaseAgeExclude` that is not a string array) fails typed as a
 * `CatalogAssemblyError` rather than being silently dropped, because a
 * silently-ignored gate is the "install refuses a too-young version the
 * resolver already picked" bug this vocabulary exists to prevent. An absent or
 * explicitly `null` key contributes nothing; the permissive
 * `PartialReleaseAgeGate` accepts any finite `ageMinutes` (negatives and
 * fractions included) — `ReleaseAgeGate.combine` is the single clamping
 * authority, exactly as on the hook path.
 */
const inlineReleaseAge = (document: unknown): Effect.Effect<PartialReleaseAgeGate, CatalogAssemblyError> => {
	if (!isObject(document)) return Effect.succeed({});
	const raw: Record<string, unknown> = {};
	if (document.minimumReleaseAge !== undefined && document.minimumReleaseAge !== null) {
		raw.ageMinutes = document.minimumReleaseAge;
	}
	if (document.minimumReleaseAgeExclude !== undefined && document.minimumReleaseAgeExclude !== null) {
		raw.exclude = document.minimumReleaseAgeExclude;
	}
	if (Object.keys(raw).length === 0) return Effect.succeed({});
	return Schema.decodeUnknownEffect(PartialReleaseAgeGate)(raw).pipe(
		Effect.catchTag(
			"SchemaError",
			(cause) => new CatalogAssemblyError({ source: "manifest", path: "pnpm-workspace.yaml", cause }),
		),
	);
};

/** A hard-fail catalog-assembly failure naming the malformed part of a `workspaces` field. */
const malformed = (source: "manifest" | "catalog", path: string, detail: string): CatalogAssemblyError =>
	new CatalogAssemblyError({ source, path, cause: new Error(detail) });

/**
 * Validate a `catalog` (default) / `catalogs` (named) block pair, hard-failing on
 * a malformed shape or the default catalog declared twice.
 *
 * @remarks
 * Shared by the bun `package.json` `workspaces` reader
 * ({@link CatalogSet.fromManifestWorkspaces}) and the pnpm `pnpm-workspace.yaml`
 * reader, so both fail typed on exactly the same conditions rather than one
 * hard-failing and the other silently normalizing to `{}` — the "every dependency
 * looks newly added" bug. `labels` names the two blocks in the diagnostics so the
 * error reads in the caller's vocabulary (`workspaces.catalog` vs. `catalog`).
 */
const validatedCatalogBlocks = (
	catalog: unknown,
	catalogs: unknown,
	labels: { readonly catalog: string; readonly catalogs: string },
): Effect.Effect<
	{ readonly catalog?: Record<string, string>; readonly catalogs?: Record<string, Record<string, string>> },
	CatalogAssemblyError
> => {
	let validCatalog: Record<string, string> | undefined;
	if (catalog !== undefined && catalog !== null) {
		if (!isStringRecord(catalog)) {
			return Effect.fail(
				malformed("catalog", labels.catalog, `"${labels.catalog}" must map dependency names to version strings`),
			);
		}
		validCatalog = catalog;
	}

	let validCatalogs: Record<string, Record<string, string>> | undefined;
	if (catalogs !== undefined && catalogs !== null) {
		if (!isObject(catalogs)) {
			return Effect.fail(
				malformed("catalog", labels.catalogs, `"${labels.catalogs}" must map catalog names to catalogs`),
			);
		}
		for (const [name, entries] of Object.entries(catalogs)) {
			if (!isStringRecord(entries)) {
				return Effect.fail(
					malformed(
						"catalog",
						`${labels.catalogs}.${name}`,
						`"${labels.catalogs}.${name}" must map dependency names to version strings`,
					),
				);
			}
		}
		validCatalogs = catalogs as Record<string, Record<string, string>>;
	}

	// The default catalog declared twice — pnpm rejects the equivalent
	// duplication. Structural presence: an explicit `catalog: {}` still counts.
	if (validCatalog !== undefined && validCatalogs !== undefined && "default" in validCatalogs) {
		return Effect.fail(
			malformed(
				"catalog",
				"default",
				`The default catalog is declared twice: as "${labels.catalog}" and as "${labels.catalogs}.default"`,
			),
		);
	}

	return Effect.succeed({
		...(validCatalog !== undefined ? { catalog: validCatalog } : {}),
		...(validCatalogs !== undefined ? { catalogs: validCatalogs } : {}),
	});
};

/**
 * The `catalog` / `catalogs` blocks of a root `package.json` `workspaces` field,
 * hard-failing on a malformed shape or the default catalog declared twice.
 */
const manifestCatalogBlocks = (
	workspaces: unknown,
): Effect.Effect<
	{ readonly catalog?: Record<string, string>; readonly catalogs?: Record<string, Record<string, string>> },
	CatalogAssemblyError
> => {
	// Absent, explicitly null, or the npm/yarn array form: nothing to misread.
	if (workspaces === undefined || workspaces === null || Array.isArray(workspaces)) return Effect.succeed({});
	if (!isObject(workspaces)) {
		return Effect.fail(
			malformed("manifest", "package.json", `"workspaces" must be an array or object, got ${typeof workspaces}`),
		);
	}

	if (workspaces.packages !== undefined && workspaces.packages !== null) {
		const packages = workspaces.packages;
		if (!Array.isArray(packages) || !packages.every((entry) => typeof entry === "string")) {
			return Effect.fail(malformed("manifest", "package.json", `"workspaces.packages" must be an array of strings`));
		}
	}

	return validatedCatalogBlocks(workspaces.catalog, workspaces.catalogs, {
		catalog: "workspaces.catalog",
		catalogs: "workspaces.catalogs",
	});
};

/**
 * Validate the inline `catalog` / `catalogs` blocks of a parsed
 * `pnpm-workspace.yaml` document, hard-failing on the same malformed-shape and
 * duplicate-default conditions as the bun `package.json` path.
 *
 * @remarks
 * The live pnpm reader in {@link WorkspaceCatalogs.make} runs this BEFORE
 * normalizing with `inlineCatalogs`, so an invalid inline catalog fails typed
 * rather than normalizing to `{}` and reading as ABSENT. A non-object document,
 * or one with no catalog blocks, validates to `{}` — absent/empty still yields
 * empty. The return is discarded; normalization stays on the shared
 * `inlineCatalogs` path.
 */
const validatePnpmWorkspaceCatalogs = (document: unknown): Effect.Effect<void, CatalogAssemblyError> => {
	if (!isObject(document)) return Effect.void;
	return Effect.asVoid(
		validatedCatalogBlocks(document.catalog, document.catalogs, { catalog: "catalog", catalogs: "catalogs" }),
	);
};

/**
 * Every failure catalog assembly can surface.
 *
 * @public
 */
export type CatalogAssemblyFailure = CatalogAssemblyError | WorkspaceRootNotFoundError;

/** The single assembly pass's two outputs, memoized together. */
interface Assembled {
	readonly catalogs: CatalogSet;
	readonly releaseAgeGate: ReleaseAgeGate;
}

/**
 * The {@link WorkspaceCatalogs} service shape.
 *
 * @public
 */
export interface WorkspaceCatalogsShape {
	/** The assembled catalog set for the workspace. Memoized after the first call. */
	readonly set: () => Effect.Effect<CatalogSet, CatalogAssemblyFailure>;
	/** Resolve one `catalog:` specifier; `Option.none()` when it names nothing. */
	readonly resolveSpecifier: (
		dependency: string,
		specifier: string,
	) => Effect.Effect<Option.Option<string>, CatalogAssemblyFailure>;
	/**
	 * The effective pnpm release-age gate for the workspace, combined
	 * strictest-wins from the inline `pnpm-workspace.yaml` keys
	 * (`minimumReleaseAge` / `minimumReleaseAgeExclude`) and the replayed
	 * config-dependency hooks. Assembled from the same single read and hook
	 * replay as `set`, and memoized with it.
	 *
	 * @remarks
	 * Under the default layer (no-op hooks) only inline values contribute; under
	 * {@link WorkspaceCatalogs.layerWithConfigDependencies} the replayed hooks
	 * contribute too. A workspace with no pnpm-workspace.yaml (a bun/npm
	 * workspace) has no release-age keys, so the gate is the inert zero gate.
	 */
	readonly releaseAgeGate: () => Effect.Effect<ReleaseAgeGate, CatalogAssemblyFailure>;
}

/**
 * Options for the {@link WorkspaceCatalogs} layer.
 *
 * @public
 */
export interface WorkspaceCatalogsOptions {
	/**
	 * The directory the workspace root is resolved from.
	 *
	 * @defaultValue `process.cwd()`, read lazily on first use.
	 */
	readonly cwd?: string;
}

/**
 * Assembles a workspace's catalogs, package-manager-aware.
 *
 * @remarks
 * The inline source is picked by **file presence**, the same rule
 * `internal/patterns.ts` uses for globs: a `pnpm-workspace.yaml` selects the pnpm
 * path (its `catalog:` / `catalogs:` blocks); its absence selects the root
 * `package.json` `workspaces.catalog` / `workspaces.catalogs` (bun's analogue).
 * The lockfile source is PM-aware too — whichever extension the parsed lockfile
 * carries (pnpm or bun) contributes its recorded catalogs.
 *
 * Precedence, lowest first: catalogs recorded in the lockfile, then the inline
 * declaration, then — only under {@link WorkspaceCatalogs.layerWithConfigDependencies}
 * — the config-dependency `pnpmfile.cjs` hooks, each layer winning per dependency
 * within a catalog. An unreadable or absent lockfile degrades to no lockfile
 * catalogs rather than failing (the inline declaration is the source of truth, the
 * lockfile a record of what was installed); a malformed inline source **fails
 * typed** with `CatalogAssemblyError`, because a silently-empty catalog read
 * is the "every dependency looks newly added" bug.
 *
 * Assembly is deferred to the first call and memoized success-only, matching
 * {@link WorkspaceDiscovery}.
 *
 * @public
 */
export class WorkspaceCatalogs extends Context.Service<WorkspaceCatalogs, WorkspaceCatalogsShape>()(
	"@effected/workspaces/WorkspaceCatalogs",
) {
	/** Builds the service. */
	static readonly make = (
		options?: WorkspaceCatalogsOptions,
	): Effect.Effect<
		WorkspaceCatalogsShape,
		never,
		WorkspaceRoot | LockfileReader | ConfigDependencyHooks | FileSystem.FileSystem | Path.Path
	> =>
		Effect.gen(function* () {
			const roots = yield* WorkspaceRoot;
			const lockfiles = yield* LockfileReader;
			const hooks = yield* ConfigDependencyHooks;
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;

			// A file-presence probe that distinguishes genuine absence from a probe
			// FAILURE. `fs.exists` already normalizes a NotFound PlatformError to
			// `false`, so any error that escapes it (a permission or IO failure) is a
			// genuine probe failure — surfacing it typed rather than collapsing it to
			// "absent" is what keeps a locked-down `pnpm-workspace.yaml` from silently
			// selecting the package.json reader (a silently-empty catalog is the "every
			// dependency looks newly added" bug). The explicit NotFound arm is
			// belt-and-suspenders for a backend whose `exists` surfaces NotFound.
			//
			// A `PlatformError` wraps one of two variants: `SystemError` (a normalized
			// `reason._tag` such as `NotFound` / `PermissionDenied`) or `BadArgument`
			// (`reason._tag === "BadArgument"`, no system reason). Only a `SystemError`
			// whose reason is `NotFound` is genuine absence; every other reason — a
			// `BadArgument`, or a `SystemError` with any other tag — is a real probe
			// failure and surfaces typed.
			const probeExists = (target: string): Effect.Effect<boolean, CatalogAssemblyError> =>
				fs.exists(target).pipe(
					Effect.catchTag("PlatformError", (error) => {
						const reason = error.reason;
						return reason instanceof PlatformError.SystemError && reason._tag === "NotFound"
							? Effect.succeed(false)
							: Effect.fail(new CatalogAssemblyError({ source: "manifest", path: target, cause: error }));
					}),
				);

			// The single assembly pass produces BOTH the catalog set and the effective
			// release-age gate off one root discovery, one inline read, and one hook
			// replay — so the config-dependency hooks (which execute arbitrary code)
			// run exactly once, and both outputs share the same memo.
			const assemble: Effect.Effect<Assembled, CatalogAssemblyFailure> = Effect.gen(function* () {
				const root = yield* Effect.suspend(() => roots.find(options?.cwd ?? process.cwd()));

				// The lockfile is a RECORD of what was installed; an absent or
				// unreadable one is not a catalog failure, it just contributes nothing.
				// PM-aware: whichever extension (pnpm or bun) the lockfile carries.
				const fromLockfile = yield* lockfiles.read().pipe(
					Effect.map(CatalogSet.fromLockfile),
					Effect.catch((_failure: LockfileReadFailure) => Effect.succeed(CatalogSet.empty())),
				);

				// File presence picks the inline reader, the same rule the glob
				// enumerator uses: pnpm-workspace.yaml → the pnpm path (config
				// dependencies live only here); absent → the package.json path.
				const workspaceYaml = path.join(root, "pnpm-workspace.yaml");
				const hasPnpmWorkspace = yield* probeExists(workspaceYaml);

				let inline: CatalogSet;
				let injected: CatalogSet;
				// The release-age gate contributions: inline pnpm-workspace.yaml keys and
				// the replayed hooks. Both empty on the bun/package.json path (release-age
				// is a pnpm feature and config dependencies live only in pnpm-workspace.yaml).
				let inlineGate: PartialReleaseAgeGate = {};
				let hookGate: PartialReleaseAgeGate = {};
				if (hasPnpmWorkspace) {
					const text = yield* fs
						.readFileString(workspaceYaml)
						.pipe(
							Effect.mapError((cause) => new CatalogAssemblyError({ source: "manifest", path: workspaceYaml, cause })),
						);
					const document = yield* Yaml.parse(text).pipe(
						Effect.mapError(
							(cause) => new CatalogAssemblyError({ source: "manifest", path: "pnpm-workspace.yaml", cause }),
						),
					);
					// Validate the inline shape BEFORE normalizing: a malformed catalog block
					// or the default catalog declared twice must fail typed here, exactly as
					// the bun package.json path does — normalization would otherwise swallow
					// it and read as an ABSENT catalog. Absent/empty catalogs still yield empty.
					yield* validatePnpmWorkspaceCatalogs(document);
					inline = CatalogSet.fromCatalogs(inlineCatalogs(catalogBlocksOf(document)));
					// The inline release-age keys, hard-failing on a malformed value the same
					// way the catalog blocks do.
					inlineGate = yield* inlineReleaseAge(document);
					// The opt-in hook replay, seeded by the inline catalogs and merged on
					// top. The default layer's no-op hooks return the seed untouched, so
					// this executes no config-dependency code. It surfaces both the injected
					// catalogs and the hooks' release-age contribution from one replay.
					const injection = yield* hooks.inject(root, configDependenciesOf(document), inline.entries);
					injected = CatalogSet.fromCatalogs(injection.catalogs);
					hookGate = injection.releaseAge;
				} else {
					const manifestPath = path.join(root, "package.json");
					// The presence probe must distinguish genuine absence from a probe
					// FAILURE here too: a non-NotFound PlatformError (a permission/IO error)
					// on `package.json` must fail typed rather than collapse to "absent" and
					// return lockfile-only catalogs — the "every dependency looks newly
					// added" bug on the bun branch. `probeExists` already does this.
					const hasManifest = yield* probeExists(manifestPath);
					if (!hasManifest) return { catalogs: fromLockfile, releaseAgeGate: ReleaseAgeGate.combine() };
					const text = yield* fs
						.readFileString(manifestPath)
						.pipe(
							Effect.mapError((cause) => new CatalogAssemblyError({ source: "manifest", path: manifestPath, cause })),
						);
					inline = yield* CatalogSet.fromManifestWorkspaces(text);
					// Config dependencies are a pnpm feature; there are none on this path.
					injected = CatalogSet.empty();
				}

				const assembled = CatalogSet.merge(fromLockfile, inline, injected);
				// Strictest-wins across the two sources: max age (clamped non-negative),
				// exclude sets unioned — `ReleaseAgeGate.combine` is the single authority.
				const releaseAgeGate = ReleaseAgeGate.combine(inlineGate, hookGate);
				yield* Effect.logDebug("Catalogs assembled").pipe(
					Effect.annotateLogs({
						"workspace.root": root,
						"workspace.catalogs": Object.keys(assembled.entries).join(","),
						"workspace.releaseAgeMinutes": releaseAgeGate.ageMinutes,
					}),
				);
				return { catalogs: assembled, releaseAgeGate };
			});

			const [resolveOnce, invalidate] = yield* Effect.cachedInvalidateWithTTL(assemble, Duration.infinity);
			const memo = Effect.onExit(resolveOnce, (exit) => (Exit.isSuccess(exit) ? Effect.void : invalidate));

			return {
				set: Effect.fn("WorkspaceCatalogs.set")(function* () {
					return (yield* memo).catalogs;
				}),
				resolveSpecifier: Effect.fn("WorkspaceCatalogs.resolveSpecifier")(function* (
					dependency: string,
					specifier: string,
				) {
					return (yield* memo).catalogs.resolveSpecifier(dependency, specifier);
				}),
				releaseAgeGate: Effect.fn("WorkspaceCatalogs.releaseAgeGate")(function* () {
					return (yield* memo).releaseAgeGate;
				}),
			};
		});

	/**
	 * The live layer — the default, which **never executes config-dependency
	 * code**: it wires {@link ConfigDependencyHooks.layerNoop}, whose hooks return
	 * the inline-catalog seed untouched.
	 *
	 * @remarks
	 * Parameterized, so it mints a fresh reference per call — bind it to a
	 * `const` and reuse it, or layer memoization does not apply.
	 */
	static readonly layer = (
		options?: WorkspaceCatalogsOptions,
	): Layer.Layer<WorkspaceCatalogs, never, WorkspaceRoot | LockfileReader | FileSystem.FileSystem | Path.Path> =>
		Layer.effect(WorkspaceCatalogs, WorkspaceCatalogs.make(options)).pipe(
			Layer.provide(ConfigDependencyHooks.layerNoop),
		);

	/**
	 * The opt-in live layer that **does** replay config-dependency `pnpmfile.cjs`
	 * hooks: it wires {@link ConfigDependencyHooks.layerLive}, which dynamically
	 * imports and runs each config dependency's `updateConfig` in process.
	 *
	 * @remarks
	 * Same output and requirement set as {@link WorkspaceCatalogs.layer} — the only
	 * difference is that config-dependency code is executed. Use it deliberately;
	 * the default catalog path stays free of any config-dependency execution.
	 * Parameterized, so bind it to a `const` and reuse it.
	 */
	static readonly layerWithConfigDependencies = (
		options?: WorkspaceCatalogsOptions,
	): Layer.Layer<WorkspaceCatalogs, never, WorkspaceRoot | LockfileReader | FileSystem.FileSystem | Path.Path> =>
		Layer.effect(WorkspaceCatalogs, WorkspaceCatalogs.make(options)).pipe(
			Layer.provide(ConfigDependencyHooks.layerLive),
		);

	/**
	 * The real implementation of `@effected/npm`'s `CatalogResolver` contract —
	 * the one `@effected/package-json` declares but cannot fill.
	 *
	 * @remarks
	 * `rangeOf` returns `Option.none()` for a dependency no catalog declares, per
	 * the contract's convention. A failed catalog *assembly* — an unreadable or
	 * malformed `pnpm-workspace.yaml`, a broken config-dependency hook — passes
	 * through **typed** as the contract's `CatalogAssemblyError` (it used to be
	 * folded into `DependencyResolutionError`'s defect `cause`, which forced
	 * consumers to `_tag`-sniff `unknown`); only the remaining mechanism failure,
	 * an unfindable workspace root, is wrapped as `DependencyResolutionError`.
	 */
	static readonly catalogResolver: Layer.Layer<CatalogResolver, never, WorkspaceCatalogs> = Layer.effect(
		CatalogResolver,
		Effect.gen(function* () {
			const catalogs = yield* WorkspaceCatalogs;
			return {
				rangeOf: (packageName: string, catalog: Option.Option<string>) =>
					catalogs.set().pipe(
						Effect.map((set) => set.rangeOf(packageName, catalog)),
						Effect.catchTag("WorkspaceRootNotFoundError", (cause) =>
							Effect.fail(
								new DependencyResolutionError({
									specifier: Option.match(catalog, {
										onNone: () => "catalog:",
										onSome: (name) => `catalog:${name}`,
									}),
									cause,
								}),
							),
						),
					),
			};
		}),
	);
}
