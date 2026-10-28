// CliFormat: a --format flag with the kit's default, and the one print that honours it.
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { AudienceKind } from "@effected/env";
import { Audience, CurrentRuntimeEnv, TerminalEnv } from "@effected/env";
import { Cause, Console, Effect, Exit, Layer, Option, Runtime } from "effect";
import type { Flag } from "effect/cli";
import { Command } from "effect/cli";
import { CliFormat, CliLinks, CliRuntime, CliTheme, Doc } from "../src/index.js";

const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { double, out, err };
};

const layers = (audience: AudienceKind, actions = false) => {
	const terminal = TerminalEnv.layerTest({ stdinIsTerminal: false, stdout: { isTerminal: false, color: "none" } });
	return Layer.mergeAll(
		terminal,
		CliTheme.layer({ glyphs: "unicode" }).pipe(Layer.provide(terminal)),
		Audience.layerTest(audience),
		CliLinks.layerTest("off"),
		actions ? CurrentRuntimeEnv.layerTest({ ci: Option.some("github-actions") }) : Layer.empty,
	);
};

const output = {
	doc: () => [Doc.heading(1, "Doctor"), Doc.paragraph("all ", Doc.strong("good"))],
	json: () => ({ ok: true, note: "##[error] not a command" }),
};

const printed = (format: Parameters<typeof CliFormat.print>[0], audience: AudienceKind = "human", actions = false) =>
	Effect.gen(function* () {
		const { double, out, err } = capturing();
		const exit = yield* CliFormat.print(format, output).pipe(
			Effect.provide(layers(audience, actions)),
			Effect.provideService(Console.Console, double),
			Effect.exit,
		);
		return { exit, out: out.join("\n"), err: err.join("\n") };
	});

describe("CliFormat.print", () => {
	it.effect("json writes the data, indented by two, on stdout", () =>
		Effect.gen(function* () {
			const { out, err } = yield* printed("json");
			assert.deepStrictEqual(JSON.parse(out), output.json());
			assert.include(out, '\n  "ok": true');
			assert.strictEqual(err, "");
		}),
	);

	it.effect("markdown and plain render the document; the data is never built", () =>
		Effect.gen(function* () {
			const markdown = yield* printed("markdown");
			assert.include(markdown.out, "# Doctor");
			assert.include(markdown.out, "**good**");
			const plain = yield* printed("plain");
			assert.include(plain.out, "Doctor");
			assert.notInclude(plain.out, "**good**");
		}),
	);

	it.effect("under GitHub Actions a ##[ in the JSON is escaped, and still decodes to the same data", () =>
		Effect.gen(function* () {
			const { out } = yield* printed("json", "ci", true);
			assert.notInclude(out, "##[");
			assert.deepStrictEqual(JSON.parse(out), output.json());
			const control = yield* printed("json", "ci", false);
			assert.include(control.out, "##[", "control: untouched outside Actions");
		}),
	);

	it.effect("json with no json output, or data JSON cannot hold, is a defect", () =>
		Effect.gen(function* () {
			const missing = yield* CliFormat.print("json", { doc: output.doc }).pipe(
				Effect.provide(layers("human")),
				Effect.exit,
			);
			assert.isTrue(Exit.hasDies(missing));
			const cycle: Record<string, unknown> = {};
			cycle.self = cycle;
			const bad = yield* CliFormat.print("json", { doc: output.doc, json: () => cycle }).pipe(
				Effect.provide(layers("human")),
				Effect.exit,
			);
			assert.isTrue(Exit.hasDies(bad));
		}),
	);

	it.effect("stderr writes there", () =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			yield* CliFormat.print("json", output, { stream: "stderr", indent: 0 }).pipe(
				Effect.provide(layers("human")),
				Effect.provideService(Console.Console, double),
			);
			assert.deepStrictEqual(out, []);
			assert.deepStrictEqual(err, [JSON.stringify(output.json())]);
		}),
	);
});

describe("CliFormat.printJson", () => {
	const captured = (effect: Effect.Effect<void>, actions = false) =>
		Effect.gen(function* () {
			const { double, out, err } = capturing();
			const exit = yield* effect.pipe(
				actions ? Effect.provide(CurrentRuntimeEnv.layerTest({ ci: Option.some("github-actions") })) : (e) => e,
				Effect.provideService(Console.Console, double),
				Effect.exit,
			);
			return { exit, out, err };
		});

	it.effect("needs no presentation services, and writes what print writes for json, byte for byte", () =>
		Effect.gen(function* () {
			for (const actions of [false, true]) {
				const alone = yield* captured(CliFormat.printJson(output.json()), actions);
				const viaPrint = yield* printed("json", "ci", actions);
				assert.lengthOf(alone.out, 1, "one document, one write");
				assert.strictEqual(alone.out[0], viaPrint.out);
			}
		}),
	);

	it.effect("escapes ##[ under GitHub Actions only, and honours stream and indent", () =>
		Effect.gen(function* () {
			const actions = yield* captured(CliFormat.printJson(output.json()), true);
			assert.notInclude(actions.out[0] ?? "", "##[");
			assert.deepStrictEqual(JSON.parse(actions.out[0] ?? ""), output.json());
			const plain = yield* captured(CliFormat.printJson(output.json()));
			assert.include(plain.out[0] ?? "", "##[", "control: untouched outside Actions");
			const err = yield* captured(CliFormat.printJson([1, 2], { stream: "stderr", indent: 0 }));
			assert.deepStrictEqual(err.out, []);
			assert.deepStrictEqual(err.err, ["[1,2]"]);
		}),
	);

	it.effect("a value JSON cannot hold is a defect", () =>
		Effect.gen(function* () {
			const cycle: Record<string, unknown> = {};
			cycle.self = cycle;
			for (const value of [cycle, 1n, undefined]) {
				const { exit, out } = yield* captured(CliFormat.printJson(value));
				assert.isTrue(Exit.hasDies(exit));
				assert.deepStrictEqual(out, []);
			}
		}),
	);
});

