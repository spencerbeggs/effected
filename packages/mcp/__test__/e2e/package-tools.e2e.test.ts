// The built bin over real stdio and a real package: a copy of `packages/jsonc`, under this package's `dist` because its
// `catalog:` and `workspace:` specifiers need the real workspace above it. tsdown and API Extractor run in the server's
// process, so what they print must not reach the wire. The root `globalSetup` rebuilds `dist/dev` before every run.

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { McpProcess } from "@effected/mcp-kit/testing";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";

const MCP = resolve(import.meta.dirname, "../..");
const BIN = join(MCP, "dist/dev/pkg/bin/effected-mcp.js");
const JSONC = resolve(MCP, "../jsonc");

mkdirSync(join(MCP, "dist"), { recursive: true });
const scratch = mkdtempSync(join(MCP, "dist", "package-tools-e2e-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const cwd = join(scratch, "jsonc");
cpSync(JSONC, cwd, {
	recursive: true,
	filter: (source) => !["dist", "node_modules", ".turbo"].includes(source.slice(JSONC.length + 1)),
});
symlinkSync(join(JSONC, "node_modules"), join(cwd, "node_modules"));

const INITIALIZE = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } },
};

const call = (id: number, args: Record<string, unknown>) => ({
	jsonrpc: "2.0",
	id,
	method: "tools/call",
	params: { name: "package_build", arguments: args },
});

describe("the built effected-mcp bin", () => {
	it.live(
		"package_build builds a real package over stdio with a clean wire, and refuses a path outside the root",
		() =>
			Effect.gen(function* () {
				const server = yield* McpProcess.spawn(
					ChildProcess.make(process.execPath, [BIN], {
						cwd,
						env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
					}),
				);
				yield* server.send(INITIALIZE);
				yield* server.readUntilResponse(1);
				yield* server.send({ jsonrpc: "2.0", method: "notifications/initialized" });

				yield* server.send(call(2, { noExe: true }));
				const built = yield* server.readUntilResponse(2);
				const result = built.response.result as {
					readonly isError?: boolean;
					readonly structuredContent?: { readonly verdict?: string; readonly package?: string };
				};
				assert.notStrictEqual(result.isError, true, JSON.stringify(result));
				assert.strictEqual(result.structuredContent?.verdict, "ok");
				assert.strictEqual(result.structuredContent?.package, "@effected/jsonc");
				assert.lengthOf(built.seen, 1);
				assert.isTrue(existsSync(join(cwd, "dist/prod/issues.json")));

				yield* server.send(call(3, { cwd: "/" }));
				const refused = yield* server.readUntilResponse(3);
				assert.isTrue((refused.response.result as { readonly isError?: boolean }).isError);

				yield* server.closeStdin;
				assert.strictEqual(yield* server.exitCode, 0);
			}).pipe(Effect.scoped, Effect.timeout("170 seconds"), Effect.provide(NodeServices.layer)),
		180_000,
	);
});
