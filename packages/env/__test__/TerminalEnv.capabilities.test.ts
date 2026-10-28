import * as tty from "node:tty";
import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Option, Stdio, Terminal } from "effect";
import { TerminalCapabilities } from "effect/cli";
import type { Env } from "../src/internal/types.js";
import { TerminalEnv } from "../src/TerminalEnv.js";

const withEnv = (env: Env) => Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env));

const stdio = (io: { readonly stdin: boolean; readonly stdout: boolean }) =>
	Stdio.layerTest({
		stdinIsTerminal: Effect.succeed(io.stdin),
		stdoutIsTerminal: Effect.succeed(io.stdout),
		stderrIsTerminal: Effect.succeed(io.stdout),
	});

const terminal = Layer.succeed(
	Terminal.Terminal,
	Terminal.make({
		columns: Effect.succeed(80),
		rows: Effect.succeed(24),
		readInput: Effect.die("unused"),
		readLine: Effect.die("unused"),
		display: () => Effect.void,
	}),
);

/** Node's own colour depth, the oracle, for a terminal stream; `FORCE_COLOR` is left out so Node warns of nothing. */
const nodeDepth = (env: Record<string, string>): string => {
	const bits = tty.WriteStream.prototype.getColorDepth.call(undefined, env);
	return bits === 1 ? "none" : bits === 4 ? "basic" : bits === 8 ? "256" : "truecolor";
};

const win32 = process.platform === "win32";

describe("TerminalEnv.colorLevelFrom", () => {
	it.effect.skipIf(win32)("a terminal stream gets Node's colour depth for the same record", () =>
		Effect.sync(() => {
			for (const env of [
				{},
				{ TERM: "xterm-256color" },
				{ TERM: "dumb" },
				{ TERM: "xterm-kitty" },
				{ COLORTERM: "truecolor" },
				{ TERM_PROGRAM: "Apple_Terminal" },
				{ CI: "true", GITHUB_ACTIONS: "true" },
				{ NO_COLOR: "1", TERM: "xterm-256color" },
			]) {
				assert.strictEqual(TerminalEnv.colorLevelFrom(env, true), nodeDepth(env), JSON.stringify(env));
			}
		}),
	);

	it.effect("a stream that is not a terminal has none, unless FORCE_COLOR says otherwise", () =>
		Effect.sync(() => {
			assert.strictEqual(TerminalEnv.colorLevelFrom({ TERM: "xterm-256color" }, false), "none");
			assert.strictEqual(TerminalEnv.colorLevelFrom({ FORCE_COLOR: "2" }, false), "256");
			// FORCE_COLOR beats NO_COLOR, as in Node.
			assert.strictEqual(TerminalEnv.colorLevelFrom({ FORCE_COLOR: "3", NO_COLOR: "1" }, false), "truecolor");
		}),
	);

	it.effect("an empty or undefined value reads as unset, as the layer reads it", () =>
		Effect.sync(() => {
			// Unnormalised, FORCE_COLOR="" would force basic colour onto a pipe.
			assert.strictEqual(TerminalEnv.colorLevelFrom({ FORCE_COLOR: "" }, false), "none");
			assert.strictEqual(TerminalEnv.colorLevelFrom({ FORCE_COLOR: undefined, TERM: "xterm" }, true), "basic");
		}),
	);

	it.effect("agrees with TerminalEnv.layer on the same record, for each stream", () =>
		Effect.gen(function* () {
			for (const env of [{ TERM: "xterm-256color" }, { FORCE_COLOR: "1" }, { FORCE_COLOR: "" }, { NO_COLOR: "x" }]) {
				for (const isTTY of [true, false]) {
					const layered = yield* Effect.gen(function* () {
						return (yield* TerminalEnv).stdout.color;
					}).pipe(
						Effect.provide(
							TerminalEnv.layer().pipe(Layer.provide(Layer.merge(stdio({ stdin: isTTY, stdout: isTTY }), terminal))),
						),
						withEnv(env),
					);
					assert.strictEqual(TerminalEnv.colorLevelFrom(env, isTTY), layered, `${JSON.stringify(env)} tty=${isTTY}`);
				}
			}
		}),
	);
});

/** Core's own detection, the oracle where the two rules agree. */
const coreCaps = (env: Env, io: { readonly stdin: boolean; readonly stdout: boolean }) =>
	Effect.gen(function* () {
		return yield* TerminalCapabilities.TerminalCapabilities;
	}).pipe(Effect.provide(TerminalCapabilities.layer.pipe(Layer.provide(stdio(io)))), withEnv(env));

/** The kit's projection of the same facts: the snapshot `TerminalEnv.layer` builds, and the record's `TERM`. */
const kitCaps = (env: Env, io: { readonly stdin: boolean; readonly stdout: boolean }) =>
	Effect.gen(function* () {
		return TerminalEnv.capabilities(yield* TerminalEnv, env.TERM);
	}).pipe(Effect.provide(TerminalEnv.layer().pipe(Layer.provide(Layer.merge(stdio(io), terminal)))), withEnv(env));

const IO = [
	{ stdin: true, stdout: true },
	{ stdin: false, stdout: true },
	{ stdin: true, stdout: false },
	{ stdin: false, stdout: false },
] as const;

describe("TerminalEnv.capabilities", () => {
	it.effect("match core's detection wherever the colour rules agree", () =>
		Effect.gen(function* () {
			for (const env of [{ TERM: "xterm-256color" }, { TERM: "dumb" }, { NO_COLOR: "1", TERM: "xterm" }]) {
				for (const io of IO) {
					assert.deepStrictEqual(
						yield* kitCaps(env, io),
						yield* coreCaps(env, io),
						`${JSON.stringify(env)} ${JSON.stringify(io)}`,
					);
				}
			}
		}),
	);

	it.effect("colour follows the kit's rule where core's differs: FORCE_COLOR beats NO_COLOR, and TERM=dumb", () =>
		Effect.gen(function* () {
			const io = { stdin: true, stdout: true };
			const forced = { FORCE_COLOR: "1", NO_COLOR: "1" };
			assert.isFalse((yield* coreCaps(forced, io)).canColor, "control: core lets NO_COLOR win");
			assert.isTrue((yield* kitCaps(forced, io)).canColor);
			const dumb = { FORCE_COLOR: "1", TERM: "dumb" };
			assert.isFalse((yield* coreCaps(dumb, io)).canColor, "control: core clears colour on a dumb terminal");
			assert.deepStrictEqual(yield* kitCaps(dumb, io), { canColor: true, canAnimate: false, canPrompt: false });
		}),
	);

	it.effect("the pure projection reads TERM from its argument alone", () =>
		Effect.sync(() => {
			const snapshot = {
				stdinIsTerminal: true,
				stdout: { isTerminal: true, color: "256", hyperlinks: false, columns: Option.none() },
				stderr: { isTerminal: true, color: "256", hyperlinks: false, columns: Option.none() },
				width: () => 80,
			} as const;
			assert.deepStrictEqual(TerminalEnv.capabilities(snapshot), { canColor: true, canAnimate: true, canPrompt: true });
			assert.deepStrictEqual(TerminalEnv.capabilities(snapshot, "dumb"), {
				canColor: true,
				canAnimate: false,
				canPrompt: false,
			});
			assert.deepStrictEqual(
				TerminalEnv.capabilities({ ...snapshot, stdout: { ...snapshot.stdout, color: "none" } }, "xterm"),
				{ canColor: false, canAnimate: true, canPrompt: true },
			);
		}),
	);
});