describe("CliFormat.flag", () => {
	const parsed = (flag: Flag.Flag<string>, argv: ReadonlyArray<string>) =>
		Effect.gen(function* () {
			let seen: string | undefined;
			const command = Command.make("tool", { format: flag }, ({ format }) =>
				Effect.sync(() => {
					seen = format;
				}),
			);
			const { double, out, err } = capturing();
			const exit = yield* Command.runWith(command, { version: "1.0.0" })(argv).pipe(
				Effect.provide(NodeServices.layer),
				Effect.provideService(Console.Console, double),
				Effect.exit,
			);
			return { seen, exit, out: out.join("\n"), err: err.join("\n") };
		});

	it.effect("defaults to auto when offered, otherwise the first, and an explicit default wins", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* parsed(CliFormat.flag(["json", "auto"]), [])).seen, "auto");
			assert.strictEqual((yield* parsed(CliFormat.flag(["markdown", "json"]), [])).seen, "markdown");
			assert.strictEqual((yield* parsed(CliFormat.flag(["markdown", "json"], { default: "json" }), [])).seen, "json");
		}),
	);

	it.effect("accepts an offered format and refuses any other as a usage error", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* parsed(CliFormat.flag(["auto", "json"]), ["--format", "json"])).seen, "json");
			const refused = yield* parsed(CliFormat.flag(["auto", "json"]), ["--format", "yaml"]);
			assert.isUndefined(refused.seen);
			assert.isTrue(Exit.isFailure(refused.exit));
		}),
	);

	it.effect("takes another name", () =>
		Effect.gen(function* () {
			assert.strictEqual(
				(yield* parsed(CliFormat.flag(["auto", "json"], { name: "output" }), ["--output", "json"])).seen,
				"json",
			);
		}),
	);

	it.effect("an alias offers the caller's name for a built-in format, and yields the built-in", () =>
		Effect.gen(function* () {
			const flag = CliFormat.flag(["json"], { aliases: { human: "auto" }, default: "human" });
			assert.strictEqual((yield* parsed(flag, [])).seen, "auto");
			assert.strictEqual((yield* parsed(flag, ["--format", "human"])).seen, "auto");
			assert.strictEqual((yield* parsed(flag, ["--format", "json"])).seen, "json");
			const refused = yield* parsed(flag, ["--format", "auto"]);
			assert.isUndefined(refused.seen, "the target is not offered under its own name unless listed");
			assert.isTrue(Exit.isFailure(refused.exit));
		}),
	);

	it.effect("a custom format is offered and yielded as itself", () =>
		Effect.gen(function* () {
			const flag = CliFormat.flag(["json"], { custom: ["mermaid", "dot"], default: "mermaid" });
			assert.strictEqual((yield* parsed(flag, [])).seen, "mermaid");
			assert.strictEqual((yield* parsed(flag, ["--format", "dot"])).seen, "dot");
			assert.strictEqual((yield* parsed(flag, ["--format", "json"])).seen, "json");
			const help = yield* parsed(flag, ["--help"]);
			assert.include(help.out, "json, mermaid, dot (default mermaid)");
		}),
	);

	it("clashing names, an unoffered default, and legacyJson without json are programming mistakes", () => {
		assert.throws(() => CliFormat.flag(["json"], { aliases: { auto: "json" } as never }), /built-in format/);
		assert.throws(() => CliFormat.flag(["json"], { custom: ["plain"] as never }), /built-in format/);
		assert.throws(() => CliFormat.flag(["json"], { aliases: { human: "auto" }, custom: ["human"] }), /offered twice/);
		assert.throws(() => CliFormat.flag(["json", "json"]), /offered twice/);
		assert.throws(() => CliFormat.flag(["json"], { default: "auto" as never }), /not one of/);
		assert.throws(() => CliFormat.flag(["auto", "plain"], { legacyJson: true }), /yields json/);
		assert.throws(() => CliFormat.flag(["auto", "json"], { legacyJson: { name: "format" } }), /cannot also be/);
		// control: the same options, untangled, construct
		CliFormat.flag(["json"], { aliases: { human: "auto" }, custom: ["dot"], default: "human" });
		CliFormat.flag(["auto"], { aliases: { machine: "json" }, legacyJson: true });
	});
});

