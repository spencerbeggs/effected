// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/api-extractor.int.test.ts on 2026-11-06
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { runApiExtractor, writeApiExtractorTsconfig } from "../../src/meta/api-extractor.js";
import { writeTsdocConfig } from "../../src/meta/tsdoc-config.js";

function scaffoldForgotten(): { dir: string; entryDtsPath: string; tsconfigPath: string; packageJsonPath: string } {
	const dir = mkdtempSync(join(tmpdir(), "ae-fe-"));
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name: "@scope/fixture", version: "1.0.0", types: "./index.d.ts" }),
	);
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ESNext",
				module: "ESNext",
				moduleResolution: "bundler",
				declaration: true,
				skipLibCheck: true,
				types: [],
			},
			include: [join(dir, "**/*.d.ts")],
		}),
	);
	const dtsDir = join(dir, "dist");
	mkdirSync(dtsDir, { recursive: true });
	// `Bar` is referenced by the exported `getBar` but not itself exported -> ae-forgotten-export.
	// `getBar` carries @public so ae-missing-release-tag does not also fire and mask the assertion.
	writeFileSync(
		join(dtsDir, "index.d.ts"),
		`interface Bar { bar: number }\n/** @public */\ndeclare function getBar(): Bar;\nexport { getBar };\n`,
	);
	return {
		dir,
		entryDtsPath: join(dtsDir, "index.d.ts"),
		tsconfigPath: join(dir, "tsconfig.json"),
		packageJsonPath: join(dir, "package.json"),
	};
}

function scaffold(): { dir: string; dtsDir: string } {
	const dir = mkdtempSync(join(tmpdir(), "ae-"));
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name: "@scope/fixture", version: "1.0.0", types: "./index.d.ts" }),
	);
	// resolved tsconfig with absolute paths (mirrors writeResolvedTsconfig output shape)
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ESNext",
				module: "ESNext",
				moduleResolution: "bundler",
				declaration: true,
				skipLibCheck: true,
				types: [],
			},
			include: [join(dir, "**/*.d.ts")],
		}),
	);
	const dtsDir = join(dir, "dist");
	mkdirSync(dtsDir, { recursive: true });
	// a forgotten export (Hidden is referenced but not exported) to exercise suppression on its _base-like name
	writeFileSync(
		join(dtsDir, "index.d.ts"),
		`interface Hidden_base { x: number }\nexport interface Public extends Hidden_base { y: number }\n`,
	);
	return { dir, dtsDir };
}

