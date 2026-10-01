import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Console, Effect, Exit, Fiber, Layer, Runtime } from "effect";
import { Command, Flag } from "effect/cli";
import { vi } from "vitest";
import { CliInteractive, CliPrompt, CliRuntime, CliTheme, NotInteractive } from "../../src/index.js";
import { TestTerminal } from "../../src/testing.js";
import type { FakeStreams } from "../../src/ui/testing/fakeStreams.js";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
import { CliUi, Select, UiStreams } from "../../src/ui.js";
import { KEY, answer } from "../helpers/uiScript.js";

// Count loads of the peers through the kit's one loader, without changing what it does.
const { loads } = vi.hoisted(() => ({ loads: { count: 0 } }));
vi.mock("../../src/ui/internal/ink.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/ui/internal/ink.js")>();
	const { Effect } = await import("effect");
	return {
		...actual,
		loadInk: Effect.suspend(() => {
			loads.count++;
			return actual.loadInk;
		}),
	};
});

const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { double, out, err };
};

const profile = Select.screen({
	message: "Profile",
	choices: [
		{ label: "software-project", value: "software-project" },
		{ label: "library", value: "library" },
	],
});

/** A real command whose `--profile` flag falls back to a screen. */
const app = (options: { readonly otherwise?: string } = {}) =>
	Command.make("tool").pipe(
		Command.withSubcommands([
			Command.make(
				"run",
				{
					profile: Flag.String("profile").pipe(
						Flag.withFallbackPrompt(CliUi.fallback(profile, { flag: "profile", ...options })),
					),
				},
				({ profile }) => Console.log(`profile=${profile}`),
			),
		]),
	);

/** Run argv through `CliRuntime.main`, with screens on `fake`; `theme: false` leaves CliTheme out of the parse. */
const run = (
	root: ReturnType<typeof app>,
	argv: ReadonlyArray<string>,
	options: { readonly interactive: boolean; readonly fake: FakeStreams; readonly theme?: boolean },
) =>
	Effect.gen(function* () {
		const { double, out, err } = capturing();
		const terminal = yield* TestTerminal.make();
		const main = CliRuntime.main(Command.runWith(root, { version: "1.0.0" })(argv), {
			platform: Layer.mergeAll(NodeServices.layer, CliPrompt.gateTerminal.pipe(Layer.provide(terminal.layer))),
		});
		const exit = yield* (options.theme === false ? main : main.pipe(Effect.provide(CliTheme.layerTest()))).pipe(
			Effect.provide(CliInteractive.layerTest(options.interactive)),
			Effect.provideService(UiStreams, options.fake.streams),
			Effect.exit,
			Effect.provideService(Console.Console, double),
		);
		const code = Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;
		return { out, err, code };
	});

describe("CliUi.fallback", () => {
	it.live("the flag given: the screen never mounts and Ink is never loaded", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const before = loads.count;
			const { out, code } = yield* run(app(), ["run", "--profile", "library"], { interactive: true, fake });
			assert.strictEqual(code, 0);
			assert.deepStrictEqual(out, ["profile=library"]);
			assert.deepStrictEqual(fake.rawModes, []);
			assert.strictEqual(loads.count, before);
		}),
	);

	it.live("the flag absent, interactive: the screen mounts and its answer is the flag's value", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const before = loads.count;
			const script = yield* Effect.forkChild(answer(fake, [{ when: "Profile", send: [KEY.down, KEY.enter] }]));
			const { out, code } = yield* run(app({ otherwise: "software-project" }), ["run"], { interactive: true, fake });
			yield* Fiber.join(script);
			assert.strictEqual(code, 0);
			assert.deepStrictEqual(out, ["profile=library"]);
			assert.isAbove(loads.count, before, "control: an interactive fallback does load Ink");
			assert.strictEqual(fake.rawModes.at(-1), false, "raw mode is off again");
		}),
	);

	it.live("not interactive with otherwise: the default is the value, nothing mounts, Ink is never loaded", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const before = loads.count;
			const { out, code } = yield* run(app({ otherwise: "software-project" }), ["run"], { interactive: false, fake });
			assert.strictEqual(code, 0);
			assert.deepStrictEqual(out, ["profile=software-project"]);
			assert.deepStrictEqual(fake.rawModes, []);
			assert.strictEqual(fake.stdout(), "");
			assert.strictEqual(loads.count, before);
		}),
	);

	it.live("not interactive without otherwise: core's missing-flag error, exit 64, Ink never loaded", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const before = loads.count;
			const { out, err, code } = yield* run(app(), ["run"], { interactive: false, fake });
			assert.strictEqual(code, 64);
			assert.isFalse(out.some((line) => line.includes("profile=")));
			assert.isTrue(
				err.some((line) => line.includes("Missing required flag: --profile")),
				err.join("\n"),
			);
			assert.strictEqual(loads.count, before);
		}),
	);

	it.live("no CliTheme around the parse counts as not interactive, even with CliInteractive on", () =>
		Effect.gen(function* () {
			const before = loads.count;
			const fake = makeFakeStreams();
			const given = yield* run(app({ otherwise: "software-project" }), ["run"], {
				interactive: true,
				fake,
				theme: false,
			});
			assert.deepStrictEqual(given.out, ["profile=software-project"]);
			const missing = yield* run(app(), ["run"], { interactive: true, fake, theme: false });
			assert.strictEqual(missing.code, 64);
			assert.deepStrictEqual(fake.rawModes, []);
			assert.strictEqual(loads.count, before);
		}),
	);

	it.live("Esc on the screen: exit 130, one line on stderr, and the handler never runs", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const script = yield* Effect.forkChild(answer(fake, [{ when: "Profile", send: [KEY.escape] }]));
			const { out, err, code } = yield* run(app({ otherwise: "software-project" }), ["run"], {
				interactive: true,
				fake,
			});
			yield* Fiber.join(script);
			assert.strictEqual(code, 130, "a cancel is not a usage error: core's parse step never saw it as one");
			assert.deepStrictEqual(err, ["cancelled; nothing written"]);
			assert.deepStrictEqual(out, []);
		}),
	);

	it.live("Ctrl-C on the screen: exit 130 too", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const script = yield* Effect.forkChild(answer(fake, [{ when: "Profile", send: [KEY.ctrlC] }]));
			const { err, code } = yield* run(app(), ["run"], { interactive: true, fake });
			yield* Fiber.join(script);
			assert.strictEqual(code, 130);
			assert.deepStrictEqual(err, ["cancelled; nothing written"]);
		}),
	);
});

describe("CliUi.prompt", () => {
	it.effect("not interactive: otherwise when given, else NotInteractive, and Ink is never loaded", () =>
		Effect.gen(function* () {
			const before = loads.count;
			const given = yield* CliUi.prompt(profile, { otherwise: "library" });
			assert.strictEqual(given, "library");
			const error = yield* Effect.flip(CliUi.prompt(profile));
			assert.instanceOf(error, NotInteractive);
			const undefinedOtherwise = yield* Effect.flip(CliUi.prompt(profile, {}));
			assert.instanceOf(undefinedOtherwise, NotInteractive);
			assert.strictEqual(loads.count, before);
		}).pipe(Effect.provide(CliTheme.layerTest()), Effect.provide(CliInteractive.layerTest(false))),
	);
});
