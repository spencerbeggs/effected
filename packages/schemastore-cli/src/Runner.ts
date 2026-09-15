// The shared build/check walk: first, every advertised frozen version is
// checked for existence — a schema that advertises a label with nothing on
// disk is refused before anything is generated. Then `SchemaPipeline.check`
// classifies every current target, `DriftPolicy` applies the lifecycle rule
// the library lacks (per schema, or forced by a flag over every schema at
// once), and only when nothing is refused does `SchemaPipeline.run` write.
// The CLI owns the drift policy, so the library's own contract guard is
// switched off (`contractChanges: "allow"`) — the two must never both hold a
// write. Every catalog entry the config declares lands in ONE file at
// `config.catalogPath`, compared structurally against what is on disk.

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
import { Effect, FileSystem, Option, Path, Schema } from "effect";

/**
 * Indicates that a schema advertises a version label (via
 * {@link ResolvedSchema.frozen}) whose file is missing on disk. Raised by
 * {@link Runner.run} before anything is generated — a build must never
 * publish a catalog pointing a frozen label at a 404.
 *
 * @public
 */
export class FrozenVersionMissingError extends Schema.TaggedError<FrozenVersionMissingError>()(
	"FrozenVersionMissingError",
	{
		/** The schema's key in the config. */
		name: Schema.String,
		/** The missing frozen version label. */
		version: Schema.String,
		/** The path that does not exist. */
		path: Schema.String,
	},
) {
	override get message(): string {
		return `schema "${this.name}" advertises frozen version ${this.version} but ${this.path} does not exist; nothing was written`;
	}
}

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
 * The single catalog file's line in the {@link RunReport} — present only
 * when at least one schema declared a catalog entry.
 *
 * @public
 */
export interface CatalogReport {
	/** Where the catalog is written (`config.catalogPath`). */
	readonly path: string;
	/** How many entries the file holds. */
	readonly entries: number;
	/** `held` mirrors {@link SchemaOutcome}: the run refused every write. */
	readonly outcome: "written" | "unchanged" | "would-write" | "held";
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
	/** Whether `onDrift`/`policy` came from the config or a flag override. */
	readonly source: "config" | "flag";
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
	readonly source: "config" | "flag";
	/** One per config schema, in config order. */
	readonly schemas: ReadonlyArray<SchemaReport>;
	/** Absent when no schema declared a catalog entry. */
	readonly catalog?: CatalogReport;
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

const parsesEqual = (existing: string, text: string): boolean => {
	try {
		return CanonicalJson.equals(JSON.parse(existing), JSON.parse(text));
	} catch {
		return false;
	}
};

/**
 * The shared `build` / `check` walk: verify every advertised frozen version
 * exists, classify every current target through {@link DriftPolicy} over
 * `SchemaPipeline.check`, then write through `SchemaPipeline.run` only when
 * nothing is refused.
 *
 * @remarks
 * **The frozen check runs first, before anything is generated.** A schema
 * whose {@link ResolvedSchema.frozen} names a label with no file on disk
 * fails typed with {@link FrozenVersionMissingError} — nothing is written —
 * a catalog that points a label at a 404 is a worse failure than an early
 * refusal.
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
 * catalog file alike. Under `onDrift: "warn"` drifting schemas are written
 * and keep their `"drift"` verdict for the renderer to shout about.
 *
 * **Every catalog entry the config declares lands in ONE file** at
 * `config.catalogPath` — never one file per schema — serialized canonically
 * and compared by parsed content against the file on disk, written only
 * when different and only when the run is writing. The report omits
 * `catalog` entirely when no schema declared one.
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
		// a 404.
		for (const schema of config.schemas) {
			for (const frozen of schema.frozen) {
				const info = yield* orNone(fs.stat(frozen.path));
				if (Option.isNone(info) || info.value.type !== "File") {
					return yield* Effect.fail(
						new FrozenVersionMissingError({ name: schema.name, version: frozen.version, path: frozen.path }),
					);
				}
			}
		}

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

		const entries: ReadonlyArray<CatalogEntry> = config.schemas.flatMap((schema) =>
			schema.catalog !== undefined ? [schema.catalog] : [],
		);
		let catalog: CatalogReport | undefined;
		if (entries.length > 0) {
			const text = yield* CanonicalJson.serialize(entries.map((entry) => Schema.encodeSync(CatalogEntry)(entry)));
			// One read; a missing file is "different" (a build creates it), and so
			// is text that does not parse — nothing unparseable is content-equal.
			const existing = yield* orNone(fs.readFileString(config.catalogPath));
			const same = Option.isSome(existing) && parsesEqual(existing.value, text);
			const outcome = writing && !same ? "written" : pendingOutcome(!same, refused);
			if (outcome === "written") {
				// Mirrors `SchemaFile.write`: create the parent, then write.
				yield* fs.makeDirectory(path.dirname(config.catalogPath), { recursive: true });
				yield* fs.writeFileString(config.catalogPath, text);
			}
			catalog = { path: config.catalogPath, entries: entries.length, outcome };
		}

		const report: RunReport = {
			mode: options.mode,
			configPath: options.configPath,
			onDrift: options.onDrift,
			source: options.source,
			...(options.policy !== undefined ? { policy: options.policy } : {}),
			schemas,
			...(catalog !== undefined ? { catalog } : {}),
			drifted,
			gateFailed,
			wrote: schemas.some((s) => s.outcome === "written") || catalog?.outcome === "written",
		};
		return report;
	});
}
