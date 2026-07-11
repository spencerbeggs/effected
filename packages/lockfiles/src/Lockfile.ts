import { Effect, Schema } from "effect";
import { BunExtension } from "./BunExtension.js";
import { parseBun } from "./internal/bun.js";
import { parseNpm } from "./internal/npm.js";
import { parsePnpm } from "./internal/pnpm.js";
import type { LockfileFields, ParseFailure } from "./internal/shared.js";
import { parseYarn } from "./internal/yarn.js";
import { LockfileFormat } from "./LockfileFormat.js";
import { PnpmExtension } from "./PnpmExtension.js";
import { ResolvedPackage } from "./ResolvedPackage.js";
import { WorkspaceDependency } from "./WorkspaceDependency.js";

/**
 * Failure of `Lockfile.parse`: the given content is not a valid lockfile of
 * the requested format.
 *
 * @remarks
 * - `format` — which format was being parsed.
 * - `stage` — `"syntax"` when the text itself failed to parse (YAML, JSON,
 *   JSONC), `"validation"` when the text parsed but did not have the
 *   format's expected shape.
 * - `cause` — the underlying jsonc/yaml/JSON/Schema error, preserved
 *   structurally.
 *
 * Malformed input always exits through this typed failure, never as a
 * defect. Parse takes content, not a path — the caller that did the IO owns
 * any path context.
 *
 * @public
 */
export class LockfileParseError extends Schema.TaggedErrorClass<LockfileParseError>()("LockfileParseError", {
	format: LockfileFormat,
	stage: Schema.Literals(["syntax", "validation"]),
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return this.stage === "syntax"
			? `Failed to parse ${this.format} lockfile: the content is not well-formed`
			: `Failed to parse ${this.format} lockfile: the content does not have the expected ${this.format} shape`;
	}
}

/**
 * Failure of `Lockfile.parse`: the content parsed as text, but no single
 * lockfile document could be located in it.
 *
 * @remarks
 * `pnpm-lock.yaml` is a YAML **stream**. pnpm 11 writes a
 * config-dependencies preamble document ahead of the lockfile whenever the
 * workspace uses `configDependencies`, so the file holds two documents. The
 * lockfile is the last one — pnpm composes the preamble as a prefix — and a
 * parser that reads only the first document gets the preamble: a document
 * that *validates*, and yields a lockfile with an empty workspace. This error
 * exists so that case can never again succeed quietly.
 *
 * - `format` — which format was being parsed.
 * - `documents` — how many YAML documents the stream carried.
 * - `reason`:
 *   - `"noLockfileDocument"` — the stream carries no lockfile document. An
 *     env-only `pnpm-lock.yaml` (a config-dependencies preamble and nothing
 *     after it) reads this way, as does empty content. pnpm itself treats
 *     such a file as having no lockfile.
 *   - `"noImporters"` — the located document declares no importers, so it
 *     describes no workspace. pnpm always records at least the root importer.
 *   - `"unexpectedDocuments"` — the stream carries several documents in a
 *     format that defines no document framing (yarn). Rather than silently
 *     taking the first, parsing refuses to guess.
 *
 * It carries typed fields rather than a `cause`: unlike
 * {@link LockfileParseError}, there is no underlying engine failure to wrap —
 * the text parsed fine.
 *
 * @public
 */
export class LockfileFramingError extends Schema.TaggedErrorClass<LockfileFramingError>()("LockfileFramingError", {
	format: LockfileFormat,
	reason: Schema.Literals(["noLockfileDocument", "noImporters", "unexpectedDocuments"]),
	documents: Schema.Int,
}) {
	override get message(): string {
		const detail =
			this.reason === "noImporters"
				? "the lockfile document declares no importers, so it describes no workspace"
				: this.reason === "unexpectedDocuments"
					? `expected a single YAML document but the content carries ${this.documents}`
					: `the content carries no lockfile document (${this.documents} YAML document(s) found)`;
		return `Failed to parse ${this.format} lockfile: ${detail}`;
	}
}

const dispatch = (format: LockfileFormat, content: string): Effect.Effect<LockfileFields, ParseFailure> => {
	switch (format) {
		case "bun":
			return parseBun(content);
		case "npm":
			return parseNpm(content);
		case "pnpm":
			return parsePnpm(content);
		case "yarn":
			return parseYarn(content);
	}
};

/**
 * The unified lockfile model all four formats normalize into.
 *
 * @remarks
 * - `format` — which lockfile format produced the data.
 * - `lockfileVersion` — the lockfile format version string.
 * - `packages` — every resolved package.
 * - `workspaceDependencies` — inter-workspace dependency edges.
 * - `extension` — format-specific residue (`PnpmExtension` or
 *   `BunExtension`) when the format records any.
 *
 * For pnpm, `Lockfile.parse` emits the honest importer-path-keyed model
 * (workspace packages named by importer path, version `"0.0.0"`);
 * {@link Lockfile.withImporterNames} is the explicit, pure second stage
 * that rewrites those names once the caller has read the workspace
 * manifests. npm, yarn and bun lockfiles carry real names and need no
 * second stage.
 *
 * @public
 */
