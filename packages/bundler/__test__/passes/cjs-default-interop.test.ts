// Ported from savvy-web/systems packages/tsdown-plugins/__test__/build/cjs-default-interop.test.ts on 2026-11-06
// packages/bundler/__test__/build/cjs-default-interop.test.ts
import { assert, describe, it } from "@effect/vitest";
import { cjsDefaultInterop } from "../../src/passes/cjs-default-interop.js";

type RenderChunkFn = (
	code: string,
	chunk: { isEntry: boolean; exports: string[] },
	outputOptions: { format: string },
) => { code: string; map: null } | null;

/** Reach the renderChunk handler off the plugin object (object form, not a hook filter). */
function renderChunk(): RenderChunkFn {
	const plugin = cjsDefaultInterop();
	const hook = (plugin as { renderChunk?: unknown }).renderChunk;
	if (typeof hook !== "function") throw new Error("renderChunk hook not a function");
	return hook as RenderChunkFn;
}

const CODE = "exports.A = A;\nexports.B = B;\nexports.default = arr;\n";

describe("cjsDefaultInterop", () => {
	it("appends the interop footer to a cjs ENTRY chunk with default + named exports", () => {
		const out = renderChunk()(CODE, { isEntry: true, exports: ["A", "B", "default"] }, { format: "cjs" });
		assert.isNotNull(out);
		assert.isNull(out?.map);
		assert.include(out?.code, CODE);
		assert.include(out?.code, "module.exports = __cjsDefault");
		// The footer must come AFTER the original exports so module.exports is fully populated.
		assert.isAbove(
			out?.code.indexOf("module.exports = __cjsDefault") ?? -1,
			out?.code.indexOf("exports.default = arr") ?? -1,
		);
	});

	it("is a no-op for the esm format (import().default is already correct)", () => {
		assert.isNull(renderChunk()(CODE, { isEntry: true, exports: ["A", "B", "default"] }, { format: "es" }));
		assert.isNull(renderChunk()(CODE, { isEntry: true, exports: ["A", "B", "default"] }, { format: "esm" }));
	});

	it("is a no-op for a SHARED (non-entry) chunk even with default + named", () => {
		// Shared chunks are required by their named bindings; promoting their module.exports
		// to the default would break the require graph.
		assert.isNull(renderChunk()(CODE, { isEntry: false, exports: ["A", "B", "default"] }, { format: "cjs" }));
	});

	it("is a no-op for a default-only chunk (rolldown already gives module.exports = default)", () => {
		assert.isNull(
			renderChunk()("exports.default = arr;\n", { isEntry: true, exports: ["default"] }, { format: "cjs" }),
		);
	});

	it("is a no-op for a named-only chunk (no default to promote)", () => {
		assert.isNull(renderChunk()("exports.A = A;\n", { isEntry: true, exports: ["A", "B"] }, { format: "cjs" }));
	});

	it("emits a footer that is self-guarded and re-attaches named exports onto the default", () => {
		const out = renderChunk()(CODE, { isEntry: true, exports: ["A", "B", "default"] }, { format: "cjs" });
		// Runtime-evaluate the emitted chunk as a CJS module to assert the resulting shape.
		const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
		const exportsRef = moduleObj.exports;
		const A = { names: ["a"] };
		const B = { names: ["b"] };
		const arr: unknown[] & { A?: unknown; B?: unknown } = [A, B];
		// Reproduce rolldown's emitted body: exports.A/B/default on the same `exports` object,
		// then the appended footer operating over `module`/`exports`.
		const body = `exports.A = A; exports.B = B; exports.default = arr;\n${out?.code.slice(CODE.length) ?? ""}`;
		// eslint-disable-next-line no-new-func
		new Function("module", "exports", "A", "B", "arr", body)(moduleObj, exportsRef, A, B, arr);
		// module.exports is now the array itself...
		assert.strictEqual(Array.isArray(moduleObj.exports), true);
		assert.strictEqual(moduleObj.exports, arr as unknown as Record<string, unknown>);
		// ...with named exports attached as own properties.
		assert.strictEqual((moduleObj.exports as unknown as { A: unknown }).A, A);
		assert.strictEqual((moduleObj.exports as unknown as { B: unknown }).B, B);
	});
});
