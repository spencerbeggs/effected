import type { BunExtension } from "../BunExtension.js";
import type { PnpmExtension } from "../PnpmExtension.js";
import type { ResolvedPackage } from "../ResolvedPackage.js";
import { WorkspaceDependency } from "../WorkspaceDependency.js";

/** Dependency type keys to inspect when extracting workspace dependencies. @internal */
export const DEP_TYPES = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * Why the lockfile document could not be located in a YAML stream.
 *
 * @internal
 */
export type FramingReason = "noLockfileDocument" | "noImporters" | "unexpectedDocuments";

/**
 * A text- or shape-level failure: the content is not well-formed, or it does
 * not have the format's expected shape. Carries the delegated engine's error.
 *
 * @internal
 */
export interface ContentFailure {
	readonly stage: "syntax" | "validation";
	readonly cause: unknown;
}

/**
 * A framing failure: the text parsed, but the stream does not carry exactly
 * one locatable lockfile document. Purely synthetic — there is no foreign
 * throwable to wrap, so it carries typed fields instead of a `cause`.
 *
 * @internal
 */
export interface FramingFailure {
	readonly stage: "framing";
	readonly reason: FramingReason;
	readonly documents: number;
}

/**
 * The raw failure record a per-format transform fails with. `Lockfile.parse`
 * materializes it into the public `LockfileParseError` / `LockfileFramingError`
 * (which live in `Lockfile.ts`, a module the internals must not import —
 * `noImportCycles`).
 *
 * @internal
 */
export type ParseFailure = ContentFailure | FramingFailure;

/** @internal */
export const syntaxFailure = (cause: unknown): ParseFailure => ({ stage: "syntax", cause });

/** @internal */
export const validationFailure = (cause: unknown): ParseFailure => ({ stage: "validation", cause });

/** @internal */
export const framingFailure = (reason: FramingReason, documents: number): ParseFailure => ({
	stage: "framing",
	reason,
	documents,
});

/**
 * The field bundle a per-format transform produces and `Lockfile.parse`
 * constructs the `Lockfile` from.
 *
 * @internal
 */
export interface LockfileFields {
	readonly lockfileVersion: string;
	readonly packages: ReadonlyArray<ResolvedPackage>;
	readonly workspaceDependencies: ReadonlyArray<WorkspaceDependency>;
	readonly extension?: PnpmExtension | BunExtension;
}

/**
 * Common dependency-map shape of a single workspace entry, shared across all
 * four formats.
 *
 * @internal
 */
export interface WorkspaceEntry {
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly devDependencies?: Readonly<Record<string, string>>;
	readonly peerDependencies?: Readonly<Record<string, string>>;
	readonly optionalDependencies?: Readonly<Record<string, string>>;
}

/**
 * Whether the specifier is a workspace, link or file reference
 * (`"workspace:*"`, `"link:../foo"`, `"file:../bar"`).
 *
 * @internal
 */
export const isWorkspaceSpecifier = (specifier: string): boolean =>
	specifier.startsWith("workspace:") || specifier.startsWith("link:") || specifier.startsWith("file:");

/**
 * Extract inter-workspace dependency edges: for every workspace entry and
 * dependency type, emit an edge for each dependency whose name is itself a
 * workspace. Key-bearing intermediates are `Map`/`Set` — lockfile keys are
 * attacker-adjacent strings (`__proto__`, `constructor`) and must never be
 * assigned onto plain objects here.
 *
 * @internal
 */
export const extractWorkspaceDeps = (
	workspaces: ReadonlyMap<string, WorkspaceEntry>,
	workspaceNames: ReadonlySet<string>,
): ReadonlyArray<WorkspaceDependency> => {
	const deps: Array<WorkspaceDependency> = [];
	for (const [from, entry] of workspaces) {
		for (const depType of DEP_TYPES) {
			const depMap = entry[depType];
			if (!depMap) continue;
			for (const [name, constraint] of Object.entries(depMap)) {
				if (workspaceNames.has(name)) {
					deps.push(WorkspaceDependency.make({ from, to: name, depType, constraint }));
				}
			}
		}
	}
	return deps;
};
