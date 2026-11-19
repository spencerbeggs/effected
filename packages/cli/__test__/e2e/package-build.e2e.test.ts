// The built bin over a real package: a copy of `packages/jsonc`, with real tsdown, tsgo and API Extractor. The copy sits
// under this package's `dist` because its `catalog:` and `workspace:` specifiers need the real workspace above it. The
// root `globalSetup` rebuilds `dist/prod` before every run, so the bin is this tree's.

import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";

const CLI = resolve(import.meta.dirname, "../..");
const BIN = join(CLI, "dist/prod/npm/pkg/bin/effected.js");
// The built bin's siblings resolve to their source through the workspace links.
const TSX = createRequire(import.meta.url).resolve("tsx");
const JSONC = resolve(CLI, "../jsonc");

mkdirSync(join(CLI, "dist"), { recursive: true });
const scratch = mkdtempSync(join(CLI, "dist", "package-build-e2e-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const cwd = join(scratch, "jsonc");
cpSync(JSONC, cwd, {
	recursive: true,
	filter: (source) => !["dist", "node_modules", ".turbo"].includes(source.slice(JSONC.length + 1)),
});
symlinkSync(join(JSONC, "node_modules"), join(cwd, "node_modules"));

const effected = (args: ReadonlyArray<string>, directory = cwd) =>
	spawnSync(process.execPath, ["--import", TSX, BIN, "package", "build", ...args], {
		cwd: directory,
		encoding: "utf8",
		env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
		timeout: 170_000,
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
	it("builds a real package: exit 0, issues.json present, one document on stdout", { timeout: 180_000 }, () => {
		const { status, stdout, stderr } = effected(["--agent", "--no-exe"]);
		assert.strictEqual(status, 0, stderr);
		const issues = JSON.parse(readFileSync(join(cwd, "dist/prod/issues.json"), "utf8")) as {
			readonly buildOk: boolean;
			readonly package: string;
		};
		assert.strictEqual(issues.buildOk, true);
		assert.strictEqual(issues.package, "@effected/jsonc");
		const document = JSON.parse(stdout) as { readonly verdict: string; readonly package: string };
		assert.strictEqual(document.verdict, "ok");
		assert.strictEqual(document.package, "@effected/jsonc");
		assert.isTrue(existsSync(join(cwd, "dist/prod/npm/pkg/package.json")));
	});

	it("a broken effected.toml exits 2, naming the file and the key", { timeout: 60_000 }, () => {
		const broken = join(scratch, "broken");
		mkdirSync(broken);
		writeFileSync(join(broken, "package.json"), JSON.stringify({ name: "broken" }));
		writeFileSync(join(broken, "effected.toml"), '[package.build]\nformats = ["esm"]\n');
		const { status, stderr } = effected([], broken);
		assert.strictEqual(status, 2, stderr);
		assert.include(stderr, "effected.toml");
		assert.include(stderr, "package.build.formats");
	});

	it("--version does not load the bundler", { timeout: 60_000 }, () => {
		const log = join(scratch, "resolved.log");
		writeFileSync(log, "");
		const { status, stderr } = spawnSync(
			process.execPath,
			["--import", resolve(import.meta.dirname, "../fixtures/record-resolved.mjs"), BIN, "--version"],
			{ cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "", RESOLVED_LOG: log } },
		);
		assert.strictEqual(status, 0, stderr);
		const modules = readFileSync(log, "utf8").split("\n").filter(Boolean);
		assert.isTrue(
			modules.some((url) => url.includes("/engine/")),
			"the recorder saw the engine",
		);
		// Workspace links resolve to source, so the bundler shows up as `packages/bundler/src/`, never a `dist`; its
		// toolchain is rolldown and TypeScript.
		const eager = modules.filter((url) =>
			/\/packages\/bundler\/src\/|\/@effected\/bundler\/|\/rolldown|\/node_modules\/typescript\//.test(url),
		);
		assert.strictEqual(
			eager.length,
			0,
			`--version loaded the bundler or its toolchain: ${eager.slice(0, 5).join(", ")}`,
		);
	});

	it("package build --watch does not rebuild from its own writes", { timeout: 300_000 }, async () => {
		// An in-package localPaths: every build copies the API model there, so an unexcluded one would rebuild forever.
		writeFileSync(join(cwd, "effected.toml"), '[package.build.meta]\nlocalPaths = ["docs/models"]\n');
		const run = watch(["package", "build", "--watch", "--format", "json", "--no-exe"], cwd);
		const context = () => `stdout:\n${run.stdoutLines().join("\n")}\nstderr:\n${run.stderr()}`;
		await until(() => run.stdoutLines().length >= 1, 180_000, context);
		await new Promise((wake) => setTimeout(wake, SETTLE_MS));
		assert.strictEqual(run.stdoutLines().length, 1, context());
		assert.strictEqual(
			(JSON.parse(run.stdoutLines()[0] ?? "{}") as { readonly verdict?: string }).verdict,
			"ok",
			context(),
		);
		assert.notInclude(run.stderr(), "rebuilding:", context());
		assert.isTrue(
			existsSync(join(cwd, "docs/models/package.json")),
			`the build wrote no localPaths copy\n${context()}`,
		);

		// The positive control: the same watch does see an edit, so the silence above is not a watcher that saw nothing.
		const source = join(cwd, "src/index.ts");
		writeFileSync(source, `${readFileSync(source, "utf8")}\n`);
		await until(() => run.stdoutLines().length >= 2, 60_000, context);
		await new Promise((wake) => setTimeout(wake, SETTLE_MS));
		assert.strictEqual(run.stdoutLines().length, 2, context());
		const rebuilds = run
			.stderr()
			.split("\n")
			.filter((line) => line.startsWith("rebuilding:"));
		assert.deepStrictEqual(rebuilds, ["rebuilding: src/index.ts"], context());

		run.kill("SIGINT");
		assert.strictEqual(await run.exited, 130, context());
	});
});
