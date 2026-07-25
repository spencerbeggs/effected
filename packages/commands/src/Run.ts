import type { Duration, Redacted } from "effect";
import { Effect, PlatformError, Schema, Stdio, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { OutputTooLarge, collectBounded } from "./internal/capture.js";
import { REDACTED, Redaction } from "./Redaction.js";

/**
 * Default ceiling on captured bytes per stream (16 MiB).
 *
 * @remarks
 * Collecting a child's output without a bound is a memory-exhaustion vector.
 * Output genuinely larger than this belongs on {@link Run.stream}, which never
 * accumulates.
 *
 * @public
 */
export const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Characters shown from the tail of captured output in an error message. */
const MAX_MESSAGE_CHARS = 2000;

/**
 * Policy for one run.
 *
 * @remarks
 * Deliberately narrow. Working directory, environment, stdin, shell mode and
 * kill signals are all `ChildProcess.CommandOptions` fields with core
 * combinators (`ChildProcess.setCwd`, `ChildProcess.setEnv`) — this package
 * consumes core's command vocabulary rather than re-declaring it. What remains
 * here is what a `Command` value cannot express.
 *
 * @public
 */
export interface RunOptions {
	/**
	 * Ceiling for the whole run.
	 *
	 * @remarks
	 * **There is no default.** A package-manager install and a `git rev-parse`
	 * cannot share one, so an unset `timeout` means no ceiling. When set, expiry
	 * closes the run's scope (killing the child) and fails with
	 * {@link CommandFailedError} of kind `"timeout"` rather than core's
	 * `TimeoutError`, so a caller's error channel stays this package's taxonomy.
	 */
	readonly timeout?: Duration.Input | undefined;
	/**
	 * Values scrubbed from captured output and from any error this run raises.
	 *
	 * @remarks
	 * Matching is by exact value, so a secret is removed wherever it appears —
	 * whichever flag carried it, and inside a larger string. The flag heuristic
	 * in {@link Redaction.scrubArgs} runs in addition, never instead.
	 */
	readonly redact?: ReadonlyArray<Redacted.Redacted<string>> | undefined;
	/** Per-stream captured-byte ceiling. Defaults to {@link DEFAULT_MAX_OUTPUT_BYTES}. */
	readonly maxOutputBytes?: number | undefined;
}

/**
 * What one completed run produced.
 *
 * @public
 */
export class CommandOutput extends Schema.Class<CommandOutput>("CommandOutput")({
	/** Captured standard output, redacted. */
	stdout: Schema.String,
	/** Captured standard error, redacted. */
	stderr: Schema.String,
	/** The process exit code. A non-zero value is NOT an error at this level. */
	exitCode: Schema.Number,
}) {
	/** Whether the process exited zero. */
	get succeeded(): boolean {
		return this.exitCode === 0;
	}
}

/** The executable and argv an error should report for `command`. */
const describeCommand = (command: ChildProcess.Command): { command: string; args: ReadonlyArray<string> } => {
	if (ChildProcess.isStandardCommand(command)) {
		return { command: command.command, args: command.args };
	}
	const left = describeCommand(command.left);
	const right = describeCommand(command.right);
	// A pipeline has no single argv; report the shape so the message still names
	// what ran, with both sides' arguments dropped rather than merged.
	return { command: `${left.command} | ${right.command}`, args: [] };
};

/** argv as an error should store it: declared secrets removed, then the flag heuristic. */
const safeArgs = (
	args: ReadonlyArray<string>,
	secrets: ReadonlyArray<Redacted.Redacted<string>> | undefined,
): ReadonlyArray<string> => Redaction.scrubArgs(Redaction.applyArgs(args, secrets ?? []));

/** Captured text as an error should store it. */
const safeText = (text: string, secrets: ReadonlyArray<Redacted.Redacted<string>> | undefined): string =>
	Redaction.apply(text, secrets ?? []);

/** Tail-bounded rendering: tools write warnings first and the real error last. */
const tail = (text: string): string => {
	const trimmed = text.trim();
	if (trimmed.length <= MAX_MESSAGE_CHARS) return trimmed;
	return `...[${trimmed.length - MAX_MESSAGE_CHARS} chars truncated from head]...\n${trimmed.slice(-MAX_MESSAGE_CHARS)}`;
};

/**
 * A command that could not be run, or that ran and failed.
 *
 * @remarks
 * `kind` is the routing surface, never the message: `"nonZero"` (the process
 * ran and exited non-zero), `"spawn"` (it never started — the executable is
 * missing, or the platform refused), `"timeout"` (a caller-supplied ceiling
 * elapsed). Composed retry and fallback logic branches on `kind`; nothing in
 * this package asks a caller to match on prose.
 *
 * `args` is **always** stored redacted.
 *
 * @public
 */
export class CommandFailedError extends Schema.TaggedErrorClass<CommandFailedError>()("CommandFailedError", {
	/** Why it failed. */
	kind: Schema.Literals(["nonZero", "spawn", "timeout"]),
	/** The executable (or `"a | b"` for a pipeline). */
	command: Schema.String,
	/** argv, redacted. */
	args: Schema.Array(Schema.String),
	/** The exit code, when the process ran. */
	exitCode: Schema.optionalKey(Schema.Number),
	/** Captured standard error, redacted, when the process ran. */
	stderr: Schema.optionalKey(Schema.String),
	/** Captured standard output, redacted, when the process ran. */
	stdout: Schema.optionalKey(Schema.String),
	/** The absorbed platform failure, for `"spawn"`. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	/** The process ran and exited non-zero. */
	static readonly nonZero = (
		command: ChildProcess.Command,
		output: CommandOutput,
		secrets?: ReadonlyArray<Redacted.Redacted<string>> | undefined,
	): CommandFailedError => {
		const described = describeCommand(command);
		return new CommandFailedError({
			kind: "nonZero",
			command: described.command,
			args: safeArgs(described.args, secrets),
			exitCode: output.exitCode,
			stderr: output.stderr,
			stdout: output.stdout,
		});
	};

	/** The process never started. */
	static readonly spawn = (
		command: ChildProcess.Command,
		cause: PlatformError.PlatformError,
		secrets?: ReadonlyArray<Redacted.Redacted<string>> | undefined,
	): CommandFailedError => {
		const described = describeCommand(command);
		return new CommandFailedError({
			kind: "spawn",
			command: described.command,
			args: safeArgs(described.args, secrets),
			cause,
		});
	};

	/** A caller-supplied ceiling elapsed; the child was killed with its scope. */
	static readonly timedOut = (
		command: ChildProcess.Command,
		secrets?: ReadonlyArray<Redacted.Redacted<string>> | undefined,
	): CommandFailedError => {
		const described = describeCommand(command);
		return new CommandFailedError({
			kind: "timeout",
			command: described.command,
			args: safeArgs(described.args, secrets),
		});
	};

	/**
	 * Whether this is a spawn failure caused by the executable not existing —
	 * the structural "tool is not installed" signal.
	 */
	get notFound(): boolean {
		return (
			this.kind === "spawn" &&
			this.cause instanceof PlatformError.PlatformError &&
			this.cause.reason._tag === "NotFound"
		);
	}

	/** Names the command and surfaces the tail of whichever stream carries the cause. */
	override get message(): string {
		const rendered = this.args.length > 0 ? `${this.command} ${this.args.join(" ")}` : this.command;
		const parts = [`Command "${rendered}" failed`];
		if (this.kind === "timeout") parts.push("(timed out)");
		if (this.exitCode !== undefined) parts.push(`(exit ${this.exitCode})`);
		// Prefer stderr; fall back to stdout, because npm and friends route real
		// errors there often enough that dropping it hides causes.
		const stream = this.stderr?.trim() ? this.stderr : this.stdout?.trim() ? this.stdout : undefined;
		if (stream !== undefined) parts.push(`:\n${tail(stream)}`);
		return parts.join(" ");
	}
}

/**
 * A command ran, but its output could not be used.
 *
 * @remarks
 * Separate from {@link CommandFailedError} because the process itself
 * succeeded: `"notJson"` (stdout is not JSON), `"schema"` (it is JSON but does
 * not decode), `"tooLarge"` (capture exceeded its byte budget). Keeping the two
 * distinguishable is the point — a schema drift and a crashed tool call for
 * different responses.
 *
 * @public
 */
export class CommandOutputError extends Schema.TaggedErrorClass<CommandOutputError>()("CommandOutputError", {
	/** Which way the output was unusable. */
	kind: Schema.Literals(["notJson", "schema", "tooLarge"]),
	/** The executable that produced it. */
	command: Schema.String,
	/** The underlying parse or decode failure. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		if (this.kind === "notJson") {
			return `Command "${this.command}" did not produce JSON`;
		}
		if (this.kind === "schema") {
			return `Command "${this.command}" produced JSON that did not match the expected schema`;
		}
		return `Command "${this.command}" produced more output than the configured limit`;
	}
}

/** Spawns, collects both streams concurrently, and awaits exit. */
const collectRaw = (
	command: ChildProcess.Command,
	options: RunOptions | undefined,
	tee: Stdio.Stdio | undefined,
): Effect.Effect<
	CommandOutput,
	PlatformError.PlatformError | OutputTooLarge,
	ChildProcessSpawner.ChildProcessSpawner
> =>
	Effect.scoped(
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const handle = yield* spawner.spawn(command);
			const limit = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
			const out = tee === undefined ? handle.stdout : Stream.tapSink(handle.stdout, tee.stdout());
			const err = tee === undefined ? handle.stderr : Stream.tapSink(handle.stderr, tee.stderr());
			// { concurrency: "unbounded" } is load-bearing, not a style choice:
			// reading these sequentially deadlocks the moment either OS pipe
			// buffer fills — the child blocks writing to a full pipe while the
			// reader that would drain it is still waiting on the other stream.
			const [stdout, stderr, exitCode] = yield* Effect.all(
				[collectBounded(out, limit), collectBounded(err, limit), handle.exitCode],
				{ concurrency: "unbounded" },
			);
			const secrets = options?.redact;
			return CommandOutput.make({
				stdout: safeText(stdout, secrets),
				stderr: safeText(stderr, secrets),
				exitCode: Number(exitCode),
			});
		}),
	);

/** Maps the raw failure modes onto this package's taxonomy, and applies any ceiling. */
const collectClassified = (
	command: ChildProcess.Command,
	options: RunOptions | undefined,
	tee: Stdio.Stdio | undefined,
): Effect.Effect<CommandOutput, CommandFailedError | CommandOutputError, ChildProcessSpawner.ChildProcessSpawner> => {
	const described = describeCommand(command);
	const classified = collectRaw(command, options, tee).pipe(
		Effect.catch((error) =>
			Effect.fail(
				error instanceof OutputTooLarge
					? new CommandOutputError({ kind: "tooLarge", command: described.command, cause: error })
					: CommandFailedError.spawn(command, error, options?.redact),
			),
		),
	);
	return options?.timeout === undefined
		? classified
		: Effect.timeoutOrElse(classified, {
				duration: options.timeout,
				orElse: () => Effect.fail(CommandFailedError.timedOut(command, options.redact)),
			});
};

/** Fails a run whose process exited non-zero. */
const requireZero = (
	command: ChildProcess.Command,
	output: CommandOutput,
	options: RunOptions | undefined,
): Effect.Effect<CommandOutput, CommandFailedError> =>
	output.succeeded ? Effect.succeed(output) : Effect.fail(CommandFailedError.nonZero(command, output, options?.redact));

/** Span attributes: what ran and how many arguments — never the arguments. */
const annotate = (command: ChildProcess.Command): Effect.Effect<void> => {
	const described = describeCommand(command);
	return Effect.annotateCurrentSpan({ command: described.command, argc: described.args.length });
};

const collect = Effect.fn("Run.collect")(function* (command: ChildProcess.Command, options?: RunOptions) {
	yield* annotate(command);
	return yield* collectClassified(command, options, undefined);
});

const collectTee = Effect.fn("Run.collectTee")(function* (command: ChildProcess.Command, options?: RunOptions) {
	yield* annotate(command);
	const stdio = yield* Stdio.Stdio;
	return yield* collectClassified(command, options, stdio);
});

const text = Effect.fn("Run.text")(function* (command: ChildProcess.Command, options?: RunOptions) {
	yield* annotate(command);
	const output = yield* collectClassified(command, options, undefined);
	const checked = yield* requireZero(command, output, options);
	return checked.stdout.trim();
});

const lines = Effect.fn("Run.lines")(function* (command: ChildProcess.Command, options?: RunOptions) {
	yield* annotate(command);
	const output = yield* collectClassified(command, options, undefined);
	const checked = yield* requireZero(command, output, options);
	return checked.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
});

const json = Effect.fn("Run.json")(function* <A, I>(
	command: ChildProcess.Command,
	schema: Schema.Codec<A, I>,
	options?: RunOptions,
) {
	yield* annotate(command);
	const described = describeCommand(command);
	const output = yield* collectClassified(command, options, undefined);
	const checked = yield* requireZero(command, output, options);
	const parsed = yield* Effect.try({
		try: () => JSON.parse(checked.stdout) as unknown,
		catch: (cause) => new CommandOutputError({ kind: "notJson", command: described.command, cause }),
	});
	return yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(
		Effect.catch((cause) => Effect.fail(new CommandOutputError({ kind: "schema", command: described.command, cause }))),
	);
});

const exitCode = Effect.fn("Run.exitCode")(function* (command: ChildProcess.Command, options?: RunOptions) {
	yield* annotate(command);
	const output = yield* collectClassified(command, options, undefined);
	return output.exitCode;
});

const succeeds = Effect.fn("Run.succeeds")(function* (command: ChildProcess.Command, options?: RunOptions) {
	yield* annotate(command);
	return yield* collectClassified(command, options, undefined).pipe(
		Effect.map((output) => output.succeeded),
		Effect.catch(() => Effect.succeed(false)),
	);
});

const detach = Effect.fn("Run.detach")(function* (command: ChildProcess.Command) {
	yield* annotate(command);
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const handle = yield* spawner.spawn(command);
			// Order is the whole point of this helper: the Node backend's release
			// checks an `isReferenced` flag and does NOT kill an unref'd child, so
			// unref must run BEFORE this scope closes. Reversed, the child dies
			// with the scope and nothing outlives the process.
			yield* handle.unref;
			return handle.pid;
		}),
	).pipe(Effect.catch((error) => Effect.fail(CommandFailedError.spawn(command, error))));
});

