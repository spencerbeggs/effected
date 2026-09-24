import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeStdio from "@effect/platform-node/NodeStdio";
import { Layer } from "effect";
import { McpStdio } from "../../src/index.js";
import { fixtureServer } from "./server.js";

// The one-line main.ts, over the real process stdio.
NodeRuntime.runMain(McpStdio.launch(fixtureServer().pipe(Layer.provide(NodeStdio.layer))), {
	teardown: McpStdio.teardown,
});
