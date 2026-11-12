// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/api-extractor.int.test.ts on 2026-11-06
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { RunApiExtractorOptions, WriteApiExtractorTsconfigOptions } from "../../src/meta/api-extractor.js";
import { runApiExtractor, writeApiExtractorTsconfig } from "../../src/meta/api-extractor.js";
import type { TsdocOptions } from "../../src/meta/config.js";
import { writeTsdocConfig } from "../../src/meta/tsdoc-config.js";

// API Extractor reads the fixtures from the host disk, so every step runs on it.
const ae = (options: RunApiExtractorOptions) => runApiExtractor(options).pipe(Effect.provide(NodeServices.layer));
const aeTsconfig = (options: WriteApiExtractorTsconfigOptions) =>
	writeApiExtractorTsconfig(options).pipe(Effect.provide(NodeServices.layer));
const tsdoc = (cwd: string, options: TsdocOptions) =>
	writeTsdocConfig(cwd, options).pipe(Effect.provide(NodeServices.layer));

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
	it.effect("produces a .api.json and suppresses ae-forgotten-export/_base", () =>
		Effect.gen(function* () {
			const { dir, dtsDir } = scaffold();
			const tsdocConfigPath = yield* tsdoc(dir, { suppressWarnings: [], tagDefinitions: [] });
			const apiJsonPath = join(dir, "out.api.json");
			yield* ae({
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
		}),
	);

	it.effect("includes forgotten exports in the emitted .api.json so the model stays reconstructable", () =>
		Effect.gen(function* () {
			// rspress-plugin-api-extractor#56: a forgotten export (here `Bar`, referenced by `getBar` but not
			// exported) must be INCLUDED in the doc model, not dropped — otherwise downstream .d.ts
			// reconstruction loses the referenced type (the synthetic `*_base` of Effect class mixins is the
			// real-world offender). includeForgottenExports: true keeps the model complete.
			const f = scaffoldForgotten();
			const tsdocConfigPath = yield* tsdoc(f.dir, { suppressWarnings: [], tagDefinitions: [] });
			const apiJsonPath = join(f.dir, "out.api.json");
			yield* ae({
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
		}),
	);

	it.effect("routes an unsuppressed ae-forgotten-export to onMessage as a warn diagnostic (non-CI)", () =>
		Effect.gen(function* () {
			// api-extractor's default message routing is logLevel "none"; without the configObject `messages`
			// override these analyzer messages reach messageCallback already silenced and never surface. This
			// fixture has a genuine forgotten export, so onMessage must fire — as a warning outside CI, flagged
			// ciFatal so the formatter can nudge.
			const f = scaffoldForgotten();
			const tsdocConfigPath = yield* tsdoc(f.dir, { suppressWarnings: [], tagDefinitions: [] });
			const messages: Array<{ level: string; code?: string | undefined; ciFatal?: boolean | undefined }> = [];
			yield* ae({
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
		}),
	);

	it.effect("fails the build when ci=true and ae-forgotten-export is not suppressed", () =>
		Effect.gen(function* () {
			const f = scaffoldForgotten();
			const tsdocConfigPath = yield* tsdoc(f.dir, { suppressWarnings: [], tagDefinitions: [] });
			const err = yield* Effect.flip(
				ae({
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
					// fails on result.errorCount, so the failure assertion below is unaffected.
					onMessage: () => {},
				}),
			);
			assert.match(err instanceof Error ? err.message : String(err), /API Extractor/);
		}),
	);

	it.effect("routes a suppressed ae-forgotten-export to onSuppressed and does not throw in ci", () =>
		Effect.gen(function* () {
			const f = scaffoldForgotten();
			const tsdocConfigPath = yield* tsdoc(f.dir, { suppressWarnings: [], tagDefinitions: [] });
			const suppressed: Array<{ code?: string | undefined; text: string }> = [];
			yield* ae({
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
		}),
	);

	it.effect("emitDocModel:false reports diagnostics but writes no .api.json", () =>
		Effect.gen(function* () {
			const f = scaffoldForgotten();
			const tsdocConfigPath = yield* tsdoc(f.dir, { suppressWarnings: [], tagDefinitions: [] });
			const apiJsonPath = join(f.dir, "should-not-exist.api.json");
			const seen: Array<string | undefined> = [];
			yield* ae({
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
		}),
	);
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
	it.effect("does not emit ae-wrong-input-file-type when a src/*.d.ts shim references raw sources", () =>
		Effect.gen(function* () {
			const f = scaffoldSrcShim();
			const tsdocConfigPath = yield* tsdoc(f.dir, { suppressWarnings: [], tagDefinitions: [] });
			const apiJsonPath = join(f.dir, "out.api.json");
			const codes: Array<string | undefined> = [];
			let modelWritten = false;
			try {
				yield* ae({
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
				rmSync(yield* aeTsconfig({ cwd: f.dir, tsconfigPath: f.tsconfigPath, entryDtsPath: f.entryDtsPath }), {
					force: true,
				});
				rmSync(f.dir, { recursive: true, force: true });
			}
			assert.notInclude(codes, "ae-wrong-input-file-type");
			assert.strictEqual(modelWritten, true);
		}),
	);

	it.effect("writeApiExtractorTsconfig derives a files-scoped config extending the base by absolute path", () =>
		Effect.gen(function* () {
			const dir = mkdtempSync(join(tmpdir(), "ae-derive-"));
			const base = join(dir, "tsconfig.json");
			writeFileSync(
				base,
				JSON.stringify({ compilerOptions: { skipLibCheck: true }, include: [join(dir, "src/**/*.ts")] }),
			);
			const entry = join(dir, "index.d.ts");
			const derived = yield* aeTsconfig({ cwd: dir, tsconfigPath: base, entryDtsPath: entry });
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
		}),
	);

	it.effect(
		"writeApiExtractorTsconfig returns a missing base path unchanged (best-effort, mirrors writeDtsEmitTsconfig)",
		() =>
			Effect.gen(function* () {
				const missing = join(tmpdir(), "ae-derive-missing", "tsconfig.json");
				const out = yield* aeTsconfig({
					cwd: "/abs/pkg",
					tsconfigPath: missing,
					entryDtsPath: "/abs/pkg/index.d.ts",
				});
				assert.strictEqual(out, missing);
			}),
	);
});

describe("runApiExtractor classifies a .ts input by where it lives", () => {
	const run = (target: "own" | "sibling") =>
		Effect.gen(function* () {
			const root = mkdtempSync(join(tmpdir(), "ae-input-"));
			const dir = join(root, "pkg");
			mkdirSync(join(dir, "src"), { recursive: true });
			const sibling = join(root, "sibling");
			mkdirSync(sibling, { recursive: true });
			const file = target === "own" ? join(dir, "src", "real.ts") : join(sibling, "real.ts");
			writeFileSync(file, "export interface Real { readonly a: string }\n");
			writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
			const tsconfigPath = join(dir, "tsconfig.json");
			writeFileSync(
				tsconfigPath,
				JSON.stringify({
					compilerOptions: {
						module: "nodenext",
						moduleResolution: "nodenext",
						strict: true,
						skipLibCheck: true,
						types: [],
					},
				}),
			);
			const entryDtsPath = join(dir, "entry.d.ts");
			writeFileSync(entryDtsPath, '/** @public */\nexport type { Real } from "reached";\n');
			const warned: string[] = [];
			const suppressed: string[] = [];
			yield* ae({
				cwd: dir,
				packageJsonPath: join(dir, "package.json"),
				entryDtsPath,
				tsconfigPath,
				tsdocConfigPath: yield* tsdoc(dir, {}),
				apiJsonPath: join(dir, "fixture.api.json"),
				emitDocModel: false,
				selfReferencePaths: { reached: [file] },
				suppressWarnings: [],
				onMessage: (entry) => warned.push(entry.code ?? ""),
				onSuppressed: (entry) => suppressed.push(entry.code ?? ""),
			});
			return { warned, suppressed };
		});

	it.effect(
		"keeps a warning for a file in the package",
		() =>
			Effect.gen(function* () {
				const { warned, suppressed } = yield* run("own");
				// Once: the program scan does not repeat a file API Extractor's own message already named.
				assert.lengthOf(
					warned.filter((code) => code === "ae-wrong-input-file-type"),
					1,
				);
				assert.notInclude(suppressed, "ae-wrong-input-file-type");
			}),
		60_000,
	);

	it.effect(
		"records a suppression for a file outside it",
		() =>
			Effect.gen(function* () {
				const { warned, suppressed } = yield* run("sibling");
				assert.notInclude(warned, "ae-wrong-input-file-type");
				assert.include(suppressed, "ae-wrong-input-file-type");
			}),
		60_000,
	);
});

describe("runApiExtractor judges own-source leakage from the program's file list (#1260)", () => {
	// The entry reaches a sibling's source first and its own source second, so API Extractor's one
	// `ae-wrong-input-file-type`, which names only the first non-declaration file, names the sibling.
	const run = (suppressWarnings: ReadonlyArray<{ readonly messageId: string }> = []) =>
		Effect.gen(function* () {
			const root = mkdtempSync(join(tmpdir(), "ae-order-"));
			const dir = join(root, "pkg");
			mkdirSync(join(dir, "src"), { recursive: true });
			mkdirSync(join(root, "sibling"), { recursive: true });
			const siblingFile = join(root, "sibling", "aaa.ts");
			const ownFile = join(dir, "src", "zzz.ts");
			writeFileSync(siblingFile, "export interface Sibling { readonly a: string }\n");
			writeFileSync(ownFile, "export interface Own { readonly b: string }\n");
			writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
			const tsconfigPath = join(dir, "tsconfig.json");
			writeFileSync(
				tsconfigPath,
				JSON.stringify({
					compilerOptions: {
						module: "nodenext",
						moduleResolution: "nodenext",
						strict: true,
						skipLibCheck: true,
						types: [],
					},
				}),
			);
			const entryDtsPath = join(dir, "entry.d.ts");
			writeFileSync(
				entryDtsPath,
				'/** @public */\nexport type { Sibling } from "sibling-reached";\n/** @public */\nexport type { Own } from "own-reached";\n',
			);
			const warned: Array<{ code: string; file: string }> = [];
			const suppressed: Array<{ code: string; file: string }> = [];
			yield* ae({
				cwd: dir,
				packageJsonPath: join(dir, "package.json"),
				entryDtsPath,
				tsconfigPath,
				tsdocConfigPath: yield* tsdoc(dir, {}),
				apiJsonPath: join(dir, "fixture.api.json"),
				emitDocModel: false,
				selfReferencePaths: { "sibling-reached": [siblingFile], "own-reached": [ownFile] },
				suppressWarnings,
				onMessage: (entry) => warned.push({ code: entry.code ?? "", file: entry.file ?? "" }),
				onSuppressed: (entry) => suppressed.push({ code: entry.code ?? "", file: entry.file ?? "" }),
			});
			const named = (list: ReadonlyArray<{ code: string; file: string }>, file: string) =>
				list.filter((entry) => entry.code === "ae-wrong-input-file-type" && entry.file.endsWith(file));
			return { warned, suppressed, named };
		});

	it.effect(
		"reports an own source that sorts after a sibling's, and still suppresses the sibling",
		() =>
			Effect.gen(function* () {
				const { warned, suppressed, named } = yield* run();
				assert.lengthOf(named(suppressed, "aaa.ts"), 1);
				assert.lengthOf(named(warned, "aaa.ts"), 0);
				assert.lengthOf(named(warned, "zzz.ts"), 1);
			}),
		60_000,
	);

	it.effect(
		"honours a suppression rule for the scanned own source",
		() =>
			Effect.gen(function* () {
				const { warned, suppressed, named } = yield* run([{ messageId: "ae-wrong-input-file-type" }]);
				assert.lengthOf(named(warned, "zzz.ts"), 0);
				assert.lengthOf(named(suppressed, "zzz.ts"), 1);
			}),
		60_000,
	);
});
