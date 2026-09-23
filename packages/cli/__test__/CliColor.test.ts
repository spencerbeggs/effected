import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Stdio } from "effect";
import { CliError, CliOutput } from "effect/unstable/cli";
import { CliColor } from "../src/index.js";

const decide = (options: {
	readonly tty: boolean;
	readonly env: Record<string, string>;
	readonly preserveEmptyStrings?: boolean;
}) =>
	CliColor.enabled.pipe(
		Effect.provide(Stdio.layerTest({ stdoutIsTerminal: Effect.succeed(options.tty) })),
		Effect.provideService(
			ConfigProvider.ConfigProvider,
			ConfigProvider.fromUnknown(options.env, { preserveEmptyStrings: options.preserveEmptyStrings }),
		),
	);

describe("CliColor.enabled", () => {
	const cases: ReadonlyArray<readonly [string, boolean, Record<string, string>, boolean]> = [
		["TTY, NO_COLOR unset", true, {}, true],
		["TTY, NO_COLOR empty — fromUnknown's default treats it as unset, same as fromEnv", true, { NO_COLOR: "" }, true],
		["TTY, NO_COLOR=1", true, { NO_COLOR: "1" }, false],
		['TTY, NO_COLOR=true (okfit\'s !== "1" rule got this wrong)', true, { NO_COLOR: "true" }, false],
		["TTY, NO_COLOR=0 — any non-empty value disables", true, { NO_COLOR: "0" }, false],
		["not a TTY, NO_COLOR unset", false, {}, false],
		["not a TTY, NO_COLOR empty", false, { NO_COLOR: "" }, false],
	];
	for (const [label, tty, env, expected] of cases) {
		it.effect(label, () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* decide({ tty, env }), expected);
			}),
		);
	}

	it.effect(
		"TTY, NO_COLOR empty with a provider that preserves empty strings — no-color.org: only non-empty disables",
		() =>
			Effect.gen(function* () {
				assert.strictEqual(yield* decide({ tty: true, env: { NO_COLOR: "" }, preserveEmptyStrings: true }), true);
			}),
	);

	it.effect("ignores FORCE_COLOR, matching core", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* decide({ tty: false, env: { FORCE_COLOR: "1" } }), false);
		}),
	);
});

describe("CliColor.formatterLayer", () => {
	const sampleErrors = [new CliError.MissingOption({ option: "--required" })];

	it.effect("applies an override while non-overridden methods still render the real default output", () =>
		Effect.gen(function* () {
			const formatter = yield* CliOutput.Formatter;
			assert.strictEqual(formatter.formatVersion("tool", "1.0.0"), "tool 1.0.0 via @scope/plugin 2.0.0");
			assert.strictEqual(
				formatter.formatErrors(sampleErrors),
				CliOutput.defaultFormatter({ colors: false }).formatErrors(sampleErrors),
			);
		}).pipe(
			Effect.provide(
				CliColor.formatterLayer({ formatVersion: (name, version) => `${name} ${version} via @scope/plugin 2.0.0` }),
			),
			Effect.provide(Stdio.layerTest({ stdoutIsTerminal: Effect.succeed(false) })),
			Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
		),
	);

	it.effect("renders identically to the plain default when stdout is not a terminal", () =>
		Effect.gen(function* () {
			const formatter = yield* CliOutput.Formatter;
			assert.strictEqual(
				formatter.formatVersion("my-awesome-tool", "1.2.3"),
				CliOutput.defaultFormatter({ colors: false }).formatVersion("my-awesome-tool", "1.2.3"),
			);
		}).pipe(
			Effect.provide(CliColor.formatterLayer()),
			Effect.provide(Stdio.layerTest({ stdoutIsTerminal: Effect.succeed(false) })),
			Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
		),
	);

	it.effect("renders identically to the coloured default when stdout is a terminal and NO_COLOR is unset", () =>
		Effect.gen(function* () {
			const formatter = yield* CliOutput.Formatter;
			const rendered = formatter.formatVersion("my-awesome-tool", "1.2.3");
			assert.strictEqual(
				rendered,
				CliOutput.defaultFormatter({ colors: true }).formatVersion("my-awesome-tool", "1.2.3"),
			);
			assert.notStrictEqual(
				rendered,
				CliOutput.defaultFormatter({ colors: false }).formatVersion("my-awesome-tool", "1.2.3"),
			);
		}).pipe(
			Effect.provide(CliColor.formatterLayer()),
			Effect.provide(Stdio.layerTest({ stdoutIsTerminal: Effect.succeed(true) })),
			Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
		),
	);
});
