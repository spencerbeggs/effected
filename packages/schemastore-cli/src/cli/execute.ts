// The shared body of `build` and `check`: load the config, merge the flags
// over its drift block, run, report, and turn the report's verdicts into the
// exit-code contract. Process globals (cwd, the module loader) arrive
// through `ExecuteDeps` so the command tree never reads them itself.

import { CliRuntime } from "@effected/cli";
import type { DriftOptions } from "@effected/schemastore";
import { SchemaFile, SchemaValidator } from "@effected/schemastore";
import type { Layer } from "effect";
import { Console, Effect, Option, Schema } from "effect";
import { ConfigLoader } from "../ConfigLoader.js";
import { Report } from "../Report.js";
import type { RunReport } from "../Runner.js";
import { Runner } from "../Runner.js";
import { StepSummary } from "../StepSummary.js";

/**
 * A published schema drifted under `onDrift: "error"`, so nothing was
 * written. Exit `1`.
 *
 * @public
 */
export class DriftError extends Schema.TaggedError<DriftError>()("DriftError", { count: Schema.Number }) {
	override get message(): string {
		return `${this.count} published schema(s) drifted; nothing was written. Bump the drifting versions in the config, or re-run with --force to write anyway.`;
	}
}

/**
 * A schema failed the lint/validation gate, so nothing was written. Exit `1`.
 *
 * @public
 */
export class GateError extends Schema.TaggedError<GateError>()("GateError", { count: Schema.Number }) {
	override get message(): string {
		return `${this.count} schema(s) failed the lint/validation gate; nothing was written.`;
	}
}

/**
 * The parsed flags and argument of `build` / `check`.
 *
 * @public
 */
export interface ExecuteInput {
	readonly config: Option.Option<string>;
	readonly drift: Option.Option<DriftOptions["policy"]>;
	readonly onDrift: Option.Option<DriftOptions["onDrift"]>;
	readonly force: boolean;
	readonly format: "human" | "json";
}

/**
 * What the process boundary supplies: the ONLY place `process.cwd()` is
 * read is `main.ts`, which fills this in; tests inject all of it.
 * Environment variables are not here — they are read through `Config`
 * against the ambient `ConfigProvider`.
 *
 * @public
 */
export interface ExecuteDeps {
	/** Where config discovery starts and what an explicit path resolves against. */
	readonly cwd: string;
	/** The config module importer; omitted, `ConfigLoader`'s `jiti` default. */
	readonly importModule?: (path: string) => Promise<unknown>;
	/** The validator engine; omitted, the real ajv layer. A test seam, like `importModule`. */
	readonly validator?: Layer.Layer<SchemaValidator>;
}

// `CliRuntime.reported` widens to `Error`; the marks are added in place, so
// the value is still the typed error and the channel can say so.
const reported = <E extends Error>(error: E, exitCode: number): E => CliRuntime.reported(error, exitCode) as E;

const effectiveDrift = (configured: DriftOptions, input: ExecuteInput): RunReport["drift"] => {
	const policy = input.force ? "allow" : Option.getOrElse(input.drift, () => configured.policy);
	const onDrift = Option.getOrElse(input.onDrift, () => configured.onDrift);
	const overridden = input.force || Option.isSome(input.drift) || Option.isSome(input.onDrift);
	return { policy, onDrift, source: overridden ? "flag" : "config" };
};

// stdout is `Console.log` and nothing else; every line meant for a person
// watching stderr goes through the logger, which `main.ts` routes there.
const emit = Effect.fn("schemastore.emit")(function* (report: RunReport, format: ExecuteInput["format"]) {
	if (format === "json") {
		yield* Console.log(Report.json(report));
		for (const line of Report.human(report)) {
			yield* Effect.logInfo(line);
		}
	} else {
		for (const line of Report.human(report)) {
			yield* Console.log(line);
		}
	}
	for (const line of Report.warnings(report)) {
		yield* Effect.logWarning(line);
	}
});

/**
 * Run one `build` or `check`.
 *
 * @remarks
 * Loads the config, applies the flag overrides, runs the shared walk,
 * emits the report in the requested format, appends the step summary, and
 * fails typed — `GateError` before `DriftError`, each carrying exit `1` —
 * when the report says the run refused to write. `SchemaFile` is built
 * here over the environment's `FileSystem`; the validator is
 * `deps.validator` or the real engine.
 *
 * @public
 */
export const execute = Effect.fn("schemastore.execute")(function* (
	mode: "build" | "check",
	input: ExecuteInput,
	deps: ExecuteDeps,
) {
	const loaded = yield* ConfigLoader.load({
		cwd: deps.cwd,
		...(Option.isSome(input.config) ? { explicit: input.config.value } : {}),
		...(deps.importModule !== undefined ? { importModule: deps.importModule } : {}),
	});
	const drift = effectiveDrift(loaded.config.drift, input);
	if (input.force) {
		yield* Effect.logWarning(
			`--force: drift policy is allow for this run; a published document ${mode === "check" ? "would be" : "may be"} rewritten in place, which breaks every consumer pinned to its URL.`,
		);
	}
	const report = yield* Runner.run(loaded.config, { mode, configPath: loaded.path, drift }).pipe(
		Effect.provide(SchemaFile.layer),
		Effect.provide(deps.validator ?? SchemaValidator.layer),
	);
	yield* emit(report, input.format);
	yield* StepSummary.append(Report.markdown(report));
	if (report.gateFailed) {
		const count = report.schemas.filter((schema) => schema.outcome === "gate-failed").length;
		return yield* Effect.fail(reported(new GateError({ count }), 1));
	}
	if (report.drifted && drift.onDrift === "error") {
		const count = report.schemas.filter((schema) => schema.verdict === "drift").length;
		return yield* Effect.fail(reported(new DriftError({ count }), 1));
	}
});
