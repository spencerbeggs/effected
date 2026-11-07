// packages/bundler/src/report/schema.ts
import { Schema } from "effect";

/** @public */
export class ReportTimings extends Schema.Class<ReportTimings>("ReportTimings")({
	totalMs: Schema.Number,
}) {}

/**
 * A captured warning or error, from tsdown's logger, rolldown's onLog, API Extractor, the meta
 * pass's own sidecar work (`tsdoctor.json` sources, Open Graph generation), or an advisory finding
 * about the build config itself (`config`, e.g. a `publishConfig.targets` set no final release reaches).
 *
 * @public
 */
export class DiagnosticEntry extends Schema.Class<DiagnosticEntry>("DiagnosticEntry")({
	source: Schema.Literals(["tsdown", "rolldown", "api-extractor", "meta", "config"]),
	level: Schema.Literals(["warn", "error"]),
	text: Schema.String,
	/**
	 * Diagnostic identifier — an API Extractor messageId (e.g. "ae-forgotten-export") or a
	 * rolldown warning code (e.g. "MIXED_EXPORTS"); used to group suppressed messages by type.
	 */
	code: Schema.optional(Schema.String),
	/** True when shown as `warn` locally but a hard error in CI (drives the "[fails CI]" nudge). */
	ciFatal: Schema.optional(Schema.Boolean),
	file: Schema.optional(Schema.String),
	line: Schema.optional(Schema.Number),
	column: Schema.optional(Schema.Number),
}) {}

/**
 * One emitted output file with its in-memory byte size (gzip only when --verbose).
 *
 * @public
 */
export class EmittedFile extends Schema.Class<EmittedFile>("EmittedFile")({
	path: Schema.String,
	bytes: Schema.Number,
	gzip: Schema.optional(Schema.Number),
}) {}

/**
 * One build pass within a target group (js / dts / loose / exe / meta).
 *
 * @public
 */
export class PassReport extends Schema.Class<PassReport>("PassReport")({
	id: Schema.Literals(["js", "dts", "loose", "exe", "meta"]),
	files: Schema.Array(EmittedFile),
	ms: Schema.Number,
}) {}

/** @public */
export class TargetGroupReport extends Schema.Class<TargetGroupReport>("TargetGroupReport")({
	id: Schema.String,
	entries: Schema.Array(Schema.String),
	passes: Schema.Array(PassReport),
	warnings: Schema.Array(DiagnosticEntry),
	errors: Schema.Array(DiagnosticEntry),
	/** Messages matched by `suppressWarnings`, kept for accounting and `--verbose` expansion. */
	suppressed: Schema.Array(DiagnosticEntry),
	timings: ReportTimings,
}) {}

/** @public */
export class BuildReport extends Schema.Class<BuildReport>("BuildReport")({
	package: Schema.String,
	targetGroups: Schema.Array(TargetGroupReport),
}) {}
