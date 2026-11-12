// `schema_check`, `schema_build` and `schema_validate`: thin shells over the engine. What is theirs alone is keeping
// caller-supplied paths inside the workspace root, serializing the walks, and turning a run that could not finish into
// a refusal an agent can read. Drift, staleness and a failed validation are the answer the agent asked for, so they
// stay ordinary results.

import type { SchemaProgress, SchemaRunDeps, VersionMismatch } from "@effected/engine/schema";
import { ConfigLoader, SchemaRun, SchemaRunResult, SchemaValidate, ValidateReport } from "@effected/engine/schema";
import type { ExclusiveTimeout } from "@effected/kit";
import { Exclusive } from "@effected/kit";
import { ToolFailure, ToolRefusal } from "@effected/mcp-kit";
import { Effect, FileSystem, Option, Path, Ref, Schema } from "effect";
import { Tool } from "effect/ai";
import { findRoot, inside } from "../root.js";

const CONFIG_DESCRIPTION =
	"The schemastore config, resolved against the workspace root and refused outside it. Omitted, discovery walks upward from the server's working directory, stopping at the workspace root.";

const RunParameters = Schema.Struct({
	config: Schema.optionalKey(Schema.String.annotate({ description: CONFIG_DESCRIPTION })),
	drift: Schema.optionalKey(
		Schema.Literals(["strict", "semantic", "allow"]).annotate({
			description: "One drift tolerance over every schema's own.",
		}),
	),
	onDrift: Schema.optionalKey(
		Schema.Literals(["error", "warn"]).annotate({ description: "Overrides the config's onDrift." }),
	),
	force: Schema.optionalKey(
		Schema.Boolean.annotate({ description: 'Shorthand for drift "allow", and refused beside any other drift.' }),
	),
});

/**
 * The `schema_check` tool: what `schema_build` would do, writing nothing.
 *
 * @public
 */
export const schemaCheck = Tool.make("schema_check", {
	description:
		"Checks the generated schema documents against the config, writing nothing. Drift and staleness arrive as the result's verdict, with each changed document's full diff; they are not errors. Reloads the config on every call.",
	parameters: RunParameters,
	success: SchemaRunResult,
	failure: ToolRefusal,
})
	.annotate(Tool.Title, "Check schema documents")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

/**
 * The `schema_build` tool: writes the generated documents and catalogs.
 *
 * @public
 */
export const schemaBuild = Tool.make("schema_build", {
	description:
		"Generates the schema documents and catalogs the config declares and writes the ones that changed, wherever the config puts them. A refused drift or a failed gate writes nothing and arrives as the result's verdict. Reloads the config on every call.",
	parameters: RunParameters,
	success: SchemaRunResult,
	failure: ToolRefusal,
})
	.annotate(Tool.Title, "Build schema documents")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

/**
 * The `schema_validate` tool: does one payload conform to a published document.
 *
 * @public
 */
export const schemaValidate = Tool.make("schema_validate", {
	description:
		"Validates a JSON payload file against a local schema document, with each finding's line and column. A payload that does not conform is valid: false, not an error.",
	parameters: Schema.Struct({
		payload: Schema.String.annotate({
			description: "The payload file, resolved against the workspace root and refused outside it.",
		}),
		config: Schema.optionalKey(Schema.String.annotate({ description: CONFIG_DESCRIPTION })),
		schema: Schema.optionalKey(
			Schema.String.annotate({
				description:
					"The document: a file path under the workspace root, or an $id or url the config derives. Omitted, the payload's own $schema.",
			}),
		),
	}),
	success: ValidateReport,
	failure: ToolRefusal,
})
	.annotate(Tool.Title, "Validate a payload")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

/**
 * What the process boundary gives the schema tools, and the test seam.
 *
 * @public
 */
