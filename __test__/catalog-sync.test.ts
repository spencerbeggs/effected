import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, assert, describe, it } from "vitest";
import type { UpgradeResult, UpgradeRunner } from "../lib/scripts/catalog-sync.js";
import { CHANGESET_PATH, CONFIG_PATH, PLUGIN, check, sync } from "../lib/scripts/catalog-sync.js";

const SYNCED = 'range: "^0.10.0"';
const DRIFTED = 'range: "^0.11.0"';

const roots: string[] = [];

/** A repo-shaped temp tree: the config the CLI would rewrite, and a .changeset directory. */
function makeRoot(config: string): string {
	const root = mkdtempSync(join(tmpdir(), "catalog-sync-"));
	roots.push(root);
	mkdirSync(join(root, "packages/pnpm-plugin-effect"), { recursive: true });
	mkdirSync(join(root, ".changeset"), { recursive: true });
	writeFileSync(join(root, CONFIG_PATH), config);
	return root;
}

/** Stands in for the CLI: records its invocation, optionally rewriting the config. */
function runner(rewrite?: string, stdout = ""): UpgradeRunner & { calls: { args: readonly string[]; cwd: string }[] } {
	const calls: { args: readonly string[]; cwd: string }[] = [];
	const fn = async (args: readonly string[], cwd: string): Promise<UpgradeResult> => {
		calls.push({ args, cwd });
		if (rewrite !== undefined) writeFileSync(join(cwd, "savvy.build.ts"), rewrite);
		return { code: 0, stdout };
	};
	return Object.assign(fn, { calls });
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("catalog:sync", () => {
	it("is a no-op on a synced tree", async () => {
		const root = makeRoot(SYNCED);
		const run = runner();

		const changed = await sync({ root, run });

		assert.isFalse(changed);
		assert.strictEqual(readFileSync(join(root, CONFIG_PATH), "utf8"), SYNCED);
		assert.isFalse(existsSync(join(root, CHANGESET_PATH)), "a no-op must write no changeset");
	});

	it("writes exactly one fixed-name changeset when the catalog moves", async () => {
		const root = makeRoot(SYNCED);

		const changed = await sync({ root, run: runner(DRIFTED) });

		assert.isTrue(changed);
		assert.strictEqual(readFileSync(join(root, CONFIG_PATH), "utf8"), DRIFTED);
		const changeset = readFileSync(join(root, CHANGESET_PATH), "utf8");
		assert.include(changeset, `"${PLUGIN}": patch`);
		assert.include(changeset, "## Maintenance");
	});

	it("overwrites rather than accumulates across repeated runs", async () => {
		const root = makeRoot(SYNCED);

		await sync({ root, run: runner(DRIFTED) });
		await sync({ root, run: runner('range: "^0.12.0"') });

		assert.deepStrictEqual(readdirSync(join(root, ".changeset")), ["catalog-sync.md"]);
	});

	it("writes no changeset when only the plugin itself bumped", async () => {
		// The plugin is absent from its own catalog, so its version moving rewrites nothing
		// and the CLI reports no change. This is the termination proof: if it ever fails,
		// the plugin has leaked into the catalog and the release loop is live.
		const root = makeRoot(SYNCED);

		const changed = await sync({ root, run: runner() });

		assert.isFalse(changed);
		assert.isFalse(existsSync(join(root, CHANGESET_PATH)));
	});

	it("invokes the upgrade CLI in the plugin directory, so a passing no-op cannot be vacuous", async () => {
		const root = makeRoot(SYNCED);
		const run = runner();

		await sync({ root, run });

		assert.lengthOf(run.calls, 1);
		assert.deepStrictEqual(run.calls[0]?.args, ["upgrade", "savvy.build.ts", "--yes", "--json"]);
		assert.strictEqual(run.calls[0]?.cwd, join(root, "packages/pnpm-plugin-effect"));
	});

	it("fails loudly when the CLI does, rather than reporting a clean sync", async () => {
		const root = makeRoot(SYNCED);

		let message = "";
		try {
			await sync({ root, run: async () => ({ code: 2, stdout: "" }) });
			assert.fail("a non-zero CLI exit must not report a clean sync");
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		assert.include(message, "exited 2");
		assert.isFalse(existsSync(join(root, CHANGESET_PATH)));
	});
});

describe("catalog:check", () => {
	it("keeps the gate on text output, since a red check is read by a human", async () => {
		const root = makeRoot(SYNCED);
		const run = runner();

		await check({ root, run });

		assert.notInclude(run.calls[0]?.args ?? [], "--json", "the gate's output feeds a check-run message");
	});

	it("propagates the gate's exit code and writes nothing", async () => {
		const root = makeRoot(SYNCED);
		const run = runner();

		assert.strictEqual(await check({ root, run }), 0);
		assert.strictEqual(await check({ root, run: async () => ({ code: 1, stdout: "" }) }), 1);
		assert.deepStrictEqual(run.calls[0]?.args, ["upgrade", "savvy.build.ts", "--check"]);
		assert.strictEqual(readFileSync(join(root, CONFIG_PATH), "utf8"), SYNCED);
		assert.isFalse(existsSync(join(root, CHANGESET_PATH)));
	});
});
