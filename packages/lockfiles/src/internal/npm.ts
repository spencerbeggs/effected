import type { NpmWorkspacePatternsError, PackageLockDocument } from "@effected/npm";
import { NpmWorkspacePatterns } from "@effected/npm";
import { Effect, Result } from "effect";
import { LockfileImporter } from "../LockfileImporter.js";
import { ResolvedPackage } from "../ResolvedPackage.js";
import type { LockfileFields, ParseFailure, WorkspaceEntry } from "./shared.js";
import {
	extractWorkspaceDeps,
	importerDependencies,
	peerDeclarations,
	toIntegrityHash,
	validationFailure,
} from "./shared.js";

type NpmPackageEntryType = PackageLockDocument["packages"][string];

const NODE_MODULES_PREFIX = "node_modules/";
const NESTED_NODE_MODULES = "/node_modules/";

/**
 * Where a `packages` key's package name starts: after the **last**
 * `node_modules/` segment, not the first.
 *
 * npm encodes the whole install position in the key, so
 * `node_modules/express/node_modules/debug` is *debug*, nested under express —
 * and `packages/lib/node_modules/react` is *react*, nested under a workspace
 * directory and carrying no `node_modules/` prefix at all. Returns `-1` for a
 * key that is not a package position (the root `""` entry, a workspace path
 * entry), which the caller skips.
 *
 * @internal
 */
const packageNameIndex = (key: string): number => {
	const nested = key.lastIndexOf(NESTED_NODE_MODULES);
	if (nested !== -1) return nested + NESTED_NODE_MODULES.length;
	return key.startsWith(NODE_MODULES_PREFIX) ? NODE_MODULES_PREFIX.length : -1;
};

/**
 * Resolve one entry's outgoing edges by replaying node resolution over the key
 * space: from the depending package's own directory, try
 * `<prefix>/node_modules/<name>`, then strip one path segment and try again,
 * out to the root — **deepest first**, first hit wins. That order is the whole
 * algorithm: outermost-first would return the hoisted copy and silently
 * mis-report every shadowed dependency.
 *
 * Only keys that actually exist in the lockfile are emitted, so an edge npm
 * did not record is omitted rather than invented.
 *
 * @internal
 */
const resolveNpmEdges = (
	start: string,
	sections: ReadonlyArray<Readonly<Record<string, string>> | undefined>,
	packages: Readonly<Record<string, unknown>>,
): Record<string, string> => {
	const names = new Set<string>();
	for (const section of sections) {
		if (!section) continue;
		for (const name of Object.keys(section)) if (name !== "") names.add(name);
	}
	if (names.size === 0) return {};

	const prefixes: Array<string> = [];
	for (let prefix = start; ; ) {
		prefixes.push(prefix);
		if (prefix === "") break;
		const slash = prefix.lastIndexOf("/");
		prefix = slash === -1 ? "" : prefix.slice(0, slash);
	}

	const edges = new Map<string, string>();
	for (const name of names) {
		for (const prefix of prefixes) {
			const candidate = prefix === "" ? `${NODE_MODULES_PREFIX}${name}` : `${prefix}${NESTED_NODE_MODULES}${name}`;
			if (Object.hasOwn(packages, candidate)) {
				edges.set(name, candidate);
				break;
			}
		}
	}
	// Map-backed until the last step: `Object.fromEntries` defines own data
	// properties, so a "__proto__" dependency name neither pollutes nor drops.
	return Object.fromEntries(edges);
};

/**
 * The root entry's `workspaces` failure in this parser's words: the ceiling
 * `@effected/npm`'s matcher refused the field at, as the validation failure
 * names it. `uncompilable` carries glob's own error as its cause.
 */
