// The shared body of `effected schema build` and `check`, and of the MCP's
// `schema_build` and `schema_check`: load the config, check its version, merge the
// flags over its onDrift and per-schema drift, run, and answer with the report and
// its verdict. Exit codes, rendering and the step summary stay with the front ends:
// a read-only MCP call inside an Actions step must not write the summary.

import type {
	CanonicalJsonError,
	DriftTolerance,
	InstanceValidator,
	OnDrift,
	SchemaConversionError,
	SchemaFileReadError,
	SchemaFileWriteError,
	SchemaValidator,
	SchemaValidatorError,
	UndeclaredAnnotationKeyError,
} from "@effected/schemastore";
import { SchemaFile } from "@effected/schemastore";
import type { FileSystem, Layer, Path, PlatformError } from "effect";
import { Effect, Option, Schema } from "effect";
import { AjvValidator } from "./AjvValidator.js";
import type { ConfigLoadError, ConfigNotFoundError } from "./ConfigLoader.js";
import { ConfigLoader } from "./ConfigLoader.js";
import type {
	CatalogDirError,
	FrozenVersionIdMismatchError,
	FrozenVersionMissingError,
	SchemaChecked,
} from "./Runner.js";
import { Runner } from "./Runner.js";
import type { SchemaReport } from "./RunReport.js";
import { RunReport } from "./RunReport.js";
import { VersionCheck, VersionMismatch, VersionMismatchError } from "./VersionCheck.js";

/**
 * `--force` (shorthand for `--drift=allow`) was combined with an explicit
 * `--drift` that is not `allow`. Contradictory, so refused as a usage
 * error rather than silently resolving to `allow`.
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
 * What one run was asked to do, as the flags or tool parameters said it.
 *
 * @public
 */
export interface SchemaRunInput {
	readonly mode: "build" | "check";
	/** An explicit config path, resolved against `cwd`; absent, discovery upward from `cwd`. */
	readonly config?: string;
	/** One tolerance over every schema's own. */
	readonly drift?: DriftTolerance;
	/** Overrides the config's `onDrift`. */
	readonly onDrift?: OnDrift;
	/** Sugar for `drift: "allow"`, and contradictory with any other `drift`. */
	readonly force: boolean;
	/** `"fail"` refuses a version mismatch; `"warn"` runs and carries it on the result. */
	readonly versionMismatch: "fail" | "warn";
}

/**
 * Progress through one run.
 *
 * @remarks
 * `Started` precedes the walk and carries any version mismatch the run is going
 * on past, so a front end can warn before a later failure loses it: an error from
 * the walk does not carry it. `SchemaChecked` arrives as each schema's check
 * finishes, before the next one starts, with what is known per schema. Whether a
 * clean schema ends `held` depends on its siblings, so `SchemaDone`, the final
 * state, follows the whole walk.
 *
 * @public
 */
export type SchemaProgress =
	| {
			readonly _tag: "Started";
			readonly names: ReadonlyArray<string>;
			readonly versionMismatch?: VersionMismatch;
	  }
	| ({ readonly _tag: "SchemaChecked" } & SchemaChecked)
	| { readonly _tag: "SchemaDone"; readonly report: SchemaReport };

/**
 * What the process boundary supplies, and the test seams.
 *
 * @public
 */
export interface SchemaRunDeps {
	/** Where config discovery starts and what an explicit path resolves against. */
	readonly cwd: string;
	/** The config module importer; omitted, `ConfigLoader`'s `jiti` default. */
	readonly importModule?: (path: string) => Promise<unknown>;
	/** The validator engine; omitted, `AjvValidator.layer`. */
	readonly validator?: Layer.Layer<SchemaValidator>;
	/** The instance-validation engine, which `validate` uses. */
	readonly instanceValidator?: Layer.Layer<InstanceValidator>;
	/** Told when the walk starts and of each schema's report. */
	readonly onProgress?: (event: SchemaProgress) => Effect.Effect<void>;
}

/**
 * One run's answer: the report, the verdict the front ends map to an exit code
 * or return as data, and any version mismatch the run went on past.
 *
 * @public
 */
