/**
 * The assembled schemastore CLI program.
 *
 * @packageDocumentation
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CliRuntime } from "@effected/cli";
import { Effect } from "effect";
import { CliError } from "effect/unstable/cli";
import { loggerLayer, program } from "./cli/program.js";

// `Command.runWith` already rendered a `ShowHelp`; everything else prints
// its own message. Exit 3 is the infrastructure tier for a typed error that
// carries no code of its own.
const render = (error: unknown): ReadonlyArray<string> =>
	CliError.isCliError(error) && error._tag === "ShowHelp"
		? []
		: [error instanceof Error ? error.message : String(error)];

export const main = (): void => {
	// The ONLY place process globals are read. (`process.env.__PACKAGE_VERSION__`
	// is not an env read: the bundler replaces that exact expression with the
	// package version at build time, so it must stay spelled this way.)
	const run = program(process.argv.slice(2), {
		cwd: process.cwd(),
		version: process.env.__PACKAGE_VERSION__ ?? "0.0.0",
	}).pipe(
		Effect.provide(NodeServices.layer),
		CliRuntime.reportFailures({ exitCode: 3, render }),
		Effect.provide(loggerLayer),
	);

	NodeRuntime.runMain(run);
};
