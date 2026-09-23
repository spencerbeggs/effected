import { assert, describe, it } from "@effect/vitest";
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
});
