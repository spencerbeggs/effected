import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Duration, Effect, Fiber, Layer, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TestClock } from "effect/testing";
import { Git, GitCommandError } from "../src/Git.js";

const cwd = "/repo";

type Env = ChildProcess.StandardCommand["options"]["env"];

/** A recording spawner: every spawn's argv and env, `hang` never exits. */
const recording = (hang = false) => {
	const seen: Array<{ readonly args: ReadonlyArray<string>; readonly env: Env }> = [];
	const layer = Layer.succeed(
		ChildProcessSpawner.ChildProcessSpawner,
		ChildProcessSpawner.make((command) => {
			if (!ChildProcess.isStandardCommand(command)) return Effect.die("piped commands not scripted");
			const args = command.args.map(String);
			seen.push({ args, env: command.options.env });
			const probe = args[0] === "config" && args[1] === "--get";
			return Effect.succeed(
				ChildProcessSpawner.makeHandle({
					pid: ChildProcessSpawner.ProcessId(1),
					exitCode: hang ? Effect.never : Effect.succeed(ChildProcessSpawner.ExitCode(probe ? 1 : 0)),
					isRunning: Effect.succeed(false),
					kill: () => Effect.void,
					stdin: Sink.drain,
					stdout: Stream.make(new TextEncoder().encode(probe ? "" : "abc123\n")),
					stderr: Stream.empty,
					all: Stream.empty,
					getInputFd: () => Sink.drain,
					getOutputFd: () => Stream.empty,
					unref: Effect.succeed(Effect.void),
				}),
			);
		}),
	);
	return { seen, layer };
};

const provide = <A, E>(
	program: Effect.Effect<A, E, Git>,
	layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>,
	ambient: Record<string, string> = {},
) =>
	program.pipe(
		Effect.provide(Git.layer),
		Effect.provide(layer),
		Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(ambient))),
	);

const lastEnv = (seen: ReadonlyArray<{ readonly env: Env }>): Env => seen[seen.length - 1]?.env;

