// The point-in-time value: what a workspace looked like at one moment (a git
// ref, or the live worktree). Serializable by construction — every field is a
// plain scalar, record, or another value class — with the resolution machinery
// living in lazily-built `#private` indexes OUTSIDE the schema, the same
// precedent `DependencyGraph`'s edge index and `Lockfile.packagesNamed` cite.
//
// A snapshot answers "what did this specifier mean HERE" against ITS OWN state:
// `workspace:` against the versions it captured, `catalog:` against the catalog
// set it captured. It also hands back `@effected/npm` resolver layers bound to
// itself, so code written to those contracts can run "as of" a ref.

import { CatalogResolver, DependencySpecifier, WorkspaceResolver } from "@effected/npm";
import { Effect, Exit, Layer, Option, Schema } from "effect";
import { unanimousVersionOf } from "./internal/importerVersions.js";
import { CatalogSet } from "./WorkspaceCatalogs.js";

// A frozen, prototype-free empty map shared as the default for every absent
// dependency record — the `WorkspacePackage` precedent, so an omitted record
// round-trips as `{}` rather than `undefined`.
const EMPTY: Record<string, string> = Object.freeze(Object.create(null) as Record<string, string>);

const DependencyMap = Schema.Record(Schema.String, Schema.String).pipe(
	Schema.withDecodingDefaultKey(Effect.succeed(EMPTY)),
	Schema.withConstructorDefault(Effect.succeed(EMPTY)),
);

/**
 * One workspace member as captured in a {@link WorkspaceStateSnapshot} — the
 * serializable slice a snapshot diff reads: identity, version, location, and the
 * four dependency records.
 *
 * @remarks
 * Deliberately narrower than {@link WorkspacePackage}: a snapshot is a value to
 * store and diff, not a located member to act on, so it carries no absolute
 * paths, `publishConfig`, or `private` flag. The four records are keyed by the
 * standard manifest field names, which are exactly `@effected/npm`'s
 * `DependencyField` values.
 *
 * @public
 */
export class PackageStateSnapshot extends Schema.Class<PackageStateSnapshot>("PackageStateSnapshot")({
	/** The package name. */
	name: Schema.NonEmptyString,
	/** The raw `version` string, as recorded at the captured moment. */
	version: Schema.String,
	/** POSIX path relative to the workspace root; `"."` for the root package. */
	relativePath: Schema.String,
	/** Production dependencies. */
	dependencies: DependencyMap,
	/** Development dependencies. */
	devDependencies: DependencyMap,
	/** Peer dependencies. */
	peerDependencies: DependencyMap,
	/** Optional dependencies. */
	optionalDependencies: DependencyMap,
}) {
	/**
	 * Every dependency, merged across the four kinds.
	 *
	 * @remarks
	 * Precedence on a name declared in several kinds runs
	 * `dependencies` \> `devDependencies` \> `peerDependencies` \>
	 * `optionalDependencies`.
	 */
	get allDependencies(): Record<string, string> {
		return {
			...this.optionalDependencies,
			...this.peerDependencies,
			...this.devDependencies,
			...this.dependencies,
		};
	}
}

/**
 * The state of a whole workspace at one moment — its packages and its assembled
 * catalog set — as a serializable value.
 *
 * @remarks
 * Produced by `WorkspaceSnapshots.at` (a git ref, read with no checkout)
 * or `WorkspaceSnapshots.worktree` (the live tree). The lookup and
 * resolution surfaces (`versions`, `package`, `resolve`, the resolver layers)
 * are backed by `#private` indexes built lazily on first use and never encoded —
 * the `DependencyGraph` edge-index precedent.
 *
 * `resolve` and the resolver layers answer specifiers against THIS snapshot's
 * own captured state, so a consumer can ask "what did `catalog:` /
 * `workspace:*` mean as of that ref". An unmatched specifier is always
 * `Option.none()`, never an error.
 *
 * @example
 * ```ts
 * import { WorkspaceSnapshots } from "@effected/workspaces";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const snapshots = yield* WorkspaceSnapshots;
 *   const before = yield* snapshots.at("origin/main");
 *   return before.resolve("effect", "catalog:");
 * });
 * ```
 *
 * @public
 */
