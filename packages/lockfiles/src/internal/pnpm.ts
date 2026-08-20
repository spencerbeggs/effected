import { Effect, Schema } from "effect";
import { LockfileImporter } from "../LockfileImporter.js";
import { PnpmExtension } from "../PnpmExtension.js";
import { ResolvedPackage } from "../ResolvedPackage.js";
import { selectPnpmDocument } from "./documents.js";
import type { LockfileFields, ParseFailure, WorkspaceEntry } from "./shared.js";
import {
	extractWorkspaceDeps,
	framingFailure,
	importerDependencies,
	peerDeclarations,
	requireLockfileVersion,
	splitPeerSuffix,
	toIntegrityHash,
	validationFailure,
} from "./shared.js";

// ── Raw schema (permissive validation scaffolding, not API) ────────────────

const PnpmImporterDeps = Schema.optionalKey(
	Schema.Record(Schema.String, Schema.Struct({ specifier: Schema.String, version: Schema.String })),
);

const PnpmImporter = Schema.Struct({
	dependencies: PnpmImporterDeps,
	devDependencies: PnpmImporterDeps,
	peerDependencies: PnpmImporterDeps,
	optionalDependencies: PnpmImporterDeps,
});

const PnpmLockfileRaw = Schema.Struct({
	lockfileVersion: Schema.Union([Schema.String, Schema.Number]),
	settings: Schema.optionalKey(
		Schema.Struct({
			autoInstallPeers: Schema.optionalKey(Schema.Boolean),
			excludeLinksFromLockfile: Schema.optionalKey(Schema.Boolean),
		}),
	),
	overrides: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	catalogs: Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.Record(
				Schema.String,
				Schema.Union([Schema.String, Schema.Struct({ specifier: Schema.String, version: Schema.String })]),
			),
		),
	),
	importers: Schema.Record(Schema.String, PnpmImporter),
	packages: Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.Struct({
				resolution: Schema.optionalKey(Schema.Struct({ integrity: Schema.optionalKey(Schema.String) })),
				peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
				peerDependenciesMeta: Schema.optionalKey(
					Schema.Record(Schema.String, Schema.Struct({ optional: Schema.optionalKey(Schema.Boolean) })),
				),
				// Pre-v9 lockfiles carry resolution inline here, since they have no
				// `snapshots:` section to carry it.
				dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
				optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
			}),
		),
	),
	// Lockfile v9 split per-*instance* resolution out of `packages:` into its
	// own section; earlier versions carry both in `packages:`.
	snapshots: Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.Struct({
				dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
				optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
			}),
		),
	),
});

type PnpmLockfileRawType = typeof PnpmLockfileRaw.Type;
type PnpmImporterType = typeof PnpmImporter.Type;
type PnpmPackageEntry = NonNullable<PnpmLockfileRawType["packages"]>[string];

/**
 * Parse pnpm `pnpm-lock.yaml` content into the unified field bundle.
 *
 * `pnpm-lock.yaml` is a YAML *stream*, not a single document: a workspace
 * using `configDependencies` gets a config-dependencies preamble document
 * ahead of the lockfile. {@link selectPnpmDocument} locates the lockfile
 * deterministically (it is the last document); a stream carrying no lockfile
 * document fails through the typed framing channel rather than silently
 * reporting the preamble as an empty workspace.
 *
 * Workspace packages are keyed by importer *path* with version `"0.0.0"`;
 * `Lockfile#withImporterNames` is the explicit second stage that rewrites
 * them to real names.
 *
 * @internal
 */