describe("Git.withRunOptions", () => {
	it.effect("adds env keys to the spawn", () =>
		Effect.gen(function* () {
			const { seen, layer } = recording();
			yield* provide(
				Effect.flatMap(Git, (git) =>
					Git.withRunOptions(git.revParse(cwd, "HEAD"), { env: { GIT_LFS_SKIP_SMUDGE: "1" } }),
				),
				layer,
			);
			assert.strictEqual(lastEnv(seen)?.GIT_LFS_SKIP_SMUDGE, "1");
		}),
	);

	it.effect("cannot undo a pin", () =>
		Effect.gen(function* () {
			const { seen, layer } = recording();
			yield* provide(
				Effect.flatMap(Git, (git) =>
					Git.withRunOptions(git.revParse(cwd, "HEAD"), {
						env: {
							LC_ALL: "de_DE.UTF-8",
							GIT_TERMINAL_PROMPT: "1",
							GIT_ASKPASS: "x",
							SSH_ASKPASS_REQUIRE: "force",
						},
					}),
				),
				layer,
			);
			const env = lastEnv(seen);
			assert.strictEqual(env?.LC_ALL, "C");
			assert.strictEqual(env?.GIT_TERMINAL_PROMPT, "0");
			assert.strictEqual(env?.GIT_ASKPASS, "");
			assert.strictEqual(env?.SSH_ASKPASS_REQUIRE, "never");
		}),
	);

	it.effect("turns config into GIT_CONFIG_COUNT entries", () =>
		Effect.gen(function* () {
			const { seen, layer } = recording();
			yield* provide(
				Effect.flatMap(Git, (git) =>
					Git.withRunOptions(git.revParse(cwd, "HEAD"), {
						config: { "advice.detachedHead": "false", "gc.auto": "0" },
					}),
				),
				layer,
			);
			const env = lastEnv(seen);
			assert.strictEqual(env?.GIT_CONFIG_COUNT, "2");
			assert.strictEqual(env?.GIT_CONFIG_KEY_0, "advice.detachedHead");
			assert.strictEqual(env?.GIT_CONFIG_VALUE_0, "false");
			assert.strictEqual(env?.GIT_CONFIG_KEY_1, "gc.auto");
			assert.strictEqual(env?.GIT_CONFIG_VALUE_1, "0");
		}),
	);

	it.effect("pins a caller GIT_SSH_COMMAND to batch mode on a network member, outranking the ambient one", () =>
		Effect.gen(function* () {
			const { seen, layer } = recording();
			yield* provide(
				Effect.flatMap(Git, (git) =>
					Git.withRunOptions(git.lsRemote(cwd, "origin"), { env: { GIT_SSH_COMMAND: 'ssh -i "/tmp/k"' } }),
				),
				layer,
				{ GIT_SSH_COMMAND: "ssh -i /ambient" },
			);
			assert.strictEqual(lastEnv(seen)?.GIT_SSH_COMMAND, 'ssh -i "/tmp/k" -o BatchMode=yes');
		}),
	);

	it.effect("pins a caller GIT_SSH_COMMAND whose program is a quoted absolute path, as a checkout writes it", () =>
		Effect.gen(function* () {
			for (const program of ['"/usr/bin/ssh"', '"C:\\Program Files\\Git\\usr\\bin\\ssh.exe"']) {
				const { seen, layer } = recording();
				const command = `${program} -i "/tmp/k" -o "UserKnownHostsFile=/tmp/k_known_hosts"`;
				yield* provide(
					Effect.flatMap(Git, (git) =>
						Git.withRunOptions(git.lsRemote(cwd, "origin"), { env: { GIT_SSH_COMMAND: command } }),
					),
					layer,
				);
				assert.strictEqual(lastEnv(seen)?.GIT_SSH_COMMAND, `${command} -o BatchMode=yes`);
			}
		}),
	);

	it.effect("timeout replaces the 30s ceiling", () =>
		Effect.gen(function* () {
			const { layer } = recording(true);
			const fiber = yield* Effect.forkChild(
				Effect.flip(
					provide(
						Effect.flatMap(Git, (git) => Git.withRunOptions(git.revParse(cwd, "HEAD"), { timeout: "50 millis" })),
						layer,
					),
				),
			);
			yield* TestClock.adjust("1 second");
			const failure = yield* Fiber.join(fiber);
			assert.instanceOf(failure, GitCommandError);
			if (failure instanceof GitCommandError) {
				assert.strictEqual(failure.detail, `timed out after ${Duration.format(Duration.millis(50))}`);
				assert.strictEqual(failure.detail, "timed out after 50ms");
			}
		}),
	);

	it.effect("keeps the 30s detail with no option", () =>
		Effect.gen(function* () {
			const { layer } = recording(true);
			const fiber = yield* Effect.forkChild(
				Effect.flip(
					provide(
						Effect.flatMap(Git, (git) => git.revParse(cwd, "HEAD")),
						layer,
					),
				),
			);
			yield* TestClock.adjust("31 seconds");
			const failure = yield* Fiber.join(fiber);
			assert.instanceOf(failure, GitCommandError);
			if (failure instanceof GitCommandError) assert.strictEqual(failure.detail, "timed out after 30s");
		}),
	);

	it.effect("nested withRunOptions merges, inner wins", () =>
		Effect.gen(function* () {
			const { seen, layer } = recording();
			yield* provide(
				Effect.flatMap(Git, (git) =>
					Git.withRunOptions(
						Git.withRunOptions(git.revParse(cwd, "HEAD"), {
							env: { B: "inner", C: "inner" },
							config: { "a.b": "inner" },
						}),
						{ env: { A: "outer", B: "outer" }, config: { "x.y": "outer" } },
					),
				),
				layer,
			);
			const env = lastEnv(seen);
			assert.strictEqual(env?.A, "outer");
			assert.strictEqual(env?.B, "inner");
			assert.strictEqual(env?.C, "inner");
			assert.strictEqual(env?.GIT_CONFIG_COUNT, "2");
			assert.strictEqual(env?.GIT_CONFIG_KEY_0, "x.y");
			assert.strictEqual(env?.GIT_CONFIG_KEY_1, "a.b");
		}),
	);
});
