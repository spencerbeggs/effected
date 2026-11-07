// The body of `package build`: ask the engine, report, and turn the verdict into the exit-code contract. What the engine
// leaves to a front end lives here: the annotations, the step summary and every exit code. Process globals arrive
// through `PackageCommandDeps`, so nothing here reads them.

import { CliRuntime, Doc } from "@effected/cli-kit";
import type { BuildRunDeps } from "@effected/engine/build";
import { StepSummary } from "@effected/engine/schema";
import { Audience } from "@effected/env";
import type { Option } from "effect";
import { Console, Effect, Schema } from "effect";
import { IssuesDoc } from "../../render/IssuesDoc.js";
import { resolveFormat } from "../schema/execute.js";
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
}

/**
 * Run one `package build`.
 *
 * @remarks
 * The engine's build entry is imported here rather than at the top of the module: it loads the bundler and its
 * toolchain, which `effected --version` and every `effected schema` run have no use for. The report is emitted first and
 * the failure follows, so a run that fails has still said why.
 *
 * With `--format json`, stdout holds one document, so CI's annotations go to stderr instead, where the runner reads
 * workflow commands too.
 */
export const execute = Effect.fn("effected.package.execute")(function* (input: ExecuteInput, deps: PackageCommandDeps) {
	const format = yield* resolveFormat(input.format);
	const audience = yield* Audience;
	const { BuildRun, BuildRunResult, renderCiAnnotations } = yield* Effect.promise(
		() => import("@effected/engine/build"),
	);

	const refused = (error: { readonly message: string }) =>
		Effect.fail(CliRuntime.reported(new PackageConfigError({ message: error.message }), 2));
	const result = yield* BuildRun.run({ noExe: input.noExe, verbose: input.verbose }, deps).pipe(
		Effect.catchTags({
			EffectedConfigError: refused,
			PluginLoadError: refused,
			NotAPackageError: refused,
			ConfigValidationError: refused,
			PlatformError: (error) => Effect.fail(CliRuntime.reported(new PackageRunError({ message: error.message }), 3)),
		}),
	);
	const { issues } = result;

	if (format === "json") {
		yield* Console.log(JSON.stringify(Schema.encodeSync(BuildRunResult)(result)));
		for (const line of IssuesDoc.lines(issues)) yield* Effect.logInfo(line);
	} else {
		yield* Doc.print([IssuesDoc.render(issues)]);
	}
	if (audience.kind === "ci") {
		const write = format === "json" ? Console.error : Console.log;
		for (const line of renderCiAnnotations(result.report)) yield* write(line);
	}
	// Here and not in the engine: a `package_build` over MCP inside an Actions step must not write the summary.
	yield* StepSummary.append(IssuesDoc.markdown(issues));

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