export class WorkspaceStateSnapshot extends Schema.Class<WorkspaceStateSnapshot>("WorkspaceStateSnapshot")({
	/** Every workspace package captured at this moment. */
	packages: Schema.Array(PackageStateSnapshot),
	/** The catalog set assembled at this moment. */
	catalogs: CatalogSet,
	/**
	 * Each importer's dependency-name → resolved-version map, as the manager's
	 * lockfile recorded it at this moment.
	 *
	 * @remarks
	 * Defaults to `{}`, so a `WorkspaceStateSnapshot` serialized before this field
	 * existed still decodes — and an empty index simply makes the `catalog:`
	 * fallback in {@link WorkspaceStateSnapshot.resolve} inert, which is exactly
	 * the behavior those older values were captured under. Only pnpm records
	 * importer versions; bun and npm yield an empty index.
	 */
	importerVersions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String))),
}) {
	#versionIndex: ReadonlyMap<string, string> | undefined;
	#packageIndex: ReadonlyMap<string, PackageStateSnapshot> | undefined;
	#catalogResolver: Layer.Layer<CatalogResolver> | undefined;
	#workspaceResolver: Layer.Layer<WorkspaceResolver> | undefined;
	#resolvers: Layer.Layer<CatalogResolver | WorkspaceResolver> | undefined;

	#versions(): ReadonlyMap<string, string> {
		if (this.#versionIndex === undefined) {
			this.#versionIndex = new Map(this.packages.map((pkg) => [pkg.name, pkg.version]));
		}
		return this.#versionIndex;
	}

	#packages(): ReadonlyMap<string, PackageStateSnapshot> {
		if (this.#packageIndex === undefined) {
			this.#packageIndex = new Map(this.packages.map((pkg) => [pkg.name, pkg]));
		}
		return this.#packageIndex;
	}

	/** Every captured package's name → version. Total; O(1) after the first call. */
	get versions(): ReadonlyMap<string, string> {
		return this.#versions();
	}

	/** A single captured package by name, or `Option.none()`. Total. */
	package(name: string): Option.Option<PackageStateSnapshot> {
		return Option.fromUndefinedOr(this.#packages().get(name));
	}

	/**
	 * The concrete range or version a specifier resolved to AS OF this snapshot.
	 *
	 * @remarks
	 * The specifier is classified through `@effected/npm`'s
	 * `DependencySpecifier.FromString` — never by prefix-sniffing.
	 * A `workspace:` specifier resolves to the captured version of `dependency`; a
	 * `catalog:` specifier resolves against the captured catalog set. Every other
	 * form — a plain range, a dist-tag, a `file:`/git/url specifier, or an
	 * unparseable string — is `Option.none()`, because there is no indirection to
	 * resolve. Total.
	 *
	 * A `catalog:` specifier the catalog set cannot resolve falls back to this
	 * snapshot's `importerVersions` — but only to a version
	 * **every** importer recording that dependency agrees on. A catalog injected
	 * by a config-dependency pnpmfile hook appears in no committed catalog source,
	 * so without this fallback both sides of a before/after diff resolve it to the
	 * same raw string and a real version movement produces no row. When importers
	 * disagree there is no single correct answer, so this stays `Option.none()`
	 * rather than inventing one; {@link WorkspaceStateSnapshot.resolveIn} answers
	 * precisely for callers that know which importer is asking.
	 *
	 * @param dependency - The dependency's package name (what `workspace:` /
	 *   `catalog:` resolve for).
	 * @param specifier - The raw specifier string.
	 */
	resolve(dependency: string, specifier: string): Option.Option<string> {
		return this.#resolveWith(dependency, specifier, () =>
			Option.fromUndefinedOr(unanimousVersionOf(this.importerVersions ?? {}, dependency)),
		);
	}

	/**
	 * The concrete range or version a specifier resolved to AS OF this snapshot,
	 * scoped to the importer that declared it.
	 *
	 * @remarks
	 * Identical to {@link WorkspaceStateSnapshot.resolve} except in how an
	 * unresolvable `catalog:` specifier falls back: this consults **only**
	 * `importerPath`'s own recorded versions, so a monorepo whose packages hold
	 * different versions of one dependency still gets an exact answer where
	 * `resolve` must abstain. Prefer this whenever the caller knows the importer —
	 * a consumer iterating `packages` has `relativePath` in hand, which is the
	 * importer key (`"."` for the root package).
	 *
	 * An unknown `importerPath`, or one recording nothing for `dependency`, is
	 * `Option.none()`. Total.
	 *
	 * @param importerPath - The importer's path relative to the workspace root,
	 *   `"."` for the root package — `PackageStateSnapshot.relativePath`.
	 * @param dependency - The dependency's package name.
	 * @param specifier - The raw specifier string.
	 */
	resolveIn(importerPath: string, dependency: string, specifier: string): Option.Option<string> {
		return this.#resolveWith(dependency, specifier, () =>
			Option.fromUndefinedOr(this.importerVersions?.[importerPath]?.[dependency]),
		);
	}

	/**
	 * The shared resolution path: classify, answer from the captured state, and
	 * consult `onUnresolvedCatalog` only for a `catalog:` specifier the catalog set
	 * could not answer. A plain range is already its own answer and must keep
	 * resolving to `Option.none()` so the caller falls back to the raw string.
	 */
	#resolveWith(
		dependency: string,
		specifier: string,
		onUnresolvedCatalog: () => Option.Option<string>,
	): Option.Option<string> {
		const exit = Schema.decodeUnknownExit(DependencySpecifier.FromString)(specifier);
		if (!Exit.isSuccess(exit)) return Option.none();
		const classified = exit.value;
		switch (classified._tag) {
			case "catalog": {
				const fromCatalogs = this.catalogs.rangeOf(dependency, classified.name);
				return Option.isSome(fromCatalogs) ? fromCatalogs : onUnresolvedCatalog();
			}
			case "workspace":
				return Option.fromUndefinedOr(this.#versions().get(dependency));
			default:
				return Option.none();
		}
	}

	/**
	 * A `CatalogResolver` layer implementing `@effected/npm`'s contract against
	 * THIS snapshot's catalog set — so code written to the contract resolves
	 * `catalog:` specifiers as of this ref. Built once per instance and cached, so
	 * it memoizes by reference.
	 *
	 * @remarks
	 * The contract's error channel (`CatalogAssemblyError` /
	 * `DependencyResolutionError`) is satisfied vacuously: a snapshot's catalogs
	 * were already assembled when it was captured, so this resolver is total —
	 * `rangeOf` never fails.
	 */
	get catalogResolver(): Layer.Layer<CatalogResolver> {
		if (this.#catalogResolver === undefined) {
			this.#catalogResolver = Layer.succeed(CatalogResolver, {
				rangeOf: (packageName: string, catalog: Option.Option<string>) =>
					Effect.succeed(this.catalogs.rangeOf(packageName, catalog)),
			});
		}
		return this.#catalogResolver;
	}

	/**
	 * A `WorkspaceResolver` layer implementing `@effected/npm`'s contract against
	 * THIS snapshot's captured versions — so code written to the contract resolves
	 * `workspace:` specifiers as of this ref. Built once per instance and cached.
	 */
	get workspaceResolver(): Layer.Layer<WorkspaceResolver> {
		if (this.#workspaceResolver === undefined) {
			this.#workspaceResolver = Layer.succeed(WorkspaceResolver, {
				versionOf: (packageName: string) => Effect.succeed(Option.fromUndefinedOr(this.#versions().get(packageName))),
			});
		}
		return this.#workspaceResolver;
	}

	/** Both snapshot-scoped resolver layers merged. Built once per instance and cached. */
	get resolvers(): Layer.Layer<CatalogResolver | WorkspaceResolver> {
		if (this.#resolvers === undefined) {
			this.#resolvers = Layer.mergeAll(this.catalogResolver, this.workspaceResolver);
		}
		return this.#resolvers;
	}
}
