// The shared build/check walk: first, every advertised frozen version is
// checked — it must exist, and the `$id` it declares must be the derived one
// — so a schema that advertises a label with nothing on disk, or a file that
// self-identifies elsewhere, is refused before anything is generated. Then `SchemaPipeline.check`
// classifies every current target, `DriftPolicy` applies the lifecycle rule
// the library lacks (per schema, or forced by a flag over every schema at
// once), and only when nothing is refused does `SchemaPipeline.run` write.
// The CLI owns the drift policy, so the library's own contract guard is
// switched off (`contractChanges: "allow"`) — the two must never both hold a
// write. Every catalog entry the config declares lands in ONE slice file,
// `<catalogDir>/<name>.json`, and the merged `catalog.json` beside
// `catalogDir` is the union of every slice there; both are compared
// structurally against what is on disk.

import type {
	CanonicalJsonError,
	DriftTolerance,
	DriftVerdict,
	OnDrift,
	PipelineFinding,
	PipelineResult,
	ResolvedSchema,
	SchemaConversionError,
	SchemaFile,
	SchemaFileReadError,
	SchemaFileWriteError,
	SchemaValidator,
	SchemaValidatorError,
	SchemaVersion,
	SchemastoreConfig,
	UndeclaredAnnotationKeyError,
	WriteChange,
} from "@effected/schemastore";
import { CanonicalJson, CatalogEntry, DriftPolicy, SchemaPipeline, SchemaVersioning } from "@effected/schemastore";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import { ConfigLoader } from "./ConfigLoader.js";

/**
 * Indicates that one or more schemas advertise a version label (via
 * {@link ResolvedSchema.frozen}) whose file is missing on disk. Raised by
 * {@link Runner.run} before anything is generated — a build must never
 * publish a catalog pointing a frozen label at a 404. Every miss is
 * collected and reported at once, not just the first.
 *
 * @public
 */
export class FrozenVersionMissingError extends Schema.TaggedError<FrozenVersionMissingError>()(
	"FrozenVersionMissingError",
	{
		/** One entry per schema/version whose frozen file is missing or not a file. */
		missing: Schema.Array(
			Schema.Struct({
				/** The schema's key in the config. */
				name: Schema.String,
				/** The missing frozen version label. */
				version: Schema.String,
				/** The path that does not exist. */
				path: Schema.String,
			}),
		),
	},
) {
	override get message(): string {
		const lines = this.missing.map((entry) => `  schema "${entry.name}" version ${entry.version}: ${entry.path}`);
		return `${this.missing.length} frozen version(s) advertised but not on disk; nothing was written.\n${lines.join("\n")}`;
	}
}

/**
 * Indicates that one or more frozen files exist but do not declare the
 * `$id` their {@link ResolvedSchema.frozen} entry derives — the file is
 * absent an `$id`, declares a different one, or does not parse. Raised by
 * {@link Runner.run} before anything is generated: a frozen document is
 * the one file the derivation does not own, so it is the one place `$id`
 * and the advertised URL can still disagree (a `baseUrl` change leaves
 * every frozen file carrying the old host). Every mismatch is collected.
 *
 * @public
 */
export class FrozenVersionIdMismatchError extends Schema.TaggedError<FrozenVersionIdMismatchError>()(
	"FrozenVersionIdMismatchError",
	{
		/** One entry per frozen file whose `$id` is not the derived one. */
		mismatched: Schema.Array(
			Schema.Struct({
				/** The schema's key in the config. */
				name: Schema.String,
				/** The frozen version label. */
				version: Schema.String,
				/** The frozen file. */
				path: Schema.String,
				/** The `$id` the config derives for this label. */
				expected: Schema.String,
				/** The `$id` the file declares; absent when it declares none or does not parse. */
				actual: Schema.optionalKey(Schema.String),
				/** Why the file fails: a different `$id`, no `$id` at all, or text that is not JSON. */
				reason: Schema.Literals(["mismatch", "absent", "unparseable"]),
			}),
		),
	},
) {
	override get message(): string {
		const lines = this.mismatched.map((entry) => {
			const detail =
				entry.reason === "mismatch"
					? `declares $id ${entry.actual}, expected ${entry.expected}`
					: entry.reason === "absent"
						? `declares no $id, expected ${entry.expected}`
						: `does not parse as JSON, expected $id ${entry.expected}`;
			return `  schema "${entry.name}" version ${entry.version}: ${entry.path} ${detail}`;
		});
		return `${this.mismatched.length} frozen version(s) on disk do not carry their derived $id; nothing was written.\n${lines.join("\n")}`;
	}
}

/**
 * `catalogDir` exists but cannot be listed — it is a file, or the listing
 * failed (a permission failure, say). Every `*.json` file in `catalogDir` is
 * a catalog slice, so without the listing there is no merged catalog to
 * compute. Raised by {@link Runner.run} before anything is generated or
 * written; a config problem, not a run outcome.
 *
 * @public
 */
