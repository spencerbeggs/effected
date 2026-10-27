import { AsyncLocalStorage } from "node:async_hooks";
import { Writable } from "node:stream";
import type { Context } from "effect";
import { Effect, Fiber } from "effect";

/**
 * Anything with a replaceable `write`: a patched stream (Node's
 * `process.stdout` and `process.stderr`) and a sink captured writes go to (a
 * Node `Writable`, {@link StdioCapture.nullWritable}, {@link StdioCapture.discard},
 * {@link StdioCapture.toStderr}).
 *
 * @remarks
 * A sink's `write` receives exactly the arguments the patched stream's
 * `write` was called with, including any trailing callback, so a sink must
 * call that callback itself, as a `Writable` does.
 *
 * @public
 */
export interface StdioSink {
	// biome-ignore lint/suspicious/noExplicitAny: Node's overloaded `write` signatures only unify through `any` arguments
	write(chunk: any, ...rest: Array<any>): boolean;
}

/**
 * The two streams {@link StdioCapture.install} patches. Node's `process`
 * satisfies it; pass it in from `main.ts`.
 *
 * @public
 */
export interface StdioCaptureHost {
	readonly stdout: StdioSink;
	readonly stderr: StdioSink;
}

/**
 * The sinks for one capture. `stderr` passes through to the real stream when
 * omitted.
 *
 * @public
 */
export interface StdioCaptureOptions {
	readonly stdout: StdioSink;
	readonly stderr?: StdioSink | undefined;
}

interface Registry {
	/** The one routing context, so a capture started through one copy is honoured by a patch made by another. */
	readonly storage: AsyncLocalStorage<StdioCaptureOptions>;
	/** Each patched stream's original `write`, keyed by the stream itself: two hosts over one stream share one patch. */
	readonly originals: WeakMap<StdioSink, StdioSink["write"]>;
}

/**
 * One registry per process, shared by every installed copy of this package
 * through a `Symbol.for` key on `globalThis`, so two copies never stack
 * patches or split the context they route on.
 */
const registry: Registry = ((): Registry => {
	const key = Symbol.for("@effected/mcp/StdioCapture");
	const global = globalThis as { [key]?: Registry };
	global[key] ??= { storage: new AsyncLocalStorage(), originals: new WeakMap() };
	return global[key];
})();

/** Patches `stream` once and returns its original `write`; a stream already patched keeps its first patch. */
const patch = (stream: StdioSink, pick: (options: StdioCaptureOptions) => StdioSink | undefined) => {
	const known = registry.originals.get(stream);
	if (known !== undefined) return known;
	const original = stream.write;
	registry.originals.set(stream, original);
	const { storage } = registry;
	stream.write = function capturedWrite(this: unknown): boolean {
		// The store is read first: a write outside every capture (the wire's hot path) forwards its
		// own `arguments` object without allocating an array.
		const options = storage.getStore();
		const sink = options === undefined ? undefined : pick(options);
		// biome-ignore lint/complexity/noArguments: forwarding `arguments` avoids a rest-array allocation per write
		return sink === undefined ? original.apply(this, arguments as never) : sink.write.apply(sink, arguments as never);
	} as StdioSink["write"];
	return original;
};

const callbackOf = (rest: ReadonlyArray<unknown>): (() => void) | undefined => {
	const last = rest.at(-1);
	return typeof last === "function" ? (last as () => void) : undefined;
};

