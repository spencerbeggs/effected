// The two source bins as a person, an editor or the plugin's start-mcp.sh launch them: directly, with no pnpm script to
// supply nodeOptions, so each must register tsx itself. The built half holds tsx out of what publishes, because a
// bundled tsx leaves `issues.json` clean. The root `globalSetup` rebuilds `dist/prod` before every run.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";

const PACKAGES = resolve(import.meta.dirname, "../..");
const BIN = resolve(PACKAGES, "../node_modules/.bin");
// A directory that cannot resolve tsx: the bin has to find it from its own location, not the cwd.
const scratch = mkdtempSync(join(tmpdir(), "effected-plugin-bins-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const launch = (name: string, args: ReadonlyArray<string>, input: string) =>
	spawnSync(join(BIN, name), args, {
		cwd: scratch,
		encoding: "utf8",
		env: { PATH: process.env.PATH ?? "" },
		input,
		timeout: 60_000,
	});

const INITIALIZE = `${JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "bin-launch", version: "1" },
	},
})}\n`;

describe("a source bin launched directly, with no NODE_OPTIONS", () => {
	it("effected answers --version", { timeout: 60_000 }, () => {
		const child = launch("effected", ["--version"], "");
		assert.strictEqual(child.status, 0, child.stderr);
		assert.match(child.stdout, /^effected \S+ via @effected\/plugin \S+\n$/);
	});

	it("effected-mcp answers an initialize and exits at end of input", { timeout: 60_000 }, () => {
		const child = launch("effected-mcp", [], INITIALIZE);
		assert.strictEqual(child.status, 0, child.stderr);
		const first = JSON.parse(child.stdout.split("\n")[0] ?? "") as {
			readonly id: number;
			readonly result: { readonly serverInfo: unknown };
		};
		assert.strictEqual(first.id, 1);
		assert.isDefined(first.result.serverInfo);
	});
});

describe("tsx stays out of what publishes", () => {
	const BUILT = [
		{ pkg: "plugin", bins: ["bin/effected.js", "bin/effected-mcp.js"] },
		{ pkg: "cli", bins: ["bin/effected.js"] },
		{ pkg: "mcp", bins: ["bin/effected-mcp.js"] },
	];

	for (const { pkg, bins } of BUILT) {
		const root = join(PACKAGES, pkg, "dist/prod/npm/pkg");

		it(`@effected/${pkg} bundles no tsx and does not depend on it`, () => {
			assert.isFalse(existsSync(join(root, "node_modules")), readdirSync(root).join(", "));
			const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Readonly<
				Record<string, Readonly<Record<string, string>> | undefined>
			>;
			for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
				assert.notProperty(manifest[field] ?? {}, "tsx", field);
			}
		});

		for (const bin of bins) {
			it(`@effected/${pkg}'s ${bin} still guards the branch and names no resolved tsx path`, () => {
				const text = readFileSync(join(root, bin), "utf8");
				// The control: this is the bin that holds the branch, so the next check can fail.
				assert.include(text, 'import.meta.url.endsWith(".ts")');
				assert.notInclude(text, "node_modules");
			});
		}
	}
});
