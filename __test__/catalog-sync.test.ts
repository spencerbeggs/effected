import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, assert, describe, it } from "vitest";
import type { CatalogMove, StatusRunner, UpgradeResult, UpgradeRunner } from "../lib/scripts/catalog-sync.js";
import {
	CHANGESET_PATH,
	CONFIG_PATH,
	PLUGIN,
	catalogEntries,
	check,
	renderChangeset,
	renderCommitMessage,
	rippleMismatches,
	sync,
} from "../lib/scripts/catalog-sync.js";

const SYNCED = 'range: "^0.10.0"';
const DRIFTED = 'range: "^0.11.0"';

const roots: string[] = [];

/** A catalog literal shaped the way the real one is, naming exactly `packages`. */
function catalogConfig(packages: readonly string[]): string {
	const entries = packages
		.map(
			(name) =>
				`\t\t\t\t\t\t"${name}": { range: "^0.1.0", peer: "^0.1.0", strategy: "lock-minor", source: "workspace" },`,
		)
		.join("\n");
	return `await build({\n\tmeta: {\n\t\tcatalogs: {\n\t\t\teffected: {\n\t\t\t\tpackages: {\n${entries}\n\t\t\t\t},\n\t\t\t},\n\t\t},\n\t},\n});\n`;
}

/** Write a publishable package manifest into a root, the way membership discovers one. */
function addPublishable(root: string, name: string): void {
	const dir = join(root, "packages", name.replace("@effected/", ""));
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name, private: true, publishConfig: { access: "public" } }),
	);
}

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

		// Changesets only: the sync also writes a commit-message file beside them,
		// which is gitignored and never committed. The property under test is that
		// repeated runs do not ACCUMULATE changesets, so count those.
		const changesets = readdirSync(join(root, ".changeset")).filter((name) => name.endsWith(".md"));
		assert.deepStrictEqual(changesets, ["catalog-sync.md"]);
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

describe("catalog:sync message rendering", () => {
	const moves: CatalogMove[] = [
		{ catalog: "effected", pkg: "@effected/spdx", from: "^0.4.0", to: "^0.5.0", peer: "^0.5.0" },
		{ catalog: "effected", pkg: "@effected/app", from: "^0.13.0", to: "^0.13.1", peer: "^0.13.0" },
	];

	it("names every package and both of its ranges, sorted", () => {
		const body = renderChangeset(moves);
		assert.include(body, `"${PLUGIN}": patch`);
		assert.include(body, "### Updates 2 catalog:effected versions");
		// Sorted by package, not by the order the CLI happened to report them.
		assert.isBelow(body.indexOf("@effected/app"), body.indexOf("@effected/spdx"));
		assert.include(body, "- `@effected/app` ^0.13.0 -> ^0.13.1 (peer ^0.13.0)");
		assert.include(body, "- `@effected/spdx` ^0.4.0 -> ^0.5.0 (peer ^0.5.0)");
	});

	it("keeps the peer range, which the CLI never reports", () => {
		// `lock-minor` derives the peer from the new range rather than moving it
		// independently, so it appears in no CLI output and is read back out of
		// the rewritten literal. A caller reading only the range would miss that
		// app's peer floors the patch it just gained.
		assert.include(renderChangeset(moves), "^0.13.0 -> ^0.13.1 (peer ^0.13.0)");
	});

	it("pluralizes on the count", () => {
		const one = moves.slice(0, 1);
		assert.include(renderChangeset(one), "Updates 1 catalog:effected version\n");
		assert.include(renderChangeset(moves), "Updates 2 catalog:effected versions");
	});

	it("drops the peer parenthetical rather than printing undefined", () => {
		const unknown: CatalogMove[] = [
			{ catalog: "effected", pkg: "@effected/spdx", from: "^0.4.0", to: "^0.5.0", peer: undefined },
		];
		const body = renderChangeset(unknown);
		assert.include(body, "- `@effected/spdx` ^0.4.0 -> ^0.5.0");
		assert.notInclude(body, "undefined");
	});

	it("groups a multi-catalog rewrite under one heading each", () => {
		const mixed: CatalogMove[] = [
			...moves,
			{ catalog: "other", pkg: "@effected/zzz", from: "^1.0.0", to: "^1.1.0", peer: "^1.1.0" },
		];
		const body = renderChangeset(mixed);
		assert.include(body, "### Updates 2 catalog:effected versions");
		assert.include(body, "### Updates 1 catalog:other version");
	});

	it("renders a commit message with a conventional headline and a blank line", () => {
		const message = renderCommitMessage(moves);
		const [headline, blank] = message.split("\n");
		assert.strictEqual(headline, "chore(pnpm-plugin-effect): update 2 catalog:effected versions");
		assert.strictEqual(blank, "", "commitlint requires a blank line before the body");
		assert.include(message, "- @effected/app ^0.13.0 -> ^0.13.1 (peer ^0.13.0)");
	});

	it("keeps backticks out of the commit body", () => {
		// The commit contract allows at most two inline-code spans in a body, and a
		// per-package list would pass that instantly. The changeset carries the
		// formatted version; the commit carries the plain one.
		assert.notInclude(renderCommitMessage(moves), "`");
	});

	it("headline stays under the 100-character limit for a large rewrite", () => {
		const many: CatalogMove[] = Array.from({ length: 30 }, (_, i) => ({
			catalog: "effected",
			pkg: `@effected/package-number-${i}`,
			from: "^0.1.0",
			to: "^0.2.0",
			peer: "^0.2.0",
		}));
		const headline = renderCommitMessage(many).split("\n")[0] ?? "";
		assert.isBelow(headline.length, 100, headline);
	});
});

