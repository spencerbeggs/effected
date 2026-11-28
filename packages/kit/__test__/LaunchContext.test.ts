// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the fixtures are unsubstituted ${...} launch placeholders, and a literal placeholder is what the tests assert on
import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { LaunchContext } from "../src/index.js";

const keys = ["OKFIT_PROJECT_DIR", "CLAUDE_PROJECT_DIR"] as const;

describe("LaunchContext.projectDir", () => {
	it("prefers a usable argv value", () => {
		assert.strictEqual(
			LaunchContext.projectDir({ argv: ["/from/argv"], env: { CLAUDE_PROJECT_DIR: "/from/env" }, keys, cwd: "/cwd" }),
			"/from/argv",
		);
	});

	it("walks env keys in order", () => {
		assert.strictEqual(
			LaunchContext.projectDir({ env: { OKFIT_PROJECT_DIR: "/a", CLAUDE_PROJECT_DIR: "/b" }, keys, cwd: "/cwd" }),
			"/a",
		);
	});

	it("skips an empty-string env value instead of returning it", () => {
		assert.strictEqual(
			LaunchContext.projectDir({ env: { OKFIT_PROJECT_DIR: "", CLAUDE_PROJECT_DIR: "/b" }, keys, cwd: "/cwd" }),
			"/b",
		);
	});

	it("skips a literal ${VAR} Claude Code left unsubstituted", () => {
		assert.strictEqual(
			LaunchContext.projectDir({
				argv: ["${CLAUDE_PROJECT_DIR}"],
				env: { CLAUDE_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}" },
				keys,
				cwd: "/cwd",
			}),
			"/cwd",
		);
	});

	it("trims surrounding whitespace", () => {
		assert.strictEqual(LaunchContext.projectDir({ env: { CLAUDE_PROJECT_DIR: "  /b  " }, keys, cwd: "/cwd" }), "/b");
	});

	it("falls back to cwd when nothing is usable", () => {
		assert.strictEqual(LaunchContext.projectDir({ env: {}, keys, cwd: "/cwd" }), "/cwd");
	});
});
describe("LaunchContext.isUnsubstituted", () => {
	it("detects a placeholder anywhere in the value", () => {
		assert.isTrue(LaunchContext.isUnsubstituted("${CLAUDE_PROJECT_DIR}"));
		assert.isTrue(LaunchContext.isUnsubstituted("${CLAUDE_PROJECT_DIR}/sub"));
		assert.isFalse(LaunchContext.isUnsubstituted("/real/path"));
		assert.isFalse(LaunchContext.isUnsubstituted("$HOME"));
	});

	it("agrees with the placeholder pattern `${`, any non-`}` run, `}`", () => {
		const reference = /\$\{[^}]*\}/;
		for (const value of ["${}", "${A", "A}", "}${", "${A}${", "${${A}", "}${A}", "$ {A}", "${{", "a${b}c", "${\n}"]) {
			assert.strictEqual(LaunchContext.isUnsubstituted(value), reference.test(value), JSON.stringify(value));
		}
	});

	// `LaunchContext.hostile.test.ts` holds that this is linear in the run.
	it("answers a long run of unclosed openers", () => {
		assert.isFalse(LaunchContext.isUnsubstituted("${{".repeat(200_000)));
	});
});

describe("LaunchContext.usable", () => {
	it("trims a real value and rejects undefined, empty, whitespace-only and placeholder values", () => {
		assert.deepStrictEqual(LaunchContext.usable("  /work  "), Option.some("/work"));
		for (const value of [undefined, "", "  \t", "${CLAUDE_PLUGIN_DATA}", " ${X}/sub "]) {
			assert.deepStrictEqual(LaunchContext.usable(value), Option.none(), JSON.stringify(value));
		}
	});
});

describe("LaunchContext.resolve", () => {
	it("prefers argv, then env keys in order, and misses with none", () => {
		assert.deepStrictEqual(
			LaunchContext.resolve({ argv: ["", "/argv"], env: { CLAUDE_PROJECT_DIR: "/env" }, keys }),
			Option.some("/argv"),
		);
		assert.deepStrictEqual(
			LaunchContext.resolve({ env: { OKFIT_PROJECT_DIR: "${OKFIT_PROJECT_DIR}", CLAUDE_PROJECT_DIR: "/b" }, keys }),
			Option.some("/b"),
		);
		assert.deepStrictEqual(LaunchContext.resolve({ env: {}, keys }), Option.none());
	});
});
