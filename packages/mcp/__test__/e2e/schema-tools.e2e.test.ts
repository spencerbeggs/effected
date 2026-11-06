// The built bin over real stdio: stdout is the JSON-RPC wire, and a config is arbitrary code running in the server's
// process, so what it prints must not reach the wire. An in-process harness cannot see this, because `console.log`
// there goes to the test runner. The root `globalSetup` rebuilds `dist/prod` before every run, so the bin is this tree's.

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { McpProcess } from "@effected/mcp-kit/testing";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";

const BIN = resolve(import.meta.dirname, "../../dist/prod/npm/pkg/bin/effected-mcp.js");
const MODULES = resolve(import.meta.dirname, "../../node_modules");

const scratch = mkdtempSync(join(tmpdir(), "effected-mcp-e2e-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
symlinkSync(MODULES, join(scratch, "node_modules"));
writeFileSync(join(scratch, "pnpm-workspace.yaml"), "");
writeFileSync(
	join(scratch, "schemastore.config.ts"),
	`import { defineConfig } from "@effected/schemastore";
import { Schema } from "effect";
console.log("noise from the config");
export default defineConfig({
	name: "demo",
	outputDir: "schemas",
	baseUrl: "https://example.com/s",
	schemas: { app: { schema: Schema.Struct({ name: Schema.String }) } },
});
`,
);

const INITIALIZE = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } },
};

const call = (id: number, name: string) => ({
	jsonrpc: "2.0",
	id,
	method: "tools/call",
	params: { name, arguments: {} },
});

describe("the built effected-mcp bin", () => {
	it.live(
		"schema_check answers over stdio, a config's console.log goes to stderr, and the wire stays clean",
		() =>
			Effect.gen(function* () {
				const server = yield* McpProcess.spawn(
					ChildProcess.make(process.execPath, [BIN], { cwd: scratch, env: { PATH: process.env.PATH ?? "" } }),
				);
				yield* server.send(INITIALIZE);
				yield* server.readUntilResponse(1);
				yield* server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
				yield* server.send(call(2, "schema_check"));
				const { response, seen } = yield* server.readUntilResponse(2);
				const result = response.result as {
					readonly isError?: boolean;
					readonly structuredContent?: { readonly verdict?: string };
				};
				assert.notStrictEqual(result.isError, true, JSON.stringify(result));
				assert.strictEqual(result.structuredContent?.verdict, "stale");
				assert.lengthOf(seen, 1);
				yield* server.closeStdin;
				assert.strictEqual(yield* server.exitCode, 0);
				assert.include(yield* server.stderrFinal, "noise from the config");
			}).pipe(Effect.scoped, Effect.timeout("45 seconds"), Effect.provide(NodeServices.layer)),
		60_000,
	);
});
