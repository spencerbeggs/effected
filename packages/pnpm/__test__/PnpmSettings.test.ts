// `PnpmSettings.fromSourcesResult` and the accessors: the pure half.
//
// The precedence and parsing rules below were read off pnpm itself (12.18.0,
// the native binary, and 11.28.11, the JS build) with `pnpm config get` over
// hermetic HOME / XDG_CONFIG_HOME trees: env beats pnpm-workspace.yaml beats
// the global config.yaml; `.npmrc` and `npm_config_*` carry no pnpm setting;
// an unparseable env value falls through, a null file value is unset, and an
// empty list shadows. Every case here sets a value in more than one source,
// so an implementation that read the wrong source could not pass it.

import { assert, describe, it } from "@effect/vitest";
import { Option, Result } from "effect";
import type { PnpmSettingsSources } from "../src/index.js";
import { PnpmSettings } from "../src/index.js";

const settingsOf = (sources: PnpmSettingsSources): PnpmSettings => {
	const result = PnpmSettings.fromSourcesResult(sources);
	if (Result.isFailure(result)) throw new Error(`unexpected failure: ${result.failure.message}`);
	return result.success;
};

const workspace = (text: string) => ({ text, path: "/repo/pnpm-workspace.yaml" });
const global = (text: string) => ({ text, path: "/home/u/.config/pnpm/config.yaml" });

describe("PnpmSettings precedence", () => {
	const all = settingsOf({
		global: global("minimumReleaseAge: 400\nminimumReleaseAgeExclude:\n  - g\nonlyGlobal: true\n"),
		workspace: workspace("minimumReleaseAge: 100\nminimumReleaseAgeExclude:\n  - w1\n  - w2\nonlyWorkspace: x\n"),
		env: { PNPM_CONFIG_MINIMUM_RELEASE_AGE: "600", npm_config_only_global: "false" },
	});

	it("an environment variable wins over both files", () => {
		assert.deepStrictEqual(all.minimumReleaseAge, Option.some(600));
		assert.deepStrictEqual(all.get("minimumReleaseAge"), Option.some("600"));
		assert.deepStrictEqual(all.origin("minimumReleaseAge"), Option.some("environment"));
	});

	it("the workspace file wins over the global file, whole: lists are not merged", () => {
		assert.deepStrictEqual(all.minimumReleaseAgeExclude, ["w1", "w2"]);
		assert.deepStrictEqual(all.origin("minimumReleaseAgeExclude"), Option.some("workspace"));
	});

	it("each source answers the keys only it sets", () => {
		assert.deepStrictEqual(all.getBoolean("onlyGlobal"), Option.some(true));
		assert.deepStrictEqual(all.origin("onlyGlobal"), Option.some("global"));
		assert.deepStrictEqual(all.getString("onlyWorkspace"), Option.some("x"));
	});

	it("npm_config_* is not a pnpm setting source", () => {
		// npm_config_only_global=false would flip the global `true` if it were read.
		assert.deepStrictEqual(all.getBoolean("onlyGlobal"), Option.some(true));
		assert.deepStrictEqual(all.get("onlyGlobal"), Option.some(true));
	});

	it("records the files lowest precedence first", () => {
		assert.deepStrictEqual(all.files, ["/home/u/.config/pnpm/config.yaml", "/repo/pnpm-workspace.yaml"]);
	});

	it("an unset key is None from every accessor and an empty list from the exclude getter", () => {
		const none = settingsOf({});
		assert.isTrue(Option.isNone(none.get("minimumReleaseAge")));
		assert.isTrue(Option.isNone(none.origin("minimumReleaseAge")));
		assert.isTrue(Option.isNone(none.minimumReleaseAge));
		assert.deepStrictEqual(none.minimumReleaseAgeExclude, []);
		assert.deepStrictEqual(none.files, []);
	});
});

