import { LocalExec } from "@effected/commands";
import { Effect, Option, Schema } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { PublishError } from "./PublishError.js";

/**
 * Which `npm` runs a publish command.
 *
 * @remarks
 * v3 repeated a `packageManager?: "npm" | "pnpm" | "yarn" | "bun"` option on
 * five method signatures to express one thing: whether to use the runner's
 * bundled `npm` or fetch a fresh one. The distinction is real — OIDC trusted
 * publishing needs npm ≥ 11.5.1 and GitHub-hosted runners ship 10.x — but it is
 * not package-manager knowledge this package should own. `@effected/commands`'
 * `LocalExec` already models "fetch and run a package binary" as `applyDlx`, so
 * that is what this value delegates to.
 *
 * @public
 */
export class NpmExecutor extends Schema.Class<NpmExecutor>("NpmExecutor")({
	/**
	 * The npm package spec to fetch and run (`"npm@11"`). Absent means the
	 * ambient `npm` on `PATH`.
	 */
	spec: Schema.optionalKey(Schema.String),
}) {
	/** The runner's own `npm`. */
	static readonly ambient: NpmExecutor = NpmExecutor.make({});

	/** A pinned npm, fetched through the project's launcher (`pnpm dlx npm@11`). */
	static readonly dlx = (spec: string): NpmExecutor => NpmExecutor.make({ spec });

	/**
	 * The core `Command` that runs `npm` with `args`.
	 *
	 * @remarks
	 * A `dlx` executor with no project-local launcher **fails typed** rather
	 * than degrading to the ambient `npm`: silently running the runner's bundled
	 * npm when the caller explicitly asked for a pinned one would reintroduce
	 * exactly the OIDC failure the pinned spec exists to avoid, and would do it
	 * invisibly.
	 */
	command(args: ReadonlyArray<string>): Effect.Effect<ChildProcess.StandardCommand, PublishError, LocalExec> {
		const spec = this.spec;
		if (spec === undefined) return Effect.succeed(ChildProcess.make("npm", args));
		return Effect.gen(function* () {
			const local = yield* LocalExec;
			const context = yield* local.context.pipe(
				Effect.catch((cause) => Effect.fail(new PublishError({ kind: "executor", cause }))),
			);
			if (Option.isNone(context)) {
				return yield* Effect.fail(new PublishError({ kind: "executor" }));
			}
			const dlx = context.value.applyDlx(ChildProcess.make(spec, args));
			if (!ChildProcess.isStandardCommand(dlx)) {
				return yield* Effect.fail(new PublishError({ kind: "executor" }));
			}
			return dlx;
		});
	}
}
