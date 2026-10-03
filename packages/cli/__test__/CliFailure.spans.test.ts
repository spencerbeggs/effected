import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Cause, ConfigProvider, Console, Context, Effect, Exit, Layer, Stdio, Terminal } from "effect";
import { Command } from "effect/cli";
import type { CliFailureOptions, FailureDetails } from "../src/index.js";
import { CliAudience, CliFailure, CliRuntime, Render } from "../src/index.js";

interface Frame {
	readonly name: string;
	readonly stack: () => string | undefined;
	readonly parent: Frame | undefined;
}

const KIT = "/home/u/.npm/lib/node_modules/reposets/node_modules/@effected/config-file/dist/ConfigFile.js:41:7";
const PNPM_KIT =
	"/repo/node_modules/.pnpm/@effected+config-file@0.14.0/node_modules/@effected/config-file/dist/index.js:12:3";
const EFFECT = "/repo/node_modules/effect/dist/esm/internal/effect.js:100:1";
const APP = "/home/u/.npm/lib/node_modules/reposets/dist/sync.js:20:5";

const at = (file: string | undefined) => () => (file === undefined ? undefined : `at file://${file}`);

/**
 * The span chain the runtime records for `reposets sync` calling `ConfigFile.discover`, which calls
 * `ConfigFile.loadFrom`: each `Effect.fn` call carries its definition as its parent, innermost first.
 */
const chain = (sites: { readonly app: string; readonly kit: string }): Frame => {
	const root: Frame = { name: "sync", stack: at(sites.app), parent: undefined };
	const rootDef: Frame = { name: "sync (definition)", stack: at(sites.app), parent: undefined };
	const sync: Frame = { ...root, parent: rootDef };
	const discoverDef: Frame = { name: "ConfigFile.discover (definition)", stack: at(sites.kit), parent: sync };
	// The program calls discover, so the call site is the program's: it is judged by its definition, in the kit.
	const discover: Frame = { name: "ConfigFile.discover", stack: at(sites.app), parent: discoverDef };
	const loadDef: Frame = { name: "ConfigFile.loadFrom (definition)", stack: at(sites.kit), parent: discover };
	return { name: "ConfigFile.loadFrom", stack: at(sites.kit), parent: loadDef };
};

const failedUnder = (frame: Frame) =>
	Cause.annotate(Cause.fail(new Error("Config validation failed")), Context.make(Cause.StackTrace, frame));

const trail = (frame: Frame, options?: CliFailureOptions): string =>
	Render.plain(CliFailure.toDoc(failedUnder(frame), options), Render.contextOf({ audience: "agent" }))
		.split("\n")
		.filter((line) => line.startsWith("in: "))
		.join("\n");

describe("CliFailure.toDoc: the span trail", () => {
	it("all is every span, outermost first, as before", () => {
		assert.strictEqual(
			trail(chain({ app: APP, kit: KIT }), { spans: "all" }),
			"in: sync (definition) > sync > ConfigFile.discover (definition) > ConfigFile.discover > ConfigFile.loadFrom (definition) > ConfigFile.loadFrom",
		);
	});

	it("app, the default, drops spans the kit defined, a kit function the program called included", () => {
		const expected = "in: sync (definition) > sync";
		assert.strictEqual(trail(chain({ app: APP, kit: KIT })), expected);
		assert.strictEqual(trail(chain({ app: APP, kit: KIT }), { spans: "app" }), expected);
		assert.strictEqual(trail(chain({ app: APP, kit: PNPM_KIT })), expected, "a pnpm store path is the kit's too");
	});

	it("app drops Effect's own spans as well", () => {
		const inner: Frame = {
			name: "effect/internal",
			stack: at(EFFECT),
			parent: { name: "mine", stack: at(APP), parent: undefined },
		};
		assert.strictEqual(trail(inner), "in: mine");
	});

	it("control: app keeps every span whose site is the program's, or not known", () => {
		const own = chain({ app: APP, kit: APP });
		assert.strictEqual(trail(own), trail(own, { spans: "all" }));
		const unknown: Frame = { name: "withSpan", stack: at(undefined), parent: undefined };
		assert.strictEqual(trail(unknown), "in: withSpan");
		const throwing: Frame = {
			name: "odd",
			stack: () => {
				throw new Error("no stack");
			},
			parent: undefined,
		};
		assert.strictEqual(trail(throwing), "in: odd");
	});

	it("app leaves no in: line when every span is the kit's", () => {
		const kitOnly: Frame = { name: "ConfigFile.loadFrom", stack: at(KIT), parent: undefined };
		assert.strictEqual(trail(kitOnly), "");
		assert.strictEqual(trail(kitOnly, { spans: "all" }), "in: ConfigFile.loadFrom");
	});

	it("off drops the trail and keeps the failure", () => {
		const doc = CliFailure.toDoc(failedUnder(chain({ app: APP, kit: KIT })), { spans: "off" });
		const text = Render.plain(doc, Render.contextOf({ audience: "agent" }));
		assert.notInclude(text, "in: ");
		assert.include(text, "Config validation failed");
	});

	it.effect("a real Effect.fn defined in this repository is the program's, so the default keeps it", () =>
		Effect.gen(function* () {
			const load = Effect.fn("load")(function* () {
				return yield* Effect.fail(new Error("nope"));
			});
			const exit = yield* Effect.exit(load());
			if (!Exit.isFailure(exit)) throw new Error("expected a failure");
			const text = Render.plain(CliFailure.toDoc(exit.cause), Render.contextOf({ audience: "agent" }));
			assert.include(text, "in: ");
			assert.include(text, "load");
		}),
	);
});

