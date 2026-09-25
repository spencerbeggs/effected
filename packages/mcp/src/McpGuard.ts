// Type-only imports: this module is evaluated before anything a crash guard
// protects, so it must not load `effect` or the server graph at runtime.
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
	 * For a test of the guards themselves: `"uncaughtException"` or
	 * `"unhandledRejection"` raises one on a timer right after the server is
	 * serving. Any other value, or `undefined`, does nothing. Wire it to an
	 * environment variable only a test sets.
	 */
	readonly injectCrashAfterConnect?: string | undefined;
}

const fallbackFormat = (error: unknown): string =>
	error instanceof Error ? (error.stack ?? error.message) : String(error);

/**
 * Crash guards for an MCP server process, installed before the server's
 * module graph is loaded. Imported from `@effected/mcp/guard`.
 *
 * @remarks
 * {@link McpGuard.run} registers `uncaughtException` and `unhandledRejection`
 * listeners on `host`, then awaits `load()`, then launches the server with
 * `McpStdio.launch` and `McpStdio.teardown` under the `runMain` it returned.
 * This entrypoint has no static runtime import: it loads `effect` and the
 * stdio wiring only after the guards are listening, so a throw while any of
 * it evaluates is still reported on stderr.
 *
 * - "Connected" means the whole server layer has built, so stdin is being
 *   read. That is before any client sends `initialize`.
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

	/** Install the guards, load the server, and launch it. Resolves once the server is launched. */
	static readonly run = async <ROut, E>(options: McpGuardRunOptions<ROut, E>): Promise<void> => {
		const { host, label } = options;
		const onUncaught = options.policy?.onUncaught ?? "exit";
		const onRejection = options.policy?.onRejection ?? "exit";
		let connected = false;
		let format = fallbackFormat;
		const describe = (error: unknown): string => {
			try {
				return format(error);
			} catch {
				try {
					return fallbackFormat(error);
				} catch {
					return "<unformattable error value>";
				}
			}
		};
		const exits = (mode: "exit" | "exitBeforeConnect" | "log"): boolean =>
			mode === "exit" || (mode === "exitBeforeConnect" && !connected);

		host.on("uncaughtException", (error, origin) => {
			host.stderr.write(`${label}: uncaughtException (${origin}): ${describe(error)}\n`);
			if (exits(onUncaught)) host.exit(1);
		});
		host.on("unhandledRejection", (reason) => {
			host.stderr.write(`${label}: unhandledRejection: ${describe(reason)}\n`);
			if (exits(onRejection)) host.exit(1);
		});

		const inject = options.injectCrashAfterConnect;
		const onReady = (): void => {
			connected = true;
			if (inject === "uncaughtException") {
				setTimeout(() => {
					throw new Error("[injected] uncaughtException");
				}, 0);
			} else if (inject === "unhandledRejection") {
				setTimeout(() => {
					void Promise.reject(new Error("[injected] unhandledRejection"));
				}, 0);
			}
		};

		try {
			const server = await options.load();
			if (server.format !== undefined) format = server.format;
			const { launchGuarded } = await import("./internal/guardLaunch.js");
			launchGuarded(server, onReady);
		} catch (error) {
			host.stderr.write(`${label}: startup failed: ${describe(error)}\n`);
			host.exit(1);
		}
	};
}