export class CatalogDirError extends Schema.TaggedError<CatalogDirError>()("CatalogDirError", {
	/** The `catalogDir` that could not be listed. */
	path: Schema.String,
	/** Why, in words: `not a directory` for a file, `permission denied`, or the platform's own description. */
	reason: Schema.String,
}) {
	override get message(): string {
		return `catalogDir ${this.path} cannot be listed (${this.reason}); it must be a directory holding only catalog slices, or not exist yet. Nothing was written.`;
	}
}

// A human reason for a `catalogDir` that cannot be listed. Known tags map to
// fixed text (a platform description also names the path, which the message
// already carries); anything else keeps its description, else its tag.
const listingFailureReason = (error: PlatformError.PlatformError): string => {
	switch (error.reason._tag) {
		case "BadResource":
			return "not a directory";
		case "PermissionDenied":
			return "permission denied";
		default:
			return error.reason.description ?? error.reason._tag;
	}
};

/**
 * What the run did with one schema.
 *
 * - `written` / `unchanged` — the `build` outcomes when the run wrote.
 * - `would-write` — `check` mode: a build would touch the file.
 * - `drift` — the drift policy refused it (and, under `onDrift: "error"`,
 *   held everything else).
 * - `held` — the run wrote nothing because ANOTHER schema failed its gate
 *   or drifted under `onDrift: "error"`; this one was clean and would
 *   otherwise have been written. Reported by both modes: `check` reports
 *   what `build` would do, so it holds the same schemas a build holds.
 * - `gate-failed` — a lint warning or engine finding blocked it.
 *
 * @public
 */
export type SchemaOutcome = "written" | "unchanged" | "would-write" | "drift" | "held" | "gate-failed";

/**
 * One schema's line in the {@link RunReport}.
 *
 * @public
 */
export interface SchemaReport {
	readonly $id: string;
	readonly path: string;
	/** The schema's key in the config. */
	readonly name: string;
	readonly version?: SchemaVersion;
	readonly published: boolean;
	/** What differs between the on-disk document and the generated one. */
	readonly change: WriteChange;
	/** The drift policy's verdict; a written schema under `onDrift: "warn"` keeps `"drift"`. */
	readonly verdict: DriftVerdict;
	/** The tolerance actually applied: this schema's own, or a flag's override over every schema. */
	readonly policy: DriftTolerance;
	readonly outcome: SchemaOutcome;
	/** Every finding, blocking or not. */
	readonly findings: ReadonlyArray<PipelineFinding>;
	/** The label to publish under instead — set only for a `contract` change on a pinned (non-prerelease) versioned schema. */
	readonly nextVersion?: SchemaVersion;
	/** Every OTHER advertised version this schema's frozen check verified. */
	readonly frozen: ReadonlyArray<SchemaVersion>;
}

/**
 * This config's own catalog slice, `<catalogDir>/<name>.json`: a bare
 * SchemaStore catalog entry array holding every entry the config declares,
 * rewritten wholesale — so a removed schema's entry drops out.
 *
 * @public
 */
export interface CatalogSliceReport {
	/** The slice file: `<catalogDir>/<name>.json`. */
	readonly path: string;
	/** How many entries the slice holds; `0` for an orphan. */
	readonly entries: number;
	/**
	 * `held` mirrors {@link SchemaOutcome}: the run refused every write.
	 * `orphaned`: no schema declares a catalog but the slice exists — stale
	 * under `check`, reported and left in place under `build` (the CLI may
	 * not have written it).
	 */
	readonly outcome: "written" | "unchanged" | "would-write" | "held" | "orphaned";
	/**
	 * Present when no file matched `<name>.json` exactly and the volume
	 * resolved that exact path to the one listed file whose name matches it
	 * case-insensitively (a leftover `docs.json` for a config named `Docs`
	 * on a case-insensitive volume) — the on-disk path it claimed. Never set
	 * on a case-sensitive volume, where that file is another slice. On a
	 * case-insensitive volume two configs whose names differ only in case
	 * share, and overwrite, that one file.
	 */
	readonly caseFoldedMatch?: string;
}

/**
 * One catalog URL or display name advertised more than once across the
 * slices, discriminated by `kind`. The merged catalog refuses to pick a
 * winner: for a URL, which entry a host serves would depend on which config
 * built last; for a name, an editor or SchemaStore would show two entries
 * it cannot tell apart. A name is compared over the entries the merge
 * advertises — an entry that already lost its URL to another slice is
 * reported once, as the URL conflict.
 *
 * @public
 */
