import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Stdio } from "effect";
import { CliOutput } from "effect/unstable/cli";
import { CliColor } from "../src/index.js";

const decide = (options: { readonly tty: boolean; readonly env: Record<string, string> }) =>
	CliColor.enabled.pipe(
		Effect.provide(Stdio.layerTest({ stdoutIsTerminal: Effect.succeed(options.tty) })),
		Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(options.env)),
	);

describe("CliColor.enabled", () => {
	const cases: ReadonlyArray<readonly [string, boolean, Record<string, string>, boolean]> = [
		["TTY, NO_COLOR unset", true, {}, true],
		["TTY, NO_COLOR empty — no-color.org: only non-empty disables", true, { NO_COLOR: "" }, true],
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

	it.effect("ignores FORCE_COLOR, matching core", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* decide({ tty: false, env: { FORCE_COLOR: "1" } }), false);
		}),
	);
});

describe("CliColor.formatterLayer", () => {
	it.effect("applies an override while keeping the other default methods", () =>
		Effect.gen(function* () {
			const formatter = yield* CliOutput.Formatter;
			assert.strictEqual(formatter.formatVersion("tool", "1.0.0"), "tool 1.0.0 via @scope/plugin 2.0.0");
			assert.strictEqual(typeof formatter.formatErrors, "function");
		}).pipe(
			Effect.provide(
				CliColor.formatterLayer({ formatVersion: (name, version) => `${name} ${version} via @scope/plugin 2.0.0` }),
			),
			Effect.provide(Stdio.layerTest({ stdoutIsTerminal: Effect.succeed(false) })),
		),
	);
});
