import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BuildReport, DiagnosticEntry } from "./schema.js";

/**
 * A diagnostic flattened to a plain JSON object (only defined fields are present).
 *
 * @public
 */
export interface PlainDiagnostic {
	source: DiagnosticEntry["source"];
	level: DiagnosticEntry["level"];
	text: string;
	code?: string;
	ciFatal?: boolean;
	file?: string;
	line?: number;
	column?: number;
}

/**
 * The aggregated build-issues artifact written to `dist/<target>/issues.json`.
 *
 * @public
 */
export interface BuildIssues {
	generatedAt: string;
	package: string;
	target: "dev" | "prod";
	/**
	 * Whether the build that produced this artifact reached its end without a terminal failure.
	 *
	 * The artifact is written on EVERY terminal path — success and failure alike — so a reader must
	 * gate on this flag, not on `errors.length`. A crashed build (API Extractor blowing up, a racing
	 * `rm -rf dist`) can leave all three diagnostic buckets empty; without this stamp that file is
	 * byte-identical to a perfectly clean gate. Absent on artifacts written before this field existed;
	 * treat a missing value as unknown rather than as a pass.
	 */
	buildOk: boolean;
	/** The terminal error that ended the build. Present only when `buildOk` is false. */
	failure?: {
		/** The error's `name` (e.g. `"Error"`, `"ConfigValidationError"`), when it has one. */
		name?: string;
		/** The error message, truncated to 2000 characters. */
		message: string;
	};
	warnings: PlainDiagnostic[];
	errors: PlainDiagnostic[];
	suppressed: PlainDiagnostic[];
}

/** Copy a DiagnosticEntry to a plain object, omitting undefined optionals for stable output. */
function toPlain(d: DiagnosticEntry): PlainDiagnostic {
	const out: PlainDiagnostic = { source: d.source, level: d.level, text: d.text };
	if (d.code !== undefined) out.code = d.code;
	if (d.ciFatal !== undefined) out.ciFatal = d.ciFatal;
	if (d.file !== undefined) out.file = d.file;
	if (d.line !== undefined) out.line = d.line;
	if (d.column !== undefined) out.column = d.column;
	return out;
}

/** De-duplicate by the identity-bearing fields (registry target-groups carry identical diagnostics). */
function dedupe(entries: PlainDiagnostic[]): PlainDiagnostic[] {
	const seen = new Set<string>();
	const out: PlainDiagnostic[] = [];
	for (const e of entries) {
		const key = JSON.stringify([e.source, e.level, e.code ?? "", e.text, e.file ?? "", e.line ?? -1, e.column ?? -1]);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(e);
	}
	return out;
}

/** Longest failure message kept in the artifact — enough for a stack-free error, short of a log dump. */
const MAX_FAILURE_MESSAGE = 2000;

/** Normalize a caller-supplied failure into the stamped shape (message truncated, empty name dropped). */
function toFailure(failure: { name?: string | undefined; message: string }): NonNullable<BuildIssues["failure"]> {
	// The ellipsis counts toward the budget — slicing to the full limit and then
	// appending would emit MAX_FAILURE_MESSAGE + 1 characters.
	const message =
		failure.message.length > MAX_FAILURE_MESSAGE
			? `${failure.message.slice(0, MAX_FAILURE_MESSAGE - 1)}…`
			: failure.message;
	return failure.name !== undefined && failure.name !== "" ? { name: failure.name, message } : { message };
}

/**
 * Flatten a build snapshot into the aggregated, de-duplicated issues artifact. Pure.
 *
 * `buildOk` defaults to `true`, so an existing caller that never fails keeps its current output plus
 * the stamp; a caller that also writes on a failure path MUST pass `buildOk: false` (and ideally the
 * `failure`), otherwise the artifact reads as a clean gate.
 *
 * @public
 */
export function flattenIssues(
	reports: ReadonlyArray<BuildReport>,
	opts: {
		target: "dev" | "prod";
		generatedAt: string;
		buildOk?: boolean | undefined;
		failure?: { name?: string | undefined; message: string } | undefined;
	},
): BuildIssues {
	const warnings: PlainDiagnostic[] = [];
	const errors: PlainDiagnostic[] = [];
	const suppressed: PlainDiagnostic[] = [];
	for (const report of reports) {
		for (const g of report.targetGroups) {
			for (const w of g.warnings) warnings.push(toPlain(w));
			for (const e of g.errors) errors.push(toPlain(e));
			for (const s of g.suppressed) suppressed.push(toPlain(s));
		}
	}
	return {
		generatedAt: opts.generatedAt,
		package: reports[0]?.package ?? "unknown",
		target: opts.target,
		buildOk: opts.buildOk ?? true,
		...(opts.failure !== undefined ? { failure: toFailure(opts.failure) } : {}),
		warnings: dedupe(warnings),
		errors: dedupe(errors),
		suppressed: dedupe(suppressed),
	};
}

/**
 * Serialize the issues artifact to pretty JSON with a trailing newline.
 *
 * @public
 */
export function serializeIssues(issues: BuildIssues): string {
	return `${JSON.stringify(issues, null, 2)}\n`;
}

/**
 * Write the aggregated issues artifact to `<cwd>/dist/<target>/issues.json`. Returns the path written.
 *
 * The write is atomic: the JSON lands in a sibling temp file which is then `rename`d over the
 * destination, so a concurrent reader observes either the previous artifact or the complete new one,
 * never a torn or half-written file. Pass `buildOk: false` (plus `failure`, when there is an error to
 * report) on a failure path — see the `buildOk` field of `BuildIssues`.
 *
 * @public
 */
export function writeIssuesArtifact(opts: {
	cwd: string;
	target: "dev" | "prod";
	reports: ReadonlyArray<BuildReport>;
	now?: () => Date;
	buildOk?: boolean | undefined;
	failure?: { name?: string | undefined; message: string } | undefined;
}): string {
	const clock = opts.now ?? (() => new Date());
	const issues = flattenIssues(opts.reports, {
		target: opts.target,
		generatedAt: clock().toISOString(),
		buildOk: opts.buildOk,
		failure: opts.failure,
	});
	const outPath = join(opts.cwd, "dist", opts.target, "issues.json");
	mkdirSync(dirname(outPath), { recursive: true });
	// Same-directory rename is atomic on every platform we build on; a temp name keyed by pid keeps
	// two concurrent builds of the same package from clobbering each other's in-flight write.
	const tmpPath = `${outPath}.${process.pid}.tmp`;
	try {
		writeFileSync(tmpPath, serializeIssues(issues), "utf8");
		renameSync(tmpPath, outPath);
	} catch (err) {
		rmSync(tmpPath, { force: true });
		throw err;
	}
	return outPath;
}