describe("PnpmSettings keys", () => {
	const settings = settingsOf({ workspace: workspace("minimumReleaseAgeStrict: true\n") });

	it("a kebab-case key names the camelCase setting", () => {
		assert.deepStrictEqual(settings.getBoolean("minimum-release-age-strict"), Option.some(true));
		assert.deepStrictEqual(settings.getBoolean("minimumReleaseAgeStrict"), Option.some(true));
	});

	it("reads both env spellings pnpm accepts and nothing else", () => {
		const read = (env: Record<string, string>) => settingsOf({ env }).getNumber("minimumReleaseAge");
		assert.deepStrictEqual(read({ pnpm_config_minimum_release_age: "1" }), Option.some(1));
		assert.deepStrictEqual(read({ PNPM_CONFIG_MINIMUM_RELEASE_AGE: "2" }), Option.some(2));
		assert.isTrue(Option.isNone(read({ Pnpm_Config_MINIMUM_RELEASE_AGE: "3" })));
		assert.isTrue(Option.isNone(read({ pnpm_config_MINIMUM_RELEASE_AGE: "4" })));
		assert.isTrue(Option.isNone(read({ PNPM_CONFIG_minimum_release_age: "5" })));
		assert.isTrue(Option.isNone(read({ pnpm_config_minimumReleaseAge: "6" })));
		assert.isTrue(Option.isNone(read({ npm_config_minimum_release_age: "7" })));
		assert.isTrue(Option.isNone(read({ PNPM_CONFIG_MINIMUM__RELEASE_AGE: "8" })));
	});

	it("the uppercase spelling wins when both are set", () => {
		const settings = settingsOf({
			env: { pnpm_config_minimum_release_age: "1", PNPM_CONFIG_MINIMUM_RELEASE_AGE: "2" },
		});
		assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(2));
	});

	it("an empty env value is unset and the file answers", () => {
		const settings = settingsOf({
			workspace: workspace("minimumReleaseAge: 9\n"),
			env: { PNPM_CONFIG_MINIMUM_RELEASE_AGE: "" },
		});
		assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(9));
		assert.deepStrictEqual(settings.origin("minimumReleaseAge"), Option.some("workspace"));
	});

	it("an inherited Object member is never a setting", () => {
		const settings = settingsOf({ workspace: workspace("packages: []\n") });
		for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
			assert.isTrue(Option.isNone(settings.get(key)), key);
			assert.isTrue(Option.isNone(settings.getString(key)), key);
		}
	});

	it("a __proto__ key in a file is an own setting and pollutes nothing", () => {
		const settings = settingsOf({ workspace: workspace('"__proto__":\n  polluted: true\n') });
		assert.deepStrictEqual(settings.get("__proto__"), Option.some({ polluted: true }));
		assert.isUndefined((Object.prototype as Record<string, unknown>).polluted);
		assert.isUndefined(Object.getPrototypeOf(settings.workspace).polluted);
	});
});

