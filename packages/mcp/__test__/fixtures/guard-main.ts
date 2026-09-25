import type { McpGuardPolicy } from "../../src/guard.js";
import { McpGuard } from "../../src/guard.js";

// Flags: --policy=exit|exitBeforeConnect, --rejection=exit|exitBeforeConnect|log,
// --inject=uncaughtException|unhandledRejection, --fail-load, --crash-in-load.
const flag = (name: string): string | undefined =>
	process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const policy: McpGuardPolicy = {
	onUncaught: (flag("policy") ?? "exit") as McpGuardPolicy["onUncaught"],
	onRejection: (flag("rejection") ?? "exit") as NonNullable<McpGuardPolicy["onRejection"]>,
};

await McpGuard.run({
	label: "guard-fixture",
	host: process,
	policy,
	injectCrashAfterConnect: flag("inject"),
	load: async () => {
		if (has("fail-load")) throw new Error("no server here");
		if (has("crash-in-load")) {
			setTimeout(() => {
				throw new Error("crashed while loading");
			}, 0);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const NodeRuntime = await import("@effect/platform-node/NodeRuntime");
		const NodeStdio = await import("@effect/platform-node/NodeStdio");
		const { Layer } = await import("effect");
		const { fixtureServer } = await import("./server.js");
		return {
			layer: fixtureServer().pipe(Layer.provide(NodeStdio.layer)),
			runMain: NodeRuntime.runMain,
			format: (error: unknown) => `formatted(${error instanceof Error ? error.message : String(error)})`,
		};
	},
});
