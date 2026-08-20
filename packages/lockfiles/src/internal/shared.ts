import type { DependencyField, IntegrityHashBrand } from "@effected/npm";
import { DependencySpecifier, IntegrityHash } from "@effected/npm";
import { Effect, Exit, Schema } from "effect";
import type { BunExtension } from "../BunExtension.js";
import { ImporterDependency } from "../ImporterDependency.js";
import type { LockfileImporter } from "../LockfileImporter.js";
import type { PnpmExtension } from "../PnpmExtension.js";
import type { ResolvedPackage } from "../ResolvedPackage.js";
import type { UnsupportedLockfileVersion } from "../UnsupportedLockfileVersion.js";
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
 * and yarn (`<cachekey>/<hex>`) textual forms.
 *
 * Absence and corruption are treated differently, and the distinction is the
 * point. An *absent* integrity (input `undefined`) succeeds with `undefined`,
 * so the caller omits the field — a lockfile that records no integrity is
 * legitimate. A *present but unparseable* integrity fails through the same
 * validation channel the shape checks use ({@link validationFailure}), so
 * `Lockfile.parse` surfaces it as a `LockfileParseError` with
 * `stage: "validation"` rather than silently dropping a corrupt value. Never a
 * defect. yarn's `10c0/<hex>` cache checksums are a recognized form, so real
 * yarn/npm/pnpm/bun integrity all still parses; only genuine corruption fails.
 *
 * @internal
 */
export const toIntegrityHash = (
	raw: string | undefined,
): Effect.Effect<IntegrityHashBrand | undefined, ParseFailure> => {
	if (raw === undefined) return Effect.succeed(undefined);
	return Schema.decodeUnknownEffect(IntegrityHash)(raw).pipe(Effect.mapError(validationFailure));
};

const decodeSpecifier = Schema.decodeUnknownExit(DependencySpecifier.FromString);

/**
 * Split pnpm's peer-disambiguation suffix off a recorded string: everything
 * from the first `(` on is suffix, since package names and versions never
 * contain `(`. Handles both shapes pnpm records — a bare version
 * (`"1.0.0(effect@4.0.0)"`, importer entries) and a `name@version` snapshot key
 * (`"fdir@6.5.0(picomatch@4.0.4)"`). A string with no `(` — including
 * `link:...` / `file:...` resolutions — passes through untouched. So does a
 * protocol-bearing string (a `:` ahead of the first `(`), where a parenthesis
 * is path or URL text rather than a peer suffix: pnpm attaches suffixes to
 * registry versions only. This is the single stripping implementation — do not
 * hand-roll an `indexOf("(")` split elsewhere.
 *
 * @internal
 */
export const splitPeerSuffix = (raw: string): { readonly plain: string; readonly peerSuffix?: string } => {
	const parenIndex = raw.indexOf("(");
	if (parenIndex === -1) return { plain: raw };
	if (raw.lastIndexOf(":", parenIndex) !== -1) return { plain: raw };
	return { plain: raw.slice(0, parenIndex), peerSuffix: raw.slice(parenIndex) };
};

/**
 * Build one {@link ImporterDependency}, decoding the raw specifier string into
 * the `@effected/npm` `ClassifiedSpecifier` tagged union. Returns `undefined`
 * — a skip, never a throw — when the name is empty or the specifier does not
 * classify (e.g. an empty specifier), per the total-string-surgery discipline.
 *
 * A pnpm-recorded version is normalized through {@link splitPeerSuffix}: the
 * `version` field carries the plain version and the split-off peer chain lands
 * in `peerSuffix`. A version that is *only* a peer chain (empty plain part) is
 * treated as no concrete version — a skip of both fields, never a throw.
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
	const resolved = version !== undefined && version !== "" ? splitPeerSuffix(version) : undefined;
	return ImporterDependency.make({
		name,
		specifier: exit.value,
		depType,
		...(resolved !== undefined && resolved.plain !== ""
			? {
					version: resolved.plain,
					...(resolved.peerSuffix !== undefined ? { peerSuffix: resolved.peerSuffix } : {}),
				}
			: {}),
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
 * The two peer fields of a `ResolvedPackage`, always present. Spread
 * straight into `ResolvedPackage.make`.
 *
 * @internal
 */
