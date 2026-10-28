import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Stdio, Terminal } from "effect";
import { TerminalCapabilities } from "effect/cli";
import { CliEnv, CliInteractive } from "../src/index.js";

/** `Stdio` and `Terminal` doubles: the requirements `CliEnv.layer` leaves to the platform. */
const platform = (io: { readonly stdin: boolean; readonly stdout: boolean }) =>
	Layer.mergeAll(
		Stdio.layerTest({
			stdinIsTerminal: Effect.succeed(io.stdin),
			stdoutIsTerminal: Effect.succeed(io.stdout),
			stderrIsTerminal: Effect.succeed(io.stdout),
		}),
		Layer.succeed(
			Terminal.Terminal,
			Terminal.make({
				columns: Effect.succeed(80),
				rows: Effect.succeed(24),
				readInput: Effect.die("unused"),
				readLine: Effect.die("unused"),
				display: () => Effect.void,
			}),
		),
	);

const withEnv = (env: Record<string, string>) =>
	Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env));

const capabilities = Effect.gen(function* () {
	return yield* TerminalCapabilities.TerminalCapabilities;
});

/** The capabilities core reads inside a program under `CliEnv.layer`. */
const underLayer = (env: Record<string, string>, io: { readonly stdin: boolean; readonly stdout: boolean }) =>
	capabilities.pipe(Effect.provide(CliEnv.layer()), Effect.provide(platform(io)), withEnv(env));

/** Core's own detection of the same facts: the control. */
const coreOwn = (env: Record<string, string>, io: { readonly stdin: boolean; readonly stdout: boolean }) =>
	capabilities.pipe(Effect.provide(TerminalCapabilities.layer.pipe(Layer.provide(platform(io)))), withEnv(env));

describe("CliEnv.layer installs core's TerminalCapabilities", () => {
	it.effect("piped: core would skip every fallback, the layer holds canPrompt open and keeps the rest", () =>
		Effect.gen(function* () {
			const piped = { stdin: false, stdout: false };
			assert.deepStrictEqual(yield* coreOwn({}, piped), { canColor: false, canAnimate: false, canPrompt: false });
			assert.deepStrictEqual(yield* underLayer({}, piped), { canColor: false, canAnimate: false, canPrompt: true });
		}),
	);

	it.effect("colour follows the kit's rule: FORCE_COLOR beats NO_COLOR, where core lets NO_COLOR win", () =>
		Effect.gen(function* () {
			const env = { FORCE_COLOR: "1", NO_COLOR: "1" };
			const piped = { stdin: false, stdout: false };
			assert.isFalse((yield* coreOwn(env, piped)).canColor, "control: core's rule");
			assert.isTrue((yield* underLayer(env, piped)).canColor);
		}),
	);

	it.effect("a dumb terminal does not animate, and its run is still not interactive", () =>
		Effect.gen(function* () {
			const tty = { stdin: true, stdout: true };
			const caps = yield* underLayer({ TERM: "dumb" }, tty);
			assert.deepStrictEqual(caps, { canColor: false, canAnimate: false, canPrompt: true });
			const interactive = yield* CliInteractive.pipe(
				Effect.provide(CliEnv.layer()),
				Effect.provide(platform(tty)),
				withEnv({ TERM: "dumb" }),
			);
			assert.isFalse(interactive, "the prompt decision stays CliInteractive's");
		}),
	);

	it.effect("CliEnv.layerTest sets them from its fixed answers, never the host's process", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* capabilities.pipe(Effect.provide(CliEnv.layerTest({ color: "256" }))), {
				canColor: true,
				canAnimate: false,
				canPrompt: true,
			});
			assert.deepStrictEqual(yield* capabilities.pipe(Effect.provide(CliEnv.layerTest({ tty: true, term: "dumb" }))), {
				canColor: false,
				canAnimate: false,
				canPrompt: true,
			});
			assert.deepStrictEqual(yield* capabilities.pipe(Effect.provide(CliEnv.layerTest({ tty: true }))), {
				canColor: false,
				canAnimate: true,
				canPrompt: true,
			});
		}),
	);

	it.effect("CliInteractive.layerTest holds canPrompt open whichever way it answers", () =>
		Effect.gen(function* () {
			for (const value of [true, false]) {
				const caps = yield* capabilities.pipe(Effect.provide(CliInteractive.layerTest(value)));
				assert.isTrue(caps.canPrompt, String(value));
			}
		}),
	);
});
