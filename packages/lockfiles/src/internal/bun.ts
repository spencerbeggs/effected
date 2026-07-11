import { Jsonc } from "@effected/jsonc";
import { Effect, Schema } from "effect";
import { BunExtension } from "../BunExtension.js";
import { ResolvedPackage } from "../ResolvedPackage.js";
import type { LockfileFields, ParseFailure, WorkspaceEntry } from "./shared.js";
import { extractWorkspaceDeps, syntaxFailure, validationFailure } from "./shared.js";

// ── Raw schema (permissive validation scaffolding, not API) ────────────────

const DepRecord = Schema.optionalKey(Schema.Record(Schema.String, Schema.String));

const BunWorkspaceEntry = Schema.Struct({
	name: Schema.optionalKey(Schema.String),
	version: Schema.optionalKey(Schema.String),
	dependencies: DepRecord,
	devDependencies: DepRecord,
	peerDependencies: DepRecord,
	optionalDependencies: DepRecord,
});

const BunLockfileRaw = Schema.Struct({
	lockfileVersion: Schema.Number,
	workspaces: Schema.optionalKey(Schema.Record(Schema.String, BunWorkspaceEntry)),
	packages: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.Unknown))),
	catalog: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
	catalogs: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
	overrides: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	trustedDependencies: Schema.optionalKey(Schema.Array(Schema.String)),
});

type BunLockfileRawType = typeof BunLockfileRaw.Type;

/**
 * Parse bun `bun.lock` (JSONC) content into the unified field bundle.
 * Resolved packages are tuples whose first element is `"name@version"`;
 * the integrity hash is assumed at tuple index 3 (the permissive v3
 * reading of an under-documented upstream shape).
 *
 * @internal
 */
export const parseBun = (content: string): Effect.Effect<LockfileFields, ParseFailure> =>
	Effect.gen(function* () {
		const parsed = yield* Jsonc.parse(content).pipe(Effect.mapError(syntaxFailure));
		const validated = yield* Schema.decodeUnknownEffect(BunLockfileRaw)(parsed).pipe(
			Effect.mapError(validationFailure),
		);
		return toFields(validated);
	});

// ── Transform ──────────────────────────────────────────────────────────────

const toFields = (raw: BunLockfileRawType): LockfileFields => {
	const packages: Array<ResolvedPackage> = [];
	const workspaceNames = new Set<string>();
	const workspaceEntries = new Map<string, WorkspaceEntry>();

	if (raw.workspaces) {
		for (const [wsPath, wsEntry] of Object.entries(raw.workspaces)) {
			if (wsPath === "") continue; // root entry
			const name = wsEntry.name === undefined || wsEntry.name === "" ? wsPath : wsEntry.name;
			workspaceNames.add(name);
			packages.push(
				ResolvedPackage.make({
					name,
					version: wsEntry.version ?? "0.0.0",
					isWorkspace: true,
					relativePath: wsPath,
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
		for (const tuple of Object.values(raw.packages)) {
			if (tuple.length < 1) continue;
			const first = tuple[0];
			if (typeof first !== "string") continue; // malformed tuples are skipped, never thrown on
			const atIdx = first.lastIndexOf("@");
			if (atIdx <= 0) continue; // handles "@", "@scope/", bare names
			const name = first.slice(0, atIdx);
			const version = first.slice(atIdx + 1);

			// Workspace packages were already added from the workspaces map.
			if (workspaceNames.has(name)) continue;

			const integrity = tuple.length >= 4 && typeof tuple[3] === "string" ? tuple[3] : undefined;
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
		extension,
	};
};
