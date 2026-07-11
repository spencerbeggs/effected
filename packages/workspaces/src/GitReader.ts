// The subprocess seam.
//
// Effect v4 core ships NO `Command` / `CommandExecutor` — `Stdio` is the
// current process's own streams, not process spawning — so the v3
// `@effect/platform` dependency has no core successor. Taking
// `@effect/platform-node` as a runtime dependency would push a platform adapter
// into every consumer's tree, which is exactly the escape the peer discipline
// exists to prevent.
//
// So the seam is owned here: a small contract, a Node default layer, and a
// `Layer.succeed` mock in tests. That is also what makes `ChangeDetector`
// testable without a git repository, which the v3 library was not.

import { execFile } from "node:child_process";
import { Context, Duration, Effect, Layer, Schema } from "effect";

/**
 * Raised when a git invocation cannot be run, or runs and fails.
 *
 * @remarks
 * `kind` is the discriminant: `"unavailable"` means git is not installed or the
 * directory is not a repository — a *precondition* failure a caller can degrade
 * on; `"failed"` means git ran and returned non-zero, which usually means a bad
 * ref. `stderr` carries git's own diagnostic, captured under `LC_ALL=C` so the
 * text is stable across locales.
 *
 * This one error replaces v3's `GitNotAvailableError` / `GitReadError` pair,
 * whose distinction the review found subtle enough to need a remarks block.
 *
 * @public
 */
export class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()("GitCommandError", {
	/** Whether git could not be run at all, or ran and failed. */
	kind: Schema.Literals(["unavailable", "failed"]),
	/** The argument vector, without the leading `git`. */
	args: Schema.Array(Schema.String),
	/** The working directory the command ran in. */
	cwd: Schema.String,
	/** git's exit code, when it produced one. */
	exitCode: Schema.optionalKey(Schema.Number),
	/** git's stderr, trimmed. */
	stderr: Schema.String,
}) {
	/** Renders the invocation and its failure into a one-line message. */
	override get message(): string {
		return `git ${this.args.join(" ")} ${this.kind === "unavailable" ? "could not be run" : "failed"} in ${this.cwd}`;
	}
}

/**
 * Runs git commands.
 *
 * @remarks
 * A contract, not an implementation detail: {@link GitReader.layerNode} is the
 * shipped default over `node:child_process`, and a consumer on Bun or Deno — or
 * a test that wants a deterministic repository — swaps it with
 * `Layer.succeed(GitReader, { … })`.
 *
 * @public
 */
export class GitReader extends Context.Service<
	GitReader,
	{
		/**
		 * Run `git <args>` in `cwd` and return trimmed stdout.
		 *
		 * @param cwd - The working directory.
		 * @param args - The argument vector, without the leading `git`.
		 */
		readonly run: (cwd: string, args: ReadonlyArray<string>) => Effect.Effect<string, GitCommandError>;
		/** Whether `cwd` is inside a git repository and git can be run at all. */
		readonly available: (cwd: string) => Effect.Effect<boolean>;
	}
>()("@effected/workspaces/GitReader") {
	/**
	 * The Node default: `node:child_process.execFile`, locale-pinned so stderr
	 * classification is stable, with a per-command timeout so a hung git never
	 * hangs the caller.
	 *
	 * @remarks
	 * Node-only, and honestly so. It is the one place in the package that spawns
	 * a process.
	 */
	static readonly layerNode: Layer.Layer<GitReader> = Layer.succeed(GitReader, {
		run: (cwd: string, args: ReadonlyArray<string>) =>
			// `Effect.callback` is v4's `Effect.async`. Returning a finalizer effect
			// is what makes an interrupted caller actually kill the child process.
			Effect.callback<string, GitCommandError>((resume) => {
				const child = execFile(
					"git",
					[...args],
					{
						cwd,
						// LC_ALL=C pins git's diagnostics to English so `stderr` means the
						// same thing on every machine.
						env: { ...process.env, LC_ALL: "C" },
						timeout: Duration.toMillis(GIT_TIMEOUT),
						maxBuffer: 32 * 1024 * 1024,
					},
					(error, stdout, stderr) => {
						if (error === null) {
							resume(Effect.succeed(stdout.trim()));
							return;
						}
						const code = (error as NodeJS.ErrnoException & { readonly code?: number | string }).code;
						// ENOENT means the git binary itself is missing — a precondition
						// failure, not a command failure.
						const unavailable = code === "ENOENT";
						resume(
							Effect.fail(
								new GitCommandError({
									kind: unavailable ? "unavailable" : "failed",
									args,
									cwd,
									...(typeof code === "number" ? { exitCode: code } : {}),
									stderr: stderr.trim(),
								}),
							),
						);
					},
				);
				return Effect.sync(() => {
					child.kill();
				});
			}),

		available: (cwd: string) =>
			Effect.callback<boolean>((resume) => {
				const child = execFile(
					"git",
					["rev-parse", "--git-dir"],
					{ cwd, env: { ...process.env, LC_ALL: "C" }, timeout: Duration.toMillis(GIT_TIMEOUT) },
					(error) => {
						resume(Effect.succeed(error === null));
					},
				);
				return Effect.sync(() => {
					child.kill();
				});
			}),
	});
}

/** Per-command ceiling. A git that has not answered in 30s is not going to. */
const GIT_TIMEOUT = Duration.seconds(30);
