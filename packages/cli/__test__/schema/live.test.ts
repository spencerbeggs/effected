// The live progress view: its frames through `CliUiTest.live`, then the whole command on the production path, where
// `CliEnv` decides from the terminal facts and the environment whether anything draws.
import { assert, describe, it } from "@effect/vitest";
import { CliUiTest } from "@effected/cli-kit/ui/testing";
import { SchemaReport } from "@effected/engine/schema";
import { MemoryFileSystem } from "@effected/memfs";
import { Cause, ConfigProvider, Console, Effect, Exit, Runtime } from "effect";
import { liveProgress } from "../../src/commands/schema/LiveProgress.js";
import { run } from "../../src/main.js";
import type { Ttys } from "./harness.js";
import {
	ANSI,
	BASIC_ID,
	BASIC_PATH,
	CONFIG_PATH,
	Wider,
	basicConfig,
	depsFor,
	emitted,
	environment,
} from "./harness.js";

const report = (name: string, outcome: SchemaReport["outcome"]) =>
	SchemaReport.make({
		$id: `https://example.com/${name}.json`,
		path: `/repo/${name}.json`,
		name,
		published: false,
		change: outcome === "unchanged" ? "none" : "annotations",
		verdict: outcome === "drift" ? "drift" : "write",
		policy: "semantic",
		outcome,
		frozen: [],
		findings: [],
	});

const deps = depsFor(basicConfig());
const staleSeed = { [CONFIG_PATH]: "", [BASIC_PATH]: emitted(Wider, BASIC_ID) };
// A document that does not exist yet: `created` once checked, `would write` once settled, so a test can tell which.
const freshSeed = { [CONFIG_PATH]: "" };
const TERMINAL: Ttys = { stdin: true, stdout: true, stderr: true };

const session = (
	args: ReadonlyArray<string>,
	env: Record<string, string>,
	ttys: Ttys = TERMINAL,
	sessionDeps = deps,
	seed: Record<string, string> = staleSeed,
) =>
	Effect.gen(function* () {
		const ui = yield* CliUiTest.session({ columns: 120 });
		const handle = yield* MemoryFileSystem.makeHandle(seed);
		const exit = yield* Effect.exit(
			run({}, sessionDeps, environment(args, handle.layer, ttys)).pipe(
				Effect.provide(ui.layer),
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
			),
		);
		return {
			code: Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0,
			mounts: yield* ui.mounts,
			stdout: yield* ui.stdout,
			stderr: yield* ui.stderr,
			transcript: yield* ui.transcript,
		};
	}).pipe(Effect.scoped);

