// The shared body of `build` and `check`: ask the engine, draw progress when a person is watching, report, and turn the
// verdict into the exit-code contract. What the engine deliberately leaves to a front end lives here: the warnings, the
// step summary and every exit code. Process globals arrive through `SchemaCommandDeps`, so nothing here reads them.

import type { InlineInput } from "@effected/cli-kit";
import { CliInteractive, CliRuntime, Doc } from "@effected/cli-kit";
import type {
	ConfigNotFoundError,
	RunReport,
	SchemaProgress,
	SchemaRunDeps,
	SchemaRunResult,
	VersionMismatch,
} from "@effected/engine/schema";
import { ConfigLoadError, ConfigLoader, Report, SchemaRun, StepSummary } from "@effected/engine/schema";
import { Audience } from "@effected/env";
import { Console, Effect, Option } from "effect";
import { DiffDoc } from "../../render/DiffDoc.js";
import { CatalogMergeError, DriftError, GateError, NoConfigError, StaleError } from "./errors.js";

/**
 * What `effected schema` is given by the process boundary, and the test seams: the engine's dependencies, less the
 * progress callback the command supplies itself. `main` reads `cwd`, and nothing else reads the process.
 *
 * @public
 */
export type SchemaCommandDeps = Omit<SchemaRunDeps, "onProgress">;

/** The parsed flags and argument of `build` and `check`. */
export interface ExecuteInput {
	readonly config: Option.Option<string>;
	readonly drift: Option.Option<"strict" | "semantic" | "allow">;
	readonly onDrift: Option.Option<"error" | "warn">;
	readonly force: boolean;
	readonly format: Option.Option<"human" | "json">;
	readonly ignoreVersionMismatch: boolean;
}

/** `--format` as given, else what the audience reads: JSON for an agent, human text for a person and for CI. */
export const resolveFormat = (format: Option.Option<"human" | "json">) =>
	Effect.map(Audience, (audience) => Option.getOrElse(format, () => (audience.kind === "agent" ? "json" : "human")));

/** Warned before the walk, because an error from the walk does not carry the mismatch. */
export const warnVersionMismatch = (mismatch: VersionMismatch): Effect.Effect<void> =>
	Effect.logWarning(`VERSION MISMATCH IGNORED (--ignore-version-mismatch): ${mismatch.message}`);

/** A missing config, with the way out; a load failure's first line, with the rest (a stack) kept at debug. */
export const configFailures = (usage: string, config: Option.Option<string>) => ({
	ConfigNotFoundError: (error: ConfigNotFoundError) =>
		Effect.fail(
			CliRuntime.reported(
				new NoConfigError({
					names: ConfigLoader.CONFIG_NAMES,
					searched: error.searched,
					explicit: Option.isSome(config),
					usage,
				}),
				2,
			),
		),
	ConfigLoadError: (error: ConfigLoadError) =>
		Effect.gen(function* () {
			const [first = "", ...rest] = error.reason.split("\n");
			if (rest.length > 0) yield* Effect.logDebug(rest.join("\n"));
			return yield* Effect.fail(CliRuntime.reported(new ConfigLoadError({ path: error.path, reason: first }), 2));
		}),
});

// The report's lines come from the engine as text, so the paint reads their leading words.
const LINE_TOKENS: ReadonlyArray<readonly [string, "error" | "warning" | "success" | "muted"]> = [
	["DRIFT", "error"],
	["GATE FAILED", "error"],
	["CATALOG BLOCKED", "error"],
	["would write", "warning"],
	["orphaned", "warning"],
	["written", "success"],
	["unchanged", "muted"],
	["held", "muted"],
];

const paintedLine = (line: string): InlineInput => {
	const token = LINE_TOKENS.find(([prefix]) => line.startsWith(prefix))?.[1];
	return token === undefined ? Doc.text(line) : Doc.text(line, token);
};

/**
 * The human report: the outcome lines, each changed document's diff, then the summary, which `Report.human` writes
 * last and which stays at the bottom where a person's eye lands. `Doc.text` is data to every renderer, so a path or a
 * diff line cannot repaint the terminal.
 */
const humanDocument = (report: RunReport) => {
	const lines = Report.human(report);
	const outcomes = lines.slice(0, -1);
	const summary = lines.slice(-1);
	return Doc.section(undefined, [
		...(outcomes.length > 0 ? [Doc.lines(outcomes.map(paintedLine), { wrap: false })] : []),
		...report.schemas.flatMap((schema) =>
			schema.diff !== undefined ? [DiffDoc.render(schema.path, schema.diff)] : [],
		),
		Doc.lines(summary.map(paintedLine), { wrap: false }),
	]);
};

