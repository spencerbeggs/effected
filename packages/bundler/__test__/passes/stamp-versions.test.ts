import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import type { Plugin } from "rolldown";
import { parseSync } from "rolldown/utils";
import { stampSource, stampVersions } from "../../src/passes/stamp-versions.js";

const parse = (filename: string, code: string): unknown => parseSync(filename, code).program;
const SPELLED = "process.env.__PACKAGE_VERSION__";

describe("stampSource", () => {
	it("replaces the expression with a string literal of the version", () => {
		assert.strictEqual(
			stampSource(`export const v: string = ${SPELLED} ?? "0.0.0";`, "a.ts", "1.2.3", parse),
			'export const v: string = "1.2.3" ?? "0.0.0";',
		);
	});

	it("leaves strings, comments and other spellings alone, as define does", () => {
		const code = [
			`// ${SPELLED}`,
			`const s = "${SPELLED}";`,
			`const t = \`${SPELLED}\`;`,
			`const g = globalThis.${SPELLED};`,
			`const c = process.env["__PACKAGE_VERSION__"];`,
			`const x = ${SPELLED}X;`,
		].join("\n");
		assert.isUndefined(stampSource(code, "a.ts", "1.2.3", parse));
	});

	it("counts offsets in UTF-16 past non-ASCII text, and replaces every occurrence", () => {
		const code = `const a = "héllo — ünïcode 🚀"; const b = ${SPELLED}; const c = ${SPELLED};`;
		assert.strictEqual(
			stampSource(code, "a.js", "9.9.9", parse),
			'const a = "héllo — ünïcode 🚀"; const b = "9.9.9"; const c = "9.9.9";',
		);
	});

	it("answers undefined for code that never spells it", () => {
		assert.isUndefined(stampSource("export const a = 1;", "a.ts", "1.0.0", parse));
	});
});

describe("stampVersions", () => {
	const transform = (plugin: Plugin, code: string, id: string): Promise<unknown> => {
		const hook = plugin.transform as { readonly handler: (code: string, id: string) => Promise<unknown> };
		return hook.handler.call({}, code, id);
	};

	it.effect("stamps a module with its package's version past a nested manifest naming no package", () => {
		const handle = MemoryFileSystem.makeSync({
			"/ws/pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
			"/ws/pkg/node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "2.0.0" }),
			// A module-type marker, as dual packages ship: it names no package, so it owns nothing.
			"/ws/pkg/node_modules/dep/dist/esm/package.json": JSON.stringify({ type: "module" }),
		});
		return Effect.gen(function* () {
			const plugin = yield* stampVersions({ cwd: "/ws/pkg" });
			const out = yield* Effect.promise(() =>
				transform(plugin, `export const v = ${SPELLED};`, "/ws/pkg/node_modules/dep/dist/esm/index.js"),
			);
			assert.deepStrictEqual(out, { code: 'export const v = "2.0.0";', map: null });
		}).pipe(Effect.provide(handle.layer));
	});

	it.effect("leaves the package being built to define", () => {
		const handle = MemoryFileSystem.makeSync({
			"/ws/pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
		});
		return Effect.gen(function* () {
			const plugin = yield* stampVersions({ cwd: "/ws/pkg" });
			const out = yield* Effect.promise(() =>
				transform(plugin, `export const v = ${SPELLED};`, "/ws/pkg/src/index.ts"),
			);
			assert.isNull(out);
		}).pipe(Effect.provide(handle.layer));
	});
});
