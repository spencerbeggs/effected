import { Cause, Console, Context, Effect, Layer, MutableRef, Predicate } from "effect";
import { Fmt } from "./Fmt.js";
import { isExitCode } from "./internal/isExitCode.js";

/**
 * The shape behind {@link CliExit}.
 *
 * @public
 */
export interface CliExitShape {
	/** The highest exit code recorded during the run; `0` until one is set. */
	readonly code: MutableRef.MutableRef<number>;
}

/**
 * The exit code a successful run wants, for commands whose findings are a
 * result rather than a failure (a linter that found problems, say).
 *
 * @remarks
 * Findings are not a failure — a JSON `tapError` must not fire, and the
 * handler must return normally — yet the process must exit non-zero. Writing
 * `process.exitCode` works only because Node's `runMain` skips
 * `process.exit(0)` on success; `process.exit(n)` in a handler skips every
 * finalizer. `CliRuntime.main` reads this cell after the program
 * succeeds and turns a non-zero code into a marked failure the runtime's
 * teardown honours, on any runtime, with finalizers intact.
 *
 * A `Service`, not a `Reference`: forgetting `CliRuntime.main` is a type error,
 * never a silently ignored global.
 *
 * @public
 */
export class CliExit extends Context.Service<CliExit, CliExitShape>()("@effected/cli-kit/CliExit") {
	/**
	 * A fresh cell at `0`; `CliRuntime.main` provides it, and tests provide it
	 * directly.
	 *
	 * @remarks
	 * Every provide mints a new cell. Layers memoize by reference across
	 * `Effect.provide` calls, so without `Layer.fresh` a second provide of this
	 * layer anywhere in the program — a nested `CliRuntime.main`, a test
	 * helper — would silently share the first run's cell and inherit its code.
	 *
	 * A program run under `CliRuntime.main` must NOT provide `CliExit.layer`
	 * itself: `main` already provides one, and a second provide mints a second,
	 * unrelated cell that `main` never reads back, so `CliExit.set` calls made
	 * against it are silently discarded and the run exits `0`.
	 */
	static readonly layer: Layer.Layer<CliExit> = Layer.fresh(Layer.sync(this, () => ({ code: MutableRef.make(0) })));

	/**
	 * Record an exit code; the highest code set during the run wins.
	 *
	 * @remarks
	 * Highest-wins, not last-wins, so a later "clean" step cannot quietly
	 * downgrade an earlier finding's code.
	 *
	 * The code must be an integer in `0..255` — the range a POSIX exit status
	 * can carry. Anything else dies as a defect naming the value: `256` would
	 * wrap to exit `0` and silently pass a run with findings, and a fraction
	 * such as `1.5` makes `process.exit` throw `ERR_OUT_OF_RANGE` after the
	 * program has finished.
	 *
	 * The code only applies to a run that **succeeds**. A program failure beats
	 * findings: when the program fails, `CliRuntime.main` never reads this
	 * cell, and the failure's own exit code (or the `exitCode` fallback) wins.
	 */
	static readonly set = (code: number): Effect.Effect<void, never, CliExit> =>
		Effect.gen(function* () {
			if (!isExitCode(code)) {
				return yield* Effect.die(new Error(`CliExit.set: exit code must be an integer 0..255, received ${code}`));
			}
			const exit = yield* CliExit;
			if (code > MutableRef.get(exit.code)) MutableRef.set(exit.code, code);
		});

	/**
	 * Write one line to stderr, record an exit code, and succeed: the shape of a
	 * hook-style command that must say why it exits non-zero without failing.
	 *
	 * @remarks
	 * This does **not** stop the program. It succeeds, so the caller must still
	 * return (or otherwise end its own flow) after calling it; finalizers and log
	 * sinks run as they would on any successful run, and `CliRuntime.main` turns
	 * the recorded code into the exit.
	 *
	 * The code is validated first, exactly as {@link CliExit.set} validates it, and
	 * an invalid code dies as the same defect before anything is written. The
	 * line goes through `Console.error`, never stdout, and is written as given:
	 * sanitize anything you do not control with `Fmt.sanitize` first. The
	 * highest code recorded during the run wins.
	 */
	static readonly report = (code: number, line: string): Effect.Effect<void, never, CliExit> =>
		Effect.gen(function* () {
			yield* CliExit.set(code);
			yield* Console.error(line);
		});

	/**
	 * Report a failure cause as one stderr line, record the exit code the caller
	 * chooses for it, and succeed.
	 *
	 * @remarks
	 * The cause is squashed and the line is `<code> <tag>: <message>`, or
	 * `<code> <message>` when the error has no string `_tag`. The message comes
	 * from `Fmt.errorText` and is sanitized with `Fmt.sanitize` and its line breaks
	 * become a space, so a hostile error can neither throw, write an escape nor
	 * forge a second line. Reading `_tag` is guarded
	 * too: a getter that throws means no tag.
	 *
	 * An interrupt-only cause is not a failure to report: nothing is written or
	 * recorded and the effect re-interrupts. `codeOf` receives the squashed error
	 * and must return an integer in `0..255`; anything else dies as
	 * {@link CliExit.set} does, which is wiring.
	 *
	 * Like {@link CliExit.report} it does not stop the program: the caller still
	 * has to return.
	 */
	static readonly reportCause = <E>(
		cause: Cause.Cause<E>,
		codeOf: (error: unknown) => number,
	): Effect.Effect<void, never, CliExit> =>
		Cause.hasInterruptsOnly(cause)
			? Effect.interrupt
			: Effect.suspend(() => {
					const error = Cause.squash(cause);
					const code = codeOf(error);
					let tag: string | undefined;
					try {
						const read = Predicate.hasProperty(error, "_tag") ? error._tag : undefined;
						tag = Predicate.isString(read) ? read : undefined;
					} catch {
						// A throwing `_tag` getter means no tag.
					}
					// `Fmt.sanitize` keeps line breaks, so a message could otherwise forge a second stderr line.
					const oneLine = (text: string) => Fmt.sanitize(text).replace(/\r?\n|\r/gu, " ");
					const message = oneLine(Fmt.errorText(error));
					return CliExit.report(code, tag === undefined ? `${code} ${message}` : `${code} ${oneLine(tag)}: ${message}`);
				});
}