// stdout is the report and nothing else; every line meant for a person watching stderr goes through the logger.
const emit = (report: RunReport, format: "human" | "json", versionMismatch: VersionMismatch | undefined) =>
	Effect.gen(function* () {
		if (format === "json") {
			yield* Console.log(Report.json(report, versionMismatch));
			for (const line of Report.human(report)) yield* Effect.logInfo(line);
		} else {
			yield* Doc.print([humanDocument(report)]);
		}
		for (const line of Report.warnings(report)) yield* Effect.logWarning(line);
	});

const failOnVerdict = (result: SchemaRunResult) => {
	const { report, verdict } = result;
	const merged = report.catalog?.merged;
	switch (verdict) {
		case "ok":
			return Effect.void;
		case "gate-failed": {
			const count = report.schemas.filter((schema) => schema.outcome === "gate-failed").length;
			return Effect.fail(CliRuntime.reported(new GateError({ count }), 1));
		}
		case "drift": {
			const drifted = report.schemas
				.filter((schema) => schema.verdict === "drift")
				.map((schema) => ({
					$id: schema.$id,
					change: schema.change,
					...(schema.version !== undefined ? { version: schema.version } : {}),
					...(schema.nextVersion !== undefined ? { nextVersion: schema.nextVersion } : {}),
				}));
			return Effect.fail(CliRuntime.reported(new DriftError({ drifted }), 1));
		}
		case "catalog-blocked":
			return Effect.fail(
				CliRuntime.reported(
					new CatalogMergeError({
						path: merged?.path ?? "",
						conflicts: merged?.conflicts ?? [],
						invalid: merged?.invalid ?? [],
					}),
					1,
				),
			);
		case "stale": {
			const catalogFiles = [report.catalog?.slice?.outcome, merged?.outcome];
			const orphaned = catalogFiles.filter((outcome) => outcome === "orphaned").length + (report.orphaned?.length ?? 0);
			const count =
				report.schemas.filter((schema) => schema.outcome === "would-write").length +
				catalogFiles.filter((outcome) => outcome === "would-write").length +
				orphaned;
			return Effect.fail(CliRuntime.reported(new StaleError({ count, ...(orphaned > 0 ? { orphaned } : {}) }), 1));
		}
	}
};

/**
 * Run one `build` or `check`.
 *
 * @remarks
 * The live view is for a person watching, so it needs human output and an interactive run, which `CliInteractive` only
 * ever answers `true` for a human audience with terminals. That module, and Ink and React with it, is imported only
 * then: an agent, CI or piped run never loads them. The report is emitted first and the failure follows, so a run that
 * fails has still said why.
 */
export const execute = Effect.fn("effected.schema.execute")(function* (
	mode: "build" | "check",
	input: ExecuteInput,
	deps: SchemaCommandDeps,
) {
	const format = yield* resolveFormat(input.format);
	const interactive = yield* CliInteractive;

	const announce = (event: SchemaProgress): Effect.Effect<void> =>
		Effect.gen(function* () {
			if (event._tag !== "Started") return;
			if (input.force) {
				yield* Effect.logWarning(
					`--force: drift policy is allow for this run; a published document ${mode === "check" ? "would be" : "may be"} rewritten in place, which breaks every consumer pinned to its URL.`,
				);
			}
			if (event.versionMismatch !== undefined) yield* warnVersionMismatch(event.versionMismatch);
		});

	const walk = (onProgress: (event: SchemaProgress) => Effect.Effect<void>) =>
		SchemaRun.run(
			{
				mode,
				force: input.force,
				versionMismatch: input.ignoreVersionMismatch ? "warn" : "fail",
				...(Option.isSome(input.config) ? { config: input.config.value } : {}),
				...(Option.isSome(input.drift) ? { drift: input.drift.value } : {}),
				...(Option.isSome(input.onDrift) ? { onDrift: input.onDrift.value } : {}),
			},
			{ ...deps, onProgress: (event) => Effect.andThen(announce(event), onProgress(event)) },
		);

	const result = yield* (
		format === "human" && interactive
			? Effect.flatMap(
					Effect.promise(() => import("./LiveProgress.js")),
					({ withLiveProgress }) => withLiveProgress(walk),
				)
			: walk(() => Effect.void)
	).pipe(
		Effect.catchTags({
			...configFailures(`${mode} lib/schemastore.config.ts`, input.config),
			ConflictingFlagsError: (error) => Effect.fail(CliRuntime.reported(error, 64)),
			VersionMismatchError: (error) => Effect.fail(CliRuntime.reported(error, 2)),
			FrozenVersionMissingError: (error) => Effect.fail(CliRuntime.reported(error, 1)),
			FrozenVersionIdMismatchError: (error) => Effect.fail(CliRuntime.reported(error, 1)),
			// A config problem, like a load failure.
			CatalogDirError: (error) => Effect.fail(CliRuntime.reported(error, 2)),
		}),
	);

	yield* emit(result.report, format, result.versionMismatch);
	// Here and not in the engine: a read-only `schema_check` over MCP inside an Actions step must not write the summary.
	yield* StepSummary.append(Report.markdown(result.report));
	yield* failOnVerdict(result);
});
