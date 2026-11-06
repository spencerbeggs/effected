// packages/bundler/__test__/build/node-builtin-default-interop.test.ts
import { assert, describe, it } from "@effect/vitest";
import { nodeBuiltinDefaultInterop } from "../../src/passes/node-builtin-default-interop.js";

type TransformFn = (code: string, id?: string) => { code: string; map: null } | null;

/** Reach the transform handler off the plugin object. */
function transform(): TransformFn {
	const plugin = nodeBuiltinDefaultInterop();
	const hook = (plugin as { transform?: unknown }).transform;
	if (typeof hook !== "function") throw new Error("transform hook not a function");
	return hook as TransformFn;
}

describe("nodeBuiltinDefaultInterop", () => {
	it("rewrites a default re-export of a node: builtin to namespace form (vfile minproc/minpath)", () => {
		const out = transform()(`export {default as minproc} from 'node:process'\n`);
		assert.isNotNull(out);
		assert.strictEqual(out?.code, `export * as minproc from 'node:process'\n`);
		assert.isNull(out?.map);
	});

	it("rewrites a plain default import of a node: builtin to namespace form", () => {
		const out = transform()(`import process from "node:process"\nprocess.cwd()\n`);
		assert.strictEqual(out?.code, `import * as process from "node:process"\nprocess.cwd()\n`);
	});

	it('rewrites a default import of a BARE builtin name (e.g. "path")', () => {
		const out = transform()(`import path from "path"\n`);
		assert.strictEqual(out?.code, `import * as path from "path"\n`);
	});

	it("splits a default + named import of a builtin so the default binding becomes a namespace", () => {
		const out = transform()(`import fs, { readFileSync } from "node:fs"\n`);
		assert.include(out?.code, `import * as fs from "node:fs"`);
		assert.include(out?.code, `import { readFileSync } from "node:fs"`);
	});

	it("leaves default imports of NON-builtin packages untouched (rolldown wraps those correctly)", () => {
		const code = `import picomatch from "picomatch"\nimport effect from "effect"\n`;
		assert.isNull(transform()(code));
	});

	it("leaves NAMED-only and namespace imports of builtins untouched", () => {
		assert.isNull(transform()(`import { join } from "node:path"\n`));
		assert.isNull(transform()(`import * as path from "node:path"\n`));
	});

	it("does not match an import-like string inside a string literal", () => {
		const code = `const s = 'import x from "node:process"'\n`;
		assert.isNull(transform()(code));
	});

	it("rewrites multiple adjacent builtin default imports in one module", () => {
		const out = transform()(`import process from "node:process"\nimport path from "node:path"\n`);
		assert.strictEqual(out?.code, `import * as process from "node:process"\nimport * as path from "node:path"\n`);
	});

	it("is a no-op for modules with no imports", () => {
		assert.isNull(transform()(`export const x = 1\n`));
	});
});