describe("CliRuntime.main's env.spans", () => {
	const platform = Layer.mergeAll(
		Stdio.layerTest({ stdinIsTerminal: Effect.succeed(false), stdoutIsTerminal: Effect.succeed(false) }),
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

	const runTool = (
		spans: "app" | "all" | "off" | undefined,
		render?: (error: unknown, details: FailureDetails) => ReadonlyArray<string>,
	) =>
		Effect.gen(function* () {
			const err: Array<string> = [];
			const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
				log: () => undefined,
				error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
			});
			const tool = Command.make("tool").pipe(
				Command.withSharedFlags(CliAudience.flags()),
				Command.withSubcommands([
					Command.make("go", {}, () => Effect.failCause(failedUnder(chain({ app: APP, kit: KIT })))),
				]),
			);
			yield* CliRuntime.main(
				CliAudience.runWith(tool, { version: "1.0.0" })(["--agent", "go"]).pipe(Effect.provide(NodeServices.layer)),
				{
					platform,
					env: spans === undefined ? {} : { spans },
					...(render === undefined ? {} : { render }),
				},
			).pipe(
				Effect.exit,
				Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
				Effect.provideService(Console.Console, double),
			);
			return err.join("\n");
		});

	it.effect("defaults to app and keeps the setting through an audience flag's rewrite of the report", () =>
		Effect.gen(function* () {
			const byDefault = yield* runTool(undefined);
			assert.include(byDefault, "Config validation failed");
			assert.include(byDefault, "in: sync (definition) > sync");
			assert.notInclude(byDefault, "ConfigFile");
			assert.include(yield* runTool("all"), "ConfigFile.loadFrom", "control: all keeps the kit's spans");
			const off = yield* runTool("off");
			assert.include(off, "Config validation failed");
			assert.notInclude(off, "in: ");
		}),
	);

	it.effect("FailureDetails.lines takes spans for its own lines, beside the run's setting", () =>
		Effect.gen(function* () {
			const seen: Array<ReadonlyArray<string>> = [];
			yield* runTool("off", (_error, details) => {
				seen.push(
					details.defaultLines,
					details.lines({ spans: "all" }),
					details.lines({ status: false, spans: "app" }),
				);
				return details.defaultLines;
			});
			const [defaults = [], all = [], app = []] = seen;
			assert.isFalse(
				defaults.some((line) => line.startsWith("in: ")),
				"the run's off",
			);
			assert.isTrue(all.some((line) => line.includes("ConfigFile.loadFrom")));
			assert.isTrue(app.some((line) => line === "in: sync (definition) > sync"));
			assert.notMatch(app[0] ?? "", /^\[FAIL\]/, "status: false still applies beside spans");
		}),
	);
});
