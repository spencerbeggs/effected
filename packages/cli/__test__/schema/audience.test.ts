// Which audience gets what, in process, on a real-looking terminal: a run that must not read input proves it with a
// TestTerminal that dies on any read, and a run that must not draw proves it with a session counting mounts. That
// agent and CI runs load neither Ink nor React is a claim about the built bin's module graph, and is proved in
// `../e2e/schema-no-ink.e2e.test.ts`.
import { assert, describe, it } from "@effect/vitest";
import { TestTerminal } from "@effected/cli-kit/testing";
import { CliUiTest } from "@effected/cli-kit/ui/testing";
import { RunReport } from "@effected/engine/schema";
import { MemoryFileSystem } from "@effected/memfs";
import { Cause, ConfigProvider, Effect, Exit, Runtime, Schema } from "effect";
import { run } from "../../src/main.js";
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

const deps = depsFor(basicConfig());
const staleSeed = { [CONFIG_PATH]: "", [BASIC_PATH]: emitted(Wider, BASIC_ID) };
const TERMINAL = { stdin: true, stdout: true, stderr: true };

// One run in a session: `mounts` is what drew, `stdout` and `stderr` what went through `Console`.
const session = (args: ReadonlyArray<string>, env: Record<string, string>, ttys = TERMINAL) =>
	Effect.gen(function* () {
		const ui = yield* CliUiTest.session({ columns: 120 });
		const terminal = yield* TestTerminal.make({ forbidInput: true });
		const handle = yield* MemoryFileSystem.makeHandle(staleSeed);
		const exit = yield* Effect.exit(
			run({}, deps, environment(args, handle.layer, ttys, terminal.layer)).pipe(
				Effect.provide(ui.layer),
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
			),
		);
		return {
			code: Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0,
			mounts: yield* ui.mounts,
			stdout: yield* ui.stdout,
			stderr: yield* ui.stderr,
			reads: yield* terminal.reads,
			volume: handle.volume,
		};
	}).pipe(Effect.scoped);

const noReads = { keys: 0, lines: 0, subscriptions: 0 };

describe("effected schema by audience", () => {
	it.effect("--agent defaults to JSON, draws nothing and reads no input, even on a terminal", () =>
		Effect.gen(function* () {
			const result = yield* session(["schema", "check", "--on-drift=warn", "--agent"], { TERM: "xterm-256color" });
			assert.strictEqual(result.code, 1);
			assert.strictEqual(result.mounts, 0);
			assert.deepStrictEqual(result.reads, noReads);
			assert.notInclude(result.stdout, ANSI);
			assert.notInclude(result.stderr, ANSI);
			const parsed = Schema.decodeUnknownSync(RunReport.Json)(JSON.parse(result.stdout));
			assert.strictEqual(parsed.mode, "check");
		}),
	);

	it.effect("--ci prints human text, appends a step summary with a fenced diff, and draws nothing", () =>
		Effect.gen(function* () {
			const result = yield* session(["schema", "check", "--on-drift=warn", "--ci"], {
				TERM: "xterm-256color",
				GITHUB_STEP_SUMMARY: "/summary.md",
			});
			assert.strictEqual(result.code, 1);
			assert.strictEqual(result.mounts, 0);
			assert.deepStrictEqual(result.reads, noReads);
			assert.include(result.stdout, `@@ ${BASIC_PATH} @@`);
			assert.throws(() => JSON.parse(result.stdout));
			const summary = result.volume.text("/summary.md") ?? "";
			assert.include(summary, "### effected schema check");
			assert.include(summary, "```diff");
		}),
	);

	it.effect("--agent --format=human is honoured, with no escapes", () =>
		Effect.gen(function* () {
			const result = yield* session(["schema", "check", "--on-drift=warn", "--agent", "--format=human"], {
				TERM: "xterm-256color",
				FORCE_COLOR: "3",
			});
			assert.strictEqual(result.mounts, 0);
			assert.include(result.stdout, `@@ ${BASIC_PATH} @@`);
			assert.notInclude(result.stdout, ANSI);
		}),
	);

	it.effect("a person's --format=json on a terminal draws nothing over the document", () =>
		Effect.gen(function* () {
			const result = yield* session(["schema", "check", "--on-drift=warn", "--format=json"], {
				TERM: "xterm-256color",
			});
			assert.strictEqual(result.mounts, 0);
			assert.doesNotThrow(() => JSON.parse(result.stdout));
		}),
	);

	it.effect("--ci --format=json is honoured", () =>
		Effect.gen(function* () {
			const result = yield* session(["schema", "check", "--on-drift=warn", "--ci", "--format=json"], {});
			assert.doesNotThrow(() => JSON.parse(result.stdout));
		}),
	);

	it.effect("validate never draws, even for a person on a terminal", () =>
		Effect.gen(function* () {
			const ui = yield* CliUiTest.session({ columns: 120 });
			const handle = yield* MemoryFileSystem.makeHandle({
				...staleSeed,
				"/repo/payload.json": `${JSON.stringify({ $schema: BASIC_ID, name: "x", extra: "y" })}\n`,
			});
			const exit = yield* Effect.exit(
				run({}, deps, environment(["schema", "validate", "payload.json"], handle.layer, TERMINAL)).pipe(
					Effect.provide(ui.layer),
					Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { TERM: "xterm-256color" } }))),
				),
			);
			assert.isTrue(Exit.isSuccess(exit), String(exit));
			assert.strictEqual(yield* ui.mounts, 0);
			assert.include(yield* ui.stdout, "valid /repo/payload.json");
		}).pipe(Effect.scoped),
	);
});
