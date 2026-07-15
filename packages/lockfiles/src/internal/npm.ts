import { Effect, Schema } from "effect";
import { LockfileImporter } from "../LockfileImporter.js";
import { ResolvedPackage } from "../ResolvedPackage.js";
import type { LockfileFields, ParseFailure, WorkspaceEntry } from "./shared.js";
import {
	extractWorkspaceDeps,
	importerDependencies,
	syntaxFailure,
	toIntegrityHash,
	validationFailure,
} from "./shared.js";

// ── Raw schema (permissive validation scaffolding, not API) ────────────────

const DepRecord = Schema.optionalKey(Schema.Record(Schema.String, Schema.String));

const NpmPackageEntry = Schema.Struct({
	name: Schema.optionalKey(Schema.String),
	version: Schema.optionalKey(Schema.String),
	resolved: Schema.optionalKey(Schema.String),
	integrity: Schema.optionalKey(Schema.String),
	link: Schema.optionalKey(Schema.Boolean),
	dev: Schema.optionalKey(Schema.Boolean),
	dependencies: DepRecord,
	devDependencies: DepRecord,
	peerDependencies: DepRecord,
	optionalDependencies: DepRecord,
});

const NpmLockfileRaw = Schema.Struct({
	name: Schema.optionalKey(Schema.String),
	version: Schema.optionalKey(Schema.String),
	lockfileVersion: Schema.Union([Schema.Number, Schema.String]),
	requires: Schema.optionalKey(Schema.Boolean),
	packages: Schema.Record(Schema.String, NpmPackageEntry),
});

type NpmLockfileRawType = typeof NpmLockfileRaw.Type;

const NODE_MODULES_PREFIX = "node_modules/";

/**
 * Parse npm `package-lock.json` (v2/v3) content into the unified field
 * bundle. Native `JSON.parse` inside `Effect.try` — its throw on hostile
 * input (including V8's `RangeError` on pathological depth) lands typed as
 * `stage: "syntax"`.
 *
 * @internal
 */
export const parseNpm = (content: string): Effect.Effect<LockfileFields, ParseFailure> =>
	Effect.gen(function* () {
		const raw = yield* Effect.try({
			try: () => JSON.parse(content) as unknown,
			catch: syntaxFailure,
		});
		const validated = yield* Schema.decodeUnknownEffect(NpmLockfileRaw)(raw).pipe(Effect.mapError(validationFailure));
		return toFields(validated);
	});

// ── Transform ──────────────────────────────────────────────────────────────

const toFields = (raw: NpmLockfileRawType): LockfileFields => {
	const packages: Array<ResolvedPackage> = [];
	const workspaceNames = new Set<string>();
	const workspaceEntries = new Map<string, WorkspaceEntry>();
	const importers: Array<LockfileImporter> = [];

	// npm records concrete versions on the `node_modules/*` entries, not per
	// importer, so every importer dependency carries a specifier and no version.
	// The root manifest is the `""` entry — the `"."` importer.
	const rootEntry = raw.packages[""];
	if (rootEntry) {
		importers.push(
			LockfileImporter.make({ path: ".", dependencies: importerDependencies(rootEntry, (s) => ({ specifier: s })) }),
		);
	}

	// First pass: identify workspace link entries. Name resolution must match
	// the second pass (wsEntry first) or a link stub disagreeing with its
	// resolved entry drops inter-workspace edges.
	for (const [key, entry] of Object.entries(raw.packages)) {
		if (key.startsWith(NODE_MODULES_PREFIX) && entry.link === true) {
			const wsEntry = entry.resolved !== undefined ? raw.packages[entry.resolved] : undefined;
			const name = wsEntry?.name ?? entry.name ?? key.slice(NODE_MODULES_PREFIX.length);
			if (name !== "") workspaceNames.add(name);
		}
	}

	// Second pass: build packages and workspace entries.
	for (const [key, entry] of Object.entries(raw.packages)) {
		if (key === "") continue; // root entry

		if (key.startsWith(NODE_MODULES_PREFIX) && entry.link === true) {
			// Workspace link — actual package data lives at the resolved path entry.
			const resolved = entry.resolved;
			const wsEntry = resolved !== undefined ? raw.packages[resolved] : undefined;
			const name = wsEntry?.name ?? entry.name ?? key.slice(NODE_MODULES_PREFIX.length);
			if (name === "") continue; // a nameless entry cannot be modeled; skip, never throw
			packages.push(
				ResolvedPackage.make({
					name,
					version: wsEntry?.version ?? "0.0.0",
					isWorkspace: true,
					...(resolved !== undefined ? { relativePath: resolved } : {}),
				}),
			);
			if (wsEntry) {
				workspaceEntries.set(name, {
					...(wsEntry.dependencies ? { dependencies: wsEntry.dependencies } : {}),
					...(wsEntry.devDependencies ? { devDependencies: wsEntry.devDependencies } : {}),
					...(wsEntry.peerDependencies ? { peerDependencies: wsEntry.peerDependencies } : {}),
					...(wsEntry.optionalDependencies ? { optionalDependencies: wsEntry.optionalDependencies } : {}),
				});
			}
			if (resolved !== undefined) {
				importers.push(
					LockfileImporter.make({
						path: resolved,
						dependencies: wsEntry ? importerDependencies(wsEntry, (s) => ({ specifier: s })) : [],
					}),
				);
			}
		} else if (key.startsWith(NODE_MODULES_PREFIX)) {
			// Regular resolved package.
			const name = key.slice(NODE_MODULES_PREFIX.length);
			if (name !== "" && entry.version !== undefined) {
				const integrity = toIntegrityHash(entry.integrity);
				packages.push(
					ResolvedPackage.make({
						name,
						version: entry.version,
						...(integrity !== undefined ? { integrity } : {}),
						isWorkspace: false,
						dependencies: entry.dependencies ?? {},
					}),
				);
			}
		}
		// Workspace path entries (packages/foo) are reached via their link entries.
	}

	const workspaceDependencies = extractWorkspaceDeps(workspaceEntries, workspaceNames);

	return {
		lockfileVersion: String(raw.lockfileVersion),
		packages,
		workspaceDependencies,
		importers,
	};
};
