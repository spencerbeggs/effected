// Ported from savvy-web/systems packages/tsdown-plugins/__test__/exe/build.test.ts on 2026-11-06
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { assert, describe, it } from "@effect/vitest";
import { vi } from "vitest";
import { runExeBuild } from "../../src/exe/build.js";

describe("runExeBuild", () => {
	it("calls the injected build once per binary with the SEA exe config", async () => {
		const build = vi.fn(async () => {});
		await runExeBuild({
			cwd: "/abs/pkg",
			outDir: "/abs/pkg/dist/dev/pkg/bin",
			specs: [
				{
					fileName: "tool",
					entry: "./src/bin.ts",
					targets: [{ platform: "darwin", arch: "arm64", nodeVersion: "25.9.0" }],
					seaConfig: { disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false },
				},
			],
			build,
		});
		assert.strictEqual(build.mock.calls.length, 1);
		const cfg = (build.mock.calls[0] as unknown as [unknown])[0] as {
			cwd: string;
			entry: string[];
			format: string;
			platform: string;
			deps: { alwaysBundle: (id: string) => boolean };
			exe: { fileName: string; outDir: string; targets: unknown; seaConfig: unknown };
		};
		assert.strictEqual(cfg.cwd, "/abs/pkg");
		assert.deepStrictEqual(cfg.entry, ["./src/bin.ts"]);
		assert.strictEqual(cfg.format, "esm");
		assert.strictEqual(cfg.platform, "node");
		assert.strictEqual(cfg.exe.fileName, "tool");
		assert.strictEqual(cfg.exe.outDir, "/abs/pkg/dist/dev/pkg/bin");
		assert.deepStrictEqual(cfg.exe.targets, [{ platform: "darwin", arch: "arm64", nodeVersion: "25.9.0" }]);
		assert.deepStrictEqual(cfg.exe.seaConfig, {
			disableExperimentalSEAWarning: true,
			useCodeCache: false,
			useSnapshot: false,
		});
		// alwaysBundle: bundle everything except node: builtins
		assert.strictEqual(cfg.deps.alwaysBundle("node:fs"), false);
		assert.strictEqual(cfg.deps.alwaysBundle("some-dep"), true);
	});

	it("redirects tsdown's JS bundle to a scratch dir (not the package dist) and cleans it up", async () => {
		// The bundled JS the SEA compiles from must not leak into the package `dist/` as an orphaned
		// `dist/<entry>.mjs`. It is sent to a throwaway scratch dir and removed once the binary is built.
		let seenOutDir: string | undefined;
		const build = vi.fn(async (cfg: unknown) => {
			seenOutDir = (cfg as { outDir: string }).outDir;
			// The scratch dir exists for the duration of the build.
			assert.strictEqual(existsSync(seenOutDir), true);
		});
		await runExeBuild({
			cwd: "/abs/pkg",
			outDir: "/abs/pkg/dist/dev/pkg/bin",
			specs: [
				{
					fileName: "tool",
					entry: "./src/bin.ts",
					targets: [{ platform: "darwin", arch: "arm64", nodeVersion: "25.9.0" }],
					seaConfig: { disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false },
				},
			],
			build,
		});
		assert.isDefined(seenOutDir);
		// Scratch lives under the OS temp dir, never the package's own dist tree.
		assert.strictEqual(seenOutDir?.startsWith(tmpdir()), true);
		assert.strictEqual(seenOutDir?.startsWith("/abs/pkg/dist"), false);
		// ...and it is removed after the binary is built.
		assert.strictEqual(existsSync(seenOutDir as string), false);
	});

	it("builds once per spec for a multi-binary config", async () => {
		const build = vi.fn(async () => {});
		await runExeBuild({
			cwd: "/abs/pkg",
			outDir: "/abs/pkg/bin",
			specs: [
				{
					fileName: "a",
					entry: "./src/a.ts",
					targets: [{ platform: "linux", arch: "x64", nodeVersion: "25.9.0" }],
					seaConfig: { disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false },
				},
				{
					fileName: "b",
					entry: "./src/b.ts",
					targets: [{ platform: "linux", arch: "arm64", nodeVersion: "25.9.0" }],
					seaConfig: { disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false },
				},
			],
			build,
		});
		assert.strictEqual(build.mock.calls.length, 2);
		const c0 = (build.mock.calls[0] as unknown as [unknown])[0] as {
			entry: string[];
			exe: { fileName: string; targets: Array<{ platform: string }> };
		};
		const c1 = (build.mock.calls[1] as unknown as [unknown])[0] as {
			entry: string[];
			exe: { fileName: string; targets: Array<{ platform: string }> };
		};
		assert.deepStrictEqual(c0.entry, ["./src/a.ts"]);
		assert.strictEqual(c0.exe.fileName, "a");
		assert.deepStrictEqual(c1.entry, ["./src/b.ts"]);
		assert.strictEqual(c1.exe.fileName, "b");
	});
});