export const parsePnpm = (content: string): Effect.Effect<LockfileFields, ParseFailure> =>
	Effect.gen(function* () {
		const { document, documents } = yield* selectPnpmDocument(content);
		const validated = yield* Schema.decodeUnknownEffect(PnpmLockfileRaw)(document).pipe(
			Effect.mapError(validationFailure),
		);
		// pnpm always records at least the root importer ".", so a lockfile
		// document declaring no importers at all describes no workspace. Fail
		// typed rather than hand back an empty Lockfile — an empty result is
		// indistinguishable from "this workspace has no packages", which is the
		// shape that kept the multi-document bug invisible.
		if (Object.keys(validated.importers).length === 0) {
			return yield* Effect.fail(framingFailure("noImporters", documents));
		}
		// Format-version gate. Deliberately NOT a check for `snapshots:` being
		// present or populated: a dependency-free v9 workspace legitimately has
		// zero snapshot entries, so an emptiness guard would reject a valid
		// lockfile. Version is the format's own identity; emptiness is a
		// coincidence of content.
		yield* requireLockfileVersion("pnpm", validated.lockfileVersion);
		return yield* toFields(validated);
	});

// ── Transform ──────────────────────────────────────────────────────────────

/**
 * Resolve one instance's outgoing edges to instance ids.
 *
 * pnpm names a resolved dependency as `name` → `version`, where the version may
 * itself carry a peer suffix (`1.6.0(react@17.0.2)`); the referenced instance's
 * key is those two composed back together. The composition is *verified*
 * against the lockfile's own key set rather than trusted — both spellings are
 * tried (v9's bare key and the pre-v9 leading-slash form) and an edge that
 * matches nothing is **omitted**. That is what keeps a `link:`/`file:`
 * resolution, which names no instance in this lockfile, from becoming a
 * plausible lie.
 *
 * @internal
 */
const resolveEdges = (
	sections: ReadonlyArray<Readonly<Record<string, string>> | undefined>,
	instanceIds: ReadonlySet<string>,
): ResolvedEdges => {
	const edges = new Map<string, string>();
	const unnameable = new Set<string>();
	for (const section of sections) {
		if (!section) continue;
		for (const [name, version] of Object.entries(section)) {
			if (name === "") continue;
			// A `link:` resolution names a directory, not a registry version, so
			// `name@link:...` composes to nothing. pnpm records the same edge twice
			// in two spellings: the snapshot body keeps the readable `link:<path>`
			// while the peer suffix carries a MANGLED identity
			// (`react@packages+fakereact`) that appears nowhere as a key. Neither
			// spelling composes, so the edge used to be dropped — and one layer up
			// a dropped edge for a peer reads as an unsatisfied peer, turning a
			// satisfied `link:` into a false positive.
			//
			// A snapshot's `link:` target is recorded relative to the workspace
			// ROOT (importer sections record theirs relative to the importer), so
			// it is normalized against the root and matched against the instance
			// ids, where a workspace importer's id is its path.
			if (version.startsWith(LINK_PREFIX)) {
				const target = resolveLinkTarget("", version.slice(LINK_PREFIX.length));
				if (target !== undefined && instanceIds.has(target)) edges.set(name, target);
				// A `link:` into a directory that is no importer — a build output, a
				// vendored stub — names no instance in this lockfile. The edge is
				// RECORDED, so its absence from `resolved` must not read as "nothing
				// resolved".
				else unnameable.add(name);
				continue;
			}
			const bare = `${name}@${version}`;
			if (instanceIds.has(bare)) edges.set(name, bare);
			else unnameable.add(name);
		}
	}
	// Map-backed until the last step: `Object.fromEntries` defines own data
	// properties, so a "__proto__" dependency name neither pollutes nor drops.
	return { resolved: Object.fromEntries(edges), unresolvedEdges: [...unnameable].sort() };
};

/**
 * One instance's outgoing edges, split: those that could be named, and those
 * the lockfile records but this model could not name.
 *
 * @internal
 */
interface ResolvedEdges {
	readonly resolved: Record<string, string>;
	readonly unresolvedEdges: ReadonlyArray<string>;
}

/** The protocol pnpm records a workspace-directory resolution under. @internal */
const LINK_PREFIX = "link:";

/**
 * Normalize a `link:` target against the linking importer's path, so a
 * workspace edge can name the workspace importer's instance id.
 * Total: a target that walks above the root yields `undefined`.
 *
 * @internal
 */
const resolveLinkTarget = (importerPath: string, target: string): string | undefined => {
	const segments: Array<string> = [];
	for (const segment of `${importerPath}/${target}`.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (segments.pop() === undefined) return undefined;
			continue;
		}
		segments.push(segment);
	}
	return segments.length === 0 ? undefined : segments.join("/");
};

