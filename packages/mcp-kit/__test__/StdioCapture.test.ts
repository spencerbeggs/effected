import { Readable } from "node:stream";
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { vi } from "vitest";
import type { StdioCaptureHost, StdioSink } from "../src/node.js";
import { StdioCapture } from "../src/node.js";

/** A host double whose streams record every write that reaches the ORIGINAL write, with its `this`. */
const makeHost = () => {
	const wire: Array<string> = [];
	const err: Array<string> = [];
	const thisArgs: Array<unknown> = [];
	const stdout = {
		write(this: unknown, chunk: unknown): boolean {
			thisArgs.push(this);
			wire.push(String(chunk));
			return true;
		},
	};
	const stderr = {
		write(this: unknown, chunk: unknown): boolean {
			thisArgs.push(this);
			err.push(String(chunk));
			return true;
		},
	};
	const host: StdioCaptureHost = { stdout, stderr };
	return { host, wire, err, thisArgs, stdout, stderr };
};

const makeSink = () => {
	const lines: Array<string> = [];
	const sink: StdioSink = {
		write: (chunk: unknown) => {
			lines.push(String(chunk));
			return true;
		},
	};
	return { sink, lines };
};

describe("StdioCapture.install", () => {
	it("patches once: a second install reuses the patch, and an uncaptured write reaches the original with its this", () => {
		const { host, wire, thisArgs, stdout } = makeHost();
		StdioCapture.install(host);
		const patched = host.stdout.write;
		StdioCapture.install(host);
		assert.strictEqual(host.stdout.write, patched, "no stacked patch");
		host.stdout.write("outside\n");
		assert.deepStrictEqual(wire, ["outside\n"]);
		assert.strictEqual(thisArgs[0], stdout);
	});
});

describe("StdioCapture registry", () => {
	it("two host objects over the same streams share one patch", () => {
		const { host, wire } = makeHost();
		StdioCapture.install(host);
		const patched = host.stdout.write;
		const alias: StdioCaptureHost = { stdout: host.stdout, stderr: host.stderr };
		StdioCapture.install(alias);
		assert.strictEqual(host.stdout.write, patched, "a second host object over the same stream does not re-patch it");
		host.stdout.write("outside\n");
		assert.deepStrictEqual(wire, ["outside\n"], "one write reaches the original exactly once");
	});

	it.effect("two installed copies of the module share one patch and one routing context", () =>
		Effect.promise(async () => {
			const first = await import("../src/StdioCapture.js");
			vi.resetModules();
			const second = await import("../src/StdioCapture.js");
			assert.notStrictEqual(first.StdioCapture, second.StdioCapture, "control: these really are two module copies");
			const { host, wire } = makeHost();
			first.StdioCapture.install(host);
			const patched = host.stdout.write;
			const capture = second.StdioCapture.install(host);
			assert.strictEqual(host.stdout.write, patched, "the second copy does not stack a patch");
			const { sink, lines } = makeSink();
			await capture.run({ stdout: sink }, async () => {
				host.stdout.write("captured\n");
			});
			host.stdout.write("outside\n");
			assert.deepStrictEqual(
				lines,
				["captured\n"],
				"a capture through the second copy is honoured by the first copy's patch",
			);
			assert.deepStrictEqual(wire, ["outside\n"]);
		}),
	);
});

describe("StdioCapture.run", () => {
	it.effect("diverts stdout inside the context while a concurrent outside writer keeps the original", () =>
		Effect.promise(async () => {
			const { host, wire, err } = makeHost();
			const capture = StdioCapture.install(host);
			const { sink, lines } = makeSink();
			let release: () => void = () => {};
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const inside = capture.run({ stdout: sink }, async () => {
				host.stdout.write("inside-1\n");
				await gate;
				host.stdout.write("inside-2\n");
				host.stderr.write("inside-err\n");
				return 42;
			});
			host.stdout.write("outside\n");
			release();
			assert.strictEqual(await inside, 42);
			assert.deepStrictEqual(lines, ["inside-1\n", "inside-2\n"]);
			assert.deepStrictEqual(wire, ["outside\n"]);
			assert.deepStrictEqual(err, ["inside-err\n"], "stderr passes through when no stderr sink is given");
		}),
	);

	it.effect("diverts stderr too when a stderr sink is given", () =>
		Effect.promise(async () => {
			const { host, err } = makeHost();
			const { sink, lines } = makeSink();
			await StdioCapture.install(host).run({ stdout: StdioCapture.discard, stderr: sink }, async () => {
				host.stderr.write("noisy\n");
			});
			assert.deepStrictEqual(lines, ["noisy\n"]);
			assert.deepStrictEqual(err, []);
		}),
	);

	it.effect("a synchronous throw rejects the promise", () =>
		Effect.promise(async () => {
			const { host } = makeHost();
			const error = await StdioCapture.install(host)
				.run({ stdout: StdioCapture.discard }, () => {
					throw new Error("sync");
				})
				.then(
					() => undefined,
					(cause: unknown) => cause,
				);
			assert.instanceOf(error, Error);
		}),
	);

	it.effect("installs on the real process: a process.stdout.write inside the context reaches the sink", () =>
		Effect.promise(async () => {
			const capture = StdioCapture.install(process);
			const { sink, lines } = makeSink();
			await capture.run({ stdout: sink }, async () => {
				process.stdout.write("from-process\n");
			});
			assert.deepStrictEqual(lines, ["from-process\n"]);
		}),
	);
});