export type CatalogConflict =
	| {
			readonly kind: "url";
			/** The entry `url` claimed more than once. */
			readonly url: string;
			/** Every slice file advertising it, sorted; a slice listed twice declares it twice itself. */
			readonly slices: ReadonlyArray<string>;
	  }
	| {
			readonly kind: "name";
			/** The entry `name` claimed more than once. */
			readonly name: string;
			/** Every slice file advertising it, sorted; a slice listed twice declares it twice itself. */
			readonly slices: ReadonlyArray<string>;
	  };

/**
 * One slice the merge could not use, and why: `unreadable: <reason>` (a
 * dangling symlink, a permission failure), `not JSON`, or the decode issue
 * itself — `Expected array` for a document that is not an array,
 * `Expected no excess property at [0]["extra"]` for an entry carrying a key
 * a catalog entry does not declare — one semicolon-separated clause per issue.
 *
 * @public
 */
export interface InvalidSlice {
	/** The slice file. */
	readonly path: string;
	/** Why it cannot be merged. */
	readonly reason: string;
}

/**
 * The merged catalog, `catalog.json` in `catalogDir`'s parent: every slice
 * in `catalogDir` united and sorted by entry `url`, with the running
 * config's slice replaced by the entries it computes now when it declares
 * any — so `check` compares against what a build would produce. A config
 * that declares none merges its orphaned slice as it sits on disk, as every
 * other config sees it, so whichever config sharing the directory builds
 * last writes the identical file.
 *
 * @public
 */
export interface MergedCatalogReport {
	/** The merged file: `catalog.json` in `catalogDir`'s parent. */
	readonly path: string;
	/** How many entries the merged file holds (or would hold); `0` for an orphan. */
	readonly entries: number;
	/**
	 * `written`/`unchanged`/`would-write`/`held` as for the slice.
	 * `orphaned`: no slice remains but the merged file exists — stale under
	 * `check`, left in place under `build`. `blocked`: a URL or name conflict or an
	 * invalid slice leaves no merged catalog to trust, so none is written
	 * (both modes fail, exit `1`).
	 */
	readonly outcome: "written" | "unchanged" | "would-write" | "held" | "orphaned" | "blocked";
	/** Every slice file the merge reads — the running config's own included when it declares entries — sorted. */
	readonly slices: ReadonlyArray<string>;
	/**
	 * Every URL, then every name, advertised more than once; each kind
	 * sorted by its value in code-unit order; empty when none.
	 */
	readonly conflicts: ReadonlyArray<CatalogConflict>;
	/**
	 * Every OTHER slice file that cannot be read (a dangling symlink, a
	 * permission failure), is not JSON, or is not a catalog entry array —
	 * one carrying a key a catalog entry does not declare included — sorted;
	 * empty when none. A slice that vanished between listing and reading is
	 * skipped, not listed.
	 */
	readonly invalid: ReadonlyArray<InvalidSlice>;
}

/**
 * The catalog's line in the {@link RunReport}: this config's slice and the
 * merged catalog, each present only when there is something to report.
 *
 * @public
 */
export interface CatalogReport {
	/** Present when the config declares a catalog entry, or declares none but its slice exists (`orphaned`). */
	readonly slice?: CatalogSliceReport;
	/** Present when any slice contributes, or none does but the merged file exists (`orphaned`). */
	readonly merged?: MergedCatalogReport;
}

/**
 * What {@link Runner.run} is asked to do.
 *
 * @public
 */
export interface RunOptions {
	readonly mode: "build" | "check";
	/** Where the config came from, echoed into the report. */
	readonly configPath: string;
	/** What a build does when it finds drift. */
	readonly onDrift: OnDrift;
	/** Present only when a flag forced one tolerance over every schema's own. */
	readonly policy?: DriftTolerance;
}

/**
 * The whole run, as a value: the renderers and the exit-code mapping read
 * this and nothing else.
 *
 * @public
 */
export interface RunReport {
	readonly mode: "build" | "check";
	readonly configPath: string;
	readonly onDrift: OnDrift;
	readonly policy?: DriftTolerance;
	/** One per config schema, in config order. */
	readonly schemas: ReadonlyArray<SchemaReport>;
	/** Absent when there is neither a slice nor a merged catalog to report. */
	readonly catalog?: CatalogReport;
	/**
	 * Every document sitting at a sibling shape of a path the config derives
	 * — the file an `appendVersion` flip or a `layout` change left behind
	 * under the old derived name — that no target, frozen version, catalog
	 * slice, or the merged catalog claims. `check` counts them stale (exit `1`); `build`
	 * reports and never deletes them (the CLI may not have written them).
	 * Absent when none. In config order: schema by schema, the unversioned
	 * shape first, then each label's three other shapes.
	 */
	readonly orphaned?: ReadonlyArray<string>;
	/** At least one schema's verdict is `"drift"`. */
	readonly drifted: boolean;
	/** At least one schema failed its gate. */
	readonly gateFailed: boolean;
	/** At least one file was written. */
	readonly wrote: boolean;
}

