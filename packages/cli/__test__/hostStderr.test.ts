import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { TerminalEnv } from "@effected/env";
import { Console, Effect, Layer, Stdio } from "effect";
import { CliRuntime } from "../src/index.js";
import { hostStderrIsTerminal } from "../src/internal/hostStderr.js";

/** Whether the effect (or `undefined`) a probe answered says "a terminal". */
const asked = (probe: Effect.Effect<boolean> | undefined) => (probe === undefined ? Effect.succeed(undefined) : probe);

describe("hostStderrIsTerminal (a structural double)", () => {
	it.effect("reads stderr's own flag, both ways", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* asked(hostStderrIsTerminal({ process: { stderr: { isTTY: true } } })), true);
			// Node leaves `isTTY` undefined, not false, on a redirected stream.
			assert.strictEqual(yield* asked(hostStderrIsTerminal({ process: { stderr: {} } })), false);
			assert.strictEqual(yield* asked(hostStderrIsTerminal({ process: { stderr: { isTTY: false } } })), false);
		}),
	);

	it("answers nothing on a host with no process.stderr, so the mirror stays", () => {
		assert.isUndefined(hostStderrIsTerminal({}));
		assert.isUndefined(hostStderrIsTerminal({ process: {} }));
	});
});

/** `main`'s program reads what `TerminalEnv` says about stderr, with stdout a terminal and `process.stderr.isTTY` set to `tty`. */
const stderrSeenByMain = (tty: boolean | undefined, env: { readonly stderrIsTerminal?: Effect.Effect<boolean> } = {}) =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			const original = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
			Object.defineProperty(process.stderr, "isTTY", { value: tty, configurable: true, writable: true });
			return original;
		}),
		() =>
			Effect.gen(function* () {
				let seen: boolean | undefined;
				const program = Effect.gen(function* () {
					const terminal = yield* TerminalEnv;
					seen = terminal.stderr.isTerminal;
				});
				yield* CliRuntime.main(program, {
					platform: Layer.merge(
						NodeServices.layer,
						Stdio.layerTest({
							stdinIsTerminal: Effect.succeed(true),
							stdoutIsTerminal: Effect.succeed(true),
						}),
					),
					env,
				}).pipe(Effect.provideService(Console.Console, Object.create(console) as Console.Console));
				return seen;
			}),
		(original) =>
			Effect.sync(() => {
				if (original === undefined) Reflect.deleteProperty(process.stderr, "isTTY");
				else Object.defineProperty(process.stderr, "isTTY", original);
			}),
	);

describe("CliRuntime.main defaults stderrIsTerminal from the host", () => {
	it.effect("a redirected stderr is not a terminal although stdout is", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* stderrSeenByMain(undefined), false);
		}),
	);

	it.effect("control: a stderr that is a terminal reads as one (the probe can see both answers)", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* stderrSeenByMain(true), true);
		}),
	);

	it.effect("an explicit env.stderrIsTerminal beats the host's answer", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* stderrSeenByMain(undefined, { stderrIsTerminal: Effect.succeed(true) }), true);
			assert.strictEqual(yield* stderrSeenByMain(true, { stderrIsTerminal: Effect.succeed(false) }), false);
		}),
	);
});
