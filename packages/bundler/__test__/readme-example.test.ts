import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, assert, describe, it } from "@effect/vitest";
import { vi } from "vitest";
import type { BundlerBuildOptions, BundlerSeams } from "../src/Bundler.js";

const PACKAGE = resolve(import.meta.dirname, "..");
const SNIPPET = join(import.meta.dirname, "fixtures", "readme", "quick-start.ts");
const readme = readFileSync(join(PACKAGE, "README.md"), "utf-8");

// The example takes no seams, so they are added where it calls the package: it must stay the verbatim README text.
const fakes = vi.hoisted(() => ({ builds: [] as Array<{ cwd: string }>, metas: [] as Array<{ cwd: string }> }));
vi.mock("@effected/bundler", async () => {
	const actual = await vi.importActual<typeof import("../src/index.js")>("../src/index.js");
	const seams: Partial<BundlerSeams> = {
		buildTargetGroups: async (options) => {
			fakes.builds.push({ cwd: options.cwd });
		},
		runMetaPass: async (options) => {
			fakes.metas.push({ cwd: options.cwd });
		},
	};
	return {
		...actual,
		Bundler: { build: (options: BundlerBuildOptions) => actual.Bundler.build({ ...options, seams }) },
	};
});

describe("the README", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("carries the compiled example verbatim", () => {
		const match = /## Quick start\n\n```ts\n(.*?)```/s.exec(readme);
		assert.isNotNull(match);
		assert.strictEqual(match?.[1], readFileSync(SNIPPET, "utf-8"));
	});

	it("states the engines this package declares", () => {
		const { engines } = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf-8")) as {
			engines: { node: string };
		};
		assert.include(readme, `Requires Node.js ${engines.node}.`);
	});

	it("runs the example, which answers where issues.json went", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "bundler-readme-"));
		try {
			writeFileSync(
				join(cwd, "package.json"),
				JSON.stringify({ name: "example", version: "1.0.0", exports: { ".": "./src/index.ts" } }),
			);
			vi.spyOn(process, "cwd").mockReturnValue(cwd);
			const logged = new Promise<unknown>((done) => {
				vi.spyOn(console, "log").mockImplementation(done);
			});
			// The example ends in a floating promise, so its answer arrives through console.log.
			await import("./fixtures/readme/quick-start.js");
			const issuesPath = (await logged) as string;

			assert.strictEqual(issuesPath, join(cwd, "dist", "prod", "issues.json"));
			assert.isTrue(existsSync(issuesPath));
			assert.strictEqual((JSON.parse(readFileSync(issuesPath, "utf-8")) as { buildOk: boolean }).buildOk, true);
			assert.deepStrictEqual(fakes.builds, [{ cwd }]);
			assert.deepStrictEqual(fakes.metas, [{ cwd }]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}, 30_000);
});