// The CLI owns the drift policy: the library's version guard is off so the
// two never disagree about the same target.
const pipelineOptions = { contractChanges: "allow" } as const;

// Text on disk that does not parse is not a catalog array, so there is
// nothing it can be content-equal to: it differs, and a build repairs it.
// Key order is a serialization detail (another tool may have sorted or
// compacted the file); `CanonicalJson.equals` compares structurally.
// The one place "absent" is a value rather than a failure: a NotFound from
// the platform answers `none`, every other PlatformError stays typed.
const orNone = <A, E extends PlatformError.PlatformError, R>(
	read: Effect.Effect<A, E, R>,
): Effect.Effect<Option.Option<A>, E, R> =>
	read.pipe(
		Effect.map(Option.some),
		Effect.catchIf(
			(error) => error.reason._tag === "NotFound",
			() => Effect.succeed(Option.none<A>()),
		),
	);

// What a not-written document reports: `held` when the run refused every
// write, else what a build would do. Shared by schemas and the catalog so
// the two never spell the rule differently.
const pendingOutcome = (wouldWrite: boolean, refused: boolean): "held" | "would-write" | "unchanged" =>
	!wouldWrite ? "unchanged" : refused ? "held" : "would-write";

// The `$id` a frozen file declares, or why it cannot be read: a document
// with no string `$id` (or that is not an object) declares none.
const declaredId = (text: string): { reason: "ok"; $id: string } | { reason: "absent" | "unparseable" } => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { reason: "unparseable" };
	}
	const $id = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).$id : undefined;
	return typeof $id === "string" ? { reason: "ok", $id } : { reason: "absent" };
};

const parsesEqual = (existing: string, text: string): boolean => {
	try {
		return CanonicalJson.equals(JSON.parse(existing), JSON.parse(text));
	} catch {
		return false;
	}
};

const CatalogEntries = Schema.Array(CatalogEntry);

// Another config's slice, decoded — or why it cannot be: not JSON, or the
// decode's own issues (every one, `errors: "all"`), each flattened to one
// `<message> at <path>` clause — reported, never silently dropped from the
// merge. An unexpected key is an error too (`onExcessProperty: "error"`): a
// decode that stripped it would publish a merged entry that differs from its
// slice.
const decodeSlice = (text: string): Result.Result<ReadonlyArray<CatalogEntry>, string> => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return Result.fail("not JSON");
	}
	return Schema.decodeUnknownResult(CatalogEntries)(parsed, { onExcessProperty: "error", errors: "all" }).pipe(
		Result.mapError((error) => error.message.replace(/\n\s+at /g, " at ").replace(/\n/g, "; ")),
	);
};

// Code-unit order, not `localeCompare`: the merged file must be byte-stable
// across machines and locales.
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Compare a canonical text with the file on disk in ONE read — a missing
// file is "different" (a build creates it), and so is text that does not
// parse — then write it when the run is writing and it differs.
const syncFile = Effect.fn("Runner.syncFile")(function* (
	file: string,
	text: string,
	writing: boolean,
	refused: boolean,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const existing = yield* orNone(fs.readFileString(file));
	const same = Option.isSome(existing) && parsesEqual(existing.value, text);
	const outcome = writing && !same ? "written" : pendingOutcome(!same, refused);
	if (outcome === "written") {
		// Mirrors `SchemaFile.write`: create the parent, then write.
		yield* fs.makeDirectory(path.dirname(file), { recursive: true });
		yield* fs.writeFileString(file, text);
	}
	return outcome;
});

const encodeEntries = (entries: ReadonlyArray<CatalogEntry>) =>
	CanonicalJson.serialize(entries.map((entry) => Schema.encodeSync(CatalogEntry)(entry)));

