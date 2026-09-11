/**
 * The assembled okfit CLI program.
 *
 * @packageDocumentation
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CliLogger, CliRuntime } from "@effected/cli";
import { Context, DateTime, Effect, Option } from "effect";
import { Command } from "effect/unstable/cli";
import { rootCommand } from "./cli/root.js";

export class Now extends Context.Service<Now, DateTime.Utc>()("@effected/Now") {}

const nowEffect = Option.fromNullishOr(process.env.OKFIT_NOW).pipe(
	Option.flatMap((iso) => DateTime.make(iso)),
	Option.match({ onNone: () => DateTime.now, onSome: Effect.succeed }),
);

export const main = (): void => {
	const program = Effect.gen(function* () {
		const now = yield* nowEffect;
		return yield* Command.run(rootCommand, {
			version: process.env.__PACKAGE_VERSION__ ?? "0.0.0",
		}).pipe(
			Effect.provideService(Now, now),
			// K-7/K-30: `ShowHelp` carries its own exit code — 0 with no errors, 1 with
			// parse errors. Remap only the second to 64 (BSD EX_USAGE);
			// `CliRuntime.reported` is the kit's own marker helper and also sets
			// `Runtime.errorReported`, whose polarity is inverted.
			Effect.catchTag("ShowHelp", (help) => Effect.fail(CliRuntime.reported(help, help.errors.length > 0 ? 64 : 0))),
		);
	}).pipe(
		// Provided here, INSIDE `reportFailures` below, so a failure while
		// building `OkfitPlatform` (an `XdgEnvError` from an unset `HOME`, K-13)
		// is itself rendered and mapped to `exitCode: 3`, rather than escaping to
		// `NodeRuntime.runMain`'s own fatal-error path — a stack trace on stdout
		// and exit `1`.
		Effect.provide(NodeServices.layer),
		// K-30. `renderFailure` returns `[]` for a `ShowHelp`, because
		// `Command.runWith` already rendered the help document. The `exitCode: 3`
		// fallback is the infrastructure tier for any typed error that carries no
		// code of its own.
		CliRuntime.reportFailures({
			exitCode: 3,
			render: () => {
				return [];
			},
		}),
	);

	// `CliLogger.layer()` has no requirements of its own, so it is provided
	// outermost, last — it must be available no matter which branch above fails.
	NodeRuntime.runMain(program.pipe(Effect.provide(CliLogger.layer())));
};
