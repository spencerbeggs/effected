// The built bin over a real action: a copy of the bundler's `default-minify` fixture, whose `main` reads no input, so the
// load check stays on. The copy gains the `package.json` and `effected.toml` a build needs. It sits under this package's
// `dist`, the same place the package-build e2e uses, and the root `globalSetup` rebuilds `dist/prod` before every run.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";

const CLI = resolve(import.meta.dirname, "../..");
const BIN = join(CLI, "dist/prod/npm/pkg/bin/effected.js");
// The built bin's siblings resolve to their source through the workspace links.
const TSX = createRequire(import.meta.url).resolve("tsx");
const FIXTURE = resolve(CLI, "../bundler/__test__/fixtures/action/default-minify");

mkdirSync(join(CLI, "dist"), { recursive: true });
const scratch = mkdtempSync(join(CLI, "dist", "action-build-e2e-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const cwd = join(scratch, "action");
cpSync(FIXTURE, cwd, { recursive: true });
writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "default-minify", version: "1.0.0" }));
writeFileSync(join(cwd, "effected.toml"), '[action.entries]\nmain = "src/main.ts"\n');

// The same action with no `action.yml`: validation warns `ACTION_YML_MISSING`, which fails the build only under CI.
const unvalidated = join(scratch, "no-action-yml");
cpSync(cwd, unvalidated, { recursive: true });
rmSync(join(unvalidated, "action.yml"));

const effected = (args: ReadonlyArray<string>, directory = cwd, env: Record<string, string> = {}) =>
	spawnSync(process.execPath, ["--import", TSX, BIN, "action", "build", ...args], {
		cwd: directory,
		encoding: "utf8",
		env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
		timeout: 110_000,
	});

describe("the built effected bin", () => {
	it("action build --no-persist builds a real action into dist/main.js", { timeout: 120_000 }, () => {
		const { status, stdout, stderr } = effected(["--human", "--no-persist"]);
		assert.strictEqual(status, 0, stderr);
		assert.match(stdout, /✓ main: \d+ B \(\d+ms\) → dist\/main\.js/);
		assert.match(stdout, /built 1 entries in \d+ms/);
		assert.isTrue(existsSync(join(cwd, "dist/main.js")));
		assert.strictEqual(readFileSync(join(cwd, "dist/package.json"), "utf8"), '{ "type": "module" }');
		assert.isFalse(existsSync(join(cwd, ".github")), "--no-persist copied nothing");

		const built = spawnSync(process.execPath, [join(cwd, "dist/main.js")], { encoding: "utf8" });
		assert.strictEqual(built.stdout.trim(), "DEFAULT-DEFAULT|MINIFY-MINIFY|FIXTURE-FIXTURE");
	});

	it("--format json writes one document on stdout", { timeout: 120_000 }, () => {
		const { status, stdout, stderr } = effected(["--format", "json", "--no-persist"]);
		assert.strictEqual(status, 0, stderr);
		const document = JSON.parse(stdout) as {
			readonly verdict: string;
			readonly result: { readonly build: { readonly success: boolean } };
		};
		assert.strictEqual(document.verdict, "ok");
		assert.isTrue(document.result.build.success);
	});

	// `main` reads CI by `@effected/env`'s rule: `CI=false` is not CI, and a provider marker alone is.
	const ciCases: ReadonlyArray<readonly [string, Record<string, string>, number]> = [
		["CI=false is not CI: a warning does not fail the build", { CI: "false" }, 0],
		["CI=true is CI: a warning fails the build", { CI: "true" }, 1],
		["a JENKINS_URL marker alone is CI: a warning fails the build", { JENKINS_URL: "https://jenkins.example/" }, 1],
	];
	for (const [name, env, expected] of ciCases) {
		it(name, { timeout: 120_000 }, () => {
			const { status, stdout, stderr } = effected(["--human", "--no-persist"], unvalidated, env);
			assert.strictEqual(status, expected, stderr);
			const strict = `${stdout}${stderr}`.includes("warnings are errors in strict mode");
			assert.strictEqual(strict, expected === 1);
		});
	}

	it("exits 2 on a directory with no [action] table", { timeout: 60_000 }, () => {
		const library = join(scratch, "library");
		mkdirSync(library);
		writeFileSync(join(library, "package.json"), JSON.stringify({ name: "library" }));
		const { status, stderr } = spawnSync(process.execPath, ["--import", TSX, BIN, "action", "build"], {
			cwd: library,
			encoding: "utf8",
			env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
		});
		assert.strictEqual(status, 2, stderr);
		assert.include(stderr, "[action]");
	});
});