// The catalog half of a run: this config's slice, then the merged catalog
// over every slice in `catalogDir`. `catalogDir` is the ownership record —
// every `*.json` file in it is one config's slice — so it is the one
// directory the Runner lists; `outputDir` never is.
const syncCatalog = Effect.fn("Runner.syncCatalog")(function* (
	config: SchemastoreConfig,
	names: ReadonlyArray<string>,
	writing: boolean,
	refused: boolean,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const slicePath = path.normalize(ConfigLoader.slicePath(config, path));
	const mergedPath = path.normalize(ConfigLoader.mergedCatalogPath(config, path));
	const own: ReadonlyArray<CatalogEntry> = config.schemas.flatMap((schema) =>
		schema.catalog !== undefined ? [schema.catalog] : [],
	);

	// The config's own slice on disk: an EXACT `<name>.json` wins. Failing
	// that, the volume decides, never the name: when exactly one listed file
	// case-folds to `<name>.json`, stat the exact path. A case-insensitive
	// volume resolves it to that one file — a leftover `docs.json` IS the file
	// `Docs.json` names, and must never conflict with the entries replacing
	// it — so the file is claimed. A case-sensitive volume answers NotFound
	// (any failure claims nothing): `docs.json` is another file, merged as
	// another slice, so a case-only rename leftover blocks on the first build
	// like any rename leftover, and configs `docs` and `Docs` never hide each
	// other's slice. Several files folding alike claim nothing. A claim is
	// reported on the slice line, never silent: on a case-insensitive volume
	// two configs named `docs` and `Docs` share — and overwrite — this file.
	const exact = `${config.name}.json`;
	const folded = names.filter((name) => name.toLowerCase() === exact.toLowerCase());
	const ownOnDisk = names.includes(exact)
		? exact
		: own.length > 0 && folded.length === 1 && Result.isSuccess(yield* Effect.result(fs.stat(slicePath)))
			? folded[0]
			: undefined;
	const caseFolded =
		own.length > 0 && ownOnDisk !== undefined && ownOnDisk !== exact
			? { caseFoldedMatch: path.normalize(path.join(config.catalogDir, ownOnDisk)) }
			: {};

	let slice: CatalogSliceReport | undefined;
	if (own.length === 0) {
		// No schema declares a catalog, so no slice is written — but one left
		// behind (the last catalog block was removed) would otherwise be
		// invisible to `check`. Reported, never deleted.
		if (Option.isSome(yield* orNone(fs.stat(slicePath)))) {
			slice = { path: slicePath, entries: 0, outcome: "orphaned" };
		}
	} else {
		const outcome = yield* syncFile(slicePath, yield* encodeEntries(own), writing, refused);
		slice = { path: slicePath, entries: own.length, outcome, ...caseFolded };
	}

	// Every slice as it sits on disk, except the running config's own when it
	// declares entries: that one is replaced by what it computes now, so
	// `check` compares against what a build would produce. With no entries
	// the config writes no slice, so its on-disk file (an orphan) is merged
	// as-is — exactly as every other config sharing the directory sees it.
	// The merge is thus a pure function of disk plus the non-empty fresh
	// entries, and every config converges on one merged file.
	const sources: Array<{ readonly slice: string; readonly entries: ReadonlyArray<CatalogEntry> }> = [];
	const invalid: Array<InvalidSlice> = [];
	for (const name of [...names].sort(byCodeUnit)) {
		const file = path.normalize(path.join(config.catalogDir, name));
		if (!name.endsWith(".json") || (name === ownOnDisk && own.length > 0)) {
			continue;
		}
		// Another config's slice is read defensively: one that vanished
		// between listing and reading is skipped; one that cannot be read (a
		// dangling symlink, a permission failure) is `invalid` — reported and
		// blocking the merge, never an untyped abort of the whole run.
		const info = yield* Effect.result(fs.stat(file));
		if (Result.isFailure(info)) {
			if (info.failure.reason._tag !== "NotFound") {
				invalid.push({ path: file, reason: `unreadable: ${info.failure.reason._tag}` });
			} else if (Result.isSuccess(yield* Effect.result(fs.readLink(file)))) {
				invalid.push({ path: file, reason: "unreadable: a dangling symlink" });
			}
			continue;
		}
		if (info.success.type !== "File") {
			continue;
		}
		const text = yield* Effect.result(fs.readFileString(file));
		if (Result.isFailure(text)) {
			if (text.failure.reason._tag !== "NotFound") {
				invalid.push({ path: file, reason: `unreadable: ${text.failure.reason._tag}` });
			}
			continue;
		}
		const decoded = decodeSlice(text.success);
		if (Result.isFailure(decoded)) {
			invalid.push({ path: file, reason: decoded.failure });
		} else {
			sources.push({ slice: file, entries: decoded.success });
		}
	}
	if (own.length > 0) {
		sources.push({ slice: slicePath, entries: own });
	}
	sources.sort((a, b) => byCodeUnit(a.slice, b.slice));

	let merged: MergedCatalogReport | undefined;
	if (sources.length === 0 && invalid.length === 0) {
		if (Option.isSome(yield* orNone(fs.stat(mergedPath)))) {
			merged = { path: mergedPath, entries: 0, outcome: "orphaned", slices: [], conflicts: [], invalid: [] };
		}
	} else {
		const claims = new Map<string, Array<string>>();
		const nameClaims = new Map<string, Array<string>>();
		const union: Array<CatalogEntry> = [];
		for (const source of sources) {
			for (const entry of source.entries) {
				const claimants = claims.get(entry.url);
				if (claimants === undefined) {
					claims.set(entry.url, [source.slice]);
					union.push(entry);
					// Only an entry the merge advertises claims its name: one that
					// lost its URL is already reported as that URL's conflict.
					const nameClaimants = nameClaims.get(entry.name);
					if (nameClaimants === undefined) {
						nameClaims.set(entry.name, [source.slice]);
					} else {
						nameClaimants.push(source.slice);
					}
				} else {
					claimants.push(source.slice);
				}
			}
		}
		const repeated = (claimed: Map<string, Array<string>>) =>
			[...claimed]
				.filter(([, slices]) => slices.length > 1)
				.sort(([a], [b]) => byCodeUnit(a, b))
				.map(([value, slices]) => ({ value, slices: [...slices].sort(byCodeUnit) }));
		const conflicts: Array<CatalogConflict> = [
			...repeated(claims).map(({ value, slices }) => ({ kind: "url" as const, url: value, slices })),
			...repeated(nameClaims).map(({ value, slices }) => ({ kind: "name" as const, name: value, slices })),
		];
		union.sort((a, b) => byCodeUnit(a.url, b.url));
		const outcome =
			conflicts.length > 0 || invalid.length > 0
				? "blocked"
				: yield* syncFile(mergedPath, yield* encodeEntries(union), writing, refused);
		merged = {
			path: mergedPath,
			entries: union.length,
			outcome,
			slices: sources.map((source) => source.slice),
			conflicts,
			invalid,
		};
	}

	const report: CatalogReport = {
		...(slice !== undefined ? { slice } : {}),
		...(merged !== undefined ? { merged } : {}),
	};
	return slice === undefined && merged === undefined ? undefined : report;
});

