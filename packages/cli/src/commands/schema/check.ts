import { Command } from "effect/cli";
import type { SchemaCommandDeps } from "./execute.js";
import { execute } from "./execute.js";
import { commandFlags } from "./flags.js";

/**
 * `effected schema check`: the same walk as `build`, reported and never written. The CI drift gate: it also fails when
 * the committed documents are stale, and on outputs nothing claims, which `build` never deletes.
 */
export const makeCheckCommand = (deps: SchemaCommandDeps) =>
	Command.make("check", commandFlags, (input) => execute("check", input, deps)).pipe(
		Command.withDescription(
			"Report what build would do, fail when it would write anything or refuse to, or when a catalog file or document is orphaned or the merged catalog is blocked, and write nothing",
		),
	);