/** Decoded stdout lines as they arrive, for output too large or too long-lived to collect. */
const stream = (
	command: ChildProcess.Command,
	options?: { readonly includeStderr?: boolean | undefined },
): Stream.Stream<string, CommandFailedError, ChildProcessSpawner.ChildProcessSpawner> =>
	Stream.unwrap(
		Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
			spawner.streamLines(command, { includeStderr: options?.includeStderr ?? false }),
		),
	).pipe(Stream.mapError((error) => CommandFailedError.spawn(command, error)));

/**
 * Structured running of core `ChildProcess.Command` values.
 *
 * @remarks
 * These are free functions over core's contract, **not** a service: core's
 * `ChildProcessSpawner` already is the subprocess service, and wrapping it in a
 * second one is the re-declaration this package exists not to repeat. Tests
 * stub the spawner (`ChildProcessSpawner.make(mockSpawn)`), not these.
 *
 * A non-zero exit is a *result* for {@link Run.collect}, {@link Run.exitCode}
 * and {@link Run.succeeds}, and a typed *failure* for {@link Run.text},
 * {@link Run.lines} and {@link Run.json} — the split is deliberate, matching
 * core (where a non-zero exit is a success) at the reporting level while giving
 * the interpreting helpers the ergonomics callers actually want.
 *
 * @public
 */
export const Run = {
	collect,
	collectTee,
	text,
	lines,
	json,
	exitCode,
	succeeds,
	stream,
	detach,
	DEFAULT_MAX_OUTPUT_BYTES,
	REDACTED,
} as const;
