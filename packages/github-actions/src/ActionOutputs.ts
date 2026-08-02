import { Console, Context, Effect, FileSystem, Layer, Schema } from "effect";
import { ActionEnvironment } from "./ActionEnvironment.js";
import { WorkflowCommand } from "./WorkflowCommand.js";

/**
 * Raised when an action cannot publish an output.
 *
 * @public
 */
export class ActionOutputError extends Schema.TaggedErrorClass<ActionOutputError>()("ActionOutputError", {
	/**
	 * `unavailable` — the runner file variable is not set, which usually means
	 * the code is running outside a GitHub runner. `writeFailed` — the file
	 * exists but could not be appended to. `invalidName` — the name would
	 * corrupt the file's block structure. `encodeFailed` — a value did not
	 * satisfy its schema. `detached` — the member was called under
	 * {@link ActionOutputs.layerDetached}, where the channel it writes cannot
	 * reach the job that would read it.
	 */
	reason: Schema.Literals(["unavailable", "writeFailed", "invalidName", "encodeFailed", "detached"]),
	/** Which runner file was involved, by environment variable name. */
	file: Schema.optionalKey(Schema.String),
	/** The output or variable name, when one is involved. */
	name: Schema.optionalKey(Schema.String),
	/** The underlying failure, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		switch (this.reason) {
			case "unavailable":
				return `Runner file "${this.file}" is not available; is this running on a GitHub runner?`;
			case "writeFailed":
				return `Failed to write to runner file "${this.file}"`;
			case "invalidName":
				return `"${this.name}" is not a usable output name`;
			case "detached":
				return `Runner file "${this.file}" cannot be reached from a detached worker — it configures the parent job's later steps, and a worker has none and may outlive the job. Publish this from the parent process instead.`;
			default:
				return `Failed to encode the value for "${this.name}"`;
		}
	}
}

/** The base delimiter for a heredoc block. */
const BASE_DELIMITER = "EFFECTED_EOF";

/**
 * A delimiter guaranteed absent from `value`.
 *
 * @remarks
 * GitHub's own toolkit uses a random UUID here and accepts the (tiny) chance
 * of collision. Deriving the delimiter instead makes collision **impossible**
 * rather than improbable, needs no randomness — so no `Crypto` in `R` and no
 * unreproducible output — and is trivially testable. A value that contains a
 * delimiter would terminate its block early and corrupt every entry after it,
 * which is a value-controlled injection into the runner's own file.
 */
const delimiterFor = (value: string): string => {
	let delimiter = BASE_DELIMITER;
	while (value.includes(delimiter)) {
		delimiter = `${delimiter}_`;
	}
	return delimiter;
};

/** A name that would break the block structure it lives in. */
const isUsableName = (name: string): boolean => name !== "" && !/[\r\n]/.test(name);

/**
 * The {@link ActionOutputs} service shape.
 *
 * @public
 */
export interface ActionOutputsShape {
	/** Publish a step output. */
	readonly set: (name: string, value: string) => Effect.Effect<void, ActionOutputError>;
	/** Publish a step output as JSON, encoded through a schema. */
	readonly setJson: <A, I>(
		name: string,
		value: A,
		schema: Schema.Codec<A, I>,
	) => Effect.Effect<void, ActionOutputError>;
	/** Append to the job summary. */
	readonly summary: (content: string) => Effect.Effect<void, ActionOutputError>;
	/** Export an environment variable to **subsequent** steps. */
	readonly exportVariable: (name: string, value: string) => Effect.Effect<void, ActionOutputError>;
	/**
	 * Prepend a directory to `PATH` for **subsequent** steps.
	 *
	 * @remarks
	 * This appends to the `GITHUB_PATH` runner file and does **nothing else** —
	 * unlike `@actions/core`, it does NOT mutate the live `process.env.PATH` of
	 * the current process. A same-process probe of a tool that was just added
	 * (`pnpm --version`, a shim, a binary) will not find it by name; probe by
	 * absolute path instead. The runner applies the addition when the next step
	 * starts, exactly as it does for {@link ActionOutputsShape.exportVariable}.
	 */
	readonly addPath: (path: string) => Effect.Effect<void, ActionOutputError>;
	/** Emit an error annotation. Does not itself set the exit code. */
	readonly setFailed: (message: string) => Effect.Effect<void>;
	/** Register a value for redaction in the runner log. */
	readonly setSecret: (value: string) => Effect.Effect<void>;
}

const make = Effect.gen(function* () {
	const env = yield* ActionEnvironment;
	const fs = yield* FileSystem.FileSystem;

	const append = (file: string, content: string): Effect.Effect<void, ActionOutputError> =>
		Effect.gen(function* () {
			const path = yield* env
				.get(file)
				.pipe(Effect.mapError(() => new ActionOutputError({ reason: "unavailable", file })));
			yield* fs
				.writeFileString(path, content, { flag: "a" })
				.pipe(Effect.mapError((cause) => new ActionOutputError({ reason: "writeFailed", file, cause })));
		});

	const appendBlock = (file: string, name: string, value: string): Effect.Effect<void, ActionOutputError> => {
		if (!isUsableName(name)) {
			return Effect.fail(new ActionOutputError({ reason: "invalidName", file, name }));
		}
		const delimiter = delimiterFor(value);
		return append(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
	};

	const set = (name: string, value: string) => appendBlock("GITHUB_OUTPUT", name, value);

	return {
		set,
		setJson: <A, I>(name: string, value: A, schema: Schema.Codec<A, I>) =>
			Schema.encodeUnknownEffect(schema)(value).pipe(
				Effect.mapError((cause) => new ActionOutputError({ reason: "encodeFailed", name, cause })),
				Effect.flatMap((encoded) => set(name, JSON.stringify(encoded))),
			),
		summary: (content: string) => append("GITHUB_STEP_SUMMARY", content),
		exportVariable: (name: string, value: string) => appendBlock("GITHUB_ENV", name, value),
		addPath: (path: string) => append("GITHUB_PATH", `${path}\n`),
		setFailed: (message: string) => Console.log(WorkflowCommand.error(message)),
		setSecret: (value: string) => Console.log(WorkflowCommand.addMask(value)),
	} satisfies ActionOutputsShape;
});

const unimplemented = (member: string): never => {
	throw new Error(`ActionOutputs.makeTest: ${member}() was called but not stubbed — pass a \`${member}\` override.`);
};

/**
 * Everything an action publishes: step outputs, exported variables, `PATH`
 * additions, the job summary, log masking and failure annotations.
 *
 * @remarks
 * Outputs and variables go to the runner's **files** (`GITHUB_OUTPUT` and
 * friends); masking and annotations go to stdout as workflow commands, through
 * core `Console` so a test can observe them without a runner.
 *
 * `setFailed` emits the annotation but does **not** set the process exit code
 * — that is `Action.run`'s job, so that an action which reports a failure and
 * then recovers is not silently doomed by a side effect it cannot undo.
 *
 * @public
 */
export class ActionOutputs extends Context.Service<ActionOutputs, ActionOutputsShape>()(
	"@effected/github-actions/ActionOutputs",
) {
	static readonly layer: Layer.Layer<ActionOutputs, never, ActionEnvironment | FileSystem.FileSystem> = Layer.effect(
		this,
		make,
	);

	/**
	 * The outputs surface that is correct inside a **detached worker**.
	 *
	 * @remarks
	 * The masking model assumes the runner parses stdout. A detached worker's
	 * stdout is a **log file no runner parses**, so under the real layer
	 * `setSecret` emits `::add-mask::<plaintext>` into that file — a command
	 * that is simultaneously **inert** (nothing reads it, so nothing is masked)
	 * and a **secret leak** (the plaintext is now sitting verbatim in a log). A
	 * production action shipped exactly that for one round: an S3 secret and
	 * session token written into a worker's log by the masking call itself.
	 * This layer is the worker-side fix; the parent-side rule is that every
	 * secret a worker will hold is masked **before** the spawn, by
	 * `Secret.forChildEnv` under the real layer.
	 *
	 * The layer needs no environment and no filesystem — its `R` is `never` —
	 * so a worker composing it structurally *cannot* write a runner file.
	 * Per-member behavior:
	 *
	 * - **`setSecret` — silent no-op.** The value must not be written
	 *   *anywhere*: there is no runner on this channel to hand it to, and any
	 *   spelling of it in the log IS the leak. Masking is the parent's job,
	 *   before the worker exists.
	 * - **`set`, `setJson`, `exportVariable`, `addPath`, `summary` — fail
	 *   typed** (`reason: "detached"`, naming the file). Each writes a runner
	 *   file that configures the parent job's *later steps* — `GITHUB_OUTPUT`,
	 *   `GITHUB_ENV`, `GITHUB_PATH` — or is collected when the step completes
	 *   (`GITHUB_STEP_SUMMARY`). A detached worker has no later steps, may
	 *   outlive the job entirely, and even an inherited file path would be
	 *   read at a moment unrelated to the write — so a worker calling one of
	 *   these is a program error worth surfacing, not a write to degrade
	 *   silently.
	 * - **`setFailed` — degrades to a plain log line** (`Console.error`,
	 *   without the `::error::` syntax nothing here would parse). Unlike the
	 *   file members it is log-like: "record that something failed" still
	 *   means something in a worker's log, and its signature carries no error
	 *   channel to fail through.
	 */
	static readonly layerDetached: Layer.Layer<ActionOutputs> = Layer.succeed(this, {
		set: (name) => Effect.fail(new ActionOutputError({ reason: "detached", file: "GITHUB_OUTPUT", name })),
		setJson: (name) => Effect.fail(new ActionOutputError({ reason: "detached", file: "GITHUB_OUTPUT", name })),
		summary: () => Effect.fail(new ActionOutputError({ reason: "detached", file: "GITHUB_STEP_SUMMARY" })),
		exportVariable: (name) => Effect.fail(new ActionOutputError({ reason: "detached", file: "GITHUB_ENV", name })),
		addPath: () => Effect.fail(new ActionOutputError({ reason: "detached", file: "GITHUB_PATH" })),
		setFailed: (message) => Console.error(message),
		setSecret: () => Effect.void,
	} satisfies ActionOutputsShape);

	/** A test double. Unstubbed members die rather than silently succeeding. */
	static readonly makeTest = (overrides: Partial<ActionOutputsShape> = {}): ActionOutputsShape => ({
		set: () => Effect.sync(() => unimplemented("set")),
		setJson: () => Effect.sync(() => unimplemented("setJson")),
		summary: () => Effect.sync(() => unimplemented("summary")),
		exportVariable: () => Effect.sync(() => unimplemented("exportVariable")),
		addPath: () => Effect.sync(() => unimplemented("addPath")),
		setFailed: () => Effect.sync(() => unimplemented("setFailed")),
		setSecret: () => Effect.sync(() => unimplemented("setSecret")),
		...overrides,
	});

	/** {@link ActionOutputs.makeTest} behind `Layer.succeed`. */
	static readonly layerTest = (overrides: Partial<ActionOutputsShape> = {}): Layer.Layer<ActionOutputs> =>
		Layer.succeed(ActionOutputs, ActionOutputs.makeTest(overrides));
}