const rootEntryMessage = (error: NpmWorkspacePatternsError): Error => {
	const { actual, limit } = error;
	switch (error.reason) {
		case "tooManyPatterns":
			return new Error(
				`the root entry's workspaces field declares ${actual} patterns, more than the ${limit} this parser reads`,
			);
		case "tooManyWildcards":
			return new Error(
				`the root entry's workspaces field declares ${actual} wildcard patterns, more than the ${limit} this parser reads`,
			);
		case "patternTooLong":
			return new Error(
				`the root entry's workspaces pattern at index ${error.index} is ${actual} characters long, ` +
					`more than the ${limit} this parser reads for a pattern it matches`,
			);
		case "tooManyAlternatives":
			// Only an exact sum is a size: a stopped count is a lower bound, a kept range's weight an upper one.
			return new Error(
				error.count === "unbounded"
					? `the root entry's workspaces field's wildcard patterns may expand to unboundedly many brace alternatives, more than the ${limit} this parser reads`
					: error.count === "exact"
						? `the root entry's workspaces field's wildcard patterns may expand to ${actual} brace alternatives, more than the ${limit} this parser reads`
						: `the root entry's workspaces field's wildcard patterns may expand to more than the ${limit} brace alternatives this parser reads${error.count === "stopped" ? ` (counting stopped at ${actual})` : ""}`,
			);
		case "uncompilable": {
			const reason = (error.cause as { readonly reason?: string } | undefined)?.reason;
			return new Error(
				`the root entry's workspaces pattern at index ${error.index} will not compile: ` +
					`${reason} (limit ${limit}, actual ${actual})`,
				{ cause: error.cause },
			);
		}
	}
};

/**
 * Whether a link row's target directory is a workspace, read from the root
 * entry's `workspaces` globs the way npm's own `@npmcli/map-workspaces` reads
 * them — through `@effected/npm`'s `NpmWorkspacePatterns`, the kit's one home
 * of those rules.
 *
 * npm writes every symlinked dependency the same way — `{ resolved, link:
 * true }` — whether its target is a workspace or a `file:` directory that is
 * not one, so the globs are the only record that tells them apart. A field
 * past one of the matcher's ceilings fails typed at validation; there is no
 * fallback reading.
 */
const workspaceMatcher = (
	root: NpmPackageEntryType | undefined,
): Result.Result<(path: string) => boolean, ParseFailure> =>
	Result.mapError(NpmWorkspacePatterns.matcherResult(root?.workspaces), (error) =>
		validationFailure(rootEntryMessage(error)),
	);

/**
 * A link row's `resolved` as the workspace decision reads it: `.` segments
 * and empty segments (a doubled or trailing `/`) dropped. `..` is kept as
 * written and never resolved against what precedes it.
 *
 * The matcher assumes the path is normalized the way npm writes `resolved`
 * (POSIX separators, no `.` or empty segment, `..` only as a leading run), and
 * that assumption is what lets a plain path be a set lookup and a `/**`
 * negation be tested against the directory alone. This makes a hand-written
 * `packages/a/`, `./packages/a` or `packages//a` decide as `packages/a`
 * does. An absolute path keeps its leading `/`. An empty result names no
 * directory, and is no workspace.
 *
 * @internal
 */
const workspaceDirOf = (resolved: string): string => {
	const dir = resolved
		.split("/")
		.filter((segment) => segment !== "" && segment !== ".")
		.join("/");
	// An absolute path keeps its root; nothing else is anchored to one.
	return resolved.startsWith("/") && dir !== "" ? `/${dir}` : dir;
};

const entrySections = (entry: NpmPackageEntryType | undefined) =>
	[entry?.dependencies, entry?.devDependencies, entry?.optionalDependencies, entry?.peerDependencies] as const;

/**
 * Normalise a decoded npm `package-lock.json` document into the unified field
 * bundle. The document's own parse (`PackageLockDocument.parse`) owns the
 * syntax, version gate and shape; this owns the reading of what it holds.
 *
 * @internal
 */
export const normalizeNpm = (raw: PackageLockDocument): Effect.Effect<LockfileFields, ParseFailure> => toFields(raw);

// ── Transform ──────────────────────────────────────────────────────────────

