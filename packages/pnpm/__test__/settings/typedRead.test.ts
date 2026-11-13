// `PnpmSettingsCatalog.read` reads one setting through its catalog entry: the sources pnpm
// reads it from, in pnpm's precedence, decoded to the entry's type.

import { assert, describe, it } from "@effect/vitest";
import { Option, Result } from "effect";
import type { PnpmSettingsSources } from "../../src/index.js";
import { PnpmSettings } from "../../src/index.js";
import type { PnpmSettingName } from "../../src/settings.js";
import { PnpmSettingsCatalog } from "../../src/settings.js";

const settingsOf = (sources: PnpmSettingsSources): PnpmSettings => {
	const result = PnpmSettings.fromSourcesResult(sources);
	if (Result.isFailure(result)) throw new Error(`unexpected failure: ${result.failure.message}`);
	return result.success;
};

const workspace = (text: string) => ({ text, path: "/repo/pnpm-workspace.yaml" });
const global = (text: string) => ({ text, path: "/home/u/.config/pnpm/config.yaml" });

describe("PnpmSettingsCatalog.read", () => {
	it("decodes a workspace value to its type", () => {
		const settings = settingsOf({ workspace: workspace("nodeLinker: isolated\n") });
		assert.deepStrictEqual(PnpmSettingsCatalog.read(settings, "nodeLinker"), Result.succeed(Option.some("isolated")));
	});

	it("a value of the wrong type fails shape, naming the setting", () => {
		const settings = settingsOf({ workspace: workspace("nodeLinker: 42\n") });
		const result = PnpmSettingsCatalog.read(settings, "nodeLinker");
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			assert.strictEqual(result.failure.reason, "shape");
			assert.strictEqual(result.failure.setting, "nodeLinker");
			assert.include(result.failure.message, "nodeLinker");
		}
	});

	it("an unset setting is None", () => {
		assert.deepStrictEqual(PnpmSettingsCatalog.read(settingsOf({}), "nodeLinker"), Result.succeed(Option.none()));
	});

	it("the environment wins, decoded from its text", () => {
		const settings = settingsOf({
			workspace: workspace("childConcurrency: 2\nhoist: false\n"),
			env: { PNPM_CONFIG_CHILD_CONCURRENCY: "8", PNPM_CONFIG_HOIST: "true" },
		});
		assert.deepStrictEqual(PnpmSettingsCatalog.read(settings, "childConcurrency"), Result.succeed(Option.some(8)));
		assert.deepStrictEqual(PnpmSettingsCatalog.read(settings, "hoist"), Result.succeed(Option.some(true)));
	});

	it("an environment value that does not decode falls through, as pnpm ignores it", () => {
		const settings = settingsOf({
			workspace: workspace("nodeLinker: hoisted\n"),
			env: { PNPM_CONFIG_NODE_LINKER: "flat" },
		});
		assert.deepStrictEqual(PnpmSettingsCatalog.read(settings, "nodeLinker"), Result.succeed(Option.some("hoisted")));
	});

	it("an environment value is a JSON document for a structured setting", () => {
		const settings = settingsOf({ env: { PNPM_CONFIG_NODE_LINKER: '{"type":"loaded","excluded":["vitest"]}' } });
		assert.deepStrictEqual(
			PnpmSettingsCatalog.read(settings, "nodeLinker"),
			Result.succeed(Option.some({ type: "loaded" as const, excluded: ["vitest"] })),
		);
	});

	it("a source pnpm does not read the setting from is skipped", () => {
		// nodeLinker is workspace-only: the global config.yaml cannot set it.
		const settings = settingsOf({
			global: global("nodeLinker: hoisted\nstateDir: /state\n"),
			workspace: workspace("stateDir: /repo\n"),
		});
		assert.deepStrictEqual(PnpmSettingsCatalog.read(settings, "nodeLinker"), Result.succeed(Option.none()));
		// stateDir is machine-only: the workspace file cannot set it, the global file can.
		assert.deepStrictEqual(PnpmSettingsCatalog.read(settings, "stateDir"), Result.succeed(Option.some("/state")));
	});

	it("an explicit null is the value of a tri-state setting, and unset for any other", () => {
		const settings = settingsOf({
			global: global("scriptShell: /bin/zsh\nchildConcurrency: 3\n"),
			workspace: workspace("scriptShell: null\nchildConcurrency: null\n"),
		});
		assert.deepStrictEqual(PnpmSettingsCatalog.read(settings, "scriptShell"), Result.succeed(Option.some(null)));
		assert.deepStrictEqual(PnpmSettingsCatalog.read(settings, "childConcurrency"), Result.succeed(Option.some(3)));
	});

	describe("an environment value is parsed as pnpm 12 parses that setting", () => {
		// Each case also sets the workspace file, so an ignored variable shows as the file's value.
		const read = <K extends PnpmSettingName>(key: K, env: Record<string, string>, file: string) =>
			PnpmSettingsCatalog.read(settingsOf({ workspace: workspace(file), env }), key);

		it("a json boolean is true or false exactly: yes, TRUE and a JSON string are ignored", () => {
			for (const text of ["yes", "TRUE", "on", '"true"']) {
				const settings = settingsOf({
					workspace: workspace("enableGlobalVirtualStore: false\n"),
					env: { PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE: text },
				});
				assert.deepStrictEqual(
					PnpmSettingsCatalog.read(settings, "enableGlobalVirtualStore"),
					Result.succeed(Option.some(false)),
					text,
				);
				// The root's accessor agrees.
				assert.deepStrictEqual(settings.getBoolean("enableGlobalVirtualStore"), Option.some(false), text);
			}
			// The control: the exact word is read.
			assert.deepStrictEqual(
				read(
					"enableGlobalVirtualStore",
					{ PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE: "true" },
					"enableGlobalVirtualStore: false\n",
				),
				Result.succeed(Option.some(true)),
			);
		});

		it("a json number is a JSON number: a JSON string and an unsigned -0 are ignored, a signed -0 is 0", () => {
			assert.deepStrictEqual(
				read("fetchRetries", { PNPM_CONFIG_FETCH_RETRIES: '"9"' }, "fetchRetries: 7\n"),
				Result.succeed(Option.some(7)),
			);
			assert.deepStrictEqual(
				read("fetchRetries", { PNPM_CONFIG_FETCH_RETRIES: "-0" }, "fetchRetries: 7\n"),
				Result.succeed(Option.some(7)),
			);
			assert.deepStrictEqual(
				read("childConcurrency", { PNPM_CONFIG_CHILD_CONCURRENCY: "-0" }, "childConcurrency: 3\n"),
				Result.succeed(Option.some(0)),
			);
		});

		it("a text setting is the value as written, quotes and all", () => {
			assert.deepStrictEqual(
				read("storeDir", { PNPM_CONFIG_STORE_DIR: '"/x"' }, "storeDir: /file\n"),
				Result.succeed(Option.some('"/x"')),
			);
		});

		it("an enumerated setting reads its word bare or as a JSON string, case-sensitively", () => {
			assert.deepStrictEqual(
				read("nodeLinker", { PNPM_CONFIG_NODE_LINKER: '"pnp"' }, "nodeLinker: isolated\n"),
				Result.succeed(Option.some("pnp")),
			);
			assert.deepStrictEqual(
				read("nodeLinker", { PNPM_CONFIG_NODE_LINKER: "Hoisted" }, "nodeLinker: isolated\n"),
				Result.succeed(Option.some("isolated")),
			);
		});

		it("verifyDepsBeforeRun reads an unrecognized value as true", () => {
			assert.deepStrictEqual(
				read("verifyDepsBeforeRun", { PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "sometimes" }, "verifyDepsBeforeRun: warn\n"),
				Result.succeed(Option.some(true)),
			);
			assert.deepStrictEqual(
				read("verifyDepsBeforeRun", { PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "error" }, "verifyDepsBeforeRun: warn\n"),
				Result.succeed(Option.some("error")),
			);
		});
	});

	it("an unsigned -0 in a file fails shape, a signed -0 reads as 0", () => {
		// pnpm 12 refuses `fetchRetries: -0` (`invalid u32`) and reads `childConcurrency: -0` as 0.
		const settings = settingsOf({ workspace: workspace("fetchRetries: -0\nchildConcurrency: -0\n") });
		const unsigned = PnpmSettingsCatalog.read(settings, "fetchRetries");
		assert.isTrue(Result.isFailure(unsigned) && unsigned.failure.reason === "shape");
		assert.deepStrictEqual(PnpmSettingsCatalog.read(settings, "childConcurrency"), Result.succeed(Option.some(0)));
		// The root's accessor applies the same unsigned rule.
		const root = settingsOf({ workspace: workspace("minimumReleaseAge: -0\n") });
		assert.deepStrictEqual(root.minimumReleaseAge, Option.none());
	});
});

