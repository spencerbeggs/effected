// `effected schema validate`: does THIS payload conform to the published document it names? The engine answers; this
// reports it with where each finding sits, and maps the answer to an exit code. It never draws: `Started` here carries
// the config's schema names, none of which is what is being validated.

import { CliRuntime, Doc } from "@effected/cli-kit";
import type { LocatedFinding } from "@effected/engine/schema";
import { SchemaValidate, ValidateReport } from "@effected/engine/schema";
import { Console, Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ValidationFailedError } from "./errors.js";
import type { SchemaCommandDeps } from "./execute.js";
import { configFailures, resolveFormat, warnVersionMismatch } from "./execute.js";
import { configArgument, formatFlag, ignoreVersionMismatchFlag } from "./flags.js";

/** The parsed flags and arguments of `validate`. */
export interface ValidateInput {
	readonly payload: string;
	readonly schema: Option.Option<string>;
	readonly config: Option.Option<string>;
	readonly format: Option.Option<"human" | "json">;
	readonly ignoreVersionMismatch: boolean;
}

const findingLine = (finding: LocatedFinding): string => {
	const at = finding.location;
	const where = at !== undefined ? `${at.file}:${at.line}:${at.column}: ` : "  ";
	const keyword = finding.keyword !== undefined ? ` [${finding.keyword}]` : "";
	return `${where}${finding.path === "" ? "(root)" : finding.path}: ${finding.message}${keyword}`;
};

const humanLines = (report: ValidateReport): ReadonlyArray<string> =>
	report.valid
		? [`valid ${report.payload} against ${report.source}`]
		: [
				...report.findings.map(findingLine),
				`${report.findings.length} finding(s): ${report.payload} does not conform to ${report.$ref}`,
			];

/** Run one `validate`. */
export const runValidate = Effect.fn("effected.schema.validate")(function* (
	input: ValidateInput,
	deps: SchemaCommandDeps,
) {
	const format = yield* resolveFormat(input.format);
	const report = yield* SchemaValidate.run(
		{
			payload: input.payload,
			versionMismatch: input.ignoreVersionMismatch ? "warn" : "fail",
			...(Option.isSome(input.config) ? { config: input.config.value } : {}),
			...(Option.isSome(input.schema) ? { schema: input.schema.value } : {}),
		},
		{
			...deps,
			onProgress: (event) =>
				event._tag === "Started" && event.versionMismatch !== undefined
					? warnVersionMismatch(event.versionMismatch)
					: Effect.void,
		},
	).pipe(
		Effect.catchTags({
			...configFailures("validate payload.json lib/schemastore.config.ts", input.config),
			VersionMismatchError: (error) => Effect.fail(CliRuntime.reported(error, 2)),
			PayloadError: (error) => Effect.fail(CliRuntime.reported(error, 2)),
			SchemaResolutionError: (error) => Effect.fail(CliRuntime.reported(error, 2)),
			MissingSchemaRefError: (error) => Effect.fail(CliRuntime.reported(error, 64)),
		}),
	);
	const lines = humanLines(report);
	if (format === "json") {
		yield* Console.log(JSON.stringify(Schema.encodeSync(ValidateReport.Json)(report)));
		for (const line of lines) yield* Effect.logInfo(line);
	} else {
		yield* Doc.print([
			Doc.lines(
				lines.map((line, index) =>
					Doc.text(line, report.valid ? "success" : index === lines.length - 1 ? "emphasis" : "error"),
				),
				{ wrap: false },
			),
		]);
	}
	if (!report.valid) {
		return yield* Effect.fail(
			CliRuntime.reported(
				new ValidationFailedError({ count: report.findings.length, payload: report.payload, schema: report.$ref }),
				1,
			),
		);
	}
});

/**
 * `effected schema validate`: check a payload against a published schema document, named by `--schema` or the payload's
 * `$schema`: a file path, or an identity the config derives. No network is involved.
 */
export const makeValidateCommand = (deps: SchemaCommandDeps) =>
	Command.make(
		"validate",
		{
			payload: Argument.String("payload").pipe(Argument.withDescription("Path to the JSON payload to validate")),
			schema: Flag.String("schema").pipe(
				Flag.optional,
				Flag.withDescription(
					"The document to validate against: a file path, or a $id/url a config schema derives; omitted, the payload's own $schema property",
				),
			),
			config: configArgument,
			format: formatFlag,
			ignoreVersionMismatch: ignoreVersionMismatchFlag,
		},
		(input) => runValidate(input, deps),
	).pipe(
		Command.withDescription(
			"Validate a JSON payload against a published schema document, resolved by path or by the config's derived $id/url identities",
		),
	);
