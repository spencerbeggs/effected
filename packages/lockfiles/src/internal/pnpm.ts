import { Effect, Schema } from "effect";
import { PnpmExtension } from "../PnpmExtension.js";
import { ResolvedPackage } from "../ResolvedPackage.js";
import { selectPnpmDocument } from "./documents.js";
import type { LockfileFields, ParseFailure, WorkspaceEntry } from "./shared.js";
import { extractWorkspaceDeps, framingFailure, validationFailure } from "./shared.js";

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
			}),
		),
	),
});

type PnpmLockfileRawType = typeof PnpmLockfileRaw.Type;
type PnpmImporterType = typeof PnpmImporter.Type;

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
		return toFields(validated);
	});

// ── Transform ──────────────────────────────────────────────────────────────

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

const toFields = (raw: PnpmLockfileRawType): LockfileFields => {
	const workspaceEntries = new Map<string, WorkspaceEntry>();
	const workspaceNames = new Set<string>();

	for (const [importerPath, importer] of Object.entries(raw.importers)) {
		if (importerPath === "") continue; // a nameless importer cannot be modeled; skip, never throw
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

	for (const importerPath of Object.keys(raw.importers)) {
		if (importerPath === "." || importerPath === "") continue;
		packages.push(
			ResolvedPackage.make({
				name: importerPath,
				version: "0.0.0",
				isWorkspace: true,
				relativePath: importerPath,
			}),
		);
	}

	if (raw.packages) {
		for (const [key, pkg] of Object.entries(raw.packages)) {
			// Keys may carry a peer-resolution suffix — "fdir@6.5.0(picomatch@4.0.4)" —
			// whose inner "@" would corrupt the split; names never contain "(", so
			// everything from the first "(" is suffix.
			const parenIndex = key.indexOf("(");
			const bare = parenIndex === -1 ? key : key.slice(0, parenIndex);
			const atIndex = bare.lastIndexOf("@");
			if (atIndex <= 0) continue; // malformed "name@version" keys are skipped, never thrown on
			const name = bare.slice(0, atIndex);
			const version = bare.slice(atIndex + 1);
			const integrity = pkg.resolution?.integrity;
			packages.push(
				ResolvedPackage.make({
					name,
					version,
					...(integrity !== undefined ? { integrity } : {}),
					isWorkspace: false,
				}),
			);
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
		extension,
	};
};
