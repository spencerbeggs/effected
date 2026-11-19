// The built bin over a real action: a copy of the bundler's `default-minify` fixture, whose `main` reads no input, so the
// load check stays on. The copy gains the `package.json` and `effected.toml` a build needs. It sits under this package's
// `dist`, the same place the package-build e2e uses, and the root `globalSetup` rebuilds `dist/prod` before every run.

import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
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

/** What a watched run has written so far, and how to end it. */
interface Watched {
	readonly stdoutLines: () => ReadonlyArray<string>;
	readonly stderr: () => string;
	/** Resolves with the exit code, or rejects naming the signal that killed the child. */
	readonly exited: Promise<number>;
	readonly kill: (signal: NodeJS.Signals) => void;
}

const watch = (args: ReadonlyArray<string>, directory: string): Watched => {
	const child = spawn(process.execPath, ["--import", TSX, BIN, ...args], {
		cwd: directory,
		env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
		stdout += chunk;
	});
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
		stderr += chunk;
	});
	const exited = new Promise<number>((resolveExit, rejectExit) => {
		child.on("exit", (code, signal) =>
			code !== null ? resolveExit(code) : rejectExit(new Error(`killed by ${signal ?? "nothing"}\n${stderr}`)),
		);
	});
	// The `afterAll` kill after a failed assertion rejects this with no one awaiting it; that is not a second failure.
	exited.catch(() => {});
	// A failing assertion must never leave a watching child behind.
	children.push(child);
	return {
		stdoutLines: () => stdout.split("\n").filter((line) => line !== ""),
		stderr: () => stderr,
		exited,
		kill: (signal) => child.kill(signal),
	};
};

const children: Array<ChildProcess> = [];
afterAll(() => {
	for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
});

/** Polls `done` every 100 ms for at most `ms`, failing with `context` if it never holds. */
const until = async (done: () => boolean, ms: number, context: () => string) => {
	for (let waited = 0; waited < ms && !done(); waited += 100) await new Promise((wake) => setTimeout(wake, 100));
	assert.isTrue(done(), context());
};

// Well above the 100 ms debounce, so a build's own writes would have queued and started another run.
const SETTLE_MS = 3_000;

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

	it("action build --watch does not rebuild from its own writes, persist on", { timeout: 180_000 }, async () => {
		// A fresh copy, so the first build creates .github/actions/local, .actrc and act-test.yml inside the watched tree.
		const persisted = join(scratch, "persisted");
		cpSync(FIXTURE, persisted, { recursive: true });
		writeFileSync(join(persisted, "package.json"), JSON.stringify({ name: "default-minify", version: "1.0.0" }));
		writeFileSync(join(persisted, "effected.toml"), '[action.entries]\nmain = "src/main.ts"\n');
		assert.isFalse(existsSync(join(persisted, ".actrc")));
		assert.isFalse(existsSync(join(persisted, ".github")));

		const run = watch(["action", "build", "--watch", "--format", "json"], persisted);
		const context = () => `stdout:\n${run.stdoutLines().join("\n")}\nstderr:\n${run.stderr()}`;
		await until(() => run.stdoutLines().length >= 1, 120_000, context);
		await new Promise((wake) => setTimeout(wake, SETTLE_MS));
		assert.strictEqual(run.stdoutLines().length, 1, context());
		assert.strictEqual(
			(JSON.parse(run.stdoutLines()[0] ?? "{}") as { readonly verdict?: string }).verdict,
			"ok",
			context(),
		);
		assert.notInclude(run.stderr(), "rebuilding:", context());
		assert.isTrue(existsSync(join(persisted, ".actrc")), "the build wrote .actrc inside the watched tree");
		assert.isTrue(existsSync(join(persisted, ".github/workflows/act-test.yml")), "and act-test.yml");
		assert.isTrue(existsSync(join(persisted, ".github/actions/local/dist/main.js")), "and the local copy");
		run.kill("SIGINT");
		assert.strictEqual(await run.exited, 130, context());
	});
});
