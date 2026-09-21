import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

/**
 * The package's rule that ambient process state is never read behind a
 * caller's back — stated in `ChildEnv`'s class doc — held structurally.
 *
 * @remarks
 * `ActionEnvironment` is THE reader of `process.env`; everything else asks
 * it, or takes the environment as an argument. The sites below are the
 * closed list of exceptions, each a documented default a caller can
 * override or a host fact no runner variable carries. A new match anywhere
 * else fails here, naming the file and line, rather than in review.
 */
const RULE =
	"ambient process state (process.env / process.arch / process.platform) is never read behind a caller's back — " +
	"read it through ActionEnvironment, or take it as an argument (see ChildEnv's class doc). " +
	"A new sanctioned default must be added to the allowlist in __test__/ambientReads.test.ts WITH its reason.";

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));

/**
 * Line comments first, then blocks — `__test__/Secret.test.ts` says why the
 * order matters. Known limit: a `/*` inside a string literal (a `"**\/*"` glob)
 * would open a phantom block and hide the code up to the next `*\/`; the
 * "allowlisted site no longer present" assertion below is the backstop, since
 * a hidden site reads as missing rather than as clean.
 */
const stripComments = (source: string): string =>
	source.replace(/(^|\n)\s*\/\/.*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const AMBIENT = /process\.(env|arch|platform)\b/;

/** Every `(file, line-text)` in `src/` reading ambient process state outside a comment. */
const ambientReadSites = (): ReadonlyArray<readonly [string, string]> => {
	const found: Array<readonly [string, string]> = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(path);
			} else if (entry.name.endsWith(".ts")) {
				for (const line of stripComments(readFileSync(path, "utf8")).split("\n")) {
					if (AMBIENT.test(line)) {
						found.push([relative(srcRoot, path), line.trim()]);
					}
				}
			}
		}
	};
	walk(srcRoot);
	return found.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
};

/**
 * The sanctioned sites, and why each is one. Keep it minimal: remove an
 * entry when its read goes away, and never add one without a reason.
 */
const ALLOWED: ReadonlyArray<readonly [string, string, string]> = [
	[
		"ActionEnvironment.ts",
		"Effect.sync(() => ({ ...process.env }) as Readonly<Record<string, string>>),",
		"THE reader: seeds the environment once, at layer construction",
	],
	[
		"ActionInput.ts",
		"static provider(env: Readonly<Record<string, string | undefined>> = process.env): ConfigProvider.ConfigProvider {",
		"a default parameter the caller overrides by passing an environment",
	],
	[
		"DetachedProcess.ts",
		"env: { ...(options.base ?? process.env), ...options.env },",
		"the `base` default — the one sanctioned ambient fallback, same class as ActionInput.provider's",
	],
	[
		"PackageManagerInstaller.ts",
		"Option.match(found, { onNone: () => process.arch as string, onSome: archFromRunner }),",
		"the off-runner fallback for RUNNER_ARCH, selecting the native-binary target",
	],
	[
		"ToolInstaller.ts",
		"ToolInstaller.cachePath({ root, tool, version, arch: process.arch });",
		"the tool-cache layout's arch segment is Node's spelling by contract with the runner",
	],
	[
		"ToolInstaller.ts",
		'const testRoot = (): string => process.env.RUNNER_TOOL_CACHE ?? "/tmp/runner-tool-cache";',
		"makeTest's cachePath default root — test-double only, a double has no ActionEnvironment to ask",
	],
	[
		"ToolInstaller.ts",
		"cachePath: (tool, version) => ToolInstaller.cachePath({ root: testRoot(), tool, version, arch: process.arch }),",
		"makeTest's cachePath default — the same arch segment `make` writes, for the same reason",
	],
	[
		"internal/pnpmExe.ts",
		'if (process.platform !== "linux") {',
		"detectMusl: the host libc is a host fact no runner variable carries",
	],
];

describe("ambient process reads", () => {
	it("every read of process.env / process.arch / process.platform in src/ is an allowlisted site", () => {
		const actual = ambientReadSites();
		const allowed = ALLOWED.map(([file, line]) => [file, line] as const).sort(
			(a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]),
		);
		const key = (site: readonly [string, string]) => `${site[0]} :: ${site[1]}`;
		const unexpected = actual.filter((site) => !allowed.some((entry) => key(entry) === key(site)));
		const missing = allowed.filter((entry) => !actual.some((site) => key(entry) === key(site)));
		assert.deepStrictEqual(
			unexpected,
			[],
			`unsanctioned ambient read(s):\n${unexpected.map((site) => `  ${site[0]}: ${site[1]}`).join("\n")}\n${RULE}`,
		);
		assert.deepStrictEqual(
			missing,
			[],
			`allowlisted site(s) no longer present — remove them from the allowlist:\n${missing
				.map((site) => `  ${site[0]}: ${site[1]}`)
				.join("\n")}`,
		);
	});

	it("the scan can fail — it is asserting on a non-empty set with ActionEnvironment in it", () => {
		const files = ambientReadSites().map(([file]) => file);
		assert.include(files, "ActionEnvironment.ts");
	});

	it("comment prose does not count as a read", () => {
		assert.notMatch(stripComments("/** reads process.env once */\nconst a = 1;"), AMBIENT);
		assert.notMatch(stripComments("// falls back to process.arch\nconst a = 1;"), AMBIENT);
		assert.match(stripComments("// note\nconst a = process.arch;"), AMBIENT);
	});
});
