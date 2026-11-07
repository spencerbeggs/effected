// Agent and CI runs load neither Ink nor React. `vi.mock` cannot show this, because it cannot intercept a dependency
// vitest externalizes and `@effected/cli-kit` resolves to built output, so the built bin runs in a child process
// under a preload that records every module the process resolves. The root `globalSetup` rebuilds `dist/prod` before
// every run, so the bin is this tree's.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";

const BIN = resolve(import.meta.dirname, "../../dist/prod/npm/pkg/bin/effected.js");
const HOOK = resolve(import.meta.dirname, "../fixtures/record-resolved.mjs");
const FIXTURE = resolve(import.meta.dirname, "../fixtures/basic");
const CLI_ROOT = resolve(import.meta.dirname, "../..");

const scratch = mkdtempSync(join(tmpdir(), "effected-no-ink-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let runs = 0;
const record = (args: ReadonlyArray<string>, env: Record<string, string> = {}, cwd = FIXTURE) => {
	runs++;
	const log = join(scratch, `resolved-${runs}.log`);
	writeFileSync(log, "");
	const child = spawnSync(process.execPath, ["--import", HOOK, ...args], {
		cwd,
		encoding: "utf8",
		env: { PATH: process.env.PATH ?? "", RESOLVED_LOG: log, TERM: "xterm-256color", ...env },
		timeout: 60_000,
	});
	return { ...child, modules: readFileSync(log, "utf8").split("\n").filter(Boolean) };
};

const INK_OR_REACT = /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:ink|react|react-reconciler)\//;
const loaded = (modules: ReadonlyArray<string>) => modules.filter((url) => INK_OR_REACT.test(url));

describe("the built effected bin", () => {
	it("control: the recorder sees Ink when something does load it", () => {
		const probe = join(CLI_ROOT, "__test__/fixtures/load-ink.mjs");
		const { status, modules } = record([probe], {}, CLI_ROOT);
		assert.strictEqual(status, 0);
		assert.isNotEmpty(loaded(modules));
	});

	it("--agent, a whole walk: JSON on stdout, neither Ink nor React loaded", () => {
		const { status, stdout, stderr, modules } = record([BIN, "schema", "check", "--agent"]);
		assert.strictEqual(status, 1, stderr);
		assert.strictEqual((JSON.parse(stdout) as { mode: string }).mode, "check");
		assert.isTrue(
			modules.some((url) => url.includes("/engine/")),
			"the run reached the engine",
		);
		assert.deepStrictEqual(loaded(modules), []);
	});

	it("--ci, a whole walk: the step summary written, neither Ink nor React loaded", () => {
		const summary = join(scratch, "summary.md");
		const { status, stdout, stderr, modules } = record([BIN, "schema", "check", "--ci"], {
			GITHUB_STEP_SUMMARY: summary,
		});
		assert.strictEqual(status, 1, stderr);
		assert.include(stdout, "would write");
		assert.include(readFileSync(summary, "utf8"), "### effected schema check");
		assert.deepStrictEqual(loaded(modules), []);
	});

	it("a person in a pipe, a whole walk: neither Ink nor React loaded", () => {
		const { status, stdout, stderr, modules } = record([BIN, "schema", "check"]);
		assert.strictEqual(status, 1, stderr);
		assert.include(stdout, "would write");
		assert.deepStrictEqual(loaded(modules), []);
	});

	it("--help and --version: neither Ink nor React loaded", () => {
		for (const args of [["--help"], ["--version"], ["schema", "build", "--help"]]) {
			const { status, stderr, modules } = record([BIN, ...args]);
			assert.strictEqual(status, 0, stderr);
			assert.deepStrictEqual(loaded(modules), [], args.join(" "));
		}
	});
});
