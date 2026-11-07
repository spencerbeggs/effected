// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/generate.selfref.int.test.ts on 2026-11-06
/**
 * Real API Extractor regression guard for systems#771: Run B (the per-module diagnostics pass) must
 * resolve the package's own name to the BUILT declarations, never the source manifest's `exports`
 * (which point at raw `.ts` sources and fire `ae-wrong-input-file-type` or crash the extractor).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, assert, describe, it } from "@effect/vitest";
import { generateMeta } from "../../src/meta/generate.js";
import type { DiagnosticInput } from "../../src/report/collector.js";

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("generateMeta Run B — self-referencing sub-entry (#771)", () => {
	it("resolves the package's own name to the built declarations (no ae-wrong-input-file-type, no harvest failure)", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "meta-selfref-"));
		dirs.push(cwd);
		// Source manifest: self-reference would land on raw .ts sources.
		writeFileSync(
			join(cwd, "package.json"),
			JSON.stringify({
				name: "@scope/selfref",
				version: "1.0.0",
				type: "module",
				exports: { ".": "./src/index.ts", "./sub": "./src/sub.ts" },
			}),
		);
		mkdirSync(join(cwd, "src"), { recursive: true });
		writeFileSync(join(cwd, "src/index.ts"), "export interface Root { r: number }\n");
		writeFileSync(
			join(cwd, "src/sub.ts"),
			'import type { Root } from "@scope/selfref";\nexport declare function useRoot(): Root;\n',
		);
		writeFileSync(
			join(cwd, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					target: "ESNext",
					module: "ESNext",
					moduleResolution: "bundler",
					declaration: true,
					skipLibCheck: true,
					types: [],
				},
				include: [join(cwd, "src/**/*.ts")],
			}),
		);

		// Bundled dts (Run A input) has the self import already inlined.
		const dtsDir = join(cwd, "dist", "prod", "npm", "pkg");
		mkdirSync(dtsDir, { recursive: true });
		writeFileSync(join(dtsDir, "package.json"), JSON.stringify({ name: "@scope/selfref", version: "1.0.0" }));
		writeFileSync(join(dtsDir, "index.d.ts"), "/** @public */\nexport interface Root { r: number }\n");
		writeFileSync(
			join(dtsDir, "sub.d.ts"),
			"/** @public */\ninterface Root { r: number }\n/** @public */\ndeclare function useRoot(): Root;\nexport { Root, useRoot };\n",
		);

		// Per-module declarations (Run B input): NO package.json in this tree, sub.d.ts self-imports.
		const aeInputDir = join(cwd, "dist", "prod", "npm", "declarations");
		mkdirSync(aeInputDir, { recursive: true });
		writeFileSync(join(aeInputDir, "index.d.ts"), "/** @public */\nexport interface Root { r: number }\n");
		writeFileSync(
			join(aeInputDir, "sub.d.ts"),
			'import type * as Root from "@scope/selfref";\n/** @public */\nexport declare function useRoot(): Root.Root;\n',
		);

		const messages: DiagnosticInput[] = [];
		await generateMeta({
			cwd,
			packageName: "@scope/selfref",
			tsconfigPath: join(cwd, "tsconfig.json"),
			dtsDir,
			aeInputDir,
			entries: { index: "index", sub: "sub" },
			exportPaths: { index: ".", sub: "./sub" },
			outMetaDir: join(dtsDir, "..", "meta"),
			localPaths: [],
			tsdoc: { suppressWarnings: [], tagDefinitions: [] },
			onMessage: (e) => messages.push(e),
		});

		const codes = messages.map((m) => m.code);
		assert.deepStrictEqual(
			messages.map((m) => m.text).filter((t) => t.includes("Could not harvest")),
			[],
		);
		assert.notInclude(codes, "ae-wrong-input-file-type", JSON.stringify(messages));
		assert.notInclude(codes, "diagnostics-harvest-failed");
	});
});
