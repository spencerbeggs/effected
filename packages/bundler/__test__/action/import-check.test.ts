import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
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
	return checkImport(join(dir, name), { cwd: dir, ...options });
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

	it("fails a module that never finishes, and leaks no GITHUB_ variable into it", async () => {
		const hung = await verdictFor("hung.js", "setInterval(() => {}, 1000);\n", { timeoutMs: 500 });
		assert.strictEqual(hung.kind, "failed");
		assert.include(hung.kind === "failed" ? hung.message : "", "500");

		process.env.GITHUB_ACTIONS = "true";
		try {
			const guarded = 'if (process.env.GITHUB_ACTIONS) throw new Error("the guard ran");\n';
			assert.strictEqual((await verdictFor("guarded.js", guarded)).kind, "imported");
		} finally {
			delete process.env.GITHUB_ACTIONS;
		}
	});
});