/**
 * Diverts a host's stdout (and optionally stderr) writes to a sink, for code
 * running inside one async context only, while every other context keeps
 * writing to the real streams.
 *
 * @remarks
 * For an MCP server over stdio, stdout is the JSON-RPC wire. A chatty library
 * run in-process (a test runner, a bundler, a linter) must keep its output off
 * it while other handlers, and the transport itself, keep writing normally.
 *
 * `install` patches the host's `write` methods once, keeping the unbound
 * originals, and routes every write through an `AsyncLocalStorage`: inside a
 * {@link StdioCapture.run} or {@link StdioCapture.capture} context a write goes
 * to that context's sink, and outside it to the original stream.
 *
 * An Effect fiber resumes in the async context it suspended in, not the
 * context of whatever woke it, so a server fiber woken by code inside a
 * capture (its response written to a queue, say) keeps writing to the wire.
 *
 * Two kinds of write escape a capture and reach the original stream:
 *
 * - **Writes from a context the capture lost.** Callbacks registered outside the
 *   capture keep the context they were registered in: native addons, worker
 *   thread output relayed by the main thread, listeners on a child process's
 *   pipes attached earlier. On stdout, that is the wire.
 * - **Fibers started inside the capture keep capturing after it ends.** A fiber
 *   forked inside it (`Effect.forkDetach`, a memoized layer first built inside
 *   it, a background fiber a library starts) keeps writing to the sink, even
 *   after the capture's own work is done.
 *
 * @example
 * ```ts
 * import { StdioCapture } from "@effected/mcp/node"
 *
 * const capture = StdioCapture.install(process)
 * // in a tool handler: keep the runner's own console output off the wire
 * const report = yield* runTests(files).pipe(capture.capture({ stdout: capture.toStderr }))
 * ```
 *
 * @public
 */
export class StdioCapture {
	/** A sink that writes through the host's original, unpatched stderr: captured output stays visible off the wire. */
	readonly toStderr: StdioSink;

	private constructor(toStderr: StdioSink) {
		this.toStderr = toStderr;
	}

	/**
	 * Patches `host`'s two streams. Idempotent per stream, across every installed
	 * copy of this package: a stream already patched (through another host
	 * object, or another copy) keeps its one patch and its original `write`.
	 */
	static readonly install = (host: StdioCaptureHost): StdioCapture => {
		patch(host.stdout, (options) => options.stdout);
		const stderr = patch(host.stderr, (options) => options.stderr);
		return new StdioCapture({
			write: (...args: Array<unknown>): boolean => stderr.apply(host.stderr, args as [unknown]),
		});
	};

	/**
	 * A write-only sink that drops every write and calls the write's callback.
	 *
	 * @remarks
	 * It is a {@link StdioSink}, not a stream: it has no `on`, `pipe` target
	 * protocol or `setMaxListeners`, so it cannot stand in where a library
	 * expects a `Writable` (a test runner's logger stream that worker output
	 * is piped into, for one). Use {@link StdioCapture.nullWritable} there; it
	 * serves as a capture sink too.
	 */
	static readonly discard: StdioSink = {
		write: (_chunk: unknown, ...rest: Array<unknown>): boolean => {
			const callback = callbackOf(rest);
			if (callback !== undefined) queueMicrotask(callback);
			return true;
		},
	};

	/**
	 * A new Node `Writable` that drops everything written to it: a real stream,
	 * so it works as a `pipe` target, takes `setMaxListeners`, emits `drain`
	 * and `finish`, and is also a {@link StdioSink} for a capture.
	 *
	 * @remarks
	 * A factory, not a shared value: a stream ends once, and a source piped in
	 * with the default `{ end: true }` ends its destination. Build one per
	 * consumer.
	 */
	static readonly nullWritable = (): Writable =>
		new Writable({
			decodeStrings: false,
			write: (_chunk, _encoding, callback) => callback(),
		});

	/**
	 * Runs `evaluate` with its writes captured, for code that is not Effect.
	 * A synchronous throw from `evaluate` rejects the returned promise.
	 */
	run<A>(options: StdioCaptureOptions, evaluate: () => PromiseLike<A>): Promise<A> {
		return registry.storage.run(options, async () => evaluate());
	}

	/**
	 * Runs an effect with its writes captured: on its own fiber, started inside
	 * the capture's context, so the context survives every suspension of that
	 * fiber. Interrupting the returned effect interrupts that fiber and waits
	 * for it.
	 */
	capture(options: StdioCaptureOptions): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> {
		const { storage } = registry;
		return <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
			// Fork and finalizer install happen with interruption masked: the inner fiber can start (and
			// wake the caller's interrupter) synchronously, and an interrupt landing between the fork and
			// the `ensuring` would orphan it. Only the join is interruptible.
			Effect.uninterruptibleMask((restore) =>
				Effect.withFiber((parent) => {
					const fiber = storage.run(options, () => Effect.runForkWith(parent.context as Context.Context<R>)(self));
					return Effect.ensuring(restore(Fiber.join(fiber)), Fiber.interrupt(fiber));
				}),
			);
	}
}
