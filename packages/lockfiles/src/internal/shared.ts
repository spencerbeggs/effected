import type { DependencyField, IntegrityHashBrand } from "@effected/npm";
import { DependencySpecifier, IntegrityHash } from "@effected/npm";
import { Exit, Schema } from "effect";
import type { BunExtension } from "../BunExtension.js";
import { ImporterDependency } from "../ImporterDependency.js";
import type { LockfileImporter } from "../LockfileImporter.js";
import type { PnpmExtension } from "../PnpmExtension.js";
import type { ResolvedPackage } from "../ResolvedPackage.js";
import { WorkspaceDependency } from "../WorkspaceDependency.js";

/**
 * The four dependency sections of a manifest, in a stable order — the shared
 * dependency-sections table (v3's `DEP_SECTIONS`). Each entry is both the
 * manifest field name to read and the `@effected/npm` `DependencyField` it maps
 * to, since the two coincide. Consumed by `extractWorkspaceDeps` and by the
 * pnpm/bun/npm importer builders.
 *
 * @internal
 */
export const DEP_TYPES = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * Coerce a raw lockfile integrity string to the `@effected/npm` `IntegrityHash`
 * brand, which recognizes the SRI (`<algo>-<base64>`), corepack (`<algo>.<hex>`)
 * and yarn (`<cachekey>/<hex>`) textual forms. Anything the brand does not
 * recognize is dropped here — a deliberate, total skip that keeps
 * `Lockfile.parse` from failing an otherwise-valid lockfile on a metadata
 * value the brand does not recognize (never a defect, never a parse failure).
 *
 * @internal
 */
export const toIntegrityHash = (raw: string | undefined): IntegrityHashBrand | undefined => {
	if (raw === undefined) return undefined;
	const exit = Schema.decodeUnknownExit(IntegrityHash)(raw);
	return Exit.isSuccess(exit) ? exit.value : undefined;
};

const decodeSpecifier = Schema.decodeUnknownExit(DependencySpecifier.FromString);

/**
 * Build one {@link ImporterDependency}, decoding the raw specifier string into
 * the `@effected/npm` `ClassifiedSpecifier` tagged union. Returns `undefined`
 * — a skip, never a throw — when the name is empty or the specifier does not
 * classify (e.g. an empty specifier), per the total-string-surgery discipline.
 *
 * @internal
 */
const buildImporterDependency = (
	name: string,
	specifier: string,
	depType: DependencyField,
	version: string | undefined,
): ImporterDependency | undefined => {
	if (name === "") return undefined;
	const exit = decodeSpecifier(specifier);
	if (Exit.isFailure(exit)) return undefined;
	return ImporterDependency.make({
		name,
		specifier: exit.value,
		depType,
		...(version !== undefined && version !== "" ? { version } : {}),
	});
};

/**
 * A single importer entry's four dependency sections, keyed by field name. The
 * value type `V` differs per format — pnpm records `{ specifier, version }`,
 * bun and npm record a bare specifier string — so the caller supplies a `read`
 * that projects a section value to a specifier and (pnpm-only) a version.
 *
 * @internal
 */
export type ImporterSections<V> = { readonly [K in DependencyField]?: Readonly<Record<string, V>> };

/**
 * Collect an importer's declared dependencies off the shared dependency-sections
 * table. Iterates {@link DEP_TYPES} in order, projecting each section value with
 * `read`; malformed rows are skipped (never thrown). Key-bearing intermediates
 * are the schema-decoded records, whose own-property `Object.entries` iteration
 * neither pollutes nor drops a `__proto__` key.
 *
 * @internal
 */
export const importerDependencies = <V>(
	entry: ImporterSections<V>,
	read: (value: V) => { readonly specifier: string; readonly version?: string },
): ReadonlyArray<ImporterDependency> => {
	const deps: Array<ImporterDependency> = [];
	for (const field of DEP_TYPES) {
		const section = entry[field];
		if (!section) continue;
		for (const [name, value] of Object.entries(section)) {
			const { specifier, version } = read(value);
			const dep = buildImporterDependency(name, specifier, field, version);
			if (dep !== undefined) deps.push(dep);
		}
	}
	return deps;
};

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
	readonly importers: ReadonlyArray<LockfileImporter>;
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
