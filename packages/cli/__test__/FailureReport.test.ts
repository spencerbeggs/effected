import { assert, describe, it } from "@effect/vitest";
import type { AudienceKind } from "@effected/env";
import { Audience, TerminalEnv } from "@effected/env";
import { Cause, ConfigProvider, Console, Effect, Layer, Stdio, Terminal } from "effect";
import type { Document } from "../src/index.js";
import { CliDoc, CliLinks, CliRuntime, CliTheme, Doc, Render } from "../src/index.js";
import { commandLines } from "./helpers/runnerCommands.js";

const ESC = String.fromCharCode(0x1b);

const platform = Layer.mergeAll(
	Stdio.layerTest({ stdinIsTerminal: Effect.succeed(true), stdoutIsTerminal: Effect.succeed(true) }),
	Layer.succeed(
		Terminal.Terminal,
		Terminal.make({
			columns: Effect.succeed(100),
			rows: Effect.succeed(24),
			readInput: Effect.die("unused"),
			readLine: Effect.die("unused"),
			display: () => Effect.void,
		}),
	),
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

const USER = "/repo/src/run.ts";
const dying = (message: string) =>
	Effect.suspend(() => {
		const error = new Error(message);
		error.stack = `Error: ${message}\n    at run (${USER}:3:4)`;
		return Effect.die(error);
	});

const layers = (audience: AudienceKind) => {
	const terminal = TerminalEnv.layerTest({
		stdinIsTerminal: true,
		stdout: { isTerminal: true, color: "none" },
	});
	return Layer.mergeAll(
		terminal,
		CliTheme.layer({ glyphs: "unicode" }).pipe(Layer.provide(terminal)),
		Audience.layerTest(audience),
		CliLinks.layerTest("vscode"),
	);
};

describe("the report's last resort keeps the output policy", () => {
	/** A document whose block the renderer has no case for: the walker throws on it. */
	class Broken extends Error {
		[CliDoc](): Document {
			return [{ _tag: "NotABlock" } as never];
		}
	}

	it("control: the renderer really does throw on that document", () => {
		const ctx = Effect.runSync(Render.context("stderr").pipe(Effect.provide(layers("agent"))));
		assert.throws(() => Render.plain([{ _tag: "NotABlock" } as never], ctx));
	});

	it.effect("when the document cannot be rendered at all, the report is one sanitised, neutralized line", () =>
		Effect.gen(function* () {
			for (const env of [{ AI_AGENT: "x" }, { GITHUB_ACTIONS: "true" }, {}]) {
				const { double, err } = capturing();
				const message = `bad${ESC}[31m red ${ESC}]8;;http://evil\u0007x\r::error::injected\n##[add-mask]y`;
				yield* CliRuntime.main(
					Effect.suspend(() => Effect.fail(new Broken(message))),
					{
						platform,
						env: {},
					},
				).pipe(
					Effect.exit,
					Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env)),
					Effect.provideService(Console.Console, double),
				);
				const text = err.join("\n");
				assert.isAbove(err.length, 0, JSON.stringify(env));
				assert.notInclude(text, ESC, JSON.stringify(env));
				assert.notInclude(text, "\u0007", JSON.stringify(env));
				assert.notInclude(text, "evil", JSON.stringify(env));
				assert.deepStrictEqual(commandLines(text), [], JSON.stringify(env));
				assert.include(text, "injected", "the text itself is kept");
			}
		}),
	);
});

describe("Doc.print forwards displayPath and width", () => {
	const doc: Document = [
		Doc.paragraph("open ", Doc.link({ file: `${USER}`, line: 3, col: 4 }, "x")),
		Doc.paragraph(Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")),
	];

	const print = (audience: AudienceKind, options: Parameters<typeof Doc.print>[1]) =>
		Effect.gen(function* () {
			const { double, out } = capturing();
			yield* Doc.print(doc, options).pipe(
				Effect.provide(layers(audience)),
				Effect.provideService(Console.Console, double),
			);
			return out.join("\n");
		});

	it.effect("displayPath is applied to the link's path", () =>
		Effect.gen(function* () {
			const text = yield* print("agent", { displayPath: (p) => p.replace("/repo/", "") });
			assert.include(text, "src/run.ts:3:4");
			assert.notInclude(text, "/repo/");
			assert.include(yield* print("agent", {}), "/repo/src/run.ts:3:4", "control: the identity without it");
		}),
	);

	it.effect("width is the context's, so an agent can be laid out at a width after all", () =>
		Effect.gen(function* () {
			const narrow = yield* print("agent", { width: 30 });
			const longest = Math.max(...narrow.split("\n").map((line) => line.length));
			assert.isAtMost(longest, 40);
			const unbounded = yield* print("agent", {});
			assert.isAbove(Math.max(...unbounded.split("\n").map((line) => line.length)), 100, "control: unbounded");
		}),
	);
});

describe("main's env.displayPath is the default report's path display", () => {
	it.effect("stack frames are shown through it", () =>
		Effect.gen(function* () {
			for (const env of [{ AI_AGENT: "x" }, { TERM: "xterm-256color" }]) {
				const { double, err } = capturing();
				yield* CliRuntime.main(dying("kaboom"), {
					platform,
					env: { displayPath: (p) => p.replace("/repo/", "") },
				}).pipe(
					Effect.exit,
					Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env)),
					Effect.provideService(Console.Console, double),
				);
				const text = err.join("\n");
				assert.include(text, "src/run.ts:3:4", JSON.stringify(env));
				assert.notInclude(text, "/repo/", JSON.stringify(env));
			}
			const { double, err } = capturing();
			yield* CliRuntime.main(dying("kaboom"), { platform, env: {} }).pipe(
				Effect.exit,
				Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ AI_AGENT: "x" })),
				Effect.provideService(Console.Console, double),
			);
			assert.include(err.join("\n"), "/repo/src/run.ts:3:4", "control: absolute without the option");
		}),
	);

	it("defaultRender is unchanged by it: plain lines of the cause", () => {
		const cause = Cause.fail(new Error("x"));
		const lines = CliRuntime.defaultRender(Cause.squash(cause), { cause, isDefect: false });
		assert.isAbove((typeof lines === "string" ? [lines] : lines).length, 0);
	});
});