const toFields = (raw: PackageLockDocument): Effect.Effect<LockfileFields, ParseFailure> =>
	Effect.gen(function* () {
		const packages: Array<ResolvedPackage> = [];
		const workspaceNames = new Set<string>();
		const workspaceEntries = new Map<string, WorkspaceEntry>();
		const importers: Array<LockfileImporter> = [];
		/** Workspace directories already given an importer, so a second link row to one adds none. */
		const importerPaths = new Set<string>();

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
		const isWorkspaceDir = yield* Effect.fromResult(workspaceMatcher(rootEntry));
		const isWorkspaceLink = (entry: NpmPackageEntryType): boolean =>
			entry.link === true && entry.resolved !== undefined && isWorkspaceDir(workspaceDirOf(entry.resolved));
		for (const [key, entry] of Object.entries(raw.packages)) {
			const nameIndex = packageNameIndex(key);
			if (nameIndex !== -1 && isWorkspaceLink(entry)) {
				const wsEntry = entry.resolved !== undefined ? raw.packages[entry.resolved] : undefined;
				const name = wsEntry?.name ?? entry.name ?? key.slice(nameIndex);
				if (name !== "") workspaceNames.add(name);
			}
		}

		// Second pass: build packages and workspace entries.
		for (const [key, entry] of Object.entries(raw.packages)) {
			if (key === "") continue; // root entry
			// Every key that names a package position, at any nesting depth —
			// `node_modules/x`, `node_modules/x/node_modules/y` and the workspace
			// form `packages/lib/node_modules/y` alike. A key that names none (a
			// workspace path entry) is reached through its link entry instead.
			const nameIndex = packageNameIndex(key);
			if (nameIndex === -1) continue;

			if (entry.link === true && !isWorkspaceLink(entry)) {
				// A link to a directory that is no workspace — a `file:` directory
				// dependency. Its package data lives at the resolved path entry, but
				// it is a plain package: no workspace row, no importer.
				const resolved = entry.resolved;
				const target = resolved !== undefined ? raw.packages[resolved] : undefined;
				const name = target?.name ?? entry.name ?? key.slice(nameIndex);
				if (name === "") continue; // a nameless entry cannot be modeled; skip, never throw
				packages.push(
					ResolvedPackage.make({
						name,
						version: target?.version ?? "0.0.0",
						instanceId: key,
						isWorkspace: false,
						dependencies: target?.dependencies ?? {},
						...peerDeclarations(target?.peerDependencies, target?.peerDependenciesMeta),
						resolved: resolveNpmEdges(
							resolved !== undefined && resolved !== "" ? resolved : key,
							entrySections(target),
							raw.packages,
						),
					}),
				);
			} else if (entry.link === true) {
				// Workspace link — actual package data lives at the resolved path entry.
				const resolved = entry.resolved;
				const wsEntry = resolved !== undefined ? raw.packages[resolved] : undefined;
				const name = wsEntry?.name ?? entry.name ?? key.slice(nameIndex);
				if (name === "") continue; // a nameless entry cannot be modeled; skip, never throw
				packages.push(
					ResolvedPackage.make({
						name,
						version: wsEntry?.version ?? "0.0.0",
						instanceId: key,
						isWorkspace: true,
						...(resolved !== undefined ? { relativePath: resolved } : {}),
						// A workspace link entry is a stub; its manifest sections —
						// peers included — live on the resolved path entry.
						...peerDeclarations(wsEntry?.peerDependencies, wsEntry?.peerDependenciesMeta),
						// Resolution starts from the workspace *directory*, which is where
						// npm nests a workspace-local copy (`packages/lib/node_modules/x`).
						resolved: resolveNpmEdges(
							resolved !== undefined && resolved !== "" ? resolved : key,
							entrySections(wsEntry),
							raw.packages,
						),
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
				// An empty resolved path is malformed: `LockfileImporter.path` is a
				// `NonEmptyString`, so constructing one from "" would die as a defect.
				// Skip the row before construction, per the total-skip discipline.
				// npm writes one link row per name a workspace is reached by, so an
				// aliased `file:` dependency on a workspace adds a second row with the
				// same target. The importer is the directory: one per target.
				if (resolved !== undefined && resolved !== "" && !importerPaths.has(resolved)) {
					importerPaths.add(resolved);
					importers.push(
						LockfileImporter.make({
							path: resolved,
							dependencies: wsEntry ? importerDependencies(wsEntry, (s) => ({ specifier: s })) : [],
						}),
					);
				}
			} else {
				// Regular resolved package, at any depth.
				const name = key.slice(nameIndex);
				if (name !== "" && entry.version !== undefined) {
					const integrity = yield* toIntegrityHash(entry.integrity);
					packages.push(
						ResolvedPackage.make({
							name,
							version: entry.version,
							instanceId: key,
							...(integrity !== undefined ? { integrity } : {}),
							isWorkspace: false,
							dependencies: entry.dependencies ?? {},
							...peerDeclarations(entry.peerDependencies, entry.peerDependenciesMeta),
							resolved: resolveNpmEdges(key, entrySections(entry), raw.packages),
						}),
					);
				}
			}
		}

		const workspaceDependencies = extractWorkspaceDeps(workspaceEntries, workspaceNames);

		return {
			lockfileVersion: String(raw.lockfileVersion),
			packages,
			workspaceDependencies,
			importers,
		};
	});