// `PnpmSettings.getNumber` and the catalog's integer codecs read through the one coercion module, so they must agree:
// for a signed setting exactly, and for an unsigned one every value the catalog accepts reads the same through
// `getNumber`, which only adds the negatives pnpm refuses there.
describe("PnpmSettings.getNumber agrees with the catalog", () => {
	const catalogValue = (settings: PnpmSettings, name: PnpmSettingName): Option.Option<unknown> => {
		const result = PnpmSettingsCatalog.read(settings, name);
		return Result.isSuccess(result) ? result.success : Option.none();
	};
	const envTexts = ["7", " 7 ", "-3", "0", "-0", "1.5", "1e2", "1.0", "05", "+5", "abc", '"9"', ""];
	const fileYaml = ["7", '"7"', '" 7 "', "-3", '"-3"', "1.5", '"1.5"', '"1e2"', '"05"', "-0", "abc", "true"];
	const cases = [
		...envTexts.map((text) => ({
			label: `env ${JSON.stringify(text)}`,
			sources: (env: string): PnpmSettingsSources => ({ env: { [env]: text } }),
		})),
		...fileYaml.map((yaml) => ({
			label: `file ${yaml}`,
			sources: (_env: string, key: string): PnpmSettingsSources => ({ workspace: workspace(`${key}: ${yaml}\n`) }),
		})),
	];

	it("for a signed setting, exactly", () => {
		let some = 0;
		for (const { label, sources } of cases) {
			const settings = settingsOf(sources("PNPM_CONFIG_CHILD_CONCURRENCY", "childConcurrency"));
			const viaGetter = settings.getNumber("childConcurrency");
			assert.deepStrictEqual(viaGetter, catalogValue(settings, "childConcurrency"), label);
			if (Option.isSome(viaGetter)) some++;
		}
		assert.isAtLeast(some, 8); // the set must hold readable values, or agreement on None proves nothing
	});

	it("for an unsigned setting, every value the catalog reads", () => {
		let some = 0;
		for (const { label, sources } of cases) {
			const settings = settingsOf(sources("PNPM_CONFIG_FETCH_RETRIES", "fetchRetries"));
			const viaCatalog = catalogValue(settings, "fetchRetries");
			if (Option.isNone(viaCatalog)) continue;
			some++;
			assert.deepStrictEqual<unknown>(settings.getNumber("fetchRetries"), viaCatalog, label);
		}
		assert.isAtLeast(some, 5);
	});
});