describe("runApiExtractor", () => {
	it("produces a .api.json and suppresses ae-forgotten-export/_base", () => {
		const { dir, dtsDir } = scaffold();
		const tsdocConfigPath = writeTsdocConfig(dir, { suppressWarnings: [], tagDefinitions: [] });
		const apiJsonPath = join(dir, "out.api.json");
		runApiExtractor({
			cwd: dir,
			packageJsonPath: join(dir, "package.json"),
			entryDtsPath: join(dtsDir, "index.d.ts"),
			tsconfigPath: join(dir, "tsconfig.json"),
			tsdocConfigPath,
			apiJsonPath,
			tsdocMetadataPath: join(dir, "tsdoc-metadata.json"),
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
			// Route the remaining (unsuppressed) ae-missing-release-tag warnings to a no-op so API
			// Extractor marks them handled and does not print them to the console; this test only
			// asserts on the emitted .api.json, not on diagnostic text.
			onMessage: () => {},
		});
		assert.strictEqual(existsSync(apiJsonPath), true);
		const model = JSON.parse(readFileSync(apiJsonPath, "utf-8")) as { kind: string };
		assert.strictEqual(model.kind, "Package");
	});

	it("includes forgotten exports in the emitted .api.json so the model stays reconstructable", () => {
		// rspress-plugin-api-extractor#56: a forgotten export (here `Bar`, referenced by `getBar` but not
		// exported) must be INCLUDED in the doc model, not dropped — otherwise downstream .d.ts
		// reconstruction loses the referenced type (the synthetic `*_base` of Effect class mixins is the
		// real-world offender). includeForgottenExports: true keeps the model complete.
		const f = scaffoldForgotten();
		const tsdocConfigPath = writeTsdocConfig(f.dir, { suppressWarnings: [], tagDefinitions: [] });
		const apiJsonPath = join(f.dir, "out.api.json");
		runApiExtractor({
			cwd: f.dir,
			packageJsonPath: f.packageJsonPath,
			entryDtsPath: f.entryDtsPath,
			tsconfigPath: f.tsconfigPath,
			tsdocConfigPath,
			apiJsonPath,
			suppressWarnings: [],
			onMessage: () => {},
		});
		const model = JSON.parse(readFileSync(apiJsonPath, "utf-8")) as { members?: unknown[] };
		const names: string[] = [];
		const walk = (node: unknown): void => {
			if (node === null || typeof node !== "object") return;
			const n = node as { name?: unknown; members?: unknown[] };
			if (typeof n.name === "string" && n.name.length > 0) names.push(n.name);
			if (Array.isArray(n.members)) for (const m of n.members) walk(m);
		};
		walk(model);
		assert.include(names, "getBar");
		assert.include(names, "Bar"); // the forgotten export, now retained in the model
	});

	it("routes an unsuppressed ae-forgotten-export to onMessage as a warn diagnostic (non-CI)", () => {
		// api-extractor's default message routing is logLevel "none"; without the configObject `messages`
		// override these analyzer messages reach messageCallback already silenced and never surface. This
		// fixture has a genuine forgotten export, so onMessage must fire — as a warning outside CI, flagged
		// ciFatal so the formatter can nudge.
		const f = scaffoldForgotten();
		const tsdocConfigPath = writeTsdocConfig(f.dir, { suppressWarnings: [], tagDefinitions: [] });
		const messages: Array<{ level: string; code?: string | undefined; ciFatal?: boolean | undefined }> = [];
		runApiExtractor({
			cwd: f.dir,
			packageJsonPath: f.packageJsonPath,
			entryDtsPath: f.entryDtsPath,
			tsconfigPath: f.tsconfigPath,
			tsdocConfigPath,
			apiJsonPath: join(f.dir, "out.api.json"),
			suppressWarnings: [],
			onMessage: (e) => messages.push({ level: e.level, code: e.code, ciFatal: e.ciFatal }),
		});
		const forgotten = messages.find((m) => m.code === "ae-forgotten-export");
		assert.isDefined(forgotten);
		assert.strictEqual(forgotten?.level, "warn");
		assert.strictEqual(forgotten?.ciFatal, true);
	});

	it("fails the build when ci=true and ae-forgotten-export is not suppressed", () => {
		const f = scaffoldForgotten();
		const tsdocConfigPath = writeTsdocConfig(f.dir, { suppressWarnings: [], tagDefinitions: [] });
		assert.throws(
			() =>
				runApiExtractor({
					cwd: f.dir,
					packageJsonPath: f.packageJsonPath,
					entryDtsPath: f.entryDtsPath,
					tsconfigPath: f.tsconfigPath,
					tsdocConfigPath,
					apiJsonPath: join(f.dir, "out.api.json"),
					suppressWarnings: [],
					ci: true,
					// Route the (CI-fatal) ae-forgotten-export diagnostic to a no-op so it is not printed to
					// the console. This only suppresses the message's own output via `handled`; the build still
					// fails on result.errorCount, so the throw assertion below is unaffected.
					onMessage: () => {},
				}),
			/API Extractor/,
		);
	});

	it("routes a suppressed ae-forgotten-export to onSuppressed and does not throw in ci", () => {
		const f = scaffoldForgotten();
		const tsdocConfigPath = writeTsdocConfig(f.dir, { suppressWarnings: [], tagDefinitions: [] });
		const suppressed: Array<{ code?: string | undefined; text: string }> = [];
		runApiExtractor({
			cwd: f.dir,
			packageJsonPath: f.packageJsonPath,
			entryDtsPath: f.entryDtsPath,
			tsconfigPath: f.tsconfigPath,
			tsdocConfigPath,
			apiJsonPath: join(f.dir, "out.api.json"),
			suppressWarnings: [{ messageId: "ae-forgotten-export" }],
			ci: true,
			onSuppressed: (e) => suppressed.push({ code: e.code, text: e.text }),
			// Route the remaining (unsuppressed) ae-missing-release-tag on the forgotten `Bar` to a no-op so
			// API Extractor marks it handled and does not print it to the console; this test only asserts on
			// onSuppressed, not diagnostic text.
			onMessage: () => {},
		});
		assert.strictEqual(
			suppressed.some((s) => s.code === "ae-forgotten-export"),
			true,
		);
	});

	it("emitDocModel:false reports diagnostics but writes no .api.json", () => {
		const f = scaffoldForgotten();
		const tsdocConfigPath = writeTsdocConfig(f.dir, { suppressWarnings: [], tagDefinitions: [] });
		const apiJsonPath = join(f.dir, "should-not-exist.api.json");
		const seen: Array<string | undefined> = [];
		runApiExtractor({
			cwd: f.dir,
			packageJsonPath: f.packageJsonPath,
			entryDtsPath: f.entryDtsPath,
			tsconfigPath: f.tsconfigPath,
			tsdocConfigPath,
			apiJsonPath,
			suppressWarnings: [],
			emitDocModel: false,
			onMessage: (e) => seen.push(e.code),
		});
		assert.strictEqual(existsSync(apiJsonPath), false);
		assert.include(seen, "ae-forgotten-export");
	});
});

