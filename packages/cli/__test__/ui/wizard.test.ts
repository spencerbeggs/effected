import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Console, Effect, Exit, Fiber, Layer, Runtime } from "effect";
import { Command } from "effect/cli";
import { vi } from "vitest";
import { CliInteractive, CliPrompt, CliRuntime, CliTheme } from "../../src/index.js";
import { TestTerminal } from "../../src/testing.js";
import type { FakeStreams } from "../../src/ui/testing/fakeStreams.js";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
import { CliUi, Select, TextInput, UiStreams } from "../../src/ui.js";
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

const PROFILES = ["software-project", "library"] as const;
const LOCATIONS = [".config/okfit.toml", "package.json"] as const;

/** okfit's discovery: what the repository already says, found before anything is asked. */
const discover = Effect.sync(() => ({ profile: "library", dir: "docs/okf", location: "package.json" }));

/** okfit's init: discovery first, then profile, bundle directory and config location, each defaulted from it. */
const init = Command.make("init", {}, () =>
	Effect.gen(function* () {
		const found = yield* discover;
		const profile = yield* CliUi.prompt(
			Select.screen({
				message: "Profile",
				choices: PROFILES.map((value) => ({ label: value, value: value as string })),
				initial: PROFILES.indexOf(found.profile as (typeof PROFILES)[number]),
			}),
			{ otherwise: found.profile },
		);
		const dir = yield* CliUi.prompt(TextInput.screen({ message: "Bundle directory", initial: found.dir }), {
			otherwise: found.dir,
		});
		const location = yield* CliUi.prompt(
			Select.screen({
				message: "Config location",
				choices: LOCATIONS.map((value) => ({ label: value, value: value as string })),
				initial: LOCATIONS.indexOf(found.location as (typeof LOCATIONS)[number]),
			}),
			{ otherwise: found.location },
		);
		yield* Console.log(JSON.stringify({ profile, dir, location }));
	}),
);

const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { double, out, err };
};

const run = (options: { readonly interactive: boolean; readonly fake: FakeStreams }) =>
	Effect.gen(function* () {
		const { double, out, err } = capturing();
		const terminal = yield* TestTerminal.make();
		const exit = yield* CliRuntime.main(Command.runWith(init, { version: "1.0.0" })([]), {
			platform: Layer.mergeAll(NodeServices.layer, CliPrompt.gateTerminal.pipe(Layer.provide(terminal.layer))),
		}).pipe(
			Effect.provide(CliTheme.layerTest()),
			Effect.provide(CliInteractive.layerTest(options.interactive)),
			Effect.provideService(UiStreams, options.fake.streams),
			Effect.exit,
			Effect.provideService(Console.Console, double),
		);
		const code = Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;
		return { out, err, code };
	});

describe("okfit's init wizard through CliUi.prompt", () => {
	it.live("interactive: each screen starts on the discovered default, and the answers flow through", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const script = yield* Effect.forkChild(
				answer(fake, [
					{ when: "Profile", send: [KEY.up, KEY.enter] },
					{ when: "Bundle directory", send: ["2", KEY.enter] },
					{ when: "Config location", send: [KEY.up, KEY.enter] },
				]),
			);
			const { out, err, code } = yield* run({ interactive: true, fake });
			yield* Fiber.join(script);
			assert.strictEqual(code, 0, err.join("\n"));
			assert.deepStrictEqual(out, [
				JSON.stringify({ profile: "software-project", dir: "docs/okf2", location: ".config/okfit.toml" }),
			]);
		}),
	);

	it.live("not interactive: the discovered defaults, byte-identical, with nothing mounted and Ink never loaded", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const before = loads.count;
			const { out, code } = yield* run({ interactive: false, fake });
			assert.strictEqual(code, 0);
			assert.deepStrictEqual(out, [JSON.stringify(yield* discover)]);
			assert.deepStrictEqual(fake.rawModes, []);
			assert.strictEqual(fake.stdout(), "");
			assert.strictEqual(loads.count, before);
		}),
	);

	it.live("Esc on the second screen: exit 130, and the third screen never mounts", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const script = yield* Effect.forkChild(
				answer(fake, [
					{ when: "Profile", send: [KEY.enter] },
					{ when: "Bundle directory", send: [KEY.escape] },
				]),
			);
			const { out, err, code } = yield* run({ interactive: true, fake });
			yield* Fiber.join(script);
			assert.strictEqual(code, 130);
			assert.deepStrictEqual(err, ["cancelled; nothing written"]);
			assert.deepStrictEqual(out, [], "the handler wrote nothing");
			assert.include(fake.stdout(), "Bundle directory", "control: the second screen did mount");
			assert.notInclude(fake.stdout(), "Config location");
			assert.strictEqual(fake.rawModes.filter((mode) => mode).length, 2, "two screens mounted, not three");
		}),
	);
});