export class SchemaRunResult extends Schema.Class<SchemaRunResult>("SchemaRunResult")({
	report: RunReport,
	verdict: Schema.Literals(["ok", "gate-failed", "drift", "catalog-blocked", "stale"]),
	versionMismatch: Schema.optionalKey(VersionMismatch),
}) {}

// In the order a person fixes them: nothing else is meaningful while a gate is
// failing, and `check` is the CI drift gate, so a stale tree fails it last.
const verdictOf = (report: RunReport): SchemaRunResult["verdict"] => {
	if (report.gateFailed) {
		return "gate-failed";
	}
	if (report.drifted && report.onDrift === "error") {
		return "drift";
	}
	const merged = report.catalog?.merged;
	if (merged?.outcome === "blocked") {
		return "catalog-blocked";
	}
	const stale =
		report.mode === "check" &&
		(report.schemas.some((schema) => schema.outcome === "would-write") ||
			[report.catalog?.slice?.outcome, merged?.outcome].some(
				(outcome) => outcome === "would-write" || outcome === "orphaned",
			) ||
			(report.orphaned?.length ?? 0) > 0);
	return stale ? "stale" : "ok";
};

/**
 * Runs one `build` or `check`.
 *
 * @remarks
 * Before anything loads, `force` beside a `drift` other than `allow` fails
 * {@link ConflictingFlagsError}. The version check runs right after the load and
 * before anything is generated. A failing gate, refused drift, blocked catalog or
 * stale tree is a verdict rather than a failure, so a front end can always show
 * the report; the error channel holds a run that could not start or finish.
 * `check` writes nothing: {@link Runner.run}'s one `writing` predicate decides
 * that for documents, and appending the step summary is left to the CLI.
 *
 * @public
 */
export class SchemaRun {
	private constructor() {}

	static readonly run: (
		input: SchemaRunInput,
		deps: SchemaRunDeps,
	) => Effect.Effect<
		SchemaRunResult,
		| ConflictingFlagsError
		| ConfigNotFoundError
		| ConfigLoadError
		| VersionMismatchError
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
		FileSystem.FileSystem | Path.Path
	> = Effect.fn("SchemaRun.run")(function* (input: SchemaRunInput, deps: SchemaRunDeps) {
		if (input.force && input.drift !== undefined && input.drift !== "allow") {
			return yield* new ConflictingFlagsError({ policy: input.drift });
		}
		const loaded = yield* ConfigLoader.load({
			cwd: deps.cwd,
			...(input.config !== undefined ? { explicit: input.config } : {}),
			...(deps.importModule !== undefined ? { importModule: deps.importModule } : {}),
		});
		const mismatch = VersionCheck.inspect(loaded.config);
		if (Option.isSome(mismatch) && input.versionMismatch === "fail") {
			const { tool, found, message } = mismatch.value;
			return yield* new VersionMismatchError({ tool, found, message });
		}
		const { onProgress } = deps;
		yield* onProgress?.({
			_tag: "Started",
			names: loaded.config.schemas.map((schema) => schema.name),
			...(Option.isSome(mismatch) ? { versionMismatch: mismatch.value } : {}),
		}) ?? Effect.void;
		const policy = input.force ? "allow" : input.drift;
		const report = yield* Runner.run(loaded.config, {
			mode: input.mode,
			configPath: loaded.path,
			onDrift: input.onDrift ?? loaded.config.onDrift,
			...(policy !== undefined ? { policy } : {}),
			...(onProgress !== undefined
				? { onChecked: (checked: SchemaChecked) => onProgress({ _tag: "SchemaChecked", ...checked }) }
				: {}),
		}).pipe(Effect.provide(SchemaFile.layer), Effect.provide(deps.validator ?? AjvValidator.layer));
		for (const schema of report.schemas) {
			yield* onProgress?.({ _tag: "SchemaDone", report: schema }) ?? Effect.void;
		}
		return SchemaRunResult.make({
			report,
			verdict: verdictOf(report),
			...(Option.isSome(mismatch) ? { versionMismatch: mismatch.value } : {}),
		});
	});
}
