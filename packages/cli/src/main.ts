/**
 * The assembled `effected` program.
 *
 * @packageDocumentation
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CliAudience, CliRuntime } from "@effected/cli-kit";
import type { Distribution } from "@effected/kit";
import type { Layer } from "effect";
import type { CliOutput } from "effect/cli";
import { rootCommand } from "./commands/root.js";
import { CLI_VERSION } from "./version.js";

/**
 * Options a carrier's bin shim passes to {@link main}. `distribution` names
 * the package the `effected` bin was installed through; omitted for a direct
 * install of `@effected/cli`.
 *
 * @public
 */
export interface MainOptions {
	readonly distribution?: Distribution;
}

/**
 * `effected --version` prints `effected <version>`; a carrier's
 * ` via <name> <version>` is appended by `CliRuntime.main`'s `distribution`
 * option, not here.
 */
const versionFormatter: Pick<CliOutput.Formatter, "formatVersion"> = {
	formatVersion: (name: string, version: string): string => `${name} ${version}`,
};

/**
 * The `effected` program under `CliRuntime.main`, over `platform`: what
 * {@link main} runs with the Node services, and what a test runs over a test
 * environment.
 *
 * @public
 */
export const run = <RP, EP>(options: MainOptions, platform: Layer.Layer<RP, EP>) =>
	CliRuntime.main(CliAudience.run(rootCommand, { version: CLI_VERSION }), {
		platform,
		distribution: options.distribution ?? null,
		// The infrastructure tier for a typed error that carries no code of its own.
		exitCode: 3,
		// A usage error's help goes to stderr beside the parse errors; an explicit
		// `--help` stays on stdout.
		helpOnUsageError: "stderr",
		env: { appModule: import.meta.url, formatter: versionFormatter },
	});

/**
 * Run the `effected` command. Owns the process: installs the runtime teardown
 * and sets the exit code.
 *
 * @public
 */
export const main = (options: MainOptions = {}): void => {
	NodeRuntime.runMain(run(options, NodeServices.layer));
};
