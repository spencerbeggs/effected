import { readFileSync } from "node:fs";
import * as tty from "node:tty";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { colorDepth, colorKeys } from "../src/internal/colorDepth.js";

const nodeDepth = (env: Record<string, string>): string => {
	const bits = tty.WriteStream.prototype.getColorDepth.call(undefined, env);
	return bits === 1 ? "none" : bits === 4 ? "basic" : bits === 8 ? "256" : "truecolor";
};

const CASES: ReadonlyArray<Record<string, string>> = [
	{},
	{ TERM: "xterm-256color" },
	{ TERM: "xterm" },
	{ TERM: "dumb" },
	{ TERM: "xterm-kitty" },
	{ TERM: "screen" },
	{ TERM: "vt100" },
	{ TERM: "rxvt-unicode-24bit" },
	{ TERM: "xterm-truecolor" },
	{ COLORTERM: "truecolor" },
	{ COLORTERM: "24bit" },
	{ COLORTERM: "yes" },
	{ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5.0" },
	{ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "2.9.0" },
	{ TERM_PROGRAM: "iTerm.app" },
	{ TERM_PROGRAM: "Apple_Terminal" },
	{ TERM_PROGRAM: "HyperTerm" },
	{ TMUX: "/tmp/tmux-501/default,1,0" },
	{ CI: "true" },
	{ CI: "true", GITHUB_ACTIONS: "true" },
	{ CI: "1", GITLAB_CI: "true" },
	{ CI: "true", CI_NAME: "codeship" },
	{ TF_BUILD: "True", AGENT_NAME: "x" },
	{ TEAMCITY_VERSION: "9.1.0" },
	{ TEAMCITY_VERSION: "8.0.0" },
	{ NO_COLOR: "1", TERM: "xterm-256color" },
	{ NODE_DISABLE_COLORS: "1", TERM: "xterm-256color" },
	{ FORCE_COLOR: "0", TERM: "xterm-256color" },
	{ FORCE_COLOR: "1" },
	{ FORCE_COLOR: "true" },
	{ FORCE_COLOR: "2" },
	{ FORCE_COLOR: "3" },
	{ FORCE_COLOR: "banana" },
	{ FORCE_COLOR: "3", NO_COLOR: "1" },
	{ FORCE_COLOR: "1", TERM: "dumb" },
];

describe("colorDepth", () => {
	for (const env of CASES) {
		it(`matches Node on a TTY for ${JSON.stringify(env)}`, () => {
			assert.strictEqual(colorDepth(env, true), nodeDepth(env));
		});
	}

	// Added beyond the brief's table: the CI provider keys live in a table the source regex cannot see.
	for (const name of [
		"APPVEYOR",
		"BUILDKITE",
		"CIRCLECI",
		"DRONE",
		"GITEA_ACTIONS",
		"GITHUB_ACTIONS",
		"GITLAB_CI",
		"TRAVIS",
	]) {
		it(`matches Node for CI provider ${name}`, () => {
			const env = { CI: "true", [name]: "true" };
			assert.strictEqual(colorDepth(env, true), nodeDepth(env));
			assert.include(colorKeys, name);
		});
	}

	it("the oracle is live: Node distinguishes at least three levels across the table (positive control)", () => {
		assert.isAtLeast(new Set(CASES.map(nodeDepth)).size, 3);
	});

	it("a non-TTY stream is none unless FORCE_COLOR says otherwise", () => {
		assert.strictEqual(colorDepth({ TERM: "xterm-256color" }, false), "none");
		assert.strictEqual(colorDepth({ FORCE_COLOR: "2" }, false), "256");
		assert.strictEqual(colorDepth({ FORCE_COLOR: "0" }, false), "none");
	});

	it("FORCE_COLOR beats NO_COLOR (Node precedence, decision D-C)", () => {
		assert.strictEqual(colorDepth({ FORCE_COLOR: "3", NO_COLOR: "1" }, false), "truecolor");
	});

	it('documented divergence: FORCE_COLOR="" is unset here because ConfigProvider drops empty strings', () => {
		// Node: "" forces 16 colours. Our env record never carries "" (Config.option reads it as None),
		// so the record the detector sees has no FORCE_COLOR key at all.
		assert.strictEqual(nodeDepth({ FORCE_COLOR: "", TERM: "dumb" }), "basic");
		assert.strictEqual(colorDepth({ TERM: "dumb" }, true), "none");
	});

	it("colorKeys lists every env key the detector reads", () => {
		const dir = fileURLToPath(new URL("../src/internal/", import.meta.url));
		const source = readFileSync(`${dir}colorDepth.ts`, "utf8");
		const read = new Set(
			[...source.matchAll(/(?<![\w./])env(?:\.([A-Z][A-Za-z_]+)|\[\s*"([A-Za-z_]+)"\s*\])/g)].flatMap((m) => {
				const key = m[1] ?? m[2];
				return key === undefined ? [] : [key];
			}),
		);
		assert.isAbove(read.size, 10, "the regex found the reads (control)");
		for (const key of read) assert.include(colorKeys, key, `colorKeys is missing ${key}`);
	});
});
