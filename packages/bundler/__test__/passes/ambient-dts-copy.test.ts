// packages/bundler/__test__/build/ambient-dts-copy.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { copyAmbientDts } from "../../src/passes/sync-public.js";

function fixture(): string {
	const dir = mkdtempSync(join(tmpdir(), "ambient-"));
	mkdirSync(join(dir, "src/long/path"), { recursive: true });
	writeFileSync(
		join(dir, "src/long/path/input-file.d.ts"),
		`declare module "pkg/virtual/x" {\n  export const y: number;\n}\n`,
	);
	mkdirSync(join(dir, "out"), { recursive: true });
	return dir;
}

describe("copyAmbientDts", () => {
	it("copies the source verbatim to outDir/<outName>", () => {
		const dir = fixture();
		copyAmbientDts({
			ambient: [{ exportKey: "./virtual", source: "./src/long/path/input-file.d.ts", outName: "virtual.d.ts" }],
			srcCwd: dir,
			outDir: join(dir, "out"),
		});
		const dst = join(dir, "out/virtual.d.ts");
		assert.strictEqual(existsSync(dst), true);
		assert.include(readFileSync(dst, "utf-8"), `declare module "pkg/virtual/x"`);
	});

	it("creates the subdir for an exportsAsIndexes outName", () => {
		const dir = fixture();
		copyAmbientDts({
			ambient: [{ exportKey: "./css", source: "./src/long/path/input-file.d.ts", outName: "css/index.d.ts" }],
			srcCwd: dir,
			outDir: join(dir, "out"),
		});
		assert.strictEqual(existsSync(join(dir, "out/css/index.d.ts")), true);
	});

	it("is byte-stable: an unchanged file is not rewritten", () => {
		const dir = fixture();
		const opts = {
			ambient: [{ exportKey: "./virtual", source: "./src/long/path/input-file.d.ts", outName: "virtual.d.ts" }],
			srcCwd: dir,
			outDir: join(dir, "out"),
		};
		copyAmbientDts(opts);
		const dst = join(dir, "out/virtual.d.ts");
		const mtime1 = statSync(dst).mtimeMs;
		copyAmbientDts(opts);
		assert.strictEqual(statSync(dst).mtimeMs, mtime1);
	});

	it("throws ConfigValidationError when the source is missing", () => {
		const dir = fixture();
		assert.throws(
			() =>
				copyAmbientDts({
					ambient: [{ exportKey: "./gone", source: "./src/missing.d.ts", outName: "gone.d.ts" }],
					srcCwd: dir,
					outDir: join(dir, "out"),
				}),
			/ambient .d.ts source not found/,
		);
	});

	it("throws ConfigValidationError when the source has a relative import", () => {
		const dir = fixture();
		const rel = join(dir, "src/rel.d.ts");
		mkdirSync(dirname(rel), { recursive: true });
		writeFileSync(rel, `import type { A } from "./neighbor.js";\nexport type B = A;\n`);
		assert.throws(
			() =>
				copyAmbientDts({
					ambient: [{ exportKey: "./rel", source: "./src/rel.d.ts", outName: "rel.d.ts" }],
					srcCwd: dir,
					outDir: join(dir, "out"),
				}),
			/relative import/,
		);
	});
});
