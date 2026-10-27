// CliRuntime.main's exitCodes map, FailureDetails.exitCode/tag, the distribution option, and env.displayPath's
// `relativeTo` reaching Doc.print.
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { CurrentDistribution } from "@effected/engine";
import {
	Cause,
	ConfigProvider,
	Console,
	Data,
	Effect,
	Exit,
	Layer,
	Option,
	Path,
	Predicate,
	Runtime,
	Stdio,
	Terminal,
} from "effect";
import { Command } from "effect/cli";
import type { FailureDetails } from "../src/index.js";
import { CliRuntime, Doc } from "../src/index.js";
import { relativeTo } from "../src/internal/displayPath.js";

class DataStoreError extends Data.TaggedError("DataStoreError")<{ readonly message: string }> {}
class SidecarTimeoutError extends Data.TaggedError("SidecarTimeoutError")<{ readonly message: string }> {}
class Unmapped extends Data.TaggedError("Unmapped")<{ readonly message: string }> {}
class Inherited extends Data.TaggedError("constructor")<{ readonly message: string }> {}
class ToString extends Data.TaggedError("toString")<{ readonly message: string }> {}

const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { double, out, err };
};

const codeOf = <A>(exit: Exit.Exit<A, unknown>): number =>
	Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;

const exitCodes = { DataStoreError: 3, SidecarTimeoutError: 2 } as const;

const mainOf = <E>(program: Effect.Effect<void, E>, render?: (error: unknown, details: FailureDetails) => string) =>
	Effect.gen(function* () {
		const { double, err } = capturing();
		const exit = yield* CliRuntime.main(program, {
			platform: Layer.empty,
			exitCodes,
			exitCode: 5,
			...(render === undefined ? {} : { render }),
		}).pipe(Effect.exit, Effect.provideService(Console.Console, double));
		return { code: codeOf(exit), err };
	});

describe("exitCodes", () => {
	it.effect("a typed failure exits with its tag's code", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* mainOf(Effect.fail(new DataStoreError({ message: "locked" })))).code, 3);
			assert.strictEqual((yield* mainOf(Effect.fail(new SidecarTimeoutError({ message: "slow" })))).code, 2);
		}),
	);

	it.effect("an unmapped tag and a defect exit with the exitCode fallback", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* mainOf(Effect.fail(new Unmapped({ message: "x" })))).code, 5);
			assert.strictEqual((yield* mainOf(Effect.die(new Error("boom")))).code, 5);
		}),
	);

	it.effect("a tag naming an inherited property of the map (constructor, toString) is not a key of it", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* mainOf(Effect.fail(new Inherited({ message: "x" })))).code, 5);
			assert.strictEqual((yield* mainOf(Effect.fail(new ToString({ message: "x" })))).code, 5);
		}),
	);

	it.effect("a defect carrying a mapped tag is not looked up: only typed failures are", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* mainOf(Effect.die(new DataStoreError({ message: "as a defect" })))).code, 5);
		}),
	);

	it.effect("the error's own marker wins over the map", () =>
		Effect.gen(function* () {
			const marked = CliRuntime.reported(new DataStoreError({ message: "chose 7" }), 7);
			assert.strictEqual((yield* mainOf(Effect.fail(marked))).code, 7);
		}),
	);

	it.effect("render sees the code, reads the tag off the error, and can print a fixed stderr shape", () =>
		Effect.gen(function* () {
			const render = (error: unknown, details: FailureDetails) => {
				const tag = Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag) ? error._tag : "Defect";
				return `${details.exitCode} ${tag}: ${(error as { message?: string }).message ?? ""}`;
			};
			const typed = yield* mainOf(Effect.fail(new DataStoreError({ message: "database is locked" })), render);
			assert.deepStrictEqual(typed.err, ["3 DataStoreError: database is locked"]);
			assert.strictEqual(typed.code, 3);
			const defect = yield* mainOf(Effect.die(new Error("boom")), render);
			assert.deepStrictEqual(defect.err, ["5 Defect: boom"]);
		}),
	);

	it("refuses a code outside 1..255 when the options are passed", () => {
		for (const code of [0, 256, 1.5, -1, Number.NaN]) {
			assert.throws(() => CliRuntime.reportFailures({ exitCodes: { X: code } }), RangeError, undefined, String(code));
		}
		assert.doesNotThrow(() => CliRuntime.reportFailures({ exitCodes: { X: 1, Y: 255 } }));
	});
});

