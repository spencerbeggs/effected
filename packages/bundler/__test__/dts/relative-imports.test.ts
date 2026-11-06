// packages/bundler/__test__/dts/relative-imports.test.ts
import { assert, describe, it } from "@effect/vitest";
import { findRelativeSpecifiers } from "../../src/dts/relative-imports.js";

describe("findRelativeSpecifiers", () => {
	it("returns [] for a self-contained ambient declaration (declare module + bare specifier)", () => {
		const src = `declare module "pkg/virtual/x" {\n  import type { Y } from "pkg/runtime";\n  export const y: Y;\n}\n`;
		assert.deepStrictEqual(findRelativeSpecifiers(src), []);
	});
	it("flags a relative import", () => {
		assert.deepStrictEqual(findRelativeSpecifiers(`import type { A } from "./neighbor.js";\n`), ["./neighbor.js"]);
	});
	it("flags a relative export-from and a parent import", () => {
		const src = `export type { A } from "./a.js";\nimport type { B } from "../b.js";\n`;
		assert.deepStrictEqual(findRelativeSpecifiers(src).sort(), ["../b.js", "./a.js"]);
	});
	it("flags a relative import() type node", () => {
		assert.deepStrictEqual(findRelativeSpecifiers(`export type T = import("./mod.js").Thing;\n`), ["./mod.js"]);
	});
	it("flags a relative triple-slash reference path", () => {
		assert.deepStrictEqual(findRelativeSpecifiers(`/// <reference path="./other.d.ts" />\nexport {};\n`), [
			"./other.d.ts",
		]);
	});
	it("flags a relative import-equals-require", () => {
		assert.deepStrictEqual(findRelativeSpecifiers(`import foo = require("./bar.js");\nexport = foo;\n`), ["./bar.js"]);
	});
	it("deduplicates repeated specifiers", () => {
		const src = `import type { A } from "./a.js";\nimport type { B } from "./a.js";\n`;
		assert.deepStrictEqual(findRelativeSpecifiers(src), ["./a.js"]);
	});
	it("flags a relative import inside a declare module body", () => {
		const src = `declare module "pkg/v" {\n  import type { X } from "./x.js";\n  export const x: X;\n}\n`;
		assert.deepStrictEqual(findRelativeSpecifiers(src), ["./x.js"]);
	});
});
