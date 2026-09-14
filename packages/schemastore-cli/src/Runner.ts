// The shared build/check walk: `SchemaPipeline.check` classifies every
// target, `DriftPolicy` applies the lifecycle rule the library lacks, and
// only when nothing is refused does `SchemaPipeline.run` write. The CLI owns
// the drift policy, so the library's own contract guard is switched off
// (`contractChanges: "allow"`) — the two must never both hold a write.

import type {
	CatalogTarget,
	DriftOptions,
	DriftVerdict,
	PipelineFinding,
	PipelineResult,
	SchemaTarget,
	SchemaVersion,
	SchemastoreConfig,
	WriteChange,
} from "@effected/schemastore";
import { CanonicalJson, CatalogEntry, DriftPolicy, SchemaPipeline, SchemaVersioning } from "@effected/schemastore";
import { Effect, FileSystem, Path, Schema } from "effect";

/**
 * What the run did with one schema.
 *
 * - `written` / `unchanged` — the `build` outcomes when the run wrote.
 * - `would-write` — `check` mode: a build would touch the file.
 * - `drift` — the drift policy refused it (and, under `onDrift: "error"`,
 *   held everything else).
 * - `held` — a `build` that wrote nothing because ANOTHER schema failed its
 *   gate or drifted under `onDrift: "error"`; this one was clean and would
 *   otherwise have been written.
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
	readonly name?: string;
	readonly version?: SchemaVersion;
	readonly published: boolean;
	/** What differs between the on-disk document and the generated one. */
	readonly change: WriteChange;
	/** The drift policy's verdict; a written schema under `onDrift: "warn"` keeps `"drift"`. */
	readonly verdict: DriftVerdict;
	readonly outcome: SchemaOutcome;
	/** Every finding, blocking or not. */
	readonly findings: ReadonlyArray<PipelineFinding>;
	/** The label to publish under instead — set only for a `contract` change on a versioned schema. */
	readonly nextVersion?: SchemaVersion;
}

/**
 * One catalog entry's line in the {@link RunReport}. `held` mirrors
 * {@link SchemaOutcome}: a build wrote nothing, so an entry that differs
 * was not written either.
 *
 * @public
 */
export interface CatalogReport {
	readonly name: string;
	readonly path: string;
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
	/** The effective drift options and whether a flag overrode the config. */
	readonly drift: DriftOptions & { readonly source: "config" | "flag" };
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
	readonly drift: DriftOptions & { readonly source: "config" | "flag" };
	/** One per config schema, in config order. */
	readonly schemas: ReadonlyArray<SchemaReport>;
	/** One per catalog entry, in config order. */
	readonly catalog: ReadonlyArray<CatalogReport>;
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

const catalogText = (target: CatalogTarget) => CanonicalJson.serialize(Schema.encodeSync(CatalogEntry)(target.entry));

// Plain-JSON structural equality: key order is a serialization detail
// (another tool may have sorted or compacted the file), element order is
// data. `Equal.equals` would only be structural for Effect data types and
// falls back to reference equality on the parsed objects, which is why this
// is spelled out. Same shape as the comparison `SchemaFile` makes for a
// document, which the library does not export.
const jsonEqual = (a: unknown, b: unknown): boolean => {
	if (a === b) {
		return true;
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
	}
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
		return false;
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	return (
		keys.length === Object.keys(right).length &&
		keys.every((k) => Object.hasOwn(right, k) && jsonEqual(left[k], right[k]))
	);
};

// Text on disk that does not parse is not a catalog entry, so there is
// nothing it can be content-equal to: it differs, and a build repairs it.
const sameJson = (existing: string, text: string): boolean => {
	try {
		return jsonEqual(JSON.parse(existing), JSON.parse(text));
	} catch {
		return false;
	}
};

/**
 * The shared `build` / `check` walk: classify every schema through
 * {@link DriftPolicy} over `SchemaPipeline.check`, then write through
 * `SchemaPipeline.run` only when nothing is refused.
 *
 * @remarks
 * A build writes NOTHING when any schema fails its gate, or when any schema
 * drifts under `onDrift: "error"` — a partial write would leave a
 * repository half-bumped. Every otherwise-writable schema then reports
 * `held`, so a reader sees why a clean schema was not written. Under
 * `onDrift: "warn"` drifting schemas are written and keep their `"drift"`
 * verdict for the renderer to shout about.
 *
 * Catalog entries follow the schemas: serialized canonically, compared by
 * parsed content against the file on disk, written only when different and
 * only when the run is writing.
 *
 * @public
 */
export class Runner {
	private constructor() {}

	static readonly run = Effect.fn("Runner.run")(function* (config: SchemastoreConfig, options: RunOptions) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		// `check` and `run` answer one result per target, in target order, so
		// indexing `config.schemas` and the run results by the check index is
		// total — the casts below assert that (the `SchemaPipeline.runOne`
		// precedent), with no defensive re-check.
		const checks = yield* SchemaPipeline.check(config.schemas, pipelineOptions);
		const gateFailed = checks.some((check) => check.blocked);
		const classified = checks.map((check, i) => {
			const target = config.schemas[i] as SchemaTarget;
			const verdict = DriftPolicy.classify({ published: target.published, change: check.change }, options.drift.policy);
			const nextVersion =
				target.version !== undefined && check.change === "contract"
					? SchemaVersioning.next(target.version, "contract")
					: undefined;
			return { target, check, verdict, nextVersion };
		});
		const drifted = classified.some((entry) => entry.verdict === "drift");
		const refused = gateFailed || (drifted && options.drift.onDrift === "error");
		const writing = options.mode === "build" && !refused;

		const written = writing ? yield* SchemaPipeline.run(config.schemas, pipelineOptions) : undefined;

		const schemas = classified.map(({ target, check, verdict, nextVersion }, i): SchemaReport => {
			const outcome: SchemaOutcome = check.blocked
				? "gate-failed"
				: written !== undefined
					? (written[i] as PipelineResult).outcome
					: verdict === "drift"
						? "drift"
						: options.mode === "build" && refused && check.wouldWrite
							? "held"
							: check.wouldWrite
								? "would-write"
								: "unchanged";
			return {
				$id: target.$id,
				path: target.path,
				published: target.published,
				change: check.change,
				verdict,
				outcome,
				findings: check.findings,
				...(target.name !== undefined ? { name: target.name } : {}),
				...(target.version !== undefined ? { version: target.version } : {}),
				...(nextVersion !== undefined ? { nextVersion } : {}),
			};
		});

		const catalog: Array<CatalogReport> = [];
		for (const entry of config.catalog) {
			const { name, path: file } = entry.config;
			const text = yield* catalogText(entry);
			const exists = yield* fs.exists(file);
			const same = exists && sameJson(yield* fs.readFileString(file), text);
			if (same) {
				catalog.push({ name, path: file, outcome: "unchanged" });
			} else if (!writing) {
				catalog.push({ name, path: file, outcome: options.mode === "build" ? "held" : "would-write" });
			} else {
				// Mirrors `SchemaFile.write`: create the parent, then write.
				yield* fs.makeDirectory(path.dirname(file), { recursive: true });
				yield* fs.writeFileString(file, text);
				catalog.push({ name, path: file, outcome: "written" });
			}
		}

		const report: RunReport = {
			mode: options.mode,
			configPath: options.configPath,
			drift: options.drift,
			schemas,
			catalog,
			drifted,
			gateFailed,
			wrote: schemas.some((s) => s.outcome === "written") || catalog.some((c) => c.outcome === "written"),
		};
		return report;
	});
}