const root = Command.make("tool", {}, () =>
	Effect.gen(function* () {
		const carrier = yield* CurrentDistribution;
		yield* Console.log(
			`carrier=${Option.match(carrier, { onNone: () => "none", onSome: (d) => `${d.name}@${d.version}` })}`,
		);
	}),
);

const runTool = (argv: ReadonlyArray<string>, distribution?: { name: string; version: string } | null) =>
	Effect.gen(function* () {
		const { double, out } = capturing();
		yield* CliRuntime.main(Command.runWith(root, { version: "1.2.3" })(argv), {
			platform: NodeServices.layer,
			...(distribution === undefined ? {} : { distribution }),
		}).pipe(Effect.exit, Effect.provideService(Console.Console, double));
		return out.join("\n");
	});

const strip = (text: string): string => text.replace(new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g"), "");

describe("distribution", () => {
	it.effect("--version names the carrier after the version line in effect", () =>
		Effect.gen(function* () {
			const version = strip(yield* runTool(["--version"], { name: "@scope/plugin", version: "9.0.0" }));
			assert.match(version, /tool v?1\.2\.3 via @scope\/plugin 9\.0\.0$/);
			const plain = strip(yield* runTool(["--version"]));
			assert.notInclude(plain, " via ", "control: no suffix without the option");
			assert.include(plain, "1.2.3");
		}),
	);

	it.effect("the program reads CurrentDistribution: the carrier, none for null", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* runTool([], { name: "carrier", version: "2.0.0" }), "carrier=carrier@2.0.0");
			assert.strictEqual(yield* runTool([], null), "carrier=none");
			const version = strip(yield* runTool(["--version"], null));
			assert.notInclude(version, " via ", "a direct install has no suffix");
		}),
	);
});

describe("env.displayPath: { relativeTo }", () => {
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
		Path.layer,
	);
	const doc = [
		Doc.paragraph(Doc.file("/repo/src/a.ts")),
		Doc.paragraph(Doc.file("/elsewhere/b.ts")),
		Doc.paragraph(Doc.file("/repo")),
	];

	it.effect("Doc.print under main shows a path under the root relative, and the root and outside paths absolute", () =>
		Effect.gen(function* () {
			const { double, out } = capturing();
			yield* CliRuntime.main(Doc.print(doc), { platform, env: { displayPath: { relativeTo: "/repo" } } }).pipe(
				Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ AI_AGENT: "x" })),
				Effect.provideService(Console.Console, double),
			);
			const text = out.join("\n");
			assert.include(text, "src/a.ts");
			assert.notInclude(text, "/repo/src/a.ts");
			assert.include(text, "/elsewhere/b.ts");
			assert.match(text, /^\/repo$/m);
		}),
	);

	it.effect("control: without the option Doc.print shows the absolute path", () =>
		Effect.gen(function* () {
			const { double, out } = capturing();
			yield* CliRuntime.main(Doc.print(doc), { platform, env: {} }).pipe(
				Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ AI_AGENT: "x" })),
				Effect.provideService(Console.Console, double),
			);
			assert.include(out.join("\n"), "/repo/src/a.ts");
		}),
	);

	it.effect("relativeTo with Path and without it agree on POSIX paths", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const withPath = relativeTo("/repo", Option.some(path));
			const without = relativeTo("/repo/", Option.none());
			for (const [input, expected] of [
				["/repo/src/a.ts", "src/a.ts"],
				["/repo", "/repo"],
				["/repository/x", "/repository/x"],
				["/other/x", "/other/x"],
				["/repo/..hidden", "..hidden"],
				["/repo/", "/repo/"],
			] as const) {
				assert.strictEqual(withPath(input), expected, `Path: ${input}`);
				assert.strictEqual(without(input), expected, `prefix: ${input}`);
			}
		}).pipe(Effect.provide(Path.layer)),
	);
});
