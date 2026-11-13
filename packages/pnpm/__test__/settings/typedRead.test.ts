// `readSetting` reads one setting through its catalog entry: the sources pnpm
// reads it from, in pnpm's precedence, decoded to the entry's type.

import { assert, describe, it } from "@effect/vitest";
import { Option, Result } from "effect";
import type { PnpmSettingsSources } from "../../src/index.js";
import { PnpmSettings } from "../../src/index.js";
import { readSetting } from "../../src/settings.js";

const settingsOf = (sources: PnpmSettingsSources): PnpmSettings => {
	const result = PnpmSettings.fromSourcesResult(sources);
	if (Result.isFailure(result)) throw new Error(`unexpected failure: ${result.failure.message}`);
	return result.success;
};

const workspace = (text: string) => ({ text, path: "/repo/pnpm-workspace.yaml" });
const global = (text: string) => ({ text, path: "/home/u/.config/pnpm/config.yaml" });

describe("readSetting", () => {
	it("decodes a workspace value to its type", () => {
		const settings = settingsOf({ workspace: workspace("nodeLinker: isolated\n") });
		assert.deepStrictEqual(readSetting(settings, "nodeLinker"), Result.succeed(Option.some("isolated")));
	});

	it("a value of the wrong type fails shape, naming the setting", () => {
		const settings = settingsOf({ workspace: workspace("nodeLinker: 42\n") });
		const result = readSetting(settings, "nodeLinker");
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			assert.strictEqual(result.failure.reason, "shape");
			assert.strictEqual(result.failure.setting, "nodeLinker");
			assert.include(result.failure.message, "nodeLinker");
		}
	});

	it("an unset setting is None", () => {
		assert.deepStrictEqual(readSetting(settingsOf({}), "nodeLinker"), Result.succeed(Option.none()));
	});

	it("the environment wins, decoded from its text", () => {
		const settings = settingsOf({
			workspace: workspace("childConcurrency: 2\nhoist: false\n"),
			env: { PNPM_CONFIG_CHILD_CONCURRENCY: "8", PNPM_CONFIG_HOIST: "true" },
		});
		assert.deepStrictEqual(readSetting(settings, "childConcurrency"), Result.succeed(Option.some(8)));
		assert.deepStrictEqual(readSetting(settings, "hoist"), Result.succeed(Option.some(true)));
	});

	it("an environment value that does not decode falls through, as pnpm ignores it", () => {
		const settings = settingsOf({
			workspace: workspace("nodeLinker: hoisted\n"),
			env: { PNPM_CONFIG_NODE_LINKER: "flat" },
		});
		assert.deepStrictEqual(readSetting(settings, "nodeLinker"), Result.succeed(Option.some("hoisted")));
	});

	it("an environment value is a JSON document for a structured setting", () => {
		const settings = settingsOf({ env: { PNPM_CONFIG_NODE_LINKER: '{"type":"loaded","excluded":["vitest"]}' } });
		assert.deepStrictEqual(
			readSetting(settings, "nodeLinker"),
			Result.succeed(Option.some({ type: "loaded" as const, excluded: ["vitest"] })),
		);
	});

	it("a source pnpm does not read the setting from is skipped", () => {
		// nodeLinker is workspace-only: the global config.yaml cannot set it.
		const settings = settingsOf({
			global: global("nodeLinker: hoisted\nstateDir: /state\n"),
			workspace: workspace("stateDir: /repo\n"),
		});
		assert.deepStrictEqual(readSetting(settings, "nodeLinker"), Result.succeed(Option.none()));
		// stateDir is machine-only: the workspace file cannot set it, the global file can.
		assert.deepStrictEqual(readSetting(settings, "stateDir"), Result.succeed(Option.some("/state")));
	});

	it("an explicit null is the value of a tri-state setting, and unset for any other", () => {
		const settings = settingsOf({
			global: global("scriptShell: /bin/zsh\nchildConcurrency: 3\n"),
			workspace: workspace("scriptShell: null\nchildConcurrency: null\n"),
		});
		assert.deepStrictEqual(readSetting(settings, "scriptShell"), Result.succeed(Option.some(null)));
		assert.deepStrictEqual(readSetting(settings, "childConcurrency"), Result.succeed(Option.some(3)));
	});
});