/**
 * The shared `build` / `check` walk: verify every advertised frozen version
 * exists, classify every current target through {@link DriftPolicy} over
 * `SchemaPipeline.check`, then write through `SchemaPipeline.run` only when
 * nothing is refused.
 *
 * @remarks
 * **The frozen check runs first, before anything is generated.** Every
 * schema's {@link ResolvedSchema.frozen} versions are walked, and every miss
 * is reported at once: a build fails typed with
 * {@link FrozenVersionMissingError} listing every label with no file on disk
 * — nothing is written — a catalog that points a label at a 404 is a worse
 * failure than an early refusal. A file that is there is read, and must
 * declare the `$id` its entry derives, else the run fails typed with
 * {@link FrozenVersionIdMismatchError} (a different `$id`, none, or text
 * that is not JSON) — a `baseUrl` change is a re-publish event for every
 * frozen label, not a silent re-advertisement.
 *
 * **Drift is classified per schema, under that schema's own
 * {@link ResolvedSchema.drift} tolerance — unless `options.policy` is set,
 * in which case it overrides every schema's own for this run** (the `--drift`
 * / `--force` flags). A build writes NOTHING when any schema fails its gate,
 * or when any schema drifts under `onDrift: "error"` — a partial write would
 * leave a repository half-bumped. Every otherwise-writable schema then
 * reports `held`, so a reader sees why a clean schema was not written — in
 * both modes, since `check` reports what `build` would do under the same
 * flags. Both modes share one `SchemaFile`; the single `writing` predicate
 * (`mode === "build" && !refused`) gates every write, schemas and the
 * catalog files alike. Under `onDrift: "warn"` drifting schemas are written
 * and keep their `"drift"` verdict for the renderer to shout about.
 *
 * **Every catalog entry the config declares lands in ONE slice file**,
 * `<catalogDir>/<name>.json` — a bare SchemaStore catalog entry array,
 * never one file per schema — serialized canonically, compared by parsed
 * content against the file on disk, and rewritten wholesale only when
 * different and only when the run is writing. When no schema declares one,
 * no slice is written; a slice still on disk is reported `orphaned` (stale
 * under `check`) and left in place — and still merged, so the merged
 * catalog keeps advertising its entries until it is deleted by hand.
 *
 * **The merged catalog is the union of every slice in `catalogDir`**,
 * written to `catalog.json` in `catalogDir`'s parent, sorted by entry
 * `url`, and compared and written by the same rule. When the running
 * config declares entries, its slice is replaced by the entries it
 * computes now, so `check` compares against what a build would produce;
 * when it declares none, its on-disk slice is merged as-is. The merge is
 * therefore a pure function of disk plus the non-empty fresh entries, and
 * whichever config sharing the directory builds last writes the identical
 * file. A URL advertised by two
 * slices, or a slice that is not JSON or not a catalog entry array, is
 * reported and blocks the merged write (`blocked`) rather than being
 * silently merged or dropped. With no slice file left in `catalogDir` and
 * no entry declared, a merged file still on disk is `orphaned`.
 * `catalogDir` is the one directory the Runner lists: every `*.json` file
 * in it is a slice by construction. It is listed before anything is
 * generated; one that is a file or cannot be listed fails typed with
 * {@link CatalogDirError}, nothing written. The running config's own slice
 * on disk is an exact `<name>.json` match, or — only when there is none,
 * exactly one listed file case-folds to it, and the volume itself resolves
 * the exact path to that file (a `stat` that succeeds, i.e. a
 * case-insensitive volume) — that one file, reported as
 * {@link CatalogSliceReport.caseFoldedMatch}. On a case-sensitive volume the
 * variant is another slice: a case-only rename leftover blocks the merge on
 * the first build like any other rename leftover.
 *
 * **A moved path leaves an orphan the derivation cannot see**: an
 * `appendVersion` flip or a `layout` change renames a document's derived
 * path, and the previously written file stays on disk under the old name —
 * for a `published` label, its advertised URL keeps serving a stale
 * document with no report. The derivation has exactly four shapes for a
 * name and label (`<name>.json`, `<name>-<v>.json`, `<v>/<name>.json`,
 * `<v>/<name>-<v>.json`), so both modes probe the sibling shapes of every
 * label the config still knows and report each one that exists as a FILE
 * and that no target, frozen version, catalog slice, or merged catalog claims in
 * {@link RunReport.orphaned}. Nothing else on disk is looked at: an
 * `outputDir` shared with another config, a deploy folder, or the
 * repository root holds documents this config cannot tell from its own
 * leftovers, so they are never reported. A `name` change is therefore not
 * caught either — the old name is unknowable. Orphans are reported, never
 * deleted: the CLI may not have written them.
 *
 * @public
 */
