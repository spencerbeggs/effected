import type { Scope } from "effect";
import { Effect, Option, Schema } from "effect";

/**
 * The working-directory half of a process, structurally. Node's `process`
 * satisfies it; pass it in, so nothing here reads `process` itself.
 *
 * @public
 */
export interface ProcessCwdHost {
	/** The current working directory. May throw when it was deleted (`ENOENT`). */
	cwd(): string;
	/** Changes the working directory. Throws when `directory` cannot be entered. */
	chdir(directory: string): void;
}

/**
 * A {@link ProcessScope} change could not be made.
 *
 * @remarks
 * Audience: calling code (`reason`, `path`) and an end user (`message`).
 * `"ChdirFailed"` means `chdir` threw for `path`; the original throw is
 * `cause`. Nothing was changed, so nothing is restored.
 *
 * @public
 */
export class ProcessScopeError extends Schema.TaggedError<ProcessScopeError>()("ProcessScopeError", {
	reason: Schema.Literal("ChdirFailed"),
	path: Schema.String,
	message: Schema.String,
	cause: Schema.Defect(),
}) {}

/**
 * Scoped changes to process-global state, each restored when the enclosing
 * `Scope` closes, on every exit path.
 *
 * @remarks
 * Pair them with {@link Exclusive}: a scoped restore protects the next request
 * only if no other request can run while the change is live.
 *
 * Both take the state they change as an argument (a {@link ProcessCwdHost},
 * an environment record), so they read no `process` and test against plain
 * doubles. For a temporary directory, use core's
 * `FileSystem.makeTempDirectory` in an `Effect.acquireRelease` whose release
 * ignores a failed removal; `makeTempDirectoryScoped`'s release dies on one,
 * which turns a successful body into a defect.
 *
 * @public
 */
export class ProcessScope {
	private constructor() {}

	/**
	 * Enters `directory` and returns to the previous working directory when the
	 * scope closes.
	 *
	 * @remarks
	 * When the previous directory cannot be read (it was deleted, so `cwd()`
	 * throws), the change still happens and nothing is restored: there is no
	 * valid directory to go back to. A restore that throws is ignored for the
	 * same reason.
	 */
	static readonly chdir = (
		host: ProcessCwdHost,
		directory: string,
	): Effect.Effect<void, ProcessScopeError, Scope.Scope> =>
		Effect.asVoid(
			Effect.acquireRelease(
				Effect.try({
					try: () => {
						let previous: Option.Option<string>;
						try {
							previous = Option.some(host.cwd());
						} catch {
							previous = Option.none();
						}
						host.chdir(directory);
						return previous;
					},
					catch: (cause) =>
						new ProcessScopeError({
							reason: "ChdirFailed",
							path: directory,
							message: `Cannot change the working directory to ${directory}.`,
							cause,
						}),
				}),
				(previous) =>
					Effect.sync(() => {
						if (Option.isNone(previous)) return;
						try {
							host.chdir(previous.value);
						} catch {
							// The previous directory vanished while the scope was open.
						}
					}),
			),
		);

	/**
	 * Applies `patch` to `env` and restores every patched key when the scope
	 * closes.
	 *
	 * @remarks
	 * An `undefined` value in `patch` deletes the key, and a key that was absent
	 * before is deleted again on restore. Assigning `undefined` to Node's
	 * `process.env` would store the string `"undefined"`, so neither direction
	 * ever assigns it.
	 */
	static readonly env = (
		env: Record<string, string | undefined>,
		patch: Readonly<Record<string, string | undefined>>,
	): Effect.Effect<void, never, Scope.Scope> =>
		Effect.asVoid(
			Effect.acquireRelease(
				Effect.sync(() => {
					const saved = Object.keys(patch).map(
						(key) => [key, Object.hasOwn(env, key) ? Option.fromUndefinedOr(env[key]) : Option.none()] as const,
					);
					for (const [key, value] of Object.entries(patch)) assign(env, key, value);
					return saved;
				}),
				(saved) =>
					Effect.sync(() => {
						for (const [key, value] of saved) assign(env, key, Option.getOrUndefined(value));
					}),
			),
		);
}

const assign = (env: Record<string, string | undefined>, key: string, value: string | undefined): void => {
	if (value === undefined) delete env[key];
	else env[key] = value;
};
