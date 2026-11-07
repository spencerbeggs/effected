// Ported from savvy-web/systems packages/tsdown-plugins/__test__/dts/reexport-stub.test.ts on 2026-11-06
// packages/bundler/__test__/dts/reexport-stub.test.ts
import { assert, describe, it } from "@effect/vitest";
import { analyzeReexportBarrel, collectExportNames, renderReexportStub } from "../../src/dts/reexport-stub.js";

describe("analyzeReexportBarrel", () => {
	it("classifies named value vs type re-exports and reports a pure barrel", () => {
		const src = `
			export { A, B as Bee } from "./a.js";
			export type { T } from "./t.js";
			export { C } from "./c.js";
		`;
		const r = analyzeReexportBarrel(src);
		assert.strictEqual(r.isPureNamedReexportBarrel, true);
		assert.deepStrictEqual([...r.valueNames].sort(), ["A", "Bee", "C"]);
		assert.deepStrictEqual(r.typeNames, ["T"]);
	});

	it("treats `export type { … }` and per-specifier `type` modifiers as type-only", () => {
		const r = analyzeReexportBarrel(`export { type X, Y } from "./m.js";`);
		assert.deepStrictEqual(r.typeNames, ["X"]);
		assert.deepStrictEqual(r.valueNames, ["Y"]);
	});

	it("is NOT a pure barrel when a star re-export is present", () => {
		assert.strictEqual(analyzeReexportBarrel(`export * from "./a.js";`).isPureNamedReexportBarrel, false);
	});

	it("is NOT a pure barrel when a namespace re-export is present", () => {
		assert.strictEqual(analyzeReexportBarrel(`export * as NS from "./a.js";`).isPureNamedReexportBarrel, false);
	});

	it("is NOT a pure barrel when a local declaration is exported", () => {
		const src = `export { A } from "./a.js";\nexport const local = 1;`;
		assert.strictEqual(analyzeReexportBarrel(src).isPureNamedReexportBarrel, false);
	});

	it("is NOT a pure barrel for a bare local re-export without `from`", () => {
		const src = `import { A } from "./a.js";\nexport { A };`;
		assert.strictEqual(analyzeReexportBarrel(src).isPureNamedReexportBarrel, false);
	});
});

describe("collectExportNames", () => {
	it("collects named re-exports, namespace re-exports, and local exported declarations", () => {
		const src = `
			export { A, B as Bee } from "./a.js";
			export * as Step from "./step.js";
			export const c = 1;
			export function d() {}
			export class E {}
			export type F = string;
			export interface G {}
			export enum H {}
		`;
		const { names, complete } = collectExportNames(src);
		assert.strictEqual(complete, true);
		assert.deepStrictEqual([...names].sort(), ["A", "Bee", "E", "F", "G", "H", "Step", "c", "d"]);
	});

	it("flags the name set as incomplete when a star re-export cannot be enumerated", () => {
		const { complete } = collectExportNames(`export * from "./a.js";`);
		assert.strictEqual(complete, false);
	});
});

describe("renderReexportStub", () => {
	it("renders sorted value and type re-exports from the base specifier", () => {
		const out = renderReexportStub({
			valueNames: ["B", "A"],
			typeNames: ["D", "C"],
			baseSpecifier: "./index.js",
		});
		assert.strictEqual(out, 'export { A, B } from "./index.js";\nexport type { C, D } from "./index.js";\n');
	});

	it("omits the value line when there are no value names, and points the cts variant at the cjs file", () => {
		const out = renderReexportStub({ valueNames: [], typeNames: ["T"], baseSpecifier: "./index.cjs" });
		assert.strictEqual(out, 'export type { T } from "./index.cjs";\n');
	});

	it("returns the empty string when there is nothing to re-export", () => {
		assert.strictEqual(renderReexportStub({ valueNames: [], typeNames: [], baseSpecifier: "./index.js" }), "");
	});
});