describe("PnpmSettings typed reads", () => {
	it("an env value that does not read as the asked type falls through to the files", () => {
		const settings = settingsOf({
			workspace: workspace("minimumReleaseAge: 9\nminimumReleaseAgeExclude:\n  - w\nminimumReleaseAgeStrict: true\n"),
			env: {
				PNPM_CONFIG_MINIMUM_RELEASE_AGE: "abc",
				PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE: "a,b",
				PNPM_CONFIG_MINIMUM_RELEASE_AGE_STRICT: "yes",
			},
		});
		assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(9));
		assert.deepStrictEqual(settings.minimumReleaseAgeExclude, ["w"]);
		assert.deepStrictEqual(settings.getBoolean("minimumReleaseAgeStrict"), Option.some(true));
		// `get` still reports the raw variable it found.
		assert.deepStrictEqual(settings.get("minimumReleaseAgeExclude"), Option.some("a,b"));
	});

	it("env values parse by type: a JSON list, a boolean literal, a decimal", () => {
		const settings = settingsOf({
			workspace: workspace("minimumReleaseAge: 9\nminimumReleaseAgeExclude:\n  - w\nminimumReleaseAgeStrict: true\n"),
			env: {
				PNPM_CONFIG_MINIMUM_RELEASE_AGE: " 30 ",
				PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE: '["a","b"]',
				PNPM_CONFIG_MINIMUM_RELEASE_AGE_STRICT: "false",
			},
		});
		assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(30));
		assert.deepStrictEqual(settings.minimumReleaseAgeExclude, ["a", "b"]);
		assert.deepStrictEqual(settings.getBoolean("minimumReleaseAgeStrict"), Option.some(false));
	});

	it("a JSON list holding a non-string is not a list", () => {
		const settings = settingsOf({
			workspace: workspace("minimumReleaseAgeExclude:\n  - w\n"),
			env: { PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE: '["a",1]' },
		});
		assert.deepStrictEqual(settings.minimumReleaseAgeExclude, ["w"]);
	});

	it("a mistyped file value answers None instead of reaching the lower file", () => {
		const settings = settingsOf({
			global: global("minimumReleaseAge: 5\nminimumReleaseAgeExclude:\n  - g\nflag: true\n"),
			workspace: workspace('minimumReleaseAge: "abc"\nminimumReleaseAgeExclude: g\nflag: 1\n'),
		});
		assert.isTrue(Option.isNone(settings.minimumReleaseAge));
		assert.deepStrictEqual(settings.minimumReleaseAgeExclude, []);
		// A number is not a boolean, and pnpm 12 refuses it as one.
		assert.isTrue(Option.isNone(settings.getBoolean("flag")));
		assert.deepStrictEqual(settings.get("minimumReleaseAge"), Option.some("abc"));
	});

	it("a null file value is unset and the lower file answers", () => {
		const settings = settingsOf({
			global: global("minimumReleaseAge: 5\n"),
			workspace: workspace("minimumReleaseAge: null\n"),
		});
		assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(5));
		assert.deepStrictEqual(settings.origin("minimumReleaseAge"), Option.some("global"));
	});

	it("an explicitly empty list shadows the lower file", () => {
		const settings = settingsOf({
			global: global("minimumReleaseAgeExclude:\n  - g\n"),
			workspace: workspace("minimumReleaseAgeExclude: []\n"),
		});
		assert.deepStrictEqual(settings.minimumReleaseAgeExclude, []);
		assert.deepStrictEqual(settings.getStringArray("minimumReleaseAgeExclude"), Option.some([]));
	});

	it("minimumReleaseAge takes a non-negative integer only; a quoted decimal in a file counts", () => {
		const age = (sources: PnpmSettingsSources) => settingsOf(sources).minimumReleaseAge;
		assert.deepStrictEqual(age({ workspace: workspace('minimumReleaseAge: "15"\n') }), Option.some(15));
		assert.deepStrictEqual(age({ workspace: workspace("minimumReleaseAge: 0\n") }), Option.some(0));
		assert.isTrue(Option.isNone(age({ workspace: workspace("minimumReleaseAge: 1.5\n") })));
		assert.isTrue(Option.isNone(age({ workspace: workspace("minimumReleaseAge: -1\n") })));
		assert.deepStrictEqual(
			age({ workspace: workspace("minimumReleaseAge: 9\n"), env: { PNPM_CONFIG_MINIMUM_RELEASE_AGE: "1.5" } }),
			Option.some(9),
		);
		// getNumber is the general signed-integer read: it refuses the fraction too, and reads a negative.
		assert.isTrue(
			Option.isNone(settingsOf({ env: { PNPM_CONFIG_MINIMUM_RELEASE_AGE: "1.5" } }).getNumber("minimumReleaseAge")),
		);
		assert.deepStrictEqual(
			settingsOf({ env: { PNPM_CONFIG_MINIMUM_RELEASE_AGE: "-3" } }).getNumber("minimumReleaseAge"),
			Option.some(-3),
		);
	});
});

describe("PnpmSettings.fromSourcesResult failures", () => {
	it("a file that is not YAML fails parse, naming the file", () => {
		const result = PnpmSettings.fromSourcesResult({ workspace: workspace("a: [\n") });
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			assert.strictEqual(result.failure.reason, "parse");
			assert.strictEqual(result.failure.path, "/repo/pnpm-workspace.yaml");
			assert.include(result.failure.message, "/repo/pnpm-workspace.yaml");
		}
	});

	it("a document that is not a mapping fails shape", () => {
		for (const text of ["- a\n", "just text\n", "42\n"]) {
			const result = PnpmSettings.fromSourcesResult({ global: global(text) });
			assert.isTrue(Result.isFailure(result), text);
			if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "shape", text);
		}
	});

	it("an empty file is an empty mapping", () => {
		const settings = settingsOf({ workspace: workspace(""), global: global("# only a comment\n") });
		assert.isTrue(Option.isNone(settings.get("minimumReleaseAge")));
		assert.strictEqual(settings.files.length, 2);
	});
});