/**
 * Resolve one importer's outgoing edges. pnpm records `{ specifier, version }`
 * per importer dependency, where the version is either a registry version (the
 * instance-id composition {@link resolveEdges} performs) or a `link:` target
 * naming another importer — normalized against this importer's own path. Both
 * are checked against the lockfile's instance ids before being emitted.
 *
 * @internal
 */
const resolveImporterEdges = (
	importer: PnpmImporterType,
	importerPath: string,
	instanceIds: ReadonlySet<string>,
): ResolvedEdges => {
	const edges = new Map<string, string>();
	const unnameable = new Set<string>();
	for (const group of importerDepGroups(importer)) {
		if (!group) continue;
		for (const [name, info] of Object.entries(group)) {
			if (name === "") continue;
			if (info.version.startsWith(LINK_PREFIX)) {
				const target = resolveLinkTarget(importerPath, info.version.slice(LINK_PREFIX.length));
				if (target !== undefined && instanceIds.has(target)) edges.set(name, target);
				else unnameable.add(name);
				continue;
			}
			const bare = `${name}@${info.version}`;
			if (instanceIds.has(bare)) edges.set(name, bare);
			else unnameable.add(name);
		}
	}
	// Map-backed until the last step: `Object.fromEntries` defines own data
	// properties, so a "__proto__" dependency name neither pollutes nor drops.
	return { resolved: Object.fromEntries(edges), unresolvedEdges: [...unnameable].sort() };
};

const toVersionMap = (
	deps: Record<string, { readonly specifier: string; readonly version: string }> | undefined,
): Record<string, string> | undefined => {
	if (!deps) return undefined;
	// Object.fromEntries defines own data properties, so a "__proto__" key
	// neither pollutes nor drops.
	return Object.fromEntries(Object.entries(deps).map(([name, info]) => [name, info.specifier]));
};

const importerDepGroups = (importer: PnpmImporterType) =>
	[importer.dependencies, importer.devDependencies, importer.peerDependencies, importer.optionalDependencies] as const;

