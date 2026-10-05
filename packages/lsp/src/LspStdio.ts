import { Cause, Effect, Exit, References, Runtime } from "effect";
import { LaunchFailed } from "./internal/LaunchFailed.js";

/**
 * How a Language Server session ended, as the server's own message loop
 * observed it. {@link LspStdio.exitCode} maps it to the exit code the LSP
 * specification requires.
 *
 * @remarks
 * The kit does not own the message loop, so it cannot observe `shutdown` or
 * `exit` itself: the server's loop records them and returns this value when
 * it stops reading. A `vscode-languageserver` connection reports both through
 * its `onShutdown` and `onExit` handlers; a hand-rolled loop sees the methods
 * directly.
 *
 * @public
 */
export interface LspSessionEnd {
	/**
	 * `"exit"`: the client sent the `exit` notification. `"closed"`: stdin
	 * ended with no `exit` among the messages it delivered.
	 */
	readonly reason: "exit" | "closed";
	/** Whether a `shutdown` request arrived before the session ended. */
	readonly shutdownReceived: boolean;
}

/**
 * What {@link LspStdio.teardown} needs from the host: a way to end the
 * process with a code. Node's `process` satisfies it.
 *
 * @public
 */
export interface LspExitHost {
	/** End the process with `code`. */
	readonly exit: (code: number) => void;
}

/**
 * Run an Effect Language Server over stdio without ever writing a log line or
 * a failure report onto stdout, which is the LSP wire, and exit with the code
 * the LSP specification requires.
 *
 * @remarks
 * The `main.ts`, where `serve` is the server's own program and returns an
 * {@link LspSessionEnd} when its message loop stops:
 *
 * ```ts
 * NodeRuntime.runMain(LspStdio.launch(serve.pipe(Effect.provide(AppLayer))), { teardown: LspStdio.teardown(process) })
 * ```
 *
 * - {@link LspStdio.launch} provides `LogToStderr` to the whole program, and
 *   reports a failure itself, on stderr, hiding it from `runMain`, whose own
 *   report is written outside anything the program can provide. A layer that
 *   fails to build (a missing `HOME`, a bad config) is such a failure.
 * - {@link LspStdio.exitCode} is the specification's rule: `exit` without a
 *   prior `shutdown` exits 1, everything else 0. `launch` applies it to the
 *   program's result.
 * - {@link LspStdio.teardown} keeps that code, maps an interrupt-only exit
 *   (SIGINT, SIGTERM) to 0 instead of 130, and ends the process explicitly:
 *   with stdin still open, as the specification leaves it after `exit`, the
 *   event loop never drains on its own.
 *
 * Never `NodeRuntime.runMain(serve.pipe(Effect.provide(Layer.succeed(References.LogToStderr, true))))`:
 * it typechecks and serves, but a failure is still reported by `runMain`
 * through `console.log`, straight onto the wire, where the client reads it as
 * a malformed frame instead of an error.
 *
 * This is not an LSP framework: the message loop, `initialize` and every
 * request handler stay with whatever the server is built on.
 *
 * @public
 */
export class LspStdio {
	private constructor() {}

	/**
	 * The specification's exit code for a session: 1 when `exit` arrived
	 * without a prior `shutdown`, otherwise 0.
	 *
	 * @remarks
	 * A session whose stdin closed without `exit` (`"closed"`) is a client
	 * disconnect the specification gives no code for; it maps to 0, with or
	 * without `shutdown`.
	 */
	static exitCode(end: LspSessionEnd): 0 | 1 {
		return end.reason === "exit" && !end.shutdownReceived ? 1 : 0;
	}

	/**
	 * Run `program` with `LogToStderr` set, map its {@link LspSessionEnd} to
	 * an exit code with {@link LspStdio.exitCode}, and report any failure
	 * other than an interrupt on stderr here, re-raising it marked as already
	 * reported and keeping its exit code.
	 *
	 * @remarks
	 * `runMain` logs an unhandled failure from outside the program, where no
	 * `Effect.provide` the program applies reaches, and Effect's default logger
	 * writes through `console.log` unless `LogToStderr` is set. For a Language
	 * Server that is stdout, the wire. `launch` catches the cause inside its
	 * own `LogToStderr` provision, logs it there, and fails with an error
	 * `runMain` does not report again, whose `Runtime.errorExitCode` is the
	 * original failure's (1 unless it carries its own).
	 *
	 * `LogToStderr` reaches every logger that honours it: Effect's default
	 * logger and `Logger.consolePretty`. `Logger.consoleJson`,
	 * `Logger.consoleLogFmt` and `Logger.consoleStructured` write through
	 * `console.log` whatever it says; wrap a formatter in
	 * `Logger.withConsoleError` instead. `Console.log` is not a logger and
	 * still writes to stdout.
	 *
	 * The success value is the exit code; pair `launch` with
	 * {@link LspStdio.teardown}, which hands it to `runMain` and ends the
	 * process with it.
	 */
	static readonly launch = <E, R>(program: Effect.Effect<LspSessionEnd, E, R>): Effect.Effect<0 | 1, Error, R> =>
		program.pipe(
			Effect.map(LspStdio.exitCode),
			Effect.catchCause((cause) =>
				Cause.hasInterruptsOnly(cause)
					? // An interrupt-only cause holds no Fail reason, so no E can escape through it.
						Effect.failCause(cause as Cause.Cause<never>)
					: Effect.logError(cause).pipe(
							Effect.andThen(Effect.fail(new LaunchFailed(Runtime.getErrorExitCode(Cause.squash(cause))))),
						),
			),
			Effect.provideService(References.LogToStderr, true),
		);

	/**
	 * The teardown for `runMain`: a success hands its value on as the exit
	 * code when it is a number (0 otherwise), an interrupt-only exit maps to 0,
	 * and anything else goes to `Runtime.defaultTeardown`; then `host.exit`
	 * ends the process with that code.
	 *
	 * @remarks
	 * SIGINT and SIGTERM interrupt the program, and both exit 0 here, not the
	 * 130 a default teardown reports.
	 *
	 * The explicit exit is the point. The specification makes the server
	 * terminate on `exit` with stdin still open, but `runMain` ends the process
	 * itself only for a non-zero code or a signal, and leaves a code-0 exit to
	 * the event loop draining. It never drains while stdin is open: a server
	 * reading stdin through `NodeStdio` sits until the client closes the pipe
	 * (probed), which an editor never does first. Any other handle the server
	 * does not own holds it the same way, such as the client-liveness interval
	 * `vscode-languageserver`'s node entry installs under `--clientProcessId`.
	 *
	 * `host` is the process: `LspStdio.teardown(process)`. The package never
	 * reads `process` itself. A non-zero code is ended by `runMain` before
	 * `host.exit` is reached.
	 */
	static teardown(host: LspExitHost): Runtime.Teardown {
		return (exit, onExit) => {
			const code = Exit.isSuccess(exit)
				? typeof exit.value === "number"
					? exit.value
					: 0
				: Cause.hasInterruptsOnly(exit.cause)
					? 0
					: undefined;
			const finish = (resolved: number): void => {
				onExit(resolved);
				host.exit(resolved);
			};
			return code === undefined ? Runtime.defaultTeardown(exit, finish) : finish(code);
		};
	}
}