export interface SchemaToolOptions {
	/** The server's working directory; omitted, whatever `Path.resolve` takes as current. */
	readonly cwd?: string;
	/** The config module importer; omitted, the engine's `jiti` default. */
	readonly importModule?: SchemaRunDeps["importModule"];
	/** Runs a call with its stdout off the wire, because a config is arbitrary code in this process. */
	readonly confineStdout?: <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

// Each file is replaced atomically, but a build writes several, so a reader between two of them sees a mix of old and
// new across files. The bound is only there because a lane requires one: a walk is local work.
const WALK_TIMEOUT = "2 minutes";

type EngineFailure =
	| Effect.Error<ReturnType<typeof SchemaRun.run>>
	| Effect.Error<ReturnType<typeof SchemaValidate.run>>
	| ExclusiveTimeout;

// The first line of a load failure: a hint such as the install line joins it, and the rest is a stack.
const refusalOf = (error: EngineFailure, root: string, mismatch: VersionMismatch | undefined): ToolRefusal => {
	const refuse = (reason: string, hint: string, suggestedTool?: string): ToolRefusal =>
		ToolRefusal.refuse(
			[
				ToolFailure.truncate(reason, ToolFailure.ENGINE_ECHO_LIMIT),
				...(mismatch !== undefined ? [`Version mismatch: ${mismatch.message}`] : []),
			].join(" "),
			{ hint, ...(suggestedTool !== undefined ? { suggestedTool } : {}) },
		);
	switch (error._tag) {
		case "ConfigNotFoundError":
			return refuse(
				error.message,
				`Add a schemastore.config.ts, or pass config with its path under the workspace root ${root}.`,
			);
		case "ConfigLoadError":
			return refuse(
				`Failed to load schemastore config ${error.path}: ${error.reason.split("\n", 1)[0]}`,
				"Fix the config and call the tool again; it reloads on every call.",
			);
		case "ConflictingFlagsError":
			return refuse(
				`force means drift "allow", so it conflicts with drift "${error.policy}".`,
				"Pass one or the other.",
			);
		case "MissingSchemaRefError":
			return refuse(
				`Payload ${error.path} has no "$schema" property.`,
				"Name the document with the schema parameter: a file path, or an $id or url the config derives.",
			);
		case "ExclusiveTimeout":
			return refuse(error.message, "Documents may be part-written; call the tool to see what differs.", "schema_check");
		default:
			return refuse(error.message, "Fix what the message names and call the tool again.");
	}
};

// Only `$schema` matters here, and anything that fails to read or parse names nothing: the engine then reports the
// payload itself. `readFileString`'s `TextDecoder` has already dropped a leading BOM.
const payloadRef = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ $schema: Schema.String })));

/**
 * The three handlers, closed over the filesystem and path the server was built with, the workspace root found once
 * from `options.cwd`, and one lane.
 *
 * @remarks
 * `schema_build` and `schema_check` load the config OUTSIDE the lane and hand the engine what was loaded. A timed-out
 * lane interrupts its body, and the engine's `Effect.tryPromise` around the import abandons the promise on interrupt,
 * so a load inside would leave a config still evaluating while the next call holds the permit. A hanging config
 * therefore never holds up another call. `schema_validate` stays out: it only reads one document, and each document is
 * replaced atomically, so it sees the old text or the new.
 *
 * @public
 */
