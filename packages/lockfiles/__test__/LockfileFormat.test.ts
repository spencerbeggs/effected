import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { LockfileFormat, filenameFor, fromFilename } from "../src/LockfileFormat.js";

describe("LockfileFormat", () => {
	it("names the four supported formats", () => {
		assert.deepStrictEqual([...LockfileFormat.literals], ["bun", "npm", "pnpm", "yarn"]);
	});

	describe("filenameFor", () => {
		it("maps every format to its conventional filename", () => {
			assert.strictEqual(filenameFor("bun"), "bun.lock");
			assert.strictEqual(filenameFor("npm"), "package-lock.json");
			assert.strictEqual(filenameFor("pnpm"), "pnpm-lock.yaml");
			assert.strictEqual(filenameFor("yarn"), "yarn.lock");
		});
	});

	describe("fromFilename", () => {
		it("recognizes every conventional filename", () => {
			assert.deepStrictEqual(fromFilename("bun.lock"), Option.some("bun"));
			assert.deepStrictEqual(fromFilename("package-lock.json"), Option.some("npm"));
			assert.deepStrictEqual(fromFilename("pnpm-lock.yaml"), Option.some("pnpm"));
			assert.deepStrictEqual(fromFilename("yarn.lock"), Option.some("yarn"));
		});

		it("round-trips filenameFor for every format", () => {
			for (const format of LockfileFormat.literals) {
				assert.deepStrictEqual(fromFilename(filenameFor(format)), Option.some(format));
			}
		});

		it("returns none for unknown names, paths and near-misses", () => {
			assert.isTrue(Option.isNone(fromFilename("package.json")));
			assert.isTrue(Option.isNone(fromFilename("bun.lockb")));
			assert.isTrue(Option.isNone(fromFilename("some/dir/pnpm-lock.yaml")));
			assert.isTrue(Option.isNone(fromFilename("PNPM-LOCK.YAML")));
			assert.isTrue(Option.isNone(fromFilename("")));
		});
	});
});
