// The shared body of `build` and `check`: load the config, merge the flags
// over its onDrift and per-schema drift, run, report, and turn the report's
// verdicts into the exit-code contract. Process globals (cwd, the module
// loader) arrive through `ExecuteDeps` so the command tree never reads them
// itself.

import { CliRuntime } from "@effected/cli";
import type { DriftTolerance, OnDrift, SchemaValidator, SchemastoreConfig } from "@effected/schemastore";
import { SchemaFile } from "@effected/schemastore";
import type { Layer } from "effect";
import { Console, Effect, Option, Schema } from "effect";
import { AjvValidator } from "../AjvValidator.js";
import { ConfigLoader } from "../ConfigLoader.js";
import { Report } from "../Report.js";
import type { RunOptions, RunReport } from "../Runner.js";
import { Runner } from "../Runner.js";
import { StepSummary } from "../StepSummary.js";

const DriftedSchema = Schema.Struct({
	$id: Schema.String,
	change: Schema.Literals(["none", "created", "annotations", "contract"]),
	version: Schema.optionalKey(Schema.String),
	nextVersion: Schema.optionalKey(Schema.String),
});

/**
 * A published schema drifted under `onDrift: "error"`, so nothing was
 * written. Exit `1`.
 *
 * @public
 */
export class DriftError extends Schema.TaggedError<DriftError>()("DriftError", {
	drifted: Schema.Array(DriftedSchema),
}) {
	get count(): number {
		return this.drifted.length;
	}
	override get message(): string {
		const lines = this.drifted.map(
			(s) =>
				`  ${s.$id}: ${s.change}${s.version !== undefined ? ` at published ${s.version}` : ""}${s.nextVersion !== undefined ? ` → suggest ${s.nextVersion}` : ""}`,
		);
		return `${this.count} published schema(s) drifted; nothing was written.\n${lines.join("\n")}\nBump the drifting versions in the config, or re-run with --force to write anyway.`;
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
 * `check` found committed documents that differ from what the config
 * generates (or are missing), so a `build` would write. `check` is the CI
 * drift gate, so a stale tree fails it. Exit `1`.
 *
 * @public
 */
export class StaleError extends Schema.TaggedError<StaleError>()("StaleError", { count: Schema.Number }) {
	override get message(): string {
		return `${this.count} document(s) are stale; run \`schemastore build\` and commit the result.`;
	}
}

/**
 * `--force` (shorthand for `--drift=allow`) was combined with an explicit
 * `--drift` that is not `allow`. Contradictory, so refused as a usage
 * error rather than silently resolving to `allow`. Exit `64`.
 *
 * @public
 */
export class ConflictingFlagsError extends Schema.TaggedError<ConflictingFlagsError>()("ConflictingFlagsError", {
	policy: Schema.String,
}) {
	override get message(): string {
		return `--force conflicts with --drift=${this.policy}: --force means --drift=allow`;
	}
}

/**
 * The parsed flags and argument of `build` / `check`.
 *
 * @public
 */
export interface ExecuteInput {
	readonly config: Option.Option<string>;
	readonly drift: Option.Option<DriftTolerance>;
	readonly onDrift: Option.Option<OnDrift>;
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

// `--force` is sugar for `--drift=allow` over every schema at once; absent
// both, drift is classified per schema under its own tolerance (`policy` is
// omitted so `Runner.run` falls back to each `ResolvedSchema.drift`).
const effectiveDrift = (config: SchemastoreConfig, input: ExecuteInput): Pick<RunOptions, "onDrift" | "policy"> => {
	const forced = input.force ? "allow" : Option.getOrUndefined(input.drift);
	const onDrift = Option.getOrElse(input.onDrift, () => config.onDrift);
	return { onDrift, ...(forced !== undefined ? { policy: forced } : {}) };
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
 * Before anything is loaded, `--force` combined with an explicit `--drift`
 * other than `allow` short-circuits with `ConflictingFlagsError` at exit
 * `64` — a usage error, not a run outcome. Otherwise loads the config,
 * applies the flag overrides, runs the shared walk, emits the report in the
 * requested format, appends the step summary, and fails typed —
 * `GateError`, then `DriftError`, then (for `check` only) `StaleError`,
 * each carrying exit `1` — when the report says the run refused to write
 * or, under `check`, that a build would write. `SchemaFile` is built here
 * over the environment's `FileSystem`; the validator is `deps.validator` or
 * the real engine.
 *
 * @public
 */
export const execute = Effect.fn("schemastore.execute")(function* (
	mode: "build" | "check",
	input: ExecuteInput,
	deps: ExecuteDeps,
) {
	if (input.force && Option.isSome(input.drift) && input.drift.value !== "allow") {
		return yield* Effect.fail(CliRuntime.reported(new ConflictingFlagsError({ policy: input.drift.value }), 64));
	}
	const loaded = yield* ConfigLoader.load({
		cwd: deps.cwd,
		...(Option.isSome(input.config) ? { explicit: input.config.value } : {}),
		...(deps.importModule !== undefined ? { importModule: deps.importModule } : {}),
	});
	const drift = effectiveDrift(loaded.config, input);
	if (input.force) {
		yield* Effect.logWarning(
			`--force: drift policy is allow for this run; a published document ${mode === "check" ? "would be" : "may be"} rewritten in place, which breaks every consumer pinned to its URL.`,
		);
	}
	const report = yield* Runner.run(loaded.config, { mode, configPath: loaded.path, ...drift }).pipe(
		Effect.provide(SchemaFile.layer),
		Effect.provide(deps.validator ?? AjvValidator.layer),
		Effect.catchTags({
			FrozenVersionMissingError: (error) => Effect.fail(CliRuntime.reported(error, 1)),
			FrozenVersionIdMismatchError: (error) => Effect.fail(CliRuntime.reported(error, 1)),
		}),
	);
	yield* emit(report, input.format);
	yield* StepSummary.append(Report.markdown(report));
	if (report.gateFailed) {
		const count = report.schemas.filter((schema) => schema.outcome === "gate-failed").length;
		return yield* Effect.fail(CliRuntime.reported(new GateError({ count }), 1));
	}
	if (report.drifted && drift.onDrift === "error") {
		const drifted = report.schemas
			.filter((schema) => schema.verdict === "drift")
			.map((schema) => ({
				$id: schema.$id,
				change: schema.change,
				...(schema.version !== undefined ? { version: schema.version } : {}),
				...(schema.nextVersion !== undefined ? { nextVersion: schema.nextVersion } : {}),
			}));
		return yield* Effect.fail(CliRuntime.reported(new DriftError({ drifted }), 1));
	}
	if (mode === "check") {
		const count =
			report.schemas.filter((schema) => schema.outcome === "would-write").length +
			(report.catalog?.outcome === "would-write" || report.catalog?.outcome === "orphaned" ? 1 : 0);
		if (count > 0) {
			return yield* Effect.fail(CliRuntime.reported(new StaleError({ count }), 1));
		}
	}
});
