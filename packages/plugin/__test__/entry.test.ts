// A config file imports this package's root to reach `defineSchemastore`, so the root must stay cheap. `vi.mock` cannot
// show that, because it cannot intercept a dependency vitest externalizes, so the built entry runs in a child process
// under a preload that records every module the process resolves. The root `globalSetup` rebuilds `dist/prod` before
// every run, so the entry is this tree's.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { defineConfig } from "@effected/schemastore";
import { defineSchemastore } from "../src/index.js";

const PLUGIN = resolve(import.meta.dirname, "..");
const ENTRY = join(PLUGIN, "dist/prod/npm/pkg/index.js");
const HOOK = join(PLUGIN, "__test__/fixtures/record-resolved.mjs");
const CONTROL = join(PLUGIN, "__test__/fixtures/load-front-end.mjs");
const BUILD_CONTROL = join(PLUGIN, "__test__/fixtures/load-build-engine.mjs");

const scratch = mkdtempSync(join(tmpdir(), "effected-plugin-entry-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const record = (name: string, script: string) => {
	const log = join(scratch, `${name}.log`);
	writeFileSync(log, "");
	const child = spawnSync(process.execPath, ["--import", HOOK, script], {
		cwd: PLUGIN,
		encoding: "utf8",
		env: { PATH: process.env.PATH ?? "", RESOLVED_LOG: log },
		timeout: 60_000,
	});
	assert.strictEqual(child.status, 0, child.stderr);
	return readFileSync(log, "utf8").split("\n").filter(Boolean);
};

const EXPENSIVE =
	/\/packages\/(?:cli|mcp|engine|bundler)\/|\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:ajv|ajv-formats|ink|react|jiti|tsdown|rolldown|typescript)\//;
const expensive = (modules: ReadonlyArray<string>) => modules.filter((url) => EXPENSIVE.test(url));

// The manifest's own text, because a built manifest has already rewritten the protocol.
const dependencies = (pkg: string): Readonly<Record<string, string>> =>
	(
		JSON.parse(readFileSync(resolve(PLUGIN, "..", pkg, "package.json"), "utf8")) as {
			readonly dependencies: Readonly<Record<string, string>>;
		}
	).dependencies;

describe("@effected/plugin's root entry", () => {
	it("defineSchemastore is schemastore's defineConfig", () => {
		assert.strictEqual(defineSchemastore, defineConfig);
	});

	it("control: the recorder sees the front ends when something does load them", () => {
		const hits = expensive(record("control", CONTROL));
		for (const expected of ["/packages/cli/", "/packages/mcp/", "/packages/engine/"]) {
			assert.isTrue(
				hits.some((url) => url.includes(expected)),
				expected,
			);
		}
	});

	it("control: the recorder sees the bundler and its toolchain when something does load them", () => {
		const hits = expensive(record("build-control", BUILD_CONTROL));
		// Workspace links resolve to source, so the bundler is `packages/bundler/src/`; it builds on rolldown and TypeScript.
		for (const expected of ["/packages/bundler/src/", "/tsdown/", "/rolldown/", "/typescript/"]) {
			assert.isTrue(
				hits.some((url) => url.includes(expected)),
				expected,
			);
		}
	});

	it("the root entry reaches no CLI, MCP, bundler, tsdown, rolldown, typescript, ajv or ink", () => {
		const modules = record("root", ENTRY);
		assert.isTrue(
			modules.some((url) => url.includes("/packages/schemastore/")),
			"the entry reached schemastore, so the walk saw the re-export",
		);
		assert.deepStrictEqual(expensive(modules), []);
	});

	// The beta the kit builds on, the RC, and every stable 7.x; a `-dev` nightly matches none of the three.
	it("the four packages that peer typescript agree on one literal range", () => {
		for (const pkg of ["bundler", "cli", "mcp", "plugin"]) {
			const { peerDependencies } = JSON.parse(readFileSync(resolve(PLUGIN, "..", pkg, "package.json"), "utf8")) as {
				readonly peerDependencies: Readonly<Record<string, string>>;
			};
			assert.strictEqual(peerDependencies.typescript, "7.1.0-beta || 7.1.1-rc || >=7.1.0 <8", pkg);
		}
	});

	it("every link in the chain is workspace:*", () => {
		const chain = [
			["plugin", "@effected/cli"],
			["plugin", "@effected/mcp"],
			["plugin", "@effected/schemastore"],
			["cli", "@effected/engine"],
			["mcp", "@effected/engine"],
			["engine", "@effected/schemastore"],
			["engine", "@effected/bundler"],
			["bundler", "@effected/changesets"],
			["schemastore", "@effected/semver"],
		] as const;
		for (const [from, to] of chain) {
			assert.strictEqual(dependencies(from)[to], "workspace:*", `${from} -> ${to}`);
		}
	});
});