const toFields = (raw: PnpmLockfileRawType): Effect.Effect<LockfileFields, ParseFailure> =>
	Effect.gen(function* () {
		const workspaceEntries = new Map<string, WorkspaceEntry>();
		const workspaceNames = new Set<string>();
		const importers: Array<LockfileImporter> = [];

		for (const [importerPath, importer] of Object.entries(raw.importers)) {
			if (importerPath === "") continue; // a nameless importer cannot be modeled; skip, never throw

			// pnpm records `{ specifier, version }` per importer dependency; a blank
			// version means the section carries only a specifier. The recorded
			// version may carry a peer-disambiguation suffix — the shared builder
			// splits it (splitPeerSuffix) into `version` + `peerSuffix`.
			importers.push(
				LockfileImporter.make({
					path: importerPath,
					dependencies: importerDependencies(importer, (info) => ({
						specifier: info.specifier,
						version: info.version,
					})),
				}),
			);

			const deps = toVersionMap(importer.dependencies);
			const devDeps = toVersionMap(importer.devDependencies);
			const peerDeps = toVersionMap(importer.peerDependencies);
			const optDeps = toVersionMap(importer.optionalDependencies);
			workspaceEntries.set(importerPath, {
				...(deps ? { dependencies: deps } : {}),
				...(devDeps ? { devDependencies: devDeps } : {}),
				...(peerDeps ? { peerDependencies: peerDeps } : {}),
				...(optDeps ? { optionalDependencies: optDeps } : {}),
			});

			for (const group of importerDepGroups(importer)) {
				if (!group) continue;
				for (const [name, info] of Object.entries(group)) {
					if (name !== "" && info.version.startsWith("link:")) {
						workspaceNames.add(name);
					}
				}
			}
		}

		for (const path of Object.keys(raw.importers)) {
			if (path !== "." && path !== "") {
				workspaceNames.add(path);
			}
		}

		const packages: Array<ResolvedPackage> = [];

		// One row per *instance*: one per `snapshots:` entry, because `packages:`
		// is per-*version* metadata and collapses every peer-resolved variant onto
		// one key. An empty (or absent) `snapshots:` map is valid — a workspace
		// with no dependencies has no instances to record — and simply yields no
		// snapshot rows. Importer paths join the id space because a `link:` edge
		// names one.
		const snapshots = raw.snapshots;
		const instanceIds = new Set<string>([
			...(snapshots ? Object.keys(snapshots) : []),
			...(raw.packages ? Object.keys(raw.packages) : []),
			...Object.keys(raw.importers),
		]);
		const emitted = new Set<string>();

		for (const [importerPath, importer] of Object.entries(raw.importers)) {
			if (importerPath === "." || importerPath === "") continue;
			// No peers here by design: a pnpm lockfile records a workspace
			// project's *resolved* dependencies only, never its own peer
			// declarations — probed against pnpm 11.22.0 both with and without
			// autoInstallPeers. Workspace rows keep the empty peer defaults, and the
			// importer path is both the name and the instance id.
			packages.push(
				ResolvedPackage.make({
					name: importerPath,
					version: "0.0.0",
					instanceId: importerPath,
					isWorkspace: true,
					relativePath: importerPath,
					...resolveImporterEdges(importer, importerPath, instanceIds),
				}),
			);
		}

		const emit = (
			instanceId: string,
			meta: PnpmPackageEntry | undefined,
			edges: ReadonlyArray<Readonly<Record<string, string>> | undefined>,
		) =>
			Effect.gen(function* () {
				// Keys may carry a peer-resolution suffix — "fdir@6.5.0(picomatch@4.0.4)" —
				// whose inner "@" would corrupt the split; splitPeerSuffix (the one
				// stripping implementation, shared with the importer path) drops
				// everything from the first "(".
				const { plain: bare } = splitPeerSuffix(instanceId);
				const atIndex = bare.lastIndexOf("@");
				if (atIndex <= 0) return; // malformed "name@version" keys are skipped, never thrown on
				const name = bare.slice(0, atIndex);
				const version = bare.slice(atIndex + 1);
				const integrity = yield* toIntegrityHash(meta?.resolution?.integrity);
				emitted.add(instanceId);
				packages.push(
					ResolvedPackage.make({
						name,
						version,
						instanceId,
						...(integrity !== undefined ? { integrity } : {}),
						isWorkspace: false,
						...peerDeclarations(meta?.peerDependencies, meta?.peerDependenciesMeta),
						...resolveEdges(edges, instanceIds),
					}),
				);
			});

		if (snapshots) {
			for (const [key, snapshot] of Object.entries(snapshots)) {
				// Peer declarations live on the matching per-version `packages:` entry,
				// which is keyed by the plain "name@version" the suffix hangs off.
				const meta = raw.packages?.[splitPeerSuffix(key).plain];
				yield* emit(key, meta, [snapshot.dependencies, snapshot.optionalDependencies]);
			}
		}

		// Which `packages:` keys a snapshot already spoke for.
		const covered = new Set([...emitted].map((key) => splitPeerSuffix(key).plain));

		if (raw.packages) {
			for (const [key, pkg] of Object.entries(raw.packages)) {
				// A `packages:` entry no snapshot covers is an orphan — still emitted
				// rather than dropped, since an unexplained disappearance is the worse
				// failure. It carries no resolution, which is honest: none was recorded.
				if (covered.has(key)) continue;
				yield* emit(key, pkg, [pkg.dependencies, pkg.optionalDependencies]);
			}
		}

		const workspaceDependencies = extractWorkspaceDeps(workspaceEntries, workspaceNames);

		const extension = PnpmExtension.make({
			...(raw.catalogs !== undefined ? { catalogs: raw.catalogs } : {}),
			...(raw.overrides !== undefined ? { overrides: raw.overrides } : {}),
			...(raw.settings !== undefined ? { settings: raw.settings } : {}),
		});

		return {
			lockfileVersion: String(raw.lockfileVersion),
			packages,
			workspaceDependencies,
			importers,
			extension,
		};
	});
