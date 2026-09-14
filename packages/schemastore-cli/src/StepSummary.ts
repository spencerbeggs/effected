// The GitHub Actions step-summary sink: append markdown to the file named by
// `GITHUB_STEP_SUMMARY`, when the environment declares one. A failure here is
// never fatal to the run it is reporting on — it is logged and swallowed.

import { Effect, FileSystem } from "effect";

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
	static readonly append: (
		markdown: string,
		env?: Record<string, string | undefined>,
	) => Effect.Effect<boolean, never, FileSystem.FileSystem> = Effect.fn("StepSummary.append")(function* (
		markdown: string,
		env: Record<string, string | undefined> = process.env,
	) {
		const target = env.GITHUB_STEP_SUMMARY;
		if (target === undefined || target === "") {
			return false;
		}
		const fs = yield* FileSystem.FileSystem;
		return yield* Effect.gen(function* () {
			const exists = yield* fs.exists(target);
			const existing = exists ? yield* fs.readFileString(target) : "";
			yield* fs.writeFileString(target, existing + markdown);
			return true;
		}).pipe(
			Effect.catch((error) =>
				Effect.logWarning(`StepSummary.append: could not update ${target}`, error).pipe(Effect.as(false)),
			),
		);
	});
}