describe("PnpmSettings value grammar, as pnpm 12 reads it", () => {
	// Each row was read off pnpm 12 with `pnpm config get minimumReleaseAge`: an
	// accepted value is the number pnpm printed, a rejected env value fell
	// through to the file (410), and a rejected file value made pnpm 12 refuse
	// the file ("invalid u64").
	it("minimumReleaseAge reads canonical digits only, as pnpm 12 does", () => {
		const fromEnv = (text: string) =>
			settingsOf({ workspace: workspace("minimumReleaseAge: 410\n"), env: { PNPM_CONFIG_MINIMUM_RELEASE_AGE: text } })
				.minimumReleaseAge;
		for (const [text, expected] of [
			["7", 7],
			["0", 0],
			[" 30 ", 30],
			["\t7\n", 7],
			["9007199254740991", 9007199254740991],
		] as const) {
			assert.deepStrictEqual(fromEnv(text), Option.some(expected), JSON.stringify(text));
		}
		for (const text of [
			"05",
			"00",
			"5.0",
			"+5",
			"-0",
			"-3",
			"1.5",
			"0x10",
			"0b11",
			"1e2",
			"1_000",
			"9007199254740993",
		]) {
			assert.deepStrictEqual(fromEnv(text), Option.some(410), JSON.stringify(text));
		}
		const fromFile = (yaml: string) =>
			settingsOf({ workspace: workspace(`minimumReleaseAge: ${yaml}\n`) }).minimumReleaseAge;
		assert.deepStrictEqual(fromFile('" 15 "'), Option.some(15));
		for (const yaml of ['"05"', '"+5"', '"0x10"', "-0", '"abc"']) {
			assert.isTrue(Option.isNone(fromFile(yaml)), yaml);
		}
	});

	it("getNumber reads a canonical signed integer from the environment, nothing looser", () => {
		const number = (text: string) =>
			settingsOf({ workspace: workspace("n: 1\n"), env: { PNPM_CONFIG_N: text } }).getNumber("n");
		assert.deepStrictEqual(number("-2"), Option.some(-2));
		assert.deepStrictEqual(number(" 7 "), Option.some(7));
		assert.deepStrictEqual(number("-0"), Option.some(0));
		for (const text of ["05", "+5", "0x10", "1e2", ".5", "5.", "-2.5", "0.5", "1.0"]) {
			assert.deepStrictEqual(number(text), Option.some(1), text);
		}
	});

	// Read off pnpm 12 with `minimumReleaseAgeStrict` set in the workspace file
	// and the opposite value in the global file.
	it("a boolean word in a file reads as pnpm 12 coerces it", () => {
		const flag = (yaml: string) =>
			settingsOf({ workspace: workspace(`flag: ${yaml}\n`), global: global("flag: true\n") }).getBoolean("flag");
		for (const yaml of ["true", '"true"', "yes", '"yes"', "on", "True", "YES", "y", '"y"', "oN", '" yes "']) {
			assert.deepStrictEqual(flag(yaml), Option.some(true), yaml);
		}
		for (const yaml of ["false", '"false"', "no", "off", "NO", "Off", "n", '"n"', '" false "']) {
			assert.deepStrictEqual(flag(yaml), Option.some(false), yaml);
		}
		for (const yaml of ["1", "0", "t", "f", '"1"', '""']) {
			assert.isTrue(Option.isNone(flag(yaml)), yaml);
		}
	});

	it("an environment boolean is exactly true or false once trimmed; anything else falls through", () => {
		const flag = (text: string) =>
			settingsOf({ global: global("flag: true\n"), env: { PNPM_CONFIG_FLAG: text } }).getBoolean("flag");
		assert.deepStrictEqual(flag("false"), Option.some(false));
		assert.deepStrictEqual(flag(" false "), Option.some(false));
		for (const text of ["no", "off", "n", "FALSE", "0"]) {
			// The global file's `true` answers: the variable was skipped.
			assert.deepStrictEqual(flag(text), Option.some(true), text);
		}
	});
});
