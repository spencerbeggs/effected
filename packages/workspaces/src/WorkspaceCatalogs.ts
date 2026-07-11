// pnpm catalogs: the `CatalogSet` value, the service that assembles it for a
// workspace, and the real implementation of `@effected/npm`'s `CatalogResolver`
// contract.
//
// Assembly precedence follows pnpm: lockfile-recorded catalogs first, then the
// inline `pnpm-workspace.yaml` catalogs, which win.

import { CatalogResolver, DependencyResolutionError } from "@effected/npm";
import { Yaml } from "@effected/yaml";
import { Context, Duration, Effect, Exit, FileSystem, Layer, Option, Path, Schema } from "effect";
import type { Catalogs } from "./internal/catalogs.js";
import { inlineCatalogs, merge, normalize, rangeOf } from "./internal/catalogs.js";
import type { LockfileReadFailure } from "./LockfileReader.js";
import { LockfileReader } from "./LockfileReader.js";
import type { WorkspaceRootNotFoundError } from "./WorkspaceRoot.js";
import { WorkspaceRoot } from "./WorkspaceRoot.js";

/**
 * Raised when a workspace's catalogs cannot be assembled — the
 * `pnpm-workspace.yaml` is unreadable or is not valid YAML, or a catalog it
 * declares is malformed in a way pnpm itself rejects.
 *
 * @remarks
 * A missing `pnpm-workspace.yaml` is not an error: a non-pnpm workspace simply
 * has no catalogs, and assembly yields the empty set.
 *
 * @public
 */
export class CatalogAssemblyError extends Schema.TaggedErrorClass<CatalogAssemblyError>()("CatalogAssemblyError", {
	/** Which input failed. */
	source: Schema.Literals(["manifest", "catalog"]),
	/** The file, or the catalog name. */
	path: Schema.String,
	/** The originating failure. */
	cause: Schema.Defect(),
}) {
	/** Renders the failing source into a one-line message. */
	override get message(): string {
		return `Failed to assemble catalogs from ${this.source} ${this.path}`;
	}
}

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

/**
 * Every failure catalog assembly can surface.
 *
 * @public
 */
export type CatalogAssemblyFailure = CatalogAssemblyError | WorkspaceRootNotFoundError;

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
 * Assembles a workspace's pnpm catalogs.
 *
 * @remarks
 * Precedence, lowest first: catalogs recorded in the lockfile, then the inline
 * `catalog:` / `catalogs:` blocks of `pnpm-workspace.yaml`, which win. An
 * unreadable or absent lockfile degrades to no lockfile catalogs rather than
 * failing — the inline declaration is the source of truth, the lockfile is a
 * record of what was installed.
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
	): Effect.Effect<WorkspaceCatalogsShape, never, WorkspaceRoot | LockfileReader | FileSystem.FileSystem | Path.Path> =>
		Effect.gen(function* () {
			const roots = yield* WorkspaceRoot;
			const lockfiles = yield* LockfileReader;
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;

			const assemble: Effect.Effect<CatalogSet, CatalogAssemblyFailure> = Effect.gen(function* () {
				const root = yield* Effect.suspend(() => roots.find(options?.cwd ?? process.cwd()));

				// The lockfile is a RECORD of what was installed; an absent or
				// unreadable one is not a catalog failure, it just contributes nothing.
				const fromLockfile = yield* lockfiles.read().pipe(
					Effect.map((lockfile) =>
						lockfile.extension !== undefined && lockfile.extension._tag === "pnpm"
							? CatalogSet.fromLockfileCatalogs(lockfile.extension.catalogs)
							: CatalogSet.empty(),
					),
					Effect.catch((_failure: LockfileReadFailure) => Effect.succeed(CatalogSet.empty())),
				);

				const workspaceYaml = path.join(root, "pnpm-workspace.yaml");
				const exists = yield* fs.exists(workspaceYaml).pipe(Effect.orElseSucceed(() => false));
				if (!exists) return fromLockfile;

				const text = yield* fs
					.readFileString(workspaceYaml)
					.pipe(
						Effect.mapError((cause) => new CatalogAssemblyError({ source: "manifest", path: workspaceYaml, cause })),
					);
				const inline = yield* CatalogSet.fromWorkspaceYaml(text);

				const assembled = CatalogSet.merge(fromLockfile, inline);
				yield* Effect.logDebug("Catalogs assembled").pipe(
					Effect.annotateLogs({
						"workspace.root": root,
						"workspace.catalogs": Object.keys(assembled.entries).join(","),
					}),
				);
				return assembled;
			});

			const [resolveOnce, invalidate] = yield* Effect.cachedInvalidateWithTTL(assemble, Duration.infinity);
			const memo = Effect.onExit(resolveOnce, (exit) => (Exit.isSuccess(exit) ? Effect.void : invalidate));

			return {
				set: Effect.fn("WorkspaceCatalogs.set")(function* () {
					return yield* memo;
				}),
				resolveSpecifier: Effect.fn("WorkspaceCatalogs.resolveSpecifier")(function* (
					dependency: string,
					specifier: string,
				) {
					const catalogs = yield* memo;
					return catalogs.resolveSpecifier(dependency, specifier);
				}),
			};
		});

	/**
	 * The live layer.
	 *
	 * @remarks
	 * Parameterized, so it mints a fresh reference per call — bind it to a
	 * `const` and reuse it, or layer memoization does not apply.
	 */
	static readonly layer = (
		options?: WorkspaceCatalogsOptions,
	): Layer.Layer<WorkspaceCatalogs, never, WorkspaceRoot | LockfileReader | FileSystem.FileSystem | Path.Path> =>
		Layer.effect(WorkspaceCatalogs, WorkspaceCatalogs.make(options));

	/**
	 * The real implementation of `@effected/npm`'s `CatalogResolver` contract —
	 * the one `@effected/package-json` declares but cannot fill.
	 *
	 * @remarks
	 * `rangeOf` returns `Option.none()` for a dependency no catalog declares, per
	 * the contract's convention; `DependencyResolutionError` is reserved for a
	 * failure of the resolution *mechanism* — an unfindable workspace root, an
	 * unreadable or malformed `pnpm-workspace.yaml`.
	 */
	static readonly catalogResolver: Layer.Layer<CatalogResolver, never, WorkspaceCatalogs> = Layer.effect(
		CatalogResolver,
		Effect.gen(function* () {
			const catalogs = yield* WorkspaceCatalogs;
			return {
				rangeOf: (packageName: string, catalog: Option.Option<string>) =>
					catalogs.set().pipe(
						Effect.map((set) => set.rangeOf(packageName, catalog)),
						Effect.mapError(
							(cause) =>
								new DependencyResolutionError({
									specifier: Option.match(catalog, {
										onNone: () => "catalog:",
										onSome: (name) => `catalog:${name}`,
									}),
									cause,
								}),
						),
					),
			};
		}),
	);
}
