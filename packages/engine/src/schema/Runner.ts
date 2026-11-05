// The shared build/check walk: first, every advertised frozen version is
// checked — it must exist, and the `$id` it declares must be the derived one
// — so a schema that advertises a label with nothing on disk, or a file that
// self-identifies elsewhere, is refused before anything is generated. Then `SchemaPipeline.checkOne`
// classifies every current target, `DriftPolicy` applies the lifecycle rule
// the library lacks (per schema, or forced by a flag over every schema at
// once), and only when nothing is refused does `SchemaPipeline.run` write.
// The tool owns the drift policy, so the library's own contract guard is
// switched off (`contractChanges: "allow"`) — the two must never both hold a
// write. Every catalog entry the config declares lands in ONE slice file,
// `<catalogDir>/<name>.json`, and the merged `catalog.json` beside
// `catalogDir` is the union of every slice there; both are compared
// structurally against what is on disk.

import { AtomicFile } from "@effected/files";
import type {
	CanonicalJsonError,
	DriftTolerance,
	DriftVerdict,
	OnDrift,
	PipelineResult,
	SchemaConversionError,
	SchemaFile,
	SchemaFileReadError,
	SchemaValidator,
	SchemaValidatorError,
	SchemastoreConfig,
	UndeclaredAnnotationKeyError,
	WriteChange,
} from "@effected/schemastore";
import {
	CanonicalJson,
	CatalogEntry,
	DriftPolicy,
	SchemaFileWriteError,
	SchemaPipeline,
	SchemaVersioning,
} from "@effected/schemastore";
import { LineDiff } from "@effected/source";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Order, Path, Predicate, Result, Schema } from "effect";
import { ConfigLoader } from "./ConfigLoader.js";
import { decodeJson, flattenSchemaError } from "./internal/decode.js";
import type { CatalogConflict, InvalidSlice, SchemaOutcome } from "./RunReport.js";
import {
	CatalogReport,
	CatalogSliceReport,
	DocumentDiff,
	MergedCatalogReport,
	RunReport,
	SchemaReport,
} from "./RunReport.js";

/**
 * Indicates that one or more schemas advertise a version label (via
 * `ResolvedSchema.frozen`) whose file is missing on disk. Raised by
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
 * `$id` their `ResolvedSchema.frozen` entry derives — the file is
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
 * What one schema's check established, which nothing about its siblings can
 * change. Its final `outcome` can still become `held` when a sibling is refused,
 * so that waits for {@link SchemaReport}.
 *
 * @public
 */
export interface SchemaChecked {
	/** The schema's key in the config. */
	readonly name: string;
	/** What differs between the on-disk document and the generated one. */
	readonly change: WriteChange;
	/** The drift policy's verdict under the tolerance applied to this schema. */
	readonly verdict: DriftVerdict;
	/** Whether this schema's findings block a build. */
	readonly blocked: boolean;
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
	/** Told as each schema's check finishes, before the next one starts. */
	readonly onChecked?: (checked: SchemaChecked) => Effect.Effect<void>;
}

// The tool owns the drift policy: the library's version guard is off so the
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
	const parsed = decodeJson(text);
	if (Result.isFailure(parsed)) {
		return { reason: "unparseable" };
	}
	const $id = Predicate.isObject(parsed.success) ? parsed.success.$id : undefined;
	return typeof $id === "string" ? { reason: "ok", $id } : { reason: "absent" };
};

