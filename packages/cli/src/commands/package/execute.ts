// The body of `package build`: ask the engine, report, and turn the verdict into the exit-code contract. What the engine
// leaves to a front end lives here: the annotations, the step summary and every exit code. Process globals arrive
// through `PackageCommandDeps`, so nothing here reads them.

import { CliRuntime, Doc } from "@effected/cli-kit";
import type { BuildProgress, BuildRunDeps } from "@effected/engine/build";
import { StepSummary } from "@effected/engine/schema";
import { Audience } from "@effected/env";
import { Console, Effect, Option, Schema } from "effect";
import { IssuesDoc } from "../../render/IssuesDoc.js";
import { resolveFormat } from "../schema/execute.js";
import { refuseUnderCi, reportAndContinue, triggerLine } from "../watch.js";
import { BuildFailedError, PackageConfigError, PackageRunError } from "./errors.js";

/**
 * What `effected package` is given by the process boundary, and the test seams: the engine's dependencies, less the
 * progress callback. `main` reads `cwd` and `ci`, and nothing else reads the process.
 *
 * @public
 */
export type PackageCommandDeps = Omit<BuildRunDeps, "onProgress">;

/** The parsed flags of `package build`. */
export interface ExecuteInput {
	readonly format: Option.Option<"human" | "json">;
	readonly noExe: boolean;
	readonly verbose: boolean;
	readonly watch: boolean;
}

const refused = (error: { readonly message: string }) =>
	Effect.fail(CliRuntime.reported(new PackageConfigError({ message: error.message }), 2));
const infrastructure = (error: { readonly message: string }) =>
	Effect.fail(CliRuntime.reported(new PackageRunError({ message: error.message }), 3));

// On stderr, so that stdout stays one document under --format json.
const onProgress = (event: BuildProgress): Effect.Effect<void> =>
	event._tag === "Waiting"
		? Console.error(
				Option.match(event.holder, {
					onNone: () => `waiting for another build of this package (${event.lockPath})`,
					onSome: (holder) =>
						`waiting for another build of this package: process ${holder.pid}, building ${holder.cwd} since ${holder.startedAt} (${event.lockPath})`,
				}),
			)
		: Effect.void;

/**
 * Run one build and report it.
 *
 * @remarks
 * The report is emitted first and the failure follows, so a run that fails has still said why. With `--format json`,
 * stdout holds one document, so CI's annotations go to stderr instead, where the runner reads workflow commands too.
 * Under `--watch` neither the annotations nor the step summary are written: CI refuses `--watch`.
 */
const runOnce = Effect.fn("effected.package.runOnce")(function* (
	input: ExecuteInput,
	deps: PackageCommandDeps,
	format: "human" | "json",
) {
	const audience = yield* Audience;
	const { BuildRun, BuildRunResult, renderCiAnnotations } = yield* Effect.promise(
		() => import("@effected/engine/build"),
	);
	const result = yield* BuildRun.run({ noExe: input.noExe, verbose: input.verbose }, { ...deps, onProgress }).pipe(
		Effect.catchTags({
			EffectedConfigError: refused,
			PluginLoadError: refused,
			NotAPackageError: refused,
			ConfigValidationError: refused,
			BuildLockTimeoutError: infrastructure,
			PlatformError: infrastructure,
		}),
	);
	const { issues } = result;

	if (format === "json") {
		yield* Console.log(JSON.stringify(Schema.encodeSync(BuildRunResult)(result)));
		for (const line of IssuesDoc.lines(issues)) yield* Effect.logInfo(line);
	} else {
		yield* Doc.print([IssuesDoc.render(issues)]);
	}
	if (!input.watch) {
		if (audience.kind === "ci") {
			const write = format === "json" ? Console.error : Console.log;
			for (const line of renderCiAnnotations(result.report)) yield* write(line);
		}
		// Here and not in the engine: a `package_build` over MCP inside an Actions step must not write the summary.
		yield* StepSummary.append(IssuesDoc.markdown(issues));
	}

	if (result.verdict === "failed") {
		return yield* Effect.fail(
			CliRuntime.reported(
				new BuildFailedError({
					errors: issues.errors.length,
					...(issues.failure !== undefined ? { failure: issues.failure.message } : {}),
				}),
				1,
			),
		);
	}
});

/**
 * Run one `package build`, or under `--watch` one per change until interrupted.
 *
 * @remarks
 * The engine's build entry is imported here rather than at the top of the module: it loads the bundler and its
 * toolchain, which `effected --version` and every `effected schema` run have no use for.
 *
 * Under `--watch`, a directory that is not a package, or a workspace root that cannot be discovered, exits before any
 * watch exists, as the one-shot run would. After that a run's failure is rendered on stderr and the watch goes on; only
 * a watcher failure ends it, with exit `3`.
 */
export const execute = Effect.fn("effected.package.execute")(function* (input: ExecuteInput, deps: PackageCommandDeps) {
	const format = yield* resolveFormat(input.format);
	if (!input.watch) return yield* runOnce(input, deps, format);

	yield* refuseUnderCi;
	const { BuildWatch, DEFAULT_EXCLUDES } = yield* Effect.promise(() => import("@effected/engine/build"));
	const target = yield* BuildWatch.target(deps.cwd, "package").pipe(
		Effect.catchTags({ NotAPackageError: refused, EffectedConfigError: refused, PlatformError: infrastructure }),
	);
	return yield* BuildWatch.run({
		...target,
		exclude: Effect.succeed(DEFAULT_EXCLUDES),
		build: (trigger) =>
			Effect.gen(function* () {
				const line = triggerLine(trigger);
				if (line !== undefined) yield* Console.error(line);
				yield* reportAndContinue(runOnce(input, { ...deps, cwd: target.cwd }, format));
			}),
	}).pipe(Effect.catchTag("PlatformError", infrastructure));
});
