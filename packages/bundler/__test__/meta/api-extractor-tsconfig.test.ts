// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/api-extractor-tsconfig.test.ts on 2026-11-06
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import { TsconfigLoader } from "@effected/tsconfig-json";
import { Effect } from "effect";
import type { WriteApiExtractorTsconfigOptions } from "../../src/meta/api-extractor.js";
import { writeApiExtractorTsconfig } from "../../src/meta/api-extractor.js";

/** The derived config lands in the host tmpdir and extends a real base, so the write runs on the host disk. */
const write = (options: WriteApiExtractorTsconfigOptions) =>
	writeApiExtractorTsconfig(options).pipe(Effect.provide(NodeServices.layer));

const cleanup: string[] = [];
afterEach(() => {
	for (const p of cleanup.splice(0)) rmSync(p, { recursive: true, force: true });
});

function scaffold(baseJson: string): { dir: string; base: string; entry: string } {
	const dir = mkdtempSync(join(tmpdir(), "ae-paths-"));
	cleanup.push(dir);
	const base = join(dir, "tsconfig.json");
	writeFileSync(base, baseJson);
	return { dir, base, entry: join(dir, "index.d.ts") };
}

function read(path: string): { compilerOptions?: { paths?: Record<string, string[]> } } {
	cleanup.push(path);
	return JSON.parse(readFileSync(path, "utf-8")) as { compilerOptions?: { paths?: Record<string, string[]> } };
}

