// The GitHub Actions step-summary sink: append markdown to the file named by
// `GITHUB_STEP_SUMMARY`, when the environment declares one. A failure here is
// never fatal to the run it is reporting on — it is logged and swallowed.

import { Config, Effect, FileSystem, Option } from "effect";

// `ConfigProvider` is a `Context.Reference` defaulting to `fromEnv()`, so the
// read never enters `R`; a test swaps the provider. An empty string is
// "absent" to the env provider, which is exactly the contract here.
const summaryTarget = Config.String("GITHUB_STEP_SUMMARY").pipe(Config.option);

/**
 * Appends a rendered {@link Report.markdown} document to `GITHUB_STEP_SUMMARY`.
 *
 * @public
 */
export class StepSummary {
	private constructor() {}

	/**
	 * `true` when appended; `false` when `GITHUB_STEP_SUMMARY` is unset or
	 * empty, or when the read/write failed — a failure is logged at warning
	 * and never fails the run it is reporting on.
	 */
	static readonly append: (markdown: string) => Effect.Effect<boolean, never, FileSystem.FileSystem> = Effect.fn(
		"StepSummary.append",
	)(function* (markdown: string) {
		const fs = yield* FileSystem.FileSystem;
		return yield* Effect.gen(function* () {
			const target = yield* summaryTarget;
			if (Option.isNone(target)) {
				return false;
			}
			const exists = yield* fs.exists(target.value);
			const existing = exists ? yield* fs.readFileString(target.value) : "";
			yield* fs.writeFileString(target.value, existing + markdown);
			return true;
		}).pipe(
			Effect.catch((error) =>
				Effect.logWarning("StepSummary.append: could not update GITHUB_STEP_SUMMARY", error).pipe(Effect.as(false)),
			),
		);
	});
}