export interface PeerDeclarations {
	readonly peerDependencies: Readonly<Record<string, string>>;
	readonly peerDependenciesMeta: Readonly<Record<string, { readonly optional: boolean }>>;
}

const EMPTY_PEERS: PeerDeclarations = { peerDependencies: {}, peerDependenciesMeta: {} };

/**
 * Normalize one format's peer declarations into the unified pair.
 *
 * Every format records the ranges the same way (a name→range map), but the
 * optional flag has two spellings: a `peerDependenciesMeta` object (pnpm, npm,
 * yarn Berry) and bun's `optionalPeers` array of names. Both are accepted and
 * collapse to `{ optional: boolean }` per peer, so a consumer reads one shape
 * regardless of which manager wrote the lockfile.
 *
 * Absence yields empty records, never `undefined` — an absent section means
 * "declares no peers", which is a fact, not a gap. Records are built with
 * `Object.fromEntries` (own-property semantics), so a `__proto__` peer name
 * neither pollutes nor drops.
 *
 * @internal
 */
export const peerDeclarations = (
	peers: Readonly<Record<string, string>> | undefined,
	meta: Readonly<Record<string, { readonly optional?: boolean }>> | undefined,
	optionalPeers?: ReadonlyArray<string> | undefined,
): PeerDeclarations => {
	if (peers === undefined && meta === undefined && optionalPeers === undefined) return EMPTY_PEERS;
	const flags = new Map<string, boolean>();
	if (meta !== undefined) {
		for (const [name, value] of Object.entries(meta)) {
			flags.set(name, value?.optional === true);
		}
	}
	if (optionalPeers !== undefined) {
		for (const name of optionalPeers) flags.set(name, true);
	}
	return {
		peerDependencies: peers === undefined ? {} : Object.fromEntries(Object.entries(peers)),
		peerDependenciesMeta: Object.fromEntries([...flags].map(([name, optional]) => [name, { optional }])),
	};
};

/**
 * The minimum lockfile-format version each gated format is parsed at.
 *
 * This is a deliberate narrowing of the supported input domain, not an
 * implementation detail: an older lockfile fails typed rather than parsing
 * into a model that cannot answer resolution questions. Note the gate is on
 * the **lockfile format version**, which is the only version a lockfile
 * records — the writing package manager's version is not recoverable from the
 * file, so no manager-version claim could be enforced here.
 *
 * @internal
 */
export const MINIMUM_LOCKFILE_VERSION = { pnpm: 9, npm: 3 } as const;

/**
 * Fail typed when a lockfile predates the supported format version.
 *
 * Routed through {@link validationFailure} rather than {@link framingFailure}:
 * the document was located perfectly well, so this is a shape judgement about
 * a located document, not a framing problem. The cause is a structured record
 * rather than an engine error, so a consumer can tell "your lockfile is too
 * old" from "your lockfile is malformed" without parsing a message.
 *
 * A version that is not a number at all (`lockfileVersion: "next"`) is not a
 * supported version either, and fails the same way.
 *
 * @internal
 */
export const requireLockfileVersion = (
	format: keyof typeof MINIMUM_LOCKFILE_VERSION,
	raw: string | number,
): Effect.Effect<void, ParseFailure> => {
	const minimum = MINIMUM_LOCKFILE_VERSION[format];
	const parsed = typeof raw === "number" ? raw : Number.parseFloat(raw);
	if (Number.isFinite(parsed) && parsed >= minimum) return Effect.void;
	// Typed as the exported public shape, so the record a consumer narrows to
	// with `isUnsupportedLockfileVersion` and the record built here cannot
	// drift apart silently.
	const cause: UnsupportedLockfileVersion = {
		_tag: "UnsupportedLockfileVersion",
		format,
		lockfileVersion: raw,
		minimumSupported: minimum,
		message: `${format} lockfileVersion ${JSON.stringify(raw)} is not supported: @effected/lockfiles parses ${format} lockfileVersion ${minimum} and newer`,
	};
	return Effect.fail(validationFailure(cause));
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
