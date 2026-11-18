// What `--watch` adds to a build command, shared by `package build` and `action build`: the line before each rebuild,
// the CI refusal, and rendering a run's failure without ending the watch. The loop itself is the engine's
// `BuildWatch`, reached through the commands' dynamic import of `@effected/engine/build`.

import type { CliLinks, CliTheme } from "@effected/cli-kit";
import { CliFailure, CliRuntime, Doc } from "@effected/cli-kit";
import type { WatchTrigger } from "@effected/engine/build";
import type { TerminalEnv } from "@effected/env";
import { Audience } from "@effected/env";
import { Cause, Effect, Schema } from "effect";

/** How many changed paths the line before a rebuild names before it counts the rest. */
const LISTED_PATHS = 3;

/**
 * `--watch` under the CI audience. Exit `64`: a watching CI job would never end.
 *
 * @public
 */
export class WatchUnderCiError extends Schema.TaggedError<WatchUnderCiError>()("WatchUnderCiError", {}) {
	override get message(): string {
		return "--watch never ends, so it is refused under CI";
	}
}

/** The stderr line before a rebuild; `undefined` for `Initial`. */
export const triggerLine = (trigger: WatchTrigger): string | undefined => {
	if (trigger._tag === "Initial") return undefined;
	const listed = trigger.paths.slice(0, LISTED_PATHS).join(", ");
	const rest = trigger.paths.length - LISTED_PATHS;
	return rest > 0 ? `rebuilding: ${listed} +${rest} more` : `rebuilding: ${listed}`;
};

/**
 * Render a run's failure to stderr as CliRuntime would, without ending the program.
 *
 * @remarks
 * An interrupt-only cause passes through untouched, so Ctrl-C still ends the watch with `130`. A failure that arrived
 * beside an interrupt, such as a race whose losing branch was interrupted, is a failure: it is rendered and the watch
 * goes on. If the watch itself was interrupted, it stops at its next step all the same.
 */
export const reportAndContinue = <A, E, R>(
	run: Effect.Effect<A, E, R>,
): Effect.Effect<void, never, R | CliTheme | TerminalEnv | Audience | CliLinks> =>
	run.pipe(
		Effect.asVoid,
		Effect.catchCause((cause) =>
			Cause.hasInterruptsOnly(cause)
				? Effect.failCause(cause as Cause.Cause<never>)
				: Doc.print(CliFailure.toDoc(cause), { stream: "stderr" }),
		),
	);

/** Under the CI audience, fails with CliRuntime.reported(new WatchUnderCiError(), 64); otherwise succeeds. */
export const refuseUnderCi: Effect.Effect<void, WatchUnderCiError, Audience> = Effect.gen(function* () {
	const audience = yield* Audience;
	if (audience.kind === "ci") return yield* Effect.fail(CliRuntime.reported(new WatchUnderCiError(), 64));
});
