import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, assert, beforeEach, describe, it } from "@effect/vitest";
import { vi } from "vitest";
import { checkImport } from "../../src/action/import-check.js";

const dir = mkdtempSync(join(tmpdir(), "effected-import-check-"));
writeFileSync(join(dir, "package.json"), '{ "type": "module" }');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const verdictFor = (
	name: string,
	source: string,
	options?: { readonly externals?: ReadonlyArray<string>; readonly timeoutMs?: number },
) => {
	writeFileSync(join(dir, name), source);
	return checkImport(join(dir, name), options);
};

describe("checkImport", () => {
	it("passes a module that loads", async () => {
		assert.strictEqual((await verdictFor("fine.js", "export const a = 1;\n")).kind, "imported");
	});

	it("fails a dynamic require and an uninstalled import", async () => {
		const dynamicRequire = await verdictFor(
			"require.js",
			'throw new Error("Dynamic require of \\"fs\\" is not supported");\n',
		);
		assert.strictEqual(dynamicRequire.kind, "failed");
		assert.strictEqual((await verdictFor("missing.js", 'import "not-installed-anywhere";\n')).kind, "failed");
	});

	it("passes a thrown error that asks for an input", async () => {
		const schema = 'throw new Error(`SchemaError(Expected string\\n  at ["INPUT_APP-CLIENT-ID"])`);\n';
		assert.strictEqual((await verdictFor("schema.js", schema)).kind, "missing-input");
		const core = 'throw new Error("Input required and not supplied: token");\n';
		assert.strictEqual((await verdictFor("core.js", core)).kind, "missing-input");
	});

	it("fails a broken module whose echoed source line contains INPUT_", async () => {
		const source = 'const INPUT_X = "at [\\"INPUT_X\\"]";\nthrow new TypeError("not a function: " + INPUT_X.length);\n';
		const verdict = await verdictFor("echo.js", source);
		assert.strictEqual(verdict.kind, "failed");
		assert.include(verdict.kind === "failed" ? verdict.message : "", "TypeError");
	});

	it("fails a module whose source line holds the whole shape the predicate looks for", async () => {
		const caught = 'const line = `at ["INPUT_X"]`;\nthrow new RangeError("boom " + line.length);\n';
		assert.strictEqual((await verdictFor("shape.js", caught)).kind, "failed");
		// Thrown from a timer it is uncaught, the one path where Node really echoes that line to stderr.
		const uncaught =
			'const line = `at ["INPUT_X"]`;\nsetTimeout(() => { throw new RangeError("boom " + line.length); }, 0);\n';
		assert.strictEqual((await verdictFor("shape-uncaught.js", uncaught)).kind, "failed");
	});

	it("fails an unresolved module whose name reads like a missing input", async () => {
		const verdict = await verdictFor(
			"cjs-shape.js",
			'throw Object.assign(new Error("Cannot find module \'./input-missing\'"), { code: "MODULE_NOT_FOUND" });\n',
		);
		assert.strictEqual(verdict.kind, "failed");
		const real = await verdictFor("esm-shape.js", 'import "./input-missing.js";\n');
		assert.strictEqual(real.kind, "failed");
	});

	it("reads a run that exits by itself from its ::error:: lines only", async () => {
		const reported =
			'console.log(`::error::Action failed: SchemaError(Expected string%0A  at ["INPUT_A"])`);\nprocess.exit(1);\n';
		assert.strictEqual((await verdictFor("reported.js", reported)).kind, "missing-input");
		const echoed = 'console.log(`debug at ["INPUT_A"]`);\nprocess.exit(1);\n';
		assert.strictEqual((await verdictFor("echoed.js", echoed)).kind, "failed");
		const other = 'console.log("::error::Action failed: boom");\nprocess.exit(1);\n';
		assert.strictEqual((await verdictFor("other.js", other)).kind, "failed");
	});

	it("excuses only a configured external that is not installed", async () => {
		const source = 'import "uninstalled-peer-dep";\n';
		const excused = await verdictFor("external.js", source, { externals: ["uninstalled-peer-dep"] });
		assert.strictEqual(excused.kind, "external-missing");
		const other = await verdictFor("external-other.js", source, { externals: ["something-else"] });
		assert.strictEqual(other.kind, "failed");
	});

	it("fails a module that never finishes", async () => {
		const hung = await verdictFor("hung.js", "setInterval(() => {}, 1000);\n", { timeoutMs: 500 });
		assert.strictEqual(hung.kind, "failed");
		assert.include(hung.kind === "failed" ? hung.message : "", "500");
	});

	it("bounds a module that ignores SIGTERM", async () => {
		// It ends itself eventually, so a run where the bound does not hold leaves no process behind for long.
		const source = 'process.on("SIGTERM", () => {});\nsetTimeout(() => process.exit(0), 20_000);\n';
		const started = Date.now();
		const stubborn = await verdictFor("stubborn.js", source, { timeoutMs: 500 });
		assert.strictEqual(stubborn.kind, "failed");
		assert.isBelow(Date.now() - started, 5_000);
	}, 10_000);

	describe("the child's environment", () => {
		const stubbed = { GITHUB_ACTIONS: "true", GITHUB_TOKEN: "secret", NODE_OPTIONS: "--no-warnings" };

		beforeEach(() => {
			for (const [name, value] of Object.entries(stubbed)) vi.stubEnv(name, value);
		});
		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it("carries none of the process's variables", async () => {
			const source = `for (const name of ${JSON.stringify(Object.keys(stubbed))}) {
	if (process.env[name] !== undefined) throw new Error("leaked " + name);
}
if (process.env.HOME === undefined) throw new Error("no HOME at all");
`;
			assert.deepStrictEqual(await verdictFor("env.js", source), { kind: "imported" });
		});

		it("the variables really are set in the process it starts from", () => {
			assert.strictEqual(process.env.GITHUB_TOKEN, "secret");
		});
	});

	it("runs with cwd and HOME in a fresh directory that it removes, and the bundle still loads as ESM", async () => {
		const report = join(dir, "where.json");
		const source = `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(report)}, JSON.stringify({ cwd: process.cwd(), home: process.env.HOME }));
writeFileSync("from-cwd.txt", "x");
`;
		assert.strictEqual((await verdictFor("where.js", source)).kind, "imported");
		const where = JSON.parse(readFileSync(report, "utf8")) as { cwd: string; home: string };
		assert.notStrictEqual(realpathSync(dir), where.cwd);
		assert.strictEqual(where.home, where.cwd);
		assert.isFalse(existsSync(where.cwd), "the directory is removed");
		assert.isFalse(existsSync(join(dir, "from-cwd.txt")));
	});

	it("kills a child that ignores SIGTERM when its signal aborts", async () => {
		const pidFile = join(dir, "aborted.pid");
		const source = `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
process.on("SIGTERM", () => {});
setTimeout(() => process.exit(0), 20_000);
`;
		writeFileSync(join(dir, "aborted.js"), source);
		const controller = new AbortController();
		const pending = checkImport(join(dir, "aborted.js"), { signal: controller.signal });
		while (!existsSync(pidFile) || readFileSync(pidFile, "utf8") === "") {
			await new Promise((wake) => setTimeout(wake, 20));
		}
		const pid = Number(readFileSync(pidFile, "utf8"));
		controller.abort();
		const verdict = await pending;
		assert.strictEqual(verdict.kind, "failed");
		assert.include(verdict.kind === "failed" ? verdict.message : "", "aborted");
		assert.throws(() => process.kill(pid, 0));
	}, 10_000);

	it("does not start work it cannot stop when the signal has already aborted", async () => {
		const verdict = await checkImport(join(dir, "aborted.js"), { signal: AbortSignal.abort() });
		assert.strictEqual(verdict.kind, "failed");
	}, 10_000);

	it("settles on a malformed marker line", async () => {
		const source = 'process.stderr.write("__EFFECTED_IMPORT_FAILURE__{not json\\n");\nprocess.exit(1);\n';
		const verdict = await verdictFor("marker.js", source);
		assert.strictEqual(verdict.kind, "failed");
	});

	it("does not read an unrelated error mentioning input as a missing input", async () => {
		for (const [name, source] of [
			["buffer-type.js", 'throw new TypeError("stream: missing input buffer");\n'],
			["buffer-error.js", 'throw new Error("stream: missing input buffer");\n'],
			["type-shape.js", 'throw new TypeError(`bad value at ["INPUT_X"]`);\n'],
		] as const) {
			assert.strictEqual((await verdictFor(name, source)).kind, "failed", name);
		}
		const required = 'throw new Error("Missing required input: token");\n';
		assert.strictEqual((await verdictFor("required.js", required)).kind, "missing-input");
	});

	it("excuses a configured external a CommonJS require could not find, and nothing else", async () => {
		const source = `import { createRequire } from "node:module";
createRequire(import.meta.url)("uninstalled-peer-dep");
`;
		const excused = await verdictFor("cjs-external.js", source, { externals: ["uninstalled-peer-dep"] });
		assert.strictEqual(excused.kind, "external-missing");
		const other = await verdictFor("cjs-other.js", source, { externals: ["something-else"] });
		assert.strictEqual(other.kind, "failed");
		const subpath = `import { createRequire } from "node:module";
createRequire(import.meta.url)("uninstalled-peer-dep/sub");
`;
		const excusedSubpath = await verdictFor("cjs-subpath.js", subpath, { externals: ["uninstalled-peer-dep"] });
		assert.strictEqual(excusedSubpath.kind, "external-missing");
		const longerName = await verdictFor("cjs-longer.js", subpath, { externals: ["uninstalled-peer"] });
		assert.strictEqual(longerName.kind, "failed");
		const relative = `import { createRequire } from "node:module";
createRequire(import.meta.url)("./uninstalled-peer-dep");
`;
		const notThePackage = await verdictFor("cjs-relative.js", relative, { externals: ["uninstalled-peer-dep"] });
		assert.strictEqual(notThePackage.kind, "failed");
	});
});
