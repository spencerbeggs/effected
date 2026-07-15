import { Effect, Schema } from "effect";
import { ResolvedPackage } from "../ResolvedPackage.js";
import { selectSoleDocument } from "./documents.js";
import type { LockfileFields, ParseFailure, WorkspaceEntry } from "./shared.js";
import { extractWorkspaceDeps, toIntegrityHash, validationFailure } from "./shared.js";

// ── Raw schemas (permissive validation scaffolding, not API) ───────────────

// The top-level shape must be a string-keyed map. Classic (v1) yarn.lock
// content that happens to YAML-parse produces scalar entry values, which
// fail YarnEntry validation — Berry-only support exits typed either way.
const YarnLockfileRaw = Schema.Record(Schema.String, Schema.Unknown);

const DepRecord = Schema.optionalKey(Schema.Record(Schema.String, Schema.String));

const YarnEntry = Schema.Struct({
	version: Schema.optionalKey(Schema.String),
	resolution: Schema.optionalKey(Schema.String),
	dependencies: DepRecord,
	devDependencies: DepRecord,
	peerDependencies: DepRecord,
	optionalDependencies: DepRecord,
	checksum: Schema.optionalKey(Schema.String),
	languageName: Schema.optionalKey(Schema.String),
	linkType: Schema.optionalKey(Schema.String),
	bin: Schema.optionalKey(Schema.Unknown),
});

type YarnEntryType = typeof YarnEntry.Type;

const YarnMetadata = Schema.Struct({
	version: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
});

/**
 * Parse yarn Berry `yarn.lock` content into the unified field bundle.
 *
 * Yarn Berry lockfiles are YAML with a flat key structure where each key
 * encodes package name + resolution descriptor(s) (e.g.
 * `"@scope/name@npm:^1.0.0"`); workspace entries carry `linkType: "soft"`.
 *
 * @internal
 */
export const parseYarn = (content: string): Effect.Effect<LockfileFields, ParseFailure> =>
	Effect.gen(function* () {
		// yarn defines no document framing, so a multi-document yarn.lock fails
		// typed rather than being silently truncated to its first document.
		const { document } = yield* selectSoleDocument(content);
		const raw = yield* Schema.decodeUnknownEffect(YarnLockfileRaw)(document).pipe(Effect.mapError(validationFailure));

		// Extract the lockfile version from __metadata; skip it during iteration.
		const metadata =
			raw.__metadata === undefined
				? undefined
				: yield* Schema.decodeUnknownEffect(YarnMetadata)(raw.__metadata).pipe(Effect.mapError(validationFailure));
		const lockfileVersion = metadata?.version === undefined ? "unknown" : String(metadata.version);

		// Decode each entry once and cache in a Map.
		const decoded = new Map<string, YarnEntryType>();
		for (const [key, value] of Object.entries(raw)) {
			if (key === "__metadata") continue;
			const entry = yield* Schema.decodeUnknownEffect(YarnEntry)(value).pipe(Effect.mapError(validationFailure));
			decoded.set(key, entry);
		}

		return toFields(lockfileVersion, decoded);
	});

// ── Transform ──────────────────────────────────────────────────────────────

const toFields = (lockfileVersion: string, decoded: ReadonlyMap<string, YarnEntryType>): LockfileFields => {
	const packages: Array<ResolvedPackage> = [];
	const workspaceNames = new Set<string>();
	const workspaceEntries = new Map<string, WorkspaceEntry>();

	// First pass: identify workspace names.
	for (const [key, entry] of decoded) {
		if (entry.linkType === "soft") {
			const name = extractYarnPackageName(key);
			if (name !== undefined) workspaceNames.add(name);
		}
	}

	// Second pass: build packages.
	for (const [key, entry] of decoded) {
		const name = extractYarnPackageName(key);
		if (name === undefined) continue; // malformed descriptors are skipped, never thrown on

		const isWorkspace = entry.linkType === "soft";
		const relativePath = isWorkspace ? extractYarnWorkspacePath(key) : undefined;
		// Yarn Berry's `10c0/<hex>` cache checksums validate as an `IntegrityHash`
		// (the yarn textual form), so they are preserved; an unparseable checksum
		// is dropped rather than failing the parse.
		const integrity = toIntegrityHash(entry.checksum);

		packages.push(
			ResolvedPackage.make({
				name,
				version: entry.version ?? "0.0.0",
				...(integrity !== undefined ? { integrity } : {}),
				isWorkspace,
				...(relativePath !== undefined ? { relativePath } : {}),
			}),
		);

		if (isWorkspace) {
			const deps = cleanYarnDeps(entry.dependencies);
			const devDeps = cleanYarnDeps(entry.devDependencies);
			const peerDeps = cleanYarnDeps(entry.peerDependencies);
			const optDeps = cleanYarnDeps(entry.optionalDependencies);
			workspaceEntries.set(name, {
				...(deps ? { dependencies: deps } : {}),
				...(devDeps ? { devDependencies: devDeps } : {}),
				...(peerDeps ? { peerDependencies: peerDeps } : {}),
				...(optDeps ? { optionalDependencies: optDeps } : {}),
			});
		}
	}

	const workspaceDependencies = extractWorkspaceDeps(workspaceEntries, workspaceNames);

	// yarn does not record importers; the field is always empty.
	return { lockfileVersion, packages, workspaceDependencies, importers: [] };
};

/**
 * Extract the package name from a yarn lockfile key. Handles compound keys
 * (`"a@workspace:*, a@workspace:packages/a"`) via the first descriptor and
 * `@patch:` descriptors (which embed `@npm:` inside). Total: malformed keys
 * yield `undefined`.
 *
 * @internal
 */
const extractYarnPackageName = (key: string): string | undefined => {
	const commaIdx = key.indexOf(", ");
	const descriptor = commaIdx === -1 ? key : key.slice(0, commaIdx);
	// @patch: first — it embeds @npm: inside the patch descriptor.
	const patchIdx = descriptor.indexOf("@patch:");
	if (patchIdx > 0) return descriptor.slice(0, patchIdx);
	const npmIdx = descriptor.lastIndexOf("@npm:");
	const wsIdx = descriptor.lastIndexOf("@workspace:");
	const idx = Math.max(npmIdx, wsIdx);
	if (idx <= 0) return undefined;
	return descriptor.slice(0, idx);
};

/**
 * Extract the workspace-relative path from a yarn lockfile key: the segment
 * after `@workspace:` in the first descriptor carrying a non-`*` path.
 *
 * @internal
 */
const extractYarnWorkspacePath = (key: string): string | undefined => {
	for (const desc of key.split(", ")) {
		const wsIdx = desc.lastIndexOf("@workspace:");
		if (wsIdx >= 0) {
			const path = desc.slice(wsIdx + "@workspace:".length);
			if (path !== "" && path !== "*") return path;
		}
	}
	return undefined;
};

/**
 * Strip the `"npm:"` prefix from yarn dependency specifiers.
 *
 * @internal
 */
const cleanYarnDeps = (
	deps: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined => {
	if (!deps) return undefined;
	return Object.fromEntries(
		Object.entries(deps).map(([name, value]) => [name, value.startsWith("npm:") ? value.slice(4) : value]),
	);
};
