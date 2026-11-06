// The built bin over a real package: a copy of `packages/jsonc`, with real tsdown, tsgo and API Extractor. The copy sits
// under this package's `dist` because its `catalog:` and `workspace:` specifiers need the real workspace above it. The
// root `globalSetup` rebuilds `dist/prod` before every run, so the bin is this tree's.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";

const CLI = resolve(import.meta.dirname, "../..");
const BIN = join(CLI, "dist/prod/npm/pkg/bin/effected.js");
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
	spawnSync(process.execPath, [BIN, "package", "build", ...args], {
		cwd: directory,
		encoding: "utf8",
		env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
		timeout: 170_000,
	});

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
		assert.isFalse(modules.some((url) => /\/bundler\/dist\//.test(url) || /\/tsdown\//.test(url)));
	});
});
