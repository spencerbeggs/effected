// CliFormat: a --format flag with the kit's default, and the one print that honours it.
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { AudienceKind } from "@effected/env";
import { Audience, CurrentRuntimeEnv, TerminalEnv } from "@effected/env";
import { Console, Effect, Exit, Layer, Option } from "effect";
import { Command } from "effect/cli";
import { CliFormat, CliLinks, CliTheme, Doc } from "../src/index.js";

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

describe("CliFormat.flag", () => {
	const parsed = (flag: ReturnType<typeof CliFormat.flag>, argv: ReadonlyArray<string>) =>
		Effect.gen(function* () {
			let seen: string | undefined;
			const command = Command.make("tool", { format: flag }, ({ format }) =>
				Effect.sync(() => {
					seen = format;
				}),
			);
			const { double, err } = capturing();
			const exit = yield* Command.runWith(command, { version: "1.0.0" })(argv).pipe(
				Effect.provide(NodeServices.layer),
				Effect.provideService(Console.Console, double),
				Effect.exit,
			);
			return { seen, exit, err: err.join("\n") };
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
});