describe("writeApiExtractorTsconfig — self-reference paths (#771)", () => {
	it.effect("emits compilerOptions.paths for the provided specifiers", () =>
		Effect.gen(function* () {
			const { dir, base, entry } = scaffold(JSON.stringify({ compilerOptions: { skipLibCheck: true } }));
			const out = yield* write({
				cwd: dir,
				tsconfigPath: base,
				entryDtsPath: entry,
				paths: { "@scope/pkg": ["/decl/index.d.ts"], "@scope/pkg/sub": ["/decl/sub.d.ts"] },
			});
			assert.deepStrictEqual(read(out).compilerOptions?.paths, {
				"@scope/pkg": ["/decl/index.d.ts"],
				"@scope/pkg/sub": ["/decl/sub.d.ts"],
			});
		}),
	);

	it.effect("merges the base tsconfig's own paths, with the provided paths winning", () =>
		Effect.gen(function* () {
			const { dir, base, entry } = scaffold(
				JSON.stringify({ compilerOptions: { paths: { "~/*": ["./src/*"], "@scope/pkg": ["./src/index.ts"] } } }),
			);
			const out = yield* write({
				cwd: dir,
				tsconfigPath: base,
				entryDtsPath: entry,
				paths: { "@scope/pkg": ["/decl/index.d.ts"] },
			});
			assert.deepStrictEqual(read(out).compilerOptions?.paths, {
				"~/*": [join(dir, "src/*")],
				"@scope/pkg": ["/decl/index.d.ts"],
			});
		}),
	);

	it.effect("merges the paths of a base tsconfig written as JSONC (comments, trailing commas)", () =>
		Effect.gen(function* () {
			const { dir, base, entry } = scaffold(
				[
					"{",
					"\t// tsconfig allows comments",
					'\t"compilerOptions": {',
					'\t\t/* and block comments */ "paths": { "~/*": ["./src/*"], },',
					"\t},",
					"}",
				].join("\n"),
			);
			const out = yield* write({
				cwd: dir,
				tsconfigPath: base,
				entryDtsPath: entry,
				paths: { "@scope/pkg": ["/decl/index.d.ts"] },
			});
			assert.deepStrictEqual(read(out).compilerOptions?.paths, {
				"~/*": [join(dir, "src/*")],
				"@scope/pkg": ["/decl/index.d.ts"],
			});
		}),
	);

	it.effect("anchors re-emitted targets to the base's baseUrl when one is in effect", () =>
		Effect.gen(function* () {
			const { dir, base, entry } = scaffold(
				JSON.stringify({ compilerOptions: { baseUrl: "./lib", paths: { "~/*": ["./src/*"] } } }),
			);
			const out = yield* write({ cwd: dir, tsconfigPath: base, entryDtsPath: entry, paths: { a: ["/a"] } });
			assert.deepStrictEqual(read(out).compilerOptions?.paths?.["~/*"], [join(dir, "lib/src/*")]);
		}),
	);

	it.effect("keeps paths the base inherits from further up its extends chain", () =>
		Effect.gen(function* () {
			const root = mkdtempSync(join(tmpdir(), "ae-paths-chain-"));
			cleanup.push(root);
			writeFileSync(
				join(root, "tsconfig.root.json"),
				JSON.stringify({ compilerOptions: { paths: { "~/*": ["./src/*"] } } }),
			);
			mkdirSync(join(root, "pkg"));
			const base = join(root, "pkg", "tsconfig.json");
			writeFileSync(base, JSON.stringify({ extends: "../tsconfig.root.json" }));
			const out = yield* write({
				cwd: join(root, "pkg"),
				tsconfigPath: base,
				entryDtsPath: join(root, "pkg", "index.d.ts"),
				paths: { a: ["/a"] },
			});
			// TypeScript resolves an inherited `paths` against the config that declared it: the root.
			assert.deepStrictEqual(read(out).compilerOptions?.paths?.["~/*"], [join(root, "src/*")]);
		}),
	);

	it.effect("resolves a base mapping through the derived config to the real file", () =>
		Effect.gen(function* () {
			const { dir, base, entry } = scaffold(JSON.stringify({ compilerOptions: { paths: { "~/*": ["./src/*"] } } }));
			mkdirSync(join(dir, "src"));
			writeFileSync(join(dir, "src", "util.ts"), "export const x = 1;\n");
			const out = yield* write({ cwd: dir, tsconfigPath: base, entryDtsPath: entry, paths: { a: ["/a"] } });
			cleanup.push(out);
			// Resolve the DERIVED config with the same tsc-parity loader, then map "~/util" the way
			// TypeScript does: substitute the wildcard and anchor at baseUrl, else at pathsBase.
			const derived = yield* TsconfigLoader.resolve(out).pipe(Effect.provide(NodeServices.layer));
			const anchor = derived.compilerOptions.baseUrl ?? derived.pathsBase ?? dirname(out);
			const target = derived.compilerOptions.paths?.["~/*"]?.[0];
			assert.isDefined(target);
			const mapped = resolve(anchor, (target ?? "").replaceAll("*", "util.ts"));
			assert.strictEqual(existsSync(mapped), true);
			assert.strictEqual(realpathSync(mapped), realpathSync(join(dir, "src", "util.ts")));
		}),
	);

	it.effect("tolerates an unparseable base file when merging", () =>
		Effect.gen(function* () {
			const { dir, base, entry } = scaffold("{ not json");
			const out = yield* write({
				cwd: dir,
				tsconfigPath: base,
				entryDtsPath: entry,
				paths: { "@scope/pkg": ["/decl/index.d.ts"] },
			});
			assert.deepStrictEqual(read(out).compilerOptions?.paths, { "@scope/pkg": ["/decl/index.d.ts"] });
		}),
	);

	it.effect("emits no compilerOptions key when paths are omitted or empty", () =>
		Effect.gen(function* () {
			const { dir, base, entry } = scaffold(JSON.stringify({ compilerOptions: { paths: { "~/*": ["./src/*"] } } }));
			const omitted = yield* write({ cwd: dir, tsconfigPath: base, entryDtsPath: entry });
			const emptied = yield* write({ cwd: dir, tsconfigPath: base, entryDtsPath: entry, paths: {} });
			assert.notProperty(read(omitted), "compilerOptions");
			assert.notProperty(read(emptied), "compilerOptions");
		}),
	);

	it.effect("derives a different file when the paths differ", () =>
		Effect.gen(function* () {
			const { dir, base, entry } = scaffold("{}");
			const a = yield* write({ cwd: dir, tsconfigPath: base, entryDtsPath: entry, paths: { a: ["/a"] } });
			const b = yield* write({ cwd: dir, tsconfigPath: base, entryDtsPath: entry, paths: { b: ["/b"] } });
			cleanup.push(a, b);
			assert.notStrictEqual(a, b);
		}),
	);
});