// #354: the extractor pass must not inherit the compile tsconfig's `src/**` include. A hand-authored
// `src/*.d.ts` shim (matched by that include, and kept by api-extractor's .d.ts root filter) can
// self-name-import the package, which resolves through the SOURCE manifest's `exports` to raw
// `src/**/*.ts` — putting non-declaration sources in the analysis Program and firing an
// unsuppressable ae-wrong-input-file-type on every build (observed in vitest-bats).
function scaffoldSrcShim(): {
	dir: string;
	entryDtsPath: string;
	tsconfigPath: string;
	packageJsonPath: string;
} {
	const dir = mkdtempSync(join(tmpdir(), "ae-src-shim-"));
	// SOURCE manifest: self-name `exports` point at raw sources (the standard source-repo shape).
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: "@scope/fixture",
			version: "1.0.0",
			types: "./dist/index.d.ts",
			exports: { ".": "./src/index.ts", "./runtime": "./src/runtime.ts" },
		}),
	);
	// Mirrors writeResolvedTsconfig's shape: absolute-path include covering src/**/*.ts (which the
	// tsconfig glob also matches for src/*.d.ts), exclude covering node_modules and dist.
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ESNext",
				module: "NodeNext",
				moduleResolution: "NodeNext",
				declaration: true,
				skipLibCheck: true,
				types: [],
			},
			include: [join(dir, "src/**/*.ts"), join(dir, "types/*.d.ts")],
			exclude: [join(dir, "node_modules"), join(dir, "dist/**/*")],
		}),
	);
	mkdirSync(join(dir, "src"), { recursive: true });
	writeFileSync(join(dir, "src/index.ts"), "export const a = 1;\n");
	writeFileSync(join(dir, "src/runtime.ts"), "export interface ScriptBuilder {\n\trun(): void;\n}\n");
	// The poison: an ambient shim under src/ whose self-name import resolves via the source manifest
	// to src/runtime.ts, dragging raw .ts sources into the extractor Program.
	writeFileSync(
		join(dir, "src/shims.d.ts"),
		'declare module "*.sh" {\n\timport type { ScriptBuilder } from "@scope/fixture/runtime";\n\tconst script: ScriptBuilder;\n\texport default script;\n}\n',
	);
	const dtsDir = join(dir, "dist");
	mkdirSync(dtsDir, { recursive: true });
	writeFileSync(join(dtsDir, "index.d.ts"), "/** @public */\nexport declare function go(): void;\n");
	return {
		dir,
		entryDtsPath: join(dtsDir, "index.d.ts"),
		tsconfigPath: join(dir, "tsconfig.json"),
		packageJsonPath: join(dir, "package.json"),
	};
}

describe("api-extractor tsconfig scoping (#354)", () => {
	it("does not emit ae-wrong-input-file-type when a src/*.d.ts shim references raw sources", () => {
		const f = scaffoldSrcShim();
		const tsdocConfigPath = writeTsdocConfig(f.dir, { suppressWarnings: [], tagDefinitions: [] });
		const apiJsonPath = join(f.dir, "out.api.json");
		const codes: Array<string | undefined> = [];
		let modelWritten = false;
		try {
			runApiExtractor({
				cwd: f.dir,
				packageJsonPath: f.packageJsonPath,
				entryDtsPath: f.entryDtsPath,
				tsconfigPath: f.tsconfigPath,
				tsdocConfigPath,
				apiJsonPath,
				suppressWarnings: [],
				onMessage: (e) => codes.push(e.code),
			});
			modelWritten = existsSync(apiJsonPath);
		} finally {
			rmSync(writeApiExtractorTsconfig({ cwd: f.dir, tsconfigPath: f.tsconfigPath, entryDtsPath: f.entryDtsPath }), {
				force: true,
			});
			rmSync(f.dir, { recursive: true, force: true });
		}
		assert.notInclude(codes, "ae-wrong-input-file-type");
		assert.strictEqual(modelWritten, true);
	});

	it("writeApiExtractorTsconfig derives a files-scoped config extending the base by absolute path", () => {
		const dir = mkdtempSync(join(tmpdir(), "ae-derive-"));
		const base = join(dir, "tsconfig.json");
		writeFileSync(
			base,
			JSON.stringify({ compilerOptions: { skipLibCheck: true }, include: [join(dir, "src/**/*.ts")] }),
		);
		const entry = join(dir, "index.d.ts");
		const derived = writeApiExtractorTsconfig({ cwd: dir, tsconfigPath: base, entryDtsPath: entry });
		try {
			assert.notStrictEqual(derived, base);
			const cfg = JSON.parse(readFileSync(derived, "utf-8")) as {
				extends: string;
				files: string[];
				include: string[];
			};
			assert.strictEqual(cfg.extends, base);
			assert.deepStrictEqual(cfg.files, [entry]);
			// Legacy typings stay analyzable; nothing else from the compile include survives.
			assert.deepStrictEqual(cfg.include, [join(dir, "types/*.d.ts")]);
		} finally {
			rmSync(derived, { force: true });
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writeApiExtractorTsconfig returns a missing base path unchanged (best-effort, mirrors writeDtsEmitTsconfig)", () => {
		const missing = join(tmpdir(), "ae-derive-missing", "tsconfig.json");
		const out = writeApiExtractorTsconfig({
			cwd: "/abs/pkg",
			tsconfigPath: missing,
			entryDtsPath: "/abs/pkg/index.d.ts",
		});
		assert.strictEqual(out, missing);
	});
});