export class Lockfile extends Schema.Class<Lockfile>("Lockfile")({
	format: LockfileFormat,
	lockfileVersion: Schema.String,
	packages: Schema.Array(ResolvedPackage),
	workspaceDependencies: Schema.Array(WorkspaceDependency),
	extension: Schema.optionalKey(Schema.Union([PnpmExtension, BunExtension])),
}) {
	/** Lazily built name → packages index; deliberately outside the schema, never encodes. */
	#nameIndex: ReadonlyMap<string, ReadonlyArray<ResolvedPackage>> | undefined;

	/**
	 * Parse lockfile content of a known format into the unified model — the
	 * package's only fallible boundary.
	 *
	 * @param content - The lockfile text (this package does no IO; the caller
	 *   reads the file).
	 * @param options - The lockfile format to parse as.
	 * @returns An `Effect` succeeding with the {@link Lockfile}, or failing
	 *   with {@link LockfileParseError} (malformed text or the wrong shape) or
	 *   {@link LockfileFramingError} (the text parsed, but no lockfile document
	 *   could be located in the stream — see that error for why a
	 *   multi-document `pnpm-lock.yaml` needs it).
	 */
	static readonly parse = Effect.fn("Lockfile.parse")(function* (
		content: string,
		options: { readonly format: LockfileFormat },
	) {
		const fields = yield* dispatch(options.format, content).pipe(
			Effect.mapError((failure) =>
				failure.stage === "framing"
					? new LockfileFramingError({
							format: options.format,
							reason: failure.reason,
							documents: failure.documents,
						})
					: new LockfileParseError({ format: options.format, stage: failure.stage, cause: failure.cause }),
			),
		);
		return Lockfile.make({
			format: options.format,
			lockfileVersion: fields.lockfileVersion,
			packages: fields.packages,
			workspaceDependencies: fields.workspaceDependencies,
			...(fields.extension !== undefined ? { extension: fields.extension } : {}),
		});
	});

	/**
	 * Rewrite pnpm importer-path names to real package names — the explicit
	 * second stage of pnpm parsing. Total and pure.
	 *
	 * @remarks
	 * Workspace packages whose `relativePath` appears in `names` are renamed;
	 * dependency edge ends are rewritten through the same map. Entries not in
	 * the map keep their path name, and non-pnpm lockfiles are unaffected (no
	 * key matches). Versions are not touched — pnpm workspace packages keep
	 * `"0.0.0"` (the lockfile does not record their real versions).
	 *
	 * @param names - Importer path → real package name.
	 * @returns A new {@link Lockfile} with names rewritten.
	 */
	withImporterNames(names: ReadonlyMap<string, string>): Lockfile {
		const packages = this.packages.map((pkg) => {
			if (!pkg.isWorkspace || pkg.relativePath === undefined) return pkg;
			const realName = names.get(pkg.relativePath);
			if (realName === undefined || realName === "" || realName === pkg.name) return pkg;
			return ResolvedPackage.make({
				name: realName,
				version: pkg.version,
				...(pkg.integrity !== undefined ? { integrity: pkg.integrity } : {}),
				isWorkspace: pkg.isWorkspace,
				relativePath: pkg.relativePath,
				dependencies: pkg.dependencies,
			});
		});
		const workspaceDependencies = this.workspaceDependencies.map((dep) => {
			const mappedFrom = names.get(dep.from);
			const mappedTo = names.get(dep.to);
			const from = mappedFrom === undefined || mappedFrom === "" ? dep.from : mappedFrom;
			const to = mappedTo === undefined || mappedTo === "" ? dep.to : mappedTo;
			if (from === dep.from && to === dep.to) return dep;
			return WorkspaceDependency.make({ from, to, depType: dep.depType, constraint: dep.constraint });
		});
		return Lockfile.make({
			format: this.format,
			lockfileVersion: this.lockfileVersion,
			packages,
			workspaceDependencies,
			...(this.extension !== undefined ? { extension: this.extension } : {}),
		});
	}

	/**
	 * Every resolved package with the given name — one entry per resolved
	 * version. Backed by a lazily built index, so repeated lookups are O(1).
	 *
	 * @param name - The package name to look up.
	 * @returns The matching packages, empty when the name is not in the
	 *   lockfile.
	 */
	packagesNamed(name: string): ReadonlyArray<ResolvedPackage> {
		if (this.#nameIndex === undefined) {
			const index = new Map<string, Array<ResolvedPackage>>();
			for (const pkg of this.packages) {
				const bucket = index.get(pkg.name);
				if (bucket === undefined) {
					index.set(pkg.name, [pkg]);
				} else {
					bucket.push(pkg);
				}
			}
			this.#nameIndex = index;
		}
		return this.#nameIndex.get(name) ?? [];
	}

	/** The workspace-local packages. */
	get workspacePackages(): ReadonlyArray<ResolvedPackage> {
		return this.packages.filter((pkg) => pkg.isWorkspace);
	}
}
