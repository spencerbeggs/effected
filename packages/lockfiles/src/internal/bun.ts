import type { BunLockDocument } from "@effected/bun";
import { BunExtension } from "@effected/bun";
import { Effect, Exit, Schema } from "effect";
import { LockfileImporter } from "../LockfileImporter.js";
import { ResolvedPackage } from "../ResolvedPackage.js";
import type { LockfileFields, ParseFailure, WorkspaceEntry } from "./shared.js";
import {
	extractWorkspaceDeps,
	importerDependencies,
	peerDeclarations,
	splitNameVersion,
	toIntegrityHash,
} from "./shared.js";

// ── Tuple info (read out of band, not part of the document's shape) ──────

const DepRecord = Schema.optionalKey(Schema.Record(Schema.String, Schema.String));

const OptionalPeers = Schema.optionalKey(Schema.Array(Schema.String));

/**
 * The info object at package-tuple index 2. bun's tuple shape is
 * under-documented upstream, so it is read permissively and *out of band*: a
 * shape that does not decode is skipped (the package still lands, with no
 * peers) rather than failing the whole parse.
 *
 * @internal
 */
const BunPackageInfo = Schema.Struct({
	dependencies: DepRecord,
	devDependencies: DepRecord,
	optionalDependencies: DepRecord,
	peerDependencies: DepRecord,
	optionalPeers: OptionalPeers,
});

const decodeBunPackageInfo = Schema.decodeUnknownExit(BunPackageInfo);

const readBunPackageInfo = (value: unknown): typeof BunPackageInfo.Type | undefined => {
	const exit = decodeBunPackageInfo(value);
	return Exit.isSuccess(exit) ? exit.value : undefined;
};

/**
 * Normalise a decoded `bun.lock` document into the unified field bundle. The
 * document's own parse (`BunLockDocument.parse`) owns the syntax and shape;
 * this owns the reading of what it holds, including the package tuples' info
 * objects, which it decodes out of band.
 *
 * @internal
 */
export const normalizeBun = (raw: BunLockDocument): Effect.Effect<LockfileFields, ParseFailure> => toFields(raw);

// ── Transform ──────────────────────────────────────────────────────────────

/**
 * Resolve one entry's outgoing edges by replaying bun's own key scheme.
 *
 * bun encodes install position in the `packages` key: a nested install is
 * keyed `<parent-key>/<name>`, so `"react-dom/react"` is literally "the react
 * react-dom got". Package names are themselves slash-bearing when scoped, so
 * the parent chain is **not** computed by splitting on `/` — it is read off
 * the key space, taking those prefixes of the key that are themselves keys,
 * longest first. Deepest wins; the root (`<name>` alone) is tried last.
 *
 * Only keys that exist are emitted, so an edge bun did not record is omitted
 * rather than invented.
 *
 * @internal
 */
const resolveBunEdges = (
	key: string,
	sections: ReadonlyArray<Readonly<Record<string, string>> | undefined>,
	keys: ReadonlySet<string>,
): Record<string, string> => {
	const names = new Set<string>();
	for (const section of sections) {
		if (!section) continue;
		for (const name of Object.keys(section)) if (name !== "") names.add(name);
	}
	if (names.size === 0) return {};

	// The entry's own position first, then each ancestor key, then the root.
	const prefixes: Array<string> = [key];
	for (let i = key.indexOf("/"); i !== -1; i = key.indexOf("/", i + 1)) {
		const candidate = key.slice(0, i);
		if (keys.has(candidate)) prefixes.push(candidate);
	}
	prefixes.sort((a, b) => b.length - a.length);
	prefixes.push("");

	const edges = new Map<string, string>();
	for (const name of names) {
		for (const prefix of prefixes) {
			const candidate = prefix === "" ? name : `${prefix}/${name}`;
			if (keys.has(candidate)) {
				edges.set(name, candidate);
				break;
			}
		}
	}
	// Map-backed until the last step: `Object.fromEntries` defines own data
	// properties, so a "__proto__" dependency name neither pollutes nor drops.
	return Object.fromEntries(edges);
};

const infoSections = (info: typeof BunPackageInfo.Type | undefined) =>
	[info?.dependencies, info?.devDependencies, info?.optionalDependencies, info?.peerDependencies] as const;

const workspaceSections = (entry: NonNullable<BunLockDocument["workspaces"]>[string]) =>
	[entry.dependencies, entry.devDependencies, entry.optionalDependencies, entry.peerDependencies] as const;

