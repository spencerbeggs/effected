// Hand-written for LspStdio.test.ts; see README.md. A plain Node program: it
// may read `process`, which the package's own sources never do.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeStdio from "@effect/platform-node/NodeStdio";
import { Config, Context, Effect, Layer, Stdio, Stream } from "effect";
import type { LspSessionEnd } from "../../src/index.js";
import { LspFrame, LspStdio } from "../../src/index.js";

const flags = new Set(process.argv.slice(2));

/** A service whose layer reads a required config, as a real server's platform layer reads `HOME`. */
class Home extends Context.Service<Home, string>()("fixture/Home") {}
const HomeLayer = Layer.effect(Home, Config.String("LSP_FIXTURE_HOME"));

const write = (message: unknown) => Effect.sync(() => void process.stdout.write(LspFrame.encode(message)));

/** The smallest hand-rolled message loop: it records `shutdown` and stops on `exit` or at stdin EOF. */
const serve = Effect.gen(function* () {
	const stdio = yield* Stdio.Stdio;
	const home = yield* Home;
	// A log line inside the program: LspStdio.launch routes it to stderr.
	yield* Effect.log(`fixture serving from ${home}`);
	if (flags.has("--die")) return yield* Effect.die(new Error("fixture defect after boot"));
	let shutdownReceived = false;
	let exited = false;
	yield* LspFrame.decodeStream(stdio.stdin).pipe(
		Stream.takeUntil((message) => (message as { readonly method?: unknown }).method === "exit"),
		Stream.runForEach((value) => {
			const message = value as { readonly id?: number | string; readonly method?: string };
			switch (message.method) {
				case "initialize":
					return write({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
				case "shutdown":
					shutdownReceived = true;
					return write({ jsonrpc: "2.0", id: message.id, result: null });
				case "exit":
					exited = true;
					return Effect.void;
				default:
					return Effect.void;
			}
		}),
	);
	return { reason: exited ? "exit" : "closed", shutdownReceived } satisfies LspSessionEnd;
});

const program = serve.pipe(Effect.provide(Layer.mergeAll(NodeStdio.layer, HomeLayer)));

NodeRuntime.runMain(LspStdio.launch(program), {
	// --no-host-exit is the control: the same codes with a host whose exit does nothing.
	teardown: LspStdio.teardown(flags.has("--no-host-exit") ? { exit: () => {} } : process),
});