describe("catalog membership gate", () => {
	it("check fails when a publishable package is absent from the catalog", async () => {
		// The defect this gate exists for: the upgrade CLI walks the LITERAL, so a
		// package that was never added to it is invisible and `--check` reports
		// being in sync. The injected runner returns 0 here precisely to model
		// that — the CLI is green and the catalog is still incomplete.
		const root = makeRoot(catalogConfig(["@effected/spdx"]));
		addPublishable(root, "@effected/spdx");
		addPublishable(root, "@effected/schema-org");

		const code = await check({ root, run: async () => ({ code: 0, stdout: "" }) });

		assert.notStrictEqual(code, 0, "a green CLI must not carry an incomplete catalog to success");
	});

	it("check passes when every publishable package is catalogued", () => {
		const root = makeRoot(catalogConfig(["@effected/spdx"]));
		addPublishable(root, "@effected/spdx");

		return check({ root, run: async () => ({ code: 0, stdout: "" }) }).then((code) => {
			assert.strictEqual(code, 0);
		});
	});

	it("the plugin itself is excluded, or the release loop never terminates", async () => {
		// Cataloguing the plugin makes every rewrite bump it, invalidating the
		// catalog and writing another changeset. Its absence IS the termination
		// condition, so discovering it must not read as a gap.
		const root = makeRoot(catalogConfig(["@effected/spdx"]));
		addPublishable(root, "@effected/spdx");
		addPublishable(root, PLUGIN);

		assert.strictEqual(await check({ root, run: async () => ({ code: 0, stdout: "" }) }), 0);
	});

	it("sync refuses before writing anything when the catalog is incomplete", async () => {
		const root = makeRoot(catalogConfig(["@effected/spdx"]));
		addPublishable(root, "@effected/spdx");
		addPublishable(root, "@effected/schema-org");
		const run = runner(DRIFTED);

		let message = "";
		try {
			await sync({ root, run });
			assert.fail("sync must refuse an incomplete catalog rather than proceeding");
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		assert.include(message, "@effected/schema-org", "the refusal names the missing package");

		assert.strictEqual(run.calls.length, 0, "the CLI must not run at all on an incomplete catalog");
		assert.isFalse(existsSync(join(root, CHANGESET_PATH)), "a refused sync writes no changeset");
	});

	it("a directory without a manifest is not a package", async () => {
		// Build output survives a branch switch while tracked files do not, so
		// `packages/<name>/` routinely exists holding only `dist/`. Reading straight
		// through would crash the gate with an ENOENT naming a package.json nobody
		// deleted.
		const root = makeRoot(catalogConfig(["@effected/spdx"]));
		addPublishable(root, "@effected/spdx");
		mkdirSync(join(root, "packages/leftover-build-output"), { recursive: true });

		assert.strictEqual(await check({ root, run: async () => ({ code: 0, stdout: "" }) }), 0);
	});
});

describe("dependency-ripple bumps", () => {
	/** A `changeset status --output` double: writes the plan the real CLI would. */
	function planRunner(releases: readonly { name: string; newVersion: string; type?: string }[]): StatusRunner {
		return async (outputPath) => {
			writeFileSync(outputPath, JSON.stringify({ releases: releases.map((r) => ({ type: "patch", ...r })) }));
			return { code: 0, stdout: "" };
		};
	}

	it("spots a package the plan bumps that the catalog does not name at that version", () => {
		// The whole defect: `@effected/sbom` is bumped as a ripple off another
		// package, so no changeset names it and the upgrade CLI never moves it.
		const root = makeRoot(catalogConfig(["@effected/sbom"]));
		const mismatches = rippleMismatches(root, new Map([["@effected/sbom", "0.4.5"]]));
		assert.deepStrictEqual(mismatches, [{ pkg: "@effected/sbom", from: "^0.1.0", to: "^0.4.5" }]);
	});

	it("says nothing about a package already at its planned version", () => {
		const root = makeRoot(catalogConfig(["@effected/sbom"]));
		assert.deepStrictEqual([...rippleMismatches(root, new Map([["@effected/sbom", "0.1.0"]]))], []);
	});

	it("ignores a package the plan does not release", () => {
		const root = makeRoot(catalogConfig(["@effected/sbom"]));
		assert.deepStrictEqual([...rippleMismatches(root, new Map())], []);
	});

	it("check fails on ripple drift even when the upgrade CLI is green", async () => {
		// Both halves matter: the CLI reports success because it resolved every
		// package it can see, and the catalog is still wrong.
		const root = makeRoot(catalogConfig(["@effected/sbom"]));
		addPublishable(root, "@effected/sbom");

		const code = await check({
			root,
			run: async () => ({ code: 0, stdout: "" }),
			status: planRunner([{ name: "@effected/sbom", newVersion: "0.4.5" }]),
		});

		assert.notStrictEqual(code, 0, "a green CLI must not carry stale ripple versions to success");
	});

	it("sync rewrites the range and floors the peer patch", async () => {
		const root = makeRoot(catalogConfig(["@effected/sbom"]));
		addPublishable(root, "@effected/sbom");

		await sync({
			root,
			run: runner(),
			status: planRunner([{ name: "@effected/sbom", newVersion: "0.4.5" }]),
		});

		const spec = catalogEntries(root).get("@effected/sbom") ?? "";
		assert.include(spec, 'range: "^0.4.5"');
		// lock-minor floors the peer patch: a caret on 0.x pins the minor, so the
		// peer stays open across the patch line the range just advanced within.
		assert.include(spec, 'peer: "^0.4.0"');
	});

	it("a plan that cannot be read is not fatal", async () => {
		// The CLI's own resolution still covers every directly-bumped package, so
		// an unreadable plan degrades to the previous behaviour rather than
		// failing a sync that is otherwise correct.
		const root = makeRoot(catalogConfig(["@effected/sbom"]));
		addPublishable(root, "@effected/sbom");

		const code = await check({
			root,
			run: async () => ({ code: 0, stdout: "" }),
			status: async () => ({ code: 1, stdout: "" }),
		});

		assert.strictEqual(code, 0);
	});
});
