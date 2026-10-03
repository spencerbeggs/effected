// The assembled schemastore CLI program, run by `bin.ts`.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CliRuntime } from "@effected/cli";
import type { Layer } from "effect";
import type { ProgramDeps } from "./cli/program.js";
import { loggerLayer, program } from "./cli/program.js";

/**
 * How `CliRuntime.main` runs the command: the kit's standard failure report, exit `3` for a typed error that carries
 * no code of its own (the infrastructure tier; every other code is marked where it is raised), and this module as the
 * program's own, so the report's span trail keeps the command's spans when it is installed under
 * `node_modules/@effected/` and leaves out the kit's.
 */
export const mainOptions = {
	exitCode: 3,
	logger: loggerLayer,
	env: { appModule: import.meta.url },
} as const;

/**
 * The command under `CliRuntime.main` over `platform`: what `main` runs with `NodeServices.layer`, and what a test runs
 * with a test `Command.Environment`.
 */
export const run = <RP, EP>(args: ReadonlyArray<string>, deps: ProgramDeps, platform: Layer.Layer<RP, EP>) =>
	CliRuntime.main(program(args, deps), { ...mainOptions, platform });

export const main = (): void => {
	// The ONLY place process globals are read. (`process.env.__PACKAGE_VERSION__`
	// is not an env read: the bundler replaces that exact expression with the
	// package version at build time, so it must stay spelled this way.)
	NodeRuntime.runMain(
		run(
			process.argv.slice(2),
			{ cwd: process.cwd(), version: process.env.__PACKAGE_VERSION__ ?? "0.0.0" },
			NodeServices.layer,
		),
	);
};