const toFields = (raw: BunLockDocument): Effect.Effect<LockfileFields, ParseFailure> =>
	Effect.gen(function* () {
		const packages: Array<ResolvedPackage> = [];
		// bun's own instance identities: the `packages` keys.
		const keys = new Set(raw.packages ? Object.keys(raw.packages) : []);
		const workspaceNames = new Set<string>();
		const workspaceEntries = new Map<string, WorkspaceEntry>();
		const importers: Array<LockfileImporter> = [];

		if (raw.workspaces) {
			// Bun records concrete versions on the package tuples, not per importer,
			// so every importer dependency carries a specifier and no version. The
			// root workspace is the `""` entry — the `"."` importer.
			for (const [wsPath, wsEntry] of Object.entries(raw.workspaces)) {
				importers.push(
					LockfileImporter.make({
						path: wsPath === "" ? "." : wsPath,
						dependencies: importerDependencies(wsEntry, (specifier) => ({ specifier })),
					}),
				);
			}

			for (const [wsPath, wsEntry] of Object.entries(raw.workspaces)) {
				if (wsPath === "") continue; // root entry
				const name = wsEntry.name === undefined || wsEntry.name === "" ? wsPath : wsEntry.name;
				workspaceNames.add(name);
				// A workspace package's identity is its `packages` key — the bare
				// name — because that is what nested keys prefix themselves with. The
				// path is the fallback for a lockfile that records no such entry.
				const instanceId = keys.has(name) ? name : wsPath;
				if (instanceId === "") continue; // no identity, no row; skip, never throw
				packages.push(
					ResolvedPackage.make({
						name,
						version: wsEntry.version ?? "0.0.0",
						instanceId,
						isWorkspace: true,
						relativePath: wsPath,
						...peerDeclarations(wsEntry.peerDependencies, undefined, wsEntry.optionalPeers),
						resolved: resolveBunEdges(instanceId, workspaceSections(wsEntry), keys),
					}),
				);
				workspaceEntries.set(name, {
					...(wsEntry.dependencies ? { dependencies: wsEntry.dependencies } : {}),
					...(wsEntry.devDependencies ? { devDependencies: wsEntry.devDependencies } : {}),
					...(wsEntry.peerDependencies ? { peerDependencies: wsEntry.peerDependencies } : {}),
					...(wsEntry.optionalDependencies ? { optionalDependencies: wsEntry.optionalDependencies } : {}),
				});
			}
		}

		if (raw.packages) {
			for (const [key, tuple] of Object.entries(raw.packages)) {
				if (key === "") continue; // no identity, no row; skip, never throw
				if (tuple.length < 1) continue;
				const first = tuple[0];
				if (typeof first !== "string") continue; // malformed tuples are skipped, never thrown on
				// The first "@" after a scoped name's own, never the last: a version
				// part may hold one (`file:../@scope/lib`).
				const split = splitNameVersion(first);
				if (split === undefined) continue; // handles "@", "@scope/", bare names
				const { name, version } = split;

				// Workspace packages were already added from the workspaces map.
				if (workspaceNames.has(name)) continue;

				const integrity = yield* toIntegrityHash(
					tuple.length >= 4 && typeof tuple[3] === "string" ? tuple[3] : undefined,
				);
				// Tuple index 2 is the info object carrying the entry's own
				// dependency and peer declarations.
				const info = tuple.length >= 3 ? readBunPackageInfo(tuple[2]) : undefined;
				packages.push(
					ResolvedPackage.make({
						name,
						version,
						instanceId: key,
						...(integrity !== undefined ? { integrity } : {}),
						isWorkspace: false,
						...peerDeclarations(info?.peerDependencies, undefined, info?.optionalPeers),
						resolved: resolveBunEdges(key, infoSections(info), keys),
					}),
				);
			}
		}

		const workspaceDependencies = extractWorkspaceDeps(workspaceEntries, workspaceNames);

		const extension = BunExtension.make({
			...(raw.catalog !== undefined ? { catalog: raw.catalog } : {}),
			...(raw.catalogs !== undefined ? { catalogs: raw.catalogs } : {}),
			...(raw.overrides !== undefined ? { overrides: raw.overrides } : {}),
			...(raw.trustedDependencies !== undefined ? { trustedDependencies: raw.trustedDependencies } : {}),
		});

		return {
			lockfileVersion: String(raw.lockfileVersion),
			packages,
			workspaceDependencies,
			importers,
			extension,
		};
	});
