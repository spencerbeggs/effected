import { realpathSync } from "node:fs";
// packages/bundler/__test__/dts/resolved-tsconfig.test.ts

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { buildResolvedTsconfig, writeDtsEmitTsconfig } from "../../src/dts/resolved-tsconfig.js";

describe("buildResolvedTsconfig", () => {
	it("inherits the package's own compilerOptions", async () => {
		const dir = await mkdtemp(join(tmpdir(), "rtc-own-"));
		await writeFile(
			join(dir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					target: "es2022",
					module: "nodenext",
					strict: true,
					verbatimModuleSyntax: true,
					types: ["node", "vitest"],
				},
			}),
		);
		const cfg = buildResolvedTsconfig({ cwd: dir });
		assert.strictEqual(cfg.compilerOptions.target, "es2022");
		assert.strictEqual(cfg.compilerOptions.module, "nodenext");
		assert.strictEqual(cfg.compilerOptions.strict, true);
		assert.strictEqual(cfg.compilerOptions.verbatimModuleSyntax, true);
		// `types` now comes from the resolved config, not a caller-supplied option.
		assert.deepStrictEqual(cfg.compilerOptions.types, ["node", "vitest"]);
	});

	it("overlays the dts-pass deltas over whatever the package declares", async () => {
		const dir = await mkdtemp(join(tmpdir(), "rtc-overlay-"));
		await writeFile(
			join(dir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					composite: true,
					incremental: true,
					declarationMap: false,
					tsBuildInfoFile: "dist/.tsbuildinfo.lib",
				},
			}),
		);
		const cfg = buildResolvedTsconfig({ cwd: dir });
		// Never skip emit on stale build info.
		assert.strictEqual(cfg.compilerOptions.composite, false);
		assert.strictEqual(cfg.compilerOptions.incremental, false);
		assert.strictEqual(cfg.compilerOptions.declarationMap, true);
		assert.isUndefined(cfg.compilerOptions.tsBuildInfoFile);
	});

	// biome-ignore lint/suspicious/noTemplateCurlyInString: TypeScript's own ${configDir} token, not a JS template
	it("substitutes ${configDir} into absolute paths", async () => {
		const dir = await mkdtemp(join(tmpdir(), "rtc-configdir-"));
		await writeFile(
			join(dir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					// biome-ignore lint/suspicious/noTemplateCurlyInString: TypeScript's own ${configDir} token, not a JS template
					rootDir: "${configDir}",
					// biome-ignore lint/suspicious/noTemplateCurlyInString: TypeScript's own ${configDir} token, not a JS template
					outDir: "${configDir}/dist",
					// biome-ignore lint/suspicious/noTemplateCurlyInString: TypeScript's own ${configDir} token, not a JS template
					typeRoots: ["${configDir}/node_modules/@types", "${configDir}/types"],
				},
			}),
		);
		const cfg = buildResolvedTsconfig({ cwd: dir });
		assert.strictEqual(cfg.compilerOptions.rootDir, dir);
		assert.strictEqual(cfg.compilerOptions.outDir, join(dir, "dist"));
		assert.strictEqual((cfg.compilerOptions.typeRoots as string[]).every(isAbsolute), true);
	});

	it("falls back to synthesized defaults when the package has no tsconfig.json", () => {
		// The e2e leaf fixtures build without one; absence must not throw.
		const cfg = buildResolvedTsconfig({ cwd: "/abs/pkg" });
		assert.strictEqual(cfg.compilerOptions.rootDir, "/abs/pkg");
		assert.deepStrictEqual(cfg.compilerOptions.types, ["node"]);
		assert.strictEqual(cfg.compilerOptions.declaration, true);
		assert.strictEqual(cfg.compilerOptions.composite, false);
		assert.strictEqual((cfg.compilerOptions.typeRoots as string[]).every(isAbsolute), true);
	});

	it("throws when a tsconfig exists but cannot be resolved", async () => {
		// Absence is a supported case; a PRESENT but broken config is not. Falling back here would
		// emit declarations under the wrong options and still report a green build, because the
		// emitted temp tsconfig never references the broken source.
		const dir = await mkdtemp(join(tmpdir(), "rtc-broken-"));
		await writeFile(join(dir, "tsconfig.json"), "{ this is not valid json");
		assert.throws(() => buildResolvedTsconfig({ cwd: dir }), /Cannot resolve tsconfig at/);
	});

	it("throws when a tsconfig extends a target that cannot be located", async () => {
		const dir = await mkdtemp(join(tmpdir(), "rtc-badextends-"));
		await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ extends: "./nope-does-not-exist.json" }));
		assert.throws(() => buildResolvedTsconfig({ cwd: dir }), /Cannot resolve tsconfig at/);
	});

	it("emits absolute include/exclude entries and globs types as declarations", () => {
		const cfg = buildResolvedTsconfig({ cwd: "/abs/pkg" });
		assert.strictEqual((cfg.include as string[]).every(isAbsolute), true);
		assert.strictEqual((cfg.exclude as string[]).every(isAbsolute), true);
		assert.include(cfg.include, "/abs/pkg/types/*.d.ts");
		// __test__ sources stay OUT of the declaration program even though the
		// package's own tsconfig includes them.
		assert.strictEqual(
			(cfg.include as string[]).some((p) => p.includes("__test__")),
			false,
		);
	});

	it("forces declaration on and emitDeclarationOnly off even when the package disables them", async () => {
		// A consumer tsconfig with declaration:false + emitDeclarationOnly:true must not survive the
		// resolve: the dts pass's entire job is emitting declarations, and declarationMap-without-
		// declaration crashes TypeScript's emitter (Debug Failure in getSourceMappingURL).
		const dir = await mkdtemp(join(tmpdir(), "rtc-decl-off-"));
		await writeFile(
			join(dir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					declaration: false,
					emitDeclarationOnly: true,
				},
			}),
		);
		const cfg = buildResolvedTsconfig({ cwd: dir });
		assert.strictEqual(cfg.compilerOptions.declaration, true);
		assert.strictEqual(cfg.compilerOptions.emitDeclarationOnly, false);
	});

	it("lets an explicit jsx override win over the resolved config", async () => {
		const dir = await mkdtemp(join(tmpdir(), "rtc-jsx-"));
		await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "preserve" } }));
		const cfg = buildResolvedTsconfig({ cwd: dir, jsx: "react-jsx", jsxImportSource: "react" });
		assert.strictEqual(cfg.compilerOptions.jsx, "react-jsx");
		assert.strictEqual(cfg.compilerOptions.jsxImportSource, "react");
	});

	it("keeps the resolved jsx when no override is passed", async () => {
		const dir = await mkdtemp(join(tmpdir(), "rtc-jsx-none-"));
		await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "preserve" } }));
		const cfg = buildResolvedTsconfig({ cwd: dir });
		assert.strictEqual(cfg.compilerOptions.jsx, "preserve");
	});
});