describe("the live progress view", () => {
	it.effect("a human on a terminal gets one row per schema, each turning into its verdict", () =>
		Effect.gen(function* () {
			const view = yield* CliUiTest.live({ ...liveProgress, columns: 80 });
			yield* view.publish({ _tag: "Started", names: ["alpha", "beta", "gamma"] });
			yield* view.advance("80 millis");
			const started = yield* view.transcript;
			for (const name of ["alpha", "beta", "gamma"]) assert.include(started, name);
			assert.include(started, "checking");
			assert.notInclude(started, "drift");

			yield* view.publish({ _tag: "SchemaChecked", name: "alpha", change: "none", verdict: "write", blocked: false });
			yield* view.publish({
				_tag: "SchemaChecked",
				name: "beta",
				change: "contract",
				verdict: "drift",
				blocked: false,
			});
			yield* view.advance("80 millis");
			const checked = yield* view.transcript;
			assert.match(checked, /alpha.*clean/);
			assert.match(checked, /beta.*drift/);
			assert.match(checked, /gamma.*checking/);

			yield* view.publish({
				_tag: "SchemaChecked",
				name: "gamma",
				change: "created",
				verdict: "write",
				blocked: true,
			});
			yield* view.publish({ _tag: "SchemaDone", report: report("alpha", "held") });
			yield* view.publish({ _tag: "SchemaDone", report: report("beta", "drift") });
			yield* view.publish({ _tag: "SchemaDone", report: report("gamma", "gate-failed") });
			yield* view.publish({ _tag: "Ended" });
			yield* view.end;
			const settled = yield* view.transcript;
			assert.match(settled, /alpha.*held/);
			assert.match(settled, /beta.*drift/);
			assert.match(settled, /gamma.*gate failed/);
			assert.notMatch(
				settled
					.split("\n")
					.filter((line) => line.includes("alpha"))
					.at(-1) ?? "",
				/clean/,
			);
		}).pipe(Effect.scoped),
	);

	it.effect("the whole command draws one row and exits as it would without the view", () =>
		Effect.gen(function* () {
			const result = yield* session(["schema", "check"], { TERM: "xterm-256color" }, TERMINAL, deps, freshSeed);
			assert.strictEqual(result.code, 1);
			assert.strictEqual(result.mounts, 1);
			assert.match(result.transcript, /basic.*would write/);
		}),
	);

	it.effect("the static report follows the live view", () =>
		Effect.gen(function* () {
			const ui = yield* CliUiTest.session({ columns: 120 });
			const handle = yield* MemoryFileSystem.makeHandle(freshSeed);
			// What the terminal showed at the moment the report's first line was written.
			const atFirstLog: Array<string> = [];
			const logged: Array<string> = [];
			const console_: Console.Console = {
				...globalThis.console,
				log: (...parts: ReadonlyArray<unknown>) => {
					if (atFirstLog.length === 0) atFirstLog.push(Effect.runSync(ui.transcript));
					logged.push(parts.map(String).join(" "));
				},
				error: () => {},
			} as unknown as Console.Console;
			yield* Effect.exit(
				run({}, deps, environment(["schema", "check"], handle.layer, TERMINAL)).pipe(
					Effect.provideService(Console.Console, console_),
					Effect.provide(ui.layer),
					Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { TERM: "xterm-256color" } }))),
				),
			);
			assert.isNotEmpty(logged);
			assert.include(logged.join("\n"), `@@ ${BASIC_PATH} @@`);
			assert.match(atFirstLog[0] ?? "", /basic.*would write/, "the view had settled before the report began");
		}).pipe(Effect.scoped),
	);

	it.effect("warnings during the walk land above the frame, in the transcript", () =>
		Effect.gen(function* () {
			const result = yield* session(["schema", "check", "--on-drift=warn", "--force"], { TERM: "xterm-256color" });
			assert.strictEqual(result.mounts, 1);
			assert.include(result.transcript, "--force: drift policy is allow");
		}),
	);

	it.effect("a failure before the walk mounts nothing and reports as usual", () =>
		Effect.gen(function* () {
			const missing = depsFor(basicConfig(), { cwd: "/elsewhere" });
			const result = yield* session(["schema", "check"], { TERM: "xterm-256color" }, TERMINAL, missing);
			assert.strictEqual(result.code, 2);
			assert.strictEqual(result.mounts, 0);
			// A terminal is 80 columns here, and the report wraps to it.
			assert.include(result.stderr.replace(/\s+/g, " "), "effected schema check lib/schemastore.config.ts");
		}),
	);

	it.effect("stdout piped, stderr a terminal: no live view and no ANSI on stdout", () =>
		Effect.gen(function* () {
			const result = yield* session(
				["schema", "check", "--on-drift=warn"],
				{ TERM: "xterm-256color" },
				{ stdin: true, stdout: false, stderr: true },
			);
			assert.strictEqual(result.code, 1);
			assert.strictEqual(result.mounts, 0);
			assert.include(result.stdout, `@@ ${BASIC_PATH} @@`);
			assert.notInclude(result.stdout, ANSI);
		}),
	);

	it.effect("control: a terminal with colour paints the report and the diff", () =>
		Effect.gen(function* () {
			const result = yield* session(["schema", "check", "--on-drift=warn"], { TERM: "xterm-256color" });
			assert.include(result.stdout, ANSI);
		}),
	);

	it.effect("NO_COLOR gives no ANSI", () =>
		Effect.gen(function* () {
			const result = yield* session(["schema", "check", "--on-drift=warn"], {
				TERM: "xterm-256color",
				NO_COLOR: "1",
			});
			assert.include(result.stdout, `@@ ${BASIC_PATH} @@`);
			assert.notInclude(result.stdout, ANSI);
			assert.notInclude(result.stderr, ANSI);
		}),
	);

	it.effect("TERM=dumb gives no live view", () =>
		Effect.gen(function* () {
			const result = yield* session(["schema", "check", "--on-drift=warn"], { TERM: "dumb" });
			assert.strictEqual(result.mounts, 0);
			assert.include(result.stdout, `@@ ${BASIC_PATH} @@`);
			assert.notInclude(result.stdout, ANSI);
		}),
	);
});
