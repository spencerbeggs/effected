// This module is evaluated before anything a crash guard protects, so it must
// not load `effect` or the server graph at runtime: `effect` is a type-only
// import, and the one runtime import, `@effected/engine/guard`, imports
// nothing itself (pinned by `entrypoints.test.ts`).
import { ProcessGuard } from "@effected/engine/guard";
import type { Effect, Layer, Runtime } from "effect";

/**
 * The slice of the host process the guard uses. Node's `process` satisfies it.
 *
 * @public
 */
export interface McpGuardHost {
	/** Register the `uncaughtException` listener. */
	on(event: "uncaughtException", listener: (error: Error, origin: string) => void): unknown;
	/** Register the `unhandledRejection` listener. */
	on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
	/** Raise an `uncaughtException` to the registered listeners. Used only by {@link McpGuardRunOptions.injectCrash}. */
	emit(event: "uncaughtException", error: Error, origin: "uncaughtException" | "unhandledRejection"): unknown;
	/** Raise an `unhandledRejection` to the registered listeners. Used only by {@link McpGuardRunOptions.injectCrash}. */
	emit(event: "unhandledRejection", reason: unknown, promise: Promise<unknown>): unknown;
	/** Where every guard report is written. Never stdout: that is the JSON-RPC wire. */
	readonly stderr: { write(chunk: string): unknown };
	/** End the process at once. */
	exit(code?: number): never;
}

/**
 * When a stray exception or rejection ends the process.
 *
 * @remarks
 * `"exit"` exits 1 whenever it happens. `"exitBeforeConnect"` exits 1 until
 * the server is serving, then logs and keeps serving: a server that dies
 * mid-session deregisters every tool from the client. `"log"` never exits.
 *
 * @public
 */
export interface McpGuardPolicy {
	/** For `uncaughtException`. */
	readonly onUncaught: "exit" | "exitBeforeConnect";
	/** For `unhandledRejection`. Defaults to `"exit"`. */
	readonly onRejection?: "exit" | "exitBeforeConnect" | "log" | undefined;
}

/**
 * What {@link McpGuardRunOptions.load} resolves to: the server and the
 * platform runner to launch it with.
 *
 * @public
 */
export interface McpGuardedServer<ROut, E> {
	/** The whole server layer, stdio included, with nothing left to provide. */
	readonly layer: Layer.Layer<ROut, E, never>;
	/** The platform's `runMain`, such as `NodeRuntime.runMain` from `@effect/platform-node`. */
	readonly runMain: (effect: Effect.Effect<never, Error>, options: { readonly teardown: Runtime.Teardown }) => void;
	/** Formats a reported error from here on; the guard's own dependency-free formatter until then. */
	readonly format?: ((error: unknown) => string) | undefined;
}

/**
 * Options for {@link McpGuard.run}.
 *
 * @public
 */
export interface McpGuardRunOptions<ROut, E> {
	/** Prefixes every report the guard writes, as in `my-server: uncaughtException (…): …`. */
	readonly label: string;
	/** The process: pass `process`. */
	readonly host: McpGuardHost;
	/** Defaults to `{ onUncaught: "exit", onRejection: "exit" }`. */
	readonly policy?: McpGuardPolicy | undefined;
	/**
	 * Import and assemble the server. Everything that can throw while loading
	 * belongs here, behind a dynamic `import()`, so the guards are already
	 * listening when it runs.
	 */
	readonly load: () => Promise<McpGuardedServer<ROut, E>>;
	/**
	 * For a test of the guards themselves: raise one stray `kind` at `at`, so
	 * both halves of a policy can be driven end to end in a real process.
	 *
	 * @remarks
	 * - `"load"` raises it once both listeners are installed and before
	 *   `load()` is called, then waits for the guard to handle it: `load()`
	 *   is not called until the listener has run. If a test double's `exit`
	 *   throws instead of ending the process, `run` rejects with what it
	 *   threw and never calls `load()`. The pre-connect half of
	 *   the policy applies, so `"exitBeforeConnect"` exits 1 here, and only
	 *   an `onRejection` of `"log"` lets the process go on to load and serve.
	 *   The report uses the guard's own formatter, since no `format` is
	 *   loaded yet.
	 * - `"connected"` raises it on a timer right after the server is
	 *   serving, where `"exitBeforeConnect"` logs and keeps serving. A throw
	 *   from a test double's `exit` there is dropped.
	 *
	 * **The `"connected"` report is asynchronous.** It is raised on a later
	 * tick, a `setTimeout(0)` after the server starts serving, so it can land
	 * after the first responses a test reads: reading stderr once, right
	 * after the `initialize` or `tools/list` response, can see an empty
	 * buffer. Wait for it with `McpProcess.stderrUntil` from
	 * `@effected/mcp/testing` rather than reading it once.
	 *
	 * Either is raised only through `host.emit`, on a `setTimeout(0)` tick,
	 * never as a real throw or rejection, so the guard's listeners handle it
	 * the same way under the real `process` and under a test double. Under
	 * `process`, every listener registered for the event sees it, not only
	 * the guard's. It carries an `[injected]` message; a rejection is emitted
	 * with an already-handled rejected promise. `undefined`, or
	 * an `at` or `kind` outside these values, does nothing at all. Wire it to
	 * an environment variable only a test sets.
	 */
	readonly injectCrash?:
		| {
				readonly at: "load" | "connected";
				readonly kind: "uncaughtException" | "unhandledRejection";
		  }
		| undefined;
}