describe("StdioCapture.capture", () => {
	it.effect("captures across the inner fiber's own suspensions", () =>
		Effect.gen(function* () {
			const { host, wire } = makeHost();
			const capture = StdioCapture.install(host);
			const { sink, lines } = makeSink();
			const value = yield* Effect.gen(function* () {
				host.stdout.write("before\n");
				yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1)));
				yield* Effect.yieldNow;
				host.stdout.write("after\n");
				return "done";
			}).pipe(capture.capture({ stdout: sink }));
			assert.strictEqual(value, "done");
			assert.deepStrictEqual(lines, ["before\n", "after\n"]);
			assert.deepStrictEqual(wire, []);
		}),
	);

	it.effect("a fiber outside, woken by the captured work, keeps writing to the original (the wire)", () =>
		Effect.gen(function* () {
			const { host, wire } = makeHost();
			const capture = StdioCapture.install(host);
			const { sink, lines } = makeSink();
			const wake = yield* Deferred.make<void>();
			const writer = yield* Effect.forkChild(
				Effect.gen(function* () {
					yield* Deferred.await(wake);
					yield* Effect.yieldNow;
					host.stdout.write("response\n");
				}),
			);
			yield* Effect.yieldNow;
			yield* Effect.gen(function* () {
				yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1)));
				yield* Deferred.succeed(wake, undefined);
				host.stdout.write("captured\n");
			}).pipe(capture.capture({ stdout: sink }));
			yield* Fiber.join(writer);
			assert.deepStrictEqual(wire, ["response\n"]);
			assert.deepStrictEqual(lines, ["captured\n"]);
		}),
	);

	it.effect("positive control: a fiber forked inside the capture keeps capturing (the documented leak)", () =>
		Effect.gen(function* () {
			const { host, wire } = makeHost();
			const capture = StdioCapture.install(host);
			const { sink, lines } = makeSink();
			const go = yield* Deferred.make<void>();
			const background = yield* Effect.forkDetach(
				Effect.gen(function* () {
					yield* Deferred.await(go);
					host.stdout.write("background\n");
				}),
			).pipe(capture.capture({ stdout: sink }));
			yield* Deferred.succeed(go, undefined);
			yield* Fiber.join(background);
			assert.deepStrictEqual(lines, ["background\n"]);
			assert.deepStrictEqual(wire, []);
		}),
	);

	it.effect("interrupting the capture interrupts the inner fiber and waits for its finalizers", () =>
		Effect.gen(function* () {
			const { host } = makeHost();
			const capture = StdioCapture.install(host);
			const started = yield* Deferred.make<void>();
			let finalized = false;
			const fiber = yield* Effect.forkChild(
				Effect.gen(function* () {
					yield* Deferred.succeed(started, undefined);
					return yield* Effect.never;
				}).pipe(
					Effect.ensuring(Effect.sync(() => (finalized = true))),
					capture.capture({ stdout: StdioCapture.discard }),
				),
			);
			yield* Deferred.await(started);
			yield* Fiber.interrupt(fiber);
			assert.isTrue(finalized);
		}),
	);
});

describe("sinks", () => {
	it.effect("discard calls a trailing write callback", () =>
		Effect.promise(async () => {
			await new Promise<void>((resolve) => {
				StdioCapture.discard.write("x", "utf8", () => resolve());
			});
		}),
	);

	it.effect("nullWritable is a pipe target that takes setMaxListeners, as a runner's logger stream is used", () =>
		Effect.promise(async () => {
			const sink = StdioCapture.nullWritable();
			// The shape of vitest's forks worker: bump the listener cap, then pipe without ending the target.
			sink.setMaxListeners(1 + sink.getMaxListeners());
			const source = Readable.from(["a", "b", "c"]);
			source.pipe(sink, { end: false });
			await new Promise<void>((resolve, reject) => {
				source.on("end", resolve);
				source.on("error", reject);
			});
			assert.isTrue(sink.writable, "an end:false pipe leaves the target open");
			await new Promise<void>((resolve) => sink.write("more", () => resolve()));
			const ended = Readable.from(["z"]);
			ended.pipe(sink);
			await new Promise<void>((resolve) => sink.on("finish", resolve));
			assert.isFalse(sink.writable, "a default pipe ends it, so each consumer builds its own");
			assert.notStrictEqual(StdioCapture.nullWritable(), sink);
		}),
	);

	it.effect("nullWritable is also a capture sink: a captured write lands nowhere and its callback fires", () =>
		Effect.promise(async () => {
			const { host, wire } = makeHost();
			const sink: StdioSink = StdioCapture.nullWritable();
			await StdioCapture.install(host).run({ stdout: sink }, async () => {
				await new Promise<void>((resolve) => host.stdout.write("hidden\n", () => resolve()));
			});
			assert.deepStrictEqual(wire, []);
		}),
	);

	it("toStderr writes through the original stderr, bound to the stream", () => {
		const { host, err, thisArgs, stderr } = makeHost();
		const capture = StdioCapture.install(host);
		capture.toStderr.write("visible\n");
		assert.deepStrictEqual(err, ["visible\n"]);
		assert.strictEqual(thisArgs[0], stderr);
	});
});