describe("writeDtsEmitTsconfig", () => {
	it("writes a temp-dir wrapper that extends the base by absolute path and adds stableTypeOrdering", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dtscfg-"));
		const base = join(dir, "tsconfig-bundle.json");
		const baseCfg = buildResolvedTsconfig({ cwd: dir });
		await writeFile(base, JSON.stringify(baseCfg, null, "\t"));

		const out = writeDtsEmitTsconfig(base);
		// A distinct file (the api-extractor tsconfig keeps its own path) written under the OS temp dir,
		// NOT next to the base — so an in-tree base tsconfig is never polluted with a sibling.
		assert.notStrictEqual(out, base);
		assert.strictEqual(out.startsWith(tmpdir()), true);

		const emitted = JSON.parse(await readFile(out, "utf-8")) as {
			extends: string;
			compilerOptions: Record<string, unknown>;
			include?: string[];
			exclude?: string[];
		};
		// Inherits the base via an ABSOLUTE extends (keeps the base's own relative paths resolving) and
		// adds the flag that makes TS6 declaration emit order union/type members deterministically.
		// The base is named CANONICALLY (symlinks resolved): the tsgo generator keys project files by
		// realpath, so a symlinked tmpdir base must be spelled the way rolldown spells module ids.
		assert.strictEqual(emitted.extends, realpathSync.native(base));
		assert.deepStrictEqual(emitted.compilerOptions, { stableTypeOrdering: true, customConditions: null, paths: null });
		// The base's absolute include set is restated verbatim (it was already absolute).
		assert.deepStrictEqual(emitted.include, baseCfg.include);
		assert.deepStrictEqual(emitted.exclude, baseCfg.exclude);
		// The base (api-extractor) tsconfig is NOT mutated — it must never carry the unknown flag.
		const stillBase = JSON.parse(await readFile(base, "utf-8")) as { compilerOptions: Record<string, unknown> };
		assert.isUndefined(stillBase.compilerOptions.stableTypeOrdering);
	});

	it("always clears customConditions and paths, whether or not the base declares them", async () => {
		const dir = await mkdtemp(join(tmpdir(), "dtscfg-reset-"));
		const declared = join(dir, "declared.json");
		await writeFile(
			declared,
			JSON.stringify({
				compilerOptions: { customConditions: ["source"], paths: { "@x/*": ["./src/*"] }, strict: true },
			}),
		);
		const plain = join(dir, "plain.json");
		await writeFile(plain, JSON.stringify({ compilerOptions: { strict: true } }));
		// A base the kit loader cannot parse must not silently skip the reset either.
		const broken = join(dir, "broken.json");
		await writeFile(broken, "{ not json");
		for (const base of [declared, plain, broken]) {
			const emitted = JSON.parse(await readFile(writeDtsEmitTsconfig(base), "utf-8")) as {
				compilerOptions: Record<string, unknown>;
			};
			assert.deepStrictEqual(emitted.compilerOptions, {
				stableTypeOrdering: true,
				customConditions: null,
				paths: null,
			});
		}
	});

	it("pins TypeScript's default include to the base's own directory when the base declares none", async () => {
		// Without this, the default `**\/*` would resolve against the WRAPPER's directory — the OS temp
		// dir — and the tsgo project would hold every stray temp file instead of the package's sources.
		const dir = await mkdtemp(join(tmpdir(), "dtscfg-noinclude-"));
		const base = join(dir, "tsconfig.json");
		await writeFile(base, JSON.stringify({ compilerOptions: { strict: true } }));
		const emitted = JSON.parse(await readFile(writeDtsEmitTsconfig(base), "utf-8")) as { include?: string[] };
		assert.deepStrictEqual(emitted.include, [join(realpathSync.native(dir), "**/*")]);
	});

	it("falls back to the original path when the base tsconfig does not exist", () => {
		// A synthetic path that was never written (the shape unit tests pass). Best-effort: return the
		// input unchanged rather than writing a stray file, so the dts pass keeps TS's default ordering.
		const missing = join(tmpdir(), "definitely-not-written-xyz.json");
		assert.strictEqual(writeDtsEmitTsconfig(missing), missing);
	});
});
