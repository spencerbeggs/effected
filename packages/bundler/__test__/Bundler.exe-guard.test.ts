import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { vi } from "vitest";
import { Bundler } from "../src/Bundler.js";
import { BundlerError } from "../src/BundlerError.js";
import { PackageBuildConfig } from "../src/config/BuildConfig.js";

// The drift guard runs only over the real compile, so the real module is what is replaced here: a seam would skip it.
const compile = vi.hoisted(() => ({ writes: undefined as string | undefined, calls: [] as string[] }));
vi.mock("../src/exe/build.js", () => ({
	runExeBuild: async (options: { outDir: string }) => {
		compile.calls.push(options.outDir);
		if (compile.writes !== undefined) {
			mkdirSync(options.outDir, { recursive: true });
			writeFileSync(join(options.outDir, compile.writes), "");
		}
	},
}));

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const build = (emits: string | undefined) =>
	Effect.suspend(() => {
		compile.writes = emits;
		compile.calls.length = 0;
		const cwd = mkdtempSync(join(tmpdir(), "bundler-exe-guard-"));
		dirs.push(cwd);
		return Bundler.build({
			cwd,
			config: Schema.decodeUnknownSync(PackageBuildConfig)({ meta: false, exe: { fileName: "tool" } }),
			bundle: undefined,
			noExe: false,
			verbose: false,
			plugins: [],
			ci: false,
			seams: {
				readPackageJson: () => ({
					name: "tool",
					version: "1.0.0",
					os: ["linux"],
					cpu: ["x64"],
					exports: { ".": "./src/bin.ts" },
				}),
			},
		}).pipe(
			Effect.map(() => cwd),
			// The host disk: the mocked compile writes the binary there, and the drift guard must see it.
			Effect.provide(NodeServices.layer),
		);
	});

describe("Bundler.build over the real exe module", () => {
	it.effect("reaches the lazily imported compile, and passes when the computed binary exists", () =>
		Effect.gen(function* () {
			const cwd = yield* build("tool-linux-x64");
			assert.deepStrictEqual(compile.calls, [join(cwd, "dist", "prod", "npm", "pkg", "bin")]);
			assert.isTrue(existsSync(join(cwd, "dist", "prod", "npm", "pkg", "bin", "tool-linux-x64")));
		}),
	);

	it.effect("fails phase exe naming the computed name when the compiler emitted something else", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(build("tool"));
			assert.instanceOf(error, BundlerError);
			assert.strictEqual(error.phase, "exe");
			assert.match(error.message, /expected compiled binary at .*tool-linux-x64 but it is missing/);
		}),
	);
});
