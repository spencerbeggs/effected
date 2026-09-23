import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { McpProtocol } from "effect/unstable/ai";
import { ChildProcess } from "effect/unstable/process";
import { McpProbe } from "../src/testing.js";

const FAKE = join(import.meta.dirname, "fixtures", "fake-server.mjs");
const command = (...flags: ReadonlyArray<string>) =>
	ChildProcess.make(process.execPath, [FAKE, ...flags], { env: { PATH: process.env.PATH ?? "" } });

describe("McpProbe.initialize", () => {
	it.live("keeps stdin open until a slow id-1 response arrives, then exits cleanly", () =>
		Effect.gen(function* () {
			const result = yield* McpProbe.initialize(command("--delay-ms=300"));
			assert.strictEqual(result.response.id, 1);
			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, "");
			assert.isTrue(result.stdout.every((line) => (JSON.parse(line) as { jsonrpc?: string }).jsonrpc === "2.0"));
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("speaks server/discover with _meta on the stateless revision", () =>
		Effect.gen(function* () {
			const result = yield* McpProbe.initialize(command(), { protocol: McpProtocol.v2026_07_28 });
			const discovered = result.response.result as {
				readonly supportedVersions: ReadonlyArray<string>;
				readonly echoedMeta: { readonly [key: string]: unknown } | null;
			};
			assert.deepStrictEqual(discovered.supportedVersions, ["2026-07-28"]);
			assert.isNotNull(discovered.echoedMeta);
			assert.strictEqual(discovered.echoedMeta?.["io.modelcontextprotocol/protocolVersion"], "2026-07-28");
			assert.isDefined(discovered.echoedMeta?.["io.modelcontextprotocol/clientInfo"]);
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("a child that exits before responding fails with StreamEnded", () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(McpProbe.initialize(command("--exit-early")));
			assert.strictEqual(failure._tag, "McpTestFailure");
			assert.strictEqual(failure._tag === "McpTestFailure" ? failure.reason : undefined, "StreamEnded");
			assert.include(failure.message, "fatal: config missing");
			assert.include(failure.message, "exited with code 3");
			// The probe already folded stderr in; the spawned-client hint to go read it would be stale here.
			assert.notInclude(failure.message, "stderrFinal");
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);

	it.live("a stdout line that is not JSON-RPC fails the probe with NotJsonRpc, naming the line", () =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(McpProbe.initialize(command("--noise")));
			assert.strictEqual(failure._tag === "McpTestFailure" ? failure.reason : undefined, "NotJsonRpc");
			assert.include(failure.message, "this line is not json-rpc");
		}).pipe(Effect.timeout("3 seconds"), Effect.provide(NodeServices.layer)),
	);
});
