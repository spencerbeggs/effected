/**
 * The assembled schemastore CLI program.
 *
 * @packageDocumentation
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CliLogger, CliRuntime } from "@effected/cli";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { rootCommand } from "./cli/root.js";

export const main = (): void => {
	const program = Command.run(rootCommand, {
		version: process.env.__PACKAGE_VERSION__ ?? "0.0.0",
	}).pipe(
		// `ShowHelp` exits 0 with no parse errors and 1 with them; remap only
		// the second to 64 (BSD EX_USAGE).
		Effect.catchTag("ShowHelp", (help) => Effect.fail(CliRuntime.reported(help, help.errors.length > 0 ? 64 : 0))),
		Effect.provide(NodeServices.layer),
		// `renderFailure` returns `[]` for a `ShowHelp` because `Command.runWith`
		// already rendered the help document. Exit 3 is the infrastructure tier
		// for a typed error that carries no code of its own.
		CliRuntime.reportFailures({ exitCode: 3, render: () => [] }),
	);

	NodeRuntime.runMain(program.pipe(Effect.provide(CliLogger.layer())));
};