export const makeSchemaHandlers = (options: SchemaToolOptions = {}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const cwd = path.resolve(options.cwd ?? ".");
		const root = yield* findRoot(cwd);
		const lane = yield* Exclusive.make;
		const importer = options.importModule !== undefined ? { importModule: options.importModule } : {};

		const within = (label: string, candidate: string) => inside(root, label, candidate);

		// Given, it is held to the root. Otherwise discovery starts where the server did and stops at the root: a config is
		// code, and an agent did not choose one found above the checkout. Relative parameters resolve against the root, so
		// the engine is handed what was found; finding nothing leaves the engine to report it.
		const configOf = (
			config: string | undefined,
		): Effect.Effect<{ readonly config?: string }, ToolRefusal, FileSystem.FileSystem | Path.Path> =>
			config !== undefined
				? Effect.as(within("config", config), { config })
				: Effect.match(ConfigLoader.discover(cwd, root), {
						onFailure: () => ({}),
						onSuccess: (found) => ({ config: found }),
					});

		// `Started` is the only place a warned mismatch survives a later failure, and a refusal must still say it.
		const call = <A, E extends EngineFailure | ToolRefusal>(
			run: (
				onProgress: (event: SchemaProgress) => Effect.Effect<void>,
			) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
		): Effect.Effect<A, ToolRefusal> =>
			Effect.gen(function* () {
				const warned = yield* Ref.make<VersionMismatch | undefined>(undefined);
				return yield* run((event) =>
					event._tag === "Started" && event.versionMismatch !== undefined
						? Ref.set(warned, event.versionMismatch)
						: Effect.void,
				).pipe(
					Effect.catch((error: EngineFailure | ToolRefusal) =>
						error._tag === "ToolRefusal"
							? Effect.fail(error)
							: Effect.gen(function* () {
									yield* Effect.logDebug("schema tool refused", { error: error.message });
									return yield* Effect.fail(refusalOf(error, root, yield* Ref.get(warned)));
								}),
					),
				);
			}).pipe(
				Effect.provideService(FileSystem.FileSystem, fs),
				Effect.provideService(Path.Path, path),
				options.confineStdout ?? ((self) => self),
			);

		const walk = (mode: "build" | "check") => (params: typeof RunParameters.Type) =>
			call((onProgress) =>
				Effect.gen(function* () {
					const scoped = yield* configOf(params.config);
					const loaded = yield* ConfigLoader.load({
						cwd: root,
						ceiling: root,
						...(scoped.config !== undefined ? { explicit: scoped.config } : {}),
						...importer,
					});
					return yield* lane.run(
						SchemaRun.run(
							{
								mode,
								config: loaded.path,
								...(params.drift !== undefined ? { drift: params.drift } : {}),
								...(params.onDrift !== undefined ? { onDrift: params.onDrift } : {}),
								force: params.force ?? false,
								versionMismatch: "warn",
							},
							{
								cwd: root,
								discoveryCeiling: root,
								importModule: () => Promise.resolve(loaded.config),
								onProgress,
								// The injected importer resolves no generator, so the one this load found travels beside it.
								...(loaded.toJsonSchemaDocument !== undefined
									? { toJsonSchemaDocument: loaded.toJsonSchemaDocument }
									: {}),
							},
						),
						{ timeout: WALK_TIMEOUT },
					);
				}),
			);

		return {
			schema_check: walk("check"),
			schema_build: walk("build"),
			schema_validate: (params: typeof schemaValidate.parametersSchema.Type) =>
				call((onProgress) =>
					Effect.gen(function* () {
						yield* within("payload", params.payload);
						// The engine reads the payload's own `$schema` as a path too. Resolving a reference the way the engine
						// does holds a URL-shaped one to the root as well, and passing it on means the one checked is the one used.
						const ref =
							params.schema ??
							Option.getOrUndefined(
								Option.map(
									yield* fs.readFileString(path.resolve(root, params.payload)).pipe(
										Effect.map((text) => payloadRef(text)),
										Effect.orElseSucceed(() => Option.none()),
									),
									(payload) => payload.$schema,
								),
							);
						if (ref !== undefined) yield* within("schema", ref);
						const scoped = yield* configOf(params.config);
						return yield* SchemaValidate.run(
							{
								payload: params.payload,
								...(ref !== undefined ? { schema: ref } : {}),
								...scoped,
								versionMismatch: "warn",
							},
							{ cwd: root, discoveryCeiling: root, ...importer, onProgress },
						);
					}),
				),
		};
	});