describe("CliFormat.flag legacyJson", () => {
	const parsed = (flag: Flag.Flag<string>, argv: ReadonlyArray<string>) =>
		Effect.gen(function* () {
			let seen: string | undefined;
			const command = Command.make("tool", { format: flag }, ({ format }) =>
				Effect.sync(() => {
					seen = format;
				}),
			);
			const { double, out, err } = capturing();
			const exit = yield* Command.runWith(command, { version: "1.0.0" })(argv).pipe(
				Effect.provide(NodeServices.layer),
				Effect.provideService(Console.Console, double),
				Effect.exit,
			);
			return { seen, exit, out: out.join("\n"), err: err.join("\n") };
		});
	const upgrade = CliFormat.flag(["auto", "json"], { legacyJson: true });

	it.effect("control: without legacyJson, --json is an unknown flag", () =>
		Effect.gen(function* () {
			const refused = yield* parsed(CliFormat.flag(["auto", "json"]), ["--json"]);
			assert.isUndefined(refused.seen);
			assert.isTrue(Exit.isFailure(refused.exit));
		}),
	);

	it.effect("--json is --format json, with a deprecation notice on stderr and none on stdout", () =>
		Effect.gen(function* () {
			const run = yield* parsed(upgrade, ["--json"]);
			assert.isTrue(Exit.isSuccess(run.exit));
			assert.strictEqual(run.seen, "json");
			assert.strictEqual(run.err, "warning: --json is deprecated; use --format json");
			assert.strictEqual(run.out, "");
		}),
	);

	it.effect("absent, the format flag and its default behave as before, and no notice is written", () =>
		Effect.gen(function* () {
			const none = yield* parsed(upgrade, []);
			assert.strictEqual(none.seen, "auto");
			assert.strictEqual(none.err, "");
			const chosen = yield* parsed(upgrade, ["--format", "json"]);
			assert.strictEqual(chosen.seen, "json");
			assert.strictEqual(chosen.err, "");
			const refused = yield* parsed(upgrade, ["--format", "yaml"]);
			assert.isUndefined(refused.seen);
			assert.isTrue(Exit.isFailure(refused.exit));
		}),
	);

	it.effect("--json together with --format, whatever the format, is a usage error naming both", () =>
		Effect.gen(function* () {
			for (const argv of [
				["--json", "--format", "auto"],
				["--format", "json", "--json"],
			]) {
				const run = yield* parsed(upgrade, argv);
				assert.isUndefined(run.seen, argv.join(" "));
				assert.isTrue(Exit.isFailure(run.exit), argv.join(" "));
				assert.include(run.err, "--json means --format json: give one of them, not both", argv.join(" "));
				assert.notInclude(run.err, "deprecated");
			}
		}),
	);

	it.effect("the retired flag is hidden from help, has no --no-json, and a second --json is refused", () =>
		Effect.gen(function* () {
			const help = yield* parsed(upgrade, ["--help"]);
			assert.include(help.out, "--format");
			assert.notInclude(help.out, "--json");
			const negated = yield* parsed(upgrade, ["--no-json"]);
			assert.isUndefined(negated.seen);
			assert.isTrue(Exit.isFailure(negated.exit));
			const twice = yield* parsed(upgrade, ["--json", "--json"]);
			assert.isUndefined(twice.seen);
			assert.isTrue(Exit.isFailure(twice.exit));
		}),
	);

	it.effect("takes another name for the retired flag and can stay silent, and an alias for json works", () =>
		Effect.gen(function* () {
			const named = CliFormat.flag(["auto"], {
				aliases: { machine: "json" },
				name: "output",
				legacyJson: { name: "as-json", notice: false },
			});
			const run = yield* parsed(named, ["--as-json"]);
			assert.strictEqual(run.seen, "json");
			assert.strictEqual(run.err, "");
			assert.strictEqual((yield* parsed(named, ["--output", "machine"])).seen, "json");
			const both = yield* parsed(named, ["--as-json", "--output", "auto"]);
			assert.include(both.err, "--as-json means --output json");
		}),
	);

	it.effect("under CliRuntime.main, --json with --format exits 64, the usage code", () =>
		Effect.gen(function* () {
			const command = Command.make("tool", { format: upgrade }, () => Effect.void);
			const run = (argv: ReadonlyArray<string>) =>
				CliRuntime.main(Command.runWith(command, { version: "1.0.0" })(argv), { platform: NodeServices.layer }).pipe(
					Effect.exit,
					Effect.provideService(Console.Console, capturing().double),
				);
			const both = yield* run(["--json", "--format", "json"]);
			assert.isTrue(Exit.isFailure(both));
			if (Exit.isFailure(both)) assert.strictEqual(Runtime.getErrorExitCode(Cause.squash(both.cause)), 64);
			else assert.fail("expected a usage failure");
			assert.isTrue(Exit.isSuccess(yield* run(["--json"])), "control: --json alone succeeds");
		}),
	);
});