const parsesEqual = (existing: string, text: string): boolean => {
	const before = decodeJson(existing);
	const after = decodeJson(text);
	return Result.isSuccess(before) && Result.isSuccess(after) && CanonicalJson.equals(before.success, after.success);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Predicate.isObject(value) && !Array.isArray(value);

// `value` with each object's keys in `order`'s sequence, and any key `order`
// lacks after them as it stood. `Object.fromEntries` defines own properties, so a
// `__proto__` key in the file stays data. The caller has already serialized
// `value`, which bounds its depth, so this recursion cannot overflow.
const alignKeys = (value: unknown, order: unknown): unknown => {
	if (Array.isArray(value)) {
		return value.map((element, index) => alignKeys(element, Array.isArray(order) ? order[index] : undefined));
	}
	if (!isRecord(value)) {
		return value;
	}
	const reference = isRecord(order) ? order : {};
	const shared = Object.keys(reference).filter((key) => Object.hasOwn(value, key));
	const rest = Object.keys(value).filter((key) => !Object.hasOwn(reference, key));
	return Object.fromEntries(
		[...shared, ...rest].map((key) => [
			key,
			alignKeys(value[key], Object.hasOwn(reference, key) ? reference[key] : undefined),
		]),
	);
};

// A document in the kit's canonical layout and the generated document's key
// order, so a repo that formats its schemas with spaces or sorts their keys does
// not see every line changed: `check` compares by content and the diff must
// agree. Text that does not parse has no canonical form, and is the thing to show.
const canonicalForm = (existing: string, generated: string): string => {
	// Core's `readFileString` decodes through `TextDecoder`, which already drops a
	// BOM on real and memfs reads. This covers a `FileSystem` that overrides it.
	const text = existing.charCodeAt(0) === 0xfeff ? existing.slice(1) : existing;
	const parsed = decodeJson(text);
	if (Result.isFailure(parsed) || Result.isFailure(CanonicalJson.serializeResult(parsed.success))) {
		return text;
	}
	const order = decodeJson(generated);
	const aligned = Result.isSuccess(order) ? alignKeys(parsed.success, order.success) : parsed.success;
	return Result.getOrElse(CanonicalJson.serializeResult(aligned), () => text);
};

// What a run would change, or changed: the on-disk text comes from the check
// that ran before any write, so a build's diff describes what it replaced.
const documentDiff = (path: string, generated: string, existing: string | undefined): DocumentDiff => {
	const hunks = LineDiff.compute(existing === undefined ? "" : canonicalForm(existing, generated), generated);
	return DocumentDiff.make({
		hunks,
		unified: LineDiff.unified(hunks, { before: existing === undefined ? "/dev/null" : path, after: path }),
	});
};

const CatalogEntries = Schema.Array(CatalogEntry);

// Another config's slice, decoded — or why it cannot be: not JSON, or the
// decode's own issues (every one, `errors: "all"`), each flattened to one
// `<message> at <path>` clause — reported, never silently dropped from the
// merge. An unexpected key is an error too (`onExcessProperty: "error"`): a
// decode that stripped it would publish a merged entry that differs from its
// slice.
const decodeSlice = (text: string): Result.Result<ReadonlyArray<CatalogEntry>, string> => {
	const parsed = decodeJson(text);
	if (Result.isFailure(parsed)) {
		return Result.fail("not JSON");
	}
	return Schema.decodeUnknownResult(CatalogEntries)(parsed.success, { onExcessProperty: "error", errors: "all" }).pipe(
		Result.mapError(flattenSchemaError),
	);
};

// Every merge sort is `Order.String` — code-unit order, never `localeCompare`:
// the merged file must be byte-stable across machines and locales.
const bySlice = Order.mapInput(Order.String, (source: { readonly slice: string }) => source.slice);
const byUrl = Order.mapInput(Order.String, (entry: CatalogEntry) => entry.url);
const byClaimedValue = Order.mapInput(Order.String, ([value]: readonly [string, ReadonlyArray<string>]) => value);

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
		// Mirrors `SchemaFile.write`: create the parent, then write, and name the slice the user asked for, not the temp.
		yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(
			Effect.andThen(AtomicFile.write(file, text)),
			Effect.mapError((cause) => SchemaFileWriteError.make({ path: file, cause })),
		);
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
			slice = CatalogSliceReport.make({ path: slicePath, entries: 0, outcome: "orphaned" });
		}
	} else {
		const outcome = yield* syncFile(slicePath, yield* encodeEntries(own), writing, refused);
		slice = CatalogSliceReport.make({ path: slicePath, entries: own.length, outcome, ...caseFolded });
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
	for (const name of [...names].sort(Order.String)) {
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
	sources.sort(bySlice);

	let merged: MergedCatalogReport | undefined;
	if (sources.length === 0 && invalid.length === 0) {
		if (Option.isSome(yield* orNone(fs.stat(mergedPath)))) {
			merged = MergedCatalogReport.make({
				path: mergedPath,
				entries: 0,
				outcome: "orphaned",
				slices: [],
				conflicts: [],
				invalid: [],
			});
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
				.sort(byClaimedValue)
				.map(([value, slices]) => ({ value, slices: [...slices].sort(Order.String) }));
		const conflicts: Array<CatalogConflict> = [
			...repeated(claims).map(({ value, slices }) => ({ kind: "url" as const, url: value, slices })),
			...repeated(nameClaims).map(({ value, slices }) => ({ kind: "name" as const, name: value, slices })),
		];
		union.sort(byUrl);
		const outcome =
			conflicts.length > 0 || invalid.length > 0
				? "blocked"
				: yield* syncFile(mergedPath, yield* encodeEntries(union), writing, refused);
		merged = MergedCatalogReport.make({
			path: mergedPath,
			entries: union.length,
			outcome,
			slices: sources.map((source) => source.slice),
			conflicts,
			invalid,
		});
	}

	return slice === undefined && merged === undefined
		? undefined
		: CatalogReport.make({
				...(slice !== undefined ? { slice } : {}),
				...(merged !== undefined ? { merged } : {}),
			});
});

/**
 * The shared `build` / `check` walk: verify every advertised frozen version
 * exists, classify every current target through `DriftPolicy` over
 * `SchemaPipeline.checkOne`, then write through `SchemaPipeline.run` only when
 * nothing is refused.
 *
 * @remarks
 * **The frozen check runs first, before anything is generated.** Every
 * schema's `ResolvedSchema.frozen` versions are walked, and every miss
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
 * `ResolvedSchema.drift` tolerance — unless `options.policy` is set,
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
 * **A document whose `change` is not `none` carries a {@link DocumentDiff}**,
 * from the text the check read to the text a build writes, both in the kit's
 * canonical layout. Its line numbers therefore refer to the canonical form,
 * and a document that does not parse diffs as its raw text.
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
 * `CatalogSliceReport.caseFoldedMatch`. On a case-sensitive volume the
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
 * `RunReport.orphaned`. Nothing else on disk is looked at: an
 * `outputDir` shared with another config, a deploy folder, or the
 * repository root holds documents this config cannot tell from its own
 * leftovers, so they are never reported. A `name` change is therefore not
 * caught either — the old name is unknowable. Orphans are reported, never
 * deleted: the tool may not have written them.
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

		// `run` answers one result per target, in target order, so indexing the run
		// results by the check index is total — the cast below asserts that (the
		// `SchemaPipeline.runOne` precedent), with no defensive re-check.
		const targets = config.schemas.map((schema) => schema.target);
		const classified = [];
		// One target at a time, so a front end sees each schema as it finishes: a
		// check holds nothing across targets, and only the final `held` outcome
		// waits on the siblings.
		for (const schema of config.schemas) {
			const target = schema.target;
			const check = yield* SchemaPipeline.checkOne(target, pipelineOptions);
			const policy = options.policy ?? schema.drift;
			const verdict = DriftPolicy.classify({ published: target.published, change: check.change }, policy);
			// A prerelease label declares its own instability: `next` would answer
			// the same label, so there is no suggestion to carry.
			const nextVersion =
				target.version !== undefined && check.change === "contract" && SchemaVersioning.isPinned(target.version)
					? SchemaVersioning.next(target.version, "contract")
					: undefined;
			classified.push({ schema, target, check, verdict, policy, nextVersion });
			if (options.onChecked !== undefined) {
				yield* options.onChecked({ name: schema.name, change: check.change, verdict, blocked: check.blocked });
			}
		}
		const gateFailed = classified.some((entry) => entry.check.blocked);
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

		const schemas = classified.map(({ schema, target, check, verdict, policy, nextVersion }, i) => {
			const outcome: SchemaOutcome = check.blocked
				? "gate-failed"
				: written !== undefined
					? (written[i] as PipelineResult).outcome
					: verdict === "drift"
						? "drift"
						: pendingOutcome(check.wouldWrite, refused);
			return SchemaReport.make({
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
				...(check.change !== "none" ? { diff: documentDiff(target.path, check.generated, check.existing) } : {}),
			});
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
		// Reported, never deleted: the tool may not have written them.
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

		return RunReport.make({
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
		});
	});
}