/**
 * Crash guards for an MCP server process, installed before the server's
 * module graph is loaded. Imported from `@effected/mcp/guard`.
 *
 * @remarks
 * {@link McpGuard.run} is `ProcessGuard.run` from `@effected/engine/guard`
 * with an MCP launch in its `load`: it registers `uncaughtException` and
 * `unhandledRejection` listeners on `host`, then awaits `load()`, then
 * launches the server with `McpStdio.launch` and `McpStdio.teardown` under
 * the `runMain` it returned. A server on another transport (an LSP over
 * `vscode-languageserver`, say) uses `ProcessGuard.run` directly and calls
 * its `markConnected` itself. This entrypoint statically imports only
 * `@effected/engine/guard`, which imports nothing: it loads `effect` and the
 * stdio wiring only after the guards are listening, so a throw while any of
 * it evaluates is still reported on stderr.
 *
 * - "Connected" means the whole server layer has built, so stdin is being
 *   read. That is before any client sends `initialize`.
 * - `injectCrash` drives either half of the policy from a test, before
 *   `load()` or once connected; unset, it does nothing.
 * - A `load()` that rejects is reported as `startup failed` and exits 1
 *   whatever the policy. Left to a log-only rejection listener, it would
 *   let the event loop drain and exit 0 with no server.
 * - Installing an `unhandledRejection` listener switches off Node's default
 *   of throwing on one, so `"log"` really does keep the process running.
 * - An exit from a guard skips Effect's finalizers and the teardown.
 * - Keeping on serving after a crash works because the platform `runMain`
 *   holds the process open while the server fiber lives.
 * - A layer that fails to build is still reported by `McpStdio.launch`.
 *
 * @example
 * ```ts
 * import { McpGuard } from "@effected/mcp/guard";
 *
 * await McpGuard.run({
 *   label: "my-server",
 *   host: process,
 *   policy: { onUncaught: "exitBeforeConnect", onRejection: "log" },
 *   load: async () => {
 *     const { NodeRuntime } = await import("@effect/platform-node");
 *     const { Main } = await import("./server.js");
 *     return { layer: Main, runMain: NodeRuntime.runMain };
 *   },
 * });
 * ```
 *
 * @public
 */
export class McpGuard {
	private constructor() {}

	/**
	 * Parse a test-only crash-injection setting into {@link McpGuardRunOptions.injectCrash}: `<at>:<kind>`, where `at`
	 * is `"load"` or `"connected"` and `kind` is `"uncaughtException"` or `"unhandledRejection"`. Anything else, or no
	 * value, is `undefined`. The same grammar as `ProcessGuard.parseInjectCrash` from `@effected/engine/guard`, which
	 * this is, so an MCP launcher need not import the engine guard for it.
	 *
	 * @example
	 * ```ts
	 * McpGuard.parseInjectCrash("load:uncaughtException"); // => { at: "load", kind: "uncaughtException" }
	 * ```
	 */
	static readonly parseInjectCrash: (value: string | undefined) => McpGuardRunOptions<unknown, unknown>["injectCrash"] =
		ProcessGuard.parseInjectCrash;

	/** Install the guards, load the server, and launch it. Resolves once the server is launched. */
	static readonly run = <ROut, E>(options: McpGuardRunOptions<ROut, E>): Promise<void> =>
		ProcessGuard.run({
			label: options.label,
			host: options.host,
			policy: options.policy,
			injectCrash: options.injectCrash,
			load: async (guard) => {
				const server = await options.load();
				if (server.format !== undefined) guard.useFormat(server.format);
				const { launchGuarded } = await import("./internal/guardLaunch.js");
				launchGuarded(server, guard.markConnected);
			},
		});
}