export class Runner {
	private constructor() {}

	static readonly run: (
		config: SchemastoreConfig,
		options: RunOptions,
	) => Effect.Effect<
		RunReport,
		| FrozenVersionMissingError
		| FrozenVersionIdMismatchError
		| CatalogDirError
		| SchemaConversionError
		| UndeclaredAnnotationKeyError
		| SchemaValidatorError
		| CanonicalJsonError
		| SchemaFileReadError
		| SchemaFileWriteError
		| PlatformError.PlatformError,
		SchemaFile | SchemaValidator | FileSystem.FileSystem | Path.Path
	> = Effect.fn("Runner.run")(function* (config: SchemastoreConfig, options: RunOptions) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		// Before anything is generated: every advertised frozen version must
		// exist, or nothing is written — a catalog must never point a label at
		// a 404. Every miss is collected so one run reports them all.
		// A file that IS there is then read, because it is the one document the
		// derivation does not own: its `$id` must be the derived one, or the
		// catalog would advertise a document that self-identifies elsewhere.
		const missing: Array<{ name: string; version: string; path: string }> = [];
		const mismatched: Array<FrozenVersionIdMismatchError["mismatched"][number]> = [];
		for (const schema of config.schemas) {
			for (const frozen of schema.frozen) {
				const info = yield* orNone(fs.stat(frozen.path));
				if (Option.isNone(info) || info.value.type !== "File") {
					missing.push({ name: schema.name, version: frozen.version, path: frozen.path });
					continue;
				}
				const text = yield* fs.readFileString(frozen.path);
				const declared = declaredId(text);
				if (declared.reason !== "ok") {
					mismatched.push({
						name: schema.name,
						version: frozen.version,
						path: frozen.path,
						expected: frozen.$id,
						reason: declared.reason,
					});
				} else if (declared.$id !== frozen.$id) {
					mismatched.push({
						name: schema.name,
						version: frozen.version,
						path: frozen.path,
						expected: frozen.$id,
						actual: declared.$id,
						reason: "mismatch",
					});
				}
			}
		}
		if (missing.length > 0) {
			return yield* Effect.fail(new FrozenVersionMissingError({ missing }));
		}
		if (mismatched.length > 0) {
			return yield* Effect.fail(new FrozenVersionIdMismatchError({ mismatched }));
		}

		// `catalogDir` is listed before anything is generated too: without the
		// listing there is no merged catalog, and a failure found after the
		// schemas were written would leave a half-built tree. Absent is fine
		// (nothing has been written yet); a file or an unreadable directory
		// is a config problem, failed typed rather than aborting untyped.
		const listing = yield* Effect.result(fs.readDirectory(config.catalogDir));
		if (Result.isFailure(listing) && listing.failure.reason._tag !== "NotFound") {
			return yield* Effect.fail(
				new CatalogDirError({ path: config.catalogDir, reason: listingFailureReason(listing.failure) }),
			);
		}
		const catalogNames = Result.isSuccess(listing) ? listing.success : [];

		// `check` and `run` answer one result per target, in target order, so
		// indexing `config.schemas` and the run results by the check index is
		// total — the cast below asserts that (the `SchemaPipeline.runOne`
		// precedent), with no defensive re-check.
		const targets = config.schemas.map((schema) => schema.target);
		const checks = yield* SchemaPipeline.check(targets, pipelineOptions);
		const gateFailed = checks.some((check) => check.blocked);
		const classified = checks.map((check, i) => {
			const schema = config.schemas[i] as ResolvedSchema;
			const target = schema.target;
			const policy = options.policy ?? schema.drift;
			const verdict = DriftPolicy.classify({ published: target.published, change: check.change }, policy);
			// A prerelease label declares its own instability: `next` would answer
			// the same label, so there is no suggestion to carry.
			const nextVersion =
				target.version !== undefined && check.change === "contract" && SchemaVersioning.isPinned(target.version)
					? SchemaVersioning.next(target.version, "contract")
					: undefined;
			return { schema, target, check, verdict, policy, nextVersion };
		});
		const drifted = classified.some((entry) => entry.verdict === "drift");
		const refused = gateFailed || (drifted && options.onDrift === "error");
		const writing = options.mode === "build" && !refused;

		// Unreachable: `check` already ran the same gate (so nothing is blocked
		// here) and the contract guard is off under `contractChanges: "allow"`.
		const written = writing
			? yield* SchemaPipeline.run(targets, pipelineOptions).pipe(
					Effect.catchTags({
						SchemaGateError: (error) => Effect.die(error),
						SchemaContractChangeError: (error) => Effect.die(error),
					}),
				)
			: undefined;

		const schemas = classified.map(({ schema, target, check, verdict, policy, nextVersion }, i): SchemaReport => {
			const outcome: SchemaOutcome = check.blocked
				? "gate-failed"
				: written !== undefined
					? (written[i] as PipelineResult).outcome
					: verdict === "drift"
						? "drift"
						: pendingOutcome(check.wouldWrite, refused);
			return {
				$id: target.$id,
				path: target.path,
				name: schema.name,
				published: target.published,
				change: check.change,
				verdict,
				policy,
				outcome,
				findings: check.findings,
				frozen: schema.frozen.map((frozen) => frozen.version),
				...(target.version !== undefined ? { version: target.version } : {}),
				...(nextVersion !== undefined ? { nextVersion } : {}),
			};
		});

		const catalog = yield* syncCatalog(config, catalogNames, writing, refused);

		// A rename leaves an orphan: an `appendVersion` flip or a `layout`
		// change moves a document's derived path, and the file written under
		// the old name stays on disk — invisible to a walk that only reads the
		// paths the config derives. The derivation has exactly four shapes per
		// name and label, so probe the sibling shapes of every label the
		// config still knows and report any that exists as a FILE. Nothing
		// else on disk is ever looked at: `outputDir` may be shared with
		// another config, a deploy folder, or the repository root.
		// Reported, never deleted: the CLI may not have written them.
		// `ConfigLoader.resolvePaths` re-resolves every claimed path through the
		// platform `Path`, so on win32 a relative `outputDir` yields backslashes
		// while an absolute forward-slash one is passed through untouched.
		// Normalise both sides so equality holds by construction everywhere.
		const claimed = new Set<string>([
			path.normalize(ConfigLoader.slicePath(config, path)),
			path.normalize(ConfigLoader.mergedCatalogPath(config, path)),
		]);
		for (const schema of config.schemas) {
			claimed.add(path.normalize(schema.target.path));
			for (const frozen of schema.frozen) {
				claimed.add(path.normalize(frozen.path));
			}
		}
		const orphaned: Array<string> = [];
		for (const schema of config.schemas) {
			const labels = [schema.target.version, ...schema.frozen.map((frozen) => frozen.version)];
			const shapes = [
				SchemaVersioning.fileName(schema.name),
				...labels.flatMap((version) =>
					version === undefined
						? []
						: [
								SchemaVersioning.fileName(schema.name, version, "flat"),
								SchemaVersioning.fileName(schema.name, version, "versioned"),
								SchemaVersioning.fileName(schema.name, version, "versioned", false),
							],
				),
			];
			for (const shape of shapes) {
				const file = path.normalize(path.join(config.outputDir, shape));
				if (claimed.has(file)) {
					continue;
				}
				const info = yield* orNone(fs.stat(file));
				// A DIRECTORY wearing a derived name is not a document; leave it alone.
				if (Option.isSome(info) && info.value.type === "File") {
					orphaned.push(file);
				}
			}
		}

		const report: RunReport = {
			mode: options.mode,
			configPath: options.configPath,
			onDrift: options.onDrift,
			...(options.policy !== undefined ? { policy: options.policy } : {}),
			schemas,
			...(catalog !== undefined ? { catalog } : {}),
			...(orphaned.length > 0 ? { orphaned } : {}),
			drifted,
			gateFailed,
			wrote:
				schemas.some((s) => s.outcome === "written") ||
				catalog?.slice?.outcome === "written" ||
				catalog?.merged?.outcome === "written",
		};
		return report;
	});
}
