import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { CliAudience, CliRuntime } from "../src/index.js";

const sub = Command.make("sub", { count: Flag.Int("count").pipe(Flag.withDefault(1)) }, () => Effect.void);
const app = Command.make("app").pipe(
	Command.withSharedFlags({ ...CliAudience.flags(), profile: Flag.String("profile").pipe(Flag.withDefault("dev")) }),
	Command.withSubcommands([sub]),
);

const helpOf = (args: ReadonlyArray<string>, env?: Record<string, never>) =>
	Effect.gen(function* () {
		const out: string[] = [];
		const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
			log: (...parts: ReadonlyArray<unknown>) => out.push(parts.map(String).join(" ")),
			error: () => {},
		});
		const program = Command.runWith(app, { version: "1.0.0" })(args);
		const run =
			env === undefined
				? CliRuntime.main(program, { platform: NodeServices.layer })
				: CliRuntime.main(program, { platform: NodeServices.layer, env });
		yield* run.pipe(Effect.exit, Effect.provideService(Console.Console, double));
		return out.join("\n");
	});

/** The text of the section headed `heading`, up to the next all-caps heading. */
const section = (help: string, heading: string): string => {
	const lines = help.split("\n");
	const start = lines.findIndex((line) => line.trim() === heading);
	if (start === -1) return "";
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => /^[A-Z][A-Z ]+$/.test(line.trim()));
	return (end === -1 ? rest : rest.slice(0, end)).join("\n");
};

describe("subcommand help: a parent's shared flags", () => {
	for (const [label, env] of [
		["core's formatter", undefined],
		["the kit's coloured formatter (env)", {}],
	] as const) {
		it.effect(`${label}: render under INHERITED FLAGS, not FLAGS`, () =>
			Effect.gen(function* () {
				const help = yield* helpOf(["sub", "--help"], env);
				const inherited = section(help, "INHERITED FLAGS");
				const own = section(help, "FLAGS");
				for (const flag of ["--profile", "--agent", "--human", "--ci", "--audience"]) {
					assert.include(inherited, flag, help);
					assert.notInclude(own, flag, help);
				}
				assert.include(own, "--count", help);
			}),
		);
	}

	it.effect("the declaring command lists its shared flags as its own", () =>
		Effect.gen(function* () {
			const help = yield* helpOf(["--help"], {});
			assert.include(section(help, "FLAGS"), "--profile", help);
			assert.strictEqual(section(help, "INHERITED FLAGS"), "", help);
		}),
	);
});
