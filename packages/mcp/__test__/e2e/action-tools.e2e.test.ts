// The built bin over real stdio and a real action: a copy of the bundler's `default-minify` fixture, whose `main` reads no
// input, so the load check stays on. The copy gains the `package.json` and `effected.toml` a build needs. The root
// `globalSetup` rebuilds `dist/prod` before every run.

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { McpProcess } from "@effected/mcp-kit/testing";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";

const MCP = resolve(import.meta.dirname, "../..");
const BIN = join(MCP, "dist/prod/npm/pkg/bin/effected-mcp.js");
// The built bin's siblings resolve to their source through the workspace links.
const TSX = createRequire(import.meta.url).resolve("tsx");
const FIXTURE = resolve(MCP, "../bundler/__test__/fixtures/action/default-minify");

mkdirSync(join(MCP, "dist"), { recursive: true });
const scratch = mkdtempSync(join(MCP, "dist", "action-tools-e2e-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const cwd = join(scratch, "action");
cpSync(FIXTURE, cwd, { recursive: true });
writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "default-minify", version: "1.0.0" }));
writeFileSync(join(cwd, "effected.toml"), '[action.entries]\nmain = "src/main.ts"\n');

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
	params: { name: "action_build", arguments: args },
});

describe("the built effected-mcp bin", () => {
	it.live(
		"action_build builds a real action over stdio with a clean wire, and refuses a path outside the root",
		() =>
			Effect.gen(function* () {
				const server = yield* McpProcess.spawn(
					ChildProcess.make(process.execPath, ["--import", TSX, BIN], {
						cwd,
						env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
					}),
				);
				yield* server.send(INITIALIZE);
				yield* server.readUntilResponse(1);
				yield* server.send({ jsonrpc: "2.0", method: "notifications/initialized" });

				yield* server.send(call(2, { persist: false }));
				const built = yield* server.readUntilResponse(2);
				const result = built.response.result as {
					readonly isError?: boolean;
					readonly structuredContent?: {
						readonly verdict?: string;
						readonly result?: { readonly persisted?: boolean };
					};
				};
				assert.notStrictEqual(result.isError, true, JSON.stringify(result));
				assert.strictEqual(result.structuredContent?.verdict, "ok");
				assert.isFalse(result.structuredContent?.result?.persisted);
				assert.lengthOf(built.seen, 1);
				assert.isTrue(existsSync(join(cwd, "dist/main.js")));

				yield* server.send(call(3, { cwd: "/" }));
				const refused = yield* server.readUntilResponse(3);
				const refusal = refused.response.result as {
					readonly isError?: boolean;
					readonly content?: ReadonlyArray<{ readonly text?: string }>;
				};
				assert.isTrue(refusal.isError);
				assert.include(
					refusal.content?.map((part) => part.text ?? "").join("") ?? "",
					'The cwd "/" is outside the workspace root',
				);

				yield* server.closeStdin;
				assert.strictEqual(yield* server.exitCode, 0);
			}).pipe(Effect.scoped, Effect.timeout("110 seconds"), Effect.provide(NodeServices.layer)),
		120_000,
	);
});
